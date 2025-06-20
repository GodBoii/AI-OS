# app.py (Corrected, Final, and Definitive Version)

import os
import logging
import json
import uuid
import traceback
from pathlib import Path
from flask import Flask, request, jsonify, redirect, url_for, session
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
import eventlet
import datetime

from authlib.integrations.flask_client import OAuth

from assistant import get_llm_os
from deepsearch import get_deepsearch
from supabase_client import supabase_client

from agno.agent import Agent
from agno.media import Image, Audio, Video
from gotrue.errors import AuthApiError

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SocketIOHandler(logging.Handler):
    def emit(self, record):
        try:
            if record.name != 'socketio' and record.name != 'engineio':
                log_message = self.format(record)
                socketio.emit('log', {'level': record.levelname.lower(), 'message': log_message})
        except Exception:
            pass

logger.addHandler(SocketIOHandler())

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")
if not app.secret_key:
    raise ValueError("FLASK_SECRET_KEY is not set. Please set it in your environment variables.")

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

oauth = OAuth(app)
oauth.register(
    name='github',
    client_id=os.getenv("GITHUB_CLIENT_ID"),
    client_secret=os.getenv("GITHUB_CLIENT_SECRET"),
    access_token_url='https://github.com/login/oauth/access_token',
    access_token_params=None,
    authorize_url='https://github.com/login/oauth/authorize',
    authorize_params=None,
    api_base_url='https://api.github.com/',
    client_kwargs={'scope': 'repo user:email'},
)

class IsolatedAssistant:
    def __init__(self, sid):
        self.sid = sid
        self.message_id = None
        self.current_response_content = ""

    def run_safely(self, agent: Agent, message: str, user, context=None, images=None, audio=None, videos=None):
        def _run_agent(agent, message, user, context, images, audio, videos):
            try:
                if context:
                    complete_message = f"Previous conversation context:\n{context}\n\nCurrent message: {message}"
                else:
                    complete_message = message

                import inspect
                params = inspect.signature(agent.run).parameters
                supported_params = {
                    'message': complete_message,
                    'stream': True,
                    'user_id': str(user.id)
                }
                if 'images' in params and images:
                    supported_params['images'] = images
                if 'audio' in params and audio:
                    supported_params['audio'] = audio
                if 'videos' in params and videos:
                    supported_params['videos'] = videos

                logger.info(f"Calling agent.run for user {user.id} with params: {list(supported_params.keys())}")
                
                self.current_response_content = ""
                
                for chunk in agent.run(**supported_params):
                    if chunk and chunk.content:
                        eventlet.sleep(0)
                        self.current_response_content += chunk.content
                        socketio.emit("response", {
                            "content": chunk.content,
                            "streaming": True,
                            "id": self.message_id,
                        }, room=self.sid)

                socketio.emit("response", {
                    "content": "",
                    "done": True,
                    "id": self.message_id,
                }, room=self.sid)

                if hasattr(agent, 'session_metrics') and agent.session_metrics:
                    logger.info(
                        f"Run complete. Cumulative session tokens for SID {self.sid}: "
                        f"{agent.session_metrics.input_tokens} in, "
                        f"{agent.session_metrics.output_tokens} out."
                    )
                
                self._save_conversation_turn(complete_message)

            except Exception as e:
                error_msg = f"Tool error: {str(e)}\n{traceback.format_exc()}"
                logger.error(error_msg)
                socketio.emit("response", {
                    "content": "An error occurred while processing your request. Starting a new session...",
                    "error": True, "done": True, "id": self.message_id,
                }, room=self.sid)
                socketio.emit("error", {"message": "Session reset required", "reset": True}, room=self.sid)

        eventlet.spawn(_run_agent, agent, message, user, context, images, audio, videos)
    
    def _save_conversation_turn(self, user_message):
        try:
            session_info = connection_manager.sessions.get(self.sid)
            if not session_info:
                logger.warning(f"Cannot save conversation turn: no session found for SID {self.sid}")
                return
                
            turn_data = {
                "role": "user",
                "content": user_message,
                "timestamp": datetime.datetime.now().isoformat()
            }
            
            if 'history' not in session_info:
                session_info['history'] = []
            session_info['history'].append(turn_data)
            
            assistant_turn = {
                "role": "assistant",
                "content": self.current_response_content,
                "timestamp": datetime.datetime.now().isoformat()
            }
            session_info['history'].append(assistant_turn)
            
            logger.info(f"Added conversation turn to history for SID {self.sid}. History length: {len(session_info['history'])}")
        except Exception as e:
            logger.error(f"Error saving conversation turn: {e}")

    def terminate(self):
        pass

class ConnectionManager:
    def __init__(self):
        self.sessions = {}
        self.isolated_assistants = {}

    def create_session(self, sid: str, user_id: str, config: dict, is_deepsearch: bool = False) -> Agent:
        if sid in self.sessions:
            self.terminate_session(sid)

        logger.info(f"Creating new session for user: {user_id}")
        config['enable_github'] = True 

        if is_deepsearch:
            agent = get_deepsearch(user_id=user_id, **config)
        else:
            agent = get_llm_os(user_id=user_id, **config)

        self.sessions[sid] = {
            "agent": agent, 
            "config": config,
            "history": [],
            "user_id": user_id,
            "created_at": datetime.datetime.now().isoformat()
        }
        
        self.isolated_assistants[sid] = IsolatedAssistant(sid)
        logger.info(f"Created session {sid} for user {user_id} with config {config}")
        return agent

    def terminate_session(self, sid):
        if sid in self.sessions:
            session_info = self.sessions.get(sid)
            if not session_info: return
            agent = session_info.get("agent")
            history = session_info.get("history", [])
            user_id = session_info.get("user_id")

            if agent and hasattr(agent, 'session_metrics') and agent.session_metrics:
                try:
                    final_metrics = agent.session_metrics
                    input_tokens, output_tokens = final_metrics.input_tokens, final_metrics.output_tokens
                    if input_tokens > 0 or output_tokens > 0:
                        supabase_client.from_('request_logs').insert({
                            'user_id': str(agent.user_id), 'input_tokens': input_tokens, 'output_tokens': output_tokens
                        }).execute()
                except Exception as e:
                    logger.error(f"Failed to log usage metrics for session {sid} on termination: {e}\n{traceback.format_exc()}")
            
            if history and len(history) > 0:
                try:
                    now = int(datetime.datetime.now().timestamp())
                    payload = {
                        "session_id": sid, "user_id": user_id, "agent_id": "AI_OS",
                        "created_at": now, "updated_at": now, "memory": { "runs": history }, "session_data": {}
                    }
                    if agent and hasattr(agent, 'session_metrics') and agent.session_metrics:
                        payload["session_data"]["metrics"] = {
                            "input_tokens": agent.session_metrics.input_tokens,
                            "output_tokens": agent.session_metrics.output_tokens,
                            "total_tokens": agent.session_metrics.input_tokens + agent.session_metrics.output_tokens
                        }
                    supabase_client.from_('ai_os_sessions').upsert(payload).execute()
                except Exception as e:
                    logger.error(f"Failed to save conversation history for SID {sid}: {e}\n{traceback.format_exc()}")
            
            del self.sessions[sid]
            if sid in self.isolated_assistants:
                self.isolated_assistants[sid].terminate()
                del self.isolated_assistants[sid]
            logger.info(f"Terminated and cleaned up session {sid}")

    def get_session(self, sid):
        return self.sessions.get(sid)

    def remove_session(self, sid):
        self.terminate_session(sid)

connection_manager = ConnectionManager()

@app.route('/login/github')
def login_github():
    token = request.args.get('token')
    if not token:
        return "Authentication token is missing.", 400
    session['supabase_token'] = token
    redirect_uri = url_for('auth_callback_github', _external=True)
    return oauth.github.authorize_redirect(redirect_uri)

@app.route('/auth/github/callback')
def auth_callback_github():
    try:
        supabase_token = session.get('supabase_token')
        if not supabase_token:
            return "Your session has expired. Please try connecting again.", 400
        try:
            user_response = supabase_client.auth.get_user(jwt=supabase_token)
            user = user_response.user
            if not user:
                raise AuthApiError("User not found for the provided token.", 401)
        except AuthApiError as e:
            logger.error(f"Invalid token during GitHub auth callback: {e.message}")
            return "Your session is invalid. Please log in and try again.", 401
        
        token = oauth.github.authorize_access_token()
        integration_data = {
            'user_id': str(user.id), 'service': 'github',
            'access_token': token.get('access_token'), 'scopes': token.get('scope', '').split(',')
        }
        supabase_client.from_('user_integrations').upsert(integration_data).execute()
        logger.info(f"Successfully saved GitHub integration for user {user.id}")
        return """
            <h1>Authentication Successful!</h1>
            <p>You have successfully connected your GitHub account. You can now close this window.</p>
        """
    except Exception as e:
        logger.error(f"Error in GitHub auth callback: {e}\n{traceback.format_exc()}")
        return "An error occurred during authentication. Please try again.", 500

# --- NEW: API Endpoints for managing integrations ---
def get_user_from_token(request):
    """Helper function to authenticate a user from a Bearer token."""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, ('Authorization header is missing or invalid', 401)
    
    jwt = auth_header.split(' ')[1]
    try:
        user_response = supabase_client.auth.get_user(jwt=jwt)
        if not user_response.user:
            raise AuthApiError("User not found for token.", 401)
        return user_response.user, None
    except AuthApiError as e:
        logger.error(f"API authentication error: {e.message}")
        return None, ('Invalid or expired token', 401)

@app.route('/api/integrations', methods=['GET'])
def get_integrations_status():
    """Endpoint for the frontend to check which services are connected."""
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    try:
        response = supabase_client.from_('user_integrations') \
            .select('service') \
            .eq('user_id', str(user.id)) \
            .execute()
        
        connected_services = [item['service'] for item in response.data]
        return jsonify({"integrations": connected_services})
    except Exception as e:
        logger.error(f"Failed to get integration status for user {user.id}: {e}")
        return jsonify({"error": "Failed to retrieve integration status"}), 500

@app.route('/api/integrations/disconnect', methods=['POST'])
def disconnect_integration():
    """Endpoint to remove a service integration for a user."""
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    data = request.get_json()
    service_to_disconnect = data.get('service')
    if not service_to_disconnect:
        return jsonify({"error": "Service name not provided"}), 400

    try:
        supabase_client.from_('user_integrations') \
            .delete() \
            .eq('user_id', str(user.id)) \
            .eq('service', service_to_disconnect) \
            .execute()
        
        logger.info(f"User {user.id} disconnected from {service_to_disconnect}")
        return jsonify({"message": f"Successfully disconnected from {service_to_disconnect}"}), 200
    except Exception as e:
        logger.error(f"Failed to disconnect {service_to_disconnect} for user {user.id}: {e}")
        return jsonify({"error": "Failed to disconnect integration"}), 500

# --- End of new API endpoints ---

@socketio.on("connect")
def on_connect():
    sid = request.sid
    logger.info(f"Client connected: {sid}")
    emit("status", {"message": "Connected to server"})

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    logger.info(f"Client disconnected: {sid}")
    connection_manager.remove_session(sid)

def process_files(files):
    # This function is correct and does not need changes.
    images, audio, videos, text_content = [], [], [], []
    logger.info(f"Processing {len(files)} files")
    for file_data in files:
        file_path, file_type, file_name, is_text, file_content = file_data.get('path'), file_data.get('type', ''), file_data.get('name', 'unnamed_file'), file_data.get('isText', False), file_data.get('content')
        if not file_path and not (is_text and file_content): continue
        if is_text and file_content:
            text_content.append(f"--- File: {file_name} ---\n{file_content}")
            continue
        try:
            path_obj = Path(file_path)
            file_path = str(path_obj.absolute().resolve())
            if not path_obj.exists():
                logger.warning(f"File does not exist at path: {file_path}")
                continue
        except Exception as e:
            logger.error(f"Path normalization error for {file_path}: {str(e)}")
            continue
        try:
            if file_type.startswith('image/'): images.append(Image(filepath=file_path))
            elif file_type.startswith('audio/'): audio.append(Audio(filepath=file_path))
            elif file_type.startswith('video/'): videos.append(Video(filepath=file_path))
            elif file_type.startswith('text/') or file_type == 'application/json':
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f: text_content.append(f"--- File: {file_name} ---\n{f.read()}")
            else: text_content.append(f"--- File: {file_name} (attached at path: {file_path}) ---")
        except Exception as e: logger.error(f"Error processing file {file_path}: {str(e)}")
    return "\n\n".join(text_content) if text_content else None, images, audio, videos


@socketio.on("send_message")
def on_send_message(data: str):
    """Main message handler. Authenticates user and dispatches to the agent."""
    sid = request.sid
    user = None

    try:
        data = json.loads(data)
        access_token = data.get("accessToken")

        if not access_token:
            emit("error", {"message": "Authentication token is missing. Please log in again.", "reset": True}, room=sid)
            return

        try:
            user_response = supabase_client.auth.get_user(jwt=access_token)
            user = user_response.user
            if not user:
                raise AuthApiError("User not found for the provided token.", 401)
            logger.info(f"Request authenticated for user: {user.id}")
        except AuthApiError as e:
            logger.error(f"Invalid token for SID {sid}: {e.message}")
            emit("error", {"message": "Your session has expired. Please log in again.", "reset": True}, room=sid)
            return

        message = data.get("message", "")
        context = data.get("context", "")
        files = data.get("files", [])
        is_deepsearch = data.get("is_deepsearch", False)

        if data.get("type") == "terminate_session":
            connection_manager.terminate_session(sid)
            emit("status", {"message": "Session terminated"}, room=sid)
            return

        session = connection_manager.get_session(sid)
        if not session:
            config = data.get("config", {})
            agent = connection_manager.create_session(
                sid,
                user_id=str(user.id),
                config=config,
                is_deepsearch=is_deepsearch
            )
        else:
            agent = session["agent"]

        message_id = str(uuid.uuid4())
        isolated_assistant = connection_manager.isolated_assistants.get(sid)
        if not isolated_assistant:
            emit("error", {"message": "Session error. Starting new chat...", "reset": True}, room=sid)
            connection_manager.terminate_session(sid)
            return
        
        isolated_assistant.message_id = message_id

        file_content, images, audio, videos = process_files(files)
        combined_message = f"{message}\n\n{file_content}" if file_content else message

        isolated_assistant.run_safely(
            agent,
            combined_message,
            user=user,
            context=context,
            images=images or None,
            audio=audio or None,
            videos=videos or None
        )

    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Starting new chat...", "reset": True}, room=sid)
        connection_manager.terminate_session(sid)


@app.route('/healthz', methods=['GET'])
def health_check():
    """Standard health check endpoint for Render."""
    return "OK", 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    logger.info(f"Starting server on host 0.0.0.0 port {port}, Flask debug mode: {app_debug_mode}")
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)