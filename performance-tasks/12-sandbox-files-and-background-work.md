# Task 12: Bound Sandbox and File-Processing Work

## Why this task exists

Coding, deployment, artifact, and computer-control features perform heavy container and file-system work. Unbounded scanning, one-file-at-a-time transfers, and containers without strict cleanup can make tool runs slow and consume resources needed by normal chat traffic.

## What happens today

The sandbox manager creates a Docker container for a session, but lifecycle cleanup and resource limits are not consistently enforced. Listing files can run `find` across the whole workspace. Some paths read files into JSON or Base64, and transfers may create an archive for each individual file.

Sandbox tools can take full before-and-after file snapshots. Artifact handling downloads, uploads, and persists files in a loop. Deployment can make one HTTP request per file. Redis session expiry does not by itself guarantee that the related Docker container is removed.

## What should improve

Every container should have labels, an owner, an idle deadline, CPU and memory limits, a PID limit, disk limits where available, and a clear network policy. A separate reaper should remove expired containers even when the original process crashes.

Maintain a lightweight workspace index or change journal instead of scanning every file for every request. Transfer related files as one archive or use a batched protocol. Process independent uploads with bounded concurrency rather than purely sequentially or without limits.

Store large artifacts in object storage and pass references through events. Avoid Base64 inside JSON for large binary files because it increases both size and memory copying.

## Implementation guidance

Collect workspace size, file count, scan duration, bytes transferred, container startup time, CPU, memory, and cleanup reason. These measurements should determine thresholds.

Ignore dependency, build, cache, and version-control directories by default when scanning. Let tools request them explicitly when needed. Use hashes or file-system events to detect changes after the first index.

Make cleanup idempotent. The normal completion path, cancellation path, timeout path, startup recovery, and periodic reaper should all safely request the same cleanup operation.

## Risks and special cases

Resource limits that are too strict can break legitimate builds. Start with generous measured defaults and return a clear explanation when a limit is reached. File watchers can miss events, so retain an occasional bounded reconciliation scan.

## Completion check

Tool latency should scale with changed files rather than total workspace size after initial indexing. Expired sessions must leave no orphaned containers. Load tests should show that several sandbox runs do not stall ordinary chat requests, and metrics should clearly identify users or tasks consuming exceptional resources.
