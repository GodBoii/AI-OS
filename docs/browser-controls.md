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
already running finishes. Commands queued before the pause receive an explicit
paused result and are never replayed on resume. A generation counter also
discards stale commands when the user pauses and resumes before a queued command
starts.

A new agent request made while paused offers a native resume prompt even when
Settings is closed or Chrome is not running. The current request waits for the
user's explicit choice so an accepted status request can continue the same task.
Concurrent requests share one prompt. Declining or a 60-second timeout keeps
automation paused without reopening the prompt repeatedly. Settings > Browser
always exposes Enable browser automation while paused, independently of the
Chrome connection. Enabling does not launch Chrome. Resuming through Settings
also dismisses any pending prompt.

Recovery waits at most 30 seconds for active work before offering the prompt.
If that work is still running, it returns a specific paused result with a Settings
recovery path instead of waiting past the browser tool response deadline. A new
pause or shutdown invalidates a pending consent answer.

After takeover, page interactions using prior element IDs or coordinates are
rejected until the agent reads a fresh view. Status, tab listing, and explicit
navigation can proceed. A successful current view clears this requirement.

The controls pause browser execution only. They do not suspend the model stream
or the whole chat run. Accepting a pending resume prompt continues that tool
request. A chat task that already ended after a declined or expired prompt needs
a follow-up message. This avoids changing the server run-control protocol or
affecting tasks that are not using this browser.

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

| Scenario | Expected recovery |
| --- | --- |
| Browser stopped, automation enabled | Agent status starts the browser normally. |
| Browser paused and stopped or disconnected | Settings shows Enable browser automation; a new agent request offers consent. |
| Browser paused and connected | Resume browser actions remains visible. |
| Sign-in or takeover | Active work finishes; further page interaction needs explicit resume and a fresh view. |
| User closes Chrome while paused | Resume and a subsequent status request can relaunch it. |
| Missing browser executable | Launch reports the missing installation; automation can still be enabled. |
| Prompt declined, closed, expired, or failed | Browser stays paused; Settings remains usable. |
| Concurrent agent requests | One prompt; no repeated clicks or typing against old page state. |
| Settings resume while a prompt is open | Prompt closes and the pending request observes the new state. |
| New pause or shutdown during consent | Late consent cannot restart automation. |
| Status or tab read fails | Enable remains available rather than disappearing with connection controls. |
| Headless takeover | Explicit visible restart confirmation preserves the existing session on cancellation. |

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
