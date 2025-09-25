// auth-service.js (Verified Correct Version)

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

class AuthService {
    constructor() {
        this.supabase = null;
        this.user = null;
        this.listeners = [];
    }

    async init() {
        try {
            this.supabase = createClient(
                config.supabase.url,
                config.supabase.anonKey
            );
            
            const { data } = await this.supabase.auth.getSession();
            if (data.session) {
                this.user = data.session.user;
                this._notifyListeners();
            }
            
            this.supabase.auth.onAuthStateChange((event, session) => {
                console.log('Auth state changed:', event);
                this.user = session?.user || null;
                if (this.user) {
                    console.log('User metadata:', this.user.user_metadata);
                }
                this._notifyListeners();
            });
            
            return true;
        } catch (error) {
            console.error('Failed to initialize auth service:', error);
            return false;
        }
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

    async signUp(email, password, name) {
        try {
            const processedName = typeof name === 'string' ? name.trim() : '';
            const { data, error } = await this.supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        name: processedName
                    }
                }
            });
        
            if (error) {
                return { success: false, error: error.message };
            }
        
            if (data.user) {
                const { error: profileError } = await this.supabase
                    .from('profiles')
                    .insert({ 
                        id: data.user.id,
                        email: data.user.email,
                        name: processedName 
                    });
        
                if (profileError) {
                    return { success: false, error: `User created, but profile could not be saved: ${profileError.message}` };
                }
            }
            
            return { success: true, data };
        
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async signIn(email, password) {
        try {
            const { data, error } = await this.supabase.auth.signInWithPassword({
                email: email,
                password: password
            });
            
            if (error) throw error;
            
            if (data.user) {
                if (!data.user.user_metadata?.name) {
                    try {
                        const { data: profileData, error: profileError } = await this.supabase
                            .from('profiles')
                            .select('name')
                            .eq('id', data.user.id)
                            .single();
                            
                        if (profileData && profileData.name) {
                            data.user.user_metadata = data.user.user_metadata || {};
                            data.user.user_metadata.name = profileData.name;
                            this.user = data.user;
                            this._notifyListeners();
                        }
                    } catch (profileFetchError) {
                        console.error('Failed to fetch profile during sign-in:', profileFetchError);
                    }
                }
            }
            
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Generates the Google Sign-In URL for the secure PKCE flow.
     * It does NOT navigate; it returns the URL for the renderer to open externally.
     */
    async signInWithGoogle() {
        try {
            const { data, error } = await this.supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    // This is the crucial instruction for Supabase to redirect back to our app protocol.
                    redirectTo: 'aios://auth-callback'
                }
            });

            if (error) {
                throw error;
            }

            // The 'data' object contains the URL that must be opened in the external browser.
            return { success: true, url: data.url };
        } catch (error) {
            console.error('Google Sign-In URL generation error:', error);
            return { success: false, error: error.message };
        }
    }

    async signOut() {
        try {
            const { error } = await this.supabase.auth.signOut();
            if (error) throw error;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    getCurrentUser() {
        return this.user;
    }

    isAuthenticated() {
        return !!this.user;
    }

    async getSession() {
        try {
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