# python-backend/app.py

import os
import logging
import json
import uuid
import traceback
import requests
from pathlib import Path
from flask import Flask, request, jsonify, redirect, url_for, session
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
import eventlet
import datetime
from typing import Union, Dict, Any, List, Tuple

import redis
from celery import Celery

from authlib.integrations.flask_client import OAuth

from assistant import get_llm_os
from deepsearch import get_deepsearch
from supabase_client import supabase_client

from agno.agent import Agent
from agno.team import Team
from agno.media import Image, Audio, Video, File
from agno.run.response import RunEvent, RunResponse
from agno.run.team import TeamRunEvent, TeamRunResponse
from gotrue.errors import AuthApiError

from browser_tools import browser_ready_events

load_dotenv()

celery = Celery(
    __name__,
    broker=os.getenv("REDIS_URL"),
    backend=os.getenv("REDIS_URL")
)
redis_client = redis.from_url(os.getenv("REDIS_URL"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@celery.task(name="run_agent_task")
def run_agent_task(sid: str, conversation_id: str, message_id: str, turn_data: dict):
    """
    This Celery task now uses the conversation_id as the primary key for state.
    The `sid` is only used for publishing results back to the correct client tab.
    Browser control is NOT supported in this path.
    """
    try:
        logger.info(f"Celery worker picked up job for conversation: {conversation_id}")
        redis_channel = f"results:{sid}"

        session_json = redis_client.get(f"session:{conversation_id}")
        if not session_json:
            raise Exception(f"Session data not found in Redis for conversation_id: {conversation_id}")
        session_data = json.loads(session_json)

        user_id = session_data['user_id']
        is_deepsearch = turn_data['is_deepsearch']
        message = turn_data['user_message']
        
        history_runs = session_data.get("history", [])
        context_list = [f"{run['role']}: {run['content']}" for run in history_runs]
        historical_context = "\n---\n".join(context_list)

        # Recreate the agent, ensuring browser_control is False
        if is_deepsearch:
            agent = get_deepsearch(user_id=user_id, session_info=session_data, **session_data['config'])
        else:
            # Explicitly pass browser_control=False as Celery cannot handle it.
            agent = get_llm_os(
                user_id=user_id,
                session_info=session_data,
                browser_control=False, # <-- IMPORTANT
                **session_data['config']
            )
        
        images = [Image.from_dict(d) for d in turn_data.get('images', [])]
        audio = [Audio.from_dict(d) for d in turn_data.get('audio', [])]
        videos = [Video.from_dict(d) for d in turn_data.get('videos', [])]
        other_files = [File.from_dict(d) for d in turn_data.get('files', [])]

        if agent.team_session_state is None:
            agent.team_session_state = {}
        agent.team_session_state['turn_context'] = turn_data
        
        final_assistant_response = ""
        complete_message_for_prompt = f"Previous conversation context:\n{historical_context}\n\nCurrent message: {message}" if historical_context else message

        import inspect
        params = inspect.signature(agent.run).parameters
        supported_params = {
            'message': complete_message_for_prompt,
            'stream': True, 'stream_intermediate_steps': True, 'user_id': user_id
        }
        if 'images' in params and images: supported_params['images'] = images
        if 'audio' in params and audio: supported_params['audio'] = audio
        if 'videos' in params and videos: supported_params['videos'] = videos
        if 'files' in params and other_files: supported_params['files'] = other_files

        for chunk in agent.run(**supported_params):
            if not chunk or not hasattr(chunk, 'event'): continue
            
            # This logic for publishing to Redis remains the same
            event_data = {
                "event": chunk.event, "content": getattr(chunk, 'content', None),
                "agent_name": getattr(chunk, 'agent_name', None), "team_name": getattr(chunk, 'team_name', None),
                "tool_name": getattr(chunk.tool, 'tool_name', None) if hasattr(chunk, 'tool') else None,
                "has_members": hasattr(chunk, 'member_responses') and bool(chunk.member_responses)
            }
            redis_client.publish(redis_channel, json.dumps(event_data))
            owner_name = event_data['agent_name'] or event_data['team_name']
            is_final_chunk = owner_name == "Aetheria_AI" and not event_data['has_members']
            if event_data['content'] and is_final_chunk and isinstance(event_data['content'], str):
                final_assistant_response += event_data['content']

        redis_client.publish(redis_channel, json.dumps({"event": "run_done"}))

        session_data["history"].append({"role": "user", "content": message})
        session_data["history"].append({"role": "assistant", "content": final_assistant_response})
        redis_client.set(f"session:{conversation_id}", json.dumps(session_data), ex=86400)
        logger.info(f"Worker finished and UPDATED session state in Redis for conversation: {conversation_id}")

        if hasattr(agent, 'session_metrics') and agent.session_metrics:
            metrics = agent.session_metrics
            if metrics.input_tokens > 0 or metrics.output_tokens > 0:
                supabase_client.from_('request_logs').insert({
                    'user_id': user_id, 'input_tokens': metrics.input_tokens, 'output_tokens': metrics.output_tokens
                }).execute()

    except Exception as e:
        error_msg = f"Celery task failed for conversation {conversation_id}: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_msg)
        redis_client.publish(f"results:{sid}", json.dumps({"event": "run_error", "message": "An error occurred in the AI worker."}))

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

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    message_queue=os.getenv("REDIS_URL")
)

oauth = OAuth(app)
# ... (OAuth registration remains unchanged) ...
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

oauth.register(
    name='google',
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    authorize_url='https://accounts.google.com/o/oauth2/auth',
    authorize_params=None,
    access_token_url='https://accounts.google.com/o/oauth2/token',
    access_token_params=None,
    refresh_token_url=None,
    api_base_url='https://www.googleapis.com/oauth2/v1/',
    client_kwargs={
        'scope': 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive',
        'access_type': 'offline',
        'prompt': 'consent'
    }
)

class ConnectionManager:
    def __init__(self):
        pass

    def create_session(self, conversation_id: str, user_id: str, config: dict) -> dict:
        """
        Creates the initial session "shell" in Redis.
        The history list is now initialized here.
        """
        logger.info(f"Creating new session shell in Redis for conversation_id: {conversation_id}")
        config['enable_github'] = True
        config['enable_google_email'] = True
        config['enable_google_drive'] = True
        session_data = {
            "user_id": user_id, "config": config, "created_at": datetime.datetime.now().isoformat(),
            "sandbox_ids": [], "history": []  # Initialize history as an empty list
        }
        session_json = json.dumps(session_data)
        redis_client.set(f"session:{conversation_id}", session_json, ex=86400)
        logger.info(f"Created session shell {conversation_id} for user {user_id}")
        return session_data

    def terminate_session(self, conversation_id: str):
        """
        Terminates a session by saving the final state to Supabase and deleting from Redis.
        """
        session_json = redis_client.get(f"session:{conversation_id}")
        if session_json:
            session_data = json.loads(session_json)
            user_id = session_data.get("user_id")
            history = session_data.get("history", [])

            # Save final history to Supabase for long-term storage
            if history and user_id:
                try:
                    now = int(datetime.datetime.now().timestamp())
                    supabase_client.from_('ai_os_sessions').upsert({
                        "session_id": conversation_id, "user_id": user_id, "agent_id": "AI_OS",
                        "created_at": now, "updated_at": now, "memory": { "runs": history }
                    }).execute()
                    logger.info(f"Saved final session history for {conversation_id} to Supabase.")
                except Exception as e:
                    logger.error(f"Failed to save session {conversation_id} to Supabase: {e}")

            sandbox_ids_to_clean = session_data.get("sandbox_ids", [])
            if sandbox_ids_to_clean:
                sandbox_api_url = os.getenv("SANDBOX_API_URL")
                for sandbox_id in sandbox_ids_to_clean:
                    try:
                        requests.delete(f"{sandbox_api_url}/sessions/{sandbox_id}", timeout=10)
                    except requests.RequestException as e:
                        logger.error(f"Failed to clean up sandbox {sandbox_id}: {e}")
            
            logger.info(f"Terminating session {conversation_id}. Deleting from Redis.")
            redis_client.delete(f"session:{conversation_id}")
        else:
            logger.info(f"Attempted to terminate non-existent conversation: {conversation_id}.")

    def get_session(self, conversation_id: str) -> dict | None:
        session_json = redis_client.get(f"session:{conversation_id}")
        if session_json:
            return json.loads(session_json)
        return None

    def remove_session(self, conversation_id: str):
        self.terminate_session(conversation_id)

connection_manager = ConnectionManager()

# --- NEW: Socket.IO handler for browser status updates from the client ---
@socketio.on("browser-status-update")
def on_browser_status_update(data: dict):
    """
    Receives confirmation from the client that the browser is ready or that the user denied the request.
    """
    conversation_id = data.get("conversationId")
    is_ready = data.get("ready", False)
    logger.info(f"Received browser status for conversation {conversation_id}: {'Ready' if is_ready else 'Denied/Failed'}")
    
    if conversation_id in browser_ready_events:
        # Get the eventlet Event for this conversation
        ready_event = browser_ready_events[conversation_id]
        # Send the status (True/False) to the waiting green thread
        ready_event.send(is_ready)

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
        return oauth.google.authorize_redirect(
            redirect_uri,
            access_type='offline',
            prompt='consent'
        )
        
    return oauth.create_client(provider).authorize_redirect(redirect_uri)

@app.route('/auth/<provider>/callback')
def auth_callback(provider):
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
            logger.error(f"Invalid token during {provider} auth callback: {e.message}")
            return "Your session is invalid. Please log in and try again.", 401
        
        client = oauth.create_client(provider)
        token = client.authorize_access_token()

        logger.info(f"Received token data from {provider}: {token}")
        
        integration_data = {
            'user_id': str(user.id),
            'service': provider,
            'access_token': token.get('access_token'),
            'refresh_token': token.get('refresh_token'),
            'scopes': token.get('scope', '').split(' '),
        }
        
        integration_data = {k: v for k, v in integration_data.items() if v is not None}

        supabase_client.from_('user_integrations').upsert(integration_data).execute()
        
        logger.info(f"Successfully saved {provider} integration for user {user.id}")

        return f"""
            <h1>Authentication Successful!</h1>
            <p>You have successfully connected your {provider.capitalize()} account. You can now close this window.</p>
        """
    except Exception as e:
        logger.error(f"Error in {provider} auth callback: {e}\n{traceback.format_exc()}")
        return "An error occurred during authentication. Please try again.", 500

def get_user_from_token(request):
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
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    try:
        response = supabase_client.from_('user_integrations').select('service').eq('user_id', str(user.id)).execute()
        connected_services = [item['service'] for item in response.data]
        return jsonify({"integrations": connected_services})
    except Exception as e:
        logger.error(f"Failed to get integration status for user {user.id}: {e}")
        return jsonify({"error": "Failed to retrieve integration status"}), 500

@app.route('/api/integrations/disconnect', methods=['POST'])
def disconnect_integration():
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    data = request.get_json()
    service_to_disconnect = data.get('service')
    if not service_to_disconnect:
        return jsonify({"error": "Service name not provided"}), 400

    try:
        supabase_client.from_('user_integrations').delete().eq('user_id', str(user.id)).eq('service', service_to_disconnect).execute()
        logger.info(f"User {user.id} disconnected from {service_to_disconnect}")
        return jsonify({"message": f"Successfully disconnected from {service_to_disconnect}"}), 200
    except Exception as e:
        logger.error(f"Failed to disconnect {service_to_disconnect} for user {user.id}: {e}")
        return jsonify({"error": "Failed to disconnect integration"}), 500

@app.route('/api/sessions', methods=['GET'])
def get_user_sessions():
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    try:
        response = supabase_client.from_('ai_os_sessions') \
            .select('session_id, created_at, memory') \
            .eq('user_id', str(user.id)) \
            .order('created_at', desc=True) \
            .limit(50) \
            .execute()
        return jsonify(response.data), 200
    except Exception as e:
        logger.error(f"Failed to get sessions for user {user.id}: {e}")
        return jsonify({"error": "Failed to retrieve session history"}), 500

@app.route('/api/generate-upload-url', methods=['POST'])
def generate_upload_url():
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    data = request.get_json()
    file_name = data.get('fileName')
    if not file_name:
        return jsonify({"error": "fileName is required"}), 400

    file_path = f"{user.id}/{file_name}"
    
    try:
        upload_details = supabase_client.storage.from_('media-uploads').create_signed_upload_url(file_path)
        response_data = {
            "signedURL": upload_details['signed_url'],
            "path": upload_details['path']
        }
        return jsonify(response_data), 200
    except Exception as e:
        logger.error(f"Failed to create signed URL for user {user.id}: {e}\n{traceback.format_exc()}")
        return jsonify({"error": "Could not create signed URL"}), 500

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

def process_files(files_data: List[Dict[str, Any]]) -> Tuple[List[Image], List[Audio], List[Video], List[File]]:
    # ... (This function remains unchanged) ...
    images, audio, videos, other_files = [], [], [], []
    logger.info(f"Processing {len(files_data)} files into agno objects")

    for file_data in files_data:
        file_name = file_data.get('name', 'unnamed_file')
        file_type = file_data.get('type', '')
        
        if 'path' in file_data:
            file_path_in_bucket = file_data['path']
            try:
                file_bytes = supabase_client.storage.from_('media-uploads').download(file_path_in_bucket)
                
                if file_type.startswith('image/'):
                    images.append(Image(content=file_bytes, name=file_name))
                elif file_type.startswith('audio/'):
                    audio.append(Audio(content=file_bytes, format=file_type.split('/')[-1], name=file_name))
                elif file_type.startswith('video/'):
                    videos.append(Video(content=file_bytes, name=file_name))
                else:
                    other_files.append(File(content=file_bytes, name=file_name, mime_type=file_type))
            except Exception as e:
                logger.error(f"Error downloading file from Supabase Storage at path {file_path_in_bucket}: {str(e)}")
            continue

        if file_data.get('isText') and 'content' in file_data:
            try:
                content_bytes = file_data['content'].encode('utf-8')
                file_obj = File(content=content_bytes, name=file_name, mime_type=file_type)
                other_files.append(file_obj)
            except Exception as e:
                logger.error(f"Error creating File object for {file_name}: {e}")
            continue

    return images, audio, videos, other_files

# --- PHASE 2 MODIFICATION: Add the Redis Pub/Sub Listener ---
def listen_for_results(sid: str, message_id: str):
    """
    Listens on a Redis Pub/Sub channel for results from a Celery worker
    and emits them to the client via Socket.IO.
    """
    pubsub = redis_client.pubsub()
    redis_channel = f"results:{sid}"
    pubsub.subscribe(redis_channel)
    
    logger.info(f"Web server started listening on Redis channel: {redis_channel}")

    for message in pubsub.listen():
        if message['type'] == 'message':
            data = json.loads(message['data'])
            event_type = data.get("event")

            if event_type == "run_done":
                socketio.emit("response", {"content": "", "done": True, "id": message_id}, room=sid)
                logger.info(f"Worker finished for SID {sid}. Closing listener.")
                break 
            
            elif event_type == "run_error":
                socketio.emit("response", {"content": data.get("message"), "error": True, "done": True, "id": message_id}, room=sid)
                logger.error(f"Worker reported an error for SID {sid}. Closing listener.")
                break

            elif event_type in (RunEvent.run_response_content.value, TeamRunEvent.run_response_content.value):
                owner_name = data.get('agent_name') or data.get('team_name')
                is_final_content = owner_name == "Aetheria_AI" and not data.get('has_members')
                socketio.emit("response", {
                    "content": data.get("content"), "streaming": True, "id": message_id,
                    "agent_name": owner_name, "team_name": owner_name, "is_log": not is_final_content,
                }, room=sid)

            elif event_type in (RunEvent.tool_call_started.value, TeamRunEvent.tool_call_started.value):
                socketio.emit("agent_step", {
                    "type": "tool_start", "name": data.get("tool_name"),
                    "agent_name": data.get('agent_name'), "team_name": data.get('team_name'), "id": message_id
                }, room=sid)

            elif event_type in (RunEvent.tool_call_completed.value, TeamRunEvent.tool_call_completed.value):
                socketio.emit("agent_step", {
                    "type": "tool_end", "name": data.get("tool_name"),
                    "agent_name": data.get('agent_name'), "team_name": data.get('team_name'), "id": message_id
                }, room=sid)

    pubsub.unsubscribe(redis_channel)
# --- END MODIFICATION ---

# --- MODIFIED: The main message handler now routes tasks based on browser_control ---
@socketio.on("send_message")
def on_send_message(data: str):
    sid = request.sid
    try:
        data = json.loads(data)
        access_token = data.get("accessToken")
        conversation_id = data.get("conversationId")
        if not conversation_id:
            emit("error", {"message": "Critical error: conversationId is missing."}, room=sid)
            return
        if not access_token:
            emit("error", {"message": "Authentication token is missing. Please log in again.", "reset": True}, room=sid)
            return
        
        user = supabase_client.auth.get_user(jwt=access_token).user
        if not user: raise AuthApiError("User not found for the provided token.", 401)

        if data.get("type") == "terminate_session":
            conv_id_to_terminate = data.get("conversationId")
            if conv_id_to_terminate:
                connection_manager.terminate_session(conv_id_to_terminate)
                emit("status", {"message": f"Session {conv_id_to_terminate} terminated"}, room=sid)
            return
            
        session_data = connection_manager.get_session(conversation_id)
        if not session_data:
            session_data = connection_manager.create_session(conversation_id, user_id=str(user.id), config=data.get("config", {}))
        
        # Add conversation_id to session_info for the tools to use
        session_data["conversation_id"] = conversation_id

        # --- START: NEW ROUTING LOGIC ---
        config = data.get("config", {})
        browser_control_enabled = config.get("browser_control", False)

        if browser_control_enabled:
            # If browser control is on, run the agent in the main thread using eventlet.
            logger.info(f"Running agent with browser control for conversation: {conversation_id}")
            eventlet.spawn(run_agent_directly, sid, conversation_id, data, session_data)
        else:
            # Otherwise, use the existing Celery path for background processing.
            logger.info(f"Dispatching agent task to Celery for conversation: {conversation_id}")
            images, audio, videos, other_files = process_files(data.get("files", []))
            turn_data = {
                "user_message": data.get("message", ""),
                "is_deepsearch": data.get("is_deepsearch", False),
                "images": [img.to_dict() for img in images],
                "audio": [aud.to_dict() for aud in audio],
                "videos": [vid.to_dict() for vid in videos],
                "files": [f.to_dict() for f in other_files],
            }
            message_id = data.get("id") or str(uuid.uuid4())
            run_agent_task.delay(sid, conversation_id, message_id, turn_data)
            eventlet.spawn(listen_for_results, sid, message_id)
        # --- END: NEW ROUTING LOGIC ---

    except AuthApiError as e:
        logger.error(f"Invalid token for SID {sid}: {e.message}")
        emit("error", {"message": "Your session has expired. Please log in again.", "reset": True}, room=sid)
    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        emit("error", {"message": "AI service error. Please start a new chat.", "reset": True}, room=sid)

# --- NEW: Function to run agent directly for interactive tasks ---
def run_agent_directly(sid: str, conversation_id: str, data: dict, session_data: dict):
    """
    Runs the agent in a non-blocking eventlet green thread for interactive sessions
    like browser control.
    """
    message_id = data.get("id") or str(uuid.uuid4())
    try:
        user_id = session_data['user_id']
        message = data.get("message", "")
        config = data.get("config", {})

        # Get the agent instance, passing socketio and sid for communication
        agent = get_llm_os(
            user_id=user_id,
            session_info=session_data,
            socketio=socketio,
            sid=sid,
            **config
        )

        images, audio, videos, other_files = process_files(data.get("files", []))
        
        # This logic is similar to the Celery task but runs here
        history_runs = session_data.get("history", [])
        context_list = [f"{run['role']}: {run['content']}" for run in history_runs]
        historical_context = "\n---\n".join(context_list)
        complete_message_for_prompt = f"Previous conversation context:\n{historical_context}\n\nCurrent message: {message}" if historical_context else message

        final_assistant_response = ""

        import inspect
        params = inspect.signature(agent.run).parameters
        supported_params = {
            'message': complete_message_for_prompt,
            'stream': True, 'stream_intermediate_steps': True, 'user_id': user_id
        }
        if 'images' in params and images: supported_params['images'] = images
        if 'audio' in params and audio: supported_params['audio'] = audio
        if 'videos' in params and videos: supported_params['videos'] = videos
        if 'files' in params and other_files: supported_params['files'] = other_files

        # Stream results directly back to the client
        for chunk in agent.run(**supported_params):
            if not chunk or not hasattr(chunk, 'event'): continue

            # This logic is similar to the Redis listener but emits directly
            owner_name = getattr(chunk, 'agent_name', None) or getattr(chunk, 'team_name', None)
            is_final_content = owner_name == "Aetheria_AI" and not (hasattr(chunk, 'member_responses') and chunk.member_responses)
            
            if chunk.event in (RunEvent.run_response_content.value, TeamRunEvent.run_response_content.value):
                socketio.emit("response", {
                    "content": chunk.content, "streaming": True, "id": message_id,
                    "agent_name": owner_name, "team_name": owner_name, "is_log": not is_final_content,
                }, room=sid)
                if chunk.content and is_final_content and isinstance(chunk.content, str):
                    final_assistant_response += chunk.content
            
            elif chunk.event in (RunEvent.tool_call_started.value, TeamRunEvent.tool_call_started.value):
                socketio.emit("agent_step", {
                    "type": "tool_start", "name": getattr(chunk.tool, 'tool_name', 'N/A'),
                    "agent_name": owner_name, "team_name": owner_name, "id": message_id
                }, room=sid)

            elif chunk.event in (RunEvent.tool_call_completed.value, TeamRunEvent.tool_call_completed.value):
                socketio.emit("agent_step", {
                    "type": "tool_end", "name": getattr(chunk.tool, 'tool_name', 'N/A'),
                    "agent_name": owner_name, "team_name": owner_name, "id": message_id
                }, room=sid)

        socketio.emit("response", {"content": "", "done": True, "id": message_id}, room=sid)

        # Update session state in Redis
        session_data["history"].append({"role": "user", "content": message})
        session_data["history"].append({"role": "assistant", "content": final_assistant_response})
        redis_client.set(f"session:{conversation_id}", json.dumps(session_data), ex=86400)
        logger.info(f"Direct run finished and updated session state for conversation: {conversation_id}")

    except Exception as e:
        logger.error(f"Direct agent run failed for conversation {conversation_id}: {e}\n{traceback.format_exc()}")
        socketio.emit("error", {"message": "An error occurred during the interactive agent task.", "reset": True}, room=sid)


@app.route('/healthz', methods=['GET'])
def health_check():
    return "OK", 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    app_debug_mode = os.environ.get("DEBUG", "False").lower() == "true"
    socketio.run(app, host="0.0.0.0", port=port, debug=app_debug_mode, use_reloader=app_debug_mode)