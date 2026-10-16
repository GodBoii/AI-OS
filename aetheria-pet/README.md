# Aetheria pet for AI-OS

This folder contains a copy of the animated Aetheria star pet from the AIOS website. It is ready for integration work in AI-OS. Copying it does not display the pet in the desktop app yet.

The source is the chat "Add an animated Aetheria star pet", `codex://threads/01a136b5-2cb6-7053-a1b9-660d5f7a7e88`. The copy uses the website checkout on 16 October 2026, including the later request for snake-like left and right scroll movement. `source-manifest.json` records the source commit and SHA-256 hashes of every original copied file.

## What is included

| Path | Purpose |
| --- | --- |
| `pets/aetheria/AetheriaPet.tsx` | React button with the 3D pet, SVG fallback, pointer gaze, keyboard activation, and renderer cleanup. |
| `pets/aetheria/renderer.ts` | Three.js renderer with beveled metallic geometry, lighting, eyes, expressions, orbit, squash, and travel lean. Works independently of React. |
| `pets/aetheria/emotions.ts` | Eight expressions, face paths, colors, timing, and tap/scroll reaction decisions. |
| `pets/aetheria/dynamics.ts` | Spring movement and the four-turn snake scroll path. |
| `pets/aetheria/dynamics.test.ts` | Seven existing tests for spring stability, reactions, and scroll travel. |
| `pets/aetheria/animations.css` | Character styling, SVG animation, particles, focus treatment, and reduced-motion rules. |
| `pets/aetheria/index.ts` | Public React, renderer type, emotion, and motion exports. |
| `pets/aetheria/README.md` | Original component API and portability documentation. |
| `components/experience/PetCompanion.tsx` | Original scroll storytelling adapter, speech bubbles, tap streaks, greeting, nap controls, and task event reactions. |
| `components/experience/Companion.tsx` | Original Next.js guide panel, navigation, tour, and optional speech synthesis. Reference code for adapting the guide. |
| `components/experience/StarMark.tsx` | Logo used by the guide. |
| `lib/experience.ts` | Typed `aetheria:experience` event contract and validation. |
| `styles/pet-companion.css` | Original scroll companion layout and speech styles. |
| `styles/companion-guide.css` | Guide-related rules extracted from the website's `styles/experience.css`, with mobile and reduced-motion overrides. |
| `package.json`, `package-lock.json` | Isolated dependencies and verification/build commands. |
| `tsconfig.json` | Type checking for the reusable pet, scroll adapter, logo, and events. |

The 13 original files retain their source contents. The extracted guide stylesheet and transfer setup are additions. The star geometry, textures, face paths, and SVG are created in code. There are no external pet images, model files, fonts, API keys, backend services, or downloads needed at runtime.

## Packages and setup

Run commands inside this folder, not the AI-OS repository root:

```powershell
Set-Location 'C:\Users\prajw\Downloads\AI-OS\aetheria-pet'
npm ci --ignore-scripts
npm run check
```

Node 22.15.0 and npm 11.4.0 were used for this transfer. The install creates a local `node_modules` directory. It and the generated build/test outputs are ignored by Git. The lockfile records transitive dependencies and integrity hashes, so the dependency installation can be reproduced after cloning.

Runtime package versions match the source website lockfile:

| Package | Version | Used by |
| --- | --- | --- |
| `three` | 0.186.1 | 3D renderer and its bundled `RoomEnvironment`. |
| `react` | 18.3.1 | React character and website adapters. |
| `react-dom` | 18.3.1 | Mounting the character in a React host. |
| `lucide-react` | 1.16.0 | Guide, moon, sun, and navigation icons in the website adapters. |

The build tools are TypeScript 5.8.3 and esbuild 0.27.0, with the source versions of the Node, React, React DOM, and Three.js type packages. `package.json` records their exact versions.

The character itself needs React and Three.js when using the React component. A plain JavaScript host can use the renderer with Three.js bundled into its output, without React or Lucide at runtime.

The reference `Companion.tsx` imports `next/link` and `next/router`. Next.js is deliberately absent from this transfer's dependencies because AI-OS uses Electron and plain JavaScript. That file is excluded from the transfer type check. To reuse it in Electron, replace its links, routes, and page-specific guidance with AI-OS navigation. The website used Next.js 14.1.0. There is no need to add that website framework to AI-OS to display this pet.

## Recommended integration in the current Electron app

AI-OS loads HTML and JavaScript through its Electron renderer. Start with the framework-independent renderer rather than mounting the website guide unchanged.

1. Run `npm run build:renderer` here. It creates `dist/renderer.js`, `dist/dynamics.js`, and `dist/emotions.js` as browser ES modules. Dependencies are bundled into each entry, so the renderer does not need browser import maps or runtime access to this folder's `node_modules`.
2. When adding the pet to the app, copy those outputs to `AI-OS/js/aetheria-pet/`. AI-OS's current Electron builder configuration includes `js/**/*` and `css/**/*`. It does not include this top-level transfer folder, so generated files must be placed in an included path or the build configuration must be updated.
3. Add a sized container in the chosen desktop page. Create the renderer after that element exists. Use an existing script module or a bundled entry to import it.
4. Put app-specific reactions, placement, timers, event subscriptions, and cleanup in a small host controller. Connect it to the actual desktop task events. The website's event names do not connect themselves to Electron or the backend.
5. Test in a packaged build as well as development, including WebGL unavailability and window shutdown.

For a minimal host, put this markup in the chosen page. The click listener belongs in the renderer script:

```html
<button id="aetheria-pet-button" type="button" aria-label="Boop Aetheria">
  <span id="aetheria-pet-canvas"></span>
  <span id="aetheria-pet-fallback" aria-hidden="true">Aetheria</span>
</button>
```

Give the button and canvas container explicit dimensions in the app stylesheet. The renderer measures its host. For example:

```css
#aetheria-pet-button {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 148px;
  height: 148px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
#aetheria-pet-button:focus-visible { outline: 2px solid #d5f49d; }
#aetheria-pet-canvas { display: block; width: 100%; height: 100%; }
#aetheria-pet-fallback { position: absolute; inset: 0; place-content: center; }
```

This example assumes the outputs now live in `AI-OS/js/aetheria-pet/` and the importing script lives in `AI-OS/js/`:

```javascript
import { createPetRenderer } from './aetheria-pet/renderer.js';
import { boopReaction } from './aetheria-pet/emotions.js';

const button = document.getElementById('aetheria-pet-button');
const host = document.getElementById('aetheria-pet-canvas');
const fallback = document.getElementById('aetheria-pet-fallback');
if (!button || !host || !fallback) throw new Error('Pet elements are missing');

const showRenderer = (ready) => {
  host.hidden = !ready;
  fallback.style.display = ready ? 'none' : 'grid';
};

let pet = null;
try {
  pet = createPetRenderer(host, showRenderer);
} catch (error) {
  console.error('Aetheria renderer initialization failed', error);
}
showRenderer(Boolean(pet));

let reactionTimer;
let lastTap = -Infinity;
let tapCount = 0;
function boop() {
  const now = performance.now();
  tapCount = now - lastTap < 1600 ? tapCount + 1 : 1;
  lastTap = now;
  const reaction = boopReaction(tapCount);
  clearTimeout(reactionTimer);
  pet?.setEmotion(reaction.emotion, true);
  reactionTimer = setTimeout(() => pet?.setEmotion('curious'), reaction.durationMs);
}
button.addEventListener('click', boop);
function disposePet() {
  clearTimeout(reactionTimer);
  button.removeEventListener('click', boop);
  pet?.dispose();
}
window.addEventListener('pagehide', disposePet, { once: true });
```

The text fallback above is intentionally minimal. For the original animated SVG fallback and decorative particles, use `AetheriaPet.tsx` and `animations.css`, or port its SVG and state attributes into the vanilla host. The standalone renderer creates the 3D canvas only. It does not create the React button, SVG, speech bubbles, controls, or keyboard behavior.

For SPA panel teardown, call the same disposal logic when removing the host, rather than waiting for `pagehide`. Manage hidden-tab or napping timers in the host. Keep the existing Electron preload and IPC boundaries when connecting task events.

## React integration

For a future React renderer, import `AetheriaPet` from `./pets/aetheria`, and import `./pets/aetheria/animations.css` once at the stylesheet entry point. The original module README has a complete tap-reaction example.

`AetheriaPet` takes `emotion`, `reactionKey`, `onBoop`, optional `onGreet`, `paused`, `className`, and `style`. Increment `reactionKey` to replay a reaction on repeated taps. Its ref provides `lookAt(x, y)` and `setTravelVelocity(speed)`.

The plain renderer controller additionally exposes `setEmotion(emotion, replay)`, `setPaused(paused)`, and `dispose()`.

## Behavior and customization

| State | Original behavior |
| --- | --- |
| `curious` | Idle smile, blinking, float, orbit, and gaze. |
| `excited` | Happy expression with a small bounce. |
| `zooming` | Braced expression and stretched body. CSS adds speed streaks in the React host. |
| `sleepy` | Closed eyes and breathing. CSS adds floating Zs. |
| `bonked` | X eyes, squash, recoil, and stars. |
| `dizzy` | Spiral eyes and wobble after three rapid taps. |
| `love` | Heart eyes on an intentional hover greeting. |
| `proud` | Celebration expression and sparkles after completion. |

The host chooses when to change states. In the original adapter, rapid taps share a 1.6-second streak, a deliberate hover greets after 650 milliseconds, task start excites the pet, completion celebrates, and inactivity makes it sleepy. Nap pauses rendering. See `emotions.ts` for the other timing values.

`getPetScrollPath(progress, horizontalRange, verticalRange)` returns `{ x, y }`. Progress is clamped to 0 through 1, X ranges from the right dock toward negative horizontal offsets, and Y advances through the supplied vertical range. Four broad S turns return X to the dock at the end. Reversing progress retraces the path.

Use `stepPetSpring(state, target, deltaSeconds)` on each axis for movement with momentum. `scrollEmotion(speed)` takes signed pixels per millisecond, with equal reactions in either direction. `lookAt(x, y)` takes normalized values from -1 to 1. Travel velocity is signed pixels per millisecond.

The original `PetCompanion.tsx` reads `window.scrollY` and website section selectors such as `.exp-hero`, `#playground`, and `#workspaces`. AI-OS chat and workspace panels may scroll inside their own containers. Replace that scroll source and the chapter selectors before using this behavior there. Keep the pet within the app viewport and clear of message inputs, navigation, and window controls.

For the website guide reference, load styles in this order: `styles/companion-guide.css`, `pets/aetheria/animations.css`, then `styles/pet-companion.css`. The original guide also inherits website resets, font variables, and `--exp-ease`; supply equivalents in the host. Do not load the original website's entire global stylesheet into AI-OS.

## Accessibility and renderer lifecycle

The React pet is a native button with Enter and Space activation and a visible focus ring. Preserve those behaviors in a vanilla host. Keep a target of at least 44 pixels and provide an accessible name.

The renderer requires WebGL2 and returns `null` if it cannot obtain that context. Its readiness callback reports context loss and restoration. React automatically uses its SVG fallback; vanilla hosts must provide one. Initialization errors also need a host fallback.

Reduced-motion preferences stop the renderer's continuous motion, and the original CSS disables its animations. The renderer pauses when offscreen or when the document is hidden and caps pixel density at 1.75. Always call `dispose()` when removing it to release geometry, textures, observers, listeners, and the WebGL context.

## Verification and transfer scope

`npm run check` runs three checks:

- Strict TypeScript checking of the pet and scroll adapter. The Next.js-only `Companion.tsx` remains reference code.
- All seven copied behavior tests using Node's test runner.
- Browser bundles for the renderer, dynamics, and emotions.

The source manifest allows copied-file integrity checks with `Get-FileHash -Algorithm SHA256`. The generated bundles are rebuildable and are not committed.

This transfer leaves AI-OS's root package files, active UI, Electron settings, and existing edits untouched. The pet has not been mounted or visually verified inside AI-OS yet. After integration, check rendering, rapid taps, pointer gaze, task reactions, reduced motion, WebGL fallback, packaged asset paths, and cleanup when the host closes.

Transfer verification on 16 October 2026 passed: all 13 original-file SHA-256 comparisons, strict type checking, 7 of 7 behavior tests, and all three browser bundle builds. The renderer output is about 1.2 MB before minification. These checks do not replace the Electron visual and packaged-build checks listed above.
