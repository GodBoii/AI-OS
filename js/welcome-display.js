// js/welcome-display.js (Complete, Updated with Home Screen Cards)

import UserProfileService from './user-profile-service.js';

/**
 * Suggestion card data — prompt starters, guides, and capability highlights.
 * Each card can optionally have a `prompt` that auto-fills the chat input on click.
 */
const SUGGESTION_CARDS = [
    {
        icon: 'fa-solid fa-code',
        title: 'Build a website',
        desc: 'Create and deploy a full-stack web app from scratch',
        prompt: 'Build me a modern portfolio website with React and deploy it to Vercel'
    },
    {
        icon: 'fa-solid fa-magnifying-glass',
        title: 'Deep research',
        desc: 'Comprehensive web search and multi-source analysis',
        prompt: 'Research the latest trends in AI agents and give me a detailed summary'
    },
    {
        icon: 'fa-solid fa-desktop',
        title: 'Automate my PC',
        desc: 'Control your mouse, keyboard, and any desktop application',
        prompt: 'Open Google Chrome and search for the latest tech headlines'
    },
    {
        icon: 'fa-solid fa-brain',
        title: 'Solve & plan',
        desc: 'Break complex problems into clear, actionable steps',
        prompt: 'Help me plan and architect a SaaS application from zero to launch'
    }
];

/**
 * WelcomeDisplay - Manages the welcome message display, user personalization,
 * and home screen suggestion cards.
 * Handles the transition between welcome state and chat state.
 */
class WelcomeDisplay {
    constructor() {
        this.isVisible = false;
        this.username = null;
        this.welcomeElement = null;
        this.suggestionsWrapper = null;
        this.initialized = false;
        this.userProfileService = new UserProfileService();
        this.hiddenByFloatingWindow = false;
    }

    /**
     * Initialize the welcome display component
     */
    initialize() {
        if (this.initialized) return;

        this.createWelcomeElement();
        this.createSuggestionCards();
        this.fetchUsername(); // Initial fetch on startup
        this.bindEvents();
        this.initialized = true;

        setTimeout(() => {
            this.updateDisplay();
        }, 100);

        console.log('WelcomeDisplay initialized successfully');
    }

    /**
     * Create the welcome message HTML structure
     */
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

    /**
     * Create the suggestion cards grid and append to the app container
     */
    createSuggestionCards() {
        this.suggestionsWrapper = document.createElement('div');
        this.suggestionsWrapper.className = 'home-suggestions-wrapper hidden';
        this.suggestionsWrapper.id = 'home-suggestions-wrapper';
        this.suggestionsWrapper.setAttribute('role', 'navigation');
        this.suggestionsWrapper.setAttribute('aria-label', 'Quick start suggestions');

        const grid = document.createElement('div');
        grid.className = 'home-suggestions-grid';

        SUGGESTION_CARDS.forEach((card, index) => {
            const article = document.createElement('article');
            article.className = 'suggestion-card';
            article.setAttribute('tabindex', '0');
            article.setAttribute('role', 'button');
            article.setAttribute('aria-label', card.title + ': ' + card.desc);
            if (card.prompt) {
                article.dataset.prompt = card.prompt;
            }

            article.innerHTML = `
                <div class="suggestion-card-icon">
                    <i class="${card.icon}" aria-hidden="true"></i>
                </div>
                <h4 class="suggestion-card-title">${card.title}</h4>
                <p class="suggestion-card-desc">${card.desc}</p>
                <div class="suggestion-card-arrow">
                    <i class="fas fa-arrow-right" aria-hidden="true"></i>
                </div>
            `;

            // Click handler: populate the input and send
            article.addEventListener('click', () => this.onCardClick(card));
            article.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.onCardClick(card);
                }
            });

            grid.appendChild(article);
        });

        this.suggestionsWrapper.appendChild(grid);

        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.appendChild(this.suggestionsWrapper);
        }
    }

    /**
     * Handle a suggestion card click.
     * Fills the floating input with the card's prompt text then triggers send.
     */
    onCardClick(card) {
        if (!card.prompt) return;

        const input = document.getElementById('floating-input');
        const sendBtn = document.getElementById('send-message');

        if (input) {
            input.value = card.prompt;
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
            input.focus();
            // Dispatch input event so any listeners (autosize, state) pick up the change
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Auto-send after a brief delay so the user sees what was typed
        if (sendBtn) {
            setTimeout(() => {
                sendBtn.click();
            }, 150);
        }
    }

    /**
     * Fetch username for personalization using UserProfileService
     */
    async fetchUsername() {
        try {
            const username = await this.userProfileService.getUserName();
            this.updateUsername(username);
        } catch (error) {
            console.warn('Could not fetch username:', error);
            this.updateUsername('there');
        }
    }

    /**
     * Update the username in the welcome message
     * @param {string} username - The username to display.
     */
    updateUsername(username) {
        this.username = username;
        const heading = this.welcomeElement?.querySelector('.welcome-heading');
        if (heading) {
            heading.textContent = `Hello ${username}`;
        }
    }

    /**
     * Show the welcome message and suggestion cards with animation
     */
    show() {
        if (!this.welcomeElement || this.isVisible) return;
        this.welcomeElement.classList.remove('hidden');
        this.welcomeElement.classList.add('visible');

        // Show suggestion cards
        if (this.suggestionsWrapper) {
            this.suggestionsWrapper.classList.remove('hidden');
            this.suggestionsWrapper.classList.add('visible');
            // Re-trigger card animations by removing and re-adding them
            const cards = this.suggestionsWrapper.querySelectorAll('.suggestion-card');
            cards.forEach(card => {
                card.style.animation = 'none';
                // Force reflow
                void card.offsetHeight;
                card.style.animation = '';
            });
        }

        this.isVisible = true;
    }

    /**
     * Hide the welcome message and suggestion cards with animation
     */
    hide() {
        if (!this.welcomeElement || !this.isVisible) return;
        this.welcomeElement.classList.remove('visible');
        this.welcomeElement.classList.add('hidden');

        // Hide suggestion cards
        if (this.suggestionsWrapper) {
            this.suggestionsWrapper.classList.remove('visible');
            this.suggestionsWrapper.classList.add('hidden');
        }

        this.isVisible = false;
    }

    /**
     * Check if welcome message should be shown based on chat state
     */
    shouldShow() {
        const chatMessages = document.getElementById('chat-messages');
        return !chatMessages || chatMessages.children.length === 0;
    }

    /**
     * Update display based on current chat state
     */
    updateDisplay() {
        if (this.shouldShow() && !this.hiddenByFloatingWindow) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Bind event listeners to react to application state changes
     */
    bindEvents() {
        document.addEventListener('messageAdded', () => this.updateDisplay());
        document.addEventListener('conversationCleared', () => this.updateDisplay());
    }

    /**
     * Hide welcome message when floating windows open
     */
    hideForFloatingWindow() {
        this.hiddenByFloatingWindow = true;
        this.hide();
    }

    /**
     * Show welcome message when floating windows close (if appropriate)
     */
    showAfterFloatingWindow() {
        this.hiddenByFloatingWindow = false;
        this.updateDisplay();
    }

    /**
     * Public method to refresh the username from the auth service.
     * This is the key to solving the race condition.
     */
    async refreshUsername() {
        console.log('WelcomeDisplay: Refreshing username due to auth state change.');
        this.userProfileService.clearCache();
        await this.fetchUsername();
    }
}

// Export for use in other modules
export default WelcomeDisplay;