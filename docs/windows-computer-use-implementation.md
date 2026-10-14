# Windows computer-use implementation

Started 14 October 2026. Based on the 13 October research report. Implementation branch: `codex/windows-computer-use-hardening`.

## Scope and compatibility

This first increment implements the targeting, observation, lookup, verification and browser-activation corrections, plus timing instrumentation. Command recovery, cancellation, workflow leases, batching, conditional capture and the native-helper pilot remain separate increments because they require coordinated protocol and lifecycle changes.

Existing tool names, arguments, `status`, screenshot defaults, saved typing speeds, clipboard restoration, permission flow and unscoped input remain compatible. New result fields are additive. Windows-specific point checks do not change macOS/Linux dispatch. Application behavior outside the automation path should remain unchanged.

The existing attached worktree isolates this work from the main checkout's pending package changes. Node tests initially reused dependencies through `NODE_PATH`. Electron ignores that lookup here, so a local ignored `node_modules` junction points to the existing installation. No dependencies or lockfile entries were changed. The package scripts now include the new browser regression and opt-in native fixture.

## Code and dependency review

- Python `ComputerTools` creates a request ID, waits for Redis subscription readiness, emits to the desktop SID, receives a result and attaches images. The computer agent already distinguishes input delivery from the requested outcome.
- Electron's lazy controller routes through one serialized handler. Its result cache and observation invalidation must retain their current behavior.
- Screenshot input first maps image pixels to physical desktop coordinates. Pointer validation must happen after mapping and immediately before a targeted gesture.
- UIA observation output is bounded. Live action lookup currently shares that output cap, and field previews are truncated at 4,000 characters. Complete-value checks must not depend on either bound.
- Field replacement intentionally uses keyboard input and the user's saved pace. Verification must not replace this with direct UIA editing.
- Browser fallback currently sends two click events. Correcting it must retain standard click, fallback behavior and site settings.
- Existing tests cover exact clicks, held-input release, Unicode, typing preferences, screenshot coordinates, native worker lifecycle, platform readiness and Python toolkit deadlines. Add behavior tests around the gaps, including real Chromium and disposable native fixture checks.

## Step-by-step plan

1. Run the existing desktop, typing, platform and Python tests as the baseline.
2. Add a bounded Windows pointer check through the existing private worker. Verify live bounds, foreground HWND and the root HWND under each supplied point. Validate the current cursor when a targeted click/scroll omits coordinates. A separate popup requires its own HWND; unscoped input stays available for legacy workflows.
3. Record screenshot time before saving/upload, maintain a local monotonic age, return capture/expiry timestamps, and reject image references that became stale during transfer.
4. Separate UIA runtime-ID lookup from observation collection. Keep the 2,000-node search budget and 200/500-element observation bounds. Add an exact full-value comparison within the helper, with a bounded readiness wait and no full-value output.
5. Preserve field entry and refreshed state. Return additive execution and verification fields, and an unknown outcome when a semantic action's refresh or full-value verification fails. A successful full-value check remains independent of the bounded preview refresh. Preserve successful accessibility actions that cannot independently prove a task-specific outcome.
6. Send one browser click event through the fallback, preserving mouse-down/up behavior. Verify a single activation in real Chromium, including checkbox and disabled-control behavior.
7. Record monotonic queue/execution timing and inclusive stages for targeting, UIA, capture, encoding, output storage, upload and metadata. Add backend bridge timing without logging input text or adding fields to command arguments.
8. Run focused regressions, existing related suites and disposable Windows workflows. Check Unicode and all saved typing modes, long values, late controls, screenshot clicks, negative mapping, worker errors and invalid targets. Run Python protocol tests and review the final diff.
9. Update this document with actual outcomes and limitations. Commit each changed file separately and push the implementation branch. Do not merge, deploy or claim installer/connected-agent coverage without those checks.

## Verification record

Implemented the first increment:

- `windows-input-target.js` validates foreground HWND, physical window bounds and the root HWND at each point. The worker temporarily selects per-monitor DPI awareness and restores it. Targeted clicks and scrolling also check immediately before button/wheel input; double-click target failure after the first click reports an unknown outcome.
- Screenshots retain capture-start wall and monotonic times. The result includes `captured_at_ms`, `expires_at_ms` and `screenshot_expired`. Mapping rechecks expiry after asynchronous bounds lookup. Saving/upload no longer refreshes the reference lifetime.
- UIA lookup no longer collects bounded observation entries. It retains the 2,000-node search budget. Full-value verification compares the live ValuePattern value with ordinal case sensitivity and a 750 ms readiness wait; observations retain their existing 4,000-character preview.
- Field replacement still uses the saved typing mode. Results distinguish `execution: dispatched` from `verification: passed | failed | unavailable`. A helper exception after input or failed refresh returns an unknown outcome rather than inviting blind replay.
- The browser fallback keeps mouse-down/up listeners and calls `el.click()` once. Real Chromium checks button activation, checkbox state and disabled-button click behavior.
- Desktop results include `timings_ms` for queue wait, execution and the stages reached. Stages are inclusive and can overlap; do not add them together. Duplicate replay preserves the original timings. Python results add `bridge_elapsed_ms`, measured through receipt of the response. Backend logs also measure total toolkit time through processing and cleanup, without text/image content.

Verification performed on Windows on 14 October 2026:

| Check | Result |
| --- | --- |
| Existing baseline | 86 of 87 JavaScript tests passed together; the Chromium startup failure passed in isolation. Python baseline was 13/13 |
| `npm run test:computer-control` after implementation | 39 passed, none skipped |
| Related desktop, typing, browser settings, platform and native-feature suites | 105 passed, none skipped |
| Python computer toolkit | 14 passed |
| `npm run test:computer-hardening-live` | Full Unicode/multiline value over 4,000 characters; case mismatch rejected; filtered control beyond 200 nodes invoked; covered/outside clicks rejected; screenshot click independently verified |
| Existing disposable form in Instant, Fast and Slow | Seven successful commands and four outcome checks in each mode |
| Syntax and diff checks | JavaScript parse checks and Git whitespace checks passed; `cr-at-eol` preserves the repository's existing CRLF package file |

The native fixture checks real UIA and Win32 operations and independently reads its own renderer state. It owns all windows that may receive input and closes them on completion. Its first overlay setup used fractional Electron window positions and therefore did not cover the intended point; integer positioning corrected the fixture. The screenshot-click check uses a bounded outcome wait because input dispatch precedes application event processing.

Local evidence is under `.ui-check` in this worktree and is ignored by Git. There was no live authenticated cloud run, installer build, multi-monitor hardware test or macOS/Linux machine test. Passing the platform regressions does not establish native control on those other systems. Window hit testing does not remove every focus race or constitute a workflow ownership lease. Command recovery and Stop cancellation are not implemented in this increment.

## Repeatable checks

```powershell
npm run test:computer-control
npm run test:computer-hardening-live
npm run test:computer-live -- js/tests/fixtures/computer-control-form.json instant
npm run test:computer-live -- js/tests/fixtures/computer-control-form.json fast
npm run test:computer-live -- js/tests/fixtures/computer-control-form.json slow
python -m pytest python-backend/tests/test_computer_tools.py -q
```

Use serial Node test execution when combining the broader Chromium and Electron suites to avoid competing browser startup load. The native checks operate only on disposable fixture windows.
