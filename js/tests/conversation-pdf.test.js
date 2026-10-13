const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const puppeteer = require('puppeteer-core');
const parsePdf = require('pdf-parse');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('scope selection excludes empty attachment-only turns and associates latest files', async () => {
    const { selectConversationPdfTurns } = await import('../conversation-pdf-export.mjs');
    const turns = [{ role: 'user', text: 'First prompt', attachments: [{ name: 'first.pdf' }] },
        { role: 'assistant', html: '<p>First answer</p>' },
        { role: 'user', text: '', attachments: [{ name: 'second.png' }] },
        { role: 'assistant', html: '<p>Latest answer</p>' }];
    const original = JSON.stringify(turns);
    const latest = selectConversationPdfTurns(turns, { scope: 'latest', includeAttachments: true });
    assert.equal(latest.length, 1);
    assert.deepEqual(latest[0].attachments, [{ name: 'second.png' }]);
    assert.equal(selectConversationPdfTurns(turns, { scope: 'entire', includeAttachments: false }).length, 3);
    assert.deepEqual(selectConversationPdfTurns(turns.slice(0, 1), { scope: 'latest', includeAttachments: true }), []);
    assert.equal(JSON.stringify(turns), original);
});

test('conversation export preserves content and handles save outcomes', { skip: !executablePath }, async t => {
    const imageBytes = Array.from(fs.readFileSync(path.join(__dirname, 'fixtures/generated-image.png')));
    const server = http.createServer((req, res) => {
        if (['/js/ui-utilities.js', '/js/conversation-pdf.mjs', '/js/conversation-pdf-export.mjs'].includes(req.url)
            || /^\/css\/[a-z0-9-]+\.css$/.test(req.url) && fs.existsSync(path.join(root, req.url))) {
            res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
            res.end(fs.readFileSync(path.join(root, req.url)));
            return;
        }
        res.setHeader('Content-Type', 'text/html');
        const styles = req.url === '/integration'
            ? [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="(css\/[^\"]+)"/g)].map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('')
            : '<link rel="stylesheet" href="/css/design-system.css">';
        res.end(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self';">${styles}<button id="opener">Export</button><div id="chat-messages">
            <div class="conversation-thread" style="display:none"><div class="message message-user"><div class="user-message-text">Inactive conversation</div></div></div>
            <div class="conversation-thread active" data-conversation-id="pdf-test">
                <div class="message message-user" data-context='{"files":[{"name":"notes & plans.pdf","type":"application/pdf","url":"https://example.com/notes.pdf"}]}'><div class="user-message-text">Keep &lt;angle brackets&gt; &amp; symbols.
Second line.</div></div>
                <div class="message message-bot"><div class="detailed-logs">Private tool logs</div><div class="message-content"><div class="content-block"><div class="inner-content">
                    <h2>Design review</h2><p>The answer contains <strong>bold text</strong> and a <a href="https://example.com/source">source link</a>.</p>
                    <blockquote><p>A useful quotation.</p></blockquote>
                    <div class="code-block-wrapper"><button class="code-copy-btn">Copy</button><pre><code class="language-js">const answer = "&lt;ready&gt;";</code></pre></div>
                    <div class="table-container"><table><thead><tr><th>Item</th><th>Value</th></tr></thead><tbody><tr><td>First</td><td>42</td></tr></tbody></table></div>
                    <img src="blob:missing" alt="Original image"><button class="view-turn-context-btn">Context</button>
                </div></div></div><div class="message-actions">Actions</div></div>
                <div class="message message-user" data-context='{"files":[{"name":"photo.png","type":"image/png","relativePath":"attachments/test/photo.png","previewUrl":"blob:expired"}]}'></div>
                <div class="message message-bot"><div class="message-content"><p>Latest answer.</p></div></div>
            </div></div><script type="module">
                window.calls = []; window.archiveReads = []; window.outcome = { success: true };
                window.electron = { auth: { fetchSessionData: async () => ({ session_title: 'Design / review: <draft>' }) },
                    fileArchive: { readFile: async path => { archiveReads.push(path); return new Uint8Array(${JSON.stringify(imageBytes)}); } },
                    ipcRenderer: { invoke: async (channel, payload) => { calls.push({ channel, payload }); return outcome; } } };
                const utilities = await import('/js/ui-utilities.js');
                window.pdfExport = utilities.exportActiveConversationPdf;
                window.installMessageActions = utilities.addMessageActionButtons;
            </script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.pdfExport);
    const source = await page.$eval('#chat-messages', node => node.innerHTML);
    const openExport = async () => {
        await page.bringToFront();
        await page.focus('#opener');
        await page.evaluate(() => { window.exportRun = pdfExport(); });
        await page.waitForSelector('.pdf-export-dialog[open]');
    };
    const submitExport = async expectedCalls => {
        await page.click('.pdf-export-submit');
        await page.waitForFunction(count => calls.length === count && !document.querySelector('.pdf-export-form[aria-busy]'), {}, expectedCalls);
    };
    await openExport();
    assert.equal(await page.evaluate(() => calls.length), 0);
    assert.match(await page.$eval('.pdf-export-summary', node => node.textContent), /4 messages.*2 attachments/);
    for (let i = 0; i < 9; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.$eval('.pdf-export-dialog', node => node.contains(document.activeElement)), true);
    }
    for (const [width, dark] of [[1440, false], [1440, true], [390, false]]) {
        await page.setViewport({ width, height: 900 });
        await page.evaluate(dark => document.body.classList.toggle('dark-mode', dark), dark);
        await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished)); });
        assert.equal(await page.$eval('.pdf-export-dialog', node => node.scrollWidth <= node.clientWidth), true);
        assert.ok(await page.$eval('.pdf-export-dialog', node => Math.abs(node.getBoundingClientRect().left + node.getBoundingClientRect().width / 2 - innerWidth / 2) < 2));
        if (process.env.CONVERSATION_PDF_OUTPUT_DIR) await page.screenshot({ path: path.join(process.env.CONVERSATION_PDF_OUTPUT_DIR, `export-options-${dark ? 'dark' : 'light'}-${width}.png`) });
    }
    await page.setViewport({ width: 1440, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.ok(await page.$eval('.pdf-export-dialog', node => parseFloat(getComputedStyle(node).transitionDuration) <= .001));
    await page.keyboard.press('Escape');
    await page.evaluate(() => exportRun);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'opener');
    assert.equal(await page.evaluate(() => calls.length), 0);
    await openExport();
    await submitExport(1);
    await page.evaluate(() => exportRun);
    const { channel, payload } = await page.evaluate(() => calls[0]);
    assert.equal(channel, 'export-conversation-pdf');
    assert.equal(payload.defaultPath, 'Design review draft.pdf');
    assert.match(payload.html, /Design \/ review: &lt;draft&gt;/);
    assert.doesNotMatch(payload.html, /Inactive conversation|Private tool logs|>Copy<|>Context<|message-actions/);
    assert.equal(await page.$eval('#chat-messages', node => node.innerHTML), source);
    assert.match(await page.$eval('.notification', node => node.textContent), /exported successfully/);

    const preview = await browser.newPage();
    const requests = [];
    preview.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
    await preview.setOfflineMode(true);
    await preview.setContent(payload.html);
    assert.deepEqual(requests, []);
    assert.equal(await preview.$eval('.user-body', node => node.textContent), 'Keep <angle brackets> & symbols.\nSecond line.');
    assert.equal(await preview.$eval('pre code', node => node.textContent), 'const answer = "<ready>";');
    assert.equal(await preview.$eval('.assistant-rich a', node => node.href), 'https://example.com/source');
    assert.match(await preview.$eval('.pdf-image-placeholder', node => node.textContent), /Image unavailable: Original image/);
    assert.equal(await preview.$eval('.brand-logo', node => node.getAttribute('aria-label')), 'Aetheria ai logo');
    assert.match(await preview.$eval('.attachment-preview img', node => node.src), /^data:image\/png/);
    assert.equal(await preview.$eval('.attachment-link', node => node.href), 'https://example.com/notes.pdf');
    assert.deepEqual(await page.evaluate(() => archiveReads), ['attachments/test/photo.png']);
    for (const width of [1440, 794, 390]) {
        await preview.setViewport({ width, height: 1000 });
        assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.CONVERSATION_PDF_OUTPUT_DIR) {
            await preview.screenshot({ path: path.join(process.env.CONVERSATION_PDF_OUTPUT_DIR, `conversation-${width}.png`), fullPage: true });
        }
    }

    await page.evaluate(() => {
        document.querySelectorAll('.notification').forEach(node => node.remove());
        outcome = { canceled: true };
    });
    await openExport();
    await page.click('[value="latest"]');
    await page.click('[name="attachments"]');
    assert.match(await page.$eval('.pdf-export-summary', node => node.textContent), /1 message.*0 attachments/);
    await submitExport(2);
    assert.equal(await page.$('.notification'), null);
    const latestPayload = await page.evaluate(() => calls[1].payload);
    assert.match(latestPayload.html, /Latest answer/);
    assert.doesNotMatch(latestPayload.html, /Keep &lt;angle|Design review<\/h2>|photo.png|notes &amp; plans|class="pdf-attachments"/);
    assert.equal(latestPayload.defaultPath, 'Design review draft-latest-response.pdf');
    assert.deepEqual(await page.evaluate(() => archiveReads), ['attachments/test/photo.png']);
    await page.evaluate(() => { outcome = { success: false, error: 'Disk is full' }; });
    await submitExport(3);
    assert.match(await page.$eval('.pdf-export-error', node => node.textContent), /Disk is full/);
    await page.evaluate(() => { outcome = { success: true }; });
    await page.click('[name="attachments"]');
    await submitExport(4);
    await page.evaluate(() => exportRun);
    const latestWithAttachments = await page.evaluate(() => calls[3].payload.html);
    assert.match(latestWithAttachments, /photo.png/);
    assert.doesNotMatch(latestWithAttachments, /notes &amp; plans/);
    await page.evaluate(() => {
        const message = document.querySelector('.conversation-thread.active .message-bot');
        message.querySelector('.message-actions').remove();
        installMessageActions(message);
        navigator.clipboard.writeText = async text => { window.copied = text; };
    });
    await page.click('.message-bot .copy-btn');
    assert.match(await page.evaluate(() => copied), /Design review/);
    await page.click('.message-bot .share-btn');
    await page.click('[data-action="export-pdf"]');
    await page.waitForSelector('.pdf-export-dialog[open]');
    assert.equal(await page.evaluate(() => calls.length), 4);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.pdf-export-dialog'));
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('share-btn')), true);
    await page.evaluate(async () => {
        document.querySelectorAll('.notification').forEach(node => node.remove());
        document.querySelector('.conversation-thread.active').innerHTML = ''; await pdfExport();
    });
    assert.match(await page.$eval('.notification', node => node.textContent), /Start a conversation/);
    assert.equal(await page.evaluate(() => calls.length), 4);
    await page.goto(`http://127.0.0.1:${server.address().port}/integration`);
    await page.waitForFunction(() => window.pdfExport);
    await openExport();
    for (const width of [1440, 390]) {
        await page.setViewport({ width, height: 900 });
        await page.evaluate(() => document.body.classList.add('dark-mode'));
        assert.equal(await page.$eval('.pdf-export-dialog', node => node.scrollWidth <= node.clientWidth), true);
        assert.ok(await page.$eval('.pdf-export-dialog', node => Math.abs(node.getBoundingClientRect().left + node.getBoundingClientRect().width / 2 - innerWidth / 2) < 2));
        if (process.env.CONVERSATION_PDF_OUTPUT_DIR) await page.screenshot({ path: path.join(process.env.CONVERSATION_PDF_OUTPUT_DIR, `export-options-app-${width}.png`) });
    }
    await page.keyboard.press('Escape');
    await page.evaluate(() => exportRun);
    assert.equal(await page.evaluate(() => calls.length), 0);
    assert.deepEqual(errors, []);
});

test('Electron prints offline, selectable, paginated rich conversation content', async t => {
    const { buildConversationPdfHtml } = await import('../conversation-pdf.mjs');
    const directory = process.env.CONVERSATION_PDF_OUTPUT_DIR || await fsp.mkdtemp(path.join(os.tmpdir(), 'aetheria-pdf-'));
    if (!process.env.CONVERSATION_PDF_OUTPUT_DIR) t.after(() => fsp.rm(directory, { recursive: true, force: true }));
    const htmlPath = path.join(directory, 'conversation-rich.html');
    const pdfPath = path.join(directory, 'conversation-rich.pdf');
    const longCode = Array.from({ length: 95 }, (_, i) => `line_${i} = "${'unbroken_value_'.repeat(10)}";`).join('\n');
    const rows = Array.from({ length: 65 }, (_, i) => `<tr><td>Record ${i}</td><td>Value ${i}</td></tr>`).join('');
    const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#dafa68"/></svg>').toString('base64');
    const html = buildConversationPdfHtml([
        { role: 'user', text: 'Review the plan.\nPreserve this line break.', attachments: [{ name: 'specification.pdf', type: 'application/pdf' }] },
        { role: 'assistant', html: `<h2>Review findings</h2><p>Opening paragraph with <a href="https://example.com/source">a source</a>.</p>
            <pre><code>${longCode}</code></pre><h2>Comparison</h2><div class="table-container"><table><thead><tr><th>Record name</th><th>Record value</th></tr></thead><tbody>${rows}</tbody></table></div>
            <blockquote><p>Keep the final quotation.</p></blockquote><img src="${image}" alt="Lime illustration"><p>Last answer line.</p>` },
        { role: 'user', text: 'One more question.' },
        { role: 'assistant', html: '<h3>Final answer</h3><p>The conversation is complete.</p>' },
    ], { title: 'Design review & implementation', timestamp: new Date('2026-10-13T05:02:00Z') });
    await fsp.writeFile(htmlPath, html);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/conversation-pdf-electron.cjs'), htmlPath, pdfPath], { env, timeout: 60000 });
    const pdf = await parsePdf(await fsp.readFile(pdfPath));
    const textContent = pdf.text.replace(/\s+/g, ' ');
    assert.ok(pdf.numpages >= 4, `Expected multi-page content, got ${pdf.numpages}`);
    for (const text of ['Design review & implementation', 'Preserve this line break.', 'specification.pdf', 'line_0', 'line_94', 'Record 0', 'Record 64', 'Last answer line.', 'One more question.', 'The conversation is complete.']) {
        assert.ok(textContent.includes(text), `PDF omitted ${text}`);
    }
    assert.equal((pdf.text.match(/Aetheria ai\s+\/\s+Conversation/g) || []).length, pdf.numpages);
    assert.ok((pdf.text.match(/Record name/g) || []).length >= 2, 'Table headers must repeat across pages');
    assert.doesNotMatch(pdf.text, /data:text\/html|Premium Export/);
});
