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

test('the actual presentation viewer retains images across tool/socket updates', { skip: !executablePath }, async () => {
    const routes = new Map([
        ['/js/artifact-handler.js', 'text/javascript'],
        ['/js/presentation-metadata.mjs', 'text/javascript'],
        ['/css/artifact-ui.css', 'text/css']
    ]);
    const server = http.createServer((request, response) => {
        if (routes.has(request.url)) {
            response.writeHead(200, { 'Content-Type': routes.get(request.url) });
            response.end(fs.readFileSync(path.join(root, request.url)));
        } else if (request.url === '/') {
            response.end('<!doctype html><link rel="stylesheet" href="/css/artifact-ui.css"><div class="chat-container"></div><div class="floating-input-container"></div><script type="module">import {artifactHandler} from "/js/artifact-handler.js";window.viewer=artifactHandler;</script>');
        } else {
            response.writeHead(404);
            response.end();
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => Boolean(window.viewer));
        const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVz0AAAAASUVORK5CYII=';
        for (const order of ['rendered-first', 'compact-first']) {
            const result = await page.evaluate(async ({ image, order }) => {
                const id = `deck-${order}`;
                const compact = { output_id: id, title: 'Pilot', inline: { slide_count: 1, slides: [{ index: 1, title: 'Decision' }] } };
                const rendered = { ...compact, inline: { ...compact.inline, slides: [{ ...compact.inline.slides[0], preview_data_uri: image }] } };
                const inputs = order === 'rendered-first' ? [rendered, compact] : [compact, rendered];
                inputs.forEach(data => window.viewer.showArtifact('presentation', data, id));
                const img = document.querySelector('.presentation-artifact img');
                await img.decode();
                return { images: document.querySelectorAll('.presentation-artifact img').length,
                    width: img.naturalWidth, artifact: document.getElementById('artifact-container').dataset.activeArtifactId };
            }, { image, order });
            assert.equal(result.images, 1);
            assert.ok(result.width > 0);
            assert.equal(result.artifact, `deck-${order}`);
        }
        await page.click('.close-artifact-btn');
        assert.equal(await page.$eval('#artifact-container', node => node.classList.contains('hidden')), true);
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
