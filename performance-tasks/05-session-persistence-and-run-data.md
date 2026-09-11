# Task 05: Make Session Persistence Small and Fast

## Why this task exists

The user can wait several seconds after model streaming has apparently ended because the backend still has metrics and persistence work to complete. Session rows also grow over time, making every later read and write more expensive.

## What happens today

Agents create database objects during run setup, and session storage can keep complete runs and events inside large JSON documents. Updating a session may therefore read or rewrite information from many previous runs.

When direct metrics are unavailable, `python-backend/agent_runner.py` can query the complete `session_data` and `runs` fields to calculate token information. Existing logs show a roughly three-second gap between the model stream ending and the run being marked complete. Redis catch-up state can also keep final content and full event lists for 24 hours, duplicating large data already stored elsewhere.

## What should improve

Use a shared, correctly sized database connection pool instead of repeatedly constructing database access objects. Store runs and events as append-only rows with one row per run or event batch. Keep the session row small and focused on session-level metadata.

Persist the minimum information needed to acknowledge completion first. Billing details, analytics, summaries, search indexing, and other derived data should be processed asynchronously. Large tool payloads and media should live in object storage, with stable references in the run record.

Redis replay data should have byte and event limits. Large completed results can be compressed or replaced with a database pointer once durable persistence succeeds.

## Implementation guidance

Define a normalized run model containing identifiers, timestamps, status, model, token counts, error summary, and content references. Give streamed events monotonically increasing sequence numbers. Add an idempotency key to each final persistence operation.

The preferred metric source is the active run object. Avoid loading the entire historical session to recover one run's token count. If metrics are missing, mark them for later reconciliation.

Migration can be gradual. New runs can use the normalized tables while old JSON sessions remain readable. A background migration may later extract valuable old records without blocking production traffic.

## Risks and special cases

The final completion event should not claim durable success before the minimum message and run state are safely stored. At the same time, nonessential analytics must not delay that event. Clearly separate these two categories.

Connection-pool sizes must match the number of gateway and background workers. An oversized pool can overwhelm Postgres.

## Completion check

The time from final model token to final client event should normally stay below 300 milliseconds. A session with hundreds of runs should not cause later run writes to grow in size. Tests should simulate persistence retries, duplicate completion attempts, missing metrics, Redis eviction, and database recovery.
