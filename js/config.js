/**
 * Configuration for the AI-OS application
 */
const config = {
    // Backend connection settings
    backend: {
        // URL for the Python backend running in Docker
        url: 'https://api.aetheriaai.website',

        // Maximum number of reconnection attempts
        maxReconnectAttempts: 50,

        // Delay between reconnection attempts (in milliseconds)
        reconnectDelay: 20000,

        // Connection timeout (in milliseconds)
        connectionTimeout: 20000
    },

    // Supabase configuration
    supabase: {
        // Supabase project URL
        url: 'https://gugmnnmjhqdtjwriaywa.supabase.co',

        // Supabase anonymous key
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1Z21ubm1qaHFkdGp3cmlheXdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzEyOTksImV4cCI6MjA5NTMwNzI5OX0.uVHpeoyla5u-LMrj4_NXX6FzYnsK2oY9rT28TH0ATjY'
    }
};

module.exports = config; 
