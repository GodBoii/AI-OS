# Files/Vault implementation

The vault starts empty. Limits are 500,000,000 bytes per user and 50,000,000 bytes per file, displayed as decimal MB. There are no folders, Trash, backups, migration, or background recovery services.

## Storage and access

- File bytes live under `/data/vault/<user UUID>/<file UUID>` in the backend container. `docker-compose.vault.yml` maps this to `/srv/aetheria/vault` on Ubuntu, outside the application checkout.
- Convex `vault_files` stores ownership, relative path, filename, MIME type, exact byte count, SHA-256, tags, and creation time.
- Convex `vault_storage` stores used bytes and file count per user. Upload insertion and accounting share one transaction. Concurrent uploads cannot exceed 500 MB.
- All Convex vault functions are internal. Only the backend's admin-authenticated client calls them. HTTP and AI requests use the existing authenticated user ID.
- New uploads use multipart bytes. Installed desktop clients can still use the existing JSON/Base64 upload endpoint. Client-supplied size never controls accounting.
- File writes use bounded chunks and an atomic rename. Downloads stream through Flask `send_file`, support range requests, and use attachment disposition.
- Text preview reads a bounded amount. Arbitrary binary formats can be stored without pretending every format supports a text preview.
- A reusable HTTP session calls Convex with bounded timeouts and eventlet-compatible sockets. The vault does not use the blocking Rust SDK.

## Existing behavior

HTTP upload, listing, content, details, download, and permanent deletion remain available. The existing AI vault tools use the same service. Desktop opening and offline file caching remain supported.

The desktop cache now belongs to a specific account. Switching accounts cancels requests and ignores late responses. Upload/delete force a fresh list and usage count. Filenames are escaped before HTML rendering.

Chat attachments, generated media, sandbox artifacts, subscription/usage features, and Supabase authentication retain their existing implementation.

## Removed code

The former external file database implementation is gone. The website SQL toolkit, provisioning/credential/runtime query endpoints, SQL-provider health checks, credential encryption, and obsolete configuration are also removed, as requested.

Website publishing, R2 files/manifests, domain assignment, deployment history, and platform metadata remain. Site manifests retain `db: null`. Live inspection found two sites, four deployments, and zero provisioned website SQL databases before removal. Existing platform tables are not dropped.

## Failure handling

Rejected or interrupted uploads clean up partial bytes. If a metadata response times out, the service checks whether the mutation committed before removing bytes. Permanent deletion removes disk bytes first and releases the quota transactionally afterward; a failed metadata update can be retried.

Disk writes and Convex commits are separate operations. A process crash or an outage preventing both write confirmation and lookup can leave an unreferenced disk file. There is no automatic crash reconciliation, per the requested scope.

## Deployment

1. Deploy Convex schema/functions using the same deployment configured on Ubuntu. Backend credentials must include `CONVEX_URL` and `CONVEX_ADMIN_KEY`.
2. Apply the changed backend files and the new `user_file_vault_api.py`; remove the deleted website SQL toolkit module.
3. Run Compose with the existing base/server files plus `docker-compose.vault.yml`. The web container needs write access to the persistent directory. Current deployment uses a root container user.
4. Remove obsolete provider environment entries after the new code is active. No old remote database is accessed or deleted by the new application.
5. Distribute the desktop changes. Old installed clients retain their upload/download API compatibility.

## Verification

Run `npm run test:vault` and `npx tsc -p convex/tsconfig.json` from the project root. Run `python -m pytest tests/test_user_file_vault.py tests/test_deploy_without_site_sql.py -q` from `python-backend` with Flask, Convex, pytest, python-dotenv, and SQLAlchemy installed.

The tests cover atomic quota limits, parallel uploads, idempotent accounting, ownership, multipart and legacy uploads, bounded file size, failed upload/delete handling, text preview, private range downloads, account switching, late downloads, safe filename rendering, opening, deletion, and desktop/mobile quota text.

Generated Convex bindings were refreshed with the CLI's codegen command. Production deployment is a separate step.

All 22 focused tests passed. An isolated process in the Ubuntu container imported the changed backend, verified preservation of 45 existing routes, read both existing sites and all four deployments, and passed the deployment preflight. The running backend files and containers were not replaced or restarted.

## Production deployment, 6 October 2026

Code commits `7159670` and `7aca74f` were pushed to `master` and pulled into `/home/arun/apps/ai-os` on `ubuntu-server`. Convex schema and functions were deployed to the deployment configured on that server. The web and Flower images were rebuilt and both containers restarted successfully.

The persistent mount is also configured in the existing `docker-compose.server.yml`, so the server's normal two-file Compose command preserves it. `/srv/aetheria/vault` is mounted at `/data/vault`. Obsolete provider environment entries were removed. Redis, sandbox services, Cloudflare Tunnel, and other applications were not restarted.

Live verification used temporary authenticated accounts and exercised the running backend against actual Convex metadata and persistent disk storage. Upload, private range download, cross-user read/delete rejection, usage accounting, file-limit rejection, internal-function access protection, and permanent deletion passed. Deleting the last file also removes its empty Convex storage entry. Temporary accounts, auth cache entries, files, and test directories were removed afterward.

The public health endpoint returned 200; the public vault endpoint returned 401 without credentials. Both backend containers were running with zero restarts after deployment.
