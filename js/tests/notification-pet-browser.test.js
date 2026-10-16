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
    '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => file && fs.existsSync(file));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Exercise the production service with the actual app styles, including global
// button and SVG rules. The fixture has no network or authenticated backend.
test('pet messenger preserves notification behavior across input, queue and theme states', { skip: !executablePath }, async t => {
    const styles = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/href="(css\/[^\"]+\.css)"/g)]
        .map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('');
    const fixture = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        ${styles}<style>body{margin:0;min-height:100dvh;background:#f6f7f8}body.dark-mode{background:#17191c}</style>
        <button id="origin" style="margin:30px">Workspace action</button><script src="/js/notification-service.js"></script>`;
    const server = http.createServer((request, response) => {
        if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(fixture); return; }
        const file = path.resolve(root, `.${request.url.split('?')[0]}`);
        if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404); response.end(); return;
        }
        response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/javascript');
        response.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 800 });
    const url = `http://127.0.0.1:${server.address().port}`;
    const reset = async () => { await page.goto(url); await page.mouse.move(1, 1); };
    const activeSelector = '.unified-notification:not([hidden])';

    await t.test('one pet, one visible message, paused queue and priority', async () => {
        await reset();
        assert.equal(await page.$eval('.unified-notification-container', node => node.inert), true);
        await page.evaluate(() => {
            window.first = notificationService.show('Changes saved', 'success', 10000);
            notificationService.show('Export ready', 'info', 10000);
            notificationService.showComputerTool('Screenshot captured', 'screenshot');
        });
        await page.waitForSelector('.has-notifications', { visible: true });
        assert.equal(await page.$$eval('.notification-pet', nodes => nodes.length), 1);
        assert.equal(await page.$$eval('.unified-notification:not([hidden])', nodes => nodes.length), 1);
        assert.equal(await page.$eval(`${activeSelector} .notification-message`, node => node.textContent), 'Changes saved');
        assert.equal(await page.evaluate(() => notificationService.notifications.filter(item => item.timer).length), 1);
        await page.click(`${activeSelector} .notification-next`);
        assert.equal(await page.$eval(`${activeSelector} .notification-message`, node => node.textContent), 'Export ready');
        assert.equal(await page.evaluate(() => notificationService.notifications.find(item => item.id === window.first).timer.playState), 'paused');
        await page.focus('#origin');
        await page.mouse.move(1, 1);
        await page.evaluate(() => {
            notificationService.show('Upload failed', 'error', 10000);
            notificationService.show('Routine update', 'info', 10000);
        });
        assert.equal(await page.evaluate(() => notificationService.active().message), 'Upload failed');
        assert.equal(await page.$eval('.notification-urgent', node => node.textContent), 'Needs attention. Upload failed');
        const chat = fs.readFileSync(path.join(root, 'js/chat.js'), 'utf8');
        const start = chat.indexOf("function showNotification(message, type = 'error'");
        const end = chat.indexOf('class UnifiedPreviewHandler', start);
        assert.ok(start >= 0 && end > start);
        await page.addScriptTag({ content: `${chat.slice(start, end)}\nwindow.fromChat = showNotification('Chat validation failed', 'error');` });
        assert.ok(await page.evaluate(() => notificationService.notifications.some(item => item.id === window.fromChat)));
        assert.equal(await page.$$eval('.notification-container', nodes => nodes.length), 0);
        await page.evaluate(() => {
            for (let index = 0; index < 30; index++) notificationService.show(`Routine ${index}`, 'info', 10000);
        });
        assert.equal(await page.evaluate(() => notificationService.pending().length), 20);
        assert.equal(await page.evaluate(() => notificationService.active().message), 'Upload failed');
        await page.click(`${activeSelector} .notification-clear`);
        await page.waitForFunction(() => notificationService.notifications.length === 0);
        assert.equal(await page.$eval('.unified-notification-container', node => node.inert), true);
    });

    await t.test('hover, focus, tuck, expansion, background and elapsed-time dismissal', async () => {
        await reset();
        await page.focus('#origin');
        await page.evaluate(() => notificationService.show('Reading time should pause.', 'info', 10000));
        await wait(400);
        await page.hover('.notification-pet');
        const before = await page.evaluate(() => notificationService.active().timer.currentTime);
        await wait(160);
        const after = await page.evaluate(() => notificationService.active().timer.currentTime);
        assert.ok(Math.abs(after - before) < 35, `${before} -> ${after}`);
        await page.click('.notification-pet');
        assert.equal(await page.$eval('.notification-pet', node => node.getAttribute('aria-expanded')), 'false');
        assert.equal(await page.$eval('.notification-speech', node => node.inert), true);
        await page.focus('#origin');
        await page.mouse.move(1, 1);
        assert.equal(await page.evaluate(() => notificationService.active().timer.playState), 'paused');
        await page.click('.notification-pet');
        await page.focus('#origin');
        await page.mouse.move(1, 1);
        assert.equal(await page.evaluate(() => notificationService.active().timer.playState), 'running');
        const background = await browser.newPage();
        await page.waitForFunction(() => document.hidden);
        assert.equal(await page.evaluate(() => notificationService.active().timer.playState), 'paused');
        await background.close();
        await page.bringToFront();
        await page.waitForFunction(() => !document.hidden);
        await page.evaluate(() => {
            notificationService.active().timer.currentTime = 9990;
        });
        await page.waitForFunction(() => notificationService.notifications.length === 0);
        assert.equal(await page.$eval('.unified-notification-container', node => node.inert), true);

        await page.evaluate(() => notificationService.show('Your file could not upload. '.repeat(25), 'error', 10000));
        await page.waitForSelector(`${activeSelector} .notification-details`, { visible: true });
        await page.click(`${activeSelector} .notification-details`);
        await page.focus('#origin');
        await page.mouse.move(1, 1);
        assert.equal(await page.evaluate(() => notificationService.active().expanded), true);
        assert.equal(await page.evaluate(() => notificationService.active().timer.playState), 'paused');
        await page.click(`${activeSelector} .notification-details`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => notificationService.notifications.length === 0);
        assert.equal(await page.$eval('#origin', node => node === document.activeElement), true);
    });

    await t.test('connection replacement, retry bridge, preferences, swipe and safe text', async () => {
        await reset();
        await page.evaluate(() => {
            window.sent = [];
            window.electron = { ipcRenderer: { send: channel => window.sent.push(channel) } };
            notificationService.showConnection('Disconnected', true);
        });
        await page.click('.notification-retry-btn');
        assert.deepEqual(await page.evaluate(() => window.sent), ['restart-python-bridge']);
        assert.equal(await page.$eval('.notification-retry-btn', node => node.disabled), true);
        assert.equal(await page.$eval('.unified-notification-container', node => node.dataset.mood), 'connection');
        await page.evaluate(() => notificationService.showConnection('Reconnecting'));
        assert.equal(await page.evaluate(() => notificationService.notifications.filter(item => item.type === 'connection').length), 1);
        assert.equal(await page.$eval('.unified-notification-container', node => node.dataset.mood), 'connection');
        await page.evaluate(() => notificationService.removeConnectionNotifications());
        await page.waitForFunction(() => notificationService.notifications.length === 0);
        await page.evaluate(() => {
            notificationService.setEnabled(false);
            window.disabledResult = notificationService.show('Hidden');
            window.disabledTool = notificationService.showComputerTool('Hidden tool', 'click');
            notificationService.showConnection('Connection still visible');
        });
        assert.equal(await page.evaluate(() => window.disabledResult), null);
        assert.equal(await page.evaluate(() => window.disabledTool), null);
        assert.equal(await page.evaluate(() => notificationService.pending().length), 1);
        await page.setOfflineMode(true);
        await page.evaluate(() => notificationService.showConnection('You are offline'));
        assert.equal(await page.$eval(`${activeSelector} .notification-type`, node => node.textContent), 'Offline');
        assert.equal(await page.$eval('.unified-notification-container', node => node.dataset.mood), 'warning');
        await page.setOfflineMode(false);
        await page.evaluate(() => { notificationService.clear(); notificationService.setEnabled(true); });
        await page.waitForFunction(() => notificationService.notifications.length === 0);
        await page.evaluate(() => notificationService.show('<img src=x onerror=alert(1)>', 'info', null));
        assert.equal(await page.$$eval('.notification-message img', nodes => nodes.length), 0);
        await wait(400);
        const box = await page.$eval('.notification-message', node => {
            const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width };
        });
        await page.mouse.move(box.x + 20, box.y + 10);
        await page.mouse.down();
        await page.mouse.move(box.x + 120, box.y + 10, { steps: 10 });
        await page.mouse.up();
        await page.waitForFunction(() => notificationService.notifications.length === 0);
    });

    await t.test('light, dark, mobile, long text and reduced motion', async () => {
        await reset();
        const shotDirectory = process.env.NOTIFICATION_SCREENSHOTS;
        if (shotDirectory) fs.mkdirSync(shotDirectory, { recursive: true });
        for (const width of [1280, 390, 320]) {
            await page.setViewport({ width, height: 800, isMobile: width < 500, hasTouch: width < 500 });
            for (const dark of [false, true]) {
                await page.evaluate(dark => {
                    notificationService.clear();
                    document.body.classList.toggle('dark-mode', dark);
                }, dark);
                await page.waitForFunction(() => notificationService.notifications.length === 0);
                await page.evaluate(() => notificationService.showConnection('I lost the connection. Your conversation is safe.', true));
                await wait(700);
                const bounds = await page.$$eval('.notification-pet, .notification-surface', nodes => nodes.map(node => {
                    const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
                }));
                for (const r of bounds) {
                    assert.ok(r.left >= 0 && r.right <= width && r.top >= 0 && r.bottom <= 800, JSON.stringify(r));
                }
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                if (shotDirectory) await page.screenshot({ path: path.join(shotDirectory, `pet-${dark ? 'dark' : 'light'}-${width}.png`) });
            }
        }
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.evaluate(() => notificationService.showConnection('Connecting again'));
        assert.equal(await page.$eval('.pet-antenna', node => getComputedStyle(node).animationName), 'none');
        assert.equal(await page.$eval('.pet-character', node => getComputedStyle(node).animationName), 'none');
        assert.equal(await page.$eval('.unified-notification-container', node => getComputedStyle(node).transitionDuration), '0s');
        await page.evaluate(() => notificationService.clear());
        await page.waitForFunction(() => notificationService.notifications.length === 0);
    });
    assert.deepEqual(errors, []);
});
