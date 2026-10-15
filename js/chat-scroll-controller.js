// Follow the visible conversation without moving a reader who has scrolled back.
export class ChatScrollController {
    constructor(root, button, composer) {
        this.root = root;
        this.button = button;
        this.composer = composer;
        this.views = new Map();
        this.id = null;
        this.thread = null;
        this.frame = null;
        this.intent = null;
        this.observed = new Set();
        this.abort = new AbortController();
        const options = { signal: this.abort.signal, passive: true };
        root.addEventListener('wheel', event => {
            if (event.ctrlKey) return;
            const target = this.scrollTarget(event.target, Math.sign(event.deltaY));
            if (target && event.deltaY < 0 && target.scrollTop > 0) this.pause(target);
            if (target) this.noteIntent(target, Math.sign(event.deltaY));
        }, options);
        let touchY = null;
        root.addEventListener('touchstart', event => { touchY = event.touches[0]?.clientY; }, options);
        root.addEventListener('touchmove', event => {
            const y = event.touches[0]?.clientY;
            const target = this.scrollTarget(event.target, Math.sign(touchY - y));
            if (target && y > touchY && target.scrollTop > 0) this.pause(target);
            if (target) this.noteIntent(target, Math.sign(touchY - y));
            touchY = y;
        }, options);
        root.addEventListener('pointerdown', event => {
            const target = this.scrollTarget(event.target);
            if (target) this.noteIntent(target, 0);
        }, options);
        root.addEventListener('keydown', event => {
            if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
            if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
            const up = ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey);
            const target = this.scrollTarget(event.target, up ? -1 : 1);
            if (target && up) this.pause(target);
            if (target) this.noteIntent(target, up ? -1 : 1);
        }, { signal: this.abort.signal });
        root.addEventListener('scroll', event => this.onScroll(event.target), { ...options, capture: true });
        button?.addEventListener('click', () => {
            this.resume();
            // The button disappears after jumping. Keep keyboard focus in the conversation.
            if (document.activeElement === button) root.focus({ preventScroll: true });
        }, { signal: this.abort.signal });
        this.resize = new ResizeObserver(() => this.schedule());
        this.resize.observe(root);
        if (composer) this.resize.observe(composer);
        this.mutations = new MutationObserver(() => { this.observeContent(); this.schedule(); });
    }

    activate(id, thread) {
        this.mutations.disconnect();
        if (this.thread) this.resize.unobserve(this.thread);
        for (const node of this.observed) this.resize.unobserve(node);
        this.observed.clear();
        this.id = id;
        this.thread = thread;
        const existing = this.views.get(id);
        if (!existing) this.views.set(id, { mode: 'following', top: 0, target: null });
        if (thread) {
            this.mutations.observe(thread, { childList: true, characterData: true, subtree: true });
            this.resize.observe(thread);
        }
        if (existing?.mode === 'paused') this.root.scrollTo({ top: existing.top, behavior: 'instant' });
        if (existing?.mode === 'paused') {
            thread?.querySelectorAll('[data-follow-scroll-top]').forEach(node =>
                node.scrollTo({ top: Number(node.dataset.followScrollTop), behavior: 'instant' }));
        }
        this.observeContent();
        this.intent = null;
        this.schedule();
    }

    scrollTarget(node, direction = 0) {
        if (!(node instanceof Element)) return null;
        let target = node.closest('.reasoning-thought-content, .detailed-logs, #chat-messages');
        while (target && this.root.contains(target)) {
            if (!direction || target === this.root || (direction < 0 ? target.scrollTop > 0 : this.gap(target) > 0)) return target;
            target = target.parentElement?.closest('.reasoning-thought-content, .detailed-logs, #chat-messages');
        }
        return null;
    }

    noteIntent(target, direction) {
        this.intent = { target, direction, time: performance.now() };
        const view = this.views.get(this.id);
        if (view?.mode === 'paused' && !view.target?.deref()?.isConnected) view.target = new WeakRef(target);
    }

    pause(target) {
        const view = this.views.get(this.id);
        if (!view) return;
        view.mode = 'paused';
        view.target = new WeakRef(target);
        view.top = this.root.scrollTop;
        this.updateButton();
    }

    onScroll(target) {
        const view = this.views.get(this.id);
        if (!view || !this.root.contains(target)) return;
        const previous = target === this.root ? view.top : Number(target.dataset.followScrollTop || 0);
        const userInput = this.intent?.target === target && performance.now() - this.intent.time < 1500;
        if (userInput && target.scrollTop < previous - 1) this.pause(target);
        if (target === this.root) view.top = target.scrollTop;
        else target.dataset.followScrollTop = String(target.scrollTop);
        if (view.mode === 'paused' && view.target?.deref() === target && userInput
            && this.intent.direction >= 0 && target.scrollTop >= previous && this.gap(target) <= 12) {
            view.mode = 'following';
            view.target = null;
            this.schedule();
        }
        this.updateButton();
    }

    gap(node) {
        return Math.max(0, node.scrollHeight - node.clientHeight - node.scrollTop);
    }

    scopes() {
        const message = [...(this.thread?.querySelectorAll('.message-bot') || [])].at(-1);
        const nested = message ? [...message.querySelectorAll('.reasoning-thought-content, .detailed-logs')]
            .filter(node => node.getClientRects().length && node.clientHeight > 0) : [];
        // Finish the inner viewports before moving the surrounding chat.
        return [...nested.reverse(), this.root];
    }

    observeContent() {
        const message = [...(this.thread?.querySelectorAll('.message-bot') || [])].at(-1);
        const nodes = new Set(message?.querySelectorAll('.detailed-logs, .detailed-logs > *, .message-content') || []);
        for (const node of this.observed) if (!nodes.has(node)) this.resize.unobserve(node);
        for (const node of nodes) if (!this.observed.has(node)) this.resize.observe(node);
        this.observed = nodes;
    }

    resume() {
        const view = this.views.get(this.id);
        if (!view) return;
        view.mode = 'following';
        view.target = null;
        this.intent = null;
        this.schedule();
    }

    schedule(id = this.id) {
        if (id !== this.id || this.frame !== null) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            if (this.views.get(this.id)?.mode === 'following') {
                for (const node of this.scopes()) node.scrollTo({ top: node.scrollHeight, behavior: 'instant' });
            }
            this.updateButton();
        });
    }

    updateButton() {
        if (!this.button) return;
        const view = this.views.get(this.id);
        const pausedTarget = view?.target?.deref();
        const behind = this.scopes().some(node => this.gap(node) > 12)
            || (pausedTarget?.isConnected && pausedTarget.getClientRects().length > 0 && this.gap(pausedTarget) > 12);
        this.button.hidden = !this.thread?.querySelector('.message') || !behind || view?.mode !== 'paused';
        if (this.composer) {
            const bottom = this.root.parentElement.getBoundingClientRect().bottom;
            this.button.style.bottom = `${Math.max(12, bottom - this.composer.getBoundingClientRect().top + 12)}px`;
        }
    }

    forget(id) {
        this.views.delete(id);
        if (this.id === id) {
            this.mutations.disconnect();
            if (this.thread) this.resize.unobserve(this.thread);
            for (const node of this.observed) this.resize.unobserve(node);
            this.observed.clear();
            this.id = null;
            this.thread = null;
            this.intent = null;
            if (this.button) this.button.hidden = true;
        }
    }

    reassign(previousId, nextId) {
        if (this.views.has(previousId)) {
            this.views.set(nextId, this.views.get(previousId));
            this.views.delete(previousId);
        }
        if (this.id === previousId) this.id = nextId;
    }

    capture() {
        const view = this.views.get(this.id);
        if (view) view.top = this.root.scrollTop;
    }

    dispose() {
        this.abort.abort();
        this.mutations.disconnect();
        this.resize.disconnect();
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.views.clear();
        this.observed.clear();
    }
}
