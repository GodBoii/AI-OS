# Task 11: Simplify Server Configuration and Reconnection

## Why this task exists

The desktop client hardcodes a production server in several files and has overlapping retry mechanisms. This makes local or regional deployment difficult and can create multiple connections, duplicate listeners, repeated requests, and confusing behavior after the network changes.

## What happens today

Several renderer modules contain `https://api.aetheriaai.website` directly. Although the repository describes local Docker development, the desktop client is not controlled by one clear local-versus-production setting.

Socket.IO already provides automatic reconnection. `js/python-bridge.js` adds manual reconnection logic, the interface sends restart actions after online or error events, and the main process has another delayed retry. IPC handlers are installed when bridges start, but cleanup does not clearly remove every listener. Repeated restarts can therefore overlap sockets or accumulate callbacks.

The renderer also sends traffic through Electron IPC to the main process before it reaches the remote Socket.IO server. This boundary can be useful for security and lifecycle control, but the wide-area network is the dominant latency and should be measured separately.

## What should improve

Define the API and socket endpoints once. Read them from a validated environment or packaged configuration, expose the safe value to the renderer through preload, and remove hardcoded copies.

Use one reconnection state machine. Prefer Socket.IO's built-in backoff, with explicit connection states exposed to the UI. Manual retry should be reserved for a user action after automatic retries are exhausted. Every IPC and socket listener must have a matching disposal path and idempotent registration.

Send authentication through the supported Socket.IO connection authentication field and refresh it deliberately when the token changes.

## Implementation guidance

Add connection generation identifiers. Events from an older socket generation should be ignored after replacement. Centralize online/offline handling, backoff, maximum delay, jitter, token refresh, catch-up, and final failure state.

Support development, staging, production, and optional regional endpoints without editing source files. Log resolved host, connection generation, retry number, and timing, but never log tokens.

## Risks and special cases

Changing reconnection can expose previously hidden race conditions. Test sleep and wake, Wi-Fi changes, expired tokens, server restarts, rapid offline/online events, and logout during a retry. Ensure old listeners are removed before creating the replacement bridge.

## Completion check

At most one active socket and one set of IPC handlers should exist for a window. A network interruption should reconnect and recover missed ordered events within two seconds under normal conditions, without duplicate messages. Local and staging backends should work through configuration alone.
