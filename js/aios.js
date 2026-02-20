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
        this.selectedDatabaseProject = 'all';
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
        };
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
        this.elements.databaseProjectFilter?.addEventListener('change', (e) => {
            this.selectedDatabaseProject = e.target.value || 'all';
            this.renderDatabases(this.databasesCache);
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
                } else {
                    this.deploymentsCache = [];
                    this.databasesCache = [];
                    this.renderDeployments([]);
                    this.populateDatabaseProjectFilter([]);
                    this.renderDatabases([]);
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

    _safeText(value, fallback = '-') {
        if (value === null || value === undefined) return fallback;
        const text = String(value).trim();
        return text.length ? text : fallback;
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

    renderDeployments(projects) {
        const list = this.elements.deploymentsList;
        const empty = this.elements.deploymentsEmpty;
        if (!list || !empty) return;

        list.innerHTML = '';
        const items = Array.isArray(projects) ? projects : [];
        if (!items.length) {
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        items.forEach((project) => {
            const card = document.createElement('div');
            card.className = 'settings-card';
            card.innerHTML = `
                <div class="settings-card-header">
                    <h4>${this._safeText(project.project_name, 'Untitled')}</h4>
                    <span class="settings-badge">${this._safeText(project.deployment_status, 'unknown')}</span>
                </div>
                <div class="settings-meta-grid">
                    <div><strong>Site ID</strong><span>${this._safeText(project.site_id)}</span></div>
                    <div><strong>Slug</strong><span>${this._safeText(project.slug)}</span></div>
                    <div><strong>Hostname</strong><span>${this._safeText(project.hostname)}</span></div>
                    <div><strong>Version</strong><span>${this._safeText(project.version)}</span></div>
                    <div><strong>Deployment ID</strong><span>${this._safeText(project.deployment_id)}</span></div>
                    <div><strong>R2 Prefix</strong><span>${this._safeText(project.r2_prefix)}</span></div>
                </div>
            `;
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
            return;
        }
        empty.classList.add('hidden');

        items.forEach((row) => {
            const card = document.createElement('div');
            card.className = 'settings-card';
            card.innerHTML = `
                <div class="settings-card-header">
                    <h4>${this._safeText(row.project_name, 'Untitled')}</h4>
                    <span class="settings-badge">${this._safeText(row.deployment_status, 'unknown')}</span>
                </div>
                <div class="settings-meta-grid">
                    <div><strong>Site ID</strong><span>${this._safeText(row.site_id)}</span></div>
                    <div><strong>Slug</strong><span>${this._safeText(row.slug)}</span></div>
                    <div><strong>Hostname</strong><span>${this._safeText(row.hostname)}</span></div>
                    <div><strong>Database Name</strong><span>${this._safeText(row.database_name)}</span></div>
                    <div><strong>DB Hostname</strong><span>${this._safeText(row.database_hostname)}</span></div>
                    <div><strong>Created</strong><span>${this._formatDate(row.database_created_at)}</span></div>
                    <div><strong>Version</strong><span>${this._safeText(row.version)}</span></div>
                    <div><strong>R2 Prefix</strong><span>${this._safeText(row.r2_prefix)}</span></div>
                </div>
            `;
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
        } else if (tabName === 'deployments') {
            this.loadDeployments();
        } else if (tabName === 'database') {
            this.loadDatabases();
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
        } else {
            ['github', 'google', 'vercel', 'supabase', 'composio_google_sheets', 'composio_whatsapp'].forEach(p => this.updateIntegrationButton(p, false));
            this.renderDeployments([]);
            this.populateDatabaseProjectFilter([]);
            this.renderDatabases([]);
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
        if (window.NotificationService && typeof window.NotificationService.show === 'function') {
            window.NotificationService.show(message, type);
            return;
        }
        console.log(`[${type}] ${message}`);
    }
}

window.AIOS = new AIOS();
