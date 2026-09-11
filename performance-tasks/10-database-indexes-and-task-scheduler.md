# Task 10: Optimize Common Database Queries and Scheduled Tasks

## Why this task exists

Queries that are fast with a small development database can become slow when every user has many sessions, integrations, files, and scheduled tasks. The current schema has useful single-column indexes, but several frequent queries filter and sort by multiple columns.

## What happens today

Session lists commonly filter by user and sort by creation time. Integration lookup uses user and service together. Content queries combine session, user, and time. Without matching composite indexes, Postgres may scan many rows and sort the result after filtering.

The task poller wakes every minute, loads all rows whose status is pending, and then checks their due dates in Python. The next run time is stored inside JSON metadata, which is difficult for the database to query efficiently. As pending tasks grow, every polling cycle does more work even if only a few tasks are due.

## What should improve

Add indexes that match real query shapes, after confirming them with `EXPLAIN ANALYZE` and production query statistics. Likely candidates include session titles by user and descending creation time, agent sessions by user and time, a unique user-and-service integration key, session content by session/user/time, attachments by session/user/time, and a partial due-task index.

Move `next_run_at` into a real timestamp column. The poller should ask Postgres only for due pending tasks and claim a small batch atomically. Multiple poller instances must not execute the same task.

## Implementation guidance

Capture slow-query samples and row counts before adding indexes. Create production indexes concurrently where supported to avoid long table locks. Remove redundant indexes only after observing the new plan and write overhead.

For scheduled tasks, use a transaction with row locking such as `FOR UPDATE SKIP LOCKED`, or an equivalent atomic update-and-return query. Store claim time, worker identity, attempt count, and lease expiry. A dead worker's lease should become recoverable.

Use keyset pagination for long session and content lists rather than large offsets.

## Risks and special cases

Every index consumes storage and makes inserts and updates slightly more expensive. Indexes should follow measured queries, not be added speculatively. Scheduler time comparisons must use UTC and handle old JSON-only records during migration.

## Completion check

Representative queries should use the intended indexes and keep stable latency as test data grows. The poller should read only due tasks, claim bounded batches, and avoid duplicate execution when two workers poll together. Migration and rollback procedures should be tested on a production-sized copy.
