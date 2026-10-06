-- App metadata only. Native agent history and media live on the Ubuntu server.

-- Generated from supabase-table-schema.json
-- Schema-only migration for public tables, constraints, indexes, RLS, and policies.
-- Run this in the NEW Supabase project SQL editor.
-- Not included: table row data, auth users, storage files, storage bucket config, edge functions, secrets, cron jobs, and SQL function bodies other than update_tasks_updated_at().

create extension if not exists "uuid-ossp";

create table if not exists public."attachment" (
  "id" uuid default uuid_generate_v4() not null,
  "created_at" timestamptz default now() not null,
  "session_id" text not null,
  "user_id" uuid not null,
  "metadata" jsonb not null
);

create table if not exists public."platform_deployments" (
  "id" uuid not null,
  "site_id" uuid not null,
  "version" integer not null,
  "r2_prefix" text not null,
  "status" text default 'queued'::text not null,
  "build_meta" jsonb default '{}'::jsonb not null,
  "created_at" timestamptz default now() not null,
  "activated_at" timestamptz
);

create table if not exists public."platform_domains" (
  "id" uuid not null,
  "site_id" uuid not null,
  "hostname" text not null,
  "is_primary" boolean default true not null,
  "ssl_status" text default 'active'::text not null,
  "created_at" timestamptz default now() not null
);

create table if not exists public."platform_site_databases" (
  "id" uuid not null,
  "site_id" uuid not null,
  "turso_org_slug" text not null,
  "turso_group" text not null,
  "turso_db_name" text not null,
  "turso_db_hostname" text not null,
  "encrypted_admin_token" text not null,
  "encrypted_rw_token" text not null,
  "encrypted_ro_token" text,
  "created_at" timestamptz default now() not null,
  "rotated_at" timestamptz
);

create table if not exists public."platform_sites" (
  "id" uuid not null,
  "user_id" uuid not null,
  "project_name" text not null,
  "slug" text not null,
  "status" text default 'draft'::text not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null
);

create table if not exists public."profiles" (
  "id" uuid not null,
  "email" text not null,
  "name" text,
  "updated_at" timestamptz default now(),
  "created_at" timestamptz default now(),
  "plan_type" text default 'free'::text,
  "subscription_status" text default 'none'::text,
  "razorpay_customer_id" text,
  "razorpay_subscription_id" text,
  "current_period_end" timestamptz,
  "phone_number" text
);

create table if not exists public."sandbox_artifacts" (
  "artifact_id" uuid default uuid_generate_v4() not null,
  "execution_id" uuid not null,
  "user_id" uuid not null,
  "artifact_type" varchar not null,
  "file_path" text,
  "r2_key" text not null,
  "size_bytes" bigint default 0,
  "mime_type" varchar,
  "checksum" varchar(64),
  "created_at" timestamptz default now() not null,
  "metadata" jsonb default '{}'::jsonb
);

create table if not exists public."sandbox_executions" (
  "execution_id" uuid default uuid_generate_v4() not null,
  "user_id" uuid not null,
  "session_id" varchar not null,
  "sandbox_id" varchar not null,
  "message_id" varchar,
  "command" text not null,
  "exit_code" integer,
  "status" varchar default 'RUNNING'::character varying not null,
  "stdout_key" text,
  "stderr_key" text,
  "stdout_size" bigint default 0,
  "stderr_size" bigint default 0,
  "stdout_checksum" varchar(64),
  "stderr_checksum" varchar(64),
  "started_at" timestamptz default now() not null,
  "finished_at" timestamptz,
  "created_at" timestamptz default now() not null,
  "metadata" jsonb default '{}'::jsonb
);

create table if not exists public."sandbox_snapshots" (
  "snapshot_id" uuid default uuid_generate_v4() not null,
  "user_id" uuid not null,
  "session_id" varchar not null,
  "sandbox_id" varchar not null,
  "manifest_key" text not null,
  "snapshot_type" varchar default 'manual'::character varying not null,
  "total_files" integer default 0,
  "total_size_bytes" bigint default 0,
  "created_at" timestamptz default now() not null,
  "metadata" jsonb default '{}'::jsonb
);

create table if not exists public."session_content" (
  "id" uuid default uuid_generate_v4() not null,
  "session_id" text not null,
  "user_id" uuid not null,
  "content_type" varchar(50) not null,
  "reference_id" uuid not null,
  "message_id" text,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamptz default now() not null
);

create table if not exists public."tasks" (
  "id" uuid default uuid_generate_v4() not null,
  "user_id" uuid not null,
  "session_id" varchar,
  "text" text not null,
  "description" text,
  "priority" varchar default 'medium'::character varying,
  "status" varchar default 'pending'::character varying,
  "deadline" timestamptz,
  "tags" text[],
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  "completed_at" timestamptz,
  "metadata" jsonb default '{}'::jsonb,
  "task_work" text
);

create table if not exists public."user_integrations" (
  "id" uuid default uuid_generate_v4() not null,
  "user_id" uuid not null,
  "service" text not null,
  "access_token" text not null,
  "refresh_token" text,
  "scopes" text[],
  "expires_at" timestamptz,
  "created_at" timestamptz default now() not null
);

alter table public."attachment" drop constraint if exists "attachment_session_id_idx";

alter table public."attachment" add constraint "attachment_session_id_idx" PRIMARY KEY (id);

alter table public."platform_deployments" drop constraint if exists "platform_deployments_pkey";

alter table public."platform_deployments" add constraint "platform_deployments_pkey" PRIMARY KEY (id);

alter table public."platform_domains" drop constraint if exists "platform_domains_hostname_key";

alter table public."platform_domains" add constraint "platform_domains_hostname_key" UNIQUE (hostname);

alter table public."platform_domains" drop constraint if exists "platform_domains_pkey";

alter table public."platform_domains" add constraint "platform_domains_pkey" PRIMARY KEY (id);

alter table public."platform_site_databases" drop constraint if exists "platform_site_databases_pkey";

alter table public."platform_site_databases" add constraint "platform_site_databases_pkey" PRIMARY KEY (id);

alter table public."platform_site_databases" drop constraint if exists "platform_site_databases_site_id_key";

alter table public."platform_site_databases" add constraint "platform_site_databases_site_id_key" UNIQUE (site_id);

alter table public."platform_site_databases" drop constraint if exists "platform_site_databases_turso_db_name_key";

alter table public."platform_site_databases" add constraint "platform_site_databases_turso_db_name_key" UNIQUE (turso_db_name);

alter table public."platform_sites" drop constraint if exists "platform_sites_pkey";

alter table public."platform_sites" add constraint "platform_sites_pkey" PRIMARY KEY (id);

alter table public."platform_sites" drop constraint if exists "platform_sites_slug_key";

alter table public."platform_sites" add constraint "platform_sites_slug_key" UNIQUE (slug);

alter table public."profiles" drop constraint if exists "profiles_pkey";

alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);

alter table public."sandbox_artifacts" drop constraint if exists "sandbox_artifacts_pkey";

alter table public."sandbox_artifacts" add constraint "sandbox_artifacts_pkey" PRIMARY KEY (artifact_id);

alter table public."sandbox_executions" drop constraint if exists "sandbox_executions_pkey";

alter table public."sandbox_executions" add constraint "sandbox_executions_pkey" PRIMARY KEY (execution_id);

alter table public."sandbox_snapshots" drop constraint if exists "sandbox_snapshots_pkey";

alter table public."sandbox_snapshots" add constraint "sandbox_snapshots_pkey" PRIMARY KEY (snapshot_id);

alter table public."session_content" drop constraint if exists "session_content_content_type_check";

alter table public."session_content" add constraint "session_content_content_type_check" CHECK (((content_type)::text = ANY ((ARRAY['artifact'::character varying, 'execution'::character varying, 'upload'::character varying])::text[])));

alter table public."session_content" drop constraint if exists "session_content_pkey";

alter table public."session_content" add constraint "session_content_pkey" PRIMARY KEY (id);

alter table public."session_content" drop constraint if exists "unique_session_content";

alter table public."session_content" add constraint "unique_session_content" UNIQUE (session_id, content_type, reference_id);

alter table public."tasks" drop constraint if exists "tasks_pkey";

alter table public."tasks" add constraint "tasks_pkey" PRIMARY KEY (id);

alter table public."tasks" drop constraint if exists "tasks_priority_check";

alter table public."tasks" add constraint "tasks_priority_check" CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying])::text[])));

alter table public."tasks" drop constraint if exists "tasks_status_check";

alter table public."tasks" add constraint "tasks_status_check" CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])));

alter table public."user_integrations" drop constraint if exists "user_integrations_pkey";

alter table public."user_integrations" add constraint "user_integrations_pkey" PRIMARY KEY (id);

alter table public."attachment" drop constraint if exists "attachment_user_id_fkey";

alter table public."attachment" add constraint "attachment_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."platform_deployments" drop constraint if exists "platform_deployments_site_id_fkey";

alter table public."platform_deployments" add constraint "platform_deployments_site_id_fkey" FOREIGN KEY (site_id) REFERENCES platform_sites(id) ON DELETE CASCADE;

alter table public."platform_domains" drop constraint if exists "platform_domains_site_id_fkey";

alter table public."platform_domains" add constraint "platform_domains_site_id_fkey" FOREIGN KEY (site_id) REFERENCES platform_sites(id) ON DELETE CASCADE;

alter table public."platform_site_databases" drop constraint if exists "platform_site_databases_site_id_fkey";

alter table public."platform_site_databases" add constraint "platform_site_databases_site_id_fkey" FOREIGN KEY (site_id) REFERENCES platform_sites(id) ON DELETE CASCADE;

alter table public."profiles" drop constraint if exists "profiles_id_fkey";

alter table public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."sandbox_artifacts" drop constraint if exists "sandbox_artifacts_execution_id_fkey";

alter table public."sandbox_artifacts" add constraint "sandbox_artifacts_execution_id_fkey" FOREIGN KEY (execution_id) REFERENCES sandbox_executions(execution_id) ON DELETE CASCADE;

alter table public."sandbox_artifacts" drop constraint if exists "sandbox_artifacts_user_id_fkey";

alter table public."sandbox_artifacts" add constraint "sandbox_artifacts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."sandbox_executions" drop constraint if exists "sandbox_executions_user_id_fkey";

alter table public."sandbox_executions" add constraint "sandbox_executions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."sandbox_snapshots" drop constraint if exists "sandbox_snapshots_user_id_fkey";

alter table public."sandbox_snapshots" add constraint "sandbox_snapshots_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."session_content" drop constraint if exists "session_content_user_id_fkey";

alter table public."session_content" add constraint "session_content_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."tasks" drop constraint if exists "tasks_user_id_fkey";

alter table public."tasks" add constraint "tasks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."user_integrations" drop constraint if exists "user_integrations_user_id_fkey";

alter table public."user_integrations" add constraint "user_integrations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

drop index if exists public."idx_attachment_created_at";

CREATE INDEX idx_attachment_created_at ON public.attachment USING btree (created_at DESC);

drop index if exists public."idx_attachment_session_id";

CREATE INDEX idx_attachment_session_id ON public.attachment USING btree (session_id);

drop index if exists public."idx_attachment_user_id";

CREATE INDEX idx_attachment_user_id ON public.attachment USING btree (user_id);

drop index if exists public."uniq_site_version";

CREATE UNIQUE INDEX uniq_site_version ON public.platform_deployments USING btree (site_id, version);

drop index if exists public."profiles_phone_number_unique_idx";

CREATE UNIQUE INDEX profiles_phone_number_unique_idx ON public.profiles USING btree (phone_number) WHERE (phone_number IS NOT NULL);

drop index if exists public."idx_sandbox_artifacts_created_at";

CREATE INDEX idx_sandbox_artifacts_created_at ON public.sandbox_artifacts USING btree (created_at DESC);

drop index if exists public."idx_sandbox_artifacts_execution_id";

CREATE INDEX idx_sandbox_artifacts_execution_id ON public.sandbox_artifacts USING btree (execution_id);

drop index if exists public."idx_sandbox_artifacts_user_id";

CREATE INDEX idx_sandbox_artifacts_user_id ON public.sandbox_artifacts USING btree (user_id);

drop index if exists public."idx_sandbox_executions_created_at";

CREATE INDEX idx_sandbox_executions_created_at ON public.sandbox_executions USING btree (created_at DESC);

drop index if exists public."idx_sandbox_executions_message_id";

CREATE INDEX idx_sandbox_executions_message_id ON public.sandbox_executions USING btree (message_id);

drop index if exists public."idx_sandbox_executions_sandbox_id";

CREATE INDEX idx_sandbox_executions_sandbox_id ON public.sandbox_executions USING btree (sandbox_id);

drop index if exists public."idx_sandbox_executions_session_id";

CREATE INDEX idx_sandbox_executions_session_id ON public.sandbox_executions USING btree (session_id);

drop index if exists public."idx_sandbox_executions_status";

CREATE INDEX idx_sandbox_executions_status ON public.sandbox_executions USING btree (status);

drop index if exists public."idx_sandbox_executions_user_id";

CREATE INDEX idx_sandbox_executions_user_id ON public.sandbox_executions USING btree (user_id);

drop index if exists public."idx_sandbox_snapshots_created_at";

CREATE INDEX idx_sandbox_snapshots_created_at ON public.sandbox_snapshots USING btree (created_at DESC);

drop index if exists public."idx_sandbox_snapshots_sandbox_id";

CREATE INDEX idx_sandbox_snapshots_sandbox_id ON public.sandbox_snapshots USING btree (sandbox_id);

drop index if exists public."idx_sandbox_snapshots_session_id";

CREATE INDEX idx_sandbox_snapshots_session_id ON public.sandbox_snapshots USING btree (session_id);

drop index if exists public."idx_sandbox_snapshots_user_id";

CREATE INDEX idx_sandbox_snapshots_user_id ON public.sandbox_snapshots USING btree (user_id);

drop index if exists public."idx_session_content_created_at";

CREATE INDEX idx_session_content_created_at ON public.session_content USING btree (created_at DESC);

drop index if exists public."idx_session_content_message_id";

CREATE INDEX idx_session_content_message_id ON public.session_content USING btree (message_id);

drop index if exists public."idx_session_content_reference_id";

CREATE INDEX idx_session_content_reference_id ON public.session_content USING btree (reference_id);

drop index if exists public."idx_session_content_session_id";

CREATE INDEX idx_session_content_session_id ON public.session_content USING btree (session_id);

drop index if exists public."idx_session_content_type";

CREATE INDEX idx_session_content_type ON public.session_content USING btree (content_type);

drop index if exists public."idx_session_content_user_id";

CREATE INDEX idx_session_content_user_id ON public.session_content USING btree (user_id);

drop index if exists public."idx_tasks_created_at";

CREATE INDEX idx_tasks_created_at ON public.tasks USING btree (created_at DESC);

drop index if exists public."idx_tasks_deadline";

CREATE INDEX idx_tasks_deadline ON public.tasks USING btree (deadline);

drop index if exists public."idx_tasks_session_id";

CREATE INDEX idx_tasks_session_id ON public.tasks USING btree (session_id);

drop index if exists public."idx_tasks_status";

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);

drop index if exists public."idx_tasks_user_id";

CREATE INDEX idx_tasks_user_id ON public.tasks USING btree (user_id);

alter table public."attachment" enable row level security;

alter table public."platform_deployments" enable row level security;

alter table public."platform_domains" enable row level security;

alter table public."platform_site_databases" enable row level security;

alter table public."platform_sites" enable row level security;

alter table public."profiles" enable row level security;

alter table public."sandbox_artifacts" enable row level security;

alter table public."sandbox_executions" enable row level security;

alter table public."sandbox_snapshots" enable row level security;

alter table public."session_content" enable row level security;

alter table public."tasks" enable row level security;

alter table public."user_integrations" enable row level security;

drop policy if exists "Users can create their own attachments" on public."attachment";

create policy "Users can create their own attachments" on public."attachment" as PERMISSIVE for INSERT to "public" with check ((auth.uid() = user_id));

drop policy if exists "Users can delete their own attachments" on public."attachment";

create policy "Users can delete their own attachments" on public."attachment" as PERMISSIVE for DELETE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can read their own attachments" on public."attachment";

create policy "Users can read their own attachments" on public."attachment" as PERMISSIVE for SELECT to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can update their own profile" on public."profiles";

create policy "Users can update their own profile" on public."profiles" as PERMISSIVE for UPDATE to "public" using ((auth.uid() = id));

drop policy if exists "Users can view their own profile" on public."profiles";

create policy "Users can view their own profile" on public."profiles" as PERMISSIVE for SELECT to "public" using ((auth.uid() = id));

drop policy if exists "Users can delete their own artifacts" on public."sandbox_artifacts";

create policy "Users can delete their own artifacts" on public."sandbox_artifacts" as PERMISSIVE for DELETE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can insert their own artifacts" on public."sandbox_artifacts";

create policy "Users can insert their own artifacts" on public."sandbox_artifacts" as PERMISSIVE for INSERT to "public" with check ((auth.uid() = user_id));

drop policy if exists "Users can view their own artifacts" on public."sandbox_artifacts";

create policy "Users can view their own artifacts" on public."sandbox_artifacts" as PERMISSIVE for SELECT to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can delete their own executions" on public."sandbox_executions";

create policy "Users can delete their own executions" on public."sandbox_executions" as PERMISSIVE for DELETE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can insert their own executions" on public."sandbox_executions";

create policy "Users can insert their own executions" on public."sandbox_executions" as PERMISSIVE for INSERT to "public" with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own executions" on public."sandbox_executions";

create policy "Users can update their own executions" on public."sandbox_executions" as PERMISSIVE for UPDATE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can view their own executions" on public."sandbox_executions";

create policy "Users can view their own executions" on public."sandbox_executions" as PERMISSIVE for SELECT to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can delete their own snapshots" on public."sandbox_snapshots";

create policy "Users can delete their own snapshots" on public."sandbox_snapshots" as PERMISSIVE for DELETE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can insert their own snapshots" on public."sandbox_snapshots";

create policy "Users can insert their own snapshots" on public."sandbox_snapshots" as PERMISSIVE for INSERT to "public" with check ((auth.uid() = user_id));

drop policy if exists "Users can view their own snapshots" on public."sandbox_snapshots";

create policy "Users can view their own snapshots" on public."sandbox_snapshots" as PERMISSIVE for SELECT to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can delete their own session content" on public."session_content";

create policy "Users can delete their own session content" on public."session_content" as PERMISSIVE for DELETE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can insert their own session content" on public."session_content";

create policy "Users can insert their own session content" on public."session_content" as PERMISSIVE for INSERT to "public" with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own session content" on public."session_content";

create policy "Users can update their own session content" on public."session_content" as PERMISSIVE for UPDATE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can view their own session content" on public."session_content";

create policy "Users can view their own session content" on public."session_content" as PERMISSIVE for SELECT to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can delete their own tasks" on public."tasks";

create policy "Users can delete their own tasks" on public."tasks" as PERMISSIVE for DELETE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can insert their own tasks" on public."tasks";

create policy "Users can insert their own tasks" on public."tasks" as PERMISSIVE for INSERT to "public" with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own tasks" on public."tasks";

create policy "Users can update their own tasks" on public."tasks" as PERMISSIVE for UPDATE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can view their own tasks" on public."tasks";

create policy "Users can view their own tasks" on public."tasks" as PERMISSIVE for SELECT to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can delete their own integrations" on public."user_integrations";

create policy "Users can delete their own integrations" on public."user_integrations" as PERMISSIVE for DELETE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can insert their own integrations" on public."user_integrations";

create policy "Users can insert their own integrations" on public."user_integrations" as PERMISSIVE for INSERT to "public" with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own integrations" on public."user_integrations";

create policy "Users can update their own integrations" on public."user_integrations" as PERMISSIVE for UPDATE to "public" using ((auth.uid() = user_id));

drop policy if exists "Users can view their own integrations" on public."user_integrations";

create policy "Users can view their own integrations" on public."user_integrations" as PERMISSIVE for SELECT to "public" using ((auth.uid() = user_id));

create or replace function public.update_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_updated_at_trigger on public.tasks;

create trigger tasks_updated_at_trigger
before update on public.tasks
for each row
execute function public.update_tasks_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id,email,name,phone_number)
  VALUES (new.id,coalesce(new.email,''),new.raw_user_meta_data->>'name',new.raw_user_meta_data->>'phone_number')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL, platform text NOT NULL DEFAULT 'android', fcm_token text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, app_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,device_id,platform)
);
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_owns_push_tokens ON public.user_push_tokens;
CREATE POLICY user_owns_push_tokens ON public.user_push_tokens FOR ALL TO authenticated
USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);

-- Supabase's Data API needs SQL privileges as well as RLS policies.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.attachment,public.platform_deployments,
  public.platform_domains,public.platform_site_databases,public.platform_sites,
  public.sandbox_artifacts,public.sandbox_executions,public.sandbox_snapshots,
  public.session_content,public.tasks,public.user_integrations,public.user_push_tokens TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE(name,phone_number,updated_at) ON public.profiles TO authenticated;
