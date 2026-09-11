# Task 06: Reduce Electron Startup Work

## Why this task exists

The desktop application loads many libraries and native modules before the user needs them. This increases startup time, memory use, JavaScript parsing, and the amount of work performed on the renderer's main thread.

## What happens today

`index.html` includes about 44 stylesheets and 29 scripts. It loads libraries for icons, Markdown, diagrams, code highlighting, math, charts, terminals, payments, sanitizing, and conversion, plus several Google font requests.

The renderer waits for authentication before loading some application logic, but module imports are already parsed and executed. Mermaid is initialized when the message formatter module is constructed. In the Electron main process, `js/main.js` eagerly loads handlers whose top-level dependencies include Puppeteer, Nut.js, window management, audio, file watching, and terminal modules.

The BrowserWindow is transparent and is shown immediately rather than being prepared off-screen and displayed when ready. The packaged application and assets are also large, including several PNG files over one megabyte.

## What should improve

Load only the shell needed for the first screen. Features such as Mermaid, charts, terminal emulation, browser automation, computer control, payments, and local coding should be dynamically imported when the user opens or invokes them.

Bundle and tree-shake renderer code so shared libraries are downloaded and parsed once. Serve production dependencies locally rather than depending on multiple CDNs. Reduce font families and weights. Convert large photographic PNG assets to WebP or AVIF, while keeping PNG only where lossless transparency is required.

In the main process, require heavy native handlers on first use. Show a small stable startup shell, then reveal the main window on `ready-to-show`.

## Implementation guidance

Create a startup trace with timestamps for Electron ready, window creation, first HTML paint, authentication restored, socket connected, and chat interactive. Use this trace to decide which import has the largest effect.

Split renderer code by feature. A dynamic import should include an in-flight promise so fast repeated clicks do not initialize the same feature twice. Preload likely features after the interface is interactive and the machine is idle.

Review whether a transparent top-level window is still required. If it is required for the design, limit transparent and blurred regions rather than making every screen pay the rendering cost.

## Risks and special cases

Lazy loading needs visible loading and error states. Offline installations must still work, which is another reason to package required libraries locally. Native modules need platform-specific smoke tests after packaging.

## Completion check

Measure cold and warm startup on representative Windows hardware. A warm launch should become interactive in under 1.5 seconds as a starting target. The first chat screen must not initialize browser automation, computer control, charts, Mermaid, terminal emulation, or payment code until those features are needed.
