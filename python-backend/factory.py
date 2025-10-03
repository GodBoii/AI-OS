# python-backend/factory.py

import logging
import json
import uuid
import traceback
import requests
from typing import Dict, Any

import eventlet
from flask import Flask, request, jsonify, redirect, url_for, session
from gotrue.errors import AuthApiError

# --- Local Module Imports ---
import config
from extensions import socketio, oauth, RedisClient, browser_waiting_events
from supabase_client import supabase_client

# --- Service Layer Imports ---
# Import the logic that has been extracted to the service layer
from session_service import ConnectionManager
from agent_runner import run_agent_and_stream

logger = logging.getLogger(__name__)

# ==============================================================================
# UTILITY FUNCTIONS
# (These are specific to the web layer and can remain here for now)
# ==============================================================================

def get_user_from_token(request):
    """
    Validates a JWT from an Authorization header and retrieves the user.
    """
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

# ==============================================================================
# APPLICATION FACTORY
# ==============================================================================

def create_app():
    """
    Creates and configures the Flask application and its extensions.
    This function acts as the composition root for the application.
    """
    app = Flask(__name__)
    app.secret_key = config.FLASK_SECRET_KEY

    # --- Initialize Extensions ---
    socketio.init_app(app, message_queue=config.REDIS_URL)
    oauth.init_app(app)
    
    # --- Instantiate Services ---
    # Create instances of our services, injecting dependencies like the Redis client.
    redis_client = RedisClient.from_url(config.REDIS_URL)
    connection_manager = ConnectionManager(redis_client)

    # --- Register OAuth Providers Conditionally ---
    if config.GITHUB_CLIENT_ID and config.GITHUB_CLIENT_SECRET:
        oauth.register(
            name='github', client_id=config.GITHUB_CLIENT_ID, client_secret=config.GITHUB_CLIENT_SECRET,
            access_token_url='https://github.com/login/oauth/access_token', authorize_url='https://github.com/login/oauth/authorize',
            api_base_url='https://api.github.com/', client_kwargs={'scope': 'repo user:email'}
        )
        logger.info("GitHub OAuth provider registered.")
    else:
        logger.warning("GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set. GitHub integration will be disabled.")

    if config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET:
        oauth.register(
            name='google', client_id=config.GOOGLE_CLIENT_ID, client_secret=config.GOOGLE_CLIENT_SECRET,
            authorize_url='https://accounts.google.com/o/oauth2/auth', access_token_url='https://accounts.google.com/o/oauth2/token',
            api_base_url='https://www.googleapis.com/oauth2/v1/',
            client_kwargs={'scope': 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive', 'access_type': 'offline', 'prompt': 'consent'}
        )
        logger.info("Google OAuth provider registered.")
    else:
        logger.warning("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. Google integration will be disabled.")

    if config.VERCEL_CLIENT_ID and config.VERCEL_CLIENT_SECRET:
        oauth.register(
            name='vercel', client_id=config.VERCEL_CLIENT_ID, client_secret=config.VERCEL_CLIENT_SECRET,
            access_token_url='https://api.vercel.com/v2/oauth/access_token', authorize_url='https://vercel.com/oauth/authorize',
            api_base_url='https://api.vercel.com/', client_kwargs={'scope': 'users:read teams:read projects:read deployments:read'}
        )
        logger.info("Vercel OAuth provider registered.")
    else:
        logger.warning("VERCEL_CLIENT_ID or VERCEL_CLIENT_SECRET not set. Vercel integration will be disabled.")

    if config.SUPABASE_CLIENT_ID and config.SUPABASE_CLIENT_SECRET:
        oauth.register(
            name='supabase', client_id=config.SUPABASE_CLIENT_ID, client_secret=config.SUPABASE_CLIENT_SECRET,
            access_token_url='https://api.supabase.com/v1/oauth/token', authorize_url='https://api.supabase.com/v1/oauth/authorize',
            api_base_url='https://api.supabase.com/v1/', client_kwargs={'scope': 'organizations:read projects:read'}
        )
        logger.info("Supabase OAuth provider registered.")
    else:
        logger.warning("SUPABASE_CLIENT_ID or SUPABASE_CLIENT_SECRET not set. Supabase integration will be disabled.")

    # ==========================================================================
    # ROUTES AND SOCKET HANDLERS (To be moved to blueprints and handlers module)
    # ==========================================================================
    
    @app.route('/healthz')
    def health_check():
        return "OK", 200

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
                    data={'client_id': config.VERCEL_CLIENT_ID, 'client_secret': config.VERCEL_CLIENT_SECRET, 'code': code, 'redirect_uri': url_for('auth_callback', provider='vercel', _external=True)}
                )
                token_response.raise_for_status()
                token = token_response.json()
                user_info_response = requests.get('https://api.vercel.com/v2/user', headers={'Authorization': f"Bearer {token['access_token']}"})
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
            integration_data = {'user_id': str(user_id), 'service': provider, 'access_token': token.get('access_token'), 'refresh_token': token.get('refresh_token'), 'scopes': token.get('scope', '').split(' ')}
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
        socketio.emit("status", {"message": "Connected to server"}, room=request.sid)

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
            access_token = data.get("accessToken")
            conversation_id = data.get("conversationId")

            if not conversation_id:
                return socketio.emit("error", {"message": "Critical error: conversationId is missing."}, room=sid)
            if not access_token:
                return socketio.emit("error", {"message": "Authentication token is missing.", "reset": True}, room=sid)

            user = supabase_client.auth.get_user(jwt=access_token).user
            if not user:
                raise AuthApiError("User not found for token.", 401)

            if data.get("type") == "terminate_session":
                connection_manager.terminate_session(conversation_id)
                return socketio.emit("status", {"message": f"Session {conversation_id} terminated"}, room=sid)

            if not connection_manager.get_session(conversation_id):
                connection_manager.create_session(conversation_id, str(user.id), data.get("config", {}))

            # Prepare data for the agent runner
            turn_data = {"user_message": data.get("message", ""), "files": data.get("files", [])}
            context_session_ids = data.get("context_session_ids", [])
            message_id = data.get("id") or str(uuid.uuid4())
            browser_tools_config = {'sid': sid, 'socketio': socketio, 'waiting_events': browser_waiting_events}
            custom_tool_config = {'sid': sid, 'socketio': socketio, 'message_id': message_id}

            # Spawn the agent runner in a greenlet, injecting the connection_manager
            eventlet.spawn(
                run_agent_and_stream,
                sid,
                conversation_id,
                message_id,
                turn_data,
                browser_tools_config,
                custom_tool_config,
                context_session_ids,
                connection_manager
            )
            logger.info(f"Spawned agent run for conversation: {conversation_id}")

        except AuthApiError as e:
            logger.error(f"Invalid token for SID {sid}: {e.message}")
            socketio.emit("error", {"message": "Your session has expired. Please log in again.", "reset": True}, room=sid)
        except Exception as e:
            logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
            socketio.emit("error", {"message": "AI service error. Please start a new chat.", "reset": True}, room=sid)

    return app