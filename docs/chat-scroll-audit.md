# Chat scrolling audit

The conversation uses one outer viewport, `#chat-messages`, and nested
`.detailed-logs` and `.reasoning-thought-content` viewports. `ChatScrollController`
owns following and paused state for each conversation. The chat renderer schedules
updates with a conversation ID, so background streams cannot scroll the active view.
Mutation and resize observers cover streamed text, final formatting, expanded logs,
late media, and composer resizing. Streaming uses instant scrolls in a shared
animation frame to avoid repeatedly restarting smooth scrolling.

## Findings and fixes

- A normal pointer click left a 1.5-second scroll-intent record. Collapsing content
  clamped `scrollTop`, which the controller interpreted as an upward drag. It then
  stopped following later output. Pointer intent now starts only on a scrollbar
  press, lasts through the drag, and clears on release, cancellation, or blur.
- Downward wheel input could also misclassify a layout clamp as scrolling up.
  A decreasing position now pauses only with upward input or a scrollbar drag.
- Shift+Space on an ordinary button paused following even though the key activated
  the control. Scroll detection now respects handled keyboard events and native
  button, disclosure, selection, and editing behavior.
- Jumping resumed only the latest assistant message's nested viewports. A paused
  reasoning viewport in an earlier message remained behind. Jumping now catches up
  that viewport and its enclosing logs before following the latest output.
- Switching conversations could receive delayed scroll events from hidden panels.
  Those events now leave saved nested positions alone. Capturing a conversation
  saves visible nested positions synchronously before the view hides.
- Forgetting a conversation or disposing the controller now cancels queued frames.
  Disposed controllers reject later scheduling requests.
- The jump button used neutral colors. Its arrow, border, hover tint, and focus ring
  now use the existing accent tokens supplied by **Use System Accent Color**.
  Its 44px target has a short entrance and hover nudge, reduced-motion overrides,
  and system colors in forced-color mode. Positioning accounts for composer height
  and clamps the button inside the chat window.

## Verification

Run `npm run test:chat-stream`. The command includes the focused scroll browser
suite and existing streaming, image-result, and search-preview integration tests.

The focused suite uses the real controller, button markup, layout styles, and
desktop appearance bridge. It checks collapse followed by growth, downward wheel
input, older reasoning panels, native scrollbar dragging past the intent timeout,
keyboard pause/resume, conversation switching, background updates, streaming,
cleanup, and live system-accent changes. Screenshots cover 1280px and 390px widths
in light and dark themes with reduced motion. Appearance IPC is simulated.

The existing question-card browser and native-feature suites also pass. Browser
fixtures exercise the rendering paths without a signed-in backend. A live agent
session in the packaged Electron application was not part of this verification.
