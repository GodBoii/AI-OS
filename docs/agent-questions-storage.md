# Agent questions and storage

The backend uses Agno 3.1.1 native `ask_user` and `get_user_input` tools. A native
pause becomes a chat question card. Answers resolve the persisted requirements
and continue the same run. Scheduled tasks do not receive interactive question tools.

## Where data lives

| Data | Storage | Code |
|---|---|---|
| Sessions, runs, memories, titles | Ubuntu SQLite, `/srv/aetheria/agent-data/agents.sqlite3` | `python-backend/agno_storage.py` |
| Pending questions and answers | Same SQLite database, `agent_input_requests` | `python-backend/user_questions.py` |
| Uploads, generated images, screenshots | Ubuntu files, `/srv/aetheria/agent-data/media` | `python-backend/local_media.py` |
| User file vault files | Ubuntu `/srv/aetheria/vault` | `python-backend/user_file_vault.py` |
| Usage and subscription totals, vault metadata | Existing Convex deployment | `convex/schema.ts`, `convex/usage.ts`, `convex/vault.ts` |
| Accounts, integrations, tasks, deployment/artifact metadata | New Supabase project | `python-backend/migrations/app_metadata.sql` |

The container mounts `/srv/aetheria/agent-data` at `/data/aetheria`. SQLite uses
WAL mode and a 30-second busy timeout. Media files require signed read/write
URLs. Upload links expire after ten minutes and cannot overwrite existing files.
Question requests expire after 24 hours. An interrupted continuation is marked
failed after its heartbeat is absent for ten minutes; it is not automatically
replayed because tool execution may already have occurred.

No Agno tables or image files are created in Supabase. The app metadata schema
was checked against the root SQL/schema exports and current writes from the
auth, task, subscription, deployment, sandbox-persistence, and push modules.

## Supabase table contracts

| Table | Main callers / important fields |
|---|---|
| `profiles` | Auth signup and subscription service; identity, email, name, phone, plan/status, Razorpay IDs, period end |
| `user_integrations` | Auth callbacks and connected tools; user/service, tokens, scopes, timestamps |
| `tasks` | Task tools, desktop task UI, poller; text/description, priority/status, deadline, tags, work output, metadata |
| `attachment` | Desktop attachment metadata; user/session, metadata, timestamp |
| `session_content` | Content registry; user/session, type/reference ID, message ID, metadata |
| `sandbox_executions` | Execution persistence; command/status, timing, exit code, log keys and sizes |
| `sandbox_artifacts` | Artifact persistence; execution/user, file path/type, object reference, size/MIME, metadata |
| `sandbox_snapshots` | Workspace snapshots; user/session/sandbox, object key, size/hash, snapshot type |
| `platform_sites` | Deployment platform; owner, project name, slug/status, timestamps |
| `platform_deployments` | Versioned deployment records; site/version, object prefix, build/status, activation time |
| `platform_domains` | Site domains; hostname/site, primary flag, SSL status |
| `platform_site_databases` | Site database configuration; site, Turso identifiers, encrypted tokens |
| `user_push_tokens` | Push notification service; user/device/platform, FCM token, active/version, timestamps |

All hosted metadata tables have RLS enabled. Service-role grants support backend
operations. Authenticated clients cannot update profile billing fields.
`request_logs` and the old hosted file-vault table are replaced by Convex in the
current application. Session titles and Agno memory endpoints use local storage.

## Configuration and deployment

Backend secrets remain in ignored `python-backend/.env`. Public desktop settings
are read from ignored `js/runtime-config.json`, which must be included when
building/distributing the app. It contains only the project URL and publishable key.
`MEDIA_SIGNING_KEY` must remain stable across backend restarts.

For the existing Ubuntu installation:

```sh
docker compose -f docker-compose.yml -f docker-compose.server.yml -f docker-compose.agent.yml up -d --no-build web flower
docker exec aios-web python migrations/upgrade_agno.py
```

`Dockerfile.agent-upgrade` builds on the existing `ai-os-web:latest` runtime.
For a fresh installation, build the normal Dockerfile with the updated canonical
`python-backend/requirements.txt` instead. The initializer only creates local
storage tables; it never runs a hosted legacy-history migration.

The new Supabase project has separate accounts. Users must sign in or sign up
there and reconnect their external integrations. No old images/history are imported.

Back up the SQLite database through Python's `sqlite3.Connection.backup()` API,
then back up the media directory. Do not copy an active SQLite database file
without accounting for its WAL.

## Verification

`test_user_questions.py` exercises real Agno pause/reload/continue flows, including
delegated members and multiple question rounds. `test_local_agent_storage.py`
checks ownership, competing submissions, expiry/cancellation, media writes, and
incremental usage. `verify_question_flow.py` uses real Supabase auth plus real
Flask/Socket.IO and a scripted model transport, including reconnect and plan mode.
`js/tests/question-cards-browser.test.js` exercises the actual card module in Chrome.
