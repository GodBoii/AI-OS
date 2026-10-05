const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

async function setup(t) {
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const markup = fs.readFileSync(path.join(root, 'aios.html'), 'utf8');
    const start = markup.indexOf('<div class="tab-content" id="database-tab">');
    const end = markup.indexOf('<div class="tab-content" id="memory-tab">', start);
    await page.setContent(`<!doctype html><html><body>${markup.slice(start, end)}</body></html>`);
    for (const sheet of ['design-system', 'aios']) {
        await page.addStyleTag({ content: fs.readFileSync(path.join(root, `css/${sheet}.css`), 'utf8') });
    }
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/aios.js'), 'utf8') });
    await page.evaluate(() => {
        const disk = new Map();
        window.opened = [];
        window.electron = {
            path: { join: (...parts) => parts.join('/') },
            fs: {
                existsSync: key => disk.has(key), mkdirSync: () => {},
                readFileSync: key => disk.get(key), writeFileSync: (key, bytes) => disk.set(key, bytes),
                promises: {
                    writeFile: async (key, bytes) => disk.set(key, bytes),
                    readFile: async key => disk.get(key), unlink: async key => disk.delete(key),
                },
            },
            shell: { openPath: async key => { window.opened.push(key); return ''; } },
        };
        const app = window.AIOS;
        window.app = app;
        app.userDataPath = '/test/userData';
        app.elements = {
            databasesList: document.getElementById('databases-list'),
            databasesEmpty: document.getElementById('databases-empty'),
            userFilesUploadInput: document.getElementById('user-files-upload-input'),
            userFilesUploadBtn: document.getElementById('user-files-upload-btn'),
        };
        app._getAccessToken = async () => app.userFilesAccountId;
        app.showNotification = (message, type) => { window.notification = { message, type }; };
        app._enqueueBackgroundDownload = () => {};
        app._setVaultAccount('00000000-0000-4000-8000-000000000001');
        app.currentTab = 'database';
        document.getElementById('database-tab').style.display = 'block';
        window.files = [];
        window.requests = [];
        window.fetch = async (url, options = {}) => {
            window.requests.push({ url, method: options.method || 'GET' });
            if (url.endsWith('/upload')) {
                if (!(options.body instanceof FormData) || options.headers['Content-Type']) throw new Error('Expected multipart upload');
                const file = options.body.get('file');
                const metadata = {
                    id: `00000000-0000-4000-8000-${String(window.files.length + 1).padStart(12, '0')}`,
                    file_name: file.name, mime_type: file.type,
                    size_bytes: file.size, created_at: new Date().toISOString(), storage_path: 'owner/file',
                };
                window.files.push(metadata);
                return Response.json({ ok: true, file: metadata });
            }
            if (options.method === 'DELETE') {
                const id = url.split('/').at(-1);
                window.files = window.files.filter(file => file.id !== id);
                return Response.json({ ok: true });
            }
            if (url.includes('?limit=')) {
                return Response.json({ ok: true, files: window.files,
                    storage: { used_bytes: window.files.reduce((sum, file) => sum + file.size_bytes, 0) } });
            }
            throw new Error(`Unexpected request: ${url}`);
        };
    });
    t.after(() => assert.deepEqual(errors, []));
    return page;
}

test('vault uploads multipart, refreshes, escapes filenames, opens cached files and deletes', { skip: !executablePath }, async t => {
    const page = await setup(t);
    await page.evaluate(async () => {
        await app.loadUserFiles();
        const selected = new DataTransfer();
        selected.items.add(new File(['hello vault'], '<img onerror=alert(1)>.txt', { type: 'text/plain' }));
        app.elements.userFilesUploadInput.files = selected.files;
        await Promise.all([app.handleUserFilesUpload(), app.handleUserFilesUpload()]);
    });
    assert.equal(await page.$$eval('.file-card', elements => elements.length), 1,
        JSON.stringify(await page.evaluate(() => ({ notification: window.notification, requests: window.requests }))));
    assert.match(await page.$eval('.file-card h4', element => element.textContent), /<img onerror=alert\(1\)>.txt/);
    assert.equal(await page.$('.file-card img'), null);
    assert.match(await page.$eval('#user-files-storage', element => element.textContent), /of 500 MB used/);
    await page.click('.user-file-open-btn');
    await page.waitForFunction(() => window.opened.length === 1);
    assert.match(await page.evaluate(() => window.opened[0]), /file-vault-cache\/00000000-0000-4000-8000-000000000001\//);
    await page.click('.user-file-delete-btn');
    await page.waitForFunction(() => document.querySelectorAll('.file-card').length === 0);
    assert.equal(await page.evaluate(() => app.userFilesStorage.used_bytes), 0);
    assert.equal(await page.evaluate(() => Object.keys(app.localFileManifest).length), 0);
    for (const width of [1280, 390]) {
        await page.setViewport({ width, height: 800 });
        const fits = await page.$eval('#user-files-storage', element => element.getBoundingClientRect().right <= innerWidth);
        assert.equal(fits, true);
        await page.screenshot({ path: path.join(os.tmpdir(), `vault-${width}.png`) });
    }
});

test('vault rejects oversized selections before uploading', { skip: !executablePath }, async t => {
    const page = await setup(t);
    await page.evaluate(async () => {
        const selected = new DataTransfer();
        selected.items.add(new File([new Uint8Array(50_000_001)], 'too-big.bin'));
        app.elements.userFilesUploadInput.files = selected.files;
        await app.handleUserFilesUpload();
    });
    assert.equal(await page.evaluate(() => window.requests.length), 0);
    assert.match(await page.evaluate(() => window.notification.message), /50 MB/);
});

test('switching accounts ignores an old listing and isolates manifests', { skip: !executablePath }, async t => {
    const page = await setup(t);
    await page.evaluate(() => {
        app.userFilesCache = [{ id: 'old-file' }];
        app.localFileManifest = { 'old-file': { local_path: '/old/private' } };
        window.fetch = () => new Promise(resolve => { window.finishOldRequest = resolve; });
        window.oldLoad = app.loadUserFiles(false, true);
    });
    await page.waitForFunction(() => Boolean(window.finishOldRequest));
    await page.evaluate(async () => {
        app._setVaultAccount('00000000-0000-4000-8000-000000000002');
        window.finishOldRequest(Response.json({ ok: true, files: [{ id: 'private-old-file' }], storage: { used_bytes: 12 } }));
        await window.oldLoad;
    });
    assert.deepEqual(await page.evaluate(() => app.userFilesCache), []);
    assert.deepEqual(await page.evaluate(() => app.localFileManifest), {});
    assert.match(await page.evaluate(() => app.userFilesManifestPath), /00000000-0000-4000-8000-000000000002\/manifest.json$/);
    assert.equal(await page.evaluate(() => app.userFilesStorage), null);
});

test('a late download cannot enter the next account cache', { skip: !executablePath }, async t => {
    const page = await setup(t);
    await page.evaluate(() => {
        window.fetch = async () => ({ ok: true, arrayBuffer: () => new Promise(resolve => { window.finishDownload = resolve; }) });
        window.oldDownload = app._downloadAndCacheFile({ id: 'old-file', file_name: 'private.txt' });
    });
    await page.waitForFunction(() => Boolean(window.finishDownload));
    await page.evaluate(async () => {
        app._setVaultAccount('00000000-0000-4000-8000-000000000002');
        window.finishDownload(new Uint8Array([1, 2, 3]).buffer);
        await window.oldDownload;
    });
    assert.deepEqual(await page.evaluate(() => app.localFileManifest), {});
});
