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
const png = fs.readFileSync(path.join(__dirname, 'fixtures/generated-image.png'));

function excerpt(source, start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing production code: ${start}`);
    return source.slice(from, to);
}

test('create_image displays tool results, socket media, saved previews, and downloads', { skip: !executablePath }, async () => {
    const server = http.createServer((request, response) => {
        if (request.url === '/image.png') {
            response.writeHead(200, { 'Content-Type': 'image/png' });
            response.end(png);
        } else if (request.url.startsWith('/js/') || request.url.startsWith('/css/')) {
            const filename = path.join(root, request.url);
            if (!fs.existsSync(filename)) {
                response.writeHead(404).end();
                return;
            }
            response.writeHead(200, { 'Content-Type': request.url.startsWith('/js/') ? 'text/javascript' : 'text/css' });
            response.end(fs.readFileSync(filename));
        } else {
            response.end(`<!doctype html><link rel="stylesheet" href="/css/artifact-ui.css">
                <link rel="stylesheet" href="/css/chat-messages.css">
                <div class="chat-container"><div id="message"><div class="detailed-logs"></div></div></div>
                <div class="floating-input-container"></div><div id="preview"></div>
                <script type="module">import {artifactHandler} from '/js/artifact-handler.js';window.viewer=artifactHandler;</script>`);
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.goto(base);
        await page.waitForFunction(() => Boolean(window.viewer));
        const source = fs.readFileSync(path.join(root, 'js/chat.js'), 'utf8');
        const helpers = excerpt(source, 'function escapeToolPreviewHtml(', 'function encodeToolMetadata(')
            + excerpt(source, 'function encodeToolMetadata(', 'function formatToolPreviewValue(')
            + excerpt(source, 'async function resolveGeneratedImagePreviewUrl(', 'function normalizeDelegatedAgent(');
        const event = excerpt(source, '    const handleGeneratedMediaEvent =', "    ipcRenderer.on('image_generated'");
        const agentEvent = excerpt(source, "    ipcRenderer.on('agent-step'", "    ipcRenderer.on('reasoning-step'");
        await page.addScriptTag({ content: `
            const artifactHandler = window.viewer;
            window.activeConversation = 'conversation';
            window.invalidations = [];
            function getStreamMessageDiv() { return document.getElementById('message'); }
            function getStreamConversationId() { return 'conversation'; }
            function invalidateContentForConversation(id) { window.invalidations.push(id); }
            function isConversationActive(id) { return id === window.activeConversation; }
            function isProjectWorkspaceMode() { return false; }
            function updateReasoningSummary() {}
            function getDelegationLogContainer(message) { return message.querySelector('.detailed-logs'); }
            const ipcRenderer = { on: (channel, callback) => { window[channel] = callback; } };
            ${helpers}
            ${event}
            ${agentEvent}
            window.receiveMedia = handleGeneratedMediaEvent;
        ` });
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
            await page.setViewport(viewport);
            const result = await page.evaluate(async ({ base, width }) => {
                const id = `generated-${width}`;
                window.receiveMedia({ id: 'message', conversationId: 'conversation', artifactId: id,
                    mediaType: 'image', mediaUrl: `${base}/image.png`, mimeType: 'image/png', fileName: 'image.png' });
                const artifactImage = document.querySelector('.generated-image-artifact');
                await artifactImage.decode();
                const metadata = { kind: 'generated_image_tool_output', artifact_id: id, media_url: `${base}/image.png`,
                    filename: '<img onerror=alert(1)>', title: 'Generated image', preview_type: 'image' };
                const extracted = getComputerToolMetadata({ tool_output: JSON.stringify({ ok: true, metadata }) });
                document.getElementById('preview').innerHTML = await buildToolPreviewMarkup(extracted);
                const image = document.querySelector('#preview img');
                await image.decode();
                return { artifactWidth: artifactImage.naturalWidth, previewWidth: image.naturalWidth,
                    stored: window.viewer.getActiveArtifact().content, link: document.querySelector('#preview a').href,
                    caption: document.querySelector('.tool-preview-caption').textContent,
                    injectedImages: document.querySelectorAll('#preview img').length,
                    fits: image.getBoundingClientRect().width <= window.innerWidth };
            }, { base, width: viewport.width });
            assert.ok(result.artifactWidth > 0 && result.previewWidth > 0);
            assert.equal(result.stored, `${base}/image.png`);
            assert.equal(result.link, `${base}/image.png`);
            assert.equal(result.caption, '<img onerror=alert(1)>');
            assert.equal(result.injectedImages, 1);
            assert.equal(result.fits, true);
        }
        const toolResult = await page.evaluate(async base => {
            const event = { id: 'message', name: 'create_image', agent_name: 'Assistant' };
            await window['agent-step']({ ...event, type: 'tool_start' });
            await window['agent-step']({ ...event, type: 'tool_end', tool: { tool_output: { ok: false, error: 'OpenRouter HTTP 402' } } });
            const failed = document.querySelector('.tool-log-status.failed') !== null;
            const error = document.querySelector('[role="status"]').textContent;
            document.querySelector('.detailed-logs').innerHTML = '';
            await window['agent-step']({ ...event, type: 'tool_start' });
            await window['agent-step']({ ...event, type: 'tool_end', tool: { tool_output: JSON.stringify({ ok: true,
                metadata: { kind: 'generated_image_tool_output', artifact_id: 'tool-image',
                    media_url: `${base}/image.png`, mime_type: 'image/png', filename: 'image.png', title: 'Generated image' } }) } });
            document.querySelector('.tool-log-header').click();
            return { failed, error, expanded: document.querySelector('.tool-log-entry').classList.contains('preview-expanded'),
                artifact: window.viewer.getActiveArtifact().content,
                preview: document.querySelector('.tool-preview-image-thumb').getAttribute('src') };
        }, base);
        assert.equal(toolResult.failed, true);
        assert.equal(toolResult.error, 'OpenRouter HTTP 402');
        assert.equal(toolResult.expanded, true);
        assert.equal(toolResult.artifact, `${base}/image.png`);
        assert.equal(toolResult.preview, `${base}/image.png`);
        const replay = await page.evaluate(async base => {
            window.sessionContentViewer = {
                getCachedContent: () => [{ reference_id: 'old-image', signed_url: `${base}/image.png?fresh=1` }]
            };
            const refreshed = await resolveGeneratedImagePreviewUrl({ conversation_id: 'conversation',
                artifact_id: 'old-image', media_url: 'https://expired.example/image', media_url_expires_at: 1 });
            const unsafe = await buildToolPreviewMarkup({ kind: 'generated_image_tool_output', media_url: 'javascript:alert(1)' });
            window.activeConversation = 'other';
            window.receiveMedia({ id: 'message', conversationId: 'conversation', artifactId: 'background',
                mediaType: 'image', mediaUrl: `${base}/image.png` });
            return { refreshed, unsafe, active: document.getElementById('artifact-container').dataset.activeArtifactId,
                cached: window.viewer.pendingMedia.has('background'), invalidations: window.invalidations.length };
        }, base);
        assert.equal(replay.refreshed, `${base}/image.png?fresh=1`);
        assert.equal(replay.unsafe, '');
        assert.notEqual(replay.active, 'background');
        assert.equal(replay.cached, true);
        assert.equal(replay.invalidations, 3);
        const refreshed = await page.evaluate(async base => {
            const originalFetch = window.fetch;
            let requestedUrl;
            let cached;
            window.electron = { auth: { getSession: async () => ({ access_token: 'test-token' }) } };
            window.sessionContentViewer = {
                getCachedContent: () => null,
                cacheContent: (_id, content) => { cached = content; }
            };
            window.fetch = async url => {
                requestedUrl = url;
                return { ok: true, json: async () => ({ content: [{ reference_id: 'old-image', signed_url: `${base}/image.png` }] }) };
            };
            try {
                const url = await resolveGeneratedImagePreviewUrl({ conversation_id: 'conversation',
                    artifact_id: 'old-image', media_url_expires_at: 1 });
                return { url, requestedUrl, cached: cached.length };
            } finally {
                window.fetch = originalFetch;
            }
        }, base);
        assert.equal(refreshed.url, `${base}/image.png`);
        assert.equal(refreshed.requestedUrl, 'https://api.aetheriaai.website/api/sessions/conversation/content');
        assert.equal(refreshed.cached, 1);
        const download = await page.evaluate(async () => {
            window.electron = {
                ipcRenderer: { invoke: async (channel, payload) => {
                    if (channel === 'show-save-dialog') return { filePath: 'image.png', canceled: false };
                    window.savedImage = payload;
                    return true;
                } }
            };
            await window.viewer.downloadArtifact();
            return { encoding: window.savedImage.encoding, bytes: window.savedImage.content.length };
        });
        assert.equal(download.encoding, 'binary');
        assert.equal(download.bytes, png.length);
        await page.click('.close-artifact-btn');
        assert.equal(await page.$eval('#artifact-container', node => node.classList.contains('hidden')), true);
        const legacy = await page.evaluate(async data => {
            window.viewer.showArtifact('image', data, 'legacy');
            const image = document.querySelector('.generated-image-artifact');
            await image.decode();
            return image.naturalWidth;
        }, png.toString('base64'));
        assert.ok(legacy > 0);
        assert.deepEqual(errors, []);
        if (process.env.CREATE_IMAGE_SCREENSHOTS) {
            const destination = path.resolve(process.env.CREATE_IMAGE_SCREENSHOTS);
            fs.mkdirSync(destination, { recursive: true });
            await page.evaluate(async base => {
                document.querySelectorAll('.tool-log-entry, .artifact-notification').forEach(node => node.remove());
                document.getElementById('preview').innerHTML = await buildToolPreviewMarkup({
                    kind: 'generated_image_tool_output', media_url: `${base}/image.png`, filename: 'generated-image.png'
                });
            }, base);
            for (const width of [1440, 390]) {
                await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
                await page.screenshot({ path: path.join(destination, `create-image-${width}.png`) });
            }
        }
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
