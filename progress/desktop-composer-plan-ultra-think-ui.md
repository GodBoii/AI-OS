# Desktop composer UI improvements for Plan and Ultra Think

Date: 2026-08-21  
Platform: Aetheria desktop app  
Status: Implemented and verified

## Summary

The desktop chat composer now changes its visual treatment when Plan mode or Ultra Think is active. The work gives each mode a distinct character without changing how users type, attach files, use voice input, or send messages.

Plan mode uses a controlled cyan blueprint treatment. Ultra Think uses a faster chromatic border beam with a stronger outer aura. When both modes are active, the composer uses a combined state that keeps the Ultra Think energy while retaining a cool planning signal.

The final composer effect is CSS-based. A full-container WebGL MetalFX treatment was tested during development, but it was removed after screenshots showed that it could paint across the composer interior and wash out the prompt and controls. The existing MetalFX system remains available elsewhere in the app and was not modified by this work.

## Goal

The previous mode indicators depended mainly on the active appearance of the Plan and Ultra Think buttons. That made the state technically visible, but the main prompt surface felt the same in every mode.

This update had four goals:

- Make the active mode recognizable from the whole input container.
- Give Plan and Ultra Think different emotional and visual qualities.
- Preserve prompt readability, toolbar interaction, focus behavior, and theme support.
- Keep continuous animation lightweight and safe for reduced-motion users.

## Visual direction

### Plan mode

Plan mode is designed to feel calm, deliberate, and architectural.

- The composer surface shifts to a restrained blue-green tone in dark mode.
- A single cyan-white tracer travels around the edge on an eight-second cycle.
- A soft cyan halo breathes behind the lower and left edges.
- The border and inset highlight make the composer feel precise instead of flashy.
- The light theme uses a pale blueprint surface with a darker cyan edge so text and controls remain clear.

This direction reinforces the idea that the assistant is structuring work before execution.

### Ultra Think

Ultra Think is designed to feel denser, faster, and more computational.

- A chromatic liquid-metal-style beam travels around the perimeter on a 3.4-second cycle.
- The palette moves through cool cyan, pale steel, acid green, coral, and warm gold.
- A stronger blurred aura breathes behind the composer.
- The interior stays dark in dark mode and nearly white in light mode. The effect never covers the prompt or toolbar.
- Subtle cyan and coral radial light inside the surface connects the container to the animated edge without reducing contrast.

The result is visibly more energetic than Plan mode while remaining usable for long desktop sessions.

### Plan and Ultra Think together

Plan mode and Ultra Think can be active at the same time, so the UI includes an explicit combined state instead of letting two unrelated style blocks compete.

The combined `plan-ultra` state uses the Ultra Think chromatic beam as the primary treatment and strengthens the cyan portion of the aura. This keeps the state readable and avoids stacking multiple animations around the same component.

## State model

The composer visual state is derived from the existing Plan and Ultra Think booleans and written to `data-composer-mode` on `#floating-input-container`.

| Application state | Composer value | Visual result |
| --- | --- | --- |
| Neither mode active | `standard` | Existing default composer |
| Plan active | `plan` | Blueprint edge and slow cyan glow |
| Ultra Think active | `ultra` | Chromatic border beam and stronger aura |
| Plan and Ultra Think active | `plan-ultra` | Chromatic beam with a stronger planning signal |

The JavaScript helper `getComposerVisualMode()` is the single mapping point for these states. `syncComposerModeVisual()` writes the result to the composer. This keeps the styling declarative and avoids duplicating visual decisions across click handlers.

The visual state is synchronized when:

- Plan mode is toggled.
- Ultra Think is toggled or locked to the current conversation route.
- The chat module initializes.
- A conversation switch updates the Ultra Think route through the existing button synchronization path.
- An approved plan disables Plan mode before normal execution begins.

## CSS implementation

The visual system is implemented in `css/chat-input.css`.

The composer uses its existing `::before` and `::after` slots for decorative layers:

- `::before` is a two-pixel masked perimeter beam.
- `::after` is an outer halo placed behind the composer.
- Both layers use `pointer-events: none`, so they cannot block the textarea or toolbar buttons.
- `isolation: isolate` keeps the negative halo layer inside the composer's stacking context.

The border beam angle is stored in the registered custom property `--composer-beam-angle`. The keyframes animate this angle instead of changing the composer's size or position. The breathing halo uses only opacity and transform.

The implementation does not animate width, height, margins, or page layout. It does not add a new runtime dependency.

## Theme behavior

Dark and light themes have separate surface and shadow values.

Dark mode keeps the composer close to black, with tinted light concentrated at the edge. Light mode uses low-opacity cyan and coral radial fills over a near-white surface. Both themes retain the existing text and control colors from the app's design system.

The theme rules are scoped to the mode data attribute, so the standard composer and unrelated inputs remain unchanged.

## Focus and interaction behavior

When focus is inside an active-mode composer, the perimeter beam becomes slightly brighter. This provides a container-level focus response without replacing the existing keyboard focus rings on individual buttons.

All mode controls keep their current semantics:

- Plan and Ultra Think remain real buttons.
- Their `aria-pressed` state remains the source of accessible mode status.
- Ultra Think retains its locked and unavailable states for conversation routing and video attachments.
- The decorative edge is not exposed to assistive technology and does not communicate status by itself.

## Motion, accessibility, and performance

The update includes the following safeguards:

- `prefers-reduced-motion: reduce` disables the orbit and breathing animations while preserving a static mode treatment.
- Forced-colors mode removes the decorative layers and uses the system `Highlight` color for the composer border.
- Animations pause when the composer has the existing `hidden` class.
- Decorative layers cannot receive pointer input.
- The effect uses CSS gradients, opacity, transform, masks, and bounded blur values.
- No WebGL canvas runs inside the final composer.
- No animation library or package was added.

## MetalFX experiment and correction

An early version reused the app's native MetalFX adapter on a decorative frame covering the full composer. This produced a strong liquid-metal edge in principle, but the adapter was designed for compact buttons and chips. At the much larger composer dimensions, its canvas could render across the interior.

Desktop screenshots revealed two concrete failures:

- In dark mode, the Ultra Think composer became almost white and the controls lost contrast.
- In light mode, the shader produced a large multicolor fill instead of staying on the perimeter.

The full-container WebGL integration was removed. Ultra Think now uses the CSS chromatic border beam and aura only. This preserves the intended energy while guaranteeing that the prompt and toolbar remain unobstructed.

The native MetalFX adapter and its pricing-button usage were left unchanged.

## Files changed

### `js/chat.js`

- Added `getComposerVisualMode()`.
- Added `syncComposerModeVisual()`.
- Synchronized the composer after Plan changes, Ultra Think route changes, and chat initialization.
- Kept the existing Plan generation, Ultra Think routing, attachment validation, and send behavior intact.

### `css/chat-input.css`

- Added the registered border-beam angle property.
- Added shared decorative composer layers.
- Added Plan, Ultra Think, and combined mode treatments.
- Added dark and light theme values.
- Added focus-within, hidden, reduced-motion, and forced-colors behavior.

No HTML structure, backend route, message payload, or database behavior changed.

## Verification completed

The implementation was checked through the desktop app and an isolated Chromium preview using the same composer CSS.

- Plan mode was visually checked in the desktop app in dark and light themes.
- Ultra Think was checked after removing the full-surface canvas in dark and light themes.
- The final Ultra Think composer contained no canvas element.
- Prompt text and toolbar controls remained visible over the final surfaces.
- The chromatic beam and aura remained outside the content area.
- JavaScript syntax validation passed with `node --check js/chat.js`.
- Git whitespace validation passed with `git diff --check`.
- The temporary local preview file and server were removed after verification.
- The desktop app was restarted after the final correction.

## Final result

The desktop composer now communicates mode before the user reads the active button:

- Standard mode remains quiet and unchanged.
- Plan mode looks measured and structured.
- Ultra Think looks more intense without sacrificing readability.
- The combined mode has a deliberate visual result instead of an accidental overlap.

The change is limited to the desktop composer presentation and its state synchronization. Existing chat behavior remains unchanged.
