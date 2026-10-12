const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');

test('Electron shell preserves background chat, archived actions and workspace first use', async t => {
    const root = path.resolve(__dirname, '../..');
    const archive = process.env.DESKTOP_MEMORY_ASAR;
    const readResource = file => archive
        ? require('@electron/asar').extractFile(archive, path.relative(root, file).replace(/\\/g, '/'))
        : fs.readFileSync(file);
    const requests = [];
    let githubFailed = false;
    const server = http.createServer((req, res) => {
        requests.push(req.url);
        if (req.url.startsWith('/js/github-panel.js') && !githubFailed) {
            githubFailed = true;
            res.writeHead(503); res.end(); return;
        }
        const file = path.resolve(root, `.${req.url === '/' ? '/index.html' : req.url.split('?')[0]}`);
        if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(404); res.end(); return;
        }
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css'
            : /\.(?:js|mjs)$/.test(file) ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream');
        res.end(readResource(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ executablePath: require('electron'), ignoreDefaultArgs: true,
        args: [path.join(__dirname, 'fixtures/settings-electron.cjs'), '--remote-debugging-port=0'] });
    t.after(() => browser.close());
    const page = (await browser.pages())[0];
    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() !== 'debug') consoleErrors.push(message.text()); });
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (request.url().startsWith('http://127.0.0.1:') || /^(?:data:|blob:|about:)/.test(request.url())) request.continue();
        else if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') request.respond({ status: 200,
            contentType: 'application/json', body: JSON.stringify({ ok: true, files: [], deployments: [], memories: [],
                rows: [{ date: '2026-10-12', total_tokens: 10 }], storage: { used_bytes: 0 }, integrations: {}, summary: null, content: [] }) });
        else request.abort();
    });
    await page.evaluateOnNewDocument(() => {
        const listeners = new Map();
        const disk = new Map();
        const user = { id: 'memory-test-user', email: 'test@example.test', user_metadata: { name: 'Tester' } };
        window.sentMessages = [];
        window.emitIpc = async (channel, payload) => { await Promise.all((listeners.get(channel) || []).map(callback => callback(payload))); };
        const authCallbacks = [];
        window.electron = {
            platform: 'win32',
            path: { join: (...parts) => parts.join('/'), basename: p => p.split('/').pop(), dirname: p => p.split('/').slice(0, -1).join('/') },
            fs: { promises: { mkdir: async () => {}, writeFile: async (p, value) => disk.set(p, value),
                readFile: async p => { if (!disk.has(p)) throw Object.assign(new Error('Missing file'), { code: 'ENOENT' }); return disk.get(p); },
                access: async p => { if (!disk.has(p)) throw Object.assign(new Error('Missing file'), { code: 'ENOENT' }); }, unlink: async p => disk.delete(p) } },
            auth: { init: async () => {}, getSession: async () => ({ user, access_token: 'fixture-token' }),
                getCurrentUser: () => user, isAuthenticated: () => true,
                onAuthChange: callback => { authCallbacks.push(callback); return () => {}; },
                fetchSessionTitles: async () => [], fetchSessionData: async () => ({ runs: [] }),
                fetchSessionAttachments: async () => [], insertAttachments: async () => ({ error: null }) },
            ipcRenderer: {
                on(channel, callback) { const entries = listeners.get(channel) || []; entries.push(callback); listeners.set(channel, entries);
                    return () => listeners.set(channel, entries.filter(entry => entry !== callback)); },
                send(channel, payload) { if (channel === 'send-message' && payload?.type !== 'terminate_session') window.sentMessages.push(payload);
                    if (channel === 'check-socket-connection') void window.emitIpc('socket-connection-status', { connected: true }); },
                invoke: async channel => channel === 'get-path' ? '/fixture' : channel === 'browser-settings:get' ? { visibility: 'headless' }
                    : channel === 'computer-get-access-state' ? { success: true, state: { enabled: false, scopes: [] } }
                    : { success: true, canceled: true, available: false },
            },
            tasks: { list: async () => [], subscribe: () => ({ unsubscribe() {} }) },
            os: { userInfo: async () => ({ username: 'Tester' }) },
            nativeSpeech: { getStatus: async () => ({ available: false }), onEvent: () => () => {} },
            shell: { openPath: async () => '', openExternal: async () => {} },
        };
        window.signOutFixture = () => authCallbacks.forEach(callback => callback(null));
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.currentConversationId && document.getElementById('floating-input') && window.AIOS?.initialized,
        { timeout: 5000 }).catch(async error => { throw new Error(JSON.stringify({ error: error.message, errors, consoleErrors,
            requests: requests.filter(url => /\.js|\.html/.test(url)), state: await page.evaluate(() => ({
                auth: window._authGateAuthenticated, chat: !!window.chatModule, aios: window.AIOS?.initialized,
                conversation: window.currentConversationId, input: !!document.getElementById('floating-input'),
                ready: document.readyState, electron: !!window.electron?.auth, manager: !!window.uiManager, gate: !!window.AuthGate,
            })) })); });
    assert.equal(requests.some(url => /mermaid-10|chart\.umd|xterm\.js|project-workspace\.js|computer-workspace\.js/.test(url)), false);
    const result = await page.evaluate(async () => {
        const ids = [];
        for (let i = 0; i < 5; i++) {
            if (i) await chatModule.startNewConversation();
            ids.push(window.currentConversationId);
            if (i === 0) fileAttachmentHandler.attachedFiles.push({ name: 'note.txt', type: 'text/plain',
                status: 'completed', content: 'restored attachment text', isText: true, size: 24 });
            await chatModule.sendPromptFromDesktop(`Question ${i}`);
            const message = sentMessages.at(-1);
            await emitIpc('chat-response', { id: message.id, agent_name: 'Aetheria_AI', streaming: true,
                content: '```javascript\nconst value = ' + i + ';\n```\nAnswer ' + i });
            // Leave each run in the background, then complete it after the next run is created.
            if (i > 0) {
                const previous = sentMessages.at(-2);
                await emitIpc('chat-response', { id: previous.id, agent_name: 'Aetheria_AI', done: true });
            }
        }
        await emitIpc('chat-response', { id: sentMessages.at(-1).id, agent_name: 'Aetheria_AI', done: true });
        return ids;
    });
    await page.waitForFunction(() => document.querySelectorAll('.conversation-thread').length <= 3, { timeout: 5000 })
        .catch(async error => { throw new Error(JSON.stringify({ error: error.message, errors, consoleErrors: consoleErrors.slice(-40),
            state: await page.evaluate(() => ({ sent: sentMessages.map(message => ({ id: message.id, conversation: message.conversationId })),
                threads: [...document.querySelectorAll('.conversation-thread')].map(thread => ({ id: thread.dataset.conversationId,
                    pinned: !!thread.querySelector('.plan-output-card, .try-again-btn, .agent-question-card, .inline-mermaid-block, iframe, video, audio') })),
            })) })); });
    assert.equal(await page.evaluate(id => chatModule.hasConversation(id), result[0]), true);
    assert.equal(await page.evaluate(id => chatModule.openConversation(id), result[0]), true);
    await page.waitForFunction(() => document.querySelector('.conversation-thread.active .inner-content')?.textContent.includes('Answer 0'));
    assert.equal(await page.$eval('.conversation-thread.active .message-actions .copy-btn', node => !!node), true);
    await page.evaluate(() => { navigator.clipboard.writeText = async text => { window.copiedText = text; }; });
    await page.click('.conversation-thread.active .message-actions .copy-btn');
    await page.waitForFunction(() => window.copiedText?.includes('Answer 0'));
    await page.click('.conversation-thread.active .message-attachment-card');
    await page.waitForSelector('.file-preview-modal .file-text-content');
    assert.equal(await page.$eval('.file-preview-modal .file-text-content', node => node.textContent), 'restored attachment text');
    await page.keyboard.press('Escape');
    await page.click('#project-workspace-icon');
    await page.waitForFunction(() => document.querySelector('.notification[role="alert"]')?.textContent.includes('Try opening it again'));
    assert.equal(await page.evaluate(() => stateManager.getState().isProjectWorkspaceOpen), false);
    await page.click('#project-workspace-icon');
    await page.waitForFunction(() => !!window.projectWorkspace && !!window.githubPanel && !!window.designModeController);
    assert.equal(requests.filter(url => url.startsWith('/js/github-panel.js')).length, 2);
    assert.equal(await page.$eval('#project-workspace-panel', node => node.classList.contains('hidden')), false);
    const terminal = await page.evaluate(async () => {
        await Promise.all([loadRendererFeature('terminal'), loadRendererFeature('terminalFit')]);
        projectWorkspace.terminalSessionMode = 'spawn';
        projectWorkspace.appendTerminalOutput('x'.repeat(300000) + 'end');
        return { size: projectWorkspace.el.terminalOutput.textContent.length,
            tail: projectWorkspace.el.terminalOutput.textContent.slice(-3), library: typeof Terminal };
    });
    assert.deepEqual(terminal, { size: 256 * 1024, tail: 'end', library: 'function' });
    if (process.env.DESKTOP_MEMORY_SCREENSHOT) await page.screenshot({ path: process.env.DESKTOP_MEMORY_SCREENSHOT });
    await page.evaluate(() => stateManager.setState({ isProjectWorkspaceOpen: false, isComputerWorkspaceOpen: true }));
    await page.waitForFunction(() => !!window.computerWorkspace && document.body.classList.contains('computer-panel-open'));
    await page.evaluate(() => signOutFixture());
    await page.waitForFunction(() => !window.currentConversationId && artifactHandler.artifacts.size === 0);
    assert.deepEqual(errors, []);
});
