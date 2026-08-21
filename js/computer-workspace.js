class ComputerWorkspace {
    constructor() {
        this.initialized = false;
        this.activeContext = null;
        this.menuCloseTimer = null;
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
            toolbarActions: document.getElementById('computer-toolbar-actions'),
            toolbarTrigger: document.getElementById('computer-toolbar-trigger'),
            toolbarMenu: document.getElementById('computer-toolbar-menu'),
            manualGrantBtn: document.getElementById('computer-manual-grant-btn'),
            selectScopeBtn: document.getElementById('computer-select-scope-btn'),
            closeBtn: document.getElementById('computer-workspace-close'),
            exitBtn: document.getElementById('computer-exit-btn'),
        };
    }

    bindEvents() {
        this.el.toolbarTrigger?.addEventListener('click', (event) => {
            event.stopPropagation();
            this.toggleActionsMenu();
        });
        this.el.toolbarTrigger?.addEventListener('keydown', (event) => this.handleTriggerKeydown(event));
        this.el.toolbarMenu?.addEventListener('keydown', (event) => this.handleMenuKeydown(event));

        this.el.manualGrantBtn?.addEventListener('click', () => {
            this.closeActionsMenu({ restoreFocus: false });
            void this.manualGrantPermission();
        });
        this.el.selectScopeBtn?.addEventListener('click', () => {
            this.closeActionsMenu({ restoreFocus: false });
            void this.selectScopeDirectory();
        });
        this.el.closeBtn?.addEventListener('click', () => {
            this.closeActionsMenu({ restoreFocus: false });
            this.closePanel();
        });
        this.el.exitBtn?.addEventListener('click', () => {
            this.closeActionsMenu({ restoreFocus: false });
            this.exitComputerMode();
        });

        document.addEventListener('click', (event) => {
            if (!this.el.toolbarActions?.contains(event.target)) {
                this.closeActionsMenu({ restoreFocus: false });
            }
        });

        document.addEventListener('computer-workspace:open', (event) => {
            this.openComputerWorkspace(event?.detail || {});
        });
    }

    getMenuItems() {
        return Array.from(this.el.toolbarMenu?.querySelectorAll('[role="menuitem"]') || []);
    }

    openActionsMenu({ focus = false } = {}) {
        if (!this.el.toolbarMenu || !this.el.toolbarTrigger) return;

        if (this.menuCloseTimer !== null) {
            clearTimeout(this.menuCloseTimer);
            this.menuCloseTimer = null;
        }
        this.el.toolbarMenu.hidden = false;
        this.el.toolbarMenu.setAttribute('aria-hidden', 'false');
        this.el.toolbarMenu.classList.remove('is-closing');
        void this.el.toolbarMenu.offsetWidth;
        this.el.toolbarMenu.classList.add('is-open');
        this.el.toolbarActions?.classList.add('menu-open');
        this.el.toolbarTrigger.setAttribute('aria-expanded', 'true');

        if (focus) {
            this.getMenuItems()[0]?.focus();
        }
    }

    closeActionsMenu({ restoreFocus = false } = {}) {
        if (!this.el.toolbarMenu || !this.el.toolbarTrigger || !this.el.toolbarMenu.classList.contains('is-open')) return;

        this.el.toolbarMenu.classList.remove('is-open');
        this.el.toolbarMenu.classList.add('is-closing');
        this.el.toolbarMenu.setAttribute('aria-hidden', 'true');
        this.el.toolbarActions?.classList.remove('menu-open');
        this.el.toolbarTrigger.setAttribute('aria-expanded', 'false');

        const closeDuration = Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')
        ) || 150;
        this.menuCloseTimer = setTimeout(() => {
            this.el.toolbarMenu?.classList.remove('is-closing');
            if (this.el.toolbarMenu) this.el.toolbarMenu.hidden = true;
            this.menuCloseTimer = null;
        }, closeDuration);

        if (restoreFocus) {
            this.el.toolbarTrigger.focus();
        }
    }

    toggleActionsMenu() {
        if (this.el.toolbarMenu?.classList.contains('is-open')) {
            this.closeActionsMenu();
        } else {
            this.openActionsMenu();
        }
    }

    handleTriggerKeydown(event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

        event.preventDefault();
        this.openActionsMenu({ focus: true });
        if (event.key === 'ArrowUp') {
            this.getMenuItems().at(-1)?.focus();
        }
    }

    handleMenuKeydown(event) {
        const menuItems = this.getMenuItems();
        const currentIndex = menuItems.indexOf(document.activeElement);

        if (event.key === 'Escape') {
            event.preventDefault();
            this.closeActionsMenu({ restoreFocus: true });
            return;
        }

        if (event.key === 'Tab') {
            this.closeActionsMenu();
            return;
        }

        const keyTargets = {
            ArrowDown: currentIndex < 0 ? 0 : (currentIndex + 1) % menuItems.length,
            ArrowUp: currentIndex < 0 ? menuItems.length - 1 : (currentIndex - 1 + menuItems.length) % menuItems.length,
            Home: 0,
            End: menuItems.length - 1,
        };
        const targetIndex = keyTargets[event.key];
        if (targetIndex === undefined || !menuItems[targetIndex]) return;

        event.preventDefault();
        menuItems[targetIndex].focus();
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
        // Show the inline toolbar buttons
        this.el.toolbarActions?.classList.remove('hidden');
    }

    closePanel() {
        this.closeActionsMenu({ restoreFocus: false });
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isComputerWorkspaceOpen: false });
        } else {
            this.el.chip?.classList.add('hidden');
            document.body.classList.remove('computer-panel-open');
        }
        // Hide the inline toolbar buttons
        this.el.toolbarActions?.classList.add('hidden');
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
        window.uiManager?.updateActiveWorkspacePill?.();
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
        window.uiManager?.updateActiveWorkspacePill?.();

        const newChatBtn = document.querySelector('.add-btn');
        if (newChatBtn) {
            newChatBtn.click();
        }
    }
}

const computerWorkspace = new ComputerWorkspace();
window.computerWorkspace = computerWorkspace;

export default computerWorkspace;
