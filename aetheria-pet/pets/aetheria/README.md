# Aetheria pet

A 3D metallic star with a face and an orbit ring, based on the Aetheria logo. The default renderer uses a beveled, extruded mesh, physical materials, environment lighting, glossy eye meshes, a textured expression layer, and a real orbit with depth occlusion. A small SVG version remains available while loading and when WebGL is unavailable.

## Files and boundaries

| File | Responsibility |
| --- | --- |
| `emotions.ts` | Platform-independent face paths, colors, labels, timing, spring parameters, and scroll / tap reactions. No React, DOM, or website imports. |
| `AetheriaPet.tsx` | Controlled, keyboard-accessible React button. Lazy-loads the renderer and owns its lifecycle. No application routing or scrolling. |
| `renderer.ts` | Framework-independent Three.js renderer, geometry, lighting, expression textures, and 3D animation. Exposes emotion, gaze, travel velocity, pause, and disposal methods. |
| `dynamics.ts` | Platform-independent bounded spring integrator for movement with momentum. |
| `dynamics.test.ts` | Node tests for frame-rate consistency, stalls, invalid input, and reaction behavior. |
| `animations.css` | Character container, optional accents, and complete SVG fallback animation. |
| `index.ts` | Public component and data exports. |

The website adapter is `components/experience/PetCompanion.tsx`, with layout in `styles/pet-companion.css`. Those files own section storytelling, scroll tracking, nap controls, and guide integration. They are separate from this module because other apps should supply their own behavior.

## React and desktop webviews

Copy this directory into the other codebase. Import `animations.css` once at the application's stylesheet entry point. Runtime dependencies are React 18 or later and Three.js. This site uses Three.js 0.186. Next.js projects should import the stylesheet in `_app.tsx` or their root layout. App Router consumers need a client boundary around their interactive host. No Framer Motion, GSAP, Lucide, or Next.js dependency is required by the character itself.

```tsx
import { useEffect, useRef, useState } from "react";
import { AetheriaPet, boopReaction } from "./pets/aetheria";
import type { PetEmotion } from "./pets/aetheria";
import "./pets/aetheria/animations.css";

export function AppPet() {
  const [emotion, setEmotion] = useState<PetEmotion>("curious");
  const [reactionKey, setReactionKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  return <AetheriaPet emotion={emotion} reactionKey={reactionKey} onBoop={() => {
    clearTimeout(timer.current);
    const reaction = boopReaction(1);
    setEmotion(reaction.emotion);
    setReactionKey((key) => key + 1);
    timer.current = setTimeout(() => setEmotion("curious"), reaction.durationMs);
  }} />;
}
```

Increment `reactionKey` to replay the squash on consecutive taps. Hosts own reaction timers, prioritization, cleanup, and their idle / task state. Set `emotion="excited"` while a task runs, `"proud"` on completion, or `"sleepy"` when idle. Use `paused` to freeze rendering while napping. `onGreet` fires after an intentional mouse hover. Touch users activate the same boop with a tap.

For scroll or pointer choreography, attach a React ref typed as `AetheriaPetHandle`. It provides `lookAt(x, y)` with normalized values between -1 and 1, and `setTravelVelocity(speed)` with signed pixels per millisecond. These methods update the renderer without a React render on every animation frame.

Non-React webviews can lazy-import `createPetRenderer` from `renderer.ts`, pass an empty HTMLElement container and a readiness callback, then call the returned controller's methods. Call `dispose()` when unmounting. A `null` controller means WebGL is unavailable. The callback switches to `false` on context loss and back to `true` on restoration, so a host can show its fallback.

| Emotion | Face and movement |
| --- | --- |
| `curious` | Open eyes, smile, slow float, blink, orbit |
| `excited` | Happy eyes, open smile, squishy bounce |
| `zooming` | Braced eyes, stretched body, upward speed streaks |
| `sleepy` | Closed eyes, slow breathing, floating Zs |
| `bonked` | X eyes, squash and recoil, little stars |
| `dizzy` | Spiral eyes, wobble, little stars |
| `love` | Heart eyes and floating heart |
| `proud` | Happy eyes and celebration sparkles |

`boopReaction(count)` escalates to dizziness at three rapid taps. The host decides when a streak resets; the website uses a 1.6-second gap. `scrollEmotion(speed)` accepts signed pixels per millisecond and reacts equally to both directions. `stepPetSpring(state, target, deltaSeconds)` follows the exported stiffness, damping, and mass with bounded substeps. `getPetScrollPath(progress, horizontalRange, verticalRange)` describes four S turns through a supplied travel area. Progress runs from 0 to 1, X moves left from the right dock, and Y advances down with a small undulation. Reverse scrolling retraces the same path.

Website travel springs both axes along this route, with broad side-to-side movement on desktop and a shorter route on phones. The character leans into its turns; speech bubbles stay within the phone viewport. Opening the guide or napping springs it back to its dock. Travel uses a demand-driven animation frame loop that settles after scrolling, rather than React updates every frame.

## Native mobile and desktop renderers

Use `emotions.ts` and `dynamics.ts` directly in TypeScript apps, including React Native. `STAR_PATH` and the emotion eye / mouth paths share a 100 × 100 coordinate system. A native SVG renderer can draw them with paths, a ring centered at `50,50`, and a gradient fill. Eyes use a rounded 3.1-unit stroke; the mouth uses 2 units. Heart eyes and the excited / zooming mouth are filled. The React SVG markup is the reference for the fallback; `renderer.ts` is the reference for the 3D model and choreography.

The React component, CSS, and default renderer require a browser or webview. Electron, Tauri, and mobile webviews can use them directly. Fully native views need a renderer using their SVG / canvas / 3D system and native animation primitives. They can reuse the face geometry, colors, reaction decisions, and `motion` timing / spring parameters without importing website code. Flutter or Swift hosts can translate the same small data table to their language. A native Three.js host will need equivalents for the HTML canvas texture, resize / visibility observers, and WebGL context setup.

## Motion and accessibility

- The pet is a native button with a changing accessible name, Enter / Space activation, and a visible focus ring.
- `prefers-reduced-motion` stops float, orbit, blinking, squash, and particles. Expression changes remain visible.
- Use the React `paused` prop to freeze both the 3D renderer and CSS accents. Non-React hosts call `setPaused(true)` and set `data-pet-paused="true"` on the container for CSS accents. The renderer also pauses in background tabs and when offscreen.
- The website keeps reduced-motion users stationary and uses a shorter travel distance on narrow screens. Speech bubbles do not announce every scroll section to screen readers. The renderer caps pixel density at 1.75 and cleans up geometries, materials, textures, observers, event listeners, and its WebGL context.
- Size the button with `.aetheria-pet { width: ...; height: ...; }` or its `style` prop. Preserve a touch target of at least 44 pixels.
- Keep the character away from important controls, text fields, and app navigation. The site's Guide and Nap controls are application behavior, not part of the reusable character.

## Website verification

Run the website, scroll through the homepage, and tap the pet three times quickly. Try Guide, Escape, the Moon nap control, and the Sun wake control. On phones, the pet stays near the lower corner and travels a short distance. On interior pages it docks, while the existing page-specific guide remains available. The button exposes `data-renderer="webgl"` once the 3D renderer is ready, or `"svg"` while using the fallback.

The core tests use Node's built-in test runner. From the repository root in PowerShell:

```powershell
$petTestDir = Join-Path $env:TEMP 'aetheria-pet-tests'
node node_modules/typescript/bin/tsc pets/aetheria/dynamics.test.ts --module commonjs --target es2020 --outDir $petTestDir --esModuleInterop --skipLibCheck
if ($LASTEXITCODE -eq 0) { node --test (Join-Path $petTestDir 'dynamics.test.js') }
```
