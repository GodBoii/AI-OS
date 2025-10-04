# python-backend/factory.py (Corrected Version)

import logging
from flask import Flask

# --- Local Module Imports ---
import config
from extensions import socketio, oauth, RedisClient

# --- Service Layer Imports ---
from session_service import ConnectionManager

# --- Route and Handler Registration Imports ---
from auth import auth_bp
from api import api_bp
# We now import the sockets module itself and a setter function
import sockets 

logger = logging.getLogger(__name__)

# ==============================================================================
# APPLICATION FACTORY
# ==============================================================================

def create_app():
    """
    Creates and configures the Flask application and its extensions.
    """
    app = Flask(__name__)
    app.secret_key = config.FLASK_SECRET_KEY

    # --- 1. Initialize Extensions ---
    socketio.init_app(app, message_queue=config.REDIS_URL)
    oauth.init_app(app)
    
    # --- 2. Instantiate Services ---
    redis_client = RedisClient.from_url(config.REDIS_URL)
    connection_manager = ConnectionManager(redis_client)

    # --- 3. Inject Dependencies into Modules ---
    # This is the crucial step. We pass the created service instances
    # to the modules that need them before the first request.
    sockets.set_connection_manager(connection_manager)

    # --- 4. Register OAuth Providers ---
    # (This section is unchanged)
    if config.GITHUB_CLIENT_ID and config.GITHUB_CLIENT_SECRET:
        oauth.register(...)
        logger.info("GitHub OAuth provider registered.")
    # ... (rest of the OAuth registrations) ...
    if config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET:
        oauth.register(
            name='google', client_id=config.GOOGLE_CLIENT_ID, client_secret=config.GOOGLE_CLIENT_SECRET,
            authorize_url='https://accounts.google.com/o/oauth2/auth', access_token_url='https://accounts.google.com/o/oauth2/token',
            api_base_url='https://www.googleapis.com/oauth2/v1/',
            client_kwargs={'scope': 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive', 'access_type': 'offline', 'prompt': 'consent'}
        )
        logger.info("Google OAuth provider registered.")
    else:
        logger.warning("Google OAuth credentials not set. Google integration will be disabled.")
    if config.VERCEL_CLIENT_ID and config.VERCEL_CLIENT_SECRET:
        oauth.register(
            name='vercel', client_id=config.VERCEL_CLIENT_ID, client_secret=config.VERCEL_CLIENT_SECRET,
            access_token_url='https://api.vercel.com/v2/oauth/access_token', authorize_url='https://vercel.com/oauth/authorize',
            api_base_url='https://api.vercel.com/', client_kwargs={'scope': 'users:read teams:read projects:read deployments:read'}
        )
        logger.info("Vercel OAuth provider registered.")
    else:
        logger.warning("Vercel OAuth credentials not set. Vercel integration will be disabled.")
    if config.SUPABASE_CLIENT_ID and config.SUPABASE_CLIENT_SECRET:
        oauth.register(
            name='supabase', client_id=config.SUPABASE_CLIENT_ID, client_secret=config.SUPABASE_CLIENT_SECRET,
            access_token_url='https://api.supabase.com/v1/oauth/token', authorize_url='https://api.supabase.com/v1/oauth/authorize',
            api_base_url='https://api.supabase.com/v1/', client_kwargs={'scope': 'organizations:read projects:read'}
        )
        logger.info("Supabase OAuth provider registered.")
    else:
        logger.warning("Supabase OAuth credentials not set. Supabase integration will be disabled.")


    # --- 5. Register Blueprints (HTTP Routes) ---
    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp)

    # The socket handlers are now registered automatically when the `sockets`
    # module is imported, because they use the decorator syntax.

    return app