// auth-service.js (Complete, with the new setSession method)

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

class AuthService {
    constructor() {
        this.supabase = null;
        this.user = null;
        this.listeners = [];
        this.initPromise = null;
        this.storage = null;
    }

    /**
     * Session storage for the Supabase client (see secure-store.js). Must be
     * set before init(); without it Supabase uses localStorage as before.
     */
    setStorage(storage) {
        if (this.supabase) {
            console.warn('AuthService: storage must be set before init(); ignoring.');
            return;
        }
        this.storage = storage || null;
    }

    async init() {
        if (this.supabase) {
            return true;
        }
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this._initClient();
        const initialized = await this.initPromise;
        if (!initialized) {
            this.initPromise = null;
        }
        return initialized;
    }

    async _initClient() {
        try {
            this.supabase = createClient(
                config.supabase.url,
                config.supabase.anonKey,
                this.storage ? { auth: { storage: this.storage } } : undefined
            );

            const { data } = await this.supabase.auth.getSession();
            if (data.session) {
                this.user = data.session.user;
                this._notifyListeners();
            }

            this.supabase.auth.onAuthStateChange((event, session) => {
                console.log('Auth state changed:', event);
                this.user = session?.user || null;
                this._notifyListeners();
            });

            return true;
        } catch (error) {
            console.error('Failed to initialize auth service:', error);
            return false;
        }
    }

    async ensureInitialized() {
        if (this.supabase) {
            return true;
        }
        return await this.init();
    }

    onAuthChange(callback) {
        this.listeners.push(callback);
        if (callback && typeof callback === 'function') {
            callback(this.user);
        }
        return () => {
            this.listeners = this.listeners.filter(listener => listener !== callback);
        };
    }

    _notifyListeners() {
        this.listeners.forEach(listener => {
            if (listener && typeof listener === 'function') {
                listener(this.user);
            }
        });
    }

    normalizePhoneNumber(phoneNumber) {
        const rawPhoneNumber = typeof phoneNumber === 'string' ? phoneNumber.trim() : '';
        const normalizedPhoneNumber = rawPhoneNumber.replace(/[\s().-]/g, '');

        if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhoneNumber)) {
            throw new Error('Enter a valid mobile number with country code, for example +919876543210.');
        }

        return normalizedPhoneNumber;
    }

    async signUp(email, password, name, phoneNumber) {
        try {
            await this.ensureInitialized();
            const processedName = typeof name === 'string' ? name.trim() : '';
            const processedPhoneNumber = this.normalizePhoneNumber(phoneNumber);
            const { data, error } = await this.supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        name: processedName,
                        phone_number: processedPhoneNumber
                    }
                }
            });

            if (error) {
                return { success: false, error: error.message };
            }

            // Profile is now automatically created by database trigger
            // No need to manually insert into profiles table

            return { success: true, data };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async signIn(email, password) {
        try {
            await this.ensureInitialized();
            const { data, error } = await this.supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) throw error;

            const signedInUser = data.session?.user || data.user || null;
            if (signedInUser) {
                this.user = signedInUser;

                if (!this.user.user_metadata?.name) {
                    try {
                        const { data: profileData, error: profileError } = await this.supabase
                            .from('profiles')
                            .select('name')
                            .eq('id', this.user.id)
                            .single();

                        if (profileData && profileData.name) {
                            this.user.user_metadata = this.user.user_metadata || {};
                            this.user.user_metadata.name = profileData.name;
                        }
                    } catch (profileFetchError) {
                        console.error('Failed to fetch profile during sign-in:', profileFetchError);
                    }
                }

                this._notifyListeners();
            }

            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async signInWithGoogle() {
        try {
            await this.ensureInitialized();
            const { data, error } = await this.supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: 'aios://auth-callback',
                    skipBrowserRedirect: true
                }
            });

            if (error) {
                throw error;
            }

            return { success: true, url: data.url };
        } catch (error) {
            console.error('Google Sign-In URL generation error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Extract title from runs array by getting first user message
     * @param {Array} runs - The runs array from session data
     * @returns {string|null} First 3-4 words from user's first message
     */
    extractTitleFromRuns(runs) {
        if (!runs || !Array.isArray(runs) || runs.length === 0) {
            return null;
        }

        // Find the first run with user input
        const firstRun = runs.find(run => run.input && run.input.input_content);
        
        if (!firstRun || !firstRun.input || !firstRun.input.input_content) {
            return null;
        }

        const userMessage = firstRun.input.input_content.trim();
        
        // Extract first 3-4 words
        const words = userMessage.split(/\s+/).slice(0, 4);
        let title = words.join(' ');
        
        // Truncate to 60 characters if needed
        if (title.length > 60) {
            title = title.substring(0, 60) + '...';
        }
        
        return title || null;
    }

    /**
     * Fetch session titles only (lightweight) for displaying the session list
     * This is optimized to fetch only metadata without heavy runs data
     */
    async fetchSessionTitles(limit = 15, offset = 0) {
        const session = await this.getSession();
        if (!session?.access_token) throw new Error('Sign in to load your conversations.');
        const response = await fetch(`${config.backend.url}/api/sessions?limit=${limit}&offset=${offset}`, {
            headers: { Authorization: `Bearer ${session.access_token}` }
        });
        if (!response.ok) throw new Error('Could not load conversations.');
        return await response.json();
    }

    async fetchSessionAttachments(sessionId) {
        if (!await this.ensureInitialized()) {
            throw new Error('Supabase client not initialized.');
        }

        const session = await this.getSession();
        const userId = this.user?.id || session?.user?.id;

        if (!userId) {
            throw new Error('User not authenticated.');
        }

        const { data, error } = await this.supabase
            .from('attachment')
            .select('metadata')
            .eq('session_id', sessionId)
            .eq('user_id', userId);

        if (error) {
            console.error('Error fetching session attachments:', error);
            throw new Error(error.message || 'Failed to fetch attachments.');
        }

        return (data || []).map(row => row.metadata);
    }

    /**
     * Fetch full session data including runs for a specific session
     * This is called when user clicks on a session to view details
     */
    async fetchSessionData(sessionId) {
        if (!await this.ensureInitialized()) {
            throw new Error('Supabase client not initialized.');
        }

        const session = await this.getSession();
        const userId = this.user?.id || session?.user?.id;

        if (!userId) {
            throw new Error('User not authenticated.');
        }

        const response = await fetch(`${config.backend.url}/api/sessions/${encodeURIComponent(sessionId)}/history`, {
            headers: { Authorization: `Bearer ${session.access_token}` }
        });
        if (!response.ok) throw new Error('Could not load conversation history.');
        const sessionData = await response.json();

        return sessionData;
    }

    async renameSessionTitle(sessionId, newTitle) {
        const title = String(newTitle || '').trim();
        if (!title || title.length > 120) throw new Error('Enter a title of up to 120 characters.');
        const session = await this.getSession();
        if (!session?.access_token) throw new Error('Sign in to rename this conversation.');
        const response = await fetch(`${config.backend.url}/api/sessions/${encodeURIComponent(sessionId)}/title`, {
            method: 'PUT', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        if (!response.ok) throw new Error('Could not rename conversation.');
        return true;
    }

    async deleteSession(sessionId) {
        const session = await this.getSession();
        if (!session?.access_token) throw new Error('Sign in to delete this conversation.');
        const response = await fetch(`${config.backend.url}/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` }
        });
        if (!response.ok) throw new Error('Could not delete conversation.');
        return true;
    }

    /**
     * Legacy method - kept for backward compatibility
     * Now uses the optimized fetchSessionTitles internally
     */
    async fetchUserSessions(limit = 15) {
        return await this.fetchSessionTitles(limit);
    }

    async setSession(accessToken, refreshToken) {
        try {
            await this.ensureInitialized();
            const { data, error } = await this.supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
            });

            if (error) {
                console.error('Error setting session in auth service:', error);
                return { success: false, error: error.message };
            }

            // The onAuthStateChange listener will now fire with the correct user data
            // and the state will be a persistent SIGNED_IN.
            this.user = data.session?.user || data.user || null;
            if (this.user) {
                this._notifyListeners();
            }
            console.log('Session successfully set in auth service.');
            return { success: true, data };
        } catch (error) {
            console.error('Catch block error setting session:', error);
            return { success: false, error: error.message };
        }
    }

    async signOut() {
        try {
            await this.ensureInitialized();
            const { error } = await this.supabase.auth.signOut();
            if (error) throw error;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async fetchRequestUsage() {
        const session = await this.getSession();
        const accessToken = session?.access_token;
        if (!accessToken) {
            throw new Error('User not authenticated.');
        }

        const response = await fetch(`${config.backend.url}/api/subscription/status`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || 'Failed to fetch usage data.');
        }
        if (String(payload?.summary?.usage_source || '').toLowerCase() !== 'convex_window') {
            throw new Error('Usage source is not Convex.');
        }

        return payload?.summary?.usage || null;
    }

    getCurrentUser() {
        return this.user;
    }

    isAuthenticated() {
        return !!this.user;
    }

    async getSession() {
        try {
            const initialized = await this.ensureInitialized();
            if (!initialized || !this.supabase) {
                return null;
            }

            const { data, error } = await this.supabase.auth.getSession();
            if (error) {
                console.error('Error getting session:', error.message);
                return null;
            }
            return data.session;
        } catch (error) {
            console.error('Failed to get session:', error.message);
            return null;
        }
    }
}

const authService = new AuthService();
module.exports = authService;
