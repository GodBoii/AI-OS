# Task 08: Prevent Duplicate Frontend Initialization

## Why this task exists

The frontend can request the same information more than once during login and startup. Duplicate calls waste bandwidth, repeat server work, create races between old and new responses, and make the interface feel inconsistent on slower connections.

## What happens today

The authentication listener in `js/aios.js` updates the authentication interface and then loads deployments, files, memories, usage, and integration state. The `updateAuthUI` path also starts several of the same loads.

Some loading functions already protect themselves with an in-flight promise, but integration checks do not consistently share one. Existing logs show duplicate integration requests and two Composio status requests in the same second. When an external provider is failing, duplication makes both latency and log noise worse.

## What should improve

Create one initialization coordinator for each authenticated user session. It should own the current initialization promise, run independent requests in parallel, and publish one consistent ready or partially-ready state.

Authentication callbacks should announce state changes, not independently trigger the entire application load from multiple places. Each service loader should coalesce simultaneous requests and use a short time-to-live cache where freshness does not need to be immediate.

Logging out or changing users must cancel or ignore results belonging to the earlier user.

## Implementation guidance

Define a small startup state machine: signed out, restoring authentication, loading core data, ready, and degraded. Core data can include the minimum needed to show chat. Optional integrations, usage details, memories, and deployments can load after the main screen is usable.

Use `Promise.allSettled` for independent optional calls so one failing integration does not block the rest of the application. Keep an abort controller or generation identifier to prevent an old request from overwriting state after logout.

Add request identifiers and a `reason` field in development logs. This will show exactly which code path started each load without printing sensitive response data.

## Risks and special cases

Coalescing must not return one user's cached data to another user. Cache keys need the authenticated user identifier and relevant workspace or session identifier. Manual refresh should have an explicit force option.

## Completion check

One login should produce one request for each startup resource unless a retry is required. Integration-provider failure should not delay the core chat interface. Automated tests should cover rapid login/logout, token refresh, two quick initialization triggers, partial request failure, and manual refresh.
