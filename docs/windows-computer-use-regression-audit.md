# Computer-use regression audit and repairs

Audit of the research and hardening implementation, including the user's pasted startup log. Baseline is `b002c55`; the first implementation ends at `feac33e`.

## Confirmed findings and repair plan

1. I prepared the worktree's dependencies but omitted its ignored `js/runtime-config.json`. The main checkout has valid public client settings; the worktree had none. Full startup and sign-in were therefore broken in the checkout I provided. Restore the existing local configuration without committing it, and add a real-preload startup check that does not stub auth.
2. Auth methods ignored the false result of initialization and accessed `null.auth`. This code predates my changes, but the worktree setup exposed it repeatedly. Add explicit initialization failures and concurrency/retry tests without changing public result shapes or session storage.
3. I moved browser fallback activation after mouse-down/up. Controls that detach themselves on mouse-down can lose their activation. Reproduce this in Chromium and restore the baseline order while keeping exactly one click.
4. I required both drag endpoints to belong to the source HWND. That removes existing cross-window dragging when `window_id` specifies the source. Restore source targeting, validate a visible desktop destination, and support an optional explicit destination HWND without focusing it during the drag.

The Electron security warnings in the pasted log come from baseline window/CSP settings, unchanged by these commits. They do not explain the missing Supabase URL. They are recorded separately rather than attributed to this implementation.

## Audit and verification scope

- Recheck screenshot age, UIA lookup/value verification, timing fields, result caching, native worker failures and Windows coordinate conversion against the baseline.
- Exercise auth with absent configuration, failed initialization, concurrent callers, corrected settings, persisted storage and successful OAuth URL generation. Avoid external account mutation.
- Run real Electron preload startup with isolated session storage, browser interaction regressions, the disposable Windows fixture and existing typing/platform/shell suites.
- Record confirmed regressions, cleared concerns and unverified cases. Push each repaired file in its own commit and keep local configuration ignored.

## Repairs

| Finding | Attribution | Repair |
| --- | --- | --- |
| Worktree missing runtime client configuration | My checkout preparation omission | Copied the existing main-checkout settings locally. The file remains ignored and is not committed |
| Repeated `null.auth` failures after initialization failed | Existing auth weakness exposed by that omission | Auth operations now return a clear initialization failure; concurrent callers share readiness, failed clients are cleaned up and retry remains possible |
| Browser controls removed on mouse-down lose activation | My fallback event reordering | Restored the baseline activation-before-mouse-down/up order, retaining exactly one click |
| Cross-window dragging rejected when the source HWND is supplied | My check of both endpoints against the source | Validate source ownership and a desktop destination; optional `to_window_id` validates destination ownership without stealing source focus |
| No startup configuration preflight or real-preload auth coverage | My verification gap | Added `prestart`, `test:auth`, SDK lifecycle tests and an Electron test using the actual production preload and login page |
| Native fixture could block its own drag loop | Test infrastructure gap found during this audit | Drag source/destination now run in a child application, so Windows OLE dragging cannot block controller timers. Drop counters verify the actual result |

The pointer worker now uses the existing 15-second helper budget rather than introducing a shorter 5-second cold-start limit. This addresses a compatibility risk on slower machines; no slow-machine failure was independently measured.

The original activation reorder was subtle: ordinary buttons and checkboxes passed, but a mouse-down handler that removed its element could prevent the later click from reaching the document. The new Chromium regression includes that case. The cross-window fixture verifies both the old source-only payload and the new optional destination payload, with two independently observed drops.

## Cleared concerns and deliberate behavior

- Main-process startup, preload, config loading and Electron window security flags were not changed by the original hardening commits. The missing local configuration, rather than edited auth code, caused the pasted startup failure.
- Screenshot defaults and image coordinate mapping remain compatible. Expiry now includes capture/transfer and is monotonic locally; rejecting expired references is intentional.
- Unicode entry, clipboard restoration and the saved Instant/Fast/Slow preference still use the existing typing implementation. Complete-value verification does not bypass that preference.
- UIA action lookup retains its 2,000-node budget; observation previews remain bounded. The complete-value comparison returns a verification flag, not the entire field value.
- Desktop timing fields are additive and preserve duplicate result replay. Python screenshot/result handling still accepts the existing envelope and includes images.
- Unscoped input, OS status tools, app launching, filesystem tools, task controls and notification routing were not replaced by this work. Existing regression suites exercise those adjacent paths.
- Covered or out-of-window targeted clicks still fail before button input. Owned popups need explicit targeting; this check is not a workflow lease or a guarantee against every focus race.

## Verification record

The final combined run passed 114 JavaScript tests with no failures or skips. Python computer-tool checks passed 15 tests. Auth checks include actual preload startup, empty isolated session storage, repeated Google OAuth URL generation, failed initialization, concurrent callers, retry, storage preservation and the existing successful email/session method contracts. No account login, email signup or other external account mutation was performed.

The native fixture passed long Unicode values, ordinal case comparison, late UIA controls, overlay/outside rejection, screenshot clicks and two cross-window drops through a separate application process. The existing native form passed seven commands in each of Instant, Fast and Slow modes. These checks ran separately to avoid sharing foreground input with unrelated fixtures. JavaScript syntax checks passed for 13 changed/new script files; the local configuration key is absent from the source changes.

One broader shell run timed out while waiting for copied text; the same unchanged shell test passed in isolation. During native test development, unavailable UIA refreshes and unexpected click counts also appeared. Those trials were treated as failed verification rather than successful runs. Native and browser suites are run serially for the final check; this is still not a statistical reliability benchmark.

The security warnings from `webSecurity: false`, insecure content and CSP predate these changes. Changing them would require a separate compatibility audit of the existing renderer, webviews and authentication flow. They were not suppressed or relabeled as new regressions.

Local evidence is in `.ui-check`. The runtime settings remain ignored. Installer behavior, completion of the user's Google login and an authenticated cloud agent run are not established by these checks.

## Running the repaired checkout

Restart the worktree app to load the restored local settings. `npm start` now checks configuration before launching Electron. The main checkout's pending package/lockfile changes remain untouched.

```powershell
npm run test:auth
npm run test:computer-control
npm run test:computer-hardening-live
python -m pytest python-backend/tests/test_computer_tools.py -q
```
