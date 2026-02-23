// shuffle-menu-controller.js
// Manages the shuffle button dropdown menu that contains memory, tools, and tasks functionality

/**
 * ShuffleMenuController - Manages the shuffle button dropdown menu
 * that contains memory, tools, and tasks functionality
 */
class ShuffleMenuController {
    constructor(chatConfig) {
        this.chatConfig = chatConfig;
        this.shuffleBtn = null;
        this.shuffleMenu = null;
        this.isOpen = false;
        this.activeItems = new Set();
        this.animationFrame = null;
    }

    initialize() {
        try {
            this.shuffleBtn = document.querySelector('[data-tool="shuffle"]');
            this.shuffleMenu = this.shuffleBtn?.querySelector('.shuffle-menu');

            if (!this.shuffleBtn || !this.shuffleMenu) {
                console.warn('Shuffle menu elements not found');
                return;
            }

            this.bindEvents();
            this.initializeToolsState();
            console.log('ShuffleMenuController initialized successfully');
        } catch (error) {
            console.error('Error initializing ShuffleMenuController:', error);
        }
    }

    initializeToolsState() {
        // Initialize checkbox states
        const aiOsCheckbox = document.getElementById('ai_os');
        const deepSearchCheckbox = document.getElementById('deep_search');

        if (aiOsCheckbox) {
            const allToolsEnabledInitially = Object.values(this.chatConfig.tools).every(val => val === true);
            aiOsCheckbox.checked = allToolsEnabledInitially;
        }

        if (deepSearchCheckbox) {
            deepSearchCheckbox.checked = this.chatConfig.deepsearch;
        }

        // Update initial active states
        this.updateToolsActiveState();

        // Sync memory initial state
        if (this.chatConfig.memory) {
            this.updateItemActiveState('memory', true);
        }
    }

    bindEvents() {
        // Toggle menu on shuffle button click
        this.shuffleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });

        // Handle menu item clicks
        const shuffleItems = this.shuffleMenu.querySelectorAll('.shuffle-item');
        shuffleItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handleMenuItemClick(action);
            });
        });

        // Close menu on outside click
        document.addEventListener('click', (e) => {
            if (!this.shuffleBtn.contains(e.target)) {
                this.closeMenu();
            }
        });

        // Handle keyboard navigation
        this.shuffleMenu.addEventListener('keydown', (e) => {
            this.handleKeyNavigation(e);
        });
    }

    toggleMenu() {
        if (this.isOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    openMenu() {
        // Cancel any pending animation frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        this.shuffleMenu.classList.add('visible');
        this.shuffleBtn.classList.add('active');
        this.shuffleBtn.setAttribute('aria-expanded', 'true');
        this.isOpen = true;

        // Set focus to first menu item for keyboard navigation using RAF for smooth transition
        this.animationFrame = requestAnimationFrame(() => {
            const firstItem = this.shuffleMenu.querySelector('.shuffle-item');
            if (firstItem) {
                firstItem.focus();
            }
        });
    }

    closeMenu() {
        this.shuffleMenu.classList.remove('visible');
        this.shuffleBtn.classList.remove('active');
        this.shuffleBtn.setAttribute('aria-expanded', 'false');
        this.isOpen = false;

        // Close any open submenus
        this.shuffleMenu.querySelectorAll('.tools-menu.visible').forEach(menu => {
            menu.classList.remove('visible');
        });
    }

    handleMenuItemClick(action) {
        switch (action) {
            case 'memory':
                this.handleMemoryAction();
                break;
            case 'tools':
                this.handleToolsAction();
                break;
            case 'tasks':
                this.handleTasksAction();
                break;
            default:
                console.warn('Unknown shuffle menu action:', action);
        }

        // Close menu after action (except for tools which has submenu)
        if (action !== 'tools') {
            this.closeMenu();
        }
    }

    handleMemoryAction() {
        // Delegate to existing memory toggle functionality
        this.chatConfig.memory = !this.chatConfig.memory;
        this.updateItemActiveState('memory', this.chatConfig.memory);
    }

    handleToolsAction() {
        // For tools, we need to show the tools submenu
        const toolsItem = this.shuffleMenu.querySelector('[data-action="tools"]');
        const toolsSubmenu = toolsItem.querySelector('.tools-menu');

        if (toolsSubmenu) {
            // Close any other open submenus first
            this.shuffleMenu.querySelectorAll('.tools-menu.visible').forEach(menu => {
                if (menu !== toolsSubmenu) {
                    menu.classList.remove('visible');
                }
            });

            toolsSubmenu.classList.toggle('visible');

            // Set up tools submenu event handlers if not already done
            this.setupToolsSubmenu(toolsSubmenu);
        }
    }

    setupToolsSubmenu(toolsSubmenu) {
        // Prevent submenu from closing shuffle menu when clicked
        if (!toolsSubmenu.hasAttribute('data-shuffle-setup')) {
            toolsSubmenu.setAttribute('data-shuffle-setup', 'true');
            toolsSubmenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // Handle checkbox changes in tools submenu
        const aiOsCheckbox = toolsSubmenu.querySelector('#ai_os');
        const deepSearchCheckbox = toolsSubmenu.querySelector('#deep_search');

        if (aiOsCheckbox && !aiOsCheckbox.hasAttribute('data-shuffle-handler')) {
            aiOsCheckbox.setAttribute('data-shuffle-handler', 'true');
            aiOsCheckbox.addEventListener('change', (e) => {
                const enableAll = e.target.checked;
                for (const key in this.chatConfig.tools) {
                    this.chatConfig.tools[key] = enableAll;
                }
                if (enableAll && deepSearchCheckbox) {
                    deepSearchCheckbox.checked = false;
                    this.chatConfig.deepsearch = false;
                }
                this.updateToolsActiveState();
                e.stopPropagation();
            });
        }

        if (deepSearchCheckbox && !deepSearchCheckbox.hasAttribute('data-shuffle-handler')) {
            deepSearchCheckbox.setAttribute('data-shuffle-handler', 'true');
            deepSearchCheckbox.addEventListener('change', (e) => {
                this.chatConfig.deepsearch = e.target.checked;
                if (e.target.checked && aiOsCheckbox) {
                    aiOsCheckbox.checked = false;
                    for (const key in this.chatConfig.tools) {
                        this.chatConfig.tools[key] = false;
                    }
                }
                this.updateToolsActiveState();
                e.stopPropagation();
            });
        }
    }

    updateToolsActiveState() {
        const aiOsCheckbox = document.getElementById('ai_os');
        const deepSearchCheckbox = document.getElementById('deep_search');
        const hasActiveTools = (aiOsCheckbox?.checked) || (deepSearchCheckbox?.checked);

        this.updateItemActiveState('tools', hasActiveTools);
    }

    handleTasksAction() {
        // Delegate to existing tasks toggle functionality
        this.chatConfig.tasks = !this.chatConfig.tasks;
        this.updateItemActiveState('tasks', this.chatConfig.tasks);
    }

    updateItemActiveState(action, isActive) {
        const item = this.shuffleMenu.querySelector(`[data-action="${action}"]`);
        if (item) {
            item.classList.toggle('active', isActive);
        }

        if (isActive) {
            this.activeItems.add(action);
        } else {
            this.activeItems.delete(action);
        }

        // Update shuffle button active state based on any active items
        this.updateShuffleButtonState();
    }

    updateShuffleButtonState() {
        const hasActiveItems = this.activeItems.size > 0;
        this.shuffleBtn.classList.toggle('has-active', hasActiveItems);
    }

    handleKeyNavigation(e) {
        // Basic keyboard navigation support
        const items = Array.from(this.shuffleMenu.querySelectorAll('.shuffle-item'));
        const currentIndex = items.findIndex(item => item === document.activeElement);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                const nextIndex = (currentIndex + 1) % items.length;
                items[nextIndex].focus();
                break;
            case 'ArrowUp':
                e.preventDefault();
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                items[prevIndex].focus();
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (currentIndex >= 0) {
                    items[currentIndex].click();
                }
                break;
            case 'Escape':
                e.preventDefault();
                this.closeMenu();
                this.shuffleBtn.focus();
                break;
        }
    }
}

export default ShuffleMenuController;
