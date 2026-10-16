// One Aetheria messenger, one speech bubble. Pending messages keep their own
// clocks, which only run while that message is visible and the user is away.
const DEFAULT_DURATION = 5000;
const MAX_PENDING = 20;
const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
const CLOSE_ICON = `${SVG_OPEN}<path d="m7 7 10 10M17 7 7 17"/></svg>`;
const RETRY_ICON = `${SVG_OPEN}<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4"/></svg>`;
const NEXT_ICON = `${SVG_OPEN}<path d="m9 6 6 6-6 6"/></svg>`;
const LABELS = { success: 'All done', error: 'Needs attention', warning: 'A heads-up', info: 'An update', connection: 'Connecting', 'computer-tool': 'On it' };
const SOUND_NOTES = { success: [587.33, 880], info: [587.33, 783.99], connection: [523.25, 698.46], 'computer-tool': [523.25, 659.25], warning: [466.16, 415.3], error: [392, 293.66] };

// A code-native character, so its gaze, face, paws and antenna can react
// independently. The four-point star borrows from Aetheria's existing mark.
const PET_SVG = `<svg viewBox="0 0 112 116" fill="none" aria-hidden="true" focusable="false">
    <ellipse class="pet-shadow" cx="57" cy="106" rx="31" ry="4"/>
    <g class="pet-character">
        <path class="pet-tail pet-body-fill" d="M81 82c23 7 26-13 17-17 3 10-8 10-15 6"/>
        <g class="pet-body">
            <path class="pet-body-fill" d="M28 56c-2-11 1-25 8-31 3-3 9 9 12 11 7-2 14-2 21 0 4-3 9-14 13-10 6 7 6 19 4 29 9 11 10 29 4 39-4 7-12 8-17 7-3 8-14 8-17 2-6 7-16 5-19-2-11 0-18-6-18-17 0-11 3-21 9-28Z"/>
            <path class="pet-ear" d="m34 35 3 12 6-6M77 35l-2 12-6-6"/>
            <path class="pet-belly" d="M38 88c8 4 24 5 35 0"/>
            <g class="pet-face">
                <g class="pet-eyes"><ellipse cx="44" cy="64" rx="3.2" ry="4.4"/><ellipse cx="68" cy="64" rx="3.2" ry="4.4"/></g>
                <g class="pet-happy-eyes"><path d="M40 64q4-6 8 0m16 0q4-6 8 0"/></g>
                <g class="pet-brows"><path d="m40 58 8-3m16 0 8 3"/></g>
                <path class="pet-smile" d="M52 74q4 4 8 0"/>
                <path class="pet-concern" d="M52 77q4-4 8 0"/>
                <ellipse class="pet-cheek" cx="35" cy="73" rx="4" ry="2"/><ellipse class="pet-cheek" cx="77" cy="73" rx="4" ry="2"/>
            </g>
            <path class="pet-paw pet-body-fill" d="M28 77c-12-1-12 12-3 14l8-2"/>
            <path class="pet-wave pet-body-fill" d="M83 79c13 0 16-13 9-15-5-1-5 6-11 5"/>
        </g>
        <g class="pet-antenna"><path d="m55 34 1-12"/><path class="pet-star" d="M57 7c1 9 2 10 10 11-8 1-9 2-10 10-1-8-2-9-10-10 8-1 9-2 10-11Z"/></g>
    </g>
</svg>`;

class NotificationService {
    constructor() {
        this.notifications = [];
        this.defaultDuration = DEFAULT_DURATION;
        this.enabled = true;
        this.soundEnabled = false;
        this.activeId = null;
        this.collapsed = false;
        this.interacting = false;
        this.dragging = false;
        this.focusOrigin = null;
        this._audioContext = null;
        this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.createContainer();
        document.addEventListener('visibilitychange', () => {
            this.container.classList.toggle('is-background', document.hidden);
            this.syncTimers();
        });
        this.resizeObserver = new ResizeObserver(() => {
            const active = this.active();
            if (active && !this.collapsed) this.addDisclosure(active);
        });
        this.resizeObserver.observe(this.speech);
    }

    createContainer() {
        this.container = document.createElement('section');
        this.container.className = 'unified-notification-container';
        this.container.setAttribute('aria-label', 'Aetheria notifications');
        this.container.inert = true;
        this.container.innerHTML = `<div class="notification-speech" id="aetheria-pet-speech"></div>
            <button type="button" class="notification-pet" aria-label="Hide notification" aria-expanded="true" aria-controls="aetheria-pet-speech">
                ${PET_SVG}<span class="pet-message-count" aria-hidden="true"></span>
            </button>
            <div class="notification-announcer" role="status" aria-atomic="true"></div>
            <div class="notification-announcer notification-urgent" role="alert" aria-atomic="true"></div>`;
        this.speech = this.container.querySelector('.notification-speech');
        this.pet = this.container.querySelector('.notification-pet');
        document.body.appendChild(this.container);
        this.pet.addEventListener('click', () => {
            this.collapsed = !this.collapsed;
            this.updatePet();
            this.syncTimers();
        });
        this.container.addEventListener('pointerenter', (event) => {
            if (event.pointerType === 'touch') return;
            this.interacting = true;
            this.syncTimers();
        });
        this.container.addEventListener('pointerleave', () => {
            this.interacting = false;
            this.pet.style.removeProperty('--pet-look-x');
            this.pet.style.removeProperty('--pet-look-y');
            this.syncTimers();
        });
        this.container.addEventListener('pointermove', (event) => {
            if (event.pointerType === 'touch' || this.prefersReducedMotion()) return;
            const rect = this.pet.getBoundingClientRect();
            this.pet.style.setProperty('--pet-look-x', `${Math.max(-3, Math.min(3, (event.clientX - rect.x - rect.width / 2) / 35))}px`);
            this.pet.style.setProperty('--pet-look-y', `${Math.max(-2, Math.min(2, (event.clientY - rect.y - rect.height / 2) / 45))}px`);
        });
        this.container.addEventListener('focusin', (event) => {
            if (event.relatedTarget && !this.container.contains(event.relatedTarget)) this.focusOrigin = event.relatedTarget;
            this.syncTimers();
        });
        this.container.addEventListener('focusout', () => queueMicrotask(() => this.syncTimers()));
        this.container.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            if (this.activeId) this.remove(this.activeId);
        });
    }

    show(message, type = 'info', duration = this.defaultDuration) {
        if (!this.enabled && type !== 'connection') return null;
        const knownType = Object.hasOwn(LABELS, type) ? type : 'info';
        const safeDuration = duration === null || duration === 0 ? null
            : Number.isFinite(duration) && duration > 0 ? duration : this.defaultDuration;
        const notification = this.createNotification(String(message), knownType, safeDuration);
        this.addNotification(notification);
        if (this.soundEnabled) this.playNotificationSound(knownType);
        return notification.id;
    }

    showConnection(message, showRetry = false) {
        // Replace an obsolete connection state before selecting the next message.
        this.notifications.filter(item => item.type === 'connection').forEach(item => this.detach(item));
        const notification = this.createNotification(String(message), 'connection', null, showRetry);
        this.addNotification(notification);
        return notification.id;
    }

    showComputerTool(message, action) {
        if (!this.enabled) return null;
        const notification = this.createNotification(String(message), 'computer-tool', 3000);
        notification.action = action;
        this.addNotification(notification);
        return notification.id;
    }

    removeConnectionNotifications() {
        this.notifications.filter(item => item.type === 'connection').forEach(item => this.remove(item.id));
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (!this.enabled) this.notifications.filter(item => item.type !== 'connection').forEach(item => this.remove(item.id));
    }

    setSoundEnabled(enabled) { this.soundEnabled = Boolean(enabled); }

    clear() { [...this.notifications].forEach(item => this.remove(item.id)); }

    createNotification(message, type, duration, showRetry = false) {
        const id = `notification-${crypto.randomUUID()}`;
        const element = document.createElement('article');
        element.className = `unified-notification notification-${type}`;
        element.dataset.notificationId = id;
        element.hidden = true;
        element.innerHTML = `<div class="notification-surface">
            <header class="notification-heading"><span class="notification-name">Aetheria</span>
                <span class="notification-type"></span>
                <button type="button" class="notification-close" aria-label="Dismiss notification">${CLOSE_ICON}</button>
            </header>
            <div class="notification-content"><p class="notification-message is-collapsed" id="${id}-message"></p></div>
            <div class="notification-actions"></div>
            <span class="notification-progress-fill" aria-hidden="true"></span>
        </div>`;
        const offline = type === 'connection' && !navigator.onLine;
        element.querySelector('.notification-type').textContent = offline ? 'Offline' : showRetry ? 'Connection lost' : LABELS[type];
        element.querySelector('.notification-message').textContent = message;
        element.querySelector('.notification-close').addEventListener('click', (event) => {
            event.stopPropagation();
            this.remove(id);
        });
        const notification = { id, element, surface: element.firstElementChild, type, duration, message,
            showRetry, offline, expanded: false, retrying: false, timer: null, isLeaving: false };
        if (showRetry) {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'notification-retry-btn';
            retry.innerHTML = `${RETRY_ICON}<span>Try again</span>`;
            retry.addEventListener('click', (event) => {
                event.stopPropagation();
                const ipc = window.electron?.ipcRenderer || window.ipcRenderer;
                if (ipc?.send) {
                    ipc.send('restart-python-bridge');
                    notification.retrying = true;
                    retry.disabled = true;
                    retry.querySelector('span').textContent = 'Retrying…';
                    this.updatePet();
                    notification.retryTimeout = window.setTimeout(() => {
                        retry.disabled = false;
                        notification.retrying = false;
                        retry.querySelector('span').textContent = 'Try again';
                        this.updatePet();
                    }, 5000);
                } else {
                    retry.querySelector('span').textContent = 'Open the desktop app to retry';
                }
            });
            element.querySelector('.notification-actions').appendChild(retry);
        }
        this.setupSwipe(notification);
        return notification;
    }

    active() { return this.notifications.find(item => item.id === this.activeId && !item.isLeaving); }
    pending() { return this.notifications.filter(item => !item.isLeaving); }
    priority(item) { return item.type === 'error' || item.showRetry ? 3 : item.type === 'warning' ? 2 : 1; }

    addNotification(notification) {
        this.notifications.push(notification);
        this.speech.appendChild(notification.element);
        const active = this.active();
        if (!active || (!this.shouldHoldTimers() && this.priority(notification) > this.priority(active))) {
            this.select(notification);
        }
        // Keep memory bounded during long automated runs. Preserve connection
        // state and the current message; evict routine notices before failures.
        while (this.pending().length > MAX_PENDING) {
            const candidates = this.pending().filter(item => item.id !== this.activeId && item.type !== 'connection');
            candidates.sort((a, b) => this.priority(a) - this.priority(b));
            if (!candidates[0]) break;
            this.detach(candidates[0]);
        }
        this.updatePet();
        this.syncTimers();
    }

    select(notification) {
        const hadFocus = this.speech.contains(document.activeElement);
        this.notifications.forEach(item => { item.element.hidden = item !== notification; });
        this.activeId = notification.id;
        this.collapsed = false;
        this.container.inert = false;
        this.container.classList.add('has-notifications');
        this.addDisclosure(notification);
        this.updatePet();
        if (!notification.timer && notification.duration) {
            // This invisible WAAPI clock retains exact remaining time when paused.
            notification.timer = notification.element.querySelector('.notification-progress-fill').animate(
                [{ opacity: 0 }, { opacity: 0 }], { duration: notification.duration });
            notification.timer.onfinish = () => this.remove(notification.id);
        }
        if (!this.prefersReducedMotion()) {
            notification.element.animate([
                { opacity: 0, transform: 'translateY(8px) scale(0.98)' },
                { opacity: 1, transform: 'translateY(0) scale(1)' }
            ], { duration: 350, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        }
        if (hadFocus) notification.element.querySelector('button').focus({ preventScroll: true });
        const urgent = notification.type === 'error' || notification.type === 'warning' || notification.showRetry;
        const announcer = this.container.querySelector(urgent ? '.notification-urgent' : '[role="status"]');
        this.container.querySelectorAll('.notification-announcer').forEach(node => { node.textContent = ''; });
        announcer.textContent = `${notification.element.querySelector('.notification-type').textContent}. ${notification.message}`;
        this.syncTimers();
    }

    addDisclosure(notification) {
        const message = notification.element.querySelector('.notification-message');
        if (notification.element.querySelector('.notification-details') || message.scrollHeight <= message.clientHeight + 1) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'notification-details';
        button.textContent = 'Read more';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', message.id);
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            notification.expanded = !notification.expanded;
            message.classList.toggle('is-collapsed', !notification.expanded);
            button.setAttribute('aria-expanded', String(notification.expanded));
            button.textContent = notification.expanded ? 'Show less' : 'Read more';
            if (notification.expanded) message.tabIndex = 0;
            else message.removeAttribute('tabindex');
            this.syncTimers();
        });
        message.after(button);
    }

    updatePet() {
        const pending = this.pending();
        const active = this.active();
        if (pending.length === 0) {
            if (this.container.contains(document.activeElement) && this.focusOrigin?.isConnected) {
                this.focusOrigin.focus({ preventScroll: true });
            }
            this.container.classList.remove('has-notifications');
            this.container.inert = true;
            this.interacting = false;
            return;
        }
        this.container.classList.toggle('is-tucked', this.collapsed);
        this.speech.inert = this.collapsed;
        this.speech.setAttribute('aria-hidden', String(this.collapsed));
        this.pet.setAttribute('aria-expanded', String(!this.collapsed));
        this.pet.setAttribute('aria-label', `${this.collapsed ? 'Show' : 'Hide'} notification${pending.length > 1 ? `, ${pending.length} messages` : ''}`);
        const count = this.pet.querySelector('.pet-message-count');
        count.textContent = pending.length > 1 ? String(pending.length) : '';
        if (active) {
            this.container.dataset.mood = active.retrying ? 'connection' : active.offline ? 'warning' : active.showRetry ? 'error' : active.type;
            let next = active.element.querySelector('.notification-next');
            if (pending.length > 1 && !next) {
                next = document.createElement('button');
                next.type = 'button';
                next.className = 'notification-next';
                next.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const items = this.pending();
                    const index = items.findIndex(item => item.id === this.activeId);
                    this.select(items[(index + 1) % items.length]);
                    this.active().element.querySelector('.notification-next')?.focus({ preventScroll: true });
                });
                active.element.querySelector('.notification-actions').appendChild(next);
            }
            if (next) {
                next.hidden = pending.length < 2;
                next.innerHTML = `<span>${pending.length - 1} more</span>${NEXT_ICON}`;
                next.setAttribute('aria-label', `Next notification, ${pending.length - 1} more`);
            }
            let clear = active.element.querySelector('.notification-clear');
            if (pending.length > 1 && !clear) {
                clear = document.createElement('button');
                clear.type = 'button';
                clear.className = 'notification-clear';
                clear.textContent = 'Dismiss all';
                clear.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.clear();
                });
                active.element.querySelector('.notification-actions').appendChild(clear);
            }
            if (clear) clear.hidden = pending.length < 2;
        }
    }

    remove(id) {
        const notification = this.notifications.find(item => item.id === id);
        if (!notification || notification.isLeaving) return;
        notification.isLeaving = true;
        notification.timer?.cancel();
        if (id !== this.activeId) {
            this.detach(notification);
            this.updatePet();
            return;
        }
        const hadFocus = notification.element.contains(document.activeElement) || document.activeElement === this.pet;
        notification.element.inert = true;
        notification.element.classList.add('hide');
        if (this.pending().length === 0) {
            this.container.classList.remove('has-notifications');
            this.container.inert = true;
            this.interacting = false;
            if (hadFocus && this.focusOrigin?.isConnected) this.focusOrigin.focus({ preventScroll: true });
        } else if (hadFocus) this.pet.focus({ preventScroll: true });
        window.setTimeout(() => {
            this.detach(notification);
            // A new arrival may already have taken over during the exit.
            if (!this.active()) {
                const next = this.pending().sort((a, b) => this.priority(b) - this.priority(a))[0];
                if (next) {
                    this.select(next);
                    if (hadFocus) next.element.querySelector('button').focus({ preventScroll: true });
                }
            }
            this.updatePet();
            this.syncTimers();
        }, this.prefersReducedMotion() ? 0 : 200);
    }

    detach(notification) {
        if (notification.element.contains(document.activeElement)) this.pet.focus({ preventScroll: true });
        notification.timer?.cancel();
        window.clearTimeout(notification.retryTimeout);
        notification.element.remove();
        this.notifications = this.notifications.filter(item => item !== notification);
        if (this.activeId === notification.id) this.activeId = null;
    }

    setupSwipe(notification) {
        const surface = notification.surface;
        let pointerId = null;
        let startX = 0;
        let distance = 0;
        const reset = () => {
            pointerId = null;
            distance = 0;
            this.dragging = false;
            surface.style.transform = '';
            surface.style.opacity = '';
            notification.element.classList.remove('is-dragging');
            this.syncTimers();
        };
        surface.addEventListener('pointerdown', (event) => {
            if (pointerId !== null || notification.isLeaving || event.target.closest('button') || event.button !== 0) return;
            pointerId = event.pointerId;
            startX = event.clientX;
            surface.setPointerCapture(pointerId);
            this.dragging = true;
            this.syncTimers();
        });
        surface.addEventListener('pointermove', (event) => {
            if (event.pointerId !== pointerId) return;
            distance = Math.max(0, event.clientX - startX);
            if (distance < 6) return;
            notification.element.classList.add('is-dragging');
            surface.style.transform = `translateX(${distance}px)`;
            surface.style.opacity = String(Math.max(0.2, 1 - distance / 250));
        });
        surface.addEventListener('pointerup', (event) => {
            if (event.pointerId !== pointerId) return;
            if (distance > 6) {
                const suppressClick = click => { click.preventDefault(); click.stopPropagation(); };
                notification.element.addEventListener('click', suppressClick, { capture: true, once: true });
                window.setTimeout(() => notification.element.removeEventListener('click', suppressClick, true), 350);
            }
            if (distance >= 82) this.remove(notification.id);
            reset();
        });
        surface.addEventListener('lostpointercapture', reset);
        surface.addEventListener('pointercancel', reset);
    }

    shouldHoldTimers() {
        return this.interacting || this.dragging || this.collapsed || document.hidden
            || this.container.contains(document.activeElement) || Boolean(this.active()?.expanded);
    }

    syncTimers() {
        const hold = this.shouldHoldTimers();
        this.notifications.forEach(item => {
            if (!item.timer || item.isLeaving) return;
            if (hold || item.id !== this.activeId) item.timer.pause();
            else if (item.timer.playState === 'paused') item.timer.play();
        });
    }

    prefersReducedMotion() { return this._reducedMotion.matches; }

    getAudioContext() {
        if (this._audioContext) return this._audioContext;
        const Constructor = window.AudioContext || window.webkitAudioContext;
        if (!Constructor) return null;
        try { this._audioContext = new Constructor(); }
        catch { return null; }
        return this._audioContext;
    }

    playNotificationSound(type = 'info') {
        const context = this.getAudioContext();
        if (!context) return;
        if (context.state === 'suspended') context.resume().catch(() => {});
        const master = context.createGain();
        master.gain.value = 0.06;
        master.connect(context.destination);
        (SOUND_NOTES[type] || SOUND_NOTES.info).forEach((frequency, index) => {
            const at = context.currentTime + index * 0.07;
            const oscillator = context.createOscillator();
            const envelope = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = frequency;
            envelope.gain.setValueAtTime(0.0001, at);
            envelope.gain.exponentialRampToValueAtTime(1, at + 0.012);
            envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
            oscillator.connect(envelope);
            envelope.connect(master);
            oscillator.start(at);
            oscillator.stop(at + 0.26);
            oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
        });
        window.setTimeout(() => master.disconnect(), 500);
    }
}

const notificationService = new NotificationService();
if (typeof module !== 'undefined' && module.exports) module.exports = notificationService;
window.notificationService = notificationService;
window.NotificationService = notificationService;
