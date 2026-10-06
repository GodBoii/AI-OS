/**
 * Configuration for the AI-OS application
 */
const fs = require('fs');
const path = require('path');
const settingsPath = path.join(__dirname, 'runtime-config.json');
const runtimeSettings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
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

    // Public client settings are supplied locally and packaged with the app.
    supabase: runtimeSettings.supabase || {
        url: process.env.SUPABASE_URL || '',
        anonKey: process.env.SUPABASE_PUBLISHABLE_KEY || ''
    }

};

module.exports = config; 
