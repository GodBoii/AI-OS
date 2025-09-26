// aios.js (Complete, with Active Session Setting Logic)

class AIOS {
    constructor() {
        this.initialized = false;
        this.currentTab = 'profile';
        this.elements = {};
        this.userDataPath = null; 
        this.userData = null; 
        this.authService = null; 
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
        this.updateAuthUI();
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
            settingsAvatarContainer: document.getElementById('aios-settings-avatar-container'),
            window: document.getElementById('floating-window'),
            closeBtn: document.getElementById('close-aios'),
            tabs: document.querySelectorAll('.tab-btn'),
            tabContents: document.querySelectorAll('.tab-content'),
            profileForm: document.getElementById('profile-form'),
            supportForm: document.getElementById('support-form'),
            logoutBtn: document.getElementById('logout-btn'),
            deleteAccountBtn: document.getElementById('delete-account-btn'),
            fullName: document.getElementById('fullName'),
            nickname: document.getElementById('nickname'),
            occupation: document.getElementById('occupation'),
            userEmail: document.getElementById('userEmail'),
            userName: document.getElementById('userName'),
            subject: document.getElementById('subject'),
            description: document.getElementById('description'),
            screenshot: document.getElementById('screenshot'),
            accountLoggedOut: document.getElementById('account-logged-out'),
            accountLoggedIn: document.getElementById('account-logged-in'),
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
            connectGithubBtn: document.getElementById('connect-github-btn'),
            connectGoogleBtn: document.getElementById('connect-google-btn'),
            connectVercelBtn: document.getElementById('connect-vercel-btn'),
            connectSupabaseBtn: document.getElementById('connect-supabase-btn'),
        };
    }

    setupEventListeners() {
        const addClickHandler = (element, handler) => {
            element?.addEventListener('click', handler);
        };

        // --- THIS IS THE FINAL, CORRECTED LISTENER ---
        // It actively parses the URL and commands the auth service to set the session.
        window.electron.ipcRenderer.on('auth-state-changed', async (data) => {
            console.log('[aios.js] Received "auth-state-changed" event from main process.');
            
            try {
                // The URL contains tokens in the hash fragment (#)
                const url = new URL(data.url);
                const hash = new URLSearchParams(url.hash.substring(1)); // remove #
                
                const accessToken = hash.get('access_token');
                const refreshToken = hash.get('refresh_token');

                if (accessToken && refreshToken) {
                    console.log('[aios.js] Tokens found in URL. Actively setting session.');
                    
                    // Command the auth service to set the session
                    await this.authService.setSession(accessToken, refreshToken);
                    
                    // The onAuthChange listener will now fire with a persistent SIGNED_IN state.
                    console.log('[aios.js] Session set command sent. UI should now update.');
                } else {
                    console.error('[aios.js] "auth-state-changed" event received, but no tokens were found in the URL hash.');
                }
            } catch (e) {
                console.error('[aios.js] Error parsing URL from deep link:', e);
            }
        });
        // --- END OF CORRECTION ---

        addClickHandler(this.elements.closeBtn, () => this.hideWindow());

        this.elements.tabs?.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        this.elements.profileForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleProfileSubmit();
        });

        this.elements.supportForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSupportSubmit();
        });
        
        addClickHandler(this.elements.logoutBtn, () => this.handleLogout());
        addClickHandler(this.elements.deleteAccountBtn, () => this.handleDeleteAccount());

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

            if (action === 'connect') {
                this.startAuthFlow(provider);
            } else if (action === 'disconnect') {
                this.disconnectIntegration(provider);
            }
        };
        
        addClickHandler(this.elements.connectGithubBtn, integrationButtonHandler);
        addClickHandler(this.elements.connectGoogleBtn, integrationButtonHandler);
        addClickHandler(this.elements.connectVercelBtn, integrationButtonHandler);
        addClickHandler(this.elements.connectSupabaseBtn, integrationButtonHandler);

        if (this.authService) {
            this.authService.onAuthChange((user) => {
                console.log('Auth change detected:', user);
                this.updateAuthUI();
                this.updateAvatar(user);

                if (user) {
                    if (this.elements.userEmail) {
                        this.elements.userEmail.textContent = user.email;
                    }
                    if (this.elements.userName) {
                        const name = user.user_metadata?.name || user.user_metadata?.full_name || 'User';
                        this.elements.userName.textContent = name;
                    }
                    this.userData.account.email = user.email;
                    if (user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) {
                        this.userData.account.name = user.user_metadata.name || user.user_metadata.full_name;
                    }
                    this.saveUserData();
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
                this.showNotification(result.error || 'Could not start Google Sign-In', 'error');
            }
        } catch (error) {
            console.error('Google Sign-In error:', error);
            this.elements.loginError.textContent = 'An unexpected error occurred during Google Sign-In';
        }
    }

    updateAvatar(user) {
        if (!this.elements.settingsAvatarContainer) return;

        const container = this.elements.settingsAvatarContainer;
        container.innerHTML = '';

        if (!user) {
            const icon = document.createElement('i');
            icon.className = 'fas fa-user-cog';
            container.appendChild(icon);
            return;
        }

        const avatarUrl = user.user_metadata?.picture;
        if (avatarUrl) {
            const img = document.createElement('img');
            img.src = avatarUrl;
            img.alt = 'User Avatar';
            img.className = 'user-avatar';
            container.appendChild(img);
        } else {
            const initialsDiv = document.createElement('div');
            initialsDiv.className = 'user-initials-avatar';
            
            const name = user.user_metadata?.name || user.email || '';
            let initials = 'U';
            
            if (name.includes(' ')) {
                const parts = name.split(' ');
                initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            } else if (name) {
                initials = name[0].toUpperCase();
            }
            
            initialsDiv.textContent = initials;
            container.appendChild(initialsDiv);
        }
    }


    async startAuthFlow(provider) {
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
        } else {
            const backendUrl = 'https://aios-web.onrender.com';
            authUrl = `${backendUrl}/login/${provider}?token=${session.access_token}`;
        }
    
        console.log(`Opening auth URL for ${provider}: ${authUrl}`);
        window.electron.ipcRenderer.send('open-webview', authUrl);
    }

    async disconnectIntegration(provider) {
        if (!confirm(`Are you sure you want to disconnect your ${provider} account?`)) {
            return;
        }
        const session = await this.authService.getSession();
        if (!session || !session.access_token) {
            this.showNotification('Authentication error. Please log in again.', 'error');
            return;
        }
        try {
            const response = await fetch('https://aios-web.onrender.com/api/integrations/disconnect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ service: provider })
            });
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
            this.updateIntegrationButton('github', false);
            this.updateIntegrationButton('google', false);
            this.updateIntegrationButton('vercel', false);
            this.updateIntegrationButton('supabase', false);
            return;
        }
        try {
            const response = await fetch('https://aios-web.onrender.com/api/integrations', {
                headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
            if (!response.ok) throw new Error('Failed to fetch integration status');
            const data = await response.json();
            const connected = new Set(data.integrations);
            this.updateIntegrationButton('github', connected.has('github'));
            this.updateIntegrationButton('google', connected.has('google'));
            this.updateIntegrationButton('vercel', connected.has('vercel'));
            this.updateIntegrationButton('supabase', connected.has('supabase'));
        } catch (error) {
            console.error('Error checking integration status:', error);
            this.updateIntegrationButton('github', false);
            this.updateIntegrationButton('google', false);
            this.updateIntegrationButton('vercel', false);
            this.updateIntegrationButton('supabase', false);
        }
    }


    updateIntegrationButton(provider, isConnected) {
        const button = this.elements[`connect${provider.charAt(0).toUpperCase() + provider.slice(1)}Btn`];
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

    async loadUserData() {
        const defaultData = {
            profile: { fullName: '', nickname: '', occupation: '' },
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
            const profileData = {
                profile: this.userData.profile,
                account: this.userData.account,
                lastUpdate: new Date().toISOString()
            };
            window.electron.fs.writeFileSync(profilePath, JSON.stringify(profileData, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving user data:', error);
            this.showNotification('Failed to save profile data', 'error');
        }
    }

    loadSavedData() {
        ['fullName', 'nickname', 'occupation'].forEach(field => {
            if (this.elements[field]) {
                this.elements[field].value = this.userData.profile[field] || '';
            }
        });
        
        if (this.elements.userEmail) {
            const user = this.authService?.getCurrentUser();
            if (user) {
                this.elements.userEmail.textContent = user.email;
                this.userData.account.email = user.email;
                
                if (this.elements.userName) {
                    const name = user.user_metadata?.name || user.name || 'User';
                    this.elements.userName.textContent = name;
                    this.userData.account.name = name;
                }
            } else {
                this.elements.userEmail.textContent = this.userData.account.email || 'user@example.com';
                if (this.elements.userName) {
                    this.elements.userName.textContent = this.userData.account.name || 'User Name';
                }
            }
        }
    }

    handleProfileSubmit() {
        this.userData.profile = {
            fullName: this.elements.fullName?.value || '',
            nickname: this.elements.nickname?.value || '',
            occupation: this.elements.occupation?.value || ''
        };
        this.saveUserData();
        this.showNotification('Profile saved successfully', 'success');
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
        if (!this.authService) {
            this.showNotification('Authentication service not available', 'error');
            return;
        }
        
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
            console.error('Login error:', error);
            this.elements.loginError.textContent = 'An unexpected error occurred';
        }
    }

    async handleSignup() {
        if (!this.authService) {
            this.showNotification('Authentication service not available', 'error');
            return;
        }
        
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
            const userName = name.trim();
            const result = await this.authService.signUp(email, password, userName);
            if (result.success) {
                this.elements.signupForm.reset();
                this.elements.signupError.textContent = '';
                this.showNotification('Account created successfully', 'success');
                this.switchAuthTab('login');
            } else {
                this.elements.signupError.textContent = result.error || 'Signup failed';
            }
        } catch (error) {
            console.error('Signup error:', error);
            this.elements.signupError.textContent = 'An unexpected error occurred';
        }
    }

    async handleLogout() {
        if (!this.authService) {
            this.showNotification('Authentication service not available', 'error');
            return;
        }
        
        if (confirm('Are you sure you want to log out?')) {
            try {
                const result = await this.authService.signOut();
                if (result.success) {
                    this.showNotification('Logged out successfully', 'success');
                    this.updateAvatar(null);
                } else {
                    this.showNotification('Logout failed: ' + result.error, 'error');
                }
            } catch (error) {
                console.error('Logout error:', error);
                this.showNotification('An unexpected error occurred during logout', 'error');
            }
        }
    }

    handleDeleteAccount() {
        if (confirm('Delete your account? This is irreversible!')) {
            try {
                ['profile.json', 'feedback.json'].forEach(file => {
                    const filePath = window.electron.path.join(this.userDataPath, file);
                    if (window.electron.fs.existsSync(filePath)) {
                        window.electron.fs.unlinkSync(filePath);
                    }
                });
                
                if (this.authService && this.authService.isAuthenticated()) {
                    this.authService.signOut();
                }
                
                this.userData = this.loadUserData();
                this.loadSavedData();
                this.showNotification('Account deleted successfully', 'success');
            } catch (error) {
                console.error('Error deleting account:', error);
                this.showNotification('Failed to delete account', 'error');
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

        if (fileExtension !== '.txt') {
            this.createImagePreview(file);
        }

        try {
            const uploadPath = window.electron.path.join(this.userDataPath, 'uploads.json');
            const uploads = window.electron.fs.existsSync(uploadPath)
                ? JSON.parse(window.electron.fs.readFileSync(uploadPath, 'utf8'))
                : [];

            uploads.push({
                name: file.name,
                type: fileExtension,
                size: file.size,
                timestamp: new Date().toISOString()
            });

            window.electron.fs.writeFileSync(uploadPath, JSON.stringify(uploads, null, 2), 'utf8');
        } catch (error) {
            console.error('Error updating uploads:', error);
        }
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
            if (previewArea) {
                previewArea.replaceWith(previewContainer);
            } else {
                this.elements.screenshot.parentNode.appendChild(previewContainer);
            }
        };
        reader.readAsDataURL(file);
    }

    switchTab(tabName) {
        this.elements.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
        this.elements.tabContents.forEach(content => content.classList.toggle('active', content.id === `${tabName}-tab`));
        this.currentTab = tabName;
    }
    
    switchAuthTab(tabName) {
        this.elements.authTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.authTab === tabName);
        });
        
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
            const user = this.authService.getCurrentUser();
            if (this.elements.userEmail) this.elements.userEmail.textContent = user.email;
            if (this.elements.userName) this.elements.userName.textContent = user.user_metadata?.name || user.user_metadata?.full_name || 'User';
            
            this.checkIntegrationStatus();
        } else {
            this.updateIntegrationButton('github', false);
            this.updateIntegrationButton('google', false);
            this.updateIntegrationButton('vercel', false);
            this.updateIntegrationButton('supabase', false);
            this.updateAvatar(null);
        }
    }

    showWindow() {
        this.elements.window?.classList.remove('hidden');
        
        if (window.floatingWindowManager) {
            window.floatingWindowManager.onWindowOpen('aios-settings');
        }
    }

    hideWindow() {
        this.elements.window?.classList.add('hidden');
        
        if (window.floatingWindowManager) {
            window.floatingWindowManager.onWindowClose('aios-settings');
        }
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed; top: 20px; right: 20px; padding: 12px 24px;
            background-color: ${type === 'success' ? '#4CAF50' : '#f44336'}; color: white;
            border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 10000; opacity: 0; transition: opacity 0.3s;
        `;

        document.body.appendChild(notification);
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            setTimeout(() => {
                notification.style.opacity = '0';
                setTimeout(() => document.body.removeChild(notification), 300);
            }, 3000);
        });
    }
}

window.AIOS = new AIOS();