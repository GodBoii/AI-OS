# AI-OS Performance Improvement Tasks

This folder turns the performance audit into implementation-ready tasks. Each file explains one problem in plain language: what the application does today, why that work creates delay or visible lag, what should change, and how to know the change is complete.

The tasks are separated because they affect different parts of the system and have different risks. They should not all be placed in one large pull request. Small changes with measurements before and after will make regressions easier to find.

## Recommended order

Start with `01`, `04`, `08`, and `09`. These are relatively focused changes that can remove visible delay without redesigning the whole platform. Continue with `02`, `05`, and `10`, because they reduce the amount of data read, written, and sent on every request. Tasks `03`, `11`, and `12` are larger architectural changes and should be introduced gradually. Task `13` should begin early and continue throughout the work because measurements are needed to prove that every other task helped.

## Task files

| File | Main outcome | Expected impact |
| --- | --- | --- |
| `01-streaming-message-rendering.md` | Stop rebuilding the whole answer for every token | Much smoother chat streaming |
| `02-conversation-context-and-history.md` | Send smaller, more useful context to the model | Lower time to first token and lower cost |
| `03-backend-workers-and-concurrency.md` | Move long AI work away from the web gateway | Better throughput and fewer stalled users |
| `04-message-send-preflight.md` | Remove remote calls before an AI run starts | Faster response after pressing Send |
| `05-session-persistence-and-run-data.md` | Avoid rewriting large session documents | Shorter completion tail and smaller database load |
| `06-electron-startup-and-loading.md` | Load heavy features only when needed | Faster startup and lower memory use |
| `07-css-rendering-and-animation.md` | Reduce expensive blur, shadow, and animation work | Less scrolling and window lag |
| `08-frontend-initialization.md` | Prevent duplicate startup requests | Less network traffic and more predictable state |
| `09-session-content-summary-api.md` | Do not load every artifact just to show a count | Faster session opening |
| `10-database-indexes-and-task-scheduler.md` | Make common queries and scheduled work scale | Lower database latency |
| `11-network-configuration-and-reconnection.md` | Use one connection strategy and configurable servers | Fewer reconnect storms and lower deployment latency |
| `12-sandbox-files-and-background-work.md` | Bound container and file-system work | Fewer tool-related stalls |
| `13-performance-observability-and-tests.md` | Add timings, budgets, and repeatable load tests | Measurable and lasting improvements |

## Shared performance targets

The desktop window should become interactive in under 1.5 seconds on a normal warm machine. A warm message should reach backend agent execution in under 300 milliseconds, excluding the model provider. Streaming should not create renderer tasks longer than 50 milliseconds. After the model finishes, the final message should reach the user within 300 milliseconds. Cached APIs should normally complete within 100 milliseconds at the 95th percentile, and reconnect plus missed-event recovery should normally finish within two seconds.

These are starting targets, not promises. Task `13` should establish the current baseline and adjust targets using real production measurements.
