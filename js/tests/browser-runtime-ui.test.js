const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium']
    .find(file => file && fs.existsSync(file));

test('Browser UI supports status, takeover, tabs, save failures and both themes', { skip: !executablePath }, async t => {
    const styles = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
        .match(/href="css\/[^\"]+\.css"/g).map(match => match.slice(6, -1));
    const files = new Map(styles.map(file => [`/${file}`, fs.readFileSync(path.join(root, file))]));
    files.set('/js/aios.js', fs.readFileSync(path.join(root, 'js/aios.js')));
    const shell = fs.readFileSync(path.join(root, 'aios.html'), 'utf8');
    const server = http.createServer((request, response) => {
        if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">${styles.map(file => `<link rel="stylesheet" href="/${file}">`).join('')}</head><body class="dark-mode">${shell}<script src="/js/aios.js"></script></body></html>`);
        } else if (files.has(request.url)) {
            response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css');
            response.end(files.get(request.url));
        } else { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
        window.preferences = { visibility: 'background', typingSpeed: 'fast', idleCloseMinutes: 15, keepSignedIn: true, blockedDomains: [] };
        window.runtime = { success: true, state: 'stopped', connected: false, busy: false, control: 'agent', mode: null, tabs: [], activity: [] };
        window.actions = [];
        window.runtimeReads = 0;
        window.failSave = false;
        window.electron = { ipcRenderer: { on: () => {}, send: () => {}, invoke: async (channel, payload) => {
            if (channel === 'browser-settings:get') return { ...window.preferences };
            if (channel === 'browser-settings:set') {
                if (window.failSave) throw new Error('Fixture disk failure');
                Object.assign(window.preferences, payload);
                return { ...window.preferences };
            }
            if (channel !== 'browser-data') return {};
            if (payload.action === 'runtime') {
                window.runtimeReads++;
                return structuredClone({ ...window.runtime, preferredMode: window.preferences.visibility });
            }
            window.actions.push(payload);
            if (payload.action === 'open') Object.assign(window.runtime, { connected: true, state: 'connected', mode: 'visible', control: 'manual' });
            if (payload.action === 'pause') window.runtime.control = 'manual';
            if (payload.action === 'resume') window.runtime.control = 'agent';
            if (payload.action === 'takeControl') {
                window.runtime.control = 'manual';
                if (window.runtime.mode === 'headless') return { success: false, requiresRestart: true, error: 'Headless mode needs a visible restart.' };
            }
            if (payload.action === 'restart') Object.assign(window.runtime, { mode: payload.visible ? 'visible' : window.preferences.visibility, control: 'manual' });
            if (payload.action === 'closeTab') window.runtime.tabs = window.runtime.tabs.filter(tab => tab.id !== payload.id);
            if (payload.action === 'listSites') return { success: true, sites: [] };
            return { success: true };
        } } };
        window.AIOS.injectSettingsTab();
        window.AIOS.cacheElements();
        window.AIOS.setupEventListeners();
        document.getElementById('floating-window').classList.remove('hidden');
        window.AIOS.switchTab('browser');
    });
    await page.waitForFunction(() => document.getElementById('browser-runtime-state').textContent === 'Not running');
    assert.deepEqual(await page.evaluate(() => window.actions), []);
    await page.click('#browser-runtime-open');
    await page.waitForFunction(() => document.getElementById('browser-runtime-state').textContent === 'You have control');
    await page.click('[data-browser-action="resume"]');
    await page.waitForFunction(() => document.getElementById('browser-runtime-state').textContent === 'Ready for the agent');

    await page.click('#browser-mode-options label:has(input[value="headless"])');
    await page.waitForFunction(() => window.preferences.visibility === 'headless');
    assert.equal(await page.evaluate(() => window.runtime.mode), 'visible');
    await page.evaluate(() => { window.failSave = true; });
    await page.click('#browser-mode-options label:has(input[value="visible"])');
    await page.waitForFunction(() => document.getElementById('settings-browser-visibility-status').textContent.includes('Could not save'));
    assert.equal(await page.$eval('input[name="browser-window-mode"]:checked', input => input.value), 'headless');
    await page.evaluate(() => { window.failSave = false; });
    await page.focus('input[name="browser-window-mode"][value="headless"]');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => window.preferences.visibility === 'background');

    await page.evaluate(() => {
        Object.assign(window.runtime, { mode: 'headless', control: 'agent',
            tabs: [{ id: '1', title: '<img src=x onerror=alert(1)> Draft', url: 'https://example.com/form?private=value', active: true },
                { id: '2', title: 'Documentation', url: 'https://example.org/docs', active: false }],
            activity: [{ action: 'navigate', at: Date.now(), status: 'completed' }] });
        window.AIOS._watchBrowserRuntime();
    });
    await page.waitForFunction(() => document.getElementById('browser-tab-count').textContent === '2');
    await page.click('#browser-runtime-details summary');
    await page.waitForFunction(() => document.querySelector('.t-panel-slide').dataset.open === 'true');
    assert.equal(await page.$eval('#browser-runtime-tabs [data-browser-action="switchTab"]', button => button.disabled), true);
    assert.equal(await page.$eval('#browser-runtime-tabs', list => list.querySelector('img')), null);
    assert.ok(!(await page.$eval('#browser-runtime-tabs', list => list.textContent)).includes('private=value'));
    await page.click('[data-browser-action="takeControl"]');
    await page.waitForFunction(() => !document.getElementById('browser-runtime-confirm').hidden);
    assert.equal(await page.evaluate(() => window.actions.filter(action => action.action === 'restart').length), 0);
    await page.click('#browser-confirm-cancel');
    await page.click('#browser-runtime-tabs [data-browser-action="closeTab"][data-tab-id="1"]');
    await page.waitForFunction(() => window.runtime.tabs.length === 1);
    assert.equal(await page.$eval('#browser-runtime-tabs [data-browser-action="closeTab"]', button => button.disabled), true);
    await page.click('[data-browser-action="takeControl"]');
    await page.waitForFunction(() => !document.getElementById('browser-runtime-confirm').hidden);
    await page.click('#browser-confirm-accept');
    await page.waitForFunction(() => window.runtime.mode === 'visible' && !window.AIOS._browserRuntimeBusy);
    assert.equal(await page.evaluate(() => window.actions.filter(action => action.action === 'restart').length), 1);

    const screenshotDir = path.join(root, '.ui-check');
    fs.mkdirSync(screenshotDir, { recursive: true });
    for (const theme of ['dark', 'light']) {
        for (const width of [1280, 768, 390]) {
            await page.setViewport({ width, height: 900 });
            await page.evaluate(theme => {
                document.body.classList.toggle('dark-mode', theme === 'dark');
                document.querySelector('.tab-content-area').scrollTop = 0;
            }, theme);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            const primary = await page.$eval('#browser-runtime-open', button => {
                const style = getComputedStyle(button);
                return { color: style.color, background: style.backgroundColor };
            });
            assert.notEqual(primary.background, 'rgba(0, 0, 0, 0)');
            assert.notEqual(primary.color, primary.background);
            await page.screenshot({ path: path.join(screenshotDir, `browser-runtime-${theme}-${width}.png`) });
        }
    }
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await page.$eval('.t-panel-slide', panel => getComputedStyle(panel).transitionDuration), '0s');
    await page.evaluate(() => window.AIOS.switchTab('appearance'));
    const reads = await page.evaluate(() => window.runtimeReads);
    await page.waitForFunction(() => window.AIOS.currentTab === 'appearance');
    await new Promise(resolve => setTimeout(resolve, 2200));
    assert.equal(await page.evaluate(() => window.runtimeReads), reads);
    assert.deepEqual(errors, []);
});
