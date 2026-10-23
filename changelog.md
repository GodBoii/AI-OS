# Changelog

---

## [v1.4.7] - October 23, 2026

Project file previews for source, Markdown, HTML, and Mermaid, browser takeover and recovery controls, and a settings sidebar split into six sections.

### 1. Project File Viewer and Rich Previews

- Added `ProjectFileViewer` with syntax highlighting for 30+ languages and configuration formats through `highlight.js`, including JavaScript, TypeScript, Python, Rust, C#, C/C++, Go, Bash, PowerShell, Dockerfile, YAML, TOML, Markdown, LaTeX, Elixir, Haskell, and CMake. Less common grammars (Protobuf, Nix, Dart, Scala, Groovy) load on demand, so they cost nothing until a matching file opens.
- Added a toggle between highlighted source and a formatted preview for Markdown, Mermaid, HTML, and SVG files. The button reports its state with `aria-pressed` and has a visible focus ring.
- Markdown previews render GitHub Flavored Markdown tables, blockquotes, fenced code, and embedded Mermaid diagrams through `marked`.
- HTML and SVG previews run in an iframe with an empty `sandbox` attribute. A Content Security Policy allows inline styles plus data and blob images and fonts, blocks scripts, network requests, and form posts, and DOMPurify sanitizes the markup. The frame also carries `referrerpolicy="no-referrer"` and cannot reach the parent page.
- Mermaid diagrams render with `securityLevel: 'strict'`, HTML labels disabled, and a 50 KB source limit. The rendered SVG is sanitized again, and diagrams follow the current light or dark theme.
- Large files stay readable. Previews stop at 300 KB, files above 100 KB show plain text with a notice instead of highlighting, and the preview toggle hides when content is truncated or has no formatted mode.
- Light and dark syntax colors come from shared tokens (`--syntax-keyword`, `--syntax-string`, `--syntax-number`, `--syntax-function`, `--syntax-comment`, `--syntax-variable`) so both themes stay consistent.

### 2. Faster Workspace Scanning

- Local workspace scans read directories in parallel batches of 8 instead of walking them one at a time.
- `readWorkspaceFile` accepts `previewOnly`, which reads at most 300 KB from the file handle and skips base64 encoding. Opening a large file in the tree no longer copies the whole file through IPC.
- Ignore rules now skip `node_modules`, `.git`, `__pycache__`, `.cache`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.venv*`, `venv`, and `.tox`.
- `LocalCoderHandler` reuses an existing file watcher when the workspace root has not changed.
- Preview requests and tree sync use revision counters, so a slow response cannot overwrite a newer file selection.
- The open preview reloads when its file changes on disk.

### 3. Browser Takeover and Recovery

- Added runtime controls under Settings > Browser: Take control, Pause, Resume automation, Restart to apply mode, and Close browser, plus status, tab list, and recent activity.
- Pause and takeover close the command gate immediately. A running action finishes, queued commands return a paused result, and nothing replays on resume. A generation counter drops commands that were queued before a pause and resume pair.
- When an agent needs the browser while automation is paused, a native prompt offers Resume browser actions or Keep paused. It works with Settings closed and with Chrome not running. Concurrent requests share one prompt. Declining or waiting 60 seconds leaves automation paused without showing the prompt again for that request.
- Settings > Browser keeps an Enable browser automation button visible while paused, stopped, or disconnected, including when Chrome is closed. Enabling does not launch Chrome.
- Recovery waits up to 30 seconds for active work before prompting. If the work is still running, the browser tool returns a paused result with a path to Settings instead of holding the request past its deadline.
- After takeover, page actions that use old element IDs or coordinates are rejected until the agent reads a fresh view. Status checks, tab listing, and explicit navigation still work.
- Pause affects browser execution only. It does not stop the model stream or the rest of the chat run.
- Opening a site for sign-in pauses automation and keeps tabs and page state. Takeover brings a background window to the primary display. Headless Chrome cannot show a window, so the UI offers a confirmed visible restart and explains that tabs and unsaved changes will close. Canceling leaves the session paused and intact.
- Close and restart wait for active work, invalidate queued commands, and leave automation paused. Chrome receives a graceful close request so cookies flush and profile locks release, with bounded termination as a fallback.
- Tab actions require a paused browser and use stable page identities instead of indexes. Closing a stale tab or the last remaining tab returns an error.
- Recent activity keeps the last 30 actions in memory and shows the latest 12. It records action names, timestamps, and outcomes only. It does not store typed text, credentials, screenshots, or raw command payloads. The UI shows hostnames without URL query strings.
- Cookie inspection and clearing remain in the Sign-in and site data card. An empty cookie list no longer implies that every site is signed out.

### 4. Settings Split into Sidebar Sections

- Replaced the single Settings tab with six sidebar sections: General, Appearance, Browser, Notifications, Keyboard Shortcuts, and Desktop Integration.
- Kept existing control IDs and stored preference keys, so moving controls between sections does not reset saved choices.
- Each section scrolls its content area to the top when opened and initializes its listeners and animated icons on demand.
- The sidebar now scrolls when the section list is taller than the window, and the content area can shrink without horizontal overflow.
- Settings cards no longer lift or pulse on hover. The glass shimmer and border accent remain.
- Removed the Account Skills tab. Its native tools now appear in an expanded Capabilities section with new Presentations, File Storage, and Memory entries, rewritten capability copy, and an inline SVG icon for Image Generation.

### 5. Dark Mode Polish

- Fixed GitHub panel tabs and native controls in dark mode with an explicit `color-scheme: dark` and darker tab backgrounds, muted labels, and pill indicators.

### 6. Tests and Documentation

- Added `js/tests/browser-runtime.test.js` covering lazy status reads, preference persistence, pause and resume ordering, queue recovery, bounded activity, real Chromium tab identities, cookie persistence, consent races, stale interactions, and slow work.
- Added `js/tests/browser-runtime-ui.test.js` covering takeover controls, keyboard use, save failures, restart confirmation, text escaping, both themes, responsive layouts, reduced motion, and refresh cleanup.
- Added `js/tests/fixtures/browser-runtime-electron.cjs` to verify that Electron takeover reveals a background window and keeps its page and form state.
- Added `js/tests/settings-sections-browser.test.js` covering section navigation, saved preferences, single-active panel behavior, stationary hover, and overflow.
- Added `js/tests/project-file-viewer-browser.test.js`, `js/tests/project-file-tree-browser.test.js`, and `js/tests/local-workspace-files.test.js` for highlighting, previews, sandboxing, themes, tree behavior, bounded reads, watcher reuse, and ignore rules.
- Added `docs/browser-controls.md` describing browser preferences, pause and resume behavior, tab and activity limits, and recovery scenarios.
- Isolated test environment variables in `js/tests/spelling-electron.test.js` so `ELECTRON_RUN_AS_NODE` no longer breaks the Electron spelling run.

### 7. Packaging and Maintenance

- Bumped the application version to `1.4.7` in `package.json` and `package-lock.json`.
- Built the Windows NSIS installer `aetheria-ai-Setup-1.4.7.exe`, its blockmap, `latest.yml`, and the unpacked `win-unpacked` distribution.
- Switched the native system assistant model to `xiaomi/mimo-v2.6-flash` for faster voice replies.

---

## [v1.4.6] - October 18, 2026

Groq Whisper Large v3 normal voice dictation, native Electron text editing and spelling context menus with custom dictionary support, Groq GPT OSS 120B conversation title generator, and desktop packaging.

### 1. Groq Whisper Large v3 Voice Dictation

- Routed normal microphone recording through Groq's high-speed Whisper Large v3 (`whisper-large-v3`) speech-to-text service.
- Added authenticated backend endpoint `POST /api/mic/dictate` with Bearer token authentication, rate limiting (20/min), and user subscription usage limit enforcement.
- Built server-side Groq client in `python-backend/groq_dictation.py` supporting multi-format audio conversion (`wav`, `webm`, `ogg`, `mp3`, `mp4`, `m4a`, `flac`), automatic language detection, and strict 8 MiB size limit validation.
- Implemented frontend `GroqSpeechInputHandler` with responsive audio waveform visualization, 2-minute recording timeout, and graceful cancellation without mutating composer state on page unload, chat switches, or sign-out.
- Decoupled normal dictation from the intelligent mic agent (`/api/mic/transcribe`), preserving self-correction capabilities on the intelligent mic while delivering fast, literal, zero-rewrite transcription for normal dictation.
- Removed dependency on local Windows speech recognition packs and external voice runtime setups.

### 2. Native Spelling Suggestions and Text Context Menu

- Integrated native Electron context menus via `installTextContextMenu` across the desktop application.
- Added inline spelling corrections directly in context menus with one-click word replacement via `contents.replaceMisspelling()`.
- Added custom dictionary management with "Add to dictionary" (`contents.session.addWordToSpellCheckerDictionary()`) and graceful handling of empty suggestion states.
- Enabled native clipboard and history actions: Undo, Redo, Cut, Copy, Paste, and Select All with contextual enable/disable states based on edit flags and selection status.
- Enabled spellchecking on input fields across the app:
  - Chat input and design prompt fields in `chat.html`.
  - Quick Prompt floating composer in `quick-prompt.html`.
  - Interactive plan editors in `js/chat.js`.
  - Task prose titles and descriptions in `to-do-list.html`.
  - User feedback input in `aios.html`.
- Implemented selective exclusion guards:
  - Excluded structured technical inputs (dates, tags, memory identifiers, deployment paths, and web slugs) from spellchecking.
  - Excluded generated HTML previews and remote iframe content from triggering desktop context menus.
- Preserved Quick Prompt window visibility and focus during context menu interaction, preventing the window from auto-dismissing when correcting spelling.
- Added keyboard accessibility support with Shift+F10 menu invocation and proper focus return.

### 3. Conversation Title Generation with Groq GPT OSS 120B

- Switched automatic conversation title generation from OpenRouter to Groq's `openai/gpt-oss-120b` model for near-instant title synthesis upon first message.
- Hardened title generator agent instructions with strict title-only guardrails: enforces single-line 3 to 4 word titles, prevents instruction injection or message execution, and prohibits Markdown/quotes formatting.

### 4. Tests and Verification

- Added `js/tests/spelling-electron.test.js` verifying Electron spelling replacements, undo/redo cycles, Quick Prompt menu focus preservation, preview exclusions, and keyboard shortcuts.
- Added `js/tests/fixtures/spelling-electron.cjs` isolated Electron test fixture.
- Added `js/tests/text-context-menu.test.js` testing menu exclusions, readonly selections, and navigation safety.
- Added `js/tests/groq-speech-input-browser.test.js` covering MediaRecorder capture, cancellation handling, exclusion guards, and audio waveform teardown.
- Added `python-backend/tests/test_groq_dictation.py` covering backend authentication, multi-format payloads, size constraints, and provider failure handling.
- Added `docs/voice-input.md` comprehensive architecture and configuration documentation.

### 5. Packaging and Maintenance

- Bumped application version to `1.4.6` in `package.json` and `package-lock.json`.
- Built production Windows installer `aetheria-ai-Setup-1.4.6.exe` and unpacked distribution.

---

## [v1.4.5] - October 16, 2026

Aetheria pet messenger for in-app notifications, unified multimodal model across all conversation modes, and full media support in interactive plans.

### 1. Aetheria Pet Messenger

- Replaced the glass-panel toast notification stack with an animated Aetheria pet character that delivers messages through speech bubbles.
- Rendered the pet as a code-native inline SVG with independent gaze, face, paws, antenna, and four-point star elements that respond to notification type.
- Added idle breathing, antenna pulse, and shadow bob animations using pure CSS keyframes with no external assets or render loops.
- Switched the pet to a happy expression (closed-eye arcs, hidden concern mouth) on success and info messages, and a concerned expression (raised brows, inverted mouth) on errors and warnings.
- Added a waving paw animation on success notifications using a 6-step rotation keyframe.
- Delivered notifications as speech bubbles with a folded-corner tail connecting to the pet character.
- Implemented message queuing with independent per-message timers that only count down while the message is visible and the tab is in the foreground.
- Added a pending message counter badge on the pet with scale-pop entrance animation.
- Added collapse and expand: clicking the pet toggles the speech bubble; pending messages queue silently while collapsed.
- Added swipe-to-dismiss gesture with velocity-based threshold detection and directional exit animation.
- Added optional two-note notification chimes using the Web Audio API oscillator, pitched by notification type.
- Added a "next" chevron control and retry action for actionable notifications.
- Added full keyboard accessibility: focus returns to the originating element after dismiss, and both Enter and Escape keys operate controls.
- Routed chat notifications, feature load errors, and general application messages through the pet messenger via `window.notificationService`.
- Added responsive safe-area insets for the notification container positioning.
- Styled light and dark mode variants with distinct paper, ink, border, and hover tokens.
- Added an interactive Aetheria messenger preview page for standalone visual testing.

### 2. Unified Multimodal Model and Mode Restrictions Removed

- Consolidated all model aliases (`DEEPSEEK_MODEL_ID`, `GLM_VIDEO_MODEL_ID`, `ULTRA_MODEL_ID`, `VIDEO_MODEL_ID`) to a single shared model (`xiaomi/mimo-v2.6-pro`).
- Removed the `ModelRoutingError` exceptions that blocked video in Ultra Think mode and prevented mode switches on video-locked conversations.
- Removed the client-side `validateAttachmentForCurrentMode` gate and the `FileAttachmentHandler` validate callback, allowing every media type in every composer mode.
- Removed the video-route sticky lock: attaching video no longer permanently sets the conversation to a restricted mode.
- Simplified `commitPrimaryRouteForSend` to only track the Ultra preference without checking or blocking media types.
- Removed the Ultra Think button tooltip and aria states that referenced video restrictions.
- Simplified `resolve_primary_model` to a single branch that preserves the Ultra route preference and passes everything else through the shared model.

### 3. Plan Mode Media and Attachment Support

- Forwarded user file attachments from the plan socket handler to the plan agent, including images, audio, video, and text documents.
- Added `process_files` and `build_inline_text_files_prompt` imports to the socket layer for plan requests.
- Prepended inline text attachment content to the plan prompt so the agent sees document text alongside the user's planning instructions.
- Added `media` and `attachment_text` parameters to `stream_plan` and passed processed media keyword arguments (`images`, `audio`, `videos`, `files`) into the agent's `run()` call.
- Passed `thinking_mode` from the plan socket request into turn data for interactive plan conversations.
- Referenced `DEFAULT_MODEL_ID` from the routing module in the plan agent instead of hardcoding the model string.
- Added inline text attachment forwarding in the agent runner's plan mode path.

### 4. Aetheria Pet Companion Module

- Added the `aetheria-pet` directory containing the standalone pet companion TypeScript/React codebase.
- Included pet character definition, emotion system, physics dynamics engine, animation CSS, and renderer.
- Included experience system components (`Companion`, `PetCompanion`, `StarMark`) and the experience library.
- Included companion guide and pet companion stylesheets.
- Added source manifest, TypeScript configuration, and package files.

### 5. Tests and Verification

- Added `notification-pet-browser.test.js` covering pet messenger timing, input queues, focus management, queue depth, collapse/expand, dismiss, theme switching, and accessibility.
- Added `multimodal-modes-browser.test.js` verifying mixed attachments are accepted in every composer mode and that no mode-based rejection gates remain.
- Added `test_plan_media.py` covering mixed media conversion, ownership checks, and both interactive and legacy plan socket paths with media and thinking mode forwarding.
- Updated `test_model_routing.py`: removed the three `ModelRoutingError` rejection tests, added parametrized coverage across all mode/route/file-type combinations confirming no exceptions are raised.
- Updated `desktop-shell-electron.test.js` test fixture reference.

### 6. Packaging and Maintenance

- Bumped application version to 1.4.5 in `package.json` and `package-lock.json`.
- Packaged Windows release installer `aetheria-ai-Setup-1.4.5.exe`.

---

## [v1.4.4] - October 16, 2026

Interactive agent question deck, rich internet search previews, chronological stream replay, reader-focused chat scrolling, and Windows computer-use hardening.

### 1. Interactive Agent Question Deck and Reasoning Disclosures

- Rendered agent clarification questions as collapsible reasoning tools with accessible step transitions and icon controls.
- Implemented a compact step-by-step card deck interface with forward/backward navigation and submission tracking.
- Kept question controls attached within reasoning containers across live streams, session recovery, and repository reloads.
- Added a 10-minute question expiration deadline with visual timeout alerts, automatic status updates, and retry support.
- Preserved pending question drafts and selection states across network reconnects and chat switches.
- Styled compact question cards, discrete chip selectors, high-contrast disclosure icons, and custom response text inputs.

### 2. Rich Internet Search Previews and Link Navigation

- Projected internet search events into compact, structured link cards with site names, page titles, and snippet context.
- Added responsive source rails and accordion toggles for previewing individual search sources without cluttering conversation history.
- Deferred favicon fetching until link disclosures expand to eliminate unnecessary background network requests.
- Routed external search results and link cards through the embedded desktop browser instead of external popups.
- Added full keyboard accessibility, touch navigation, and theme-adaptive color styling to search accordions.

### 3. Chronological Agent Stream Architecture and Replay

- Implemented structured activity streams that capture and persist tool invocations, reasoning blocks, and results in chronological order.
- Bound execution events to unique invocation IDs across agents and backend workers, preserving failure states and run metadata.
- Isolated primary agent outputs from internal reasoning blocks, keeping final responses clearly visible across tool boundaries.
- Replayed multi-agent conversations cleanly with exact chronological ordering and tool card state restoration.

### 4. Reader-Centric Scroll Engine and Jump-to-Latest Control

- Implemented intent-aware chat autoscrolling that follows live streams and expanding reasoning when the reader is pinned at the bottom.
- Prevented scroll hijacking: upward manual wheel scrolls, drag selections, and native scrollbar interactions pause auto-following immediately.
- Added a centered floating "Jump to Latest" button with subtle entrance animations, system accent branding, and theme adaptivity.
- Added full keyboard navigation for scrolling (Home/End keys) and accessible activation for the jump control.
- Preserved and restored independent scroll positions across nested reasoning containers and active chat threads.

### 5. Windows Computer-Use and System Accessibility Hardening

- Hardened native Windows computer-use handler with robust window target management and foreground validation.
- Improved coordinate translation and click reliability across diverse display DPI scaling configurations and multi-monitor setups.
- Updated Windows accessibility worker routines and added live reliability test harnesses for desktop automation workflows.

### 6. Packaging and Maintenance

- Bumped application version to 1.4.4 in `package.json` and `package-lock.json`.
- Packaged Windows release installer `aetheria-ai-Setup-1.4.4.exe`.

---

## [v1.4.3] - October 13, 2026

Desktop memory lifecycle optimizations and conversation PDF export.

### 1. Conversation PDF export

- Added scoped PDF export with an options dialog before saving.
- Added scope options to export either the full visible thread or only the latest assistant response.
- Added controls to include or exclude user attachments.
- Embedded image attachments as static previews capped at 1600px on the longest edge.
- Formatted non-image attachments with filenames, MIME types, and web links when valid URLs exist.
- Styled PDF output using a clean A4 layout, dark ink, lime accents, repeated table headers, and numbered footers.
- Rendered PDF export documents in light mode regardless of current application theme.
- Added saved history export support so saved sessions export their own prompts, answers, and attachments without using the active live chat.
- Printed documents through a hidden sandboxed Electron window with JavaScript execution disabled.

### 2. Desktop memory and performance optimizations

- Delayed initialization of native desktop handlers (computer control, local coder, browser tools) until first use.
- Deferred loading of workspace panels, charts, terminal components, and diagram renderers until requested.
- Added shared module loader promises so concurrent requests do not duplicate initialization.
- Packaged Mermaid, Markdown, and syntax highlighter bundles locally for offline loading.
- Capped session content caching to 12 entries and 16 MiB with a 5-minute eviction policy.
- Capped fallback terminal log output to 262,144 characters.
- Moved inactive completed conversation views to local IndexedDB storage after two idle views to free DOM nodes.
- Preserved background streams, question cards, and active controls when switching between conversations.
- Aborted obsolete history preview requests, stopped active media, and revoked temporary blob URLs on modal close or replacement.
- Switched local file caching from base64 strings to blob storage.
- Added individual IPC unsubscribe functions to avoid listener leaks on bridge replacement or view reloads.
- Excluded test fixtures from the production build package.

### 3. Packaging and maintenance

- Bumped application version to 1.4.3 in `package.json` and `package-lock.json`.
- Packaged Windows release installer `aetheria-ai-Setup-1.4.3.exe`.

---

## [Desktop Social Integrations: Facebook, Instagram, and YouTube] - August 2, 2026

Implemented complete Composio integrations for Facebook, Instagram, and YouTube in the Electron desktop application. Twitter was intentionally left out of this release and will be added separately later.

### 1. Composio Auth Configuration

**Files:** `python-backend/.env`, `python-backend/config.py`, `.gitignore`

- Added the supplied Composio Auth Config IDs:
  - Facebook: `ac_L0KUJnBw8x3S`
  - Instagram: `ac_14gNi-Ny4ExR`
  - YouTube: `ac_clncLKMqKTet`
- Added independent feature flags:
  - `COMPOSIO_ENABLE_FACEBOOK=true`
  - `COMPOSIO_ENABLE_INSTAGRAM=true`
  - `COMPOSIO_ENABLE_YOUTUBE=true`
- Added configuration variables for all three Auth Config IDs and feature flags in `python-backend/config.py`.
- Added `COMPOSIO_TOOLS_BASE_URL`, defaulting to Composio's v3.1 tool API.
- Added `python-backend/.env` to `.gitignore` so the existing Composio API key and integration configuration cannot be accidentally committed.
- Two enabled Instagram Auth Configs were present in Composio. This implementation uses `ac_14gNi-Ny4ExR`; the unused duplicate is `ac_qcUhMxYg4ToF`.

### 2. Electron Integrations UI

**Files:** `aios.html`, `css/integrations.css`, `js/aios.js`

- Added Facebook, Instagram, and YouTube rows to the desktop Integrations settings screen.
- Added provider-specific icons and brand colors.
- Added Connect/Disconnect buttons with these desktop provider identifiers:
  - `composio_facebook`
  - `composio_instagram`
  - `composio_youtube`
- Registered click handlers for every new integration.
- Added human-readable provider labels for callback notifications and error messages.
- Added signed-in, signed-out, connected, disconnected, loading, and error button states.

### 3. Hosted OAuth Connect Flow

**Files:** `js/aios.js`, `js/main.js`, `python-backend/api.py`

- The desktop app requests a server-generated Composio Connect Link instead of handling provider credentials locally.
- Added toolkit-specific Connect Link requests for `FACEBOOK`, `INSTAGRAM`, and `YOUTUBE`.
- OAuth authorization opens in the user's external browser.
- Added the trusted Electron callback providers to the deep-link allowlist.
- Added support for Composio's current callback parameters:
  - `status=success|failed`
  - `connected_account_id`
- Retained compatibility with the older `success` and camelCase callback parameters.
- Added success/failure notifications using the proper provider name.
- The app refreshes connection state after the browser authorization flow returns.
- Auth Config IDs are resolved only from backend environment variables. The client cannot submit an arbitrary Auth Config ID.
- Removed the raw Composio Connect Link response from the API response to avoid exposing unnecessary provider metadata to the Electron renderer.

### 4. Connection Status and Disconnect Support

**Files:** `js/aios.js`, `js/shuffle-menu-controller.js`, `python-backend/api.py`

- Added connection-status checks for each toolkit using the authenticated Aetheria user ID.
- Added a 30-second status cache so a completed external OAuth flow is reflected quickly.
- Status checks run independently; a temporary failure for one provider no longer marks every integration as disconnected.
- Added Disconnect support for all three providers.
- Explicit account deletion requests are checked against the authenticated user and requested toolkit before Composio is called.
- Status cache entries are cleared after creating a Connect Link or disconnecting an account.
- Added backend rate limits:
  - Status: 30 requests per minute
  - Tool catalog: 30 requests per minute
  - Connect Link creation: 10 requests per minute
  - Disconnect: 10 requests per minute

### 5. Backend Toolkit Allowlist and Security

**File:** `python-backend/api.py`

- Added `FACEBOOK`, `INSTAGRAM`, and `YOUTUBE` to the supported Composio toolkit allowlist.
- Applied allowlist validation to status, connect, disconnect, and tool-catalog endpoints.
- Unsupported or misspelled toolkit values now return HTTP 400.
- Kept Twitter outside the allowlist for this release.
- All Composio routes require a valid authenticated Aetheria user.
- Connected accounts remain scoped to the authenticated user's application user ID.

### 6. Composio v3.1 Tool Discovery and Execution

**File:** `python-backend/composio_client.py`

- Added a separate Composio v3.1 base URL for tool discovery and execution while retaining the v3 connected-account API.
- Added provider-filtered catalog requests using the deployed API's working `toolkit_slug` filter.
- Added `toolkit_versions=latest` to discovery and execution requests.
- Tool execution sends the active connected account ID, authenticated Aetheria user ID, and validated action arguments.
- Removed the deprecated Composio `entity_id` field.
- Live catalog verification returned only correctly prefixed actions for all three providers.

### 7. Dedicated Agent Toolkits

**File:** `python-backend/composio_tools.py`

- Added `ComposioFacebookTools` with `list_facebook_actions()` and `execute_facebook_action()`.
- Added `ComposioInstagramTools` with `list_instagram_actions()` and `execute_instagram_action()`.
- Added `ComposioYouTubeTools` with `list_youtube_actions()` and `execute_youtube_action()`.
- Consolidated shared execution behavior into the base Composio toolkit.
- Added reusable active-connection detection for any supported Composio toolkit.
- Enforced a list-first workflow so the agent discovers the current action schema before execution.
- Validated action slugs against the live provider catalog.
- Enforced provider prefixes (`FACEBOOK_`, `INSTAGRAM_`, or `YOUTUBE_`) to prevent cross-provider execution.
- Invalid JSON arguments, missing connections, unsupported slugs, and Composio API errors return controlled error messages.

### 8. Agent and Chat Runtime Integration

**Files:** `python-backend/assistant.py`, `python-backend/agent_runner.py`, `python-backend/sockets.py`, `python-backend/session_service.py`, `python-backend/plan_agent.py`, `js/chat.js`, `js/shuffle-menu-controller.js`

- Added the three integration flags to desktop chat configuration and session defaults.
- Added provider controls to the desktop tool-selection/shuffle menu.
- Toolkits are enabled only when the provider is enabled for the session and the current user has an ACTIVE Composio account for that provider.
- Added the new flags to normal chat execution, plan execution, socket configuration, session persistence, and agent-runner defaults.
- Added readable plan labels for Facebook, Instagram, and YouTube tools.
- Added agent account restrictions:
  - Facebook supports Facebook Pages, not personal Facebook accounts.
  - Instagram supports Business and Creator accounts, not personal accounts.
  - YouTube actions operate on the connected channel/account.
- Added external-action safety instructions: publishing, commenting, replying, messaging, editing, and deleting require clear user authorization. Ambiguous targets or intent require confirmation.

### 9. Provider Account Requirements

- Facebook users must authorize a Facebook Page; personal Facebook profiles are not supported by the toolkit.
- Instagram users must authorize an Instagram Business or Creator account.
- YouTube users authorize the Google/YouTube account that owns or manages the target channel.
- Provider OAuth tokens are stored and refreshed by Composio; they do not pass through the Electron renderer or AI model.

### 10. Documentation

**File:** `docs/03-INSTALLATION.md`

- Expanded the Composio installation section to include Facebook, Instagram, and YouTube.
- Documented the required Auth Config environment variables and provider feature flags.
- Kept Twitter out of the configuration examples for this release.

### 11. Tests and Verification

**File:** `python-backend/tests/test_composio_social_integrations.py`

- Added tests for provider-specific functions, list-first validation, cross-provider slug rejection, active-account execution, connected-account filtering, and Composio v3.1 catalog filtering.
- Verification results:
  - 5 new social integration tests passed.
  - Python compilation checks passed.
  - JavaScript syntax checks passed for all modified desktop files.
  - 8 computer-control regression tests passed.
  - 2 voice-input regression tests passed.
  - Live Composio discovery passed for Facebook, Instagram, and YouTube.
- The broader backend run reached 32 passing tests. Remaining failures are unrelated Android-layout tests referencing source files absent from this checkout.

### Files Modified Summary

| File | Change |
|------|--------|
| `.gitignore` | Prevented `python-backend/.env` from being committed |
| `aios.html` | Added Facebook, Instagram, and YouTube integration controls |
| `css/integrations.css` | Added provider icon styling and brand colors |
| `js/aios.js` | Added connect, disconnect, status, callback notifications, and button states |
| `js/main.js` | Added trusted Composio deep-link callback handling |
| `js/chat.js` | Enabled the three provider flags in desktop chat configuration |
| `js/shuffle-menu-controller.js` | Added connection-aware tool menu entries |
| `python-backend/.env` | Added Auth Config IDs and feature flags (local, ignored) |
| `python-backend/config.py` | Added provider configuration and v3.1 tools URL |
| `python-backend/api.py` | Added secure allowlisted OAuth, status, disconnect, and catalog APIs |
| `python-backend/composio_client.py` | Added current tool discovery and execution support |
| `python-backend/composio_tools.py` | Added dedicated Facebook, Instagram, and YouTube agent toolkits |
| `python-backend/assistant.py` | Injected active social toolkits and added usage/safety instructions |
| `python-backend/agent_runner.py` | Added provider defaults to agent runs |
| `python-backend/sockets.py` | Added active-connection gating for realtime and plan sessions |
| `python-backend/session_service.py` | Added persistent session defaults |
| `python-backend/plan_agent.py` | Added readable provider tool labels |
| `python-backend/tests/test_composio_social_integrations.py` | Added focused integration tests |
| `docs/03-INSTALLATION.md` | Documented setup for all three providers |

---

## [Task System Redesign] — May 29, 2026

Complete redesign and reimplementation of the task functionality — frontend UI/UX, backend execution engine, scheduling system, and output viewer.

---

### 1. Frontend — Full-Screen Task Panel Takeover

**Files:** `to-do-list.html`, `css/to-do-list.css`, `js/to-do-list.js`, `js/renderer.js`

- Replaced the old floating window panel (positioned `left: 60px`, fixed width `580px`) with a **full-screen takeover** that occupies the entire viewport minus the sidebar.
- When the task panel opens, the chat container and floating input are hidden. When it closes, they are restored.
- The panel uses `opacity` + `visibility` transitions (not `display: none`) for smooth fade in/out.
- Updated `renderer.js` → `updateToDoListVisibility()` to handle the chat hide/restore logic.

---

### 2. Frontend — Task Card Grid

**Files:** `to-do-list.html`, `css/to-do-list.css`, `js/to-do-list.js`

- Replaced the old `<ul>` list with a **CSS grid** (`repeat(auto-fill, minmax(290px, 1fr))`) that flows multiple cards into columns automatically.
- Each card shows: title, status badge, description (2-line clamp), schedule badge (amber), priority dot, tool badges.
- Cards have **staggered entrance animation** — each card gets `animation-delay: index * 55ms` with a `translateY(14px) → 0` + `opacity: 0 → 1` keyframe.
- Hover state: `translateY(-2px)` lift + amber border glow + action buttons fade in.
- Action buttons (view output, complete toggle, delete) appear on hover only, positioned top-right of card.
- The **view output (file icon) button** only renders on cards that have `task_work` content.
- Empty state shows a centered placeholder with icon and subtext.

---

### 3. Frontend — Enhanced Task Creation Modal

**Files:** `to-do-list.html`, `css/to-do-list.css`, `js/to-do-list.js`

Added new fields to the task creation form:

- **Schedule**: time picker (`Run At`) + date picker (`Start Date`)
- **Repeat**: dropdown — none, daily, weekdays (Mon–Fri), weekly, monthly, custom interval
- **Custom interval**: hidden by default, shown when repeat = "custom" — value + unit (hours/days/weeks)
- **Tools selection**: checkbox chips for Web Search, Server Browser, Email, Google Drive, Google Sheets, GitHub — amber accent when checked
- **Custom Instructions**: freeform textarea for AI behavior guidance
- **Priority** and **Tags** retained from original

**Timezone fix**: Schedule time is converted from local browser time to UTC ISO string using `new Date(\`${date}T${time}:00\`).toISOString()` before storing. Also stores `tz_offset_minutes` and `user_timezone` (e.g. `Asia/Kolkata`) in metadata for recurring schedule computation.

---

### 4. Frontend — Output Viewer Panel

**Files:** `to-do-list.html`, `css/to-do-list.css`, `js/to-do-list.js`

- Replaced the old `showTaskWorkModal()` centered overlay with a **dedicated floating output panel**.
- Panel is centered on screen (`top:50%; left:50%; transform: translate(-50%,-50%)`), sized `min(780px, 90vw)` × `min(680px, 90vh)`.
- Entry animation: scales from `0.94 → 1.0` + fade in with `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out).
- A **blurred backdrop** (`rgba(0,0,0,0.5)` + `backdrop-filter: blur(2px)`) dims the background; clicking it closes the panel.
- Panel header: amber file icon, task title, Download button, close button.
- Meta row: status badge, schedule time, tools list as chips.
- Body: scrollable markdown-rendered AI output at `0.92rem` font size, `line-height: 1.8`.
- **Download button**: generates a `.md` file named after the task title (sanitized), prepends a markdown header with status/schedule/tools/timestamp, triggers browser download via `Blob` + object URL.

---

### 5. Frontend — Design System: Blue → Amber

**Files:** `css/to-do-list.css`

- Replaced all blue accent colors (`#3b82f6`, `#60a5fa`) with amber (`#f59e0b`, `#fbbf24`).
- Defined CSS custom properties at `:root`:
  - `--task-accent: #f59e0b`
  - `--task-accent-dim: rgba(245,158,11,0.12)`
  - `--task-accent-border: rgba(245,158,11,0.35)`
  - `--task-accent-glow: rgba(245,158,11,0.4)`
- FAB button: amber background with black icon (better contrast), spring animation on hover (`cubic-bezier(0.34, 1.56, 0.64, 1)`).
- Primary buttons: amber background, black text, amber glow shadow.
- Focus rings, schedule badges, tool chip selection, section title icons all use amber.
- Toast success messages use amber with black text.
- Full light mode support added.

---

### 6. Frontend — Compact Task Detail Modal

**Files:** `js/to-do-list.js`

- Replaced the old detail modal (multiple padded section boxes, 16px gaps) with a compact **row-based layout**.
- Each piece of info (status, priority, description, schedule, tools, instructions, timezone, timestamps) renders as a single `task-detail-row` — label column (64px) + value inline.
- Status + priority share one row. Padding reduced from 16px to 8px per row. Gap between rows reduced from 16px to 8px.
- AI output is **not** shown in the detail modal — it's accessed via the dedicated output panel.

---

### 7. Backend — Task Executor Rewrite

**File:** `python-backend/task_executor.py`

- Removed the separate `TaskAgent` (which used `qwen/qwen3.6-plus:free`) for autonomous execution.
- Now uses the **main LLM-OS agent** (`get_llm_os()` from `assistant.py`) — the same Aetheria AI Team used for chat.
- Reads `metadata.tools` from the task to dynamically enable tools:
  - `internet_search` → `DuckDuckGoTools`
  - `browser` → `ServerBrowserTools`
  - `email` → `GoogleEmailTools`
  - `google_drive` → `GoogleDriveTools`
  - `google_sheets` → `GoogleSheetsTools`
  - `github` → `GitHubTools`
- Applies `metadata.custom_instructions` to the execution prompt.
- Saves AI output to `task_work` column and sets status to `completed` directly.
- Handles failure by reverting status to `pending`.

---

### 8. Backend — Schedule-Aware Task Poller

**File:** `python-backend/task_poller.py`

- Replaced the old 12-hour interval poller with a **60-second schedule-aware poller**.
- Uses a `threading.Lock` singleton to ensure only one poller instance per process.
- Uses a Redis NX lock (55s TTL) with random startup delay (1–5s) to ensure only one Gunicorn worker polls per cycle.
- `_is_task_due()` checks `metadata.next_run_at` first, then falls back to `deadline` field, then treats no-schedule tasks as immediately due.
- `_parse_datetime()` handles timezone-aware ISO strings — converts to UTC for comparison against `datetime.now(timezone.utc)`.
- Atomic DB claim: `UPDATE ... WHERE status='pending'` prevents duplicate execution even if lock timing overlaps.
- **Recurring task support**: after successful execution, `_handle_recurring()` computes the next `next_run_at` based on repeat pattern and resets status to `pending`:
  - `daily` → +1 day at same time
  - `weekdays` → next Mon–Fri at same time
  - `weekly` → +7 days
  - `monthly` → same day next month
  - `custom` → +N hours/days/weeks

---

### 9. Backend — Celery Attempt and Rollback

**File:** `python-backend/celery_app.py`, `python-backend/task_poller.py`

- Attempted to migrate task scheduling to **Celery Beat** to avoid duplicate poller threads across Gunicorn workers.
- Used `celery_app.conf.beat_schedule` and `@celery_app.task` decorators.
- Hit `ModuleNotFoundError: No module named 'task_poller'` — `autodiscover_tasks` expects Django-style package directories, not flat `.py` files.
- Switched to `celery_app.conf.include = ['task_poller']` — still failed because Celery Beat requires a separate running process (`celery beat`) which wasn't in the deployment.
- **Rolled back** to the thread-based poller with proper deduplication (Redis lock + process-level singleton). `celery_app.py` reverted to original state (no task includes).

---

### 10. Backend — Factory Startup

**File:** `python-backend/factory.py`

- Updated `start_task_poller()` call: poll interval changed from `43200` (12 hours) to `60` seconds.
- Log message updated to reflect schedule-aware execution.

---

### 11. Bug Fix — Timezone Mismatch

**Root cause:** Frontend was storing schedule time as a naive ISO string (e.g. `2026-05-28T08:55:00`) with no timezone info. Backend treated it as UTC. User setting 8:55 AM IST (UTC+5:30) resulted in the task firing at 2:25 PM IST instead.

**Fix:**
- Frontend: `new Date(\`${date}T${time}:00\`).toISOString()` — browser interprets input as local time and `.toISOString()` converts to UTC automatically.
- Backend: `_parse_datetime()` uses `datetime.fromisoformat()` with `.astimezone(timezone.utc)` for timezone-aware strings, and `.replace(tzinfo=timezone.utc)` for naive strings (assumed UTC).
- Metadata now stores `user_timezone: "Asia/Kolkata"` and `tz_offset_minutes: -330` for reference.

---

### 12. Bug Fix — Multiple Poller Instances on Startup

**Root cause:** Each Gunicorn worker spawned its own `TaskPoller` thread. The Redis NX lock was acquired simultaneously by all workers on startup before any could release it, resulting in 3–4 "Task poller loop started" log lines.

**Fix:** Added `threading.Lock` process-level singleton (`_poller_instance`) so `start_task_poller()` is a no-op if already called in the same process. Added random startup delay (1–5s) to stagger workers so they don't race for the Redis lock simultaneously.

---

### Files Modified Summary

| File | Change |
|------|--------|
| `to-do-list.html` | Complete rewrite — full-screen layout, card grid, enhanced creation modal, output panel, compact detail modal |
| `css/to-do-list.css` | Complete rewrite — amber design system, card animations, output panel, compact forms |
| `js/to-do-list.js` | Complete rewrite — card renderer, output panel, download, staggered animations, UTC timezone handling |
| `js/renderer.js` | `updateToDoListVisibility()` — hide/restore chat on task panel open/close |
| `python-backend/task_executor.py` | Rewrite — uses main LLM-OS agent, dynamic tool selection from metadata |
| `python-backend/task_poller.py` | Rewrite — 60s schedule-aware polling, UTC datetime parsing, recurring schedules, dedup |
| `python-backend/celery_app.py` | Reverted to original (Celery Beat approach abandoned) |
| `python-backend/factory.py` | Poll interval 43200 → 60, updated log message |
