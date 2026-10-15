// Startup preflight reports configuration readiness without printing keys or URLs.
try {
    const config = require('./config');
    const missing = [];
    if (typeof config.supabase?.url !== 'string' || !config.supabase.url.trim()) missing.push('Supabase URL');
    if (typeof config.supabase?.anonKey !== 'string' || !config.supabase.anonKey.trim()) missing.push('Supabase publishable key');
    if (missing.length) throw new Error(`Missing ${missing.join(' and ')}. Supply js/runtime-config.json or SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.`);
    const url = new URL(config.supabase.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Supabase URL must use HTTP or HTTPS.');
    console.log('Desktop runtime configuration is ready.');
} catch (error) {
    console.error(error instanceof SyntaxError ? 'Runtime configuration could not be parsed. Check js/runtime-config.json.' : error.message);
    process.exitCode = 1;
}
