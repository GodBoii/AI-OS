const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const puppeteer = require('puppeteer-core');
const { createLazyDesktopController } = require('../lazy-desktop-controller');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium']
    .find(file => file && fs.existsSync(file));

test('desktop controllers initialize once on first use and dispose only their listener', async () => {
    const emitter = new EventEmitter();
    let created = 0;
    const calls = [];
    const unrelated = () => {};
    emitter.on('command', unrelated);
    const controller = createLazyDesktopController({ emitter, commandChannel: 'command', resultChannel: 'result',
        factory: () => { created++; return { handleCommand: value => calls.push(value), status: () => 'ready', cleanup: () => calls.push('cleanup') }; } });
    assert.equal(created, 0);
    assert.equal(controller.peek(), null);
    emitter.emit('command', 'first');
    assert.equal(controller.status(), 'ready');
    emitter.emit('command', 'second');
    assert.equal(created, 1);
    assert.deepEqual(calls, ['first', 'second']);
    await controller.cleanup();
    assert.deepEqual(calls, ['first', 'second', 'cleanup']);
    assert.deepEqual(emitter.listeners('command'), [unrelated]);
    assert.throws(() => controller.status(), /shutting down/);
});

test('failed desktop initialization reports the command error and retries first use', async () => {
    const emitter = new EventEmitter();
    let attempts = 0;
    const results = [];
    emitter.on('result', result => results.push(result));
    const controller = createLazyDesktopController({ emitter, commandChannel: 'command', resultChannel: 'result',
        factory: () => { if (++attempts === 1) throw new Error('native module unavailable'); return { handleCommand() {} }; } });
    emitter.emit('command', { request_id: 'r1', action: 'open' });
    assert.equal(results[0].request_id, 'r1');
    assert.match(results[0].error, /native module unavailable/);
    emitter.emit('command', { request_id: 'r2' });
    assert.equal(attempts, 2);
    await controller.cleanup();
});

test('preload subscriptions unsubscribe individually and never expose the IPC event', () => {
    const ipc = new EventEmitter();
    let exposed;
    const context = { require(name) {
        if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_name, api) { exposed = api; } } };
        if (name === './auth-service') return { setStorage() {} };
        if (name === './secure-store') return { createSecureAuthStorage() {} };
        return require(name);
    }, window: { localStorage: {}, addEventListener() {} }, process, console, Buffer, setTimeout, clearTimeout };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/preload.js'), 'utf8'), context);
    const received = [];
    const unsubscribe = exposed.ipcRenderer.on('chat-response', payload => received.push(payload));
    exposed.ipcRenderer.on('chat-response', payload => received.push(`other:${payload}`));
    ipc.emit('chat-response', { sender: 'private' }, 'one');
    unsubscribe();
    unsubscribe();
    ipc.emit('chat-response', { sender: 'private' }, 'two');
    assert.deepEqual(received, ['one', 'other:one', 'other:two']);
    assert.equal(typeof exposed.ipcRenderer.on('forbidden', () => {}), 'function');
});

test('browser artifact, media, cache and lazy-library lifetimes', { skip: !executablePath }, async t => {
    const requests = [];
    let chartFailed = false;
    const server = http.createServer((req, res) => {
        requests.push(req.url);
        if (req.url === '/node_modules/chart.js/dist/chart.umd.js' && !chartFailed) {
            chartFailed = true;
            res.writeHead(503); res.end(); return;
        }
        if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><body><div class="chat-container"></div><div class="floating-input-container"></div><script src="/js/vendor/highlight-11.7.0.min.js"></script><script src="/js/vendor/marked-9.1.6.min.js"></script><script src="/node_modules/dompurify/dist/purify.min.js"></script><script src="/js/feature-loader.js"></script></body>');
            return;
        }
        const file = path.resolve(root, `.${req.url.split('?')[0]}`);
        if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(404); res.end(); return;
        }
        res.setHeader('Content-Type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : 'text/css');
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
        window.currentConversationId = 'a';
        window.formatter = (await import('/js/message-formatter.js')).messageFormatter;
        window.preview = (await import('/js/history-content-preview.js')).default;
        window.viewer = (await import('/js/session-content-viewer.js')).default;
    });
    assert.equal(requests.some(url => /mermaid-10|chart\.umd|xterm\.js/.test(url)), false);
    const identities = await page.evaluate(() => {
        formatter.formatStreaming('```javascript\nconst x = 1;\n```\n', 's1', { conversationId: 'a' });
        for (let i = 0; i < 100; i++) formatter.formatStreaming('more ', 's1', { conversationId: 'a' });
        const before = artifactHandler.artifacts.size;
        formatter.format(formatter.getFinalContent('s1'), { artifactScope: 's1', conversationId: 'a' });
        const after = artifactHandler.artifacts.size;
        formatter.formatStreaming('```javascript\nconst x = 2;\n```', 's2', { conversationId: 'b' });
        artifactHandler.releaseConversation('a');
        const remaining = [...artifactHandler.artifacts.values()].map(entry => entry.content);
        return { before, after, remaining };
    });
    assert.deepEqual(identities, { before: 1, after: 1, remaining: ['const x = 2;'] });
    const cache = await page.evaluate(async () => {
        viewer.maxCacheEntries = 3;
        for (let i = 0; i < 10; i++) viewer.cacheContent(`s${i}`, [{ title: `${i}` }]);
        const bounded = viewer.contentCache.size;
        viewer.cacheTimestamps.set('s7', Date.now() - viewer.cacheExpiry - 1);
        viewer.getCachedContent('s9');
        const expiredGone = !viewer.contentCache.has('s7');
        viewer.invalidateCache();
        viewer.maxCacheBytes = 20;
        viewer.cacheContent('oversized', ['x'.repeat(50)]);
        const oversized = viewer.contentCache.size;
        viewer.maxCacheBytes = 10000;
        viewer.cacheExpiry = 30;
        viewer.cacheContent('timer', ['small']);
        await new Promise(resolve => setTimeout(resolve, 80));
        return { bounded, expiredGone, oversized, afterExpiry: viewer.contentCache.size };
    });
    assert.deepEqual(cache, { bounded: 3, expiredGone: true, oversized: 0, afterExpiry: 0 });
    const media = await page.evaluate(async () => {
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        const active = new Set();
        URL.createObjectURL = blob => { const url = create(blob); active.add(url); return url; };
        URL.revokeObjectURL = url => { active.delete(url); revoke(url); };
        for (let i = 0; i < 10; i++) {
            await preview.show({ content_type: 'artifact', download_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTqkAAAAASUVORK5CYII=', metadata: { mime_type: 'image/png' } });
            preview.hide();
        }
        const leaked = active.size;
        const fetchOriginal = window.fetch;
        let finishBlob;
        window.fetch = async () => ({ ok: true, blob: () => new Promise(resolve => { finishBlob = resolve; }) });
        const pending = preview.show({ content_type: 'artifact', download_url: '/slow', metadata: { mime_type: 'image/png' } });
        await new Promise(resolve => setTimeout(resolve, 0));
        preview.hide();
        finishBlob(new Blob(['old'], { type: 'image/png' }));
        await pending;
        window.fetch = fetchOriginal;
        await preview.show({ content_type: 'upload', metadata: { filename: 'new.bin' } });
        await new Promise(resolve => setTimeout(resolve, 350));
        const reopenedVisible = !document.getElementById('history-content-preview').classList.contains('hidden');
        preview.dispose();
        return { leaked, lateUrls: active.size, reopenedVisible };
    });
    assert.deepEqual(media, { leaked: 0, lateUrls: 0, reopenedVisible: true });
    const lazy = await page.evaluate(async () => {
        const first = loadRendererFeature('mermaid');
        const shared = first === loadRendererFeature('mermaid');
        await first;
        let failed = false;
        try { await loadRendererFeature('chart'); } catch { failed = true; }
        await loadRendererFeature('chart');
        return { shared, failed, chart: typeof Chart, mermaid: typeof mermaid.init };
    });
    assert.deepEqual(lazy, { shared: true, failed: true, chart: 'function', mermaid: 'function' });
    assert.equal(requests.filter(url => url.includes('mermaid-10')).length, 1);
    assert.equal(requests.filter(url => url.includes('chart.umd')).length, 2);
    assert.deepEqual(errors, []);
});

test('inactive conversations restore from disk while running and interactive views stay live', { skip: !executablePath }, async t => {
    const server = http.createServer((req, res) => {
        if (req.url === '/view-cache.js') {
            res.setHeader('Content-Type', 'text/javascript');
            res.end(fs.readFileSync(path.join(root, 'js/conversation-view-cache.js')));
        } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body><main></main></body>'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
        const { ConversationViewCache } = await import('/view-cache.js');
        const threads = new Map();
        for (let i = 0; i < 8; i++) {
            const thread = document.createElement('section');
            thread.dataset.id = String(i);
            thread.innerHTML = `<p>conversation ${i}</p>`;
            document.querySelector('main').append(thread);
            threads.set(String(i), thread);
        }
        let disposed = 0;
        const cache = new ConversationViewCache({ threads, maxIdleViews: 2, isPinned: id => id === '1',
            serialize: thread => ({ html: thread.outerHTML }),
            hydrate: snapshot => { const template = document.createElement('template'); template.innerHTML = snapshot.html; return template.content.firstElementChild; },
            dispose: () => disposed++,
        });
        await cache.prune('7');
        const mounted = threads.size;
        const runningRetained = threads.has('1');
        const restored = await cache.restore('0');
        const restoredText = restored.textContent;
        document.querySelector('main').append(restored);
        await cache.prune('0');
        cache.forget('2');
        const forgotten = await cache.restore('2');
        await cache.clear();
        return { mounted, runningRetained, disposed, restoredText, forgotten, archived: cache.archived.size };
    });
    assert.equal(result.mounted, 4);
    assert.equal(result.runningRetained, true);
    assert.equal(result.restoredText, 'conversation 0');
    assert.equal(result.forgotten, null);
    assert.equal(result.archived, 0);
    assert.equal(result.disposed, 5);
});
