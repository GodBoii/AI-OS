# supabase_client.py

import os
import supabase
from dotenv import load_dotenv

load_dotenv()

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_KEY")
database_url = os.getenv("DATABASE_URL")

if not supabase_url or not supabase_key:
    raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")

supabase_client = supabase.create_client(supabase_url, supabase_key)