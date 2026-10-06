# Deployment verification, 7 October 2026

The backend uses Supabase project `ffhamooermdvdcseveam`. The server's private
`python-backend/.env` has mode 600. Both web and worker containers use its current
Supabase, database, Google, Convex, R2, and media-signing credentials. No old
Supabase project reference remains in their running environments.

Both services run Agno 3.1.1 and mount `/srv/aetheria/agent-data` at
`/data/aetheria`. The worker also mounts the current backend source and file
vault. Use all three Compose files documented in `agent-questions-storage.md`;
starting the base Compose configuration alone omits the agent storage mount.

## Completed checks

- Backend suite: 231 tests passed across the full run and a focused rerun.
  Seven cross-project Android assertions needed the mobile repository's Android
  sources mounted into the temporary test container; all passed with those files.
- Desktop unit checks: 85 passed. Convex vault tests: four passed.
- Question-card browser test passed, including keyboard choices, free text,
  failed-submission retry, restored answers, injection checks, and narrow layouts.
- Public API smoke test: 58 checks passed, including authenticated reads,
  authentication rejection, profile isolation, memories, vault upload/read/delete,
  signed local media transfer, missing-resource handling, and CORS for PATCH.
- Native question integration passed through real Supabase authentication,
  Flask/Socket.IO, Agno persistence, reconnect, same-run continuation, duplicate
  replies, local history, and plan-mode questions. Its model transport is scripted.
- A disposable website passed initialization, domain assignment, R2 upload,
  activation, public Cloudflare delivery, file listing, and file-content retrieval.
  The site, manifest, uploaded file, metadata, and temporary account were removed.
- Sandbox creation, command execution, file write/read/list, and termination passed.
- All 13 public Supabase metadata tables have RLS enabled. There are no hosted
  Agno history tables. Local SQLite integrity check returned `ok`.
- Google is enabled in live Supabase settings. Its authorization endpoint returns
  a Google redirect with the new project's callback. The user confirmed sign-in
  works. The older installed desktop build still contains the old project URL.
- Desktop 1.3.1 Windows installer and Android debug APK built successfully.
  Both packaged public configurations target the new Supabase project; the
  desktop archive contains no private `.env` file.

## Cleanup

Deleted 264 objects from `aetheria-sandbox-logs` and 19 from `aios-sites-prod`.
Deleted 183 documents across the six configured Convex tables and verified all
six tables, file storage, and scheduled functions were empty. Buckets, schema,
functions, accounts in the new Supabase project, and local agent storage remain.

## Remaining external checks

Live image generation returned HTTP 402 from OpenRouter with the configured key.
The account had about $0.46 remaining, while its key cap had about $1.94 remaining.
OpenRouter's Image API requires an account balance above $1 before every request,
as documented in https://openrouter.ai/blog/tutorials/image-generation/.
It needs that minimum balance, then a live retest. The image verification script
now cleans generated images from Ubuntu local storage.

Payment checkout, individual third-party integration consent, push delivery to a
physical device, microphone capture, and every possible agent tool combination
were not exercised end to end. Passing backend checks does not establish those
external flows. Existing integrations must be connected under the new accounts.

Private keys and public runtime key files remain ignored by Git. Build artifacts
are local; this verification does not publish a release or install either app.
