// agent-activity.js - which agent runs are in flight, from the main process's view.
//
// A run starts when the renderer sends a chat message and ends on the
// backend's `response {done}` / `run_completed`, an error, or a disconnect.
// The tracker only keeps that bookkeeping; desktop-integration.js turns it
// into taskbar progress, thumbnail buttons and the power-save blocker.

const { EventEmitter } = require('events');

// A run that never reports back (crashed backend, lost event) must not keep
// the progress bar and the power-save blocker on forever.
const DEFAULT_RUN_TIMEOUT_MS = 45 * 60 * 1000;

const NON_RUN_MESSAGE_TYPES = new Set(['terminate_session', 'stop_run', 'pause_run', 'resume_run']);

/** True when a `send-message` payload starts an agent run. */
function isRunStartMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.type && NON_RUN_MESSAGE_TYPES.has(message.type)) return false;
    return Boolean(message.conversationId);
}

class AgentActivityTracker extends EventEmitter {
    constructor({ runTimeoutMs = DEFAULT_RUN_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        super();
        this.runTimeoutMs = runTimeoutMs;
        this._setTimer = setTimer;
        this._clearTimer = clearTimer;
        // key -> { conversationId, messageId, startedAt, timer }
        this._runs = new Map();
        this._paused = false;
    }

    get activeCount() {
        return this._runs.size;
    }

    get paused() {
        return this._paused && this._runs.size > 0;
    }

    activeConversationIds() {
        return [...new Set([...this._runs.values()].map((run) => run.conversationId))];
    }

    snapshot() {
        return { activeCount: this.activeCount, paused: this.paused, conversationIds: this.activeConversationIds() };
    }

    runStarted({ conversationId, messageId }) {
        if (!conversationId) return;
        const key = messageId || `conversation:${conversationId}`;
        const existing = this._runs.get(key);
        if (existing) this._clearTimer(existing.timer);
        // A new message in a conversation supersedes an older entry for it
        // that was keyed without a message id.
        this._deleteRun(`conversation:${conversationId}`);
        const timer = this._setTimer(() => this.runFinished({ messageId: key, outcome: 'timeout' }), this.runTimeoutMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
        this._runs.set(key, { conversationId, messageId: messageId || null, startedAt: Date.now(), timer });
        this._emitChange();
    }

    /**
     * Ends a run, matched by message id first and conversation id second.
     * Returns the finished run, or null when nothing matched.
     */
    runFinished({ messageId, conversationId, outcome = 'completed' } = {}) {
        let key = null;
        if (messageId && this._runs.has(messageId)) {
            key = messageId;
        } else if (conversationId) {
            for (const [candidate, run] of this._runs) {
                if (run.conversationId === conversationId) {
                    key = candidate;
                    break;
                }
            }
        }
        if (!key) return null;
        const run = this._runs.get(key);
        this._deleteRun(key);
        this.emit('run-finished', { ...run, timer: undefined, outcome });
        this._emitChange();
        return run;
    }

    /** Ends every run, e.g. after a socket disconnect or a backend error. */
    clearAll(outcome = 'aborted') {
        if (this._runs.size === 0) return;
        for (const key of [...this._runs.keys()]) {
            const run = this._runs.get(key);
            this._deleteRun(key);
            this.emit('run-finished', { ...run, timer: undefined, outcome });
        }
        this._emitChange();
    }

    setPaused(paused) {
        const next = Boolean(paused);
        if (next === this._paused) return;
        this._paused = next;
        this._emitChange();
    }

    dispose() {
        for (const run of this._runs.values()) this._clearTimer(run.timer);
        this._runs.clear();
        this.removeAllListeners();
    }

    _deleteRun(key) {
        const run = this._runs.get(key);
        if (!run) return;
        this._clearTimer(run.timer);
        this._runs.delete(key);
        if (this._runs.size === 0) this._paused = false;
    }

    _emitChange() {
        this.emit('change', this.snapshot());
    }
}

module.exports = { AgentActivityTracker, isRunStartMessage, DEFAULT_RUN_TIMEOUT_MS };
