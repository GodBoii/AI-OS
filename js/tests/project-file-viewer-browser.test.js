const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('file viewer highlights source, isolates previews and follows the theme', { skip: !executablePath }, async t => {
    const chat = fs.readFileSync(path.join(root, 'chat.html'), 'utf8');
    const markup = chat.slice(chat.indexOf('<div id="project-main-file-preview"'), chat.indexOf('<div id="project-local-terminal-overlay"'));
    const tabs = chat.match(/<nav class="ghp-tabs[\s\S]*?<\/nav>/)[0];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const file = url.pathname.slice(1);
        if (/^(css\/[\w-]+\.css|js\/(project-file-viewer|project-workspace|feature-loader)\.js|js\/vendor\/[\w.-]+\.js|node_modules\/dompurify\/dist\/purify.min.js|node_modules\/highlight.js\/es\/languages\/[\w-]+\.js)$/.test(file)) {
            res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
            res.end(fs.readFileSync(path.join(root, file)));
            return;
        }
        res.setHeader('Content-Type', 'text/html');
        res.end(`<!doctype html><html><head>${['design-system', 'artifact-ui', 'project-workspace', 'github-panel'].map(sheet => `<link rel="stylesheet" href="/css/${sheet}.css">`).join('')}
            <style>body{margin:16px;--chat-max-width:900px;--window-bg:#fafafa;--elevated-bg:#f0f0f2;--text-color:#222;--text-secondary:#666;--border-primary:#ccc;--accent-color:#0078d4}body.dark-mode{background:#111;--window-bg:#181818;--elevated-bg:#222;--text-color:#eee;--text-secondary:#aaa;--border-primary:#444}.hidden{display:none}.github-panel{position:relative;left:0;top:0;margin-top:12px}</style>
            </head><body>${markup}<div class="github-panel">${tabs}<input type="checkbox" aria-label="Amend"></div><div id="tree"></div><pre id="preview"></pre>
            <script src="/js/vendor/highlight-11.7.0.min.js"></script><script src="/js/vendor/marked-9.1.6.min.js"></script><script src="/node_modules/dompurify/dist/purify.min.js"></script><script src="/js/feature-loader.js"></script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
        const module = await import('/js/project-workspace.js');
        const workspace = Object.create(Object.getPrototypeOf(module.default));
        workspace.workspaceStates = new Map();
        window.currentConversationId = 'viewer';
        workspace.activeProject = {};
        workspace.latestSyncedPaths = [];
        workspace.el = {
            tree: document.getElementById('tree'), previewContent: document.getElementById('preview'),
            mainPreview: document.getElementById('project-main-file-preview'),
            mainPreviewTitle: document.getElementById('project-main-file-preview-title'),
            mainPreviewContent: document.getElementById('project-main-file-preview-content'),
            mainPreviewCloseBtn: document.getElementById('project-main-file-preview-close'),
        };
        workspace.callApi = async (_url, _method, payload) => ({ content: window.files[payload.path] || '' });
        window.files = { 'main.py': 'from pathlib import Path\n\ndef main():\n    return "<safe>"\n',
            'README.md': '# Project notes\n\nA **formatted** document.\n\n```javascript\nconst count = 3;\n```\n\n<img src="https://example.invalid/tracker" onerror="window.previewEscaped=true"><script>window.previewEscaped=true</script>',
            'index.html': '<h1>HTML preview</h1><script>parent.previewEscaped=true</script><img src="https://example.invalid/tracker"><a href="https://example.invalid">Leave</a>',
            'diagram.mmd': 'graph LR\n A[Source] --> B[Preview]',
            'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>',
        };
        window.workspace = workspace;
        await workspace.openFilePreview('main.py');
    });
    assert.equal(await page.$eval('.project-main-file-preview-content code', el => el.textContent), await page.evaluate(() => files['main.py']));
    assert.ok(await page.$('.project-main-file-preview-content .hljs-keyword'));
    assert.equal(await page.$eval('.project-file-view-toggle', el => el.hidden), true);
    await page.evaluate(async () => { files['start.ps1'] = 'function Start-Task { Write-Host "Ready" }'; await workspace.openFilePreview('start.ps1'); });
    assert.ok(await page.$('.project-main-file-preview-content .hljs-keyword'));

    await page.evaluate(() => workspace.openFilePreview('README.md'));
    await page.focus('.project-file-view-toggle');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.project-file-markdown h1');
    assert.equal(await page.$eval('.project-file-markdown h1', el => el.textContent), 'Project notes');
    assert.ok(await page.$('.project-file-markdown .hljs-keyword'));
    assert.equal(await page.evaluate(() => window.previewEscaped), undefined);
    assert.equal(await page.$eval('.project-file-markdown img', el => el.hasAttribute('src')), false);
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('.project-main-file-preview-content code', el => el.textContent), await page.evaluate(() => files['README.md']));

    for (const file of ['index.html', 'icon.svg']) {
        await page.evaluate(file => workspace.openFilePreview(file), file);
        await page.click('.project-file-view-toggle');
        await page.waitForSelector('.project-main-file-preview-content iframe');
        assert.equal(await page.$eval('iframe', el => el.getAttribute('sandbox')), '');
        const frame = await (await page.$('iframe')).contentFrame();
        await frame.waitForSelector(file.endsWith('svg') ? 'circle' : 'h1');
        assert.equal(await page.evaluate(() => window.previewEscaped), undefined);
    }

    await page.evaluate(() => workspace.openFilePreview('diagram.mmd'));
    await page.click('.project-file-view-toggle');
    await page.waitForSelector('.project-file-diagram svg');
    assert.ok(await page.$eval('.project-file-diagram svg', el => el.getBoundingClientRect().width > 50));
    await page.evaluate(async () => {
        files['flow.md'] = '# Data flow\n\n```mermaid\ngraph LR\n A --> B\n```';
        await workspace.openFilePreview('flow.md');
    });
    await page.click('.project-file-view-toggle');
    await page.waitForSelector('.project-file-markdown .project-file-diagram svg');
    await page.evaluate(async () => {
        files['diagram.mmd'] = 'not a valid diagram !!!';
        await workspace.openFilePreview('diagram.mmd');
    });
    await page.click('.project-file-view-toggle');
    await page.waitForSelector('.project-file-view-notice');
    await page.click('.project-file-view-toggle');
    assert.equal(await page.$eval('.project-main-file-preview-content code', el => el.textContent), 'not a valid diagram !!!');

    await page.evaluate(() => workspace.openFilePreview('main.py'));
    for (const dark of [false, true]) {
        for (const width of [1280, 390]) {
            await page.setViewport({ width, height: 900 });
            await page.evaluate(dark => document.body.classList.toggle('dark-mode', dark), dark);
            const theme = await page.evaluate(() => ({
                token: getComputedStyle(document.querySelector('.hljs-keyword')).color,
                text: getComputedStyle(document.querySelector('.project-main-file-preview-content')).color,
                tabs: getComputedStyle(document.querySelector('.ghp-tabs')).backgroundColor,
                scheme: getComputedStyle(document.querySelector('.github-panel')).colorScheme,
                fits: document.documentElement.scrollWidth <= innerWidth,
            }));
            assert.notEqual(theme.token, theme.text);
            assert.equal(await page.$eval('.project-main-file-preview-content pre', el => getComputedStyle(el).textAlign), 'start');
            assert.equal(theme.fits, true);
            if (dark) { assert.equal(theme.scheme, 'dark'); assert.equal(theme.tabs, 'rgba(255, 255, 255, 0.035)'); }
            await page.screenshot({ path: path.join(os.tmpdir(), `project-viewer-${dark ? 'dark' : 'light'}-${width}.png`) });
        }
    }
    await page.evaluate(() => workspace.openFilePreview('README.md'));
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await page.$eval('.t-icon', el => getComputedStyle(el).transitionDuration), '0s');
    assert.deepEqual(errors, []);
});

test('workspace discards stale previews and coalesces tree refreshes', { skip: !executablePath }, async t => {
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="tree"></div><pre id="preview"></pre>');
    const source = fs.readFileSync(path.join(root, 'js/project-workspace.js'), 'utf8');
    await page.addScriptTag({ content: `${source.slice(0, source.indexOf('const projectWorkspace = new ProjectWorkspace();'))}\nwindow.ProjectWorkspace = ProjectWorkspace;` });
    const result = await page.evaluate(async () => {
        const workspace = Object.create(ProjectWorkspace.prototype);
        workspace.workspaceStates = new Map();
        workspace.el = { tree: document.getElementById('tree'), previewContent: document.getElementById('preview') };
        window.currentConversationId = 'race';
        const pending = {};
        workspace.callApi = (_url, _method, payload) => new Promise(resolve => { pending[payload.path] = resolve; });
        const older = workspace.openFilePreview('old.js');
        const newer = workspace.openFilePreview('new.js');
        pending['new.js']({ content: 'new' });
        await newer;
        pending['old.js']({ content: 'old' });
        await older;
        const content = workspace.el.previewContent.textContent;
        let finish;
        let scans = 0;
        workspace.loadWorkspaceTree = () => { scans++; return new Promise(resolve => { finish = resolve; }); };
        const first = workspace.syncWorkspaceTree();
        const second = workspace.syncWorkspaceTree();
        finish();
        await Promise.all([first, second]);
        clearTimeout(workspace.syncDebounceTimer);
        return { content, scans };
    });
    assert.deepEqual(result, { content: 'new', scans: 1 });
    const tree = await page.evaluate(async () => {
        const workspace = Object.create(ProjectWorkspace.prototype);
        workspace.workspaceStates = new Map();
        workspace.el = { tree: document.getElementById('tree'), previewContent: document.getElementById('preview') };
        workspace.activeProject = {};
        workspace.latestSyncedPaths = [];
        workspace.getState().workspace_mode = 'local';
        workspace.getState().local_context = { is_ready: true, root_path: '/first' };
        workspace.setStatus = () => {};
        let resolveTree;
        workspace.callLocalInvoke = () => new Promise(resolve => { resolveTree = resolve; });
        const stale = workspace.syncWorkspaceTree();
        await Promise.resolve();
        workspace.getState().local_context.root_path = '/second';
        resolveTree({ success: true, files: [{ path: 'stale.js' }] });
        await stale;
        const discarded = !workspace.el.tree.querySelector('[data-path="stale.js"]');
        workspace.callLocalInvoke = async () => ({ success: true, files: [{ path: 'src/new.js' }] });
        await workspace.syncWorkspaceTree();
        const original = workspace.el.tree.firstElementChild;
        workspace.selectedFilePath = 'src/new.js';
        workspace.el.previewContent.textContent = 'Keep this preview';
        await workspace.syncWorkspaceTree();
        return { discarded, reused: original === workspace.el.tree.firstElementChild,
            preview: workspace.el.previewContent.textContent };
    });
    assert.deepEqual(tree, { discarded: true, reused: true, preview: 'Keep this preview' });
});
