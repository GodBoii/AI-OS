# python-backend/clients.py

import os
import supabase
import redis
from dotenv import load_dotenv
import logging

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger(__name__)

# --- Supabase Client Initialization ---
supabase_url = os.getenv("SUPABASE_URL")
# CRITICAL: Use the SERVICE_ROLE KEY for backend operations
supabase_key = os.getenv("SUPABASE_SERVICE_KEY")

if not supabase_url or not supabase_key:
    raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in your environment.")

logger.info(f"Initializing Supabase client with URL: {supabase_url}")
supabase_client = supabase.create_client(supabase_url, supabase_key)


# --- Redis Client Initialization ---
redis_url = os.getenv("REDIS_URL")
if not redis_url:
    raise ValueError("REDIS_URL must be set in your environment.")

logger.info(f"Initializing Redis client with URL: {redis_url}")
redis_client = redis.from_url(redis_url)