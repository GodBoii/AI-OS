class ComputerWorkspace {
    constructor() {
        this.initialized = false;
        this.activeContext = null;
        this.init();
    }

    async init() {
        try {
            await this.waitForElement('computer-workspace-panel');
            this.cacheElements();
            this.bindEvents();
            this.initialized = true;
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
            panel: document.getElementById('computer-workspace-panel'),
            title: document.getElementById('computer-workspace-title'),
            subtitle: document.getElementById('computer-workspace-subtitle'),
            status: document.getElementById('computer-workspace-status'),
            closeBtn: document.getElementById('computer-workspace-close'),
            startChatBtn: document.getElementById('computer-start-chat-btn'),
            browserTaskBtn: document.getElementById('computer-open-browser-task-btn'),
            permissionBtn: document.getElementById('computer-request-permission-btn'),
            browserPromptInput: document.getElementById('computer-browser-prompt'),
            exitBtn: document.getElementById('computer-exit-btn'),
        };
    }

    bindEvents() {
        this.el.closeBtn?.addEventListener('click', () => this.closePanel());
        this.el.startChatBtn?.addEventListener('click', () => this.startComputerChat());
        this.el.browserTaskBtn?.addEventListener('click', () => this.sendBrowserTask());
        this.el.permissionBtn?.addEventListener('click', () => this.requestPermissionFlow());
        this.el.exitBtn?.addEventListener('click', () => this.exitComputerMode());

        document.addEventListener('computer-workspace:open', (event) => {
            this.openComputerWorkspace(event?.detail || {});
        });
    }

    setStatus(message) {
        if (this.el.status) {
            this.el.status.textContent = message;
        }
    }

    openPanel() {
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isComputerWorkspaceOpen: true });
        } else {
            this.el.panel?.classList.remove('hidden');
            document.body.classList.add('computer-panel-open');
        }
    }

    closePanel() {
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isComputerWorkspaceOpen: false });
        } else {
            this.el.panel?.classList.add('hidden');
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

        this.el.title.textContent = 'Computer Workspace';
        this.el.subtitle.textContent = 'Desktop + Browser automation mode';
        this.setStatus('Computer mode active. Messages will route to dedicated computer agent.');
        this.openPanel();
    }

    ensureContext() {
        const ctx = window.computerContext || this.activeContext;
        if (ctx && typeof ctx === 'object') {
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

    async startComputerChat() {
        this.ensureContext();
        const intro =
            'You are in dedicated computer mode. First call request_permission(), then check status and wait for my next desktop/browser instruction.';
        await this.sendMessageToChat(intro, true);
        this.setStatus('Started dedicated computer chat.');
    }

    async requestPermissionFlow() {
        this.ensureContext();
        const prompt =
            'In dedicated computer mode, call request_permission() now. If granted, report status and wait for my next action.';
        await this.sendMessageToChat(prompt, false);
        this.setStatus('Permission request sent to computer agent.');
    }

    async sendBrowserTask() {
        this.ensureContext();
        const userPrompt = (this.el.browserPromptInput?.value || '').trim();
        if (!userPrompt) {
            this.setStatus('Enter a browser task prompt first.');
            return;
        }

        const message =
            `In dedicated computer mode, use browser tools to complete this task:\n${userPrompt}\n` +
            'Start by checking browser status, then execute the task step-by-step.';
        await this.sendMessageToChat(message, true);
        this.setStatus('Browser task sent to dedicated computer agent.');
    }

    exitComputerMode() {
        this.activeContext = null;
        window.computerContext = null;
        this.el.title.textContent = 'Computer Workspace';
        this.el.subtitle.textContent = 'Desktop + Browser automation mode';
        this.setStatus('Computer mode off. Starting a new normal chat session.');
        this.closePanel();

        const newChatBtn = document.querySelector('.add-btn');
        if (newChatBtn) {
            newChatBtn.click();
        }
    }
}

const computerWorkspace = new ComputerWorkspace();
window.computerWorkspace = computerWorkspace;

export default computerWorkspace;
