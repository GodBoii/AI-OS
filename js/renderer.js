class StateManager {
    constructor() {
        this._state = {
            isDarkMode: true,
            isWindowMaximized: false,
            isChatOpen: false,
            isAIOSOpen: false,
            isToDoListOpen: false,
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
            chatIcon: document.getElementById('chat-icon'),
            toDoListIcon: document.getElementById('to-do-list-icon'),

            themeToggle: document.getElementById('theme-toggle'),
            minimizeBtn: document.getElementById('minimize-window'),
            resizeBtn: document.getElementById('resize-window'),
            closeBtn: document.getElementById('close-window'),

            webViewContainer: null,
        };
    }

    setupWebViewEvents() {
        const ipcRenderer = window.electron.ipcRenderer;

        ipcRenderer.on('webview-created', (bounds) => {
            this.createWebViewContainer(bounds);
        });

        ipcRenderer.on('webview-closed', () => {
            this.removeWebViewContainer();
        });
    }

    createWebViewContainer(bounds) {
        if (this.elements.webViewContainer) {
            this.removeWebViewContainer();
        }

        this.elements.webViewContainer = document.createElement('div');
        this.elements.webViewContainer.id = 'webview-container';
        this.elements.webViewContainer.className = 'webview-container';
        this.elements.webViewContainer.style.left = `${bounds.x}px`;
        this.elements.webViewContainer.style.top = `${bounds.y}px`;
        this.elements.webViewContainer.style.width = `${bounds.width}px`;
        this.elements.webViewContainer.style.height = `${bounds.height}px`;
        this.elements.webViewContainer.style.pointerEvents = 'all';

        const header = document.createElement('div');
        header.className = 'webview-header';
        header.innerHTML = `
            <div class="drag-handle">
                <span class="webview-title">Web View</span>
            </div>
            <div class="webview-controls">
                <button class="close-webview" title="Close Webview">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        header.style.position = 'relative';
        header.style.zIndex = '1004';
        header.style.pointerEvents = 'all';

        header.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!e.target.closest('.close-webview')) {
                this.startDragging(e);
            }
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

        const resizePositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
        resizePositions.forEach(position => {
            const resizer = document.createElement('div');
            resizer.className = `resizer ${position}`;
            resizer.style.pointerEvents = 'all';
            resizer.style.zIndex = '1005';
            this.elements.webViewContainer.appendChild(resizer);
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startResizing(e, position);
            }, true);
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

            container.style.left = `${newBounds.x}px`;
            container.style.top = `${newBounds.y}px`;
            container.style.width = `${newBounds.width}px`;
            container.style.height = `${newBounds.height}px`;
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
        const addClickHandler = (element, handler) => {
            element?.addEventListener('click', handler);
        };

        // Sidebar and app section toggles
        addClickHandler(this.elements.appIcon, () => this.state.setState({ isAIOSOpen: !this.state.getState().isAIOSOpen }));
        addClickHandler(this.elements.chatIcon, () => this.state.setState({ isChatOpen: !this.state.getState().isChatOpen }));
        addClickHandler(this.elements.toDoListIcon, () => this.state.setState({ isToDoListOpen: !this.state.getState().isToDoListOpen }));

        // Window controls
        addClickHandler(this.elements.minimizeBtn, () => ipcRenderer.send('minimize-window'));
        addClickHandler(this.elements.resizeBtn, () => ipcRenderer.send('toggle-maximize-window'));
        addClickHandler(this.elements.closeBtn, () => ipcRenderer.send('close-window'));
        addClickHandler(this.elements.themeToggle, () => this.state.setState({ isDarkMode: !this.state.getState().isDarkMode }));

        // No dropdown JS here — hover effect is fully CSS-based now

        ipcRenderer.on('window-state-changed', (isMaximized) => {
            this.state.setState({ isWindowMaximized: isMaximized });
        });

        document.addEventListener('click', (event) => {
            if (event.target.tagName === 'A' && event.target.href && event.target.href.startsWith('http')) {
                event.preventDefault();
                ipcRenderer.send('open-webview', event.target.href);
            }
        });
    }

    setupStateSubscription() {
        this.state.subscribe((state, changedKeys) => {
            changedKeys.forEach(key => {
                switch (key) {
                    case 'isDarkMode':
                        this.updateTheme(state.isDarkMode);
                        break;
                    case 'isWindowMaximized':
                        this.updateWindowControls(state.isWindowMaximized);
                        break;
                    case 'isChatOpen':
                        if (state.isChatOpen && (state.isAIOSOpen || state.isToDoListOpen)) {
                            this.state.setState({ isAIOSOpen: false, isToDoListOpen: false });
                        }
                        this.updateChatVisibility(state.isChatOpen);
                        break;
                    case 'isAIOSOpen':
                        if (state.isAIOSOpen && (state.isChatOpen || state.isToDoListOpen)) {
                            this.state.setState({ isChatOpen: false, isToDoListOpen: false });
                        }
                        this.updateAIOSVisibility(state.isAIOSOpen);
                        break;
                    case 'isToDoListOpen':
                        if (state.isToDoListOpen && (state.isChatOpen || state.isAIOSOpen)) {
                            this.state.setState({ isChatOpen: false, isAIOSOpen: false });
                        }
                        this.updateToDoListVisibility(state.isToDoListOpen);
                        break;
                }
            });
        });
    }

    updateToDoListVisibility(isOpen) {
        document.getElementById('to-do-list-container')?.classList.toggle('hidden', !isOpen);
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
        const chatContainer = document.getElementById('chat-container');
        const inputContainer = document.getElementById('floating-input-container');
        if (chatContainer && inputContainer) {
            chatContainer.classList.toggle('hidden', !isOpen);
            inputContainer.classList.toggle('hidden', !isOpen);
        }
    }

    updateAIOSVisibility(isOpen) {
        if (window.AIOS?.initialized) {
            document.getElementById('floating-window')?.classList.toggle('hidden', !isOpen);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const stateManager = new StateManager();
    window.stateManager = stateManager;
    new UIManager(stateManager);

    const loadModule = async (name, containerId, initFunc) => {
        try {
            const response = await fetch(`${name}.html`);
            const html = await response.text();
            document.getElementById(containerId).innerHTML = html;
            initFunc?.();
        } catch (error) {
            console.error(`Error loading ${name}:`, error);
        }
    };

    loadModule('aios', 'aios-container', () => window.AIOS?.init());
    loadModule('chat', 'chat-root', () => window.chatModule?.init());
    loadModule('to-do-list', 'to-do-list-root', () => window.todo?.init());
});
