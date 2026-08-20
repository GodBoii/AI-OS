// notification-service.js - in-app notification (toast) system.
//
// Renders transient toasts in the bottom-right corner. This is the in-app
// surface only; OS-level notifications are handled by native-notification-service.js
// in the main process.
//
// Behaviour worth knowing:
//   - The countdown hairline *is* the dismiss clock. It is a Web Animations API
//     animation, so pause and resume are exact and cannot drift from the bar.
//   - Hovering, focusing, or backgrounding the window holds every timer in the
//     stack, not just the one under the cursor.
//   - Dismissing runs in two beats: the card exits, then the surviving cards
//     glide into their new positions (FLIP, transform only).
//   - Icons are inline SVG rather than Font Awesome, which is loaded from a CDN
//     and would render as empty boxes on a cold offline start.

const DEFAULT_DURATION = 5000;
const MAX_VISIBLE = 4;

// Horizontal pointer travel before a press turns into a swipe, and how far the
// card has to travel before releasing it means "dismiss".
const DRAG_START_PX = 6;
const DRAG_DISMISS_PX = 82;
const DRAG_FADE_PX = 220;

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

// `--draw-len` is the measured path length, rounded up. It drives the
// stroke-dashoffset reveal in notifications.css.
const ICONS = {
    success: `${SVG_OPEN}<circle cx="12" cy="12" r="8.6"/>`
        + '<path class="notification-icon-draw" style="--draw-len:11" d="M8.4 12.3l2.5 2.5 4.7-5.2"/></svg>',

    error: `${SVG_OPEN}<circle cx="12" cy="12" r="8.6"/>`
        + '<path class="notification-icon-draw" style="--draw-len:16" d="M9.3 9.3l5.4 5.4M14.7 9.3l-5.4 5.4"/></svg>',

    warning: `${SVG_OPEN}<path d="M12 4.4 2.9 19.6h18.2L12 4.4Z"/>`
        + '<path class="notification-icon-draw" style="--draw-len:4" d="M12 10.1v3.9"/>'
        + '<path d="M12 17h.01"/></svg>',

    info: `${SVG_OPEN}<circle cx="12" cy="12" r="8.6"/>`
        + '<path d="M12 11.2v5"/><path d="M12 7.9h.01"/></svg>',

    connection: `${SVG_OPEN}<circle cx="12" cy="12" r="8.4" opacity="0.28"/>`
        + '<path d="M20.4 12A8.4 8.4 0 0 0 12 3.6"/></svg>',

    'computer-tool': `${SVG_OPEN}<rect x="3" y="4.6" width="18" height="11.8" rx="2.2"/>`
        + '<path d="M9 20h6M12 16.4V20"/></svg>'
};

const CLOSE_ICON = `${SVG_OPEN}<path d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4"/></svg>`;
const RETRY_ICON = `${SVG_OPEN}<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4h-4"/></svg>`;

// Two-note cues. Success and info rise, failure falls.
const SOUND_NOTES = {
    success: [587.33, 880],
    info: [587.33, 783.99],
    connection: [523.25, 698.46],
    'computer-tool': [523.25, 659.25],
    warning: [466.16, 415.3],
    error: [392, 293.66]
};

class NotificationService {
    constructor() {
        this.notifications = [];
        this.maxVisible = MAX_VISIBLE;
        this.defaultDuration = DEFAULT_DURATION;
        this.container = null;
        this.enabled = true;
        this.soundEnabled = false;

        this.hovered = new Set();
        this.focused = new Set();

        this._cssCache = new Map();
        this._audioContext = null;
        this._reducedMotion = window.matchMedia
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;

        this.init();
    }

    init() {
        this.createContainer();

        // A toast that expires while the app is in the background was never seen.
        document.addEventListener('visibilitychange', () => this.syncTimers());
    }

    createContainer() {
        if (this.container) return;

        this.container = document.createElement('div');
        this.container.className = 'unified-notification-container';
        this.container.setAttribute('role', 'region');
        this.container.setAttribute('aria-label', 'Notifications');
        this.container.setAttribute('aria-live', 'polite');
        this.container.setAttribute('aria-relevant', 'additions');
        document.body.appendChild(this.container);
    }

    // ---------------------------------------------------------------- public

    show(message, type = 'info', duration = this.defaultDuration) {
        if (!this.enabled && type !== 'connection') {
            console.log('[NotificationService] In-app notifications disabled, skipping:', message);
            return null;
        }

        const notification = this.createNotification(message, type, duration);
        this.addNotification(notification);

        if (this.soundEnabled) {
            this.playNotificationSound(type);
        }

        return notification.id;
    }

    showConnection(message, showRetry = false) {
        this.removeConnectionNotifications();

        // No duration: connection state is a status, not a transient confirmation.
        const notification = this.createNotification(message, 'connection', null, showRetry);
        this.addNotification(notification);
        return notification.id;
    }

    showComputerTool(message, action) {
        const notification = this.createNotification(message, 'computer-tool', 3000);
        notification.action = action;
        this.addNotification(notification);
        return notification.id;
    }

    remove(id) {
        const notification = this.notifications.find((item) => item.id === id);
        if (!notification || notification.isLeaving) return;

        notification.isLeaving = true;
        this.hovered.delete(id);
        this.focused.delete(id);
        this.stopTimer(notification);

        notification.element.classList.remove('show');
        notification.element.classList.add('hide');

        window.setTimeout(() => this.detach(notification), this.cssMs('--notification-exit', 200));
    }

    removeConnectionNotifications() {
        this.notifications
            .filter((item) => item.type === 'connection')
            .forEach((item) => this.remove(item.id));
    }

    clear() {
        [...this.notifications].forEach((item) => this.remove(item.id));
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[NotificationService] In-app notifications ${enabled ? 'enabled' : 'disabled'}`);
    }

    setSoundEnabled(enabled) {
        this.soundEnabled = enabled;
        console.log(`[NotificationService] Notification sounds ${enabled ? 'enabled' : 'disabled'}`);
    }

    // ------------------------------------------------------------------ dom

    createNotification(message, type, duration, showRetry = false) {
        const id = `notification-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

        const element = document.createElement('div');
        element.className = `unified-notification notification-${type}`;
        element.setAttribute('data-notification-id', id);

        // The container is already a polite live region. Errors and warnings are
        // worth interrupting for; everything else waits its turn. Setting a role
        // here as well would announce each toast twice.
        if (type === 'error' || type === 'warning') {
            element.setAttribute('aria-live', 'assertive');
        }

        const surface = document.createElement('div');
        surface.className = 'notification-surface';

        const iconElement = document.createElement('div');
        iconElement.className = 'notification-icon';
        iconElement.setAttribute('aria-hidden', 'true');
        iconElement.innerHTML = this.getIcon(type);

        const content = document.createElement('div');
        content.className = 'notification-content';

        const messageElement = document.createElement('p');
        messageElement.className = 'notification-message';
        messageElement.textContent = message;
        content.appendChild(messageElement);

        if (showRetry) {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'notification-retry-btn';
            retryBtn.innerHTML = `${RETRY_ICON}<span>Retry</span>`;
            retryBtn.addEventListener('click', () => {
                if (window.ipcRenderer) {
                    window.ipcRenderer.send('restart-python-bridge');
                }
            });
            content.appendChild(retryBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'notification-close';
        closeBtn.innerHTML = CLOSE_ICON;
        closeBtn.setAttribute('aria-label', 'Dismiss notification');
        closeBtn.addEventListener('click', () => this.remove(id));

        surface.appendChild(iconElement);
        surface.appendChild(content);
        surface.appendChild(closeBtn);

        if (duration) {
            const progress = document.createElement('div');
            progress.className = 'notification-progress';
            progress.setAttribute('aria-hidden', 'true');

            const fill = document.createElement('span');
            fill.className = 'notification-progress-fill';
            progress.appendChild(fill);
            surface.appendChild(progress);
        }

        element.appendChild(surface);

        return {
            id,
            element,
            surface,
            type,
            duration,
            message,
            timer: null,
            hasEntered: false,
            isLeaving: false
        };
    }

    getIcon(type) {
        return ICONS[type] || ICONS.info;
    }

    addNotification(notification) {
        this.notifications.push(notification);
        this.container.appendChild(notification.element);

        requestAnimationFrame(() => {
            notification.element.classList.add('show');
        });

        window.setTimeout(() => {
            notification.hasEntered = true;
        }, this.cssMs('--notification-enter', 380));

        this.setupInteractions(notification);
        this.startTimer(notification);
        this.manageQueue();
    }

    // Removing the oldest keeps the corner readable. Anything above the cap
    // leaves through the normal exit so the stack never snaps.
    manageQueue() {
        const active = this.notifications.filter((item) => !item.isLeaving);
        const overflow = active.length - this.maxVisible;

        for (let index = 0; index < overflow; index += 1) {
            this.remove(active[index].id);
        }
    }

    // Pull the card out, then let the survivors glide up. Measuring in viewport
    // coordinates keeps this correct even though the container is anchored to the
    // bottom edge and shrinks as cards leave.
    detach(notification) {
        const element = notification.element;

        const survivors = this.notifications
            .filter((item) => item !== notification && !item.isLeaving && item.hasEntered && item.element.isConnected)
            .map((item) => ({ element: item.element, top: item.element.getBoundingClientRect().top }));

        const index = this.notifications.indexOf(notification);
        if (index !== -1) {
            this.notifications.splice(index, 1);
        }
        element.remove();

        if (this.prefersReducedMotion()) return;

        const duration = this.cssMs('--notification-collapse', 300);
        const easing = this.cssValue('--motion-ease-smooth-out', 'cubic-bezier(0.22, 1, 0.36, 1)');

        survivors.forEach((survivor) => {
            const delta = survivor.top - survivor.element.getBoundingClientRect().top;
            if (Math.abs(delta) < 1) return;

            survivor.element.animate(
                [
                    { transform: `translate3d(0, ${delta}px, 0)` },
                    { transform: 'translate3d(0, 0, 0)' }
                ],
                { duration, easing }
            );
        });
    }

    // --------------------------------------------------------- interactions

    setupInteractions(notification) {
        const { element, id } = notification;

        element.addEventListener('mouseenter', () => {
            this.hovered.add(id);
            this.syncTimers();
        });

        element.addEventListener('mouseleave', () => {
            this.hovered.delete(id);
            this.syncTimers();
        });

        // Keyboard users need the same grace period as anyone reading the toast.
        element.addEventListener('focusin', () => {
            this.focused.add(id);
            this.syncTimers();
        });

        element.addEventListener('focusout', () => {
            this.focused.delete(id);
            this.syncTimers();
        });

        element.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            this.remove(id);
        });

        this.setupSwipe(notification);
    }

    // Flick a toast toward the right edge to dismiss it.
    setupSwipe(notification) {
        const { element, surface, id } = notification;

        let pointerId = null;
        let startX = 0;
        let offset = 0;
        let dragging = false;

        const reset = () => {
            pointerId = null;
            offset = 0;
            dragging = false;
        };

        const release = () => {
            element.classList.remove('is-dragging');
            surface.style.transform = '';
            surface.style.opacity = '';
        };

        surface.addEventListener('pointerdown', (event) => {
            if (pointerId !== null || notification.isLeaving) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            if (event.target.closest('button')) return;

            pointerId = event.pointerId;
            startX = event.clientX;
            offset = 0;
            dragging = false;
            surface.setPointerCapture(pointerId);
        });

        surface.addEventListener('pointermove', (event) => {
            if (event.pointerId !== pointerId) return;

            offset = event.clientX - startX;

            if (!dragging) {
                if (Math.abs(offset) < DRAG_START_PX) return;
                dragging = true;
                element.classList.add('is-dragging');
            }

            // Resists travel to the left, since that is not the dismiss direction.
            const pull = offset > 0 ? offset : offset * 0.22;
            surface.style.transform = `translate3d(${pull}px, 0, 0)`;
            surface.style.opacity = String(Math.max(0.2, 1 - Math.max(pull, 0) / DRAG_FADE_PX));
        });

        const finish = (event) => {
            if (event.pointerId !== pointerId) return;

            const dismissed = dragging && offset >= DRAG_DISMISS_PX;

            if (dragging) {
                // A drag must not also read as a click. Capturing on the shell
                // stops the event before it reaches anything inside it, including
                // handlers other modules attach to the card. The timeout drops the
                // guard if no click follows, so it can never eat a later one.
                const suppressClick = (click) => {
                    click.stopPropagation();
                    click.preventDefault();
                };

                element.addEventListener('click', suppressClick, { capture: true, once: true });
                window.setTimeout(() => {
                    element.removeEventListener('click', suppressClick, { capture: true });
                }, 350);
            }

            if (dismissed) {
                // Keep the released offset so the card carries on outward while
                // the shell fades it out. Snapping back first would look broken.
                reset();
                this.remove(id);
                return;
            }

            release();
            reset();
        };

        surface.addEventListener('pointerup', finish);
        surface.addEventListener('pointercancel', (event) => {
            if (event.pointerId !== pointerId) return;
            release();
            reset();
        });
    }

    // ------------------------------------------------------------- timing

    // The progress bar is the clock. One animation, so the bar and the dismiss
    // can never disagree.
    startTimer(notification) {
        if (!notification.duration) return;

        const fill = notification.element.querySelector('.notification-progress-fill');
        if (!fill) return;

        const timer = fill.animate(
            [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
            { duration: notification.duration, easing: 'linear', fill: 'forwards' }
        );

        timer.onfinish = () => this.remove(notification.id);
        notification.timer = timer;

        if (this.shouldHoldTimers()) {
            timer.pause();
            notification.element.classList.add('is-paused');
        }
    }

    // Pause rather than cancel. Cancelling a forwards-filled animation snaps the
    // bar back to full width, which is visible for the length of the exit.
    stopTimer(notification) {
        if (!notification.timer) return;
        notification.timer.onfinish = null;
        if (notification.timer.playState === 'running') notification.timer.pause();
        notification.timer = null;
    }

    shouldHoldTimers() {
        return this.hovered.size > 0 || this.focused.size > 0 || document.hidden;
    }

    syncTimers() {
        const hold = this.shouldHoldTimers();

        this.notifications.forEach((notification) => {
            if (notification.isLeaving) return;

            notification.element.classList.toggle('is-paused', hold && Boolean(notification.timer));
            if (!notification.timer) return;

            if (hold) {
                if (notification.timer.playState === 'running') notification.timer.pause();
            } else if (notification.timer.playState === 'paused') {
                notification.timer.play();
            }
        });
    }

    // --------------------------------------------------------------- tokens

    prefersReducedMotion() {
        return Boolean(this._reducedMotion && this._reducedMotion.matches);
    }

    cssValue(name, fallback) {
        if (this._cssCache.has(name)) return this._cssCache.get(name);

        let value = fallback;
        if (this.container) {
            const raw = getComputedStyle(this.container).getPropertyValue(name).trim();
            if (raw) value = raw;
        }

        this._cssCache.set(name, value);
        return value;
    }

    cssMs(name, fallback) {
        const raw = this.cssValue(name, `${fallback}ms`);
        const parsed = raw.endsWith('ms')
            ? Number.parseFloat(raw)
            : Number.parseFloat(raw) * 1000;

        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    // ---------------------------------------------------------------- sound

    getAudioContext() {
        if (this._audioContext) return this._audioContext;

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return null;

        try {
            // One context for the lifetime of the page. Chromium caps how many a
            // document may hold, and the old code built a fresh one per toast.
            this._audioContext = new AudioContextCtor();
        } catch (error) {
            return null;
        }

        return this._audioContext;
    }

    playNotificationSound(type = 'info') {
        const context = this.getAudioContext();
        if (!context) return;

        if (context.state === 'suspended') {
            context.resume().catch(() => {});
        }

        const notes = SOUND_NOTES[type] || SOUND_NOTES.info;
        const start = context.currentTime;

        const master = context.createGain();
        master.gain.value = 0.06;

        // Trims the harshness off a bare oscillator.
        const tone = context.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 2400;

        tone.connect(master);
        master.connect(context.destination);

        notes.forEach((frequency, index) => {
            const at = start + index * 0.07;
            const oscillator = context.createOscillator();
            const envelope = context.createGain();

            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(frequency, at);

            envelope.gain.setValueAtTime(0.0001, at);
            envelope.gain.exponentialRampToValueAtTime(1, at + 0.012);
            envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);

            oscillator.connect(envelope);
            envelope.connect(tone);
            oscillator.start(at);
            oscillator.stop(at + 0.26);
        });
    }
}

// Create singleton instance
const notificationService = new NotificationService();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = notificationService;
}

// Both spellings are in use across the renderer. Without the capitalised alias,
// chat.js, to-do-list.js, context-handler.js and windows-speech-input-handler.js
// silently fall back to console logs or hand-rolled inline toasts.
window.notificationService = notificationService;
window.NotificationService = notificationService;
