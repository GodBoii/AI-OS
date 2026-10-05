# Computer control comparison and improvements

Tested on Windows on 5 October 2026. The display used 125% scaling.

## What I actually used

I used the built-in `cua_repl` inventory first. That runtime exposed browser controls but no native apps in this session. I then used the bundled Windows `@oai/sky` computer-use plugin to list apps, launch Calculator, capture its window, send a key, and verify the display. I also used it on a separate Electron form to inspect accessibility and set a Unicode field value.

For Aetheria, I executed the real `ComputerControlHandler.handleCommand` in Electron through an opt-in driver. This exercised the same dispatcher and implementations used by the desktop bridge. It used local test permission, no auth token, and no screenshot upload. The cloud Socket.IO/Redis/Agno connection was covered by isolated Python tests, not a live authenticated agent run.

The tests used Calculator and a disposable form with a textarea, checkbox, enabled button, and disabled button. They avoided personal documents, messages, settings, and accounts. The form process closes after each test.

## Confirmed problems and fixes

| Problem | What made it hard or inaccurate | Implemented change |
| --- | --- | --- |
| Random click offsets | The click could miss a small control by three pixels | Exact coordinates, validated before input |
| Random per-character delays | The handler added 40–180 ms per UTF-16 unit on top of nut-js's 300 ms default delay | Zero configured auto delay and whole-string Unicode input |
| Global input | Another window could receive typing or keys | Optional `window_id` on input, foreground verification, and refusal when focus fails |
| Repeated activation | The native window library could disrupt an already-focused window | Check foreground HWND before trying to activate |
| Desktop-wide accessibility fallback | A missing requested window could return a similarly named control from another app | Explicit HWND scope; missing and ambiguous targets fail |
| Only 50 returned controls | Calculator's last controls disappeared without a truncation warning | Default limit 200, configurable up to 500, traversal budget 2,000, and `truncated` flag |
| Arbitrary first text match | Duplicate labels produced an unsafe recommended click | Return all matches and suppress the recommendation when ambiguous |
| Coordinates instead of control actions | Finding a button still required a separate mouse move and click | Invoke, focus, toggle, select, expand, collapse, and set-value actions with fresh runtime-ID lookup |
| Missing state | Agents could not inspect field values, checkbox state, selection, or supported actions | Values, focus, selected text, document text, patterns, and control states |
| Stale references | An old image or control could be used after a change | References expire after 30 seconds; input and lock changes invalidate observations; screenshot input checks window movement |
| DPI mismatch | The window library returned logical bounds while UIA and input used physical pixels | Physical UIA bounds for capture; explicit image origins and screenshot-ID coordinate mapping |
| Wrong monitor selection | The first capture source was assumed to be primary | Match display IDs; support explicit display selection |
| OCR cloud round trip | Recognition needed upload, download, and cloud credentials | Local PNG recognition with a reused worker, confidence, and word coordinates |
| OCR missed field text | The default page mode missed a small textarea value | Sparse-text mode, verified against the form; imperfect small labels remain visible in confidence and output |
| PowerShell startup per action | Process startup dominated accessibility latency | Reuse a private pipe-connected worker, with request IDs, timeouts, cleanup, and restart on a later explicit request |
| Unicode loss in helper output | Default PowerShell encoding replaced emoji and Devanagari with question marks | UTF-8 output and UTF-16 encoded requests |
| Stuck keys or mouse buttons | A failure could interrupt a held-input sequence | Release in `finally`, including invalid-chord validation before input |
| Concurrent commands | Two tasks could interleave desktop gestures | One execution queue per handler, duplicate-request handling, and a bounded result cache |
| Infinite backend wait | The declared 120-second limit was unused | Monotonic deadline, cleanup on every result path, and explicit unknown-outcome errors |
| Response subscription race | A quick desktop result could precede Redis subscription readiness | Wait for the subscription acknowledgment before sending |
| Late queued input | An already-timed-out command could start much later | Frontend checks backend command expiration before execution |
| Screenshot upload failure | A captured image could disappear from the agent result | Bounded upload timeouts and inline-image fallback |
| Screenshot failure discarded useful state | An inaccessible screenshot could hide an otherwise usable UIA result | Preserve accessibility state and report `screenshot_available: false` |
| False launch failure | Explorer exited nonzero after opening Calculator | Launch the discovered AppsFolder item through ShellExecute; distinguish dispatch from verified readiness |

Legacy mouse and keyboard methods remain available. New optional arguments preserve existing callers. Partial-title window focus remains available only when the match is unique. Accessibility title lookup uses an exact title or an explicit window ID.

## What the comparison showed

The built-in plugin has useful window-scoped screenshots, control identities, document text, focus, and native control actions. Its Calculator observation returned a screenshot but no accessibility tree in the initial test. Its Electron form observation returned a tree and document text, and Unicode field editing worked. A robust agent still needs both semantic and visual input paths.

Aetheria's original Calculator lookup took 1,233 ms and returned exactly 50 elements. The new implementation found 53 elements. Its initial cropped screenshot was wrong because logical and physical coordinates differed; the corrected crop and a screenshot-backed click were then verified against Calculator's display.

Representative local measurements from the live runs:

| Operation | Observed time |
| --- | --- |
| Warm accessibility observation | 169–317 ms |
| Accessibility action plus refreshed state | 294–549 ms |
| Screenshot-backed click with target validation | 318–340 ms |
| Warm hotkey | 19–47 ms |
| Window screenshot plus accessibility | About 2.5–2.7 seconds |
| OCR after worker warm-up | About 1.6 seconds |

Before worker reuse, the form's semantic actions took roughly 1.5–3.7 seconds. These samples include local dispatcher work and state refresh. They exclude model inference, cloud transport, and any signed screenshot upload. Cold worker and native-module startup add latency. These are small smoke tests, not a statistical benchmark.

OCR verified the form title and `Local OCR test`. It still misread some small UI labels. Accessibility should remain the first choice for named controls; OCR confidence is evidence of uncertainty, not a correctness guarantee.

## Verification

Automated checks cover the toolkit's payloads and registration, Redis readiness and timeout paths, invalid responses, subscription cleanup, inline images, exact clicks, Unicode, key mapping, held-input release, ambiguous targets, serialized commands, duplicate IDs, expiration, lock state, screenshot mapping, memory limits, local OCR, worker reuse, script errors, and worker restart after a timeout.

Run the automated checks:

```powershell
npm run test:computer-control
npm run test:cross-platform
npm run test:native-features
python -m pytest python-backend/tests/test_computer_tools.py -q
```

The combined JavaScript checks passed 80 tests. The Python toolkit checks passed 11 tests.

Run the opt-in desktop smoke tests from the repository root:

```powershell
npm run test:computer-live -- js/tests/fixtures/computer-control-form.json
npm run test:computer-live -- js/tests/fixtures/computer-control-calculator.json
npm run test:computer-live -- js/tests/fixtures/computer-control-ocr.json
```

The form verifies the exact Unicode value, checkbox state, and two button clicks. Calculator verifies `0`, then `7`, then `78`, then `0`, using both semantic and screenshot-backed input. The driver can launch Calculator if it is closed and waits for one target window. This test uses and clears Calculator, so run it with a disposable Calculator session. OCR verifies actual recognized text twice to exercise worker reuse. A failure produces a nonzero exit code.

Local results and screenshots are saved in `.ui-check`. The source changes require an Electron rebuild and backend deployment before they reach the installed, cloud-connected application.

## Remaining coverage and implementation gaps

Universal control of every app remains unverified. The tested improvement covers normal Windows desktop apps with accessible controls and visible screenshots.

1. **Occluded windows and transient UI.** Capture still uses the visible desktop. A window must fit on one display, and an overlay can hide content. The built-in plugin's window capture is stronger here. Native Windows Graphics Capture with correct frame bounds, ownership of menus and dialogs, and point hit-testing would close this gap.
2. **Actual multiple monitors.** Negative-coordinate mapping has a regression test. Mixed-DPI multi-monitor hardware was not available for a live test. Windows spanning displays currently fail explicitly.
3. **macOS and Linux accessibility.** Existing screenshot/input paths remain, but the new semantic implementation is Windows-only. AX and AT-SPI adapters, plus supported Wayland control mechanisms, need separate OS testing.
4. **Privilege boundaries.** Secure desktops and elevated applications need explicit capability handling. Windows limits input injection to equal or lower integrity levels according to the [SendInput documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput). The work did not change OS privileges.
5. **Apps without useful accessibility.** Canvas editors, games, and custom controls need visual verification, OCR, and gesture testing. The current OCR worker uses English recognition.
6. **Long-running task cancellation.** Queued commands expire, input cleanup is protected, and helper requests have timeouts. A cancellation protocol tied to the backend's Pause/Stop controls would allow earlier interruption of long typing, OCR initialization, or shell work.
7. **Connected and packaged validation.** Test the installed Electron package against the deployed Redis/Socket.IO backend with actual authentication, storage failures, disconnects, clock skew, and concurrent chat requests. The new expiration timestamp assumes reasonable clock agreement between desktop and backend.

Chromium-based app accessibility depends on the application's provider. The fixture explicitly enables Chromium's `UiaProvider` and Electron accessibility support, as described by [Chromium](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/accessibility/browser/uiautomation.md) and [Electron](https://www.electronjs.org/docs/latest/tutorial/accessibility). The toolkit does not change flags in third-party applications.

## Saved typing speed

Settings now has an **Agent typing** card with one preference shared by native computer tools and the managed desktop browser. The preference persists in the main-process settings file and takes effect on the next text entry. Existing installations default to Instant.

- **Instant** pastes the complete text into a native app. The managed browser inserts it in one operation without changing the system clipboard.
- **Fast** types individual Unicode characters with 25–55 ms pauses.
- **Slow** types individual Unicode characters with 80–180 ms pauses.

Native field replacement through `perform_element_action(..., element_action='set_value')` uses the same preference, so an agent cannot bypass the selected pace by choosing a different text tool. Windows paced typing uses Unicode SendInput because the existing native library corrupted emoji and Devanagari text. Line breaks use literal paste input to avoid treating Enter as message submission. Native paste restores the clipboard's supported text, HTML, RTF and image content unless the user has copied new text meanwhile. Arbitrary application-specific clipboard formats are outside Electron's supported restoration API.

The desktop browser uses the saved preference for input, textarea, and contenteditable controls. Appending preserves existing text. Slow and Fast retain keyboard input behavior; Instant uses Chromium's text insertion. The backend waits allow enough time for a long Slow entry. The server-side browser used by web/mobile clients is separate and does not receive this desktop-local preference.

`npm run test:typing` verifies persistence, invalid settings, failed saves, the actual Settings listener, keyboard interaction, both themes at 1280px and 390px widths, clipboard restoration, and all modes in a real Chromium browser. The native form workflow also passed in all three modes with the exact emoji, Devanagari, and multiline field value. These tests do not assert universal support in every application, and physical user typing can interleave with injected input.

The final combined checks passed 88 JavaScript tests and 13 Python tests, including the earlier toolkit reliability checks and long-typing deadlines in both backend proxies.

To repeat each native mode:

```powershell
npm run test:computer-live -- js/tests/fixtures/computer-control-form.json instant
npm run test:computer-live -- js/tests/fixtures/computer-control-form.json fast
npm run test:computer-live -- js/tests/fixtures/computer-control-form.json slow
```
