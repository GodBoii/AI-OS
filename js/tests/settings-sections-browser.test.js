const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('settings sections preserve controls, saving, keyboard navigation and stationary hover', { skip: !executablePath }, async t => {
    const styles = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
        .match(/href="css\/[^\"]+\.css"/g).map(match => match.slice(6, -1));
    const files = new Map(styles.map(file => [`/${file}`, fs.readFileSync(path.join(root, file))]));
    files.set('/js/aios.js', fs.readFileSync(path.join(root, 'js/aios.js')));
    const shell = fs.readFileSync(path.join(root, 'aios.html'), 'utf8');
    const server = http.createServer((request, response) => {
        if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
                ${styles.map(file => `<link rel="stylesheet" href="/${file}">`).join('')}
                </head><body class="dark-mode">${shell}<script src="/js/aios.js"></script></body></html>`);
        } else if (files.has(request.url)) {
            response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css');
            response.end(files.get(request.url));
        } else {
            response.writeHead(404); response.end();
        }
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
        window.savedBrowser = { typingSpeed: 'fast', visibility: 'background', idleCloseMinutes: 15, blockedDomains: [], keepSignedIn: true };
        window.writes = [];
        window.electron = { ipcRenderer: {
            send: () => {},
            on: () => {},
            invoke: async (channel, patch) => {
                if (channel === 'browser-settings:set') {
                    window.writes.push(patch);
                    Object.assign(window.savedBrowser, patch);
                }
                return { ...window.savedBrowser };
            },
        } };
        localStorage.setItem('aetheria-general-settings', JSON.stringify({ followSystemTheme: true }));
        window.AIOS.injectSettingsTab();
        window.AIOS.cacheElements();
        window.AIOS.setupEventListeners();
        document.getElementById('floating-window').classList.remove('hidden');
    });
    const groups = {
        settings: ['settings-general-title', 'settings-typing-title'],
        appearance: ['settings-appearance-title'],
        browser: ['settings-browser-title', 'settings-sessions-title'],
        notifications: ['settings-notif-title'],
        shortcuts: ['settings-kb-title'],
        desktop: ['settings-desktop-title'],
    };
    for (const [tab, titles] of Object.entries(groups)) {
        await page.click(`.tab-btn[data-tab="${tab}"]`);
        assert.deepEqual(await page.$$eval('.settings-tab-panel.active section', cards => cards.map(card => card.getAttribute('aria-labelledby'))), titles);
        assert.equal(await page.$$eval('.tab-content.active', panels => panels.length), 1);
    }
    await page.focus('[data-tab="appearance"]');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#appearance-tab', panel => panel.classList.contains('active')), true);
    assert.equal(await page.$eval('#settings-appearance-follow-system', control => control.checked), true);
    await page.click('.aios-toggle:has(#settings-appearance-follow-system)');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('aetheria-general-settings')).followSystemTheme), false);
    await page.click('[data-tab="browser"]');
    await page.waitForSelector('#settings-browser-visibility:not([disabled])');
    await page.select('#settings-browser-visibility', 'headless');
    await page.waitForFunction(() => window.savedBrowser.visibility === 'headless');
    await page.click('[data-tab="appearance"]');
    await page.click('[data-tab="browser"]');
    assert.equal(await page.$eval('#settings-browser-visibility', control => control.value), 'headless');
    assert.equal(await page.evaluate(() => window.writes.length), 1);

    // Rebuilding the navigation must not duplicate or lose controls.
    await page.evaluate(() => window.AIOS.injectSettingsTab());
    assert.equal(await page.$$eval('.settings-tab-panel section', cards => cards.length), 8);
    assert.equal(await page.$$eval('#settings-browser-visibility', controls => controls.length), 1);
    const screenshotDir = path.join(root, '.ui-check');
    fs.mkdirSync(screenshotDir, { recursive: true });
    for (const theme of ['dark', 'light']) {
        for (const width of [1280, 390]) {
            await page.setViewport({ width, height: 900 });
            await page.evaluate(theme => document.body.classList.toggle('dark-mode', theme === 'dark'), theme);
            for (const tab of Object.keys(groups)) {
                await page.click(`[data-tab="${tab}"]`);
                const selector = `#${tab}-tab .settings-card`;
                await page.mouse.move(0, 0);
                await page.waitForFunction(selector => document.getAnimations().filter(animation => animation.effect?.target?.contains(document.querySelector(selector))).every(animation => animation.playState === 'finished'), {}, selector);
                const before = await page.$eval(selector, card => ({ top: card.getBoundingClientRect().top, shadow: getComputedStyle(card).boxShadow }));
                await page.hover(`${selector} .settings-card-header`);
                await page.waitForFunction(selector => document.getAnimations().filter(animation => animation.effect?.target === document.querySelector(selector)).every(animation => animation.playState === 'finished'), {}, selector);
                const after = await page.$eval(selector, card => ({ top: card.getBoundingClientRect().top, shadow: getComputedStyle(card).boxShadow, shimmer: getComputedStyle(card, '::before').backgroundImage }));
                assert.ok(Math.abs(after.top - before.top) < 1, `${tab} must not lift on hover`);
                assert.equal(after.shadow, before.shadow, `${tab} must not gain a raised shadow`);
                assert.notEqual(after.shimmer, 'none');
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                if (tab === 'browser' || tab === 'appearance') {
                    await page.screenshot({ path: path.join(screenshotDir, `settings-${tab}-${theme}-${width}.png`) });
                }
            }
        }
    }
    assert.deepEqual(errors, []);
});
