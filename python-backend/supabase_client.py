# supabase_client.py (With Diagnostic Logging)

import os
import supabase
from dotenv import load_dotenv
import logging

logger = logging.getLogger(__name__)
load_dotenv()

# --- CRITICAL FIX: Use the SERVICE_ROLE KEY for backend operations ---
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_KEY")
database_url = os.getenv("DATABASE_URL") # Get the full database URL for Agno

# --- DIAGNOSTIC LOGGING ---
# This will print the exact connection details the application is using at startup.
print("--- DATABASE CONNECTION DIAGNOSTICS ---")
print(f"[INFO] SUPABASE_URL: {supabase_url}")
print(f"[INFO] DATABASE_URL for Agno: {database_url}")
if not supabase_url or not supabase_key or not database_url:
    print("[ERROR] One or more critical database environment variables are MISSING.")
    raise ValueError("SUPABASE_URL, SUPABASE_SERVICE_KEY, and DATABASE_URL must be set.")
print("------------------------------------")
# --- END DIAGNOSTIC LOGGING ---

logger.info(f"Initializing Supabase client with URL: {supabase_url}")
supabase_client = supabase.create_client(supabase_url, supabase_key)