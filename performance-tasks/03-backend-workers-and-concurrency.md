# Task 03: Separate Web Connections from Long AI Work

## Why this task exists

The production backend runs one Eventlet Gunicorn worker. That same process accepts Socket.IO connections, performs authentication and billing checks, accesses databases, runs agents and tools, talks to model providers, and handles scheduled work. One slow or blocking operation can therefore delay unrelated users.

## What happens today

The container command in `Dockerfile` starts Gunicorn with `-w 1`. The socket handler starts agent work with `eventlet.spawn`, but this only helps when every library cooperatively yields. Normal synchronous database drivers, SDK calls, Docker operations, file work, and some HTTP libraries can block the single process.

Celery and Flower exist in the deployment, but the current Celery application does not register the long AI runs as background tasks. Socket.IO also has no Redis message queue, which makes adding more web workers unsafe because a reconnect may land on a process that does not own the original in-memory connection state.

## What should improve

The web process should become a lightweight gateway. It should validate a request, create a run record, enqueue work, and stream events from a shared Redis channel. Separate workers should execute AI runs and tool operations. Any web worker should then be able to serve any connected user.

Redis should carry Socket.IO coordination, run-event streams, cancellation signals, and bounded replay data. Durable results still belong in the database, but live connection ownership should not depend on one process.

## Implementation guidance

Introduce this in stages. First add timing and blocking-operation visibility. Then configure a Socket.IO Redis message queue and prove two gateway workers can deliver events correctly. Move one simple run type to a worker queue before moving all agents. Finally separate high-risk or resource-heavy tools into their own worker pool with concurrency limits.

Each run needs a durable identifier and explicit states such as queued, starting, streaming, cancelling, completed, and failed. Events need sequence numbers so reconnecting clients can request only what they missed. Queue length and per-user concurrency limits should create backpressure instead of allowing unlimited work.

Cancellation must reach the worker, not merely hide the result in the interface.

## Risks and special cases

Background jobs may be delivered more than once after a worker failure. Persistence and billing operations must therefore be idempotent. A worker should be able to retry safely without charging twice or duplicating messages. Large event payloads need size limits and expiry rules.

Do not switch every run to the new system in one release. Use a feature flag and retain a controlled fallback while the queue is proven.

## Completion check

Run a load test with multiple simultaneous streams and deliberately slow database or tool calls. New connections and lightweight APIs should remain responsive. A worker restart should either resume or safely retry a run, and a gateway restart should allow the client to reconnect and recover ordered events without losing the final answer.
