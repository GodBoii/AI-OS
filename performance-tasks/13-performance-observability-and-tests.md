# Task 13: Measure Performance and Prevent Regressions

## Why this task exists

Performance cannot be improved reliably from impressions alone. The codebase has logs and some tests, but it does not yet provide one end-to-end view of where a message spends its time or automated budgets that detect a slowdown before release.

## What happens today

Frontend, IPC, socket, agent, database, and model logs are separate. It is difficult to answer whether a slow response came from rendering, authentication, usage checks, history loading, model time to first token, a tool, persistence, or reconnection.

The targeted computer-control test currently passes, while the backend test run has failures related to missing Android source files and a changed mobile-action contract. The default root test command also has import-path problems. There is no repeatable concurrent streaming load test or renderer performance budget.

## What should improve

Give every message and run a correlation identifier that is carried from the renderer through IPC, Socket.IO, the gateway, background workers, model calls, tools, databases, and the final rendered message.

Record structured timestamps for user submit, IPC receipt, socket receipt, authentication, usage reservation, agent creation, history loading, model request, first token, tool start and end, model completion, durable persistence, final event delivery, and final browser paint.

Build dashboards for median and 95th-percentile latency, error rate, queue wait, time to first token, post-model completion delay, context tokens, renderer long tasks, reconnect time, and resource usage. Add alerts based on service-level objectives rather than individual noisy requests.

## Implementation guidance

Use OpenTelemetry or an equivalent tracing standard where practical, and connect error reporting to the same run identifier. Sensitive prompts, tokens, credentials, and file contents must not be placed in metrics or traces.

Create three repeatable test levels. A small synthetic test should run in pull requests without calling paid providers. A staging load test should simulate multiple connected users and streamed responses. A packaged Electron performance test should measure startup, session switching, long-message streaming, scrolling, and reconnect behavior.

Fix or clearly quarantine the existing broken backend tests before using the suite as a gate. A quarantine must include an owner and reason; silently ignoring failures will hide real regressions.

## Initial budgets

Use the shared targets in `README.md` as starting budgets: warm interactive startup below 1.5 seconds, warm preflight below 300 milliseconds, no renderer task above 50 milliseconds during streaming, post-model completion below 300 milliseconds, cached API 95th percentile below 100 milliseconds, and normal reconnect recovery below two seconds.

## Completion check

A developer should be able to select one slow production run and see a complete timing breakdown without reconstructing it from unrelated text logs. Continuous integration should fail when an agreed budget regresses beyond its tolerance. Every performance task in this folder should include before-and-after measurements using these shared traces and tests.
