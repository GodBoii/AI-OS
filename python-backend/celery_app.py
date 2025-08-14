# python-backend/celery_app.py

import os
from celery import Celery
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Define the Celery application instance.
# This will be the single source of truth for Celery configuration.
celery = Celery(
    "tasks",  # The name of the main module where tasks are defined.
    broker=os.getenv("REDIS_URL"),
    backend=os.getenv("REDIS_URL"),
    include=["tasks"]  # Explicitly tell Celery where to find the tasks.
)

# Optional: Add any global Celery configuration here if needed in the future.
# celery.conf.update(
#     task_serializer='json',
#     accept_content=['json'],
#     result_serializer='json',
#     timezone='UTC',
#     enable_utc=True,
# )