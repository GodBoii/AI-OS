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
