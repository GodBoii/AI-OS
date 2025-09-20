/**
 * WelcomeDisplay - Manages the welcome message display and user personalization
 * Handles the transition between welcome state and chat state
 */
class WelcomeDisplay {
    constructor() {
        this.isVisible = false;
        this.username = null;
        this.welcomeElement = null;
        this.initialized = false;
    }

    /**
     * Initialize the welcome display component
     */
    initialize() {
        if (this.initialized) return;

        this.createWelcomeElement();
        this.fetchUsername();
        this.bindEvents();
        this.initialized = true;

        // Show welcome message initially if no messages
        setTimeout(() => {
            this.updateDisplay();
        }, 100);

        console.log('WelcomeDisplay initialized successfully');
    }

    /**
     * Create the welcome message HTML structure
     */
    createWelcomeElement() {
        // Create welcome container
        this.welcomeElement = document.createElement('div');
        this.welcomeElement.className = 'welcome-container hidden';
        this.welcomeElement.setAttribute('role', 'banner');
        this.welcomeElement.setAttribute('aria-live', 'polite');

        // Create welcome content
        const welcomeContent = document.createElement('div');
        welcomeContent.className = 'welcome-content';

        // Create heading
        const heading = document.createElement('h1');
        heading.className = 'welcome-heading';
        heading.id = 'welcome-heading';

        // Create subtitle
        const subtitle = document.createElement('p');
        subtitle.className = 'welcome-subtitle';
        subtitle.textContent = 'Ask me anything - I\'m here to assist you';

        // Assemble structure
        welcomeContent.appendChild(heading);
        welcomeContent.appendChild(subtitle);
        this.welcomeElement.appendChild(welcomeContent);

        // Insert into DOM
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.appendChild(this.welcomeElement);
        }
    }

    /**
     * Fetch username for personalization
     */
    async fetchUsername() {
        try {
            // Try to get username from various sources
            let username = null;

            // Check if there's a stored username
            if (window.electron?.store) {
                username = await window.electron.store.get('username');
            }

            // Fallback to system username
            if (!username && window.electron?.os) {
                const userInfo = await window.electron.os.userInfo();
                username = userInfo?.username;
            }

            // Final fallback
            if (!username) {
                username = 'there';
            }

            this.updateUsername(username);
        } catch (error) {
            console.warn('Could not fetch username:', error);
            this.updateUsername('there');
        }
    }

    /**
     * Update the username in the welcome message
     */
    updateUsername(username) {
        this.username = username;
        const heading = this.welcomeElement?.querySelector('.welcome-heading');
        if (heading) {
            // Capitalize first letter of username
            const displayName = username.charAt(0).toUpperCase() + username.slice(1);
            heading.textContent = `Hello ${displayName}, what can I help you with today?`;
        }
    }

    /**
     * Show the welcome message with animation
     */
    show() {
        if (!this.welcomeElement || this.isVisible) return;

        this.welcomeElement.classList.remove('hidden');
        this.welcomeElement.classList.add('visible');
        this.isVisible = true;

        // Announce to screen readers
        this.welcomeElement.setAttribute('aria-live', 'polite');

        console.log('Welcome message displayed');
    }

    /**
     * Hide the welcome message with animation
     */
    hide() {
        if (!this.welcomeElement || !this.isVisible) return;

        this.welcomeElement.classList.remove('visible');
        this.welcomeElement.classList.add('hidden');
        this.isVisible = false;

        console.log('Welcome message hidden');
    }

    /**
     * Check if welcome message should be shown based on chat state
     */
    shouldShow() {
        const chatMessages = document.getElementById('chat-messages');
        const hasMessages = chatMessages && chatMessages.children.length > 0;
        return !hasMessages;
    }

    /**
     * Update display based on current chat state
     */
    updateDisplay() {
        if (this.shouldShow()) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Listen for chat state changes
        document.addEventListener('chatStateChanged', () => {
            this.updateDisplay();
        });

        // Listen for new messages
        document.addEventListener('messageAdded', () => {
            this.updateDisplay();
        });

        // Listen for conversation cleared
        document.addEventListener('conversationCleared', () => {
            this.updateDisplay();
        });
    }

    /**
     * Get current visibility state
     */
    isWelcomeVisible() {
        return this.isVisible;
    }
}

// Export for use in other modules
export default WelcomeDisplay;