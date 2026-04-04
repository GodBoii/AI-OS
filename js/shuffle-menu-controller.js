// shuffle-menu-controller.js
// Manages the shuffle button dropdown menu for memory, tools, and tasks.

class ShuffleMenuController {
    constructor(chatConfig) {
        this.chatConfig = chatConfig;
        this.shuffleBtn = null;
        this.shuffleMenu = null;
        this.isOpen = false;
        this.activeItems = new Set();
        this.animationFrame = null;
        this.backendBaseUrl = 'https://api.pawsitivestrides.store';
        this.connectedIntegrationStatus = {};
        this.userModifiedProviders = new Set();
        this.integrationTools = [
            {
                provider: 'github',
                label: 'GitHub',
                iconClass: 'fa-brands fa-github',
                configKeys: ['enable_github']
            },
            {
                provider: 'google',
                label: 'Google',
                iconClass: 'fa-brands fa-google',
                configKeys: ['enable_google_email', 'enable_google_drive', 'enable_google_sheets']
            },
            {
                provider: 'vercel',
                label: 'Vercel',
                iconClass: 'fa-solid fa-cloud-arrow-up',
                configKeys: ['enable_vercel']
            },
            {
                provider: 'supabase',
                label: 'Supabase',
                iconClass: 'fa-solid fa-database',
                configKeys: ['enable_supabase']
            },
            {
                provider: 'composio_whatsapp',
                label: 'WhatsApp',
                iconClass: 'fa-brands fa-whatsapp',
                configKeys: ['enable_composio_whatsapp']
            }
        ];
    }

    initialize() {
        try {
            this.shuffleBtn = document.querySelector('[data-tool="shuffle"]');
            this.shuffleMenu = this.shuffleBtn?.querySelector('.shuffle-menu');

            if (!this.shuffleBtn || !this.shuffleMenu) {
                console.warn('Shuffle menu elements not found');
                return;
            }

            this.ensureToolConfigShape();
            this.bindEvents();
            this.initializeToolsState();
            this.setupIntegrationSync();
            this.refreshConnectedIntegrations();
            console.log('ShuffleMenuController initialized successfully');
        } catch (error) {
            console.error('Error initializing ShuffleMenuController:', error);
        }
    }

    ensureToolConfigShape() {
        if (!this.chatConfig.tools || typeof this.chatConfig.tools !== 'object') {
            this.chatConfig.tools = {};
        }

        this.integrationTools.forEach(({ configKeys }) => {
            configKeys.forEach((key) => {
                if (typeof this.chatConfig.tools[key] !== 'boolean') {
                    this.chatConfig.tools[key] = false;
                }
            });
        });
    }

    initializeToolsState() {
        this.renderToolsSubmenu();
        this.updateToolsActiveState();

        if (this.chatConfig.memory) {
            this.updateItemActiveState('memory', true);
        }
    }

    setupIntegrationSync() {
        window.addEventListener('aios-integrations-updated', (event) => {
            const status = event?.detail?.statusByProvider;
            if (!status || typeof status !== 'object') {
                return;
            }
            this.applyConnectedIntegrationStatus(status, { fromUserToggle: false });
        });

        const auth = window.electron?.auth;
        if (auth?.onAuthChange) {
            auth.onAuthChange(() => {
                this.refreshConnectedIntegrations();
            });
        }
    }

    async refreshConnectedIntegrations() {
        try {
            const statusByProvider = await this.fetchConnectedIntegrationStatus();
            this.applyConnectedIntegrationStatus(statusByProvider, { fromUserToggle: false });
        } catch (error) {
            console.warn('Failed to refresh integration status for shuffle menu:', error);
            this.applyConnectedIntegrationStatus({}, { fromUserToggle: false });
        }
    }

    async fetchConnectedIntegrationStatus() {
        const auth = window.electron?.auth;
        if (!auth?.getSession) {
            return {};
        }

        const session = await auth.getSession();
        const accessToken = session?.access_token;
        if (!accessToken) {
            return {};
        }

        const headers = { Authorization: `Bearer ${accessToken}` };
        const status = this.integrationTools.reduce((acc, tool) => {
            acc[tool.provider] = false;
            return acc;
        }, {});

        const integrationsResponse = await fetch(`${this.backendBaseUrl}/api/integrations`, { headers });
        if (integrationsResponse.ok) {
            const data = await integrationsResponse.json();
            const connected = new Set(data.integrations || []);
            ['github', 'google', 'vercel', 'supabase'].forEach((provider) => {
                status[provider] = connected.has(provider);
            });
        }

        const whatsappResponse = await fetch(`${this.backendBaseUrl}/api/composio/status?toolkit=WHATSAPP`, { headers });

        if (whatsappResponse.ok) {
            const data = await whatsappResponse.json();
            status.composio_whatsapp = !!data.connected;
        }

        return status;
    }

    applyConnectedIntegrationStatus(statusByProvider, { fromUserToggle = false } = {}) {
        const normalized = this.integrationTools.reduce((acc, tool) => {
            acc[tool.provider] = !!statusByProvider?.[tool.provider];
            return acc;
        }, {});

        this.integrationTools.forEach(({ provider, configKeys }) => {
            const isConnected = normalized[provider];
            if (!isConnected) {
                configKeys.forEach((key) => {
                    this.chatConfig.tools[key] = false;
                });
                this.userModifiedProviders.delete(provider);
                return;
            }

            if (!fromUserToggle && !this.userModifiedProviders.has(provider)) {
                configKeys.forEach((key) => {
                    this.chatConfig.tools[key] = true;
                });
            }
        });

        this.connectedIntegrationStatus = normalized;
        this.renderToolsSubmenu();
        this.updateToolsActiveState();
    }

    bindEvents() {
        this.shuffleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });

        const shuffleItems = this.shuffleMenu.querySelectorAll('.shuffle-item');
        shuffleItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handleMenuItemClick(action);
            });
        });

        document.addEventListener('click', (e) => {
            if (!this.shuffleBtn.contains(e.target)) {
                this.closeMenu();
            }
        });

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
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        this.shuffleMenu.classList.add('visible');
        this.shuffleBtn.classList.add('active');
        this.shuffleBtn.setAttribute('aria-expanded', 'true');
        this.isOpen = true;

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

        if (action !== 'tools') {
            this.closeMenu();
        }
    }

    handleMemoryAction() {
        this.chatConfig.memory = !this.chatConfig.memory;
        this.updateItemActiveState('memory', this.chatConfig.memory);
    }

    handleToolsAction() {
        const toolsItem = this.shuffleMenu.querySelector('[data-action="tools"]');
        const toolsSubmenu = toolsItem?.querySelector('.tools-menu');

        if (toolsSubmenu) {
            this.shuffleMenu.querySelectorAll('.tools-menu.visible').forEach(menu => {
                if (menu !== toolsSubmenu) {
                    menu.classList.remove('visible');
                }
            });

            toolsSubmenu.classList.toggle('visible');
            this.setupToolsSubmenu(toolsSubmenu);
            this.refreshConnectedIntegrations();
        }
    }

    setupToolsSubmenu(toolsSubmenu) {
        if (!toolsSubmenu.hasAttribute('data-shuffle-setup')) {
            toolsSubmenu.setAttribute('data-shuffle-setup', 'true');
            toolsSubmenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            toolsSubmenu.addEventListener('change', (e) => {
                const target = e.target;
                if (!(target instanceof HTMLInputElement)) {
                    return;
                }
                if (target.dataset.role !== 'integration-tool-toggle') {
                    return;
                }

                const provider = target.dataset.provider;
                if (!provider) {
                    return;
                }

                this.userModifiedProviders.add(provider);
                this.setProviderEnabled(provider, target.checked);
                this.updateToolsActiveState();
                e.stopPropagation();
            });
        }
    }

    setProviderEnabled(provider, enabled) {
        const definition = this.integrationTools.find(tool => tool.provider === provider);
        if (!definition) {
            return;
        }
        definition.configKeys.forEach((key) => {
            this.chatConfig.tools[key] = enabled;
        });
    }

    isProviderEnabled(provider) {
        const definition = this.integrationTools.find(tool => tool.provider === provider);
        if (!definition) {
            return false;
        }
        return definition.configKeys.every((key) => this.chatConfig.tools[key] === true);
    }

    getConnectedTools() {
        return this.integrationTools.filter((tool) => this.connectedIntegrationStatus[tool.provider]);
    }

    renderToolsSubmenu() {
        const toolsItem = this.shuffleMenu?.querySelector('[data-action="tools"]');
        const toolsSubmenu = toolsItem?.querySelector('.tools-menu');
        if (!toolsSubmenu) {
            return;
        }

        const listEl = toolsSubmenu.querySelector('[data-role="integration-tools-list"]');
        const emptyEl = toolsSubmenu.querySelector('[data-role="integration-tools-empty"]');
        if (!listEl || !emptyEl) {
            return;
        }

        const connectedTools = this.getConnectedTools();
        listEl.innerHTML = connectedTools.map((tool) => {
            const checkboxId = `integration_tool_${tool.provider}`;
            const checked = this.isProviderEnabled(tool.provider) ? 'checked' : '';
            return `
                <div class="tool-item" role="menuitem">
                    <input
                        type="checkbox"
                        id="${checkboxId}"
                        data-role="integration-tool-toggle"
                        data-provider="${tool.provider}"
                        ${checked}
                    />
                    <label for="${checkboxId}">
                        <i class="${tool.iconClass}" aria-hidden="true"></i>
                        ${tool.label}
                    </label>
                </div>
            `;
        }).join('');

        emptyEl.classList.toggle('hidden', connectedTools.length > 0);
    }

    updateToolsActiveState() {
        const connectedTools = this.getConnectedTools();
        const hasActiveTools = connectedTools.some((tool) => this.isProviderEnabled(tool.provider));
        this.updateItemActiveState('tools', hasActiveTools);
    }

    handleTasksAction() {
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

        this.updateShuffleButtonState();
    }

    updateShuffleButtonState() {
        const hasActiveItems = this.activeItems.size > 0;
        this.shuffleBtn.classList.toggle('has-active', hasActiveItems);
    }

    handleKeyNavigation(e) {
        const items = Array.from(this.shuffleMenu.querySelectorAll('.shuffle-item'));
        const currentIndex = items.findIndex(item => item === document.activeElement);

        switch (e.key) {
            case 'ArrowDown': {
                e.preventDefault();
                const nextIndex = (currentIndex + 1) % items.length;
                items[nextIndex].focus();
                break;
            }
            case 'ArrowUp': {
                e.preventDefault();
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                items[prevIndex].focus();
                break;
            }
            case 'Enter':
            case ' ': {
                e.preventDefault();
                if (currentIndex >= 0) {
                    items[currentIndex].click();
                }
                break;
            }
            case 'Escape':
                e.preventDefault();
                this.closeMenu();
                this.shuffleBtn.focus();
                break;
            default:
                break;
        }
    }

    resetForNewConversation() {
        this.userModifiedProviders.clear();
        this.applyConnectedIntegrationStatus(this.connectedIntegrationStatus, { fromUserToggle: false });
        this.updateToolsActiveState();
    }
}

export default ShuffleMenuController;
