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

test('artifact inspection preserves source and supports responsive keyboard controls', { skip: !executablePath }, async t => {
    const server = http.createServer((req, res) => {
        const files = {
            '/js/artifact-handler.js': 'text/javascript', '/js/presentation-metadata.mjs': 'text/javascript',
            '/js/message-formatter.js': 'text/javascript',
            '/css/artifact-ui.css': 'text/css', '/css/design-system.css': 'text/css',
        };
        if (/^\/css\/[a-z0-9-]+\.css$/.test(req.url) && fs.existsSync(path.join(root, req.url))) files[req.url] = 'text/css';
        if (files[req.url]) {
            res.setHeader('Content-Type', files[req.url]);
            res.end(fs.readFileSync(path.join(root, req.url)));
            return;
        }
        const integration = req.url === '/integration';
        const styles = integration
            ? [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^\"]+)"/g)].map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('')
            : '<link rel="stylesheet" href="/css/design-system.css"><link rel="stylesheet" href="/css/artifact-ui.css">';
        res.end(`<!doctype html><html><head>${styles}<style>:root{--window-bg:#fafafa;--card-bg:#fff;--code-bg:#f4f4f5;--text-color:#18181b;--text-primary:#18181b;--text-secondary:#52525b;--border-color:#d4d4d8;--hover-bg:#e4e4e7;--accent-color:#2563eb;--font-mono:monospace;--font-sans:Arial;--text-sm:13px}body{margin:0;background:#e4e4e7}.hidden{display:none}.artifact-container.hidden{display:flex}</style></head><body class="${integration ? 'dark-mode' : ''}"><button id="opener">Open artifact</button><div class="chat-container"><div class="chat-window"><div class="conversation-title-bar fade-in">CPU architecture diagram</div><div class="chat-messages"><div class="message-text">Conversation stays behind the expanded viewer.</div></div></div></div><div class="floating-input-container"><button>Ask anything</button></div><script type="module" src="/js/artifact-handler.js"></script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.artifactHandler);
    await page.focus('#opener');
    const source = 'const label = "<hello>";\n' + 'const longLine = "' + 'a'.repeat(220) + '";\n';
    await page.evaluate(source => artifactHandler.showArtifact('javascript', source, null, { title: 'example.js' }), source);
    assert.equal(await page.$eval('.artifact-code code', el => el.textContent), source);
    if (process.env.ARTIFACT_SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.ARTIFACT_SCREENSHOT_DIR, 'artifact-code-1440.png') });
    }
    await page.click('.artifact-local-toolbar button');
    assert.equal(await page.$eval('.artifact-code', el => el.classList.contains('artifact-code-wrapped')), true);
    assert.equal(await page.$eval('.artifact-code code', el => el.textContent), source);
    await page.click('.expand-artifact-btn');
    assert.ok(await page.$eval('#artifact-container', el => el.clientWidth > 1300));
    await page.evaluate(async () => { await Promise.all(document.getElementById('artifact-container').getAnimations().map(animation => animation.finished)); });
    assert.equal(await page.$eval('.artifact-window', el => el.getAttribute('aria-modal')), 'true');
    assert.equal(await page.$eval('.chat-container', el => el.inert), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('.expand-artifact-btn', el => el.getAttribute('aria-pressed')), 'false');
    assert.equal(await page.$eval('.chat-container', el => el.inert), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#artifact-container', el => el.inert), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'opener');
    await page.evaluate(() => artifactHandler.showArtifact('markdown', '# Artifact preview', 'markdown-test'));
    await page.click('.view-toggle-btn[data-view="source"]');
    assert.equal(await page.$eval('.artifact-code code', el => el.textContent), '# Artifact preview');
    await page.click('.view-toggle-btn[data-view="preview"]');
    assert.equal(await page.$eval('.artifact-markdown-preview', el => el.textContent.trim()), '# Artifact preview');

    const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#2563eb"/></svg>').toString('base64');
    await page.evaluate(image => artifactHandler.showArtifact('image', image), image);
    await page.waitForFunction(() => document.querySelector('.image-dimensions').textContent === '1200 × 800 px');
    await page.click('[data-zoom="actual"]');
    assert.equal(await page.$eval('.generated-image-artifact', el => el.getBoundingClientRect().width), 1200);
    await page.focus('.artifact-image-stage');
    await page.keyboard.press('0');
    assert.equal(await page.$eval('.artifact-image-stage', el => el.classList.contains('actual-size')), false);
    assert.equal(await page.$eval('.generated-image-artifact', el => {
        const rect = el.getBoundingClientRect();
        const stage = el.parentElement.getBoundingClientRect();
        return rect.width <= stage.width && rect.height <= stage.height;
    }), true);
    if (process.env.ARTIFACT_SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.ARTIFACT_SCREENSHOT_DIR, 'artifact-image-1440.png') });
    }
    await page.click('.expand-artifact-btn');

    await page.evaluate(image => artifactHandler.showArtifact('presentation', {
        title: 'Quarterly results', inline: { slides: [
            { index: 1, title: 'Overview', preview_data_uri: image },
            { index: 2, title: 'Next steps', bullets: ['Review the plan'] },
        ] },
    }), image);
    await page.evaluate(async () => { await Promise.all(document.getElementById('artifact-container').getAnimations().map(animation => animation.finished)); });
    await page.click('[data-slide="next"]');
    assert.match(await page.$eval('.slide-position', el => el.textContent), /Slide 2 of 2.*Layout preview/);
    await page.focus('.presentation-reader');
    await page.keyboard.press('ArrowLeft');
    assert.match(await page.$eval('.slide-position', el => el.textContent), /Slide 1 of 2/);
    for (const width of [1440, 1280, 1024]) {
        await page.setViewport({ width, height: 900 });
        assert.equal(await page.$eval('#artifact-container', el => el.scrollWidth <= el.clientWidth), true);
        assert.equal(await page.$eval('.artifact-header', el => el.scrollWidth <= el.clientWidth), true);
        assert.equal(await page.$eval('.close-artifact-btn', el => el.getBoundingClientRect().right <= window.innerWidth), true);
        if (process.env.ARTIFACT_SCREENSHOT_DIR) {
            await page.screenshot({ path: path.join(process.env.ARTIFACT_SCREENSHOT_DIR, `artifact-slides-${width}.png`) });
        }
    }
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await page.$eval('#artifact-container', el => getComputedStyle(el).transitionDuration), '0s');
    await page.evaluate(() => {
        document.documentElement.style.cssText = '--window-bg:#18181b;--card-bg:#27272a;--code-bg:#09090b;--text-color:#fafafa;--text-primary:#fafafa;--text-secondary:#a1a1aa;--border-color:#3f3f46;--hover-bg:#3f3f46';
        document.body.classList.add('dark-mode');
    });
    if (process.env.ARTIFACT_SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.ARTIFACT_SCREENSHOT_DIR, 'artifact-slides-dark-1024.png') });
    }
    await page.evaluate(() => artifactHandler.showArtifact('presentation', { inline: { slides: [] } }));
    assert.match(await page.$eval('.presentation-artifact-empty', el => el.textContent), /No slide preview/);
    if (process.env.ARTIFACT_MERMAID_FILE) {
        await page.addScriptTag({ path: process.env.ARTIFACT_MERMAID_FILE });
        await page.evaluate(() => {
            mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
            artifactHandler.showArtifact('mermaid', 'graph LR\nA[Create] --> B[Review] --> C[Export]');
        });
        await page.waitForSelector('.mermaid svg');
        await page.waitForFunction(() => document.querySelector('.mermaid-pan-container').style.width.endsWith('px'));
        const visible = await page.$eval('.mermaid svg', el => {
            const rect = el.getBoundingClientRect();
            const stage = el.closest('.mermaid-interactive').getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.left >= stage.left - 1 && rect.right <= stage.right + 1;
        });
        assert.equal(visible, true);
        await page.click('.zoom-in-btn');
        await page.click('.view-toggle-btn[data-view="source"]');
        assert.match(await page.$eval('.artifact-code code', el => el.textContent), /A\[Create\]/);
        await page.click('.view-toggle-btn[data-view="preview"]');
        await page.waitForSelector('.mermaid svg');
        if (process.env.ARTIFACT_SCREENSHOT_DIR) {
            await page.screenshot({ path: path.join(process.env.ARTIFACT_SCREENSHOT_DIR, 'artifact-mermaid-1024.png') });
        }
    }
    const integrated = await browser.newPage();
    integrated.on('pageerror', error => errors.push(error.message));
    await integrated.setViewport({ width: 1440, height: 900 });
    await integrated.goto(`http://127.0.0.1:${server.address().port}/integration`);
    await integrated.waitForFunction(() => window.artifactHandler);
    await integrated.evaluate(() => artifactHandler.showArtifact('html', '<!DOCTYPE html>\n<html>\n<head><title>My first page</title></head>\n<body><h1>Hello, world!</h1></body>\n</html>', null, { defaultView: 'source' }));
    await integrated.hover('.expand-artifact-btn');
    assert.equal(await integrated.evaluate(() => {
        const button = document.querySelector('.view-toggle-btn.active');
        const pill = document.querySelector('.t-tabs-pill');
        return Math.abs(button.getBoundingClientRect().left - pill.getBoundingClientRect().left) <= 1 && pill.getBoundingClientRect().width === button.offsetWidth;
    }), true);
    await integrated.waitForFunction(() => getComputedStyle(document.querySelector('.expand-artifact-btn .artifact-icon')).transform !== 'none');
    if (process.env.ARTIFACT_SCREENSHOT_DIR) {
        await integrated.screenshot({ path: path.join(process.env.ARTIFACT_SCREENSHOT_DIR, 'artifact-toolbar-hover-dark.png') });
    }
    await integrated.click('.expand-artifact-btn');
    assert.equal(await integrated.$eval('.expand-artifact-btn', el => el.classList.contains('is-activating')), true);
    await integrated.evaluate(async () => { await Promise.all(document.getElementById('artifact-container').getAnimations().map(animation => animation.finished)); });
    assert.equal(await integrated.evaluate(() => document.getElementById('artifact-container').contains(document.elementFromPoint(400, 180))), true);
    assert.equal(await integrated.$eval('.expand-artifact-btn .artifact-expand-label', el => el.textContent), 'Restore');
    assert.equal(await integrated.$eval('.expand-artifact-btn .t-icon-swap', el => el.dataset.state), 'b');
    await integrated.focus('.artifact-local-toolbar button');
    await integrated.keyboard.press('Tab');
    assert.equal(await integrated.evaluate(() => document.activeElement.dataset.view), 'preview');
    if (process.env.ARTIFACT_SCREENSHOT_DIR) {
        await integrated.screenshot({ path: path.join(process.env.ARTIFACT_SCREENSHOT_DIR, 'artifact-expanded-dark.png') });
    }
    await integrated.keyboard.press('Escape');
    assert.equal(await integrated.$eval('.artifact-window', el => el.getAttribute('aria-modal')), null);
    await integrated.evaluate(async () => { await Promise.all(document.getElementById('artifact-container').getAnimations().map(animation => animation.finished)); });
    await browser.defaultBrowserContext().overridePermissions(`http://127.0.0.1:${server.address().port}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    await integrated.click('.copy-artifact-btn');
    await integrated.waitForSelector('.copy-artifact-btn.is-copied', { timeout: 3000 });
    assert.equal((await integrated.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), '<!DOCTYPE html>\n<html>\n<head><title>My first page</title></head>\n<body><h1>Hello, world!</h1></body>\n</html>');
    await integrated.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await integrated.click('.expand-artifact-btn');
    assert.equal(await integrated.$eval('#artifact-container', el => el.getAnimations().length), 0);
    await integrated.click('.close-artifact-btn');
    assert.equal(await integrated.$eval('.chat-container', el => el.inert), false);

    if (process.env.ARTIFACT_MERMAID_FILE && process.env.ARTIFACT_MARKED_FILE && process.env.ARTIFACT_HIGHLIGHT_FILE) {
        await page.addScriptTag({ path: process.env.ARTIFACT_MARKED_FILE });
        await page.addScriptTag({ path: process.env.ARTIFACT_HIGHLIGHT_FILE });
        await page.addScriptTag({ path: path.join(root, 'node_modules/dompurify/dist/purify.js') });
        await page.evaluate(async () => {
            const { messageFormatter } = await import('/js/message-formatter.js');
            window.formatter = messageFormatter;
            window.mermaidRenderCalls = 0;
            const init = mermaid.init.bind(mermaid);
            mermaid.init = (...args) => { window.mermaidRenderCalls++; return init(...args); };
            const tokenParts = ['```mermaid\n', 'graph LR\n', 'A[Create]', ' --> B[Review]\n', '```\n', 'Explanation ', 'continues ', 'streaming.'];
            const target = document.createElement('div');
            document.body.append(target);
            for (const inlineArtifacts of [false, true]) {
                for (const token of tokenParts) {
                    target.innerHTML = formatter.formatStreaming(token, `stream-${inlineArtifacts}`, { inlineArtifacts });
                    if (inlineArtifacts) formatter.applyInlineEnhancements(target);
                }
            }
        });
        assert.equal(await page.evaluate(() => window.mermaidRenderCalls), 0);
        const artifactCount = await page.evaluate(() => artifactHandler.artifacts.size);
        await page.evaluate(() => formatter.format(formatter.getFinalContent('stream-false')));
        await page.waitForFunction(() => window.mermaidRenderCalls === 1);
        await page.waitForSelector('#artifact-container .mermaid svg');
        assert.equal(await page.evaluate(() => artifactHandler.artifacts.size), artifactCount + 1);
        await page.evaluate(() => formatter.finishStreamingForAllOwners('stream-'));
        assert.equal(await page.evaluate(() => formatter.pendingContent.size), 0);
    }
    assert.deepEqual(errors, []);
});
