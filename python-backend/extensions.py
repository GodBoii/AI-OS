# python-backend/extensions.py

from flask_socketio import SocketIO
from authlib.integrations.flask_client import OAuth
import redis

# Import the pre-configured Celery app instance instead of creating a new one.
# We import it `as celery` so that other parts of the application that
# were importing `celery` from this file do not need to change.
from celery_app import celery_app as celery

# --- Extension Instantiation ---
# These objects are created here in an uninitialized state or imported
# pre-configured. They will be linked to the Flask app in the factory.

# SocketIO: Uninitialized, will be configured in the factory.
socketio = SocketIO(cors_allowed_origins="*", async_mode="eventlet")

# OAuth: Uninitialized, will be configured in the factory.
oauth = OAuth()

# Redis: We export the class itself for the factory to instantiate.
RedisClient = redis.Redis
