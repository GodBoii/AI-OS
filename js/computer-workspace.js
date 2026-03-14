class ComputerWorkspace {
    constructor() {
        this.initialized = false;
        this.activeContext = null;
        this.init();
    }

    async init() {
        try {
            await this.waitForElement('computer-workspace-chip');
            this.cacheElements();
            this.bindEvents();
            this.initialized = true;
            this.refreshScopeLabel();
        } catch (error) {
            console.warn('[ComputerWorkspace] Initialization skipped:', error.message);
        }
    }

    waitForElement(id, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const timer = setInterval(() => {
                if (document.getElementById(id)) {
                    clearInterval(timer);
                    resolve(true);
                    return;
                }
                if (Date.now() - started > timeoutMs) {
                    clearInterval(timer);
                    reject(new Error(`Element '${id}' not found`));
                }
            }, 80);
        });
    }

    cacheElements() {
        this.el = {
            chip: document.getElementById('computer-workspace-chip'),
            label: document.getElementById('computer-chip-label'),
            manualGrantBtn: document.getElementById('computer-manual-grant-btn'),
            selectScopeBtn: document.getElementById('computer-select-scope-btn'),
            closeBtn: document.getElementById('computer-workspace-close'),
            exitBtn: document.getElementById('computer-exit-btn'),
        };
    }

    bindEvents() {
        this.el.manualGrantBtn?.addEventListener('click', () => this.manualGrantPermission());
        this.el.selectScopeBtn?.addEventListener('click', () => this.selectScopeDirectory());
        this.el.closeBtn?.addEventListener('click', () => this.closePanel());
        this.el.exitBtn?.addEventListener('click', () => this.exitComputerMode());

        document.addEventListener('computer-workspace:open', (event) => {
            this.openComputerWorkspace(event?.detail || {});
        });
    }

    setStatus(message) {
        // Status removed from chip design - log to console for debugging
        console.log('[ComputerWorkspace]', message);
    }

    async fetchAccessState() {
        try {
            const api = window.electron?.ipcRenderer;
            if (!api?.invoke) return null;
            const response = await api.invoke('computer-get-access-state');
            return response?.success ? response.state : null;
        } catch (error) {
            console.warn('[ComputerWorkspace] Failed to fetch access state:', error.message);
            return null;
        }
    }

    updateScopeLabel(state) {
        const labelEl = this.el.label;
        const grantBtn = this.el.manualGrantBtn;
        const scopes = state?.scopes || [];
        if (!labelEl) return;

        // Update the action button UI based on state
        if (grantBtn) {
            const icon = grantBtn.querySelector('i');
            const text = grantBtn.querySelector('span');

            if (state?.enabled) {
                grantBtn.classList.add('granted');
                if (icon) icon.className = 'fas fa-check-circle';
                if (text) text.textContent = 'Permission Granted';
            } else {
                grantBtn.classList.remove('granted');
                if (icon) icon.className = 'fas fa-unlock-alt';
                if (text) text.textContent = 'Grant Permission';
            }
        }

        if (!state?.enabled) {
            labelEl.textContent = 'Computer Workspace';
            this.el.chip.title = 'Computer access is not granted';
            return;
        }

        const primary = scopes[0];
        if (!primary) {
            labelEl.textContent = 'Computer Workspace';
            this.el.chip.title = `Permission: ${state.permissionSource || 'unknown'}`;
            return;
        }

        const compact = primary.length > 28 ? `...${primary.slice(-28)}` : primary;
        labelEl.textContent = `Scope: ${compact}`;
        this.el.chip.title = `Permission: ${state.permissionSource || 'unknown'} | Scope: ${primary}`;
    }

    async refreshScopeLabel() {
        const state = await this.fetchAccessState();
        this.updateScopeLabel(state);
    }

    openPanel() {
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isComputerWorkspaceOpen: true });
        } else {
            this.el.chip?.classList.remove('hidden');
            document.body.classList.add('computer-panel-open');
        }
    }

    closePanel() {
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isComputerWorkspaceOpen: false });
        } else {
            this.el.chip?.classList.add('hidden');
            document.body.classList.remove('computer-panel-open');
        }
    }

    openComputerWorkspace(detail = {}) {
        this.activeContext = {
            ...detail,
            agentMode: 'computer',
            isDedicatedComputer: true,
            mode: 'computer',
        };
        window.computerContext = this.activeContext;

        // Keep modes mutually exclusive
        window.projectContext = null;
        window.activeProjectContext = null;
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isProjectWorkspaceOpen: false });
        }

        this.setStatus('Computer mode active. Messages will route to dedicated computer agent.');
        this.openPanel();
        this.refreshScopeLabel();
    }

    isModeActive() {
        const ctx = window.computerContext || this.activeContext || null;
        if (!ctx || typeof ctx !== 'object') {
            return false;
        }
        if (String(ctx.agentMode || '').toLowerCase() === 'computer') {
            return true;
        }
        if (ctx.isDedicatedComputer === true) {
            return true;
        }
        if (String(ctx.mode || '').toLowerCase() === 'computer') {
            return true;
        }
        return false;
    }

    ensureContext() {
        if (this.isModeActive()) {
            return;
        }
        this.openComputerWorkspace({});
    }

    async sendMessageToChat(message, startNew = false) {
        const input = document.getElementById('floating-input');
        const sendBtn = document.getElementById('send-message');
        const newChatBtn = document.querySelector('.add-btn');
        if (!input || !sendBtn) return;

        if (startNew) {
            if (typeof window.startNewConversation === 'function') {
                await window.startNewConversation();
            } else if (newChatBtn) {
                newChatBtn.click();
                await new Promise((resolve) => setTimeout(resolve, 150));
            }
        }

        input.value = message;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sendBtn.click();
    }

    // Simplified methods - removed UI-dependent functionality
    async startComputerChat() {
        this.ensureContext();
        const intro =
            'You are in dedicated computer mode. First call request_permission(), then check status and wait for my next desktop/browser instruction.';
        await this.sendMessageToChat(intro, true);
        this.setStatus('Started dedicated computer chat.');
    }

    async manualGrantPermission() {
        try {
            const api = window.electron?.ipcRenderer;
            if (!api?.invoke) {
                throw new Error('IPC bridge is not available');
            }
            const response = await api.invoke('computer-manual-grant');
            if (!response?.success) {
                throw new Error(response?.error || 'Manual permission grant failed');
            }

            this.updateScopeLabel(response.state);
            window.notificationService?.show('Computer control granted manually.', 'success', 2600);
            this.setStatus('Manual permission granted (hybrid mode).');
        } catch (error) {
            window.notificationService?.show(`Permission grant failed: ${error.message}`, 'error', 3200);
        }
    }

    async selectScopeDirectory() {
        try {
            const api = window.electron?.ipcRenderer;
            if (!api?.invoke) {
                throw new Error('IPC bridge is not available');
            }
            const response = await api.invoke('computer-select-scope');
            if (response?.canceled) return;
            if (!response?.success) {
                throw new Error(response?.error || 'Scope selection failed');
            }

            this.updateScopeLabel(response.state);
            window.notificationService?.show(`Computer scope set to: ${response.selectedPath}`, 'success', 3000);
            this.setStatus(`Scope updated to ${response.selectedPath}`);
        } catch (error) {
            window.notificationService?.show(`Scope update failed: ${error.message}`, 'error', 3200);
        }
    }

    exitComputerMode() {
        this.activeContext = null;
        window.computerContext = null;
        this.setStatus('Computer mode off. Starting a new normal chat session.');
        this.closePanel();
        this.updateScopeLabel(null);

        const newChatBtn = document.querySelector('.add-btn');
        if (newChatBtn) {
            newChatBtn.click();
        }
    }
}

const computerWorkspace = new ComputerWorkspace();
window.computerWorkspace = computerWorkspace;

export default computerWorkspace;
