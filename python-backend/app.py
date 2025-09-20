# python-backend/app.py (Final, Corrected Version for Agno v2.0.7)

import os
import logging
import json
import uuid
import traceback
import requests
import datetime
from pathlib import Path
from typing import Union, Dict, Any, List, Tuple, Optional

import redis
from celery import Celery
from dotenv import load_dotenv
import eventlet

from flask import Flask, request, jsonify, redirect, url_for, session
from flask_socketio import SocketIO, emit
from authlib.integrations.flask_client import OAuth
from gotrue.errors import AuthApiError

# --- Custom Module Imports ---
from assistant import get_llm_os
from supabase_client import supabase_client
from browser_tools import BrowserTools
from agno.agent import Agent
from agno.team import Team
from agno.media import Image, Audio, Video, File
from agno.run.agent import RunEvent
from agno.run.team import TeamRunEvent, TeamRunOutput

# --- Initial Configuration ---
load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Global Celery Instance ---
celery = Celery(__name__)

redis_url = os.getenv('REDIS_URL', 'redis://redis:6379/0')
celery.conf.update(
    broker_url=redis_url,
    result_backend=redis_url
)

# --- Global Placeholders ---
socketio = None
redis_client = None
connection_manager = None
oauth = None
browser_waiting_events: Dict[str, eventlet.event.Event] = {}

# --- Logic and Helper Classes ---

class ConnectionManager:
    def create_session(self, conversation_id: str, user_id: str, config: dict) -> dict:
        logger.info(f"Creating new session shell in Redis for conversation_id: {conversation_id}")
        config.update({
            'enable_github': True, 'enable_google_email': True, 'enable_google_drive': True,
            'enable_browser': True, 'enable_vercel': True, 'enable_supabase': True
        })
        session_data = {
            "user_id": user_id, "config": config, "created_at": datetime.datetime.now().isoformat(),
            "sandbox_ids": [], "history": []
        }
        redis_client.set(f"session:{conversation_id}", json.dumps(session_data), ex=86400)
        return session_data

    def terminate_session(self, conversation_id: str):
        session_json = redis_client.get(f"session:{conversation_id}")
        if session_json:
            session_data = json.loads(session_json)
            user_id, history = session_data.get("user_id"), session_data.get("history", [])
            if history and user_id:
                try:
                    now = int(datetime.datetime.now().timestamp())
                    
                    # This now correctly targets the 'agno_sessions' table.
                    supabase_client.from_('agno_sessions').upsert({
                        "session_id": conversation_id, "user_id": user_id, "agent_id": "AI_OS",
                        "created_at": now, "updated_at": now, "memory": {"runs": history}
                    }).execute()

                except Exception as e:
                    logger.error(f"Failed to save session {conversation_id} to Supabase on termination: {e}")

            sandbox_api_url = os.getenv("SANDBOX_API_URL")
            if sandbox_api_url:
                for sandbox_id in session_data.get("sandbox_ids", []):
                    try:
                        requests.delete(f"{sandbox_api_url}/sessions/{sandbox_id}", timeout=10)
                    except requests.RequestException as e:
                        logger.error(f"Failed to clean up sandbox {sandbox_id}: {e}")
            redis_client.delete(f"session:{conversation_id}")

    def get_session(self, conversation_id: str) -> dict | None:
        session_json = redis_client.get(f"session:{conversation_id}")
        return json.loads(session_json) if session_json else None

def run_agent_and_stream(sid: str, conversation_id: str, message_id: str, turn_data: dict, browser_tools_config: dict, custom_tool_config: dict):
    try:
        session_data = connection_manager.get_session(conversation_id)
        if not session_data:
            raise Exception(f"Session data not found for {conversation_id}")
        user_id, message = session_data['user_id'], turn_data['user_message']

        agent = get_llm_os(user_id=user_id, session_info=session_data, browser_tools_config=browser_tools_config, custom_tool_config=custom_tool_config, **session_data['config'])

        images, audio, videos, other_files = process_files(turn_data.get('files', []))

        current_session_state = {
            'turn_context': turn_data
        }

        final_assistant_response = ""
        # --- FIX 1: Initialize run_output to capture the final object from the stream ---
        run_output: Optional[TeamRunOutput] = None

        run_input: Union[str, Dict]
        has_files = any([images, audio, videos, other_files])

        if has_files:
            run_input = {"content": message}
            if images: run_input['images'] = images
            if audio: run_input['audio'] = audio
            if videos: run_input['videos'] = videos
            if other_files: run_input['files'] = other_files
        else:
            run_input = message

        for chunk in agent.run(
            input=run_input,
            session_id=conversation_id,
            session_state=current_session_state,
            stream=True,
            stream_intermediate_steps=True,
            add_history_to_context=True
        ):
            if not chunk or not hasattr(chunk, 'event'):
                continue

            # --- FIX 2: Capture the final TeamRunOutput object from the stream ---
            # This object contains the final metrics and structured event data.
            if isinstance(chunk, TeamRunOutput):
                run_output = chunk

            owner_name = getattr(chunk, 'agent_name', None) or getattr(chunk, 'team_name', None)

            if chunk.event in (RunEvent.run_content.value, TeamRunEvent.run_content.value):
                is_final = owner_name == "Aetheria_AI" and not getattr(chunk, 'member_responses', [])
                socketio.emit("response", {"content": chunk.content, "streaming": True, "id": message_id, "agent_name": owner_name, "is_log": not is_final}, room=sid)
                if chunk.content and is_final:
                    final_assistant_response += chunk.content
            elif chunk.event in (RunEvent.tool_call_started.value, TeamRunEvent.tool_call_started.value):
                socketio.emit("agent_step", {"type": "tool_start", "name": getattr(chunk.tool, 'tool_name', None), "agent_name": owner_name, "id": message_id}, room=sid)
            elif chunk.event in (RunEvent.tool_call_completed.value, TeamRunEvent.tool_call_completed.value):
                socketio.emit("agent_step", {"type": "tool_end", "name": getattr(chunk.tool, 'tool_name', None), "agent_name": owner_name, "id": message_id}, room=sid)

        socketio.emit("response", {"done": True, "id": message_id}, room=sid)

        session_data["history"].append({"role": "user", "content": message})
        assistant_turn = {"role": "assistant", "content": final_assistant_response, "events": []}
        
        # --- FIX 3: Correctly serialize history events before saving ---
        # The event objects in run_output.events must be converted to dictionaries.
        if run_output and run_output.events:
            assistant_turn["events"] = [event.to_dict() for event in run_output.events]
        
        session_data["history"].append(assistant_turn)
        redis_client.set(f"session:{conversation_id}", json.dumps(session_data), ex=86400)

        # This block now works because `run_output` is correctly captured from the stream.
        if run_output and run_output.metrics:
            metrics = run_output.metrics
            if metrics.input_tokens > 0 or metrics.output_tokens > 0:
                supabase_client.from_('request_logs').insert({
                    'user_id': user_id,
                    'input_tokens': metrics.input_tokens,
                    'output_tokens': metrics.output_tokens
                }).execute()

    except Exception as e:
        logger.error(f"Agent run failed for {conversation_id}: {e}\n{traceback.format_exc()}")
        socketio.emit("error", {"message": str(e), "reset": True}, room=sid)

def process_files(files_data: List[Dict[str, Any]]) -> Tuple[List[Image], List[Audio], List[Video], List[File]]:
    images, audio, videos, other_files = [], [], [], []
    if not files_data: return images, audio, videos, other_files
    for file_data in files_data:
        file_name, file_type = file_data.get('name', ''), file_data.get('type', '')
        if 'path' in file_data:
            try:
                file_bytes = supabase_client.storage.from_('media-uploads').download(file_data['path'])
                if file_type.startswith('image/'): images.append(Image(content=file_bytes, name=file_name))
                elif file_type.startswith('audio/'): audio.append(Audio(content=file_bytes, format=file_type.split('/')[-1], name=file_name))
                elif file_type.startswith('video/'): videos.append(Video(content=file_bytes, name=file_name))
                else: other_files.append(File(content=file_bytes, name=file_name, mime_type=file_type))
            except Exception as e: logger.error(f"Error downloading file {file_data['path']}: {e}")
        elif file_data.get('isText') and 'content' in file_data:
            other_files.append(File(content=file_data['content'].encode('utf-8'), name=file_name, mime_type=file_type))
    return images, audio, videos, other_files

def get_user_from_token(request):
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '): return None, ('Authorization header is missing or invalid', 401)
    jwt = auth_header.split(' ')[1]
    try:
        user_response = supabase_client.auth.get_user(jwt=jwt)
        if not user_response.user: raise AuthApiError("User not found for token.", 401)
        return user_response.user, None
    except AuthApiError as e:
        logger.error(f"API authentication error: {e.message}")
        return None, ('Invalid or expired token', 401)

# --- Application Factory ---
def create_app():
    global socketio, redis_client, connection_manager, oauth

    app = Flask(__name__)
    app.secret_key = os.getenv("FLASK_SECRET_KEY")

    redis_client = redis.from_url(redis_url)
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet", message_queue=redis_url)
    
    connection_manager = ConnectionManager()
    oauth = OAuth(app)

    # Register OAuth providers
    oauth.register(
        name='github', client_id=os.getenv("GITHUB_CLIENT_ID"), client_secret=os.getenv("GITHUB_CLIENT_SECRET"),
        access_token_url='https://github.com/login/oauth/access_token', authorize_url='https://github.com/login/oauth/authorize',
        api_base_url='https://api.github.com/', client_kwargs={'scope': 'repo user:email'}
    )
    oauth.register(
        name='google', client_id=os.getenv("GOOGLE_CLIENT_ID"), client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
        authorize_url='https://accounts.google.com/o/oauth2/auth', access_token_url='https://accounts.google.com/o/oauth2/token',
        api_base_url='https://www.googleapis.com/oauth2/v1/',
        client_kwargs={'scope': 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive', 'access_type': 'offline', 'prompt': 'consent'}
    )
    oauth.register(
        name='vercel', client_id=os.getenv("VERCEL_CLIENT_ID"), client_secret=os.getenv("VERCEL_CLIENT_SECRET"),
        access_token_url='https://api.vercel.com/v2/oauth/access_token', authorize_url='https://vercel.com/oauth/authorize',
        api_base_url='https://api.vercel.com/', client_kwargs={'scope': 'users:read teams:read projects:read deployments:read'}
    )
    oauth.register(
        name='supabase',
        client_id=os.getenv("SUPABASE_CLIENT_ID"),
        client_secret=os.getenv("SUPABASE_CLIENT_SECRET"),
        access_token_url='https://api.supabase.com/v1/oauth/token',
        authorize_url='https://api.supabase.com/v1/oauth/authorize',
        api_base_url='https://api.supabase.com/v1/',
        client_kwargs={'scope': 'organizations:read projects:read'}
    )

    # --- Register Routes and Event Handlers within App Context ---
    with app.app_context():
        @app.route('/healthz')
        def health_check(): return "OK", 200

        @app.route('/login/<provider>')
        def login_provider(provider):
            token = request.args.get('token')
            if not token:
                return "Authentication token is missing.", 400
            session['supabase_token'] = token
            redirect_uri = url_for('auth_callback', provider=provider, _external=True)
            if provider not in oauth._clients:
                return "Invalid provider specified.", 404
            if provider == 'google':
                return oauth.google.authorize_redirect(redirect_uri, access_type='offline', prompt='consent')
            return oauth.create_client(provider).authorize_redirect(redirect_uri)

        @app.route('/auth/<provider>/callback')
        def auth_callback(provider):
            try:
                if provider == 'vercel':
                    code = request.args.get('code')
                    if not code: return "Vercel authorization code is missing.", 400
                    token_response = requests.post(
                        'https://api.vercel.com/v2/oauth/access_token',
                        data={
                            'client_id': os.getenv("VERCEL_CLIENT_ID"), 'client_secret': os.getenv("VERCEL_CLIENT_SECRET"),
                            'code': code, 'redirect_uri': url_for('auth_callback', provider='vercel', _external=True)
                        }
                    )
                    token_response.raise_for_status()
                    token = token_response.json()
                    user_info_response = requests.get(
                        'https://api.vercel.com/v2/user',
                        headers={'Authorization': f"Bearer {token['access_token']}"}
                    )
                    user_info_response.raise_for_status()
                    vercel_user_email = user_info_response.json()['user']['email']
                    user_lookup = supabase_client.from_('profiles').select('id').eq('email', vercel_user_email).single().execute()
                    if not user_lookup.data: return "Error: Could not find a user in our system with the Vercel email address.", 400
                    user_id = user_lookup.data['id']
                else:
                    supabase_token = session.get('supabase_token')
                    if not supabase_token: return "Your session has expired.", 400
                    user = supabase_client.auth.get_user(jwt=supabase_token).user
                    if not user: raise AuthApiError("User not found for token.", 401)
                    user_id = user.id
                    client = oauth.create_client(provider)
                    token = client.authorize_access_token()

                if not user_id: return "Could not identify the user.", 400
                integration_data = {
                    'user_id': str(user_id), 'service': provider, 'access_token': token.get('access_token'),
                    'refresh_token': token.get('refresh_token'), 'scopes': token.get('scope', '').split(' '),
                }
                integration_data = {k: v for k, v in integration_data.items() if v is not None}
                supabase_client.from_('user_integrations').upsert(integration_data).execute()
                logger.info(f"Successfully saved {provider} integration for user {user_id}")
                return f"<h1>Authentication Successful!</h1><p>You have successfully connected your {provider.capitalize()} account. You can now close this window.</p>"
            except Exception as e:
                logger.error(f"Error in {provider} auth callback: {e}\n{traceback.format_exc()}")
                return "An error occurred during authentication. Please try again.", 500

        @app.route('/api/integrations', methods=['GET'])
        def get_integrations_status():
            user, error = get_user_from_token(request)
            if error: return jsonify({"error": error[0]}), error[1]
            response = supabase_client.from_('user_integrations').select('service').eq('user_id', str(user.id)).execute()
            return jsonify({"integrations": [item['service'] for item in response.data]})

        @app.route('/api/integrations/disconnect', methods=['POST'])
        def disconnect_integration():
            user, error = get_user_from_token(request)
            if error: return jsonify({"error": error[0]}), error[1]
            service = request.json.get('service')
            if not service: return jsonify({"error": "Service not provided"}), 400
            supabase_client.from_('user_integrations').delete().match({'user_id': str(user.id), 'service': service}).execute()
            return jsonify({"message": "Disconnected"}), 200

        @app.route('/api/sessions', methods=['GET'])
        def get_user_sessions():
            user, error = get_user_from_token(request)
            if error: return jsonify({"error": error[0]}), error[1]
            
            response = supabase_client.from_('agno_sessions').select('*').eq('user_id', str(user.id)).order('created_at', desc=True).limit(50).execute()
            
            return jsonify(response.data), 200

        @app.route('/api/generate-upload-url', methods=['POST'])
        def generate_upload_url():
            user, error = get_user_from_token(request)
            if error: return jsonify({"error": error[0]}), error[1]
            file_name = request.json.get('fileName')
            if not file_name: return jsonify({"error": "fileName is required"}), 400
            file_path = f"{user.id}/{uuid.uuid4()}/{file_name}"
            upload_details = supabase_client.storage.from_('media-uploads').create_signed_upload_url(file_path)
            return jsonify({"signedURL": upload_details['signed_url'], "path": upload_details['path']}), 200

        @socketio.on("connect")
        def on_connect():
            logger.info(f"Client connected: {request.sid}")
            emit("status", {"message": "Connected to server"})

        @socketio.on("disconnect")
        def on_disconnect():
            logger.info(f"Client disconnected: {request.sid}")

        @socketio.on('browser-command-result')
        def handle_browser_command_result(data: Dict[str, Any]):
            request_id = data.get('request_id')
            if request_id in browser_waiting_events:
                browser_waiting_events.get(request_id).send(data.get('result', {}))

        @socketio.on("send_message")
        def on_send_message(data: str):
            sid = request.sid
            try:
                data = json.loads(data)
                access_token, conversation_id = data.get("accessToken"), data.get("conversationId")
                if not conversation_id: return emit("error", {"message": "Critical error: conversationId is missing."}, room=sid)
                if not access_token: return emit("error", {"message": "Authentication token is missing.", "reset": True}, room=sid)

                user = supabase_client.auth.get_user(jwt=access_token).user
                if not user: raise AuthApiError("User not found for token.", 401)

                if data.get("type") == "terminate_session":
                    connection_manager.terminate_session(conversation_id)
                    return emit("status", {"message": f"Session {conversation_id} terminated"}, room=sid)

                if not connection_manager.get_session(conversation_id):
                    connection_manager.create_session(conversation_id, str(user.id), data.get("config", {}))

                turn_data = {"user_message": data.get("message", ""), "files": data.get("files", [])}
                message_id = data.get("id") or str(uuid.uuid4())
                browser_tools_config = {'sid': sid, 'socketio': socketio, 'waiting_events': browser_waiting_events}
                custom_tool_config = {'sid': sid, 'socketio': socketio, 'message_id': message_id}

                eventlet.spawn(run_agent_and_stream, sid, conversation_id, message_id, turn_data, browser_tools_config, custom_tool_config)
                logger.info(f"Spawned agent run for conversation: {conversation_id}")

            except AuthApiError as e:
                logger.error(f"Invalid token for SID {sid}: {e.message}")
                emit("error", {"message": "Your session has expired. Please log in again.", "reset": True}, room=sid)
            except Exception as e:
                logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
                emit("error", {"message": "AI service error. Please start a new chat.", "reset": True}, room=sid)

    return app

# --- Main Execution Block (for local development) ---
if __name__ == "__main__":
    app = create_app()
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)