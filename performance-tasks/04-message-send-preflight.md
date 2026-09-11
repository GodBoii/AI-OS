# Task 04: Shorten the Work Before an Agent Starts

## Why this task exists

After the user presses Send, the application performs several remote operations before the agent is started. The interface may show activity, but the model has not received the request yet. This hidden waiting time makes every message feel slower even when model generation is fast.

## What happens today

The Socket.IO send handler authenticates the user, loads or updates the session, checks usage limits, and registers attached files before spawning the agent run.

The usage calculation in `python-backend/subscription_service.py` can query Supabase, ensure a billing window, update a Convex snapshot, query the current window, query lifetime usage, and synchronize a snapshot again. These calls happen in sequence. Attached files can also be registered one at a time.

Every remote round trip adds latency and increases the chance that a temporary billing or database slowdown prevents the AI request from beginning.

## What should improve

The synchronous preflight should contain only the checks required to safely accept the run. Authentication, a fast local or Redis-backed usage decision, basic request validation, and creation of a run identifier should be enough.

Keep the current plan and billing-window information in a short-lived cache. Use an atomic Redis counter for immediate quota reservation. Reconcile detailed usage with Convex or Supabase asynchronously after the run. If exact accounting later fails, preserve a reconciliation record rather than delaying the user's request.

Register multiple attachments in one database operation. Content processing that the agent does not immediately need should run in the background.

## Implementation guidance

Add a timing field for every preflight stage before changing behavior. This will identify which network call contributes most. Build a single `reserve_usage` operation that atomically checks and reserves the expected allowance. When the run completes, replace the estimate with actual usage in an idempotent finalize operation.

Remove duplicate snapshot upserts from the usage-summary path. Cache stable subscription fields separately from rapidly changing counters. Define what happens when Redis is unavailable: a short fail-safe path is better than several long retries.

Return a `run_accepted` event as soon as the request is safely queued so the frontend can distinguish backend acceptance from model streaming.

## Risks and special cases

Quota checks cannot become easy to bypass. Concurrent messages from the same user must reserve usage atomically. Failed and cancelled runs need a clear rule for releasing or adjusting reservations. Subscription changes should invalidate the cached plan quickly.

## Completion check

Measure from the socket receiving `send_message` to agent execution beginning. For a warm request without new file processing, the 95th percentile should be below 300 milliseconds. Tests should cover simultaneous sends near a quota boundary, cancellation, failed runs, plan changes, and delayed billing synchronization.
