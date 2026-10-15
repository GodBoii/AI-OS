const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

test('real Electron preload initializes auth and generates Google OAuth without a signed-in user', async t => {
    const browser = await puppeteer.launch({ executablePath: require('electron'), ignoreDefaultArgs: true,
        args: [path.join(__dirname, 'fixtures/auth-preload-electron.cjs'), '--remote-debugging-port=0'],
        env: { ...process.env, SUPABASE_URL: 'https://auth.example.test', SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key' } });
    t.after(() => browser.close());
    const page = (await browser.pages())[0];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (/supabaseUrl is required|Cannot read properties of null|Failed to initialize auth service/.test(message.text())) {
            errors.push(message.text());
        }
    });
    await page.waitForFunction(() => window.electron?.auth && window.AuthGate, { timeout: 15000 });
    const result = await page.evaluate(async () => {
        const initialized = await window.electron.auth.init();
        const session = await window.electron.auth.getSession();
        const first = await window.electron.auth.signInWithGoogle();
        const second = await window.electron.auth.signInWithGoogle();
        const url = first.success ? new URL(first.url) : null;
        return { initialized, signedIn: !!session, success: first.success && second.success,
            protocol: url?.protocol, path: url?.pathname, provider: url?.searchParams.get('provider'),
            callback: url?.searchParams.get('redirect_to'), error: first.error || second.error };
    });
    assert.equal(result.initialized, true);
    assert.equal(result.signedIn, false);
    assert.equal(result.success, true, result.error);
    assert.equal(result.protocol, 'https:');
    assert.equal(result.path, '/auth/v1/authorize');
    assert.equal(result.provider, 'google');
    assert.equal(result.callback, 'aios://auth-callback');
    assert.deepEqual(errors, []);
});
