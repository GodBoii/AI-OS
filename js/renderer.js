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
        this.init();
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.setupStateSubscription();
        this.setupWebViewEvents();
    }

    cacheElements() {
        this.elements = {
            appIcon: document.getElementById('app-icon'),
            toDoListIcon: document.getElementById('to-do-list-icon'),
            projectWorkspaceIcon: document.getElementById('project-workspace-icon'),
            computerWorkspaceIcon: document.getElementById('computer-workspace-icon'),
            themeToggle: document.getElementById('theme-toggle'),
            minimizeBtn: document.getElementById('minimize-window'),
            resizeBtn: document.getElementById('resize-window'),
            closeBtn: document.getElementById('close-window'),
            webViewContainer: null,
        };
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
                this.showWorkspaceSwitchWarning('Computer Workspace', 'Project Workspace', () => {
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
                this.showWorkspaceSwitchWarning('Project Workspace', 'Computer Workspace', () => {
                    this.state.setState({ isProjectWorkspaceOpen: false });
                    setTimeout(() => this.state.setState({ isComputerWorkspaceOpen: true }), 180);
                });
                return;
            }
            this.state.setState({ isComputerWorkspaceOpen: true });
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

        const closeModal = () => {
            modal.classList.remove('visible');
            modal.addEventListener('transitionend', () => modal.remove(), { once: true });
            // Fallback removal in case transitionend doesn't fire
            setTimeout(() => modal.remove(), 500);
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
        const onEsc = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onEsc); } };
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

    updateAIOSVisibility(isOpen) {
        if (window.AIOS?.initialized) {
            document.getElementById('floating-window')?.classList.toggle('hidden', !isOpen);
        }
    }

    updateToDoListVisibility(isOpen) {
        document.getElementById('to-do-list-container')?.classList.toggle('hidden', !isOpen);
        // Add body class to enable CSS-based layout shifts
        document.body.classList.toggle('tasks-panel-open', isOpen);
        if (window.floatingWindowManager) {
            if (isOpen) window.floatingWindowManager.onWindowOpen('tasks');
            else window.floatingWindowManager.onWindowClose('tasks');
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
            this.elements.projectWorkspaceIcon.classList.toggle('active', projectOpen);
            this.elements.projectWorkspaceIcon.classList.toggle('workspace-mode-active', projectModeActive);
            this.elements.projectWorkspaceIcon.classList.toggle('workspace-mode-hidden', projectModeActive && !projectOpen);
        }

        if (this.elements.computerWorkspaceIcon) {
            this.elements.computerWorkspaceIcon.classList.toggle('active', computerOpen);
            this.elements.computerWorkspaceIcon.classList.toggle('workspace-mode-active', computerModeActive);
            this.elements.computerWorkspaceIcon.classList.toggle('workspace-mode-hidden', computerModeActive && !computerOpen);
        }
    }

    updateProjectWorkspaceVisibility(isOpen) {
        document.getElementById('project-workspace-panel')?.classList.toggle('hidden', !isOpen);
        document.body.classList.toggle('project-panel-open', isOpen);

        // Opening from sidebar must also guarantee project routing mode is active.
        if (isOpen && window.projectWorkspace?.ensureContext) {
            window.projectWorkspace.ensureContext({}, { syncUi: true });
        }

        this.refreshWorkspaceIconStates(isOpen, this.state.getState().isComputerWorkspaceOpen);

        if (window.floatingWindowManager) {
            if (isOpen) window.floatingWindowManager.onWindowOpen('project-workspace');
            else window.floatingWindowManager.onWindowClose('project-workspace');
        }
    }

    updateComputerWorkspaceVisibility(isOpen) {
        document.getElementById('computer-workspace-chip')?.classList.toggle('hidden', !isOpen);
        document.body.classList.toggle('computer-panel-open', isOpen);

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
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const stateManager = new StateManager();
    window.stateManager = stateManager;
    const uiManager = new UIManager(stateManager);

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

    await Promise.all([
        loadModule('aios', 'aios-container', () => window.AIOS?.init()),
        loadModule('chat', 'chat-root', () => window.chatModule?.init()),
        loadModule('to-do-list', 'to-do-list-root', () => window.todo?.init())
    ]);

    const initialState = stateManager.getState();
    uiManager.updateTheme(initialState.isDarkMode);
    uiManager.updateChatVisibility(initialState.isChatOpen);
    uiManager.updateAIOSVisibility(initialState.isAIOSOpen);
    uiManager.updateToDoListVisibility(initialState.isToDoListOpen);
    uiManager.updateProjectWorkspaceVisibility(initialState.isProjectWorkspaceOpen);
    uiManager.updateComputerWorkspaceVisibility(initialState.isComputerWorkspaceOpen);
});
