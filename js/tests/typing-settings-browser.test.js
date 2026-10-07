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

test('typing selector uses actual settings logic and survives save errors and reopening', { skip: !executablePath }, async t => {
    const source = fs.readFileSync(path.join(root, 'js/aios.js'), 'utf8');
    const card = source.slice(source.indexOf('<!-- Agent typing -->'), source.indexOf('<!-- Browser Sessions Section -->'));
    const sheets = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/href="css\/[^\"]+\.css"/g).map(match => match.slice(6, -1));
    const server = http.createServer((request, response) => {
        if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">${sheets.map(sheet => `<link rel="stylesheet" href="/${sheet}">`).join('')}
                <style>body{margin:0;padding:16px}#settings-tab{display:block;width:100%;max-width:720px;margin:0 auto}</style></head>
                <body class="dark-mode"><div id="settings-tab" class="tab-content active">${card}</div><script src="/js/aios.js"></script></body></html>`);
            return;
        }
        if (request.url === '/js/aios.js' || /^\/css\/[a-z0-9-]+\.css$/i.test(request.url)) {
            const file = path.join(root, request.url);
            if (fs.existsSync(file)) {
                response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css');
                response.end(fs.readFileSync(file));
                return;
            }
        }
        response.writeHead(404); response.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
        window.saved = { typingSpeed: 'instant', visibility: 'background', idleCloseMinutes: 15, blockedDomains: [] };
        window.writes = [];
        window.failSave = false;
        window.electron = { ipcRenderer: { invoke: async (channel, patch) => {
            if (channel.endsWith(':set')) {
                if (window.failSave) throw new Error('Test disk failure');
                window.writes.push(patch);
                Object.assign(window.saved, patch);
            }
            return { ...window.saved };
        } } };
        return window.AIOS.initBrowserSettings();
    });
    await page.waitForSelector('#settings-typing-speed:not([disabled])');
    assert.equal(await page.$eval('#settings-typing-speed', el => el.value), 'instant');
    await page.select('#settings-typing-speed', 'fast');
    await page.waitForFunction(() => document.getElementById('settings-typing-speed-status').textContent === 'Typing speed saved.');
    await page.evaluate(() => window.AIOS.initBrowserSettings());
    assert.equal(await page.$eval('#settings-typing-speed', el => el.value), 'fast');
    await page.select('#settings-typing-speed', 'slow');
    await page.waitForFunction(() => window.saved.typingSpeed === 'slow' && !document.getElementById('settings-typing-speed').disabled);
    assert.equal((await page.evaluate(() => window.writes)).length, 2);
    await page.evaluate(() => { window.failSave = true; });
    await page.select('#settings-typing-speed', 'instant');
    await page.waitForFunction(() => document.getElementById('settings-typing-speed-status').textContent.includes('Could not save'));
    assert.equal(await page.$eval('#settings-typing-speed', el => el.value), 'slow');
    // Customizable native selects commit the highlighted option with Enter.
    await page.evaluate(() => { window.failSave = false; });
    await page.focus('#settings-typing-speed');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.getElementById('settings-typing-speed').matches(':open') && document.activeElement.tagName === 'OPTION');
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => window.saved.typingSpeed === 'instant');
    fs.mkdirSync(path.join(root, '.ui-check'), { recursive: true });
    for (const theme of ['dark', 'light']) {
        for (const width of [1280, 390]) {
            await page.setViewport({ width, height: 800 });
            await page.evaluate(theme => document.body.classList.toggle('dark-mode', theme === 'dark'), theme);
            const layout = await page.evaluate(() => {
                const select = document.getElementById('settings-typing-speed');
                const card = select.closest('section');
                const a = select.getBoundingClientRect(), b = card.getBoundingClientRect();
                return { overflow: document.documentElement.scrollWidth > innerWidth, inside: a.left >= b.left && a.right <= b.right, label: select.labels[0]?.textContent.trim() };
            });
            assert.equal(layout.overflow, false);
            assert.equal(layout.inside, true);
            assert.equal(layout.label, 'Typing speed');
            await page.screenshot({ path: path.join(root, `.ui-check/typing-settings-${theme}-${width}.png`) });
            for (const id of ['settings-typing-speed', 'settings-browser-visibility']) {
                await page.click(`#${id}`);
                await page.waitForFunction(id => document.getElementById(id).matches(':open'), {}, id);
                await page.waitForFunction(id => getComputedStyle(document.getElementById(id), '::picker(select)').opacity === '1', {}, id);
                const picker = await page.$eval(`#${id}`, el => {
                    const style = getComputedStyle(el, '::picker(select)');
                    const option = getComputedStyle(el.options[0]);
                    return { appearance: style.appearance, background: style.backgroundColor, text: option.color };
                });
                assert.equal(picker.appearance, 'base-select');
                assert.notEqual(picker.background, picker.text);
                await page.screenshot({ path: path.join(root, `.ui-check/${id}-${theme}-${width}-open.png`) });
                await page.keyboard.press('Escape');
                assert.equal(await page.$eval(`#${id}`, el => el.matches(':open')), false);
                await page.waitForFunction(id => getComputedStyle(document.getElementById(id), '::picker(select)').display === 'none', {}, id);
            }
        }
    }
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await page.$eval('#settings-typing-speed', el => getComputedStyle(el, '::picker(select)').transitionDuration), '0s');
    await page.focus('#settings-browser-visibility');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.getElementById('settings-browser-visibility').matches(':open'));
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.saved.visibility === 'visible');
    assert.deepEqual(errors, []);
});
