# Desktop memory optimization implementation plan

Scope: desktop Electron main/preload and renderer code only. Preserve live Markdown streaming, window transparency, blur, backend protocols, authentication, background runs, exports, and native integrations.

1. Add regression coverage for artifact reuse and ownership, preview replacement/close races, bounded caches, conversation switching, lazy initialization, and IPC listener cleanup.
2. Reuse artifact IDs for each streamed code block. Release conversation-owned entries when their conversation is removed. Do not change streaming cadence or formatting.
3. Give history previews explicit request and media lifetimes. Abort obsolete requests, revoke blob URLs, stop media, and clear preview DOM on close/replacement.
4. Bound session caches by age, entry count, and estimated bytes. Cap the basic terminal fallback log. Keep selected conversation DOM mounted and preserve background streams and question-card behavior when switching conversations.
5. Load optional renderer libraries and desktop handlers on demand. Share initialization work between concurrent callers, retry failures, and keep offline-required assets local. Verify startup and first-use paths.
6. Return individual IPC unsubscribe functions. Replace synchronous frontend settings/profile/file access with asynchronous operations without changing persisted formats. Clean resources on conversation deletion, logout, and document shutdown.
7. Run focused regressions, relevant existing browser/Electron/native tests, syntax checks, and an unpacked production build. Verify packaged lazy resources and native module loading. Report measured checks separately from unmeasured RAM improvements.

Commit policy: commit each changed file separately and push tested changes to the configured origin. Keep generated builds, logs, credentials, and unrelated files out of commits.

Validation scenarios: repeated code-block streaming, repeated image/video previews, close while fetching, rapid preview replacement, expired/many sessions, concurrent background runs, question cards, return to previous conversation, terminal fallback overflow, first-use and repeated library loading, failed-load retry, IPC unsubscribe, authentication restore/logout, and native feature first use.

## Implemented behavior

- Stream and plan code blocks keep stable artifact IDs, including code blocks before and after a deferred diagram. Conversation removal releases owned artifacts.
- History previews abort obsolete work, stop media, clear their DOM and revoke blob URLs. Local images use blobs instead of base64 copies.
- Session content uses a five-minute cache with at most 12 entries and 16 MiB of estimated serialized data. The plain terminal fallback retains at most 262,144 characters.
- Completed inactive conversation views move to local IndexedDB after two idle views. Reopening restores artifacts, copy actions, reasoning controls and attachment previews. Selected views, running conversations, pending questions, editable plans, media and interactive diagrams retain their live nodes to preserve their controls. Logout clears the local view store.
- Optional workspace modules, Mermaid, charts, terminal libraries, checkout and native desktop handlers load on first use. Concurrent callers share loading work. Failed module loads retry independently without duplicating successfully initialized panels.
- Frontend settings, profiles, feedback and file-cache storage use asynchronous filesystem operations with ordered writes. IPC and bridge subscriptions have owned cleanup. Cached authentication publishes readiness before notifying startup listeners.
- Live Markdown parsing, stream cadence, transparency and blur are unchanged. No backend or CSS files were edited. Test fixtures are excluded from production packaging.

## Validation

- The complete JavaScript test suite passed 111 tests, including the existing browser, Electron, computer control, native integration, typing and speech checks.
- `npm run test:desktop-memory` covers resource lifetimes and the actual Electron shell with fixture authentication and network responses. It exercises background chat completion, disk restoration, restored attachments and copy actions, first-use workspace loading, failed-module retry, terminal limits and logout.
- An unpacked Windows build was produced with the locally installed Electron distribution. Packaged native browser/computer/local-coder modules loaded successfully, and the packaged PTY executed a fixed smoke command.
- RAM savings in MiB for the installed app have not been measured. Validation proves allocation counts, cache limits, resource cleanup and preserved workflows; it does not establish an end-to-end memory reduction percentage.
