-- =================================================================
-- AI-OS DATABASE SCHEMA - SOURCE OF TRUTH
-- =================================================================
-- This file contains the final, correct SQL scripts for setting up the database.
-- It includes tables for user profiles, transactional request logging,
-- and the tables used by the 'agno' agent framework.
-- This single file can be used to set up a new database instance from scratch.

-- =================================================================
-- SECTION 1: USER PROFILES
-- Handles storing additional user data, linked to the authentication system.
-- =================================================================

-- Create a table to store public user profile data.
-- This table is linked to the private `auth.users` table via a foreign key.
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS 'Stores public profile information for each user, linked to auth.users.';

-- Create a function that will be triggered upon new user creation.
-- This automates the process of creating a profile entry for every new user.
CREATE OR REPLACE FUNCTION public.create_profile_for_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert a new row into public.profiles, copying the id, email,
  -- and the 'name' from the user's metadata provided during signup.
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger that executes the function after a new user is inserted into auth.users.
CREATE TRIGGER create_profile_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.create_profile_for_user();


-- =================================================================
-- SECTION 2: TRANSACTIONAL USAGE TRACKING
-- A robust system to log every token-consuming request for analytics.
-- =================================================================

-- Create the table to store a log of every individual request.
CREATE TABLE public.request_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    -- This generated column automatically calculates the total, which is efficient for queries.
    total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED
);

COMMENT ON TABLE public.request_logs IS 'Stores a log of every individual token-consuming request for historical analysis.';
COMMENT ON COLUMN public.request_logs.user_id IS 'The user who made the request.';
COMMENT ON COLUMN public.request_logs.input_tokens IS 'Tokens used in the prompt for this specific request.';
COMMENT ON COLUMN public.request_logs.output_tokens IS 'Tokens generated in the response for this specific request.';

-- Create indexes for fast querying, especially for filtering by user and date.
CREATE INDEX request_logs_user_id_idx ON public.request_logs(user_id);
CREATE INDEX request_logs_created_at_idx ON public.request_logs(created_at);

-- Enable Row Level Security (RLS) on the table to protect user data.
ALTER TABLE public.request_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy 1: Allow users to read (SELECT) their OWN logs.
-- This is essential for any frontend dashboard features where a user views their own usage.
CREATE POLICY "Allow users to select their own request logs"
ON public.request_logs FOR SELECT
USING (auth.uid() = user_id);

-- RLS Policy 2: Allow the backend (using the 'service_role' key) to insert logs for ANY user.
-- This is the primary mechanism for the Python backend to write usage data.
CREATE POLICY "Allow service role to insert logs"
ON public.request_logs FOR INSERT
WITH CHECK (auth.role() = 'service_role');


-- =================================================================
-- SECTION 3: AGENT FRAMEWORK STORAGE (Managed by Agno)
-- Tables required for the 'agno' library to persist agent memory and session history.
-- =================================================================

-- 3.1. Long-Term Memory (agent_memories)
-- This table stores individual, "atomic" facts about a user, making them easily searchable.
-- It is managed by the `agno.memory.v2.db.postgres.PostgresMemoryDb` class.
-- We create this table manually to ensure the schema is correct.
CREATE TABLE public.agent_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    memory JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE public.agent_memories IS 'Stores individual, structured, long-term memories for the agent. Managed by Agno PostgresMemoryDb.';


-- 3.2. Session History (ai_os_sessions)
-- This table stores the full JSON history of each conversation for review.
-- It is managed by the `agno.storage.postgres.PostgresStorage` class.
--
-- !!! IMPORTANT !!!
-- It is highly recommended to let `agno` create this table automatically.
-- The Python code is configured with `auto_upgrade_schema=True` for this purpose.
-- DO NOT RUN THE FOLLOWING SQL MANUALLY. It is provided for reference only.
/*
CREATE TABLE public.ai_os_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT,
    agent_id TEXT,
    team_session_id TEXT,
    memory JSONB,
    agent_data JSONB,
    session_data JSONB,
    extra_data JSONB,
    created_at BIGINT,
    updated_at BIGINT
);

COMMENT ON TABLE public.ai_os_sessions IS 'Stores the full JSON history of each conversation. Managed by Agno PostgresStorage.';
*/


-- =================================================================
-- SECTION 4: USER SERVICE INTEGRATIONS
-- Handles storing OAuth tokens for third-party services like GitHub and Google.
-- =================================================================

-- Create the table to store connection details for third-party services.
CREATE TABLE public.user_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scopes TEXT[],
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A user should only have one integration per service.
  CONSTRAINT user_integrations_user_id_service_key UNIQUE (user_id, service)
);

-- Add comments to the table and columns for clarity.
COMMENT ON TABLE public.user_integrations IS 'Stores OAuth tokens and connection data for third-party services linked to a user.';
COMMENT ON COLUMN public.user_integrations.user_id IS 'The user who owns this integration.';
COMMENT ON COLUMN public.user_integrations.service IS 'The name of the third-party service (e.g., "github", "google").';
COMMENT ON COLUMN public.user_integrations.access_token IS 'The OAuth access token for API calls. Stored in plain text.';
COMMENT ON COLUMN public.user_integrations.scopes IS 'Array of permissions granted by the user.';
COMMENT ON COLUMN public.user_integrations.expires_at IS 'The timestamp when the access token expires.';


-- Create indexes for faster lookups based on user_id and service.
CREATE INDEX user_integrations_user_id_idx ON public.user_integrations(user_id);
CREATE INDEX user_integrations_user_id_service_idx ON public.user_integrations(user_id, service);


-- Enable Row Level Security (RLS) to protect the sensitive tokens.
ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

-- RLS Policy 1: Allow users to read (SELECT) their OWN integration records.
-- This is useful for the frontend to check connection status.
CREATE POLICY "Allow users to select their own integrations"
ON public.user_integrations FOR SELECT
USING (auth.uid() = user_id);

-- RLS Policy 2: Allow the backend (using the 'service_role' key) to perform all actions.
-- This is required for the backend to create, read, update, and delete tokens.
CREATE POLICY "Allow service role full access"
ON public.user_integrations FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');


-- =================================================================
-- SECTION 5: DEPRECATION AND CLEANUP
-- SQL commands to remove the old, cumulative usage tracking system.
-- =================================================================

-- WARNING: Do not run these commands until you have deployed the new application
-- and have confirmed that data is correctly appearing in the new `request_logs` table.
-- It is highly recommended to back up data first and wait a few days before dropping tables.

/*
-- 1. Drop the old RPC function, as it's no longer called by the backend.
DROP FUNCTION IF EXISTS public.update_usage_metrics(uuid, integer, integer);

-- 2. Drop the trigger that creates an entry in the old usage_metrics table for new users.
DROP TRIGGER IF EXISTS create_usage_metrics_on_signup ON auth.users;

-- 3. Drop the function associated with the trigger.
DROP FUNCTION IF EXISTS public.create_usage_metrics_for_user();

-- 4. Finally, drop the old table.
DROP TABLE IF EXISTS public.usage_metrics;
*/