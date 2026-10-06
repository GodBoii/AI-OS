const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('actual template gallery previews, selection and keyboard close work on desktop and mobile', { skip: !executablePath }, async () => {
    const scripts = new Set(['/js/welcome-display.js', '/js/user-profile-service.js', '/js/presentation-templates.js']);
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost').pathname;
        if (scripts.has(url) || url === '/css/home-screen-cards.css'
            || /^\/assets\/presentation-design-previews\/[a-z_]+\/[a-z]+\.jpg$/.test(url)) {
            const file = path.join(root, url);
            if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
            response.writeHead(200, { 'Content-Type': url.endsWith('.js') ? 'text/javascript' : url.endsWith('.css') ? 'text/css' : 'image/jpeg' });
            response.end(fs.readFileSync(file));
        } else if (url === '/') {
            response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/home-screen-cards.css"><div id="root"></div><script type="module">import W from "/js/welcome-display.js";window.gallery=new W();document.getElementById("root").innerHTML=window.gallery.getTemplatesScrollHtml();</script>');
        } else { response.writeHead(204); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
        for (const width of [1440, 390]) {
            await page.setViewport({ width, height: 1000 });
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            await page.waitForFunction(() => Boolean(window.gallery));
            const result = await page.evaluate(async () => {
                const images = Array.from(document.querySelectorAll('.ppt-template-rendered-preview'));
                for (const image of images) { image.loading = 'eager'; await image.decode(); }
                return { count: images.length, distinct: new Set(images.map(image => image.src)).size,
                    loaded: images.every(image => image.naturalWidth === 720 && image.naturalHeight === 405) };
            });
            assert.deepEqual(result, { count: 9, distinct: 9, loaded: true });
            await page.evaluate(() => window.gallery.openTemplatePreview('creative_portfolio'));
            await page.waitForSelector('.template-preview-overlay.visible');
            assert.equal(await page.$eval('.template-preview-header h3', node => node.textContent), 'Creative Portfolio');
            const previewCount = await page.evaluate(async () => {
                const images = Array.from(document.querySelectorAll('.template-preview-overlay img'));
                for (const image of images) { image.loading = 'eager'; await image.decode(); }
                return images.length;
            });
            assert.equal(previewCount, 7);
            await page.keyboard.down('Shift');
            await page.keyboard.press('Tab');
            await page.keyboard.up('Shift');
            assert.equal(await page.evaluate(() => document.activeElement.classList.contains('template-preview-select-btn')), true);
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement.classList.contains('template-preview-close-btn')), true);
            await page.keyboard.press('Escape');
            assert.equal(await page.$eval('.template-preview-overlay', node => node.classList.contains('hidden')), true);
            await page.evaluate(() => window.gallery.openTemplatePreview('academic'));
            await page.evaluate(async () => {
                const overlay = document.querySelector('.template-preview-overlay');
                await Promise.all(overlay.getAnimations({ subtree: true })
                    .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
                    .map(animation => animation.finished.catch(() => {})));
            });
            const screenshotDir = path.join(root, 'presentation-toolkit-output/design-review');
            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, `gallery-ui-${width}.png`) });
            await page.click('.template-preview-select-btn');
            assert.equal(await page.evaluate(() => localStorage.getItem('aetheria:selected-presentation-template')), 'academic');
        }
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
