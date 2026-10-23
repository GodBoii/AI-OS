# Browser controls

The Browser settings section controls the managed Chromium browser on this
computer. It does not manage the server-side Playwright browser or the user's
personal browser profile.

## Preferences and status

Preferences remain in `browser-settings.json` through `BrowserSettings` in the
main process. Existing setting names and storage format are unchanged.
Changing window mode saves the next launch preference without closing a running
browser. The UI shows the current mode separately and offers an explicit restart
when it differs from the saved preference.

`browser-ipc.js` registers the existing settings and `browser-data` IPC channels.
The runtime action uses the lazy controller's `peek()` method. Reading status
does not construct a handler, launch Chrome, reconnect, inspect cookies, or upload
screenshots. The UI refreshes every two seconds while Browser is visible and
stops its refresh loop when another settings section opens.

## Taking control

Pause and takeover immediately close the gate for new browser commands. An action
already running finishes. Commands queued before the pause, including commands
that reach the queue during a pause, receive an explicit paused result and are
never replayed on resume. A generation counter also discards stale commands when
the user pauses and resumes before a queued command starts.

The controls pause browser execution only. They do not suspend the model stream
or the whole chat run. Resuming opens the browser command gate; a chat task that
has ended needs a follow-up message. This avoids changing the existing server
run-control protocol or affecting tasks that are not using this browser.

Opening the browser for sign-in also pauses browser execution. Existing visible
and background sessions keep their tabs and page state. Takeover restores a
background window to the primary display. Headless Chrome cannot reveal a window;
the UI offers a separately confirmed visible restart and explains that tabs and
unsaved changes will close. Canceling that confirmation leaves the session intact
and paused. Paused sessions are exempt from idle shutdown.

Close and restart wait for active work, invalidate queued commands, and leave
automation paused. Managed Chrome receives a graceful close request so it can
flush cookies and release profile locks, with bounded termination as a fallback.
Delayed process/disconnect events cannot clear a replacement browser instance.

## Tabs, activity, and site data

User tab actions require a paused browser and share the existing serialized work
queue. Tabs use stable page identities rather than indexes. Closing a stale tab
or the final remaining tab returns an error. Existing agent tab commands retain
their current protocol.

Recent activity is an in-memory list capped at 30 entries, with the latest 12
displayed. It records action names, timestamps, and outcomes. It does not record
typed text, credentials, screenshots, or raw command payloads. Page titles are
rendered as text, and the UI displays hostnames rather than URL query strings.

Existing cookie inspection and clearing actions are preserved. An empty cookie
list does not claim that all sites are signed out. The existing blocked-domain
checks still apply to explicit navigation; redirect, popup, and link enforcement
remain separate work.

## Verification

- `js/tests/browser-runtime.test.js` covers lazy IPC reads, preference persistence,
  pause/resume ordering, queue recovery, bounded activity, real Chromium tab
  identities, and cookie persistence across managed restart.
- `js/tests/fixtures/browser-runtime-electron.cjs` verifies that real Electron
  takeover reveals a background window and preserves its page and form state.
- `js/tests/browser-runtime-ui.test.js` checks controls, keyboard mode selection,
  failed saves, restart confirmation, text escaping, both themes, desktop/tablet/
  narrow layouts, reduced motion, and refresh cleanup.
- Existing settings, picker, typing, browser click, desktop, native-feature, and
  computer-control suites cover the adjacent behavior.
