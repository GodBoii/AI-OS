import UserProfileService from './user-profile-service.js';

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
        this.userProfileService = new UserProfileService();
        this.hiddenByFloatingWindow = false;
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

        // Create main heading
        const heading = document.createElement('h1');
        heading.className = 'welcome-heading';
        heading.id = 'welcome-heading';

        // Create secondary heading (replaces subtitle)
        const secondaryHeading = document.createElement('h2');
        secondaryHeading.className = 'welcome-secondary-heading';
        secondaryHeading.id = 'welcome-secondary-heading';
        secondaryHeading.textContent = 'What can I do for you?';

        // Assemble structure (no subtitle)
        welcomeContent.appendChild(heading);
        welcomeContent.appendChild(secondaryHeading);
        this.welcomeElement.appendChild(welcomeContent);

        // Insert into DOM
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.appendChild(this.welcomeElement);
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
     */
    updateUsername(username) {
        this.username = username;
        const heading = this.welcomeElement?.querySelector('.welcome-heading');
        if (heading) {
            // Username is already formatted by UserProfileService
            heading.textContent = `Hello ${username}`;
        }
    }

    /**
     * Show the welcome message with animation
     */
    show() {
        try {
            if (!this.welcomeElement || this.isVisible) return;

            this.welcomeElement.classList.remove('hidden');
            this.welcomeElement.classList.add('visible');
            this.isVisible = true;

            // Announce to screen readers
            this.welcomeElement.setAttribute('aria-live', 'polite');

            console.log('Welcome message displayed');
        } catch (error) {
            console.error('WelcomeDisplay: Error showing welcome message:', error);
            // Try to recreate the element if it's missing
            if (!this.welcomeElement) {
                try {
                    this.createWelcomeElement();
                    this.fetchUsername();
                } catch (recreateError) {
                    console.error('WelcomeDisplay: Failed to recreate welcome element:', recreateError);
                }
            }
        }
    }

    /**
     * Hide the welcome message with animation
     */
    hide() {
        try {
            if (!this.welcomeElement || !this.isVisible) return;

            this.welcomeElement.classList.remove('visible');
            this.welcomeElement.classList.add('hidden');
            this.isVisible = false;

            console.log('Welcome message hidden');
        } catch (error) {
            console.error('WelcomeDisplay: Error hiding welcome message:', error);
            // Force hide using inline styles as fallback
            if (this.welcomeElement) {
                try {
                    this.welcomeElement.style.display = 'none';
                    this.isVisible = false;
                } catch (fallbackError) {
                    console.error('WelcomeDisplay: Fallback hide failed:', fallbackError);
                }
            }
        }
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
        try {
            if (this.shouldShow()) {
                this.show();
            } else {
                this.hide();
            }
        } catch (error) {
            console.error('WelcomeDisplay: Error updating display:', error);
            // Fallback: try to hide welcome message to avoid UI conflicts
            try {
                this.hide();
            } catch (fallbackError) {
                console.error('WelcomeDisplay: Fallback hide also failed:', fallbackError);
            }
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
     * Hide welcome message when floating windows open
     */
    hideForFloatingWindow() {
        if (!this.welcomeElement) return;

        this.hiddenByFloatingWindow = true;
        this.hide();
        console.log('Welcome message hidden for floating window');
    }

    /**
     * Show welcome message when floating windows close (if no messages exist)
     */
    showAfterFloatingWindow() {
        if (!this.welcomeElement) return;

        this.hiddenByFloatingWindow = false;
        
        // Only show if we should show (no messages exist)
        if (this.shouldShow()) {
            this.show();
            console.log('Welcome message shown after floating window closed');
        }
    }

    /**
     * Check if welcome message is hidden by floating window
     */
    isHiddenByFloatingWindow() {
        return this.hiddenByFloatingWindow;
    }

    /**
     * Get current visibility state
     */
    isWelcomeVisible() {
        return this.isVisible;
    }

    /**
     * Refresh username from profile service (useful when profile changes)
     */
    async refreshUsername() {
        // Clear cache and fetch fresh username
        this.userProfileService.clearCache();
        await this.fetchUsername();
    }
}

// Export for use in other modules
export default WelcomeDisplay;