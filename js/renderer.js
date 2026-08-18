/**
 * Dock-style hover magnification for the left sidebar rail.
 *
 * The previous implementation fed on its own output: it measured live
 * `getBoundingClientRect()` values of icons whose width/height were mid-flight,
 * so growing an icon reflowed the column, which moved every center, which
 * changed the next frame's targets. Combined with a falloff radius far wider
 * than the icon pitch (every icon inflated at once), magnified icons that
 * overlapped and had to be untangled with per-frame z-index writes, and two
 * different thresholds deciding "which icon is hovered", the result wobbled,
 * flickered and thrashed layout.
 *
 * This version holds to four rules:
 *   1. Rest geometry is read from `offsetTop`/`offsetHeight`, which transforms
 *      cannot influence, and is cached. Scales always derive from rest centers,
 *      so the magnification field can never chase itself.
 *   2. Only `transform` animates. No width/height, so no layout or paint per
 *      frame, and the icon grows away from the window edge.
 *   3. The rest pitch leaves enough room that a fully magnified icon never
 *      overlaps its neighbour, so neighbours never need displacing. Whatever is
 *      under the cursor stays under the cursor.
 *   4. One "focused band" decision drives the focus ring, the stacking and the
 *      tooltip, so they cannot disagree.
 */
class SidebarDockController {
    static DEFAULTS = {
        /** Peak magnification. Bounded by the rest pitch — see geometry note above. */
        maxScale: 1.42,
        /** Gaussian falloff as a fraction of the icon pitch. Keeps the peak on one icon. */
        falloffRatio: 0.62,
        /** Rightward "reach" in px at peak scale. */
        popDistance: 12,
        /** Spring: ~0.9 damping ratio, settles in ~300ms with no visible overshoot. */
        stiffness: 210,
        damping: 26,
        mass: 1,
        /** How far past the icon stack the pointer may stray before the dock sleeps. */
        verticalSlack: 20,
        /** Distance from the magnified icon's right edge to the tooltip. */
        tooltipGap: 10,
    };

    constructor(sidebar, options = {}) {
        this.sidebar = sidebar || null;
        this.track = sidebar?.querySelector('.sidebar-icons') || null;
        if (!this.sidebar || !this.track) return;

        this.settings = { ...SidebarDockController.DEFAULTS, ...options };

        this.items = [];
        this.geometry = [];
        this.springs = [];
        this.written = [];

        this.pitch = 0;
        this.sigma = 1;

        this.pointerInside = false;
        this.pointerY = null;
        this.keyboardIndex = -1;
        this.focusIndex = -1;

        this.rafId = null;
        this.lastTime = 0;
        this.needsMeasure = true;
        this.syncQueued = false;

        this.tooltip = null;
        this.tooltipLabel = null;
        this.tooltipVisible = false;
        this.tooltipSpring = this.createSpring(0, 0.05);

        this.frame = this.frame.bind(this);
        this.controller = new AbortController();
        this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
        this.reducedMotion = this.motionQuery?.matches === true;

        this.init();
    }

    /* ---------------------------------------------------------------- setup */

    init() {
        this.buildTooltip();
        this.syncItems();
        this.bindEvents();
        this.start();
    }

    buildTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'sidebar-dock-tooltip';
        // The label duplicates each button's accessible name, so hide it from AT.
        this.tooltip.setAttribute('aria-hidden', 'true');

        const inner = document.createElement('div');
        inner.className = 'sidebar-dock-tooltip-inner';

        this.tooltipLabel = document.createElement('span');
        this.tooltipLabel.className = 'sidebar-dock-tooltip-label';

        inner.appendChild(this.tooltipLabel);
        this.tooltip.appendChild(inner);
        document.body.appendChild(this.tooltip);
    }

    bindEvents() {
        const { signal } = this.controller;

        // A single pointer stream on the rail drives every icon. Listening on the
        // rail (not per icon) means moving through the gaps never interrupts it.
        this.sidebar.addEventListener('pointerenter', (event) => this.handlePointer(event), { signal });
        this.sidebar.addEventListener('pointermove', (event) => this.handlePointer(event), { signal });
        this.sidebar.addEventListener('pointerleave', () => this.releasePointer(), { signal });
        this.sidebar.addEventListener('pointercancel', () => this.releasePointer(), { signal });

        this.sidebar.addEventListener('focusin', (event) => this.handleFocusIn(event), { signal });
        this.sidebar.addEventListener('focusout', () => this.handleFocusOut(), { signal });

        // The pointer can end up parked over the rail with no further events
        // (window loses focus, app is hidden). Collapse rather than stay stuck.
        window.addEventListener('blur', () => this.sleep(), { signal });
        window.addEventListener('resize', () => this.invalidate(), { signal });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.sleep();
        }, { signal });

        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(() => this.invalidate());
            this.resizeObserver.observe(this.track);
        }

        if (typeof MutationObserver === 'function') {
            // chat.js injects and removes `.sidebar-icon` buttons in this rail at
            // runtime; the old controller snapshotted the list once and silently
            // left those buttons out of the dock.
            this.mutationObserver = new MutationObserver(() => this.scheduleSync());
            this.mutationObserver.observe(this.track, { childList: true, subtree: true });
        }

        this.motionQuery?.addEventListener?.('change', (event) => {
            this.reducedMotion = event.matches;
            this.invalidate();
        }, { signal });
    }

    destroy() {
        this.controller?.abort();
        this.resizeObserver?.disconnect();
        this.mutationObserver?.disconnect();
        this.stop();
        this.items.forEach((item) => this.resetItem(item));
        this.tooltip?.remove();
        this.items = [];
        this.springs = [];
        this.geometry = [];
    }

    /* ----------------------------------------------------------- item list */

    scheduleSync() {
        if (this.syncQueued) return;
        this.syncQueued = true;
        requestAnimationFrame(() => {
            this.syncQueued = false;
            this.syncItems();
        });
    }

    syncItems() {
        const next = Array.from(this.track.querySelectorAll('.sidebar-icon'));
        const unchanged = next.length === this.items.length
            && next.every((item, index) => item === this.items[index]);

        if (unchanged) {
            // Content changed inside a button (chat.js rewrites its innerHTML on
            // status updates) — geometry may have shifted, the list did not.
            this.invalidate();
            return;
        }

        const carried = new Map(this.items.map((item, index) => [item, this.springs[index]]));
        this.items.forEach((item) => {
            if (!next.includes(item)) this.resetItem(item);
            else item.classList.remove('sidebar-dock-focused');
        });

        this.items = next;
        this.springs = next.map((item) => carried.get(item) || this.createSpring(1, 0.0008));
        this.written = next.map(() => null);

        this.items.forEach((item) => {
            item.classList.add('sidebar-dock-item');
            this.readLabel(item);
        });

        // Indices just shifted; drop the current focus rather than mis-attribute it.
        this.focusIndex = -1;
        this.hideTooltip();
        this.invalidate();
    }

    resetItem(item) {
        item.classList.remove('sidebar-dock-item', 'sidebar-dock-focused');
        item.style.removeProperty('--dock-scale');
        item.style.removeProperty('--dock-x');
    }

    /**
     * Native `title` would duplicate our tooltip, so it is hoisted into
     * `data-dock-label`. chat.js re-adds `title` whenever a background
     * conversation changes status, so this is re-checked on every read.
     */
    readLabel(item) {
        const title = item.getAttribute('title');
        if (title) {
            item.dataset.dockLabel = title;
            item.removeAttribute('title');
            // Dynamically injected buttons carry no aria-label; without this,
            // stripping `title` would leave them unnamed for screen readers.
            if (!item.getAttribute('aria-label')) {
                item.setAttribute('aria-label', title.replace(/\s*\n\s*/g, ' — '));
            }
        }
        return item.dataset.dockLabel || item.getAttribute('aria-label') || '';
    }

    /* ------------------------------------------------------------ geometry */

    invalidate() {
        this.needsMeasure = true;
        this.start();
    }

    /**
     * `offsetTop`/`offsetHeight` are layout values, immune to the transforms this
     * controller applies, so re-measuring mid-hover is safe and never feeds back
     * into the magnification. Every `.sidebar-icon` resolves its offsets against
     * the fixed-position rail, including the ones nested in the background chat
     * stack.
     */
    measure() {
        this.needsMeasure = false;

        const railRect = this.sidebar.getBoundingClientRect();
        this.geometry = this.items.map((item) => {
            const height = item.offsetHeight;
            const rendered = item.offsetParent !== null && height > 0;
            const top = railRect.top + item.offsetTop;
            return {
                rendered,
                top,
                height,
                centerY: top + height / 2,
                left: railRect.left + item.offsetLeft,
                width: item.offsetWidth,
            };
        });

        this.pitch = this.derivePitch();
        this.sigma = Math.max(1, this.pitch * this.settings.falloffRatio);

        // Background conversation buttons rewrite their label as their status
        // changes; keep an open tooltip in sync with it.
        if (this.tooltipVisible && this.focusIndex !== -1) {
            const label = this.readLabel(this.items[this.focusIndex]);
            if (label) this.tooltipLabel.textContent = label;
        }
    }

    derivePitch() {
        const centers = this.geometry.filter((entry) => entry.rendered);
        if (centers.length > 1) {
            const span = centers[centers.length - 1].centerY - centers[0].centerY;
            return span / (centers.length - 1);
        }
        return centers.length === 1 ? centers[0].height : 0;
    }

    /* ------------------------------------------------------------- pointer */

    handlePointer(event) {
        // Touch has no hover state; magnifying on tap would leave the dock stuck.
        if (event.pointerType === 'touch') return;
        this.pointerInside = true;
        this.pointerY = event.clientY;
        this.start();
    }

    releasePointer() {
        this.pointerInside = false;
        this.pointerY = null;
        this.start();
    }

    sleep() {
        this.pointerInside = false;
        this.pointerY = null;
        this.keyboardIndex = -1;
        this.start();
    }

    handleFocusIn(event) {
        const item = event.target?.closest?.('.sidebar-icon');
        // Only keyboard focus anchors the dock. A click already has the pointer
        // driving it, and would otherwise leave the icon magnified afterwards.
        const keyboard = item?.matches?.(':focus-visible') === true;
        this.keyboardIndex = keyboard ? this.items.indexOf(item) : -1;
        this.start();
    }

    handleFocusOut() {
        this.keyboardIndex = -1;
        this.start();
    }

    /* --------------------------------------------------------------- solve */

    peakScale() {
        return this.reducedMotion ? 1 : this.settings.maxScale;
    }

    popFor(scale) {
        return this.reducedMotion ? 0 : (scale - 1) * this.settings.popDistance;
    }

    anchorY() {
        if (this.pointerInside && this.pointerY !== null) return this.pointerY;
        const entry = this.geometry[this.keyboardIndex];
        return entry?.rendered ? entry.centerY : null;
    }

    /**
     * The one threshold in the whole effect: the anchor has to sit alongside the
     * icon stack, not merely somewhere on the full-height rail.
     */
    resolveFocus(anchorY) {
        let index = -1;
        let nearest = Infinity;

        for (let i = 0; i < this.geometry.length; i += 1) {
            const entry = this.geometry[i];
            if (!entry.rendered) continue;
            const distance = Math.abs(anchorY - entry.centerY);
            if (distance < nearest) {
                nearest = distance;
                index = i;
            }
        }

        if (index === -1) return -1;
        const reach = this.pitch / 2 + this.settings.verticalSlack;
        return nearest <= reach ? index : -1;
    }

    resolveTargets() {
        const anchorY = this.anchorY();
        const focus = anchorY === null ? -1 : this.resolveFocus(anchorY);
        const peak = this.peakScale();
        const spread = 2 * this.sigma * this.sigma;

        for (let i = 0; i < this.springs.length; i += 1) {
            const entry = this.geometry[i];
            let target = 1;
            if (focus !== -1 && entry?.rendered && peak > 1) {
                const distance = anchorY - entry.centerY;
                target = 1 + (peak - 1) * Math.exp(-(distance * distance) / spread);
            }
            this.springs[i].target = target;
        }

        if (focus !== this.focusIndex) this.applyFocus(focus);

        // Re-read each frame so the label keeps tracking its icon after a
        // re-measure (window resize, rail contents changing) and not just on
        // focus changes.
        if (this.focusIndex !== -1) {
            const centerY = this.geometry[this.focusIndex]?.centerY;
            if (centerY !== undefined) this.tooltipSpring.target = centerY;
        }
    }

    applyFocus(index) {
        this.items[this.focusIndex]?.classList.remove('sidebar-dock-focused');
        this.focusIndex = index;

        if (index === -1) {
            this.hideTooltip();
            return;
        }

        this.items[index].classList.add('sidebar-dock-focused');
        this.showTooltip(index);
    }

    /* ------------------------------------------------------------- tooltip */

    showTooltip(index) {
        const label = this.readLabel(this.items[index]);
        const centerY = this.geometry[index]?.centerY;
        if (!label || centerY === undefined) {
            this.hideTooltip();
            return;
        }

        this.tooltipLabel.textContent = label;
        this.tooltipSpring.target = centerY;

        if (!this.tooltipVisible) {
            // First appearance: land on the icon rather than sliding in from
            // wherever the label happened to be last time.
            this.tooltipSpring.value = centerY;
            this.tooltipSpring.velocity = 0;
            this.tooltipVisible = true;
            this.placeTooltip();
            this.tooltip.classList.add('is-visible');
        }
    }

    hideTooltip() {
        if (!this.tooltipVisible) return;
        this.tooltipVisible = false;
        this.tooltip.classList.remove('is-visible');
    }

    placeTooltip() {
        if (!this.tooltipVisible || this.focusIndex === -1) return;
        const entry = this.geometry[this.focusIndex];
        if (!entry) return;

        // Icons scale from their left edge, so the right edge is a pure function
        // of the animated scale — no layout read needed to track it.
        const scale = this.springs[this.focusIndex]?.value ?? 1;
        const x = entry.left + entry.width * scale + this.popFor(scale) + this.settings.tooltipGap;
        const y = this.tooltipSpring.value;

        this.tooltip.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) translateY(-50%)`;
    }

    /* -------------------------------------------------------------- motion */

    createSpring(value, epsilon) {
        return { value, target: value, velocity: 0, epsilon };
    }

    /** Semi-implicit Euler with fixed sub-steps: stable at any refresh rate. */
    advance(spring, dt) {
        if (this.reducedMotion || dt <= 0) {
            const moved = spring.value !== spring.target;
            spring.value = spring.target;
            spring.velocity = 0;
            return moved;
        }

        const { stiffness, damping, mass } = this.settings;
        const steps = Math.min(8, Math.max(1, Math.ceil(dt * 240)));
        const step = dt / steps;

        for (let i = 0; i < steps; i += 1) {
            const accel = (-stiffness * (spring.value - spring.target) - damping * spring.velocity) / mass;
            spring.velocity += accel * step;
            spring.value += spring.velocity * step;
        }

        if (Math.abs(spring.target - spring.value) < spring.epsilon
            && Math.abs(spring.velocity) < spring.epsilon * 8) {
            spring.value = spring.target;
            spring.velocity = 0;
            return false;
        }
        return true;
    }

    start() {
        if (this.rafId !== null) return;
        this.track.classList.add('dock-animating');
        this.lastTime = performance.now();
        this.rafId = requestAnimationFrame(this.frame);
    }

    stop() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        // Dropping the compositing hint at rest lets the icon re-rasterize
        // crisply instead of being stretched from a cached texture.
        this.track.classList.remove('dock-animating');
    }

    frame(now) {
        // Clamped so a stalled window (hidden tab, dragged window) resumes from
        // a sane step instead of exploding the integrator.
        const dt = Math.min((now - this.lastTime) / 1000, 0.05);
        this.lastTime = now;

        if (this.needsMeasure) this.measure();
        this.resolveTargets();

        let moving = false;
        for (let i = 0; i < this.springs.length; i += 1) {
            const spring = this.springs[i];
            if (this.advance(spring, dt)) moving = true;
            this.write(i, spring.value);
        }

        if (this.advance(this.tooltipSpring, dt)) moving = true;
        this.placeTooltip();

        if (!moving) {
            this.stop();
            return;
        }
        this.rafId = requestAnimationFrame(this.frame);
    }

    write(index, scale) {
        const item = this.items[index];
        if (!item) return;
        const value = scale.toFixed(4);
        if (this.written[index] === value) return;

        this.written[index] = value;
        item.style.setProperty('--dock-scale', value);
        item.style.setProperty('--dock-x', `${this.popFor(scale).toFixed(2)}px`);
    }
}

class StateManager {
    constructor() {
        this._state = {
            isDarkMode: true,
            isWindowMaximized: false,
            isChatOpen: true, // Chat open by default
            isAIOSOpen: false,
            isToDoListOpen: false,
            isProjectWorkspaceOpen: false,
            isComputerWorkspaceOpen: false,
            webViewBounds: { x: 0, y: 0, width: 400, height: 300 }
        };
        this.subscribers = new Set();
    }

    setState(updates) {
        const changedKeys = Object.keys(updates).filter(
            key => this._state[key] !== updates[key]
        );
        Object.assign(this._state, updates);
        if (changedKeys.length > 0) {
            this.notifySubscribers(changedKeys);
        }
    }

    getState() {
        return { ...this._state };
    }

    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    notifySubscribers(changedKeys) {
        const state = this.getState();
        this.subscribers.forEach(callback => callback(state, changedKeys));
    }
}

class UIManager {
    constructor(stateManager) {
        this.state = stateManager;
        this.elements = {};
        this.isDragging = false;
        this.isResizing = false;
        this.dragStart = { x: 0, y: 0 };
        this.sidebarDock = null;
        this.init();
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.setupStateSubscription();
        this.setupWebViewEvents();
        this.setupSidebarDock();
    }

    cacheElements() {
        this.elements = {
            sidebar: document.querySelector('.sidebar'),
            sidebarIcons: document.querySelector('.sidebar-icons'),
            appIcon: document.getElementById('app-icon'),
            toDoListIcon: document.getElementById('to-do-list-icon'),
            projectWorkspaceIcon: document.getElementById('project-workspace-icon'),
            computerWorkspaceIcon: document.getElementById('computer-workspace-icon'),
            activeWorkspacePill: document.getElementById('active-workspace-pill'),
            themeToggle: document.getElementById('theme-toggle'),
            minimizeBtn: document.getElementById('minimize-window'),
            resizeBtn: document.getElementById('resize-window'),
            closeBtn: document.getElementById('close-window'),
            webViewContainer: null,
        };
    }

    setupSidebarDock() {
        if (this.sidebarDock || !this.elements.sidebar) return;
        this.sidebarDock = new SidebarDockController(this.elements.sidebar);
    }

    setupWebViewEvents() {
        const ipcRenderer = window.electron.ipcRenderer;
        ipcRenderer.on('webview-created', (bounds) => this.createWebViewContainer(bounds));
        ipcRenderer.on('webview-closed', () => this.removeWebViewContainer());
    }

    createWebViewContainer(bounds) {
        if (this.elements.webViewContainer) {
            this.removeWebViewContainer();
        }
        this.elements.webViewContainer = document.createElement('div');
        this.elements.webViewContainer.id = 'webview-container';
        this.elements.webViewContainer.className = 'webview-container';
        Object.assign(this.elements.webViewContainer.style, {
            left: `${bounds.x}px`,
            top: `${bounds.y}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            pointerEvents: 'all'
        });

        const header = document.createElement('div');
        header.className = 'webview-header';
        header.innerHTML = `
            <div class="drag-handle"><span class="webview-title">Web View</span></div>
            <div class="webview-controls">
                <button class="close-webview" title="Close Webview"><i class="fas fa-times"></i></button>
            </div>`;
        header.style.position = 'relative';
        header.style.zIndex = '1004';
        header.style.pointerEvents = 'all';

        header.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!e.target.closest('.close-webview')) this.startDragging(e);
        }, true);

        const closeButton = header.querySelector('.close-webview');
        closeButton.style.pointerEvents = 'all';
        closeButton.style.zIndex = '1006';
        closeButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.electron.ipcRenderer.send('close-webview');
        }, true);

        this.elements.webViewContainer.appendChild(header);

        ['top-left', 'top-right', 'bottom-left', 'bottom-right'].forEach(pos => {
            const resizer = document.createElement('div');
            resizer.className = `resizer ${pos}`;
            resizer.style.pointerEvents = 'all';
            resizer.style.zIndex = '1005';
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startResizing(e, pos);
            }, true);
            this.elements.webViewContainer.appendChild(resizer);
        });

        document.body.appendChild(this.elements.webViewContainer);
    }

    removeWebViewContainer() {
        if (this.elements.webViewContainer) {
            this.elements.webViewContainer.remove();
            this.elements.webViewContainer = null;
        }
    }

    startDragging(e) {
        if (e.target.closest('.resizer')) return;
        this.isDragging = true;
        const container = this.elements.webViewContainer;
        this.dragStart = {
            x: e.clientX - container.offsetLeft,
            y: e.clientY - container.offsetTop
        };
        const handleDrag = (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            const newX = e.clientX - this.dragStart.x;
            const newY = e.clientY - this.dragStart.y;
            const maxX = window.innerWidth - container.offsetWidth;
            const maxY = window.innerHeight - container.offsetHeight;
            container.style.left = `${Math.max(0, Math.min(maxX, newX))}px`;
            container.style.top = `${Math.max(0, Math.min(maxY, newY))}px`;
            window.electron.ipcRenderer.send('drag-webview', {
                x: parseInt(container.style.left),
                y: parseInt(container.style.top)
            });
        };
        const stopDragging = () => {
            this.isDragging = false;
            document.removeEventListener('mousemove', handleDrag);
            document.removeEventListener('mouseup', stopDragging);
        };
        document.addEventListener('mousemove', handleDrag, { capture: true });
        document.addEventListener('mouseup', stopDragging, { capture: true });
    }

    startResizing(e, position) {
        this.isResizing = true;
        const container = this.elements.webViewContainer;
        const startBounds = {
            x: container.offsetLeft,
            y: container.offsetTop,
            width: container.offsetWidth,
            height: container.offsetHeight,
            mouseX: e.clientX,
            mouseY: e.clientY
        };
        const handleResize = (e) => {
            if (!this.isResizing) return;
            e.preventDefault();
            e.stopPropagation();
            let newBounds = { ...startBounds };
            const dx = e.clientX - startBounds.mouseX;
            const dy = e.clientY - startBounds.mouseY;
            if (position.includes('right')) newBounds.width = Math.max(300, startBounds.width + dx);
            if (position.includes('left')) {
                const newWidth = Math.max(300, startBounds.width - dx);
                newBounds.x = startBounds.x + (startBounds.width - newWidth);
                newBounds.width = newWidth;
            }
            if (position.includes('bottom')) newBounds.height = Math.max(200, startBounds.height + dy);
            if (position.includes('top')) {
                const newHeight = Math.max(200, startBounds.height - dy);
                newBounds.y = startBounds.y + (startBounds.height - newHeight);
                newBounds.height = newHeight;
            }
            Object.assign(container.style, {
                left: `${newBounds.x}px`,
                top: `${newBounds.y}px`,
                width: `${newBounds.width}px`,
                height: `${newBounds.height}px`
            });
            window.electron.ipcRenderer.send('resize-webview', newBounds);
        };
        const stopResizing = () => {
            this.isResizing = false;
            document.removeEventListener('mousemove', handleResize);
            document.removeEventListener('mouseup', stopResizing);
        };
        document.addEventListener('mousemove', handleResize, { capture: true });
        document.addEventListener('mouseup', stopResizing, { capture: true });
    }

    setupEventListeners() {
        const ipcRenderer = window.electron.ipcRenderer;
        const addClickHandler = (el, handler) => el?.addEventListener('click', handler);
        addClickHandler(this.elements.appIcon, () => this.state.setState({ isAIOSOpen: !this.state.getState().isAIOSOpen }));
        addClickHandler(this.elements.toDoListIcon, () => this.state.setState({ isToDoListOpen: !this.state.getState().isToDoListOpen }));

        // Workspace icons — intercept to warn if another workspace is already active
        addClickHandler(this.elements.projectWorkspaceIcon, () => {
            const s = this.state.getState();
            // If closing the project workspace, always allow
            if (s.isProjectWorkspaceOpen) {
                this.state.setState({ isProjectWorkspaceOpen: false });
                return;
            }
            // Opening project workspace — check if computer workspace is active
            if (s.isComputerWorkspaceOpen) {
                this.showWorkspaceSwitchWarning('Computer Workspace', 'Coder Workspace', () => {
                    this.state.setState({ isComputerWorkspaceOpen: false });
                    // Small delay so the closing animation finishes before the new one opens
                    setTimeout(() => this.state.setState({ isProjectWorkspaceOpen: true }), 180);
                });
                return;
            }
            this.state.setState({ isProjectWorkspaceOpen: true });
        });

        addClickHandler(this.elements.computerWorkspaceIcon, () => {
            const s = this.state.getState();
            // If closing the computer workspace, always allow
            if (s.isComputerWorkspaceOpen) {
                this.state.setState({ isComputerWorkspaceOpen: false });
                return;
            }
            // Opening computer workspace — check if project workspace is active
            if (s.isProjectWorkspaceOpen) {
                this.showWorkspaceSwitchWarning('Coder Workspace', 'Computer Workspace', () => {
                    this.state.setState({ isProjectWorkspaceOpen: false });
                    setTimeout(() => this.state.setState({ isComputerWorkspaceOpen: true }), 180);
                });
                return;
            }
            this.state.setState({ isComputerWorkspaceOpen: true });
        });

        document.addEventListener('click', (event) => {
            const pill = event.target?.closest?.('#active-workspace-pill');
            if (!pill) return;
            const type = pill.dataset?.workspaceType;
            if (type === 'project') {
                this.state.setState({ isProjectWorkspaceOpen: true });
            } else if (type === 'computer') {
                this.state.setState({ isComputerWorkspaceOpen: true });
            }
        });

        addClickHandler(this.elements.minimizeBtn, () => ipcRenderer.send('minimize-window'));
        addClickHandler(this.elements.resizeBtn, () => ipcRenderer.send('toggle-maximize-window'));
        addClickHandler(this.elements.closeBtn, () => ipcRenderer.send('close-window'));
        addClickHandler(this.elements.themeToggle, () => this.state.setState({ isDarkMode: !this.state.getState().isDarkMode }));
        ipcRenderer.on('window-state-changed', (isMaximized) => this.state.setState({ isWindowMaximized: isMaximized }));
        document.addEventListener('click', (event) => {
            if (event.target.tagName === 'A' && event.target.href && event.target.href.startsWith('http')) {
                event.preventDefault();
                ipcRenderer.send('open-webview', event.target.href);
            }
        });

        // --- Global Keyboard Shortcuts ---
        this.setupKeyboardShortcuts();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            const shift = e.shiftKey;
            const key = e.key.toLowerCase();

            // Don't intercept when typing in input fields (unless it's a global shortcut)
            const isInputFocused = document.activeElement &&
                (document.activeElement.tagName === 'INPUT' ||
                 document.activeElement.tagName === 'TEXTAREA' ||
                 document.activeElement.isContentEditable);

            // --- Ctrl+N: New Conversation ---
            if (ctrl && !shift && key === 'n') {
                e.preventDefault();
                this.triggerNewConversation();
                return;
            }

            // --- Ctrl+,: Toggle Settings ---
            if (ctrl && !shift && key === ',') {
                e.preventDefault();
                this.triggerToggleSettings();
                return;
            }

            // --- Ctrl+Shift+T: Toggle Theme ---
            if (ctrl && shift && key === 't') {
                e.preventDefault();
                this.state.setState({ isDarkMode: !this.state.getState().isDarkMode });
                return;
            }

            // --- Ctrl+L: Focus Chat Input ---
            if (ctrl && !shift && key === 'l') {
                e.preventDefault();
                this.triggerFocusChatInput();
                return;
            }

            // --- Ctrl+Shift+N: New Task ---
            if (ctrl && shift && key === 'n') {
                e.preventDefault();
                this.triggerNewTask();
                return;
            }

            // --- Ctrl+H: Toggle History Sidebar ---
            if (ctrl && !shift && key === 'h') {
                e.preventDefault();
                this.triggerToggleHistory();
                return;
            }

            // --- Ctrl+/: Show Shortcuts Overlay ---
            if (ctrl && !shift && key === '/') {
                e.preventDefault();
                this.showShortcutsOverlay();
                return;
            }

            // --- Ctrl+Shift+D: Toggle DevTools ---
            if (ctrl && shift && key === 'd') {
                e.preventDefault();
                window.electron?.ipcRenderer?.send('toggle-devtools');
                return;
            }

            // --- Ctrl+E: Export Conversation ---
            if (ctrl && !shift && key === 'e') {
                e.preventDefault();
                this.triggerExportConversation();
                return;
            }

            // --- Ctrl+M: Minimize Window ---
            if (ctrl && !shift && key === 'm') {
                e.preventDefault();
                window.electron?.ipcRenderer?.send('minimize-window');
                return;
            }

            // --- Escape: Close Active Panel ---
            if (key === 'escape' && !ctrl && !shift) {
                if (this.triggerCloseActivePanel()) {
                    e.preventDefault();
                } else if (isInputFocused) {
                    document.activeElement.blur();
                }
                return;
            }
        });
    }

    async triggerNewConversation() {
        if (!window.chatModule?.startNewConversation) {
            window.notificationService?.show('Chat is still loading. Try again in a moment.', 'info', 2500);
            return;
        }

        await window.chatModule.startNewConversation();
        this.triggerFocusChatInput();
        window.notificationService?.show('New conversation started', 'info', 2000);
    }

    triggerToggleSettings() {
        const s = this.state.getState();
        if (s.isAIOSOpen) {
            // If already open, check if on settings tab — if so, close; if not, switch to settings
            const settingsTab = document.getElementById('settings-tab');
            if (settingsTab && settingsTab.classList.contains('active')) {
                this.state.setState({ isAIOSOpen: false });
            } else if (window.AIOS?.switchTab) {
                window.AIOS.switchTab('settings');
            }
        } else {
            this.state.setState({ isAIOSOpen: true });
            // Wait for panel to open, then switch to settings tab
            setTimeout(() => {
                if (window.AIOS?.switchTab) {
                    window.AIOS.switchTab('settings');
                }
            }, 100);
        }
    }

    triggerFocusChatInput() {
        const input = document.getElementById('floating-input') ||
                      document.getElementById('message-input') ||
                      document.querySelector('.chat-input textarea') ||
                      document.querySelector('textarea[placeholder]');
        if (input) {
            input.focus();
            // Place cursor at end
            if (typeof input.setSelectionRange === 'function') {
                const len = input.value?.length || 0;
                input.setSelectionRange(len, len);
            }
        }
    }

    triggerNewTask() {
        const s = this.state.getState();
        if (!s.isToDoListOpen) {
            this.state.setState({ isToDoListOpen: true });
        }
        // Focus the task input after panel opens
        setTimeout(() => {
            window.todo?.openNewTaskModal();
            document.getElementById('task-name')?.focus();
        }, 200);
    }

    triggerToggleHistory() {
        if (window.contextHandler?.toggleContextWindow) {
            window.contextHandler.toggleContextWindow();
        } else {
            // Fallback: click the history button if it exists
            const historyBtn = document.querySelector('[data-action="toggle-history"]') ||
                               document.getElementById('history-toggle-btn') ||
                               document.querySelector('.history-toggle');
            if (historyBtn) historyBtn.click();
        }
    }

    triggerExportConversation() {
        if (window.chatModule?.exportConversation) {
            window.chatModule.exportConversation();
        } else {
            window.notificationService?.show('Export is still loading. Try again in a moment.', 'info', 2500);
        }
    }

    triggerCloseActivePanel() {
        const s = this.state.getState();
        // Close in priority order: shortcuts overlay > pricing modal > AIOS > ToDoList > workspaces
        const shortcutsOverlay = document.getElementById('shortcuts-overlay');
        if (shortcutsOverlay) {
            shortcutsOverlay.classList.remove('visible');
            setTimeout(() => shortcutsOverlay.remove(), 300);
            return true;
        }
        if (!document.getElementById('new-task-modal')?.classList.contains('hidden')) {
            window.todo?.closeNewTaskModal();
            return true;
        }
        if (!document.getElementById('task-detail-modal')?.classList.contains('hidden')) {
            window.todo?.closeTaskDetailModal();
            return true;
        }
        if (!document.getElementById('user-context-modal')?.classList.contains('hidden')) {
            window.todo?.closeContextModal();
            return true;
        }
        if (window.contextHandler?.isWindowOpen) {
            window.contextHandler.hideContextWindow();
            return true;
        }
        if (window.historyContentSidebar?.isVisible?.()) {
            window.historyContentSidebar.hide();
            return true;
        }
        const pricingModal = document.querySelector('.pricing-modal:not(.hidden)');
        if (pricingModal && window.AIOS?.closePricingModal) {
            window.AIOS.closePricingModal();
            return true;
        }
        if (s.isAIOSOpen) {
            this.state.setState({ isAIOSOpen: false });
            return true;
        }
        if (s.isToDoListOpen) {
            this.state.setState({ isToDoListOpen: false });
            return true;
        }
        if (s.isProjectWorkspaceOpen) {
            this.state.setState({ isProjectWorkspaceOpen: false });
            return true;
        }
        if (s.isComputerWorkspaceOpen) {
            this.state.setState({ isComputerWorkspaceOpen: false });
            return true;
        }
        return false;
    }

    showShortcutsOverlay() {
        // Remove existing
        document.getElementById('shortcuts-overlay')?.remove();

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const mod = isMac ? '⌘' : 'Ctrl';

        const shortcuts = [
            { keys: `${mod} + N`, label: 'New Conversation' },
            { keys: `${mod} + ,`, label: 'Toggle Settings' },
            { keys: `${mod} + Shift + T`, label: 'Toggle Theme' },
            { keys: `${mod} + L`, label: 'Focus Chat Input' },
            { keys: 'Esc', label: 'Close Active Panel' },
            { keys: `${mod} + Shift + N`, label: 'New Task' },
            { keys: `${mod} + H`, label: 'Toggle History' },
            { keys: `${mod} + /`, label: 'Show This Overlay' },
            { keys: `${mod} + Shift + D`, label: 'Toggle DevTools' },
            { keys: `${mod} + E`, label: 'Export Conversation' },
            { keys: `${mod} + M`, label: 'Minimize Window' },
        ];

        const overlay = document.createElement('div');
        overlay.id = 'shortcuts-overlay';
        overlay.className = 'shortcuts-overlay';
        overlay.innerHTML = `
            <div class="shortcuts-overlay-backdrop"></div>
            <div class="shortcuts-overlay-card">
                <div class="shortcuts-overlay-header">
                    <div class="shortcuts-overlay-icon"><i class="fa-solid fa-keyboard"></i></div>
                    <h2>Keyboard Shortcuts</h2>
                    <button class="shortcuts-overlay-close" aria-label="Close"><i class="fas fa-times"></i></button>
                </div>
                <div class="shortcuts-overlay-body">
                    ${shortcuts.map(s => `
                        <div class="shortcuts-overlay-row">
                            <span class="shortcuts-overlay-label">${s.label}</span>
                            <div class="shortcuts-overlay-keys">
                                ${s.keys.split(' + ').map(k => `<kbd>${k.trim()}</kbd>`).join('<span>+</span>')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Inject styles if not already present
        if (!document.getElementById('shortcuts-overlay-styles')) {
            const style = document.createElement('style');
            style.id = 'shortcuts-overlay-styles';
            style.textContent = `
                .shortcuts-overlay {
                    position: fixed; inset: 0; z-index: 100000;
                    display: flex; align-items: center; justify-content: center;
                    opacity: 0; transition: opacity 0.25s ease;
                    pointer-events: none;
                }
                .shortcuts-overlay.visible {
                    opacity: 1; pointer-events: all;
                }
                .shortcuts-overlay-backdrop {
                    position: absolute; inset: 0;
                    background: rgba(0,0,0,0.6);
                    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
                }
                .shortcuts-overlay-card {
                    position: relative; width: 480px; max-width: 92vw; max-height: 80vh;
                    background: var(--window-bg, rgba(12,12,12,0.92));
                    border: 1px solid var(--border-color, rgba(255,255,255,0.09));
                    border-radius: 20px; overflow: hidden;
                    box-shadow: 0 24px 64px rgba(0,0,0,0.6);
                    transform: scale(0.92); transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
                }
                .shortcuts-overlay.visible .shortcuts-overlay-card {
                    transform: scale(1);
                }
                .shortcuts-overlay-header {
                    display: flex; align-items: center; gap: 14px;
                    padding: 24px 24px 16px; border-bottom: 1px solid var(--border-color);
                }
                .shortcuts-overlay-icon {
                    width: 40px; height: 40px; border-radius: 12px;
                    background: var(--accent-muted); color: var(--accent-color);
                    display: flex; align-items: center; justify-content: center; font-size: 16px;
                }
                .shortcuts-overlay-header h2 {
                    flex: 1; font-size: 17px; font-weight: 600;
                    color: var(--text-color); margin: 0; font-family: 'Outfit', sans-serif;
                }
                .shortcuts-overlay-close {
                    width: 32px; height: 32px; border: none; border-radius: 8px;
                    background: transparent; color: var(--text-secondary);
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s ease;
                }
                .shortcuts-overlay-close:hover {
                    background: var(--accent-muted); color: var(--text-color);
                }
                .shortcuts-overlay-body {
                    padding: 8px 0; max-height: 60vh; overflow-y: auto;
                }
                .shortcuts-overlay-row {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 11px 24px; transition: background 0.15s ease;
                }
                .shortcuts-overlay-row:hover {
                    background: rgba(255,255,255,0.03);
                }
                .shortcuts-overlay-label {
                    font-size: 13.5px; font-weight: 500; color: var(--text-color);
                }
                .shortcuts-overlay-keys {
                    display: flex; align-items: center; gap: 5px;
                }
                .shortcuts-overlay-keys kbd {
                    display: inline-flex; align-items: center; justify-content: center;
                    min-width: 28px; height: 26px; padding: 0 8px;
                    font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500;
                    color: var(--text-secondary); background: rgba(255,255,255,0.06);
                    border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.2);
                }
                .shortcuts-overlay-keys span {
                    font-size: 11px; color: var(--text-secondary); padding: 0 1px;
                }
                body:not(.dark-mode) .shortcuts-overlay-backdrop { background: rgba(0,0,0,0.3); }
                body:not(.dark-mode) .shortcuts-overlay-keys kbd {
                    background: rgba(0,0,0,0.05); border-color: rgba(0,0,0,0.12); color: #475569;
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));

        // Close handlers
        const close = () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
        };
        overlay.querySelector('.shortcuts-overlay-backdrop').addEventListener('click', close);
        overlay.querySelector('.shortcuts-overlay-close').addEventListener('click', close);
    }

    // ── Workspace Switch Warning Modal ──────────────────────────────────
    showWorkspaceSwitchWarning(activeWorkspace, targetWorkspace, onConfirm) {
        // Remove any existing modal
        document.getElementById('workspace-switch-warning')?.remove();

        const modal = document.createElement('div');
        modal.id = 'workspace-switch-warning';
        modal.className = 'workspace-switch-overlay';
        modal.innerHTML = `
            <div class="workspace-switch-modal">
                <div class="workspace-switch-glow"></div>
                <div class="workspace-switch-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                </div>
                <h3 class="workspace-switch-title">Workspace Still Active</h3>
                <p class="workspace-switch-message">
                    <strong>${activeWorkspace}</strong> is currently active. 
                    Switching to <strong>${targetWorkspace}</strong> will close the current session.
                </p>
                <div class="workspace-switch-actions">
                    <button class="workspace-switch-btn ws-btn-cancel" id="ws-warn-cancel">Stay Here</button>
                    <button class="workspace-switch-btn ws-btn-confirm" id="ws-warn-confirm">Switch Workspace</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => modal.classList.add('visible'));
        });

        let isClosing = false;
        const closeModal = () => {
            if (isClosing) return;
            isClosing = true;
            modal.classList.remove('visible');
            document.removeEventListener('keydown', onEsc);
            modal.addEventListener('transitionend', () => modal.remove(), { once: true });
            // Fallback removal in case transitionend doesn't fire
            setTimeout(() => modal.remove(), 220);
        };

        modal.querySelector('#ws-warn-cancel').addEventListener('click', closeModal);
        modal.querySelector('#ws-warn-confirm').addEventListener('click', () => {
            closeModal();
            onConfirm();
        });

        // Click backdrop to cancel
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // Escape key to cancel
        const onEsc = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', onEsc);
    }

    setupStateSubscription() {
        this.state.subscribe((state, changedKeys) => {
            changedKeys.forEach(key => {
                switch (key) {
                    case 'isDarkMode': this.updateTheme(state.isDarkMode); break;
                    case 'isWindowMaximized': this.updateWindowControls(state.isWindowMaximized); break;
                    case 'isChatOpen': this.updateChatVisibility(state.isChatOpen); break;
                    case 'isAIOSOpen':
                        if (state.isAIOSOpen && state.isToDoListOpen) this.state.setState({ isToDoListOpen: false });
                        this.updateAIOSVisibility(state.isAIOSOpen);
                        break;
                    case 'isToDoListOpen':
                        if (state.isToDoListOpen && state.isAIOSOpen) this.state.setState({ isAIOSOpen: false });
                        this.updateToDoListVisibility(state.isToDoListOpen);
                        break;
                    case 'isProjectWorkspaceOpen':
                        if (state.isProjectWorkspaceOpen && state.isToDoListOpen) this.state.setState({ isToDoListOpen: false });
                        this.updateProjectWorkspaceVisibility(state.isProjectWorkspaceOpen);
                        break;
                    case 'isComputerWorkspaceOpen':
                        if (state.isComputerWorkspaceOpen && state.isToDoListOpen) this.state.setState({ isToDoListOpen: false });
                        this.updateComputerWorkspaceVisibility(state.isComputerWorkspaceOpen);
                        break;
                }
            });
        });
    }

    updateActiveWorkspacePill() {
        const pill = document.getElementById('active-workspace-pill');
        const label = document.getElementById('active-workspace-pill-label');
        const icon = pill?.querySelector('.active-workspace-pill-icon');
        if (!pill || !label || !icon) return;

        const state = this.state.getState();
        const projectActive = this.isProjectModeActive();
        const computerActive = this.isComputerModeActive();
        const showProject = projectActive && !state.isProjectWorkspaceOpen;
        const showComputer = !showProject && computerActive && !state.isComputerWorkspaceOpen;

        pill.classList.toggle('hidden', !showProject && !showComputer);
        pill.classList.toggle('workspace-pill-coder', showProject);
        pill.classList.toggle('workspace-pill-computer', showComputer);

        if (showProject) {
            label.textContent = 'Coder Workspace';
            icon.className = 'fas fa-code active-workspace-pill-icon';
            pill.title = 'Coder workspace is still active. Click to reopen it.';
            pill.setAttribute('aria-label', 'Coder workspace is still active. Reopen workspace.');
            pill.dataset.workspaceType = 'project';
        } else if (showComputer) {
            label.textContent = 'Computer Workspace';
            icon.className = 'fas fa-desktop active-workspace-pill-icon';
            pill.title = 'Computer workspace is still active. Click to reopen it.';
            pill.setAttribute('aria-label', 'Computer workspace is still active. Reopen workspace.');
            pill.dataset.workspaceType = 'computer';
        } else {
            pill.removeAttribute('title');
            pill.removeAttribute('aria-label');
            delete pill.dataset.workspaceType;
        }
    }

    updateTheme(isDarkMode) {
        document.body.classList.toggle('dark-mode', isDarkMode);
        if (this.elements.themeToggle) {
            this.elements.themeToggle.querySelector('i').className = isDarkMode ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    updateWindowControls(isMaximized) {
        if (this.elements.resizeBtn) {
            this.elements.resizeBtn.querySelector('i').className = isMaximized ? 'fas fa-compress' : 'fas fa-expand';
        }
    }

    updateChatVisibility(isOpen) {
        document.getElementById('chat-container')?.classList.toggle('hidden', !isOpen);
        document.getElementById('floating-input-container')?.classList.toggle('hidden', !isOpen);
    }

    /** Keeps a rail icon's selected look and its accessible toggle state in sync. */
    setSidebarIconState(icon, isActive) {
        if (!icon) return;
        icon.classList.toggle('active', isActive);
        icon.setAttribute('aria-pressed', String(isActive));
    }

    updateAIOSVisibility(isOpen) {
        // The two workspace icons already reflect their panel; without this the
        // profile and tasks icons were the only ones in the rail with no
        // selected state at all.
        this.setSidebarIconState(this.elements.appIcon, isOpen);

        if (window.AIOS?.initialized) {
            document.getElementById('floating-window')?.classList.toggle('hidden', !isOpen);
            
            console.log(`[UIManager] AIOS visibility changed: ${isOpen ? 'OPEN' : 'CLOSED'}`);
            console.log('[UIManager] window.artifactHandler available:', !!window.artifactHandler);
            
            // Auto-hide workspace sidebars when AIOS opens
            if (isOpen && window.artifactHandler) {
                console.log('[UIManager] Calling hideWorkspaceSidebarsForOverlay for AIOS');
                window.artifactHandler.hideWorkspaceSidebarsForOverlay('aios');
            }
            // Restore workspace sidebars when AIOS closes
            else if (!isOpen && window.artifactHandler) {
                console.log('[UIManager] Calling restoreWorkspaceSidebarsFromOverlay for AIOS');
                window.artifactHandler.restoreWorkspaceSidebarsFromOverlay('aios');
            }
        }
    }

    updateToDoListVisibility(isOpen) {
        this.setSidebarIconState(this.elements.toDoListIcon, isOpen);
        document.getElementById('to-do-list-container')?.classList.toggle('hidden', !isOpen);
        // Full-screen takeover: hide chat and floating input when tasks open
        document.getElementById('chat-container')?.classList.toggle('hidden', isOpen);
        document.getElementById('floating-input-container')?.classList.toggle('hidden', isOpen);
        document.body.classList.toggle('tasks-panel-open', isOpen);
        if (window.floatingWindowManager) {
            if (isOpen) window.floatingWindowManager.onWindowOpen('tasks');
            else window.floatingWindowManager.onWindowClose('tasks');
        }
        // Restore chat when tasks close (if chat was open before)
        if (!isOpen && this.state.getState().isChatOpen) {
            document.getElementById('chat-container')?.classList.remove('hidden');
            document.getElementById('floating-input-container')?.classList.remove('hidden');
        }
    }

    isProjectModeActive() {
        if (window.projectWorkspace?.isModeActive) {
            return window.projectWorkspace.isModeActive();
        }
        const ctx = window.projectContext || window.activeProjectContext || null;
        if (!ctx || typeof ctx !== 'object') return false;
        if (String(ctx.agentMode || '').toLowerCase() === 'coder') return true;
        if (ctx.isDedicatedProject === true) return true;
        if (String(ctx.mode || '').toLowerCase() === 'project') return true;
        return false;
    }

    isComputerModeActive() {
        if (window.computerWorkspace?.isModeActive) {
            return window.computerWorkspace.isModeActive();
        }
        const ctx = window.computerContext || null;
        if (!ctx || typeof ctx !== 'object') return false;
        if (String(ctx.agentMode || '').toLowerCase() === 'computer') return true;
        if (ctx.isDedicatedComputer === true) return true;
        if (String(ctx.mode || '').toLowerCase() === 'computer') return true;
        return false;
    }

    refreshWorkspaceIconStates(projectPanelOpen, computerPanelOpen) {
        const state = this.state.getState();
        const projectOpen = typeof projectPanelOpen === 'boolean' ? projectPanelOpen : state.isProjectWorkspaceOpen;
        const computerOpen = typeof computerPanelOpen === 'boolean' ? computerPanelOpen : state.isComputerWorkspaceOpen;
        const projectModeActive = this.isProjectModeActive();
        const computerModeActive = this.isComputerModeActive();

        if (this.elements.projectWorkspaceIcon) {
            this.setSidebarIconState(this.elements.projectWorkspaceIcon, projectOpen);
            this.elements.projectWorkspaceIcon.classList.toggle('workspace-mode-active', projectModeActive);
            this.elements.projectWorkspaceIcon.classList.toggle('workspace-mode-hidden', projectModeActive && !projectOpen);
        }

        if (this.elements.computerWorkspaceIcon) {
            this.setSidebarIconState(this.elements.computerWorkspaceIcon, computerOpen);
            this.elements.computerWorkspaceIcon.classList.toggle('workspace-mode-active', computerModeActive);
            this.elements.computerWorkspaceIcon.classList.toggle('workspace-mode-hidden', computerModeActive && !computerOpen);
        }

        this.updateActiveWorkspacePill();
    }

    updateProjectWorkspaceVisibility(isOpen) {
        document.getElementById('project-workspace-panel')?.classList.toggle('hidden', !isOpen);
        document.body.classList.toggle('project-panel-open', isOpen);

        // The source-control popover is anchored to a control inside the panel,
        // so it must never outlive it.
        if (!isOpen) {
            window.githubPanel?.close?.();
        }

        // Opening from sidebar must also guarantee project routing mode is active.
        if (isOpen && window.projectWorkspace?.ensureContext) {
            window.projectWorkspace.ensureContext({}, { syncUi: true });
        }



        this.refreshWorkspaceIconStates(isOpen, this.state.getState().isComputerWorkspaceOpen);

        if (window.floatingWindowManager) {
            if (isOpen) window.floatingWindowManager.onWindowOpen('project-workspace');
            else window.floatingWindowManager.onWindowClose('project-workspace');
        }

        this.updateActiveWorkspacePill();
    }

    updateComputerWorkspaceVisibility(isOpen) {
        document.getElementById('computer-workspace-chip')?.classList.toggle('hidden', !isOpen);
        document.body.classList.toggle('computer-panel-open', isOpen);

        // Toggle the inline toolbar action buttons
        document.getElementById('computer-toolbar-actions')?.classList.toggle('hidden', !isOpen);

        // Opening from sidebar must also guarantee computer routing mode is active.
        if (isOpen) {
            if (!this.isComputerModeActive() && window.computerWorkspace?.openComputerWorkspace) {
                window.computerWorkspace.openComputerWorkspace({});
            }
        }

        this.refreshWorkspaceIconStates(this.state.getState().isProjectWorkspaceOpen, isOpen);

        if (window.floatingWindowManager) {
            if (isOpen) window.floatingWindowManager.onWindowOpen('computer-workspace');
            else window.floatingWindowManager.onWindowClose('computer-workspace');
        }

        this.updateActiveWorkspacePill();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const stateManager = new StateManager();
    window.stateManager = stateManager;
    const uiManager = new UIManager(stateManager);
    window.uiManager = uiManager;

    const loadModule = async (name, containerId, initFunc) => {
        try {
            const response = await fetch(`${name}.html`);
            if (!response.ok) throw new Error(`Failed to load ${name}: ${response.statusText}`);
            const html = await response.text();
            document.getElementById(containerId).innerHTML = html;
            initFunc?.();
        } catch (err) {
            console.error(`Error loading ${name}:`, err);
        }
    };

    // ── Auth Gate integration ───────────────────────────────────────────
    // Wait until the auth gate has been dismissed (i.e. user is authenticated)
    // before loading the main application modules.
    // The auth-gate.js emits 'auth-gate:authenticated' once the session is confirmed.
    async function waitForAuth() {
        return new Promise((resolve) => {
            // If the gate was already dismissed (user was already logged in),
            // the event may have fired before we got here — use a flag check.
            if (window._authGateAuthenticated) {
                resolve();
                return;
            }
            window.addEventListener('auth-gate:authenticated', () => resolve(), { once: true });
        });
    }

    // auth-gate.js sets this flag when it dismisses itself
    window.addEventListener('auth-gate:authenticated', () => {
        window._authGateAuthenticated = true;
    });

    // Wait for auth before initializing the heavy modules
    await waitForAuth();
    // ── End Auth Gate integration ───────────────────────────────────────

    await Promise.all([
        loadModule('aios', 'aios-container', () => window.AIOS?.init()),
        loadModule('chat', 'chat-root', () => window.chatModule?.init()),
        loadModule('to-do-list', 'to-do-list-root', () => window.todo?.init())
    ]);

    uiManager.cacheElements();
    const initialState = stateManager.getState();
    uiManager.updateTheme(initialState.isDarkMode);
    uiManager.updateChatVisibility(initialState.isChatOpen);
    uiManager.updateAIOSVisibility(initialState.isAIOSOpen);
    uiManager.updateToDoListVisibility(initialState.isToDoListOpen);
    uiManager.updateProjectWorkspaceVisibility(initialState.isProjectWorkspaceOpen);
    uiManager.updateComputerWorkspaceVisibility(initialState.isComputerWorkspaceOpen);
});
