/**
 * auth-gate.js
 *
 * Intercepts the application on launch. If the user is not authenticated,
 * a full-screen split-layout login/signup screen is rendered. Once the user
 * logs in or signs up, the gate fades out and the main app becomes interactive.
 *
 * Architecture:
 *  - Injects HTML + CSS overlay into the DOM immediately.
 *  - Uses window.electron.auth (exposed via preload.js) for auth operations.
 *  - Listens for auth state changes via authService.onAuthChange.
 *  - Emits a custom event 'auth-gate:authenticated' when session is confirmed.
 */

(function AuthGate() {
    'use strict';

    // ─── Constants ──────────────────────────────────────────────────────
    const GATE_ID = 'auth-gate';

    // ─── State ──────────────────────────────────────────────────────────
    let _authService = null;
    let _gateEl = null;
    let _activeTab = 'login'; // 'login' | 'signup'
    let _isSubmitting = false;
    let _dismissed = false;

    // ─── Inject CSS link (backup in case not loaded via index.html) ──────
    function _ensureCSS() {
        if (document.getElementById('auth-gate-css')) return;
        const link = document.createElement('link');
        link.id = 'auth-gate-css';
        link.rel = 'stylesheet';
        link.href = 'css/auth-gate.css';
        document.head.prepend(link);
    }

    // ─── Build DOM ───────────────────────────────────────────────────────
    function _buildGate() {
        const el = document.createElement('div');
        el.id = GATE_ID;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-label', 'Authentication required');
        el.innerHTML = `
            <!-- ── Loading state: shown while auth check runs ──────── -->
            <div class="auth-checking-state" id="auth-checking">
                <div class="auth-spinner"></div>
                <div class="auth-checking-text">Checking session…</div>
            </div>

            <!-- 1. Global Full-Screen Background -->
            <div class="auth-global-bg">
                <div class="auth-nebula-bg"></div>
                <div class="auth-stars"></div>
                <div class="auth-glow-orb orb-1"></div>
                <div class="auth-glow-orb orb-2"></div>
                <div class="auth-glow-orb orb-3"></div>
                <div class="auth-noise-overlay"></div>
            </div>

            <!-- 2. Transparent Split Layout overlaying the background -->
            <div class="auth-split-layout" id="auth-split-layout" style="opacity:0;transition:opacity 400ms ease;display:none;">
                
                <!-- Left Pane: Branding -->
                <section class="auth-illustration-pane" aria-label="Aetheria AI">
                    <div class="auth-branding">
                        <div class="auth-top-logo">
                            <img src="assets/icon.png" alt="Aetheria AI" class="auth-small-logo">
                            <span>Aetheria AI</span>
                        </div>
                        <h1 class="auth-hero-title">ELEVATE YOURSELF WITH<br><span class="auth-highlight">AETHERIA AI</span></h1>
                    </div>
                </section>

                <!-- Right Pane: Glassmorphism Form -->
                <section class="auth-form-pane" aria-label="Authentication">
                    <div class="auth-glass-card" data-mode="login">
                        <div class="auth-header">
                            <h2 id="auth-dynamic-title">Welcome back</h2>
                            <p id="auth-dynamic-subtitle">Access your workspace.</p>
                        </div>
                        
                        <!-- Tab switcher (Hidden but functional) -->
                        <div class="auth-tabs" role="tablist" style="display:none;">
                            <button class="auth-tab-btn active" role="tab" aria-selected="true"
                                    id="auth-tab-login" aria-controls="auth-panel-login">Sign in</button>
                            <button class="auth-tab-btn" role="tab" aria-selected="false"
                                    id="auth-tab-signup" aria-controls="auth-panel-signup">Sign up</button>
                        </div>

                        <!-- ── Login form ──────────────────────────────────── -->
                        <form class="auth-form-panel active" id="auth-panel-login" role="tabpanel" aria-labelledby="auth-tab-login" novalidate>
                            <div class="auth-input-group">
                                <label for="auth-login-email">Email</label>
                                <input type="email" id="auth-login-email" placeholder="you@example.com" autocomplete="email" required>
                            </div>

                            <div class="auth-input-group">
                                <label for="auth-login-password">Password</label>
                                <input type="password" id="auth-login-password" placeholder="Enter your password" autocomplete="current-password" required>
                            </div>

                            <div class="auth-error" id="auth-login-error" role="alert"></div>

                            <button type="submit" class="auth-btn auth-btn-primary" id="auth-login-submit">Sign in</button>
                            
                            <div class="auth-divider">or continue with</div>
                            <button type="button" class="auth-btn auth-btn-google" id="auth-google-signin">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                </svg>
                                <span>Google</span>
                            </button>
                        </form>

                        <!-- ── Sign Up form ────────────────────────────────── -->
                        <form class="auth-form-panel" id="auth-panel-signup" role="tabpanel" aria-labelledby="auth-tab-signup" novalidate>
                            <div class="auth-input-group">
                                <label for="auth-signup-name">Full Name</label>
                                <input type="text" id="auth-signup-name" placeholder="Your full name" autocomplete="name" required>
                            </div>

                            <div class="auth-input-group">
                                <label for="auth-signup-email">Email</label>
                                <input type="email" id="auth-signup-email" placeholder="you@example.com" autocomplete="email" required>
                            </div>

                            <div class="auth-input-group">
                                <label for="auth-signup-phone">Mobile Number</label>
                                <input type="tel" id="auth-signup-phone" placeholder="+91 98765 43210" autocomplete="tel" inputmode="tel" required>
                            </div>

                            <div class="auth-input-group">
                                <label for="auth-signup-password">Password</label>
                                <input type="password" id="auth-signup-password" placeholder="Min. 6 characters" autocomplete="new-password" required>
                            </div>

                            <div class="auth-error" id="auth-signup-error" role="alert"></div>

                            <button type="submit" class="auth-btn auth-btn-primary" id="auth-signup-submit">Sign up</button>
                        </form>

                        <div class="auth-footer" id="auth-login-footer">
                            <span>Don't have an account?</span>
                            <button type="button" onclick="document.getElementById('auth-tab-signup').click()">Sign up</button>
                        </div>
                    </div>
                </section>
            </div>
        `;
        return el;
    }

    // ─── Utility: show/hide error ─────────────────────────────────────────
    function _setError(id, msg) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = msg || '';
        el.classList.toggle('visible', !!msg);
    }

    function _clearErrors() {
        _setError('auth-login-error', '');
        _setError('auth-signup-error', '');
    }

    function _getFocusableGateElements() {
        if (!_gateEl) return [];
        return Array.from(
            _gateEl.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
        ).filter((el) => {
            if (el.closest('.auth-checking-state:not(.hidden)')) return false;
            if (el.closest('.auth-form-panel:not(.active)')) return false;
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        });
    }

    // ─── Tab switching ─────────────────────────────────────────────────────
    function _switchTab(tab) {
        _activeTab = tab;
        _clearErrors();

        const loginPanel  = document.getElementById('auth-panel-login');
        const signupPanel = document.getElementById('auth-panel-signup');
        const loginTab    = document.getElementById('auth-tab-login');
        const signupTab   = document.getElementById('auth-tab-signup');
        
        const titleEl     = document.getElementById('auth-dynamic-title');
        const footerEl    = document.getElementById('auth-login-footer');

        const isLogin = (tab === 'login');

        loginPanel?.classList.toggle('active', isLogin);
        signupPanel?.classList.toggle('active', !isLogin);
        loginTab?.classList.toggle('active', isLogin);
        signupTab?.classList.toggle('active', !isLogin);
        loginTab?.setAttribute('aria-selected', String(isLogin));
        signupTab?.setAttribute('aria-selected', String(!isLogin));
        
        if (titleEl && footerEl) {
            titleEl.textContent = isLogin ? 'Welcome back' : 'Create Account';
            if (isLogin) {
                footerEl.innerHTML = `<span>Don't have an account?</span> <button type="button" onclick="document.getElementById('auth-tab-signup').click()">Sign up</button>`;
            } else {
                footerEl.innerHTML = `<span>Already have an account?</span> <button type="button" onclick="document.getElementById('auth-tab-login').click()">Sign in</button>`;
            }
        }

        // Focus first input of the active form
        setTimeout(() => {
            const firstInput = document.querySelector(
                isLogin ? '#auth-panel-login input:first-of-type'
                        : '#auth-panel-signup input:first-of-type'
            );
            firstInput?.focus();
        }, 80);
    }

    // ─── Set loading state on submit button ───────────────────────────────
    function _setLoading(btnId, loading, label = '') {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.classList.toggle('loading', loading);
        if (loading) {
            btn.dataset.origText = btn.textContent;
            btn.textContent = label || 'Please wait…';
        } else {
            btn.textContent = btn.dataset.origText || btn.textContent;
        }
    }

    // ─── Dismiss gate (animate out → hide) ──────────────────────────────
    function _dismiss() {
        if (_dismissed) return;
        _dismissed = true;
        const gate = document.getElementById(GATE_ID);
        if (!gate) return;

        gate.classList.add('is-exiting');
        gate.addEventListener('transitionend', () => {
            gate.classList.add('is-hidden');
            gate.remove(); // Remove from DOM entirely
        }, { once: true });

        // Fallback removal
        setTimeout(() => {
            gate?.remove();
        }, 700);

        // Notify the rest of the app
        window.dispatchEvent(new CustomEvent('auth-gate:authenticated'));
    }

    // ─── Check initial session ─────────────────────────────────────────
    async function _checkInitialSession() {
        try {
            const session = await _authService.getSession();
            if (session && session.user) {
                // Already authenticated — dismiss immediately
                _dismiss();
                return;
            }
        } catch (err) {
            console.warn('[AuthGate] Session check failed:', err);
        }

        // Not authenticated — reveal the glass card
        const checkingEl = document.getElementById('auth-checking');
        const formPanel  = document.getElementById('auth-split-layout');

        if (checkingEl) {
            checkingEl.style.opacity = '0';
            checkingEl.style.pointerEvents = 'none';
            setTimeout(() => checkingEl.classList.add('hidden'), 350);
        }
        if (formPanel) {
            // Step 1: make it block so layout starts
            formPanel.style.display = 'flex';
            formPanel.style.pointerEvents = 'auto';
            // Step 2: transition opacity in after one frame
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    formPanel.style.opacity = '1';
                    _getFocusableGateElements()[0]?.focus();
                });
            });
        }
    }

    // ─── Handle Login submit ──────────────────────────────────────────────
    async function _handleLogin(e) {
        e.preventDefault();
        if (_isSubmitting) return;
        _clearErrors();

        const email    = document.getElementById('auth-login-email')?.value?.trim();
        const password = document.getElementById('auth-login-password')?.value;

        if (!email || !password) {
            _setError('auth-login-error', 'Please enter both email and password.');
            return;
        }

        _isSubmitting = true;
        _setLoading('auth-login-submit', true, 'Signing in…');

        try {
            const result = await _authService.signIn(email, password);
            if (result.success) {
                _dismiss();
            } else {
                _setError('auth-login-error', result.error || 'Login failed. Please try again.');
            }
        } catch (err) {
            _setError('auth-login-error', 'An unexpected error occurred. Please try again.');
            console.error('[AuthGate] Login error:', err);
        } finally {
            _isSubmitting = false;
            _setLoading('auth-login-submit', false);
        }
    }

    // ─── Handle Sign Up submit ────────────────────────────────────────────
    async function _handleSignup(e) {
        e.preventDefault();
        if (_isSubmitting) return;
        _clearErrors();

        const name     = document.getElementById('auth-signup-name')?.value?.trim();
        const email    = document.getElementById('auth-signup-email')?.value?.trim();
        const phone    = document.getElementById('auth-signup-phone')?.value?.trim();
        const password = document.getElementById('auth-signup-password')?.value;

        if (!name || !email || !phone || !password) {
            _setError('auth-signup-error', 'All fields are required.');
            return;
        }
        if (!/^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s().-]/g, ''))) {
            _setError('auth-signup-error', 'Enter a valid mobile number with country code, for example +919876543210.');
            return;
        }
        if (password.length < 6) {
            _setError('auth-signup-error', 'Password must be at least 6 characters.');
            return;
        }

        _isSubmitting = true;
        _setLoading('auth-signup-submit', true, 'Creating account…');

        try {
            const result = await _authService.signUp(email, password, name, phone);
            if (result.success) {
                _setError('auth-signup-error', '');
                // Show a soft success message and switch to login
                _setError('auth-login-error', '');
                _switchTab('login');
                // Display success as info in login panel
                const loginErrEl = document.getElementById('auth-login-error');
                if (loginErrEl) {
                    loginErrEl.textContent = '✓ Account created! Check your email to verify, then log in.';
                    loginErrEl.style.color = '#34d399';
                    loginErrEl.classList.add('visible');
                }
            } else {
                _setError('auth-signup-error', result.error || 'Sign up failed. Please try again.');
            }
        } catch (err) {
            _setError('auth-signup-error', 'An unexpected error occurred. Please try again.');
            console.error('[AuthGate] Signup error:', err);
        } finally {
            _isSubmitting = false;
            _setLoading('auth-signup-submit', false);
        }
    }

    // ─── Handle Google Sign-In ────────────────────────────────────────────
    async function _handleGoogleSignIn() {
        if (_isSubmitting) return;
        _clearErrors();
        _isSubmitting = true;

        try {
            const result = await _authService.signInWithGoogle();
            if (result.success && result.url) {
                await window.electron.shell.openExternal(result.url);
                // The auth-state-changed IPC event will fire from main.js
                // when the user completes the OAuth flow. We listen for it here too.
            } else {
                _setError('auth-login-error', result.error || 'Could not start Google Sign-In.');
            }
        } catch (err) {
            _setError('auth-login-error', 'Google Sign-In failed. Please try again.');
            console.error('[AuthGate] Google sign-in error:', err);
        } finally {
            _isSubmitting = false;
        }
    }

    // ─── Listen for deep-link OAuth callback ─────────────────────────────
    function _listenForOAuthCallback() {
        // The main process sends 'auth-state-changed' after deep-link redirect
        window.electron?.ipcRenderer?.on('auth-state-changed', async (data) => {
            try {
                const url  = new URL(data.url);
                const hash = new URLSearchParams(url.hash.substring(1));
                const accessToken  = hash.get('access_token');
                const refreshToken = hash.get('refresh_token');
                if (accessToken && refreshToken) {
                    await _authService.setSession(accessToken, refreshToken);
                    // onAuthChange will fire → _dismiss() is called
                }
            } catch (err) {
                console.error('[AuthGate] OAuth callback error:', err);
            }
        });
    }

    // ─── Bind all events ─────────────────────────────────────────────────
    function _bindEvents() {
        // Tab buttons
        document.getElementById('auth-tab-login')?.addEventListener('click', () => _switchTab('login'));
        document.getElementById('auth-tab-signup')?.addEventListener('click', () => _switchTab('signup'));

        // Login form
        document.getElementById('auth-panel-login')?.addEventListener('submit', _handleLogin);

        // Signup form
        document.getElementById('auth-panel-signup')?.addEventListener('submit', _handleSignup);

        // Google btn
        document.getElementById('auth-google-signin')?.addEventListener('click', _handleGoogleSignIn);

        // Listen for auth change to auto-dismiss (e.g. via OAuth flow)
        _authService.onAuthChange((user) => {
            if (user && !_dismissed) {
                _dismiss();
            }
        });

        // Keyboard: focus trap within gate
        _gateEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                _getFocusableGateElements()[0]?.focus();
                return;
            }

            if (e.key !== 'Tab') return;
            const focusable = _getFocusableGateElements();

            if (!focusable.length) return;
            const first = focusable[0];
            const last  = focusable[focusable.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        });
    }

    // ─── Public init ─────────────────────────────────────────────────────
    async function init() {
        // Auth service is exposed via preload.js contextBridge
        if (!window.electron?.auth) {
            console.warn('[AuthGate] window.electron.auth not available — skipping gate.');
            return;
        }

        _authService = window.electron.auth;

        // Initialize Supabase client
        try {
            await _authService.init();
        } catch (err) {
            console.warn('[AuthGate] Auth init failed:', err);
        }

        _ensureCSS();

        _gateEl = _buildGate();
        document.body.appendChild(_gateEl);

        _bindEvents();
        _listenForOAuthCallback();

        // Check if user is already logged in
        await _checkInitialSession();
    }

    // ─── Reinit (call after logout to show gate again) ────────────────────
    async function reinit() {
        // Reset dismissed state
        _dismissed = false;
        _isSubmitting = false;
        _activeTab = 'login';
        window._authGateAuthenticated = false;

        // Remove any existing gate
        const existing = document.getElementById(GATE_ID);
        if (existing) existing.remove();

        // Build fresh gate
        _ensureCSS();
        _gateEl = _buildGate();
        document.body.appendChild(_gateEl);

        _bindEvents();

        // Show form panel directly (we know the user is logged out)
        const checkingEl = document.getElementById('auth-checking');
        const formPanel  = document.getElementById('auth-split-layout');
        if (checkingEl) {
            checkingEl.style.opacity = '0';
            checkingEl.style.pointerEvents = 'none';
            setTimeout(() => checkingEl.classList.add('hidden'), 300);
        }
        if (formPanel) {
            formPanel.style.display = 'flex';
            formPanel.style.pointerEvents = 'auto';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    formPanel.style.opacity = '1';
                    _getFocusableGateElements()[0]?.focus();
                });
            });
        }

        // Re-register listener so renderer.js can proceed after re-login
        window.addEventListener('auth-gate:authenticated', () => {
            window._authGateAuthenticated = true;
            // Re-init AIOS auth UI
            window.AIOS?.loadSavedData?.();
            window.AIOS?.updateAuthUI?.();
        }, { once: true });
    }

    // Expose minimal API for external use
    window.AuthGate = { init, dismiss: _dismiss, reinit };

    // Auto-run on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
