// aios.js (Complete, Updated Version with UI/UX Enhancements)

class AIOS {
    constructor() {
        this.initialized = false;
        this.currentTab = 'account'; // Default tab is now 'account'
        this.elements = {};
        this.userDataPath = null;
        this.userData = null;
        this.authService = null;
        this.backendBaseUrl = 'http://localhost:8765';
        this.deploymentsCache = [];
        this.databasesCache = [];
        this.memoriesCache = [];
        this.editingMemoryId = null;
        this.selectedDatabaseProject = 'all';
        this.usageView = null;
        this.subscriptionSummary = null;
        this.activeCheckoutPlan = null;
        this.pricingModalContext = null;
    }

    async init() {
        if (this.initialized) return;

        await this._initializePaths();

        try {
            this.authService = window.electron.auth;
            await this.authService.init();
        } catch (error) {
            console.error('Failed to initialize auth service:', error);
        }

        this.userData = await this.loadUserData();

        this.cacheElements();
        this.initializeUsageUI();
        this.setupEventListeners();
        this.loadSavedData();
        this.updateAuthUI(); // Initial UI state update
        this.initialized = true;
    }

    async _initializePaths() {
        try {
            const userDataPath = await window.electron.ipcRenderer.invoke('get-path', 'userData');
            this.userDataPath = window.electron.path.join(userDataPath, 'userData');

            if (!window.electron.fs.existsSync(this.userDataPath)) {
                window.electron.fs.mkdirSync(this.userDataPath, { recursive: true });
            }
        } catch (error) {
            console.error('Failed to initialize paths:', error);
            this.userDataPath = window.electron.path.join('userData');
            if (!window.electron.fs.existsSync(this.userDataPath)) {
                window.electron.fs.mkdirSync(this.userDataPath, { recursive: true });
            }
        }
    }

    cacheElements() {
        this.elements = {
            // Main Window & Controls
            settingsAvatarContainer: document.getElementById('aios-settings-avatar-container'),
            window: document.getElementById('floating-window'),
            closeBtn: document.getElementById('close-aios'),
            tabs: document.querySelectorAll('.tab-btn'),
            tabContents: document.querySelectorAll('.tab-content'),

            // Support Form
            supportForm: document.getElementById('support-form'),
            subject: document.getElementById('subject'),
            description: document.getElementById('description'),
            screenshot: document.getElementById('screenshot'),

            // Account Sections
            accountLoggedOut: document.getElementById('account-logged-out'),
            accountLoggedIn: document.getElementById('account-logged-in'),

            // New User Identity Card Elements
            accountAvatar: document.getElementById('account-avatar'),
            accountUserName: document.getElementById('account-userName'),
            accountUserEmail: document.getElementById('account-userEmail'),
            logoutBtn: document.getElementById('logout-btn'),
            refreshUsageBtn: document.getElementById('refresh-usage-btn'),
            usageInputTokens: document.getElementById('usage-input-tokens'),
            usageOutputTokens: document.getElementById('usage-output-tokens'),
            usageTotalTokens: document.getElementById('usage-total-tokens'),
            usageError: document.getElementById('usage-error'),
            usagePeriodLabel: document.getElementById('usage-period-label'),
            manageSubscriptionBtn: document.getElementById('manage-subscription-btn'),
            subscriptionSubtitle: document.getElementById('subscription-subtitle'),
            currentPlanName: document.getElementById('current-plan-name'),
            subscriptionStatusBadge: document.getElementById('subscription-status-badge'),
            currentPlanLimit: document.getElementById('current-plan-limit'),
            currentPlanRemaining: document.getElementById('current-plan-remaining'),
            currentPlanRenewal: document.getElementById('current-plan-renewal'),
            subscriptionUsageBar: document.getElementById('subscription-usage-bar'),
            subscriptionProgressCopy: document.getElementById('subscription-progress-copy'),
            pricingModal: document.getElementById('pricing-modal'),
            pricingModalBackdrop: document.getElementById('pricing-modal-backdrop'),
            pricingModalClose: document.getElementById('pricing-modal-close'),
            pricingModalMessage: document.getElementById('pricing-modal-message'),
            pricingModalFootnote: document.getElementById('pricing-modal-footnote'),
            planBtnFree: document.getElementById('plan-btn-free'),
            planBtnPro: document.getElementById('plan-btn-pro'),
            planBtnElite: document.getElementById('plan-btn-elite'),
            pricingPlanButtons: document.querySelectorAll('.pricing-plan-btn[data-plan-type]'),
            pricingPlanCards: document.querySelectorAll('.pricing-plan-card[data-plan-card]'),

            // Auth Forms
            authTabs: document.querySelectorAll('.auth-tab-btn'),
            loginForm: document.getElementById('login-form'),
            signupForm: document.getElementById('signup-form'),
            loginEmail: document.getElementById('loginEmail'),
            loginPassword: document.getElementById('loginPassword'),
            signupName: document.getElementById('signupName'),
            signupEmail: document.getElementById('signupEmail'),
            signupPassword: document.getElementById('signupPassword'),
            confirmPassword: document.getElementById('confirmPassword'),
            loginError: document.getElementById('login-error'),
            signupError: document.getElementById('signup-error'),
            googleSignInBtn: document.getElementById('google-signin-btn'),

            // Integration Buttons
            connectGithubBtn: document.getElementById('connect-github-btn'),
            connectGoogleBtn: document.getElementById('connect-google-btn'),
            connectVercelBtn: document.getElementById('connect-vercel-btn'),
            connectSupabaseBtn: document.getElementById('connect-supabase-btn'),
            connectGoogleSheetsBtn: document.getElementById('connect-google-sheets-btn'),
            connectWhatsappBtn: document.getElementById('connect-whatsapp-btn'),

            // Deployments Tab
            refreshDeploymentsBtn: document.getElementById('refresh-deployments-btn'),
            deploymentsList: document.getElementById('deployments-list'),
            deploymentsEmpty: document.getElementById('deployments-empty'),

            // Database Tab
            refreshDatabasesBtn: document.getElementById('refresh-databases-btn'),
            databasesList: document.getElementById('databases-list'),
            databasesEmpty: document.getElementById('databases-empty'),
            databaseProjectFilter: document.getElementById('database-project-filter'),

            // Memory Tab
            refreshMemoriesBtn: document.getElementById('refresh-memories-btn'),
            memoriesList: document.getElementById('memories-list'),
            memoriesEmpty: document.getElementById('memories-empty'),
            memoryForm: document.getElementById('memory-form'),
            memoryContent: document.getElementById('memory-content'),
            memoryInput: document.getElementById('memory-input'),
            memoryAgentId: document.getElementById('memory-agent-id'),
            memoryTeamId: document.getElementById('memory-team-id'),
            memoryTopics: document.getElementById('memory-topics'),
            memoryEntryTitle: document.getElementById('memory-entry-title'),
            memorySubmitBtn: document.getElementById('memory-submit-btn'),
            memoryCancelEditBtn: document.getElementById('memory-cancel-edit-btn'),
        };
        
        // Setup deployment detail modal
        this.setupDeploymentDetailModal();
    }

    initializeUsageUI() {
        if (typeof window.AIOSUsage !== 'function') {
            this.usageView = null;
            return;
        }

        this.usageView = new window.AIOSUsage({
            usageInputTokens: this.elements.usageInputTokens,
            usageOutputTokens: this.elements.usageOutputTokens,
            usageTotalTokens: this.elements.usageTotalTokens,
            usageError: this.elements.usageError,
        });
        this.usageView.setEmpty();
    }
    
    setupDeploymentDetailModal() {
        if (document.getElementById('deployment-detail-modal')) {
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'deployment-detail-modal';
        modal.className = 'deployment-detail-modal hidden';
        modal.innerHTML = `
            <div class="deployment-detail-dialog">
                <div class="deployment-detail-header">
                    <div class="deployment-detail-header-left">
                        <div class="deployment-detail-icon">
                            <i class="fas fa-rocket"></i>
                        </div>
                        <div class="deployment-detail-title-group">
                            <div class="deployment-detail-title" id="deployment-detail-title">Deployment Details</div>
                            <div class="deployment-detail-subtitle" id="deployment-detail-subtitle">View files and preview</div>
                        </div>
                    </div>
                    <button type="button" class="deployment-detail-close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="deployment-detail-content">
                    <div class="deployment-detail-left">
                        <div class="deployment-detail-section">
                            <div class="deployment-info-grid" id="deployment-info-grid"></div>
                        </div>
                        <div class="deployment-file-tree-card" id="deployment-file-tree">
                            <div class="deployment-file-tree-header">
                                <i class="fas fa-folder-tree"></i>
                                <span>File Structure</span>
                            </div>
                            <ul class="deployment-file-tree-list" id="deployment-file-tree-list"></ul>
                        </div>
                    </div>
                    <div class="deployment-detail-right">
                        <div class="deployment-preview-card">
                            <div class="deployment-preview-header">
                                <div class="deployment-preview-url-container">
                                    <i class="fas fa-link"></i>
                                    <div class="deployment-preview-url" id="deployment-preview-url">Loading...</div>
                                </div>
                                <div class="deployment-preview-actions">
                                    <button class="deployment-preview-btn" id="deployment-preview-refresh" title="Refresh">
                                        <i class="fas fa-sync-alt"></i>
                                    </button>
                                    <button class="deployment-preview-btn" id="deployment-preview-open" title="Open in Browser">
                                        <i class="fas fa-external-link-alt"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="deployment-preview-container">
                                <iframe class="deployment-preview-frame" id="deployment-preview-frame"></iframe>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Setup event listeners
        modal.querySelector('.deployment-detail-close').addEventListener('click', () => {
            this.hideDeploymentDetail();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hideDeploymentDetail();
            }
        });

        document.getElementById('deployment-preview-refresh').addEventListener('click', () => {
            const iframe = document.getElementById('deployment-preview-frame');
            iframe.src = iframe.src;
        });

        document.getElementById('deployment-preview-open').addEventListener('click', () => {
            const url = document.getElementById('deployment-preview-url').textContent;
            if (url && url !== 'Loading...' && window.electron?.shell?.openExternal) {
                window.electron.shell.openExternal(url);
            }
        });
    }

    setupEventListeners() {
        const addClickHandler = (element, handler) => {
            element?.addEventListener('click', handler);
        };

        window.electron.ipcRenderer.on('auth-state-changed', async (data) => {
            console.log('[aios.js] Received "auth-state-changed" event from main process.');
            try {
                const url = new URL(data.url);
                const hash = new URLSearchParams(url.hash.substring(1));
                const accessToken = hash.get('access_token');
                const refreshToken = hash.get('refresh_token');
                if (accessToken && refreshToken) {
                    await this.authService.setSession(accessToken, refreshToken);
                }
            } catch (e) {
                console.error('[aios.js] Error parsing URL from deep link:', e);
            }
        });

        // Listen for OAuth integration callback from main process
        window.electron.ipcRenderer.on('oauth-integration-callback', async (data) => {
            console.log('[aios.js] Received OAuth integration callback:', data);

            if (data.success) {
                this.showNotification(`Successfully connected to ${data.provider}!`, 'success');
                // Refresh integration status
                await this.checkIntegrationStatus();
            } else {
                this.showNotification(
                    `Failed to connect: ${data.error || 'Unknown error'}`,
                    'error'
                );
            }
        });

        addClickHandler(this.elements.closeBtn, () => this.hideWindow());

        this.elements.tabs?.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Handle external links in About section
        document.querySelectorAll('.external-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const url = link.href;
                if (url && window.electron?.shell) {
                    window.electron.shell.openExternal(url);
                } else {
                    console.error('Cannot open external link: Electron shell not available');
                }
            });
        });

        this.elements.supportForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSupportSubmit();
        });

        addClickHandler(this.elements.logoutBtn, () => this.handleLogout());

        this.elements.screenshot?.addEventListener('change', (e) => this.handleFileUpload(e));

        this.elements.authTabs?.forEach(tab => {
            tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.authTab));
        });

        this.elements.loginForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        this.elements.signupForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSignup();
        });

        addClickHandler(this.elements.googleSignInBtn, () => this.handleGoogleSignIn());

        const integrationButtonHandler = (e) => {
            const button = e.currentTarget;
            const action = button.dataset.action;
            const provider = button.dataset.provider;
            if (action === 'connect') this.startAuthFlow(provider);
            else if (action === 'disconnect') this.disconnectIntegration(provider);
        };

        addClickHandler(this.elements.connectGithubBtn, integrationButtonHandler);
        addClickHandler(this.elements.connectGoogleBtn, integrationButtonHandler);
        addClickHandler(this.elements.connectVercelBtn, integrationButtonHandler);
        addClickHandler(this.elements.connectSupabaseBtn, integrationButtonHandler);
        addClickHandler(this.elements.connectGoogleSheetsBtn, integrationButtonHandler);
        addClickHandler(this.elements.connectWhatsappBtn, integrationButtonHandler);
        addClickHandler(this.elements.refreshDeploymentsBtn, () => this.loadDeployments(true));
        addClickHandler(this.elements.refreshDatabasesBtn, () => this.loadDatabases(true));
        addClickHandler(this.elements.refreshMemoriesBtn, () => this.loadMemories(true));
        addClickHandler(this.elements.refreshUsageBtn, () => this.loadUsage(true));
        addClickHandler(this.elements.manageSubscriptionBtn, () => this.openPricingModal());
        addClickHandler(this.elements.pricingModalClose, () => this.closePricingModal());
        addClickHandler(this.elements.pricingModalBackdrop, () => this.closePricingModal());
        this.elements.pricingPlanButtons?.forEach((button) => {
            button.addEventListener('click', () => this.startSubscriptionCheckout(button.dataset.planType));
        });
        this.elements.memoryForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddMemory();
        });
        addClickHandler(this.elements.memoryCancelEditBtn, () => this.resetMemoryForm());
        this.elements.databaseProjectFilter?.addEventListener('change', (e) => {
            this.selectedDatabaseProject = e.target.value || 'all';
            this.renderDatabases(this.databasesCache);
        });
        window.addEventListener('subscription-limit-reached', (event) => {
            const detail = event?.detail || {};
            this.openPricingModal({
                message: detail.message || 'Your current plan limit has been reached.',
                footnote: 'Upgrade to continue immediately, or wait for the next reset window.',
                summary: detail.limitInfo || detail.summary || null,
            });
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.elements.pricingModal && !this.elements.pricingModal.classList.contains('hidden')) {
                this.closePricingModal();
            }
        });

        if (this.authService) {
            this.authService.onAuthChange((user) => {
                console.log('Auth change detected:', user);
                this.updateAuthUI();
                this.updateUserUI(user); // Centralized UI update call

                if (user) {
                    this.userData.account.email = user.email;
                    if (user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) {
                        this.userData.account.name = user.user_metadata.name || user.user_metadata.full_name;
                    }
                    this.saveUserData();
                    this.loadDeployments();
                    this.loadDatabases();
                    this.loadMemories();
                    this.loadUsage();
                } else {
                    this.deploymentsCache = [];
                    this.databasesCache = [];
                    this.memoriesCache = [];
                    this.renderDeployments([]);
                    this.populateDatabaseProjectFilter([]);
                    this.renderDatabases([]);
                    this.renderMemories([]);
                    this.usageView?.setEmpty();
                    this.usageView?.setError('');
                    this.resetSubscriptionUI();
                    this.closePricingModal();
                }
            });
        }
    }

    async handleGoogleSignIn() {
        if (!this.authService) {
            this.showNotification('Authentication service not available', 'error');
            return;
        }
        this.elements.loginError.textContent = '';
        try {
            const result = await this.authService.signInWithGoogle();
            if (result.success && result.url) {
                await window.electron.shell.openExternal(result.url);
            } else {
                this.elements.loginError.textContent = result.error || 'Could not start Google Sign-In';
            }
        } catch (error) {
            console.error('Google Sign-In error:', error);
            this.elements.loginError.textContent = 'An unexpected error occurred during Google Sign-In';
        }
    }

    /**
     * Centralized function to update all user-related UI elements.
     * Handles the sidebar icon and the new user identity card.
     * @param {object|null} user - The user object from the auth service, or null if logged out.
     */
    updateUserUI(user) {
        const containers = [this.elements.settingsAvatarContainer, this.elements.accountAvatar];

        // Reset all containers
        containers.forEach(container => {
            if (container) container.innerHTML = '';
        });

        if (this.elements.accountUserName) this.elements.accountUserName.textContent = '';
        if (this.elements.accountUserEmail) this.elements.accountUserEmail.textContent = '';
        if (this.elements.accountUserName) this.elements.accountUserName.style.display = 'none';
        if (this.elements.accountUserEmail) this.elements.accountUserEmail.style.display = 'none';

        // Handle logged-out state
        if (!user) {
            const icon = document.createElement('i');
            icon.className = 'fas fa-user-cog';
            if (this.elements.settingsAvatarContainer) {
                this.elements.settingsAvatarContainer.appendChild(icon);
            }
            // The identity card will be hidden by updateAuthUI, so no need to add an icon there.
            return;
        }

        // Handle logged-in state
        const avatarUrl = user.user_metadata?.picture;
        const name = user.user_metadata?.name || user.user_metadata?.full_name;
        const email = user.email || '';

        // 1. Update Avatars
        containers.forEach(container => {
            if (!container) return;
            if (avatarUrl) {
                const img = document.createElement('img');
                img.src = avatarUrl;
                img.alt = 'User Avatar';
                img.className = 'user-avatar';
                container.appendChild(img);
            } else {
                const initialsDiv = document.createElement('div');
                initialsDiv.className = 'user-initials-avatar';
                let initials = 'U';
                if (name && name.includes(' ')) {
                    const parts = name.split(' ');
                    initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                } else if (name) {
                    initials = name[0].toUpperCase();
                } else if (email) {
                    initials = email[0].toUpperCase();
                }
                initialsDiv.textContent = initials;
                container.appendChild(initialsDiv);
            }
        });

        // 2. Update Name/Email in Identity Card
        if (name) {
            if (this.elements.accountUserName) {
                this.elements.accountUserName.textContent = name;
                this.elements.accountUserName.style.display = 'block';
            }
            if (this.elements.accountUserEmail) {
                this.elements.accountUserEmail.textContent = email;
                this.elements.accountUserEmail.style.display = 'block'; // Also show email below name
            }
        } else {
            if (this.elements.accountUserEmail) {
                this.elements.accountUserEmail.textContent = email;
                this.elements.accountUserEmail.style.display = 'block';
            }
        }
    }

    async startAuthFlow(provider) {
        try {
            if (!this.authService) {
                this.showNotification('Authentication service not available.', 'error');
                return;
            }
            const session = await this.authService.getSession();
            if (!session || !session.access_token) {
                this.showNotification('You must be logged in to connect an integration.', 'error');
                return;
            }
            let authUrl;
            if (provider === 'vercel') {
                authUrl = `https://vercel.com/integrations/aetheria-ai/new`;
            } else if (provider === 'composio_google_sheets') {
                const callbackUrl = 'aios://auth/callback?provider=composio_google_sheets';
                const encodedCallbackUrl = encodeURIComponent(callbackUrl);
                const response = await fetch(`${this.backendBaseUrl}/api/composio/connect-url?toolkit=GOOGLESHEETS&callback_url=${encodedCallbackUrl}`, {
                    headers: { 'Authorization': `Bearer ${session.access_token}` }
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error || 'Failed to generate Composio connect URL');
                }
                const redirectUrl = payload.redirect_url;
                if (!redirectUrl) {
                    throw new Error('Composio did not return a redirect URL.');
                }
                await window.electron.shell.openExternal(redirectUrl);
                this.showNotification('Opened Google Sheets connection flow. Complete auth in browser.', 'success');
                setTimeout(() => this.checkIntegrationStatus(), 2500);
                return;
            } else if (provider === 'composio_whatsapp') {
                const callbackUrl = 'aios://auth/callback?provider=composio_whatsapp';
                const encodedCallbackUrl = encodeURIComponent(callbackUrl);
                const response = await fetch(`${this.backendBaseUrl}/api/composio/connect-url?toolkit=WHATSAPP&callback_url=${encodedCallbackUrl}`, {
                    headers: { 'Authorization': `Bearer ${session.access_token}` }
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error || 'Failed to generate Composio WhatsApp connect URL');
                }
                const redirectUrl = payload.redirect_url;
                if (!redirectUrl) {
                    throw new Error('Composio did not return a redirect URL.');
                }
                await window.electron.shell.openExternal(redirectUrl);
                this.showNotification('Opened WhatsApp connection flow. Complete auth in browser.', 'success');
                setTimeout(() => this.checkIntegrationStatus(), 2500);
                return;
            } else {
                // Add client=electron parameter to identify Electron client
                authUrl = `${this.backendBaseUrl}/login/${provider}?token=${session.access_token}&client=electron`;
            }
            console.log(`Opening auth URL for ${provider}: ${authUrl}`);
            window.electron.ipcRenderer.send('open-webview', authUrl);
        } catch (error) {
            console.error(`Error starting auth flow for ${provider}:`, error);
            this.showNotification(error.message || 'Failed to start integration flow', 'error');
        }
    }

    async disconnectIntegration(provider) {
        if (!confirm(`Are you sure you want to disconnect your ${provider} account?`)) return;

        const session = await this.authService.getSession();
        if (!session || !session.access_token) {
            this.showNotification('Authentication error. Please log in again.', 'error');
            return;
        }
        try {
            let response;
            if (provider === 'composio_google_sheets') {
                response = await fetch(`${this.backendBaseUrl}/api/composio/disconnect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                    body: JSON.stringify({ toolkit: 'GOOGLESHEETS' })
                });
            } else if (provider === 'composio_whatsapp') {
                response = await fetch(`${this.backendBaseUrl}/api/composio/disconnect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                    body: JSON.stringify({ toolkit: 'WHATSAPP' })
                });
            } else {
                response = await fetch(`${this.backendBaseUrl}/api/integrations/disconnect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                    body: JSON.stringify({ service: provider })
                });
            }
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to disconnect');
            }
            this.showNotification(`Successfully disconnected from ${provider}.`, 'success');
            this.checkIntegrationStatus();
        } catch (error) {
            console.error(`Error disconnecting ${provider}:`, error);
            this.showNotification(error.message, 'error');
        }
    }

    async checkIntegrationStatus() {
        const session = await this.authService.getSession();
        if (!session || !session.access_token) {
            ['github', 'google', 'vercel', 'supabase', 'composio_google_sheets', 'composio_whatsapp'].forEach(p => this.updateIntegrationButton(p, false));
            return;
        }
        try {
            const response = await fetch(`${this.backendBaseUrl}/api/integrations`, {
                headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
            if (!response.ok) throw new Error('Failed to fetch integration status');
            const data = await response.json();
            const connected = new Set(data.integrations);
            ['github', 'google', 'vercel', 'supabase'].forEach(p => this.updateIntegrationButton(p, connected.has(p)));

            const composioStatusResponse = await fetch(`${this.backendBaseUrl}/api/composio/status?toolkit=GOOGLESHEETS`, {
                headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
            if (composioStatusResponse.ok) {
                const composioStatusData = await composioStatusResponse.json();
                this.updateIntegrationButton('composio_google_sheets', !!composioStatusData.connected);
            } else {
                this.updateIntegrationButton('composio_google_sheets', false);
            }

            const whatsappStatusResponse = await fetch(`${this.backendBaseUrl}/api/composio/status?toolkit=WHATSAPP`, {
                headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
            if (whatsappStatusResponse.ok) {
                const whatsappStatusData = await whatsappStatusResponse.json();
                this.updateIntegrationButton('composio_whatsapp', !!whatsappStatusData.connected);
            } else {
                this.updateIntegrationButton('composio_whatsapp', false);
            }
        } catch (error) {
            console.error('Error checking integration status:', error);
            ['github', 'google', 'vercel', 'supabase', 'composio_google_sheets', 'composio_whatsapp'].forEach(p => this.updateIntegrationButton(p, false));
        }
    }

    updateIntegrationButton(provider, isConnected) {
        const providerToElementKey = {
            github: 'connectGithubBtn',
            google: 'connectGoogleBtn',
            vercel: 'connectVercelBtn',
            supabase: 'connectSupabaseBtn',
            composio_google_sheets: 'connectGoogleSheetsBtn',
            composio_whatsapp: 'connectWhatsappBtn'
        };
        const button = this.elements[providerToElementKey[provider]];
        if (!button) return;
        const textSpan = button.querySelector('.btn-text');
        const connectIcon = button.querySelector('.icon-connect');
        const connectedIcon = button.querySelector('.icon-connected');
        if (isConnected) {
            button.classList.add('connected');
            button.dataset.action = 'disconnect';
            textSpan.textContent = 'Disconnect';
            connectIcon.style.display = 'none';
            connectedIcon.style.display = 'inline-block';
        } else {
            button.classList.remove('connected');
            button.dataset.action = 'connect';
            textSpan.textContent = 'Connect';
            connectIcon.style.display = 'inline-block';
            connectedIcon.style.display = 'none';
        }
    }

    async _getAccessToken() {
        const session = await this.authService?.getSession();
        return session?.access_token || null;
    }

    async _callAuthorizedApi(endpoint, method = 'GET', body = null) {
        const token = await this._getAccessToken();
        if (!token) {
            throw new Error('User not authenticated.');
        }

        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };

        if (body !== null) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${this.backendBaseUrl}${endpoint}`, options);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || 'Request failed.');
        }
        return payload;
    }

    _formatTokenCount(value) {
        const numeric = Number(value) || 0;
        return numeric.toLocaleString();
    }

    _formatResetAt(value, fallback = '-') {
        if (!value) return fallback;
        try {
            return new Date(value).toLocaleString();
        } catch (error) {
            return String(value);
        }
    }

    _ensureConvexUsageSource(summary) {
        const source = String(summary?.usage_source || '').toLowerCase();
        if (source !== 'convex_window') {
            throw new Error('Usage source is not Convex. Please check backend Convex configuration.');
        }
    }

    resetSubscriptionUI() {
        this.subscriptionSummary = null;
        if (this.elements.usagePeriodLabel) this.elements.usagePeriodLabel.textContent = 'Current Usage';
        if (this.elements.subscriptionSubtitle) this.elements.subscriptionSubtitle.textContent = 'Track your plan and upgrade when you need more headroom.';
        if (this.elements.currentPlanName) this.elements.currentPlanName.textContent = 'Core';
        if (this.elements.subscriptionStatusBadge) {
            this.elements.subscriptionStatusBadge.textContent = 'FREE';
            this.elements.subscriptionStatusBadge.className = 'subscription-status-badge status-free';
        }
        if (this.elements.currentPlanLimit) this.elements.currentPlanLimit.textContent = '50,000 tokens/day';
        if (this.elements.currentPlanRemaining) this.elements.currentPlanRemaining.textContent = '-';
        if (this.elements.currentPlanRenewal) this.elements.currentPlanRenewal.textContent = '-';
        if (this.elements.subscriptionUsageBar) this.elements.subscriptionUsageBar.style.width = '0%';
        if (this.elements.subscriptionProgressCopy) this.elements.subscriptionProgressCopy.textContent = 'Usage will appear here.';

        this.elements.pricingPlanCards?.forEach((card) => {
            card.classList.remove('is-current-plan');
        });
        this.elements.pricingPlanButtons?.forEach((button) => {
            const planType = button.dataset.planType;
            button.disabled = planType === 'free';
            button.classList.toggle('is-current', planType === 'free');
            if (planType === 'free') {
                button.textContent = 'Current plan';
            } else if (planType === 'pro') {
                button.textContent = 'Upgrade to Pro';
            } else if (planType === 'elite') {
                button.textContent = 'Upgrade to Elite';
            }
        });
    }

    renderSubscriptionSummary(summary = null) {
        const data = summary || this.subscriptionSummary;
        if (!data) {
            this.resetSubscriptionUI();
            return;
        }

        this.subscriptionSummary = data;
        const planType = String(data.plan_type || 'free').toLowerCase();
        const planName = data.plan_name || 'Core';
        const badgeClass = `subscription-status-badge status-${planType}`;
        const totalUsed = Number(data?.usage?.total_tokens) || 0;
        const renewalText = data.current_period_end
            ? this._formatResetAt(data.current_period_end, 'Awaiting confirmation')
            : (planType === 'free' ? 'Daily reset' : 'Awaiting confirmation');
        const statusLabel = String(data.status_label || planName).toUpperCase();

        if (this.elements.usagePeriodLabel) {
            this.elements.usagePeriodLabel.textContent = data.period_label || 'Current Usage';
        }
        if (this.elements.subscriptionSubtitle) {
            this.elements.subscriptionSubtitle.textContent = `${planName} plan · ${data.limit_label || ''}`;
        }
        if (this.elements.currentPlanName) this.elements.currentPlanName.textContent = planName;
        if (this.elements.subscriptionStatusBadge) {
            this.elements.subscriptionStatusBadge.textContent = statusLabel;
            this.elements.subscriptionStatusBadge.className = badgeClass;
        }
        if (this.elements.currentPlanLimit) this.elements.currentPlanLimit.textContent = data.limit_label || '-';
        if (this.elements.currentPlanRemaining) this.elements.currentPlanRemaining.textContent = `${this._formatTokenCount(data.remaining_tokens)} tokens`;
        if (this.elements.currentPlanRenewal) this.elements.currentPlanRenewal.textContent = renewalText;
        if (this.elements.subscriptionUsageBar) {
            this.elements.subscriptionUsageBar.style.width = `${Math.min(Math.max(Number(data.usage_percent) || 0, 0), 100)}%`;
        }
        if (this.elements.subscriptionProgressCopy) {
            this.elements.subscriptionProgressCopy.textContent = `${this._formatTokenCount(totalUsed)} / ${this._formatTokenCount(data.limit_tokens)} tokens used`;
        }

        this.elements.pricingPlanCards?.forEach((card) => {
            card.classList.toggle('is-current-plan', card.dataset.planCard === planType);
        });

        this.updatePricingButtons(data);
    }

    updatePricingButtons(summary = null) {
        const data = summary || this.subscriptionSummary || { plan_type: 'free', can_create_subscription: true };
        const currentPlanType = String(data.plan_type || 'free').toLowerCase();
        const hasExistingSubscription = !data.can_create_subscription && !!data.razorpay_subscription_id;
        const currentStatus = String(data.subscription_status || '').toLowerCase();

        this.elements.pricingPlanButtons?.forEach((button) => {
            const planType = button.dataset.planType;
            const isCurrent = planType === currentPlanType;
            const isLoading = this.activeCheckoutPlan === planType;

            button.classList.toggle('is-current', isCurrent);

            if (planType === 'free') {
                button.disabled = true;
                button.textContent = currentPlanType === 'free' ? 'Current plan' : 'Included';
                return;
            }

            if (isLoading) {
                button.disabled = true;
                button.textContent = 'Starting...';
                return;
            }

            if (isCurrent) {
                button.disabled = true;
                button.textContent = currentStatus === 'created' ? 'Pending confirmation' : 'Current plan';
                return;
            }

            if (hasExistingSubscription) {
                button.disabled = true;
                button.textContent = 'Existing subscription';
                return;
            }

            button.disabled = false;
            button.textContent = planType === 'pro' ? 'Upgrade to Pro' : 'Upgrade to Elite';
        });
    }

    async openPricingModal(options = {}) {
        if (!this.elements.pricingModal) return;

        if (options.summary) {
            this.renderSubscriptionSummary(options.summary);
        } else if (this.authService?.isAuthenticated?.()) {
            try {
                const payload = await this._callAuthorizedApi('/api/subscription/status');
                this.renderSubscriptionSummary(payload.summary || null);
            } catch (error) {
                console.error('Failed to refresh subscription status before opening pricing modal:', error);
            }
        }

        if (window.stateManager) {
            window.stateManager.setState({ isAIOSOpen: true });
        }
        this.switchTab('account');
        this.pricingModalContext = options || {};
        if (this.elements.pricingModalMessage) {
            this.elements.pricingModalMessage.textContent = options.message || 'Subscriptions are billed monthly through Razorpay.';
        }
        if (this.elements.pricingModalFootnote) {
            this.elements.pricingModalFootnote.textContent = options.footnote || 'Your current usage and renewal window will update after payment verification.';
        }
        this.elements.pricingModal.classList.remove('hidden');
        this.elements.pricingModal.setAttribute('aria-hidden', 'false');
    }

    closePricingModal() {
        if (!this.elements.pricingModal) return;
        this.elements.pricingModal.classList.add('hidden');
        this.elements.pricingModal.setAttribute('aria-hidden', 'true');
        this.pricingModalContext = null;
    }

    async startSubscriptionCheckout(planType) {
        const normalizedPlan = String(planType || '').toLowerCase();
        if (!['pro', 'elite'].includes(normalizedPlan)) {
            return;
        }
        if (this.activeCheckoutPlan) {
            return;
        }
        if (typeof window.Razorpay !== 'function') {
            this.showNotification('Razorpay checkout failed to load.', 'error');
            return;
        }

        this.activeCheckoutPlan = normalizedPlan;
        this.updatePricingButtons();

        try {
            const payload = await this._callAuthorizedApi('/api/subscription/create', 'POST', {
                plan_type: normalizedPlan,
            });
            const currentUser = this.authService?.getCurrentUser?.();
            const checkout = new window.Razorpay({
                key: payload.key_id,
                subscription_id: payload.subscription_id,
                name: 'Aetheria AI',
                description: `${payload.plan_name} monthly subscription`,
                prefill: {
                    name: currentUser?.user_metadata?.name || currentUser?.user_metadata?.full_name || this.userData?.account?.name || '',
                    email: currentUser?.email || ''
                },
                theme: {
                    color: '#38bdf8'
                },
                handler: async (response) => {
                    await this.verifySubscriptionCheckout(response);
                },
                modal: {
                    ondismiss: () => {
                        this.activeCheckoutPlan = null;
                        this.updatePricingButtons();
                    }
                }
            });

            checkout.on('payment.failed', (response) => {
                const description = response?.error?.description || 'Payment failed.';
                this.showNotification(description, 'error');
                this.activeCheckoutPlan = null;
                this.updatePricingButtons();
            });

            this.activeCheckoutPlan = null;
            this.updatePricingButtons(payload.summary || this.subscriptionSummary);
            checkout.open();
        } catch (error) {
            console.error('Failed to start subscription checkout:', error);
            this.showNotification(error.message || 'Failed to start checkout.', 'error');
            this.activeCheckoutPlan = null;
            this.updatePricingButtons();
        }
    }

    async verifySubscriptionCheckout(response) {
        try {
            const payload = await this._callAuthorizedApi('/api/subscription/verify', 'POST', response);
            this.renderSubscriptionSummary(payload.summary || null);
            this.showNotification(`${payload?.summary?.plan_name || 'Subscription'} activated successfully`, 'success');
            this.closePricingModal();
        } catch (error) {
            console.error('Failed to verify subscription checkout:', error);
            this.showNotification(error.message || 'Payment verification failed.', 'error');
        } finally {
            this.activeCheckoutPlan = null;
            this.updatePricingButtons();
        }
    }

    _safeText(value, fallback = '-') {
        if (value === null || value === undefined) return fallback;
        const text = String(value).trim();
        return text.length ? text : fallback;
    }

    _escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _formatDate(value) {
        if (!value) return '-';
        try {
            return new Date(value).toLocaleString();
        } catch (e) {
            return String(value);
        }
    }

    async loadDeployments(showNotification = false) {
        try {
            const token = await this._getAccessToken();
            if (!token) {
                this.deploymentsCache = [];
                this.renderDeployments([]);
                return;
            }

            const response = await fetch(`${this.backendBaseUrl}/api/deploy/projects?limit=100`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || 'Failed to load deployments');
            }

            this.deploymentsCache = Array.isArray(payload.projects) ? payload.projects : [];
            this.renderDeployments(this.deploymentsCache);
            if (showNotification) this.showNotification('Deployments refreshed', 'success');
        } catch (error) {
            console.error('Error loading deployments:', error);
            this.renderDeployments([]);
            if (showNotification) this.showNotification(error.message || 'Failed to load deployments', 'error');
        }
    }

    async loadDatabases(showNotification = false) {
        try {
            const token = await this._getAccessToken();
            if (!token) {
                this.databasesCache = [];
                this.populateDatabaseProjectFilter([]);
                this.renderDatabases([]);
                return;
            }

            const response = await fetch(`${this.backendBaseUrl}/api/deploy/databases?limit=200`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || 'Failed to load databases');
            }

            this.databasesCache = Array.isArray(payload.databases) ? payload.databases : [];
            this.populateDatabaseProjectFilter(this.databasesCache);
            this.renderDatabases(this.databasesCache);
            if (showNotification) this.showNotification('Databases refreshed', 'success');
        } catch (error) {
            console.error('Error loading databases:', error);
            this.populateDatabaseProjectFilter([]);
            this.renderDatabases([]);
            if (showNotification) this.showNotification(error.message || 'Failed to load databases', 'error');
        }
    }

    async loadUsage(showNotification = false) {
        if (!this.usageView) return;

        try {
            const isAuthenticated = this.authService?.isAuthenticated?.() || false;
            if (!isAuthenticated) {
                this.usageView.setEmpty();
                this.usageView.setError('');
                this.resetSubscriptionUI();
                return;
            }

            this.usageView.setLoading();
            const payload = await this._callAuthorizedApi('/api/subscription/status');
            const summary = payload.summary || null;

            if (!summary) {
                this.usageView.setEmpty();
                this.resetSubscriptionUI();
                if (showNotification) this.showNotification('No usage records yet', 'success');
                return;
            }

            this._ensureConvexUsageSource(summary);
            this.usageView.render(summary.usage || {});
            this.renderSubscriptionSummary(summary);
            if (showNotification) this.showNotification('Usage refreshed', 'success');
        } catch (error) {
            console.error('Error loading usage:', error);
            this.usageView.setEmpty();
            this.usageView.setError(error.message || 'Failed to load usage');
            this.resetSubscriptionUI();
            if (showNotification) this.showNotification(error.message || 'Failed to load usage', 'error');
        }
    }

    _formatMemoryContent(value) {
        if (value === null || value === undefined) return '-';
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value, null, 2);
        } catch (e) {
            return String(value);
        }
    }

    _setMemoryFormMode(editing = false) {
        const title = this.elements.memoryEntryTitle;
        const submitBtn = this.elements.memorySubmitBtn;
        const cancelBtn = this.elements.memoryCancelEditBtn;
        if (title) title.textContent = editing ? 'Edit Memory' : 'Add Memory Manually';
        if (submitBtn) submitBtn.textContent = editing ? 'Update Memory' : 'Add Memory';
        if (cancelBtn) cancelBtn.classList.toggle('hidden', !editing);
    }

    resetMemoryForm() {
        this.editingMemoryId = null;
        this.elements.memoryForm?.reset();
        this._setMemoryFormMode(false);
    }

    startEditMemory(row) {
        this.editingMemoryId = row?.memory_id || null;
        if (!this.editingMemoryId) return;

        const memoryText = this._formatMemoryContent(row.memory);
        if (this.elements.memoryContent) this.elements.memoryContent.value = memoryText === '-' ? '' : memoryText;
        if (this.elements.memoryInput) this.elements.memoryInput.value = this._safeText(row.input, '');
        if (this.elements.memoryAgentId) this.elements.memoryAgentId.value = this._safeText(row.agent_id, '');
        if (this.elements.memoryTeamId) this.elements.memoryTeamId.value = this._safeText(row.team_id, '');

        let topicsText = '';
        if (Array.isArray(row.topics)) topicsText = row.topics.join(', ');
        else if (typeof row.topics === 'string') topicsText = row.topics;
        if (this.elements.memoryTopics) this.elements.memoryTopics.value = topicsText;

        this._setMemoryFormMode(true);
        this.elements.memoryContent?.focus();
        this.elements.memoryContent?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async loadMemories(showNotification = false) {
        try {
            const token = await this._getAccessToken();
            if (!token) {
                this.memoriesCache = [];
                this.renderMemories([]);
                return;
            }

            const response = await fetch(`${this.backendBaseUrl}/api/memories?limit=200`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || 'Failed to load memories');
            }

            this.memoriesCache = Array.isArray(payload.memories) ? payload.memories : [];
            this.renderMemories(this.memoriesCache);
            if (showNotification) this.showNotification('Memories refreshed successfully', 'success');
        } catch (error) {
            console.error('Error loading memories:', error);
            this.renderMemories([]);
            if (showNotification) this.showNotification(error.message || 'Failed to load memories', 'error');
        }
    }

    async handleAddMemory() {
        try {
            const token = await this._getAccessToken();
            if (!token) {
                this.showNotification('Please log in to add memory', 'error');
                return;
            }

            const memoryRaw = this.elements.memoryContent?.value?.trim();
            if (!memoryRaw) {
                this.showNotification('Memory content is required', 'error');
                return;
            }

            let memoryValue = memoryRaw;
            try {
                memoryValue = JSON.parse(memoryRaw);
            } catch (e) {
                // Keep as plain string when not valid JSON.
            }

            const input = this.elements.memoryInput?.value?.trim() || '';
            const agentId = this.elements.memoryAgentId?.value?.trim() || '';
            const teamId = this.elements.memoryTeamId?.value?.trim() || '';
            const topicsRaw = this.elements.memoryTopics?.value?.trim() || '';
            const topics = topicsRaw
                ? topicsRaw.split(',').map((x) => x.trim()).filter(Boolean)
                : [];

            const body = {
                memory: memoryValue,
                input: input || null,
                agent_id: agentId || null,
                team_id: teamId || null,
                topics: topics.length ? topics : null,
            };

            const isEdit = !!this.editingMemoryId;
            const endpoint = isEdit
                ? `${this.backendBaseUrl}/api/memories/${encodeURIComponent(this.editingMemoryId)}`
                : `${this.backendBaseUrl}/api/memories`;
            const method = isEdit ? 'PUT' : 'POST';

            const response = await fetch(endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || 'Failed to save memory');
            }

            this.resetMemoryForm();
            this.showNotification(
                isEdit ? 'Memory updated successfully' : 'Memory added successfully',
                'success'
            );
            this.loadMemories();
        } catch (error) {
            console.error('Error adding memory:', error);
            this.showNotification(error.message || 'Failed to save memory', 'error');
        }
    }

    async deleteMemory(memoryId) {
        if (!memoryId) return;

        // Use custom confirmation modal instead of browser confirm
        this.showMemoryConfirmation(
            'This action cannot be undone. The memory will be permanently removed from your account.',
            async () => {
                try {
                    const token = await this._getAccessToken();
                    if (!token) {
                        this.showNotification('Please log in to delete memory', 'error');
                        return;
                    }

                    const response = await fetch(`${this.backendBaseUrl}/api/memories/${encodeURIComponent(memoryId)}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const payload = await response.json();
                    if (!response.ok || !payload.ok) {
                        throw new Error(payload.error || 'Failed to delete memory');
                    }

                    if (this.editingMemoryId === memoryId) this.resetMemoryForm();
                    this.showNotification('Memory deleted successfully', 'success');
                    this.loadMemories();
                } catch (error) {
                    console.error('Error deleting memory:', error);
                    this.showNotification(error.message || 'Failed to delete memory', 'error');
                }
            }
        );
    }

    renderDeployments(projects) {
        const list = this.elements.deploymentsList;
        const empty = this.elements.deploymentsEmpty;
        if (!list || !empty) return;

        list.innerHTML = '';
        const items = Array.isArray(projects) ? projects : [];
        if (!items.length) {
            empty.classList.remove('hidden');
            empty.innerHTML = '<div class="empty-state-text">No deployments found. Deploy your first project to see it here.</div>';
            return;
        }
        empty.classList.add('hidden');

        items.forEach((project) => {
            const status = this._safeText(project.deployment_status, 'unknown').toLowerCase();
            const badgeClass = status === 'active' ? 'status-active' : status === 'draft' ? 'status-draft' : '';
            
            const card = document.createElement('div');
            card.className = 'settings-card';
            card.innerHTML = `
                <div class="settings-card-header">
                    <div class="settings-card-header-left">
                        <h4>${this._safeText(project.project_name, 'Untitled')}</h4>
                    </div>
                    <div class="settings-card-actions">
                        <button class="start-project-coding-btn" title="Start Coding Workspace">
                            <i class="fas fa-code"></i>
                            <span>Start Coding</span>
                        </button>
                        <button class="expand-deployment-btn" title="View Details" data-project='${JSON.stringify(project).replace(/'/g, "&apos;")}'>
                            <i class="fas fa-expand-alt"></i>
                        </button>
                        <span class="settings-badge ${badgeClass}">${this._safeText(project.deployment_status, 'unknown')}</span>
                    </div>
                </div>
                <div class="settings-meta-grid">
                    <div><strong>Site ID</strong><span>${this._safeText(project.site_id)}</span></div>
                    <div><strong>Slug</strong><span>${this._safeText(project.slug)}</span></div>
                    <div><strong>Hostname</strong><span>${this._safeText(project.hostname)}</span></div>
                    <div><strong>Version</strong><span>v${this._safeText(project.version)}</span></div>
                    <div><strong>Deployment ID</strong><span>${this._safeText(project.deployment_id)}</span></div>
                    <div><strong>R2 Prefix</strong><span>${this._safeText(project.r2_prefix)}</span></div>
                </div>
            `;
            
            // Add click handler for expand button
            const expandBtn = card.querySelector('.expand-deployment-btn');
            expandBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showDeploymentDetail(project);
            });

            const startCodingBtn = card.querySelector('.start-project-coding-btn');
            startCodingBtn?.addEventListener('click', (e) => {
                e.stopPropagation();

                document.dispatchEvent(new CustomEvent('project-workspace:open', {
                    detail: {
                        site_id: project.site_id,
                        deployment_id: project.deployment_id,
                        project_name: project.project_name,
                        slug: project.slug,
                        hostname: project.hostname,
                        r2_prefix: project.r2_prefix
                    }
                }));

                if (window.stateManager?.setState) {
                    window.stateManager.setState({ isProjectWorkspaceOpen: true, isAIOSOpen: false });
                }

                this.hideWindow();
                this.showNotification(`Opened coding workspace for ${this._safeText(project.project_name, 'project')}`, 'success');
            });
            
            list.appendChild(card);
        });
    }

    populateDatabaseProjectFilter(databases) {
        const select = this.elements.databaseProjectFilter;
        if (!select) return;

        const previous = this.selectedDatabaseProject || 'all';
        const projectMap = new Map();
        (Array.isArray(databases) ? databases : []).forEach((row) => {
            const key = this._safeText(row.site_id);
            const label = `${this._safeText(row.project_name, 'Untitled')} (${this._safeText(row.slug, key)})`;
            if (!projectMap.has(key)) projectMap.set(key, label);
        });

        select.innerHTML = '<option value="all">All Projects</option>';
        [...projectMap.entries()].forEach(([siteId, label]) => {
            const option = document.createElement('option');
            option.value = siteId;
            option.textContent = label;
            select.appendChild(option);
        });

        const hasPrevious = previous === 'all' || projectMap.has(previous);
        this.selectedDatabaseProject = hasPrevious ? previous : 'all';
        select.value = this.selectedDatabaseProject;
    }

    renderDatabases(databases) {
        const list = this.elements.databasesList;
        const empty = this.elements.databasesEmpty;
        if (!list || !empty) return;

        const selectedProject = this.selectedDatabaseProject || 'all';
        const items = (Array.isArray(databases) ? databases : []).filter((row) =>
            selectedProject === 'all' ? true : String(row.site_id) === String(selectedProject)
        );

        list.innerHTML = '';
        if (!items.length) {
            empty.classList.remove('hidden');
            empty.innerHTML = '<div class="empty-state-text">No databases found. Provision a database for your deployed sites.</div>';
            return;
        }
        empty.classList.add('hidden');

        items.forEach((row) => {
            const status = this._safeText(row.deployment_status, 'unknown').toLowerCase();
            const badgeClass = status === 'active' ? 'status-active' : status === 'draft' ? 'status-draft' : '';
            
            const card = document.createElement('div');
            card.className = 'settings-card';
            card.innerHTML = `
                <div class="settings-card-header">
                    <h4>${this._safeText(row.project_name, 'Untitled')}</h4>
                    <span class="settings-badge ${badgeClass}">${this._safeText(row.deployment_status, 'unknown')}</span>
                </div>
                <div class="settings-meta-grid">
                    <div><strong>Site ID</strong><span>${this._safeText(row.site_id)}</span></div>
                    <div><strong>Slug</strong><span>${this._safeText(row.slug)}</span></div>
                    <div><strong>Hostname</strong><span>${this._safeText(row.hostname)}</span></div>
                    <div><strong>Database Name</strong><span>${this._safeText(row.database_name)}</span></div>
                    <div><strong>DB Hostname</strong><span>${this._safeText(row.database_hostname)}</span></div>
                    <div><strong>Created</strong><span>${this._formatDate(row.database_created_at)}</span></div>
                </div>
            `;
            list.appendChild(card);
        });
    }

    renderMemories(memories) {
        const list = this.elements.memoriesList;
        const empty = this.elements.memoriesEmpty;
        if (!list || !empty) return;

        const items = Array.isArray(memories) ? memories : [];
        list.innerHTML = '';

        if (!items.length) {
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        items.forEach((row, index) => {
            const card = document.createElement('div');
            card.className = 'memory-compact-card';
            card.style.animationDelay = `${index * 0.04}s`;
            
            const memoryContent = this._formatMemoryContent(row.memory);
            const memoryPreview = this._escapeHtml(
                typeof memoryContent === 'string' && memoryContent.length > 80 
                    ? memoryContent.substring(0, 80) + '...' 
                    : memoryContent
            );
            const memoryFull = this._escapeHtml(memoryContent);
            
            const topicsArray = Array.isArray(row.topics) ? row.topics : [];
            const topicsHtml = topicsArray.length 
                ? topicsArray.map(t => `<span class="topic-tag">${this._escapeHtml(t)}</span>`).join('')
                : '<span style="color: var(--text-secondary); font-style: italic; font-size: 13px;">No topics</span>';
            
            const memoryId = this._escapeHtml(this._safeText(row.memory_id, 'Memory'));
            const updatedAt = this._escapeHtml(this._formatDate((row.updated_at || 0) * 1000));
            const agentId = this._escapeHtml(this._safeText(row.agent_id, '-'));
            const teamId = this._escapeHtml(this._safeText(row.team_id, '-'));
            const inputText = this._escapeHtml(this._safeText(row.input, '-'));

            card.innerHTML = `
                <div class="memory-card-collapsed">
                    <div class="memory-expand-icon">
                        <i class="fas fa-chevron-right"></i>
                    </div>
                    <div class="memory-card-preview">
                        <div class="memory-preview-content">${memoryPreview}</div>
                    </div>
                    <div class="memory-card-meta">
                        <span class="memory-timestamp">
                            <i class="far fa-clock"></i>
                            ${updatedAt}
                        </span>
                        <div class="memory-card-actions" onclick="event.stopPropagation();">
                            <button type="button" class="memory-action-btn memory-edit-btn" title="Edit Memory" aria-label="Edit Memory">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button type="button" class="memory-action-btn memory-delete-btn" title="Delete Memory" aria-label="Delete Memory">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="memory-card-expanded">
                    <div class="memory-expanded-content">
                        <div class="memory-detail-section">
                            <div class="memory-detail-label">Memory ID</div>
                            <div class="memory-detail-value">${memoryId}</div>
                        </div>
                        <div class="memory-detail-section">
                            <div class="memory-detail-label">Memory Content</div>
                            <div class="memory-detail-value code">${memoryFull}</div>
                        </div>
                        <div class="memory-detail-grid">
                            <div class="memory-detail-section">
                                <div class="memory-detail-label">Agent ID</div>
                                <div class="memory-detail-value">${agentId}</div>
                            </div>
                            <div class="memory-detail-section">
                                <div class="memory-detail-label">Team ID</div>
                                <div class="memory-detail-value">${teamId}</div>
                            </div>
                        </div>
                        <div class="memory-detail-section">
                            <div class="memory-detail-label">Source</div>
                            <div class="memory-detail-value">${inputText}</div>
                        </div>
                        <div class="memory-detail-section">
                            <div class="memory-detail-label">Topics</div>
                            <div class="memory-topics-container">${topicsHtml}</div>
                        </div>
                    </div>
                </div>
            `;

            // Toggle expand/collapse
            const collapsedSection = card.querySelector('.memory-card-collapsed');
            collapsedSection.addEventListener('click', (e) => {
                // Don't toggle if clicking on action buttons
                if (e.target.closest('.memory-card-actions')) return;
                card.classList.toggle('expanded');
            });

            // Action buttons
            card.querySelector('.memory-edit-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startEditMemory(row);
            });
            card.querySelector('.memory-delete-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteMemory(row.memory_id);
            });

            list.appendChild(card);
        });
    }

    async loadUserData() {
        const defaultData = {
            account: { email: 'user@example.com', name: 'User Name' },
            about: { version: '1.0.0', lastUpdate: new Date().toISOString() }
        };
        try {
            const profilePath = window.electron.path.join(this.userDataPath, 'profile.json');
            return window.electron.fs.existsSync(profilePath)
                ? { ...defaultData, ...JSON.parse(window.electron.fs.readFileSync(profilePath, 'utf8')) }
                : defaultData;
        } catch (error) {
            console.error('Error loading user data:', error);
            return defaultData;
        }
    }

    saveUserData() {
        try {
            const profilePath = window.electron.path.join(this.userDataPath, 'profile.json');
            const dataToSave = {
                account: this.userData.account,
                lastUpdate: new Date().toISOString()
            };
            window.electron.fs.writeFileSync(profilePath, JSON.stringify(dataToSave, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving user data:', error);
            this.showNotification('Failed to save user data', 'error');
        }
    }

    loadSavedData() {
        const user = this.authService?.getCurrentUser();
        if (user) {
            this.updateUserUI(user);
        } else {
            // If not logged in, ensure UI is in a clean logged-out state.
            this.updateUserUI(null);
        }
    }

    handleSupportSubmit() {
        const formData = {
            subject: this.elements.subject?.value,
            description: this.elements.description?.value,
            timestamp: new Date().toISOString()
        };
        try {
            const feedbackPath = window.electron.path.join(this.userDataPath, 'feedback.json');
            const feedbackHistory = window.electron.fs.existsSync(feedbackPath)
                ? JSON.parse(window.electron.fs.readFileSync(feedbackPath, 'utf8'))
                : [];
            feedbackHistory.push(formData);
            window.electron.fs.writeFileSync(feedbackPath, JSON.stringify(feedbackHistory, null, 2), 'utf8');
            this.elements.supportForm?.reset();
            this.showNotification('Feedback submitted successfully', 'success');
        } catch (error) {
            console.error('Error saving feedback:', error);
            this.showNotification('Failed to submit feedback', 'error');
        }
    }

    async handleLogin() {
        if (!this.authService) return;
        const email = this.elements.loginEmail.value;
        const password = this.elements.loginPassword.value;
        if (!email || !password) {
            this.elements.loginError.textContent = 'Please enter both email and password';
            return;
        }
        try {
            const result = await this.authService.signIn(email, password);
            if (result.success) {
                this.elements.loginForm.reset();
                this.elements.loginError.textContent = '';
                this.showNotification('Logged in successfully', 'success');
            } else {
                this.elements.loginError.textContent = result.error || 'Login failed';
            }
        } catch (error) {
            this.elements.loginError.textContent = 'An unexpected error occurred';
        }
    }

    async handleSignup() {
        if (!this.authService) return;
        const name = this.elements.signupName ? this.elements.signupName.value : '';
        const email = this.elements.signupEmail.value;
        const password = this.elements.signupPassword.value;
        const confirmPassword = this.elements.confirmPassword.value;
        if (!name || !email || !password || !confirmPassword) {
            this.elements.signupError.textContent = 'All fields are required';
            return;
        }
        if (password !== confirmPassword) {
            this.elements.signupError.textContent = 'Passwords do not match';
            return;
        }
        try {
            const result = await this.authService.signUp(email, password, name.trim());
            if (result.success) {
                this.elements.signupForm.reset();
                this.elements.signupError.textContent = '';
                this.showNotification('Account created successfully. Please check your email to verify.', 'success');
                this.switchAuthTab('login');
            } else {
                this.elements.signupError.textContent = result.error || 'Signup failed';
            }
        } catch (error) {
            this.elements.signupError.textContent = 'An unexpected error occurred';
        }
    }

    async handleLogout() {
        if (!this.authService) return;
        if (confirm('Are you sure you want to log out?')) {
            try {
                const result = await this.authService.signOut();
                if (result.success) {
                    this.showNotification('Logged out successfully', 'success');
                } else {
                    this.showNotification('Logout failed: ' + result.error, 'error');
                }
            } catch (error) {
                this.showNotification('An unexpected error occurred during logout', 'error');
            }
        }
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const validTypes = ['.jpg', '.png', '.gif', '.txt'];
        const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        if (!validTypes.includes(fileExtension)) {
            alert('Invalid file type. Please upload .jpg, .png, .gif, or .txt files only.');
            event.target.value = '';
            return;
        }
        if (fileExtension !== '.txt') this.createImagePreview(file);
    }

    createImagePreview(file) {
        const reader = new FileReader();
        const previewContainer = document.createElement('div');
        previewContainer.className = 'screenshot-preview';
        reader.onload = (e) => {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.maxWidth = '200px';
            img.style.maxHeight = '200px';
            previewContainer.innerHTML = '';
            previewContainer.appendChild(img);
            const previewArea = document.querySelector('.screenshot-preview');
            if (previewArea) previewArea.replaceWith(previewContainer);
            else this.elements.screenshot.parentNode.appendChild(previewContainer);
        };
        reader.readAsDataURL(file);
    }

    switchTab(tabName) {
        this.elements.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
        this.elements.tabContents.forEach(content => content.classList.toggle('active', content.id === `${tabName}-tab`));
        this.currentTab = tabName;

        // If switching to integration tab, check integration status
        if (tabName === 'integration') {
            this.checkIntegrationStatus();
        } else if (tabName === 'account') {
            this.loadUsage();
        } else if (tabName === 'deployments') {
            this.loadDeployments();
        } else if (tabName === 'database') {
            this.loadDatabases();
        } else if (tabName === 'memory') {
            this.loadMemories();
        }
    }

    switchAuthTab(tabName) {
        this.elements.authTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.authTab === tabName));
        if (tabName === 'login') {
            this.elements.loginForm.classList.add('active');
            this.elements.signupForm.classList.remove('active');
        } else {
            this.elements.loginForm.classList.remove('active');
            this.elements.signupForm.classList.add('active');
        }
    }

    updateAuthUI() {
        const isAuthenticated = this.authService?.isAuthenticated() || false;
        if (this.elements.accountLoggedIn && this.elements.accountLoggedOut) {
            this.elements.accountLoggedIn.classList.toggle('hidden', !isAuthenticated);
            this.elements.accountLoggedOut.classList.toggle('hidden', isAuthenticated);
        }
        if (isAuthenticated) {
            this.checkIntegrationStatus();
            this.loadDeployments();
            this.loadDatabases();
            this.loadMemories();
            this.loadUsage();
        } else {
            ['github', 'google', 'vercel', 'supabase', 'composio_google_sheets', 'composio_whatsapp'].forEach(p => this.updateIntegrationButton(p, false));
            this.renderDeployments([]);
            this.populateDatabaseProjectFilter([]);
            this.renderDatabases([]);
            this.renderMemories([]);
            this.usageView?.setEmpty();
            this.usageView?.setError('');
            this.resetSubscriptionUI();
            this.closePricingModal();
        }
    }

    showWindow() {
        this.elements.window?.classList.remove('hidden');
        if (window.floatingWindowManager) window.floatingWindowManager.onWindowOpen('aios-settings');
    }

    hideWindow() {
        this.elements.window?.classList.add('hidden');
        if (window.floatingWindowManager) window.floatingWindowManager.onWindowClose('aios-settings');
    }

    showNotification(message, type = 'success') {
        // Use the global notificationService (lowercase)
        if (window.notificationService && typeof window.notificationService.show === 'function') {
            window.notificationService.show(message, type);
            return;
        }
        // Fallback to NotificationService (uppercase) for backward compatibility
        if (window.NotificationService && typeof window.NotificationService.show === 'function') {
            window.NotificationService.show(message, type);
            return;
        }
        console.log(`[${type}] ${message}`);
    }

    // Custom confirmation modal for memory deletion
    showMemoryConfirmation(message, onConfirm) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('memory-confirm-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'memory-confirm-modal';
            modal.className = 'memory-confirm-modal';
            modal.innerHTML = `
                <div class="memory-confirm-content">
                    <div class="memory-confirm-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h3 class="memory-confirm-title">Delete Memory?</h3>
                    <p class="memory-confirm-message"></p>
                    <div class="memory-confirm-actions">
                        <button class="memory-confirm-btn memory-confirm-btn-cancel">Cancel</button>
                        <button class="memory-confirm-btn memory-confirm-btn-delete">Delete</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideMemoryConfirmation();
                }
            });
        }

        // Update message
        const messageEl = modal.querySelector('.memory-confirm-message');
        if (messageEl) messageEl.textContent = message;

        // Setup button handlers
        const cancelBtn = modal.querySelector('.memory-confirm-btn-cancel');
        const deleteBtn = modal.querySelector('.memory-confirm-btn-delete');

        const cleanup = () => {
            this.hideMemoryConfirmation();
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
            deleteBtn.replaceWith(deleteBtn.cloneNode(true));
        };

        modal.querySelector('.memory-confirm-btn-cancel').addEventListener('click', cleanup);
        modal.querySelector('.memory-confirm-btn-delete').addEventListener('click', () => {
            cleanup();
            onConfirm();
        });

        // Show modal
        requestAnimationFrame(() => {
            modal.classList.add('show');
        });
    }

    hideMemoryConfirmation() {
        const modal = document.getElementById('memory-confirm-modal');
        if (modal) {
            modal.classList.remove('show');
        }
    }
}

window.AIOS = new AIOS();
