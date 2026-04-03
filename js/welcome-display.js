import UserProfileService from './user-profile-service.js';

const CARD_CONFIG = [
    {
        key: 'prompt',
        icon: 'fa-regular fa-pen-to-square',
        title: 'Current Prompt',
        description: 'Your draft stays visible here while you type.'
    },
    {
        key: 'sessions',
        icon: 'fa-regular fa-clock',
        title: 'Latest Past Chats',
        description: 'Jump back into your most recent conversations.'
    },
    {
        key: 'tasks',
        icon: 'fa-regular fa-circle-check',
        title: 'Recent Tasks',
        description: 'A good third card for resuming work quickly.'
    }
];

const PROMPT_SUGGESTIONS = [
    'Draft a clear product spec from these notes.',
    'Summarize this topic with sources and key takeaways.',
    'Generate a clean UI plan for this screen.',
    'Write a friendly, concise email reply.',
    'Break this task into actionable steps.',
    'Review this code for bugs and improvements.',
    'Debug this error and suggest a fix.',
    'Write comprehensive documentation for this feature.',
    'Refactor this code for better readability.',
    'Create unit tests for this function.'
];

class WelcomeDisplay {
    constructor() {
        this.isVisible = false;
        this.username = null;
        this.welcomeElement = null;
        this.suggestionsWrapper = null;
        this.initialized = false;
        this.userProfileService = new UserProfileService();
        this.hiddenByFloatingWindow = false;
        this.recentSessions = [];
        this.recentTasks = [];
        this.cardElements = new Map();
        this.handleInputChange = this.handleInputChange.bind(this);
    }

    initialize() {
        if (this.initialized) return;

        this.createWelcomeElement();
        this.createCardRail();
        this.fetchUsername();
        this.bindEvents();
        this.syncPromptCard();
        this.loadDynamicData();
        this.initialized = true;

        setTimeout(() => {
            this.updateDisplay();
        }, 100);

        console.log('WelcomeDisplay initialized successfully');
    }

    createWelcomeElement() {
        this.welcomeElement = document.createElement('div');
        this.welcomeElement.className = 'welcome-container hidden';
        this.welcomeElement.setAttribute('role', 'banner');
        this.welcomeElement.setAttribute('aria-live', 'polite');

        const welcomeContent = document.createElement('div');
        welcomeContent.className = 'welcome-content';

        const heading = document.createElement('h1');
        heading.className = 'welcome-heading';
        heading.id = 'welcome-heading';
        heading.textContent = 'Hello there';

        const secondaryHeading = document.createElement('h2');
        secondaryHeading.className = 'welcome-secondary-heading';
        secondaryHeading.id = 'welcome-secondary-heading';
        secondaryHeading.textContent = 'What can I do for you?';

        welcomeContent.appendChild(heading);
        welcomeContent.appendChild(secondaryHeading);
        this.welcomeElement.appendChild(welcomeContent);

        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.appendChild(this.welcomeElement);
        }
    }

    createCardRail() {
        this.suggestionsWrapper = document.createElement('div');
        this.suggestionsWrapper.className = 'home-suggestions-wrapper hidden';
        this.suggestionsWrapper.id = 'home-suggestions-wrapper';
        this.suggestionsWrapper.setAttribute('role', 'complementary');
        this.suggestionsWrapper.setAttribute('aria-label', 'Welcome overview');

        const rail = document.createElement('div');
        rail.className = 'welcome-chip-rail';

        CARD_CONFIG.forEach((card) => {
            rail.appendChild(this.createCard(card));
        });

        this.suggestionsWrapper.appendChild(rail);

        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.appendChild(this.suggestionsWrapper);
        }
    }

    createCard(card) {
        const article = document.createElement('article');
        article.className = 'welcome-chip-item';
        article.dataset.cardKey = card.key;

        article.innerHTML = `
            <div class="welcome-chip">
                <div class="welcome-chip-header">
                    <div class="welcome-chip-badge">
                        <span class="welcome-chip-icon"><i class="${card.icon}" aria-hidden="true"></i></span>
                        <div class="welcome-chip-heading">
                            <h3 class="welcome-chip-title">${card.title}</h3>
                            <p class="welcome-chip-description">${card.description}</p>
                        </div>
                    </div>
                </div>
                <div class="welcome-chip-content"></div>
                <div class="welcome-chip-footer"></div>
            </div>
        `;

        this.cardElements.set(card.key, {
            root: article,
            content: article.querySelector('.welcome-chip-content'),
            footer: article.querySelector('.welcome-chip-footer')
        });

        this.renderCard(card.key);
        return article;
    }

    renderCard(key) {
        const refs = this.cardElements.get(key);
        if (!refs) return;

        if (key === 'prompt') {
            refs.content.innerHTML = this.getPromptCardHtml();
            refs.footer.innerHTML = '';
            refs.content.querySelectorAll('[data-prompt]').forEach((button) => {
                button.addEventListener('click', () => {
                    this.applyPromptSuggestion(button.dataset.prompt);
                });
            });
            return;
        }

        if (key === 'sessions') {
            refs.content.innerHTML = this.getSessionsCardHtml();
            refs.footer.innerHTML = `<div class="welcome-card-footnote">Recent chat history is shown upfront for faster continuation.</div>`;
            refs.content.querySelectorAll('[data-session-id]').forEach((button) => {
                button.addEventListener('click', () => this.openSessionHistory(button.dataset.sessionId));
            });
            return;
        }

        if (key === 'tasks') {
            refs.content.innerHTML = this.getTasksCardHtml();
            refs.footer.innerHTML = `<button type="button" class="welcome-card-action" data-action="open-tasks">Open Tasks</button>`;
            refs.footer.querySelector('[data-action="open-tasks"]')?.addEventListener('click', () => {
                this.openTasksPanel();
            });
        }
    }

    getPromptCardHtml() {
        const value = this.getCurrentPromptText().trim();
        const promptBlock = value
            ? `
                <div class="welcome-prompt-block">
                    <div class="welcome-prompt-meta">${value.length} characters</div>
                    <div class="welcome-prompt-text">${this.escapeHtml(value)}</div>
                </div>
            `
            : '';

        const suggestions = PROMPT_SUGGESTIONS.map((prompt) => `
            <button type="button" class="welcome-prompt-chip" data-prompt="${this.escapeHtml(prompt)}">
                ${this.escapeHtml(prompt)}
            </button>
        `).join('');

        return `
            ${promptBlock}
            <div class="welcome-prompt-suggestions">
                <div class="welcome-prompt-suggestions-label">Ready to go</div>
                <div class="welcome-prompt-suggestions-list">
                    ${suggestions}
                </div>
            </div>
        `;
    }

    getSessionsCardHtml() {
        if (!this.recentSessions.length) {
            return `
                <div class="welcome-card-empty">
                    No recent conversations yet. Once you start chatting, your latest sessions will appear here automatically.
                </div>
            `;
        }

        return `
            <div class="welcome-list">
                ${this.recentSessions.map((session) => `
                    <button type="button" class="welcome-list-item" data-session-id="${this.escapeHtml(session.session_id)}">
                        <span class="welcome-list-copy">
                            <span class="welcome-list-title">${this.escapeHtml(session.session_title || `Session ${session.session_id.slice(0, 8)}`)}</span>
                            <span class="welcome-list-meta">${this.escapeHtml(this.getTimeAgo(session.created_at))}</span>
                        </span>
                        <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                    </button>
                `).join('')}
            </div>
        `;
    }

    getTasksCardHtml() {
        if (!this.recentTasks.length) {
            return `
                <div class="welcome-card-empty">
                    No recent tasks yet. This card is a good third section because it helps you return to work instead of only starting new prompts.
                </div>
            `;
        }

        return `
            <div class="welcome-list">
                ${this.recentTasks.map((task) => `
                    <button type="button" class="welcome-list-item" data-action="open-tasks">
                        <span class="welcome-list-copy">
                            <span class="welcome-list-title">${this.escapeHtml(task.text || 'Untitled task')}</span>
                            <span class="welcome-list-meta">${this.escapeHtml(this.getTaskMeta(task))}</span>
                        </span>
                        <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                    </button>
                `).join('')}
            </div>
        `;
    }

    bindEvents() {
        document.addEventListener('messageAdded', () => {
            this.loadDynamicData();
            this.updateDisplay();
        });

        document.addEventListener('conversationCleared', () => {
            this.loadDynamicData();
            this.updateDisplay();
        });

        const input = document.getElementById('floating-input');
        input?.addEventListener('input', this.handleInputChange);
    }

    handleInputChange() {
        this.syncPromptCard();
    }

    async fetchUsername() {
        try {
            const username = await this.userProfileService.getUserName();
            this.updateUsername(username);
        } catch (error) {
            console.warn('Could not fetch username:', error);
            this.updateUsername('there');
        }
    }

    updateUsername(username) {
        this.username = username;
        const heading = this.welcomeElement?.querySelector('.welcome-heading');
        if (heading) {
            heading.textContent = `Hello ${username}`;
        }
    }

    async loadDynamicData() {
        await Promise.allSettled([
            this.loadRecentSessions(),
            this.loadRecentTasks()
        ]);
        this.renderCard('sessions');
        this.renderCard('tasks');
    }

    async loadRecentSessions() {
        try {
            if (!window.electron?.auth?.fetchSessionTitles) {
                this.recentSessions = [];
                return;
            }
            const session = await window.electron.auth.getSession();
            if (!session?.access_token) {
                this.recentSessions = [];
                return;
            }
            const sessions = await window.electron.auth.fetchSessionTitles(6, 0);
            this.recentSessions = Array.isArray(sessions) ? sessions.slice(0, 6) : [];
        } catch (error) {
            console.warn('WelcomeDisplay: Failed to load sessions', error);
            this.recentSessions = [];
        }
    }

    async loadRecentTasks() {
        try {
            if (!window.electron?.tasks?.list) {
                this.recentTasks = [];
                return;
            }
            const tasks = await window.electron.tasks.list();
            this.recentTasks = Array.isArray(tasks) ? tasks.slice(0, 3) : [];
        } catch (error) {
            console.warn('WelcomeDisplay: Failed to load tasks', error);
            this.recentTasks = [];
        }
    }

    syncPromptCard() {
        this.renderCard('prompt');
    }

    getCurrentPromptText() {
        return document.getElementById('floating-input')?.value || '';
    }

    focusInput() {
        const input = document.getElementById('floating-input');
        if (!input) return;
        input.focus();
        const length = input.value.length;
        input.setSelectionRange(length, length);
    }

    applyPromptSuggestion(prompt) {
        const input = document.getElementById('floating-input');
        if (!input) return;
        input.value = prompt;
        input.style.height = 'auto';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        this.focusInput();
    }

    openTasksPanel() {
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isToDoListOpen: true });
        }
    }

    openSessionHistory(sessionId) {
        if (!sessionId || !window.contextHandler?.showSessionDetails) return;

        const contextWindow = document.getElementById('context-window');
        contextWindow?.classList.remove('hidden');
        window.contextHandler.isWindowOpen = true;
        window.contextHandler.openContextWindow?.();
        window.contextHandler.showSessionDetails(sessionId);

        if (window.floatingWindowManager) {
            window.floatingWindowManager.onWindowOpen('context');
        }
    }

    getTimeAgo(unixSeconds) {
        if (!unixSeconds) return 'Recently';

        const now = Date.now();
        const time = Number(unixSeconds) * 1000;
        const diffMs = Math.max(0, now - time);
        const diffMinutes = Math.floor(diffMs / 60000);

        if (diffMinutes < 1) return 'Just now';
        if (diffMinutes < 60) return `${diffMinutes}m ago`;

        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours}h ago`;

        const diffDays = Math.floor(diffHours / 24);
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;

        return new Date(time).toLocaleDateString();
    }

    getTaskMeta(task) {
        const parts = [];
        if (task.status) parts.push(task.status.replace(/_/g, ' '));
        if (task.priority) parts.push(`${task.priority} priority`);
        if (task.deadline) parts.push(`due ${new Date(task.deadline).toLocaleDateString()}`);
        return parts.join(' | ') || 'Open tasks to continue';
    }

    show() {
        if (!this.welcomeElement || !this.suggestionsWrapper || this.isVisible) return;

        this.syncPromptCard();
        this.loadDynamicData();
        this.welcomeElement.classList.remove('hidden');
        this.welcomeElement.classList.add('visible');
        this.suggestionsWrapper.classList.remove('hidden');
        this.suggestionsWrapper.classList.add('visible');
        this.isVisible = true;
    }

    hide() {
        if (!this.welcomeElement || !this.suggestionsWrapper || !this.isVisible) return;

        this.welcomeElement.classList.remove('visible');
        this.welcomeElement.classList.add('hidden');
        this.suggestionsWrapper.classList.remove('visible');
        this.suggestionsWrapper.classList.add('hidden');
        this.isVisible = false;
    }

    shouldShow() {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return true;

        const activeThread =
            chatMessages.querySelector('.conversation-thread.active:not(.hidden)') ||
            chatMessages.querySelector('.conversation-thread:not(.hidden)');

        if (activeThread) {
            return activeThread.querySelectorAll('.message').length === 0;
        }

        return chatMessages.querySelectorAll('.message').length === 0;
    }

    updateDisplay() {
        if (this.shouldShow() && !this.hiddenByFloatingWindow) {
            this.show();
        } else {
            this.hide();
        }
    }

    hideForFloatingWindow() {
        this.hiddenByFloatingWindow = true;
        this.hide();
    }

    showAfterFloatingWindow() {
        this.hiddenByFloatingWindow = false;
        this.updateDisplay();
    }

    async refreshUsername() {
        console.log('WelcomeDisplay: Refreshing username due to auth state change.');
        this.userProfileService.clearCache();
        await this.fetchUsername();
        await this.loadDynamicData();
    }

    escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }
}

export default WelcomeDisplay;
