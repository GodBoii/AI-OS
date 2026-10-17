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

test('normal dictation captures audio, appends text, and survives cancellation and errors', { skip: !executablePath }, async t => {
    const server = http.createServer((request, response) => {
        if (request.url.startsWith('/js/') || request.url.startsWith('/css/')) {
            response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
            response.end(fs.readFileSync(path.join(root, request.url)));
        } else response.end('<!doctype html><link rel="stylesheet" href="/css/chat.css"><button id="mic-button"><i></i></button><textarea>Existing draft</textarea><button id="send-message"></button>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const browser = await puppeteer.launch({ executablePath, headless: true,
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
        window.notices = [];
        window.requests = [];
        window.mode = 'success';
        window.electron = { auth: { getSession: async () => ({ access_token: 'test-session' }) } };
        window.NotificationService = { show: text => notices.push(text) };
        window.fetch = async (url, options) => {
            requests.push({ url, body: JSON.parse(options.body), headers: options.headers });
            if (mode === 'pending') await new Promise(resolve => { window.resolveRequest = resolve; });
            if (mode === 'error') return { ok: false, json: async () => ({ ok: false, error: 'Groq limit reached' }) };
            return { ok: true, json: async () => ({ ok: true, text: 'spoken words' }) };
        };
        const Handler = (await import('/js/groq-speech-input-handler.js')).default;
        window.handler = new Handler();
        handler.initialize(document.querySelector('button'), document.querySelector('textarea'));
    });
    const chatSource = fs.readFileSync(path.join(root, 'js/chat.js'), 'utf8');
    const composerUpdate = chatSource.slice(chatSource.indexOf('function updatePrimaryComposerAction()'),
        chatSource.indexOf('async function handlePrimaryComposerAction()'));
    await page.addScriptTag({ content: `
        let normalSpeechInputHandler = window.handler;
        let audioInputHandler = null;
        let planGenerationInProgress = false;
        function hasComposerContent() { return Boolean(document.querySelector('textarea').value); }
        function setPrimaryComposerIcon() {}
        ${composerUpdate}
        handler.onStateChange = updatePrimaryComposerAction;
        handler.canStart = () => !(audioInputHandler?.isRecording || audioInputHandler?.isProcessing);
    ` });
    await page.click('#mic-button');
    await page.waitForFunction(() => handler.isRecording);
    assert.equal(await page.$eval('#send-message', el => el.disabled), true);
    assert.equal(await page.$eval('#mic-button', el => el.querySelectorAll('.native-waveform-bar').length), 5);
    await page.waitForFunction(() => handler.recordingBytes > 0);
    await page.click('#mic-button');
    await page.waitForFunction(() => !handler.isActive());
    assert.equal(await page.$eval('textarea', el => el.value), 'Existing draft spoken words');
    const request = await page.evaluate(() => requests[0]);
    assert.match(request.url, /\/api\/mic\/dictate$/);
    assert.equal(request.headers.Authorization, 'Bearer test-session');
    assert.ok(Buffer.from(request.body.audio, 'base64').length > 0);
    assert.equal(request.body.format, 'webm');
    assert.equal(await page.evaluate(() => handler.recordingStream), null);
    assert.equal(await page.$eval('#send-message', el => el.disabled), false);

    await page.evaluate(() => { mode = 'pending'; });
    await page.click('#mic-button');
    await page.waitForFunction(() => handler.isRecording && handler.recordingBytes > 0);
    await page.click('#mic-button');
    await page.waitForFunction(() => typeof resolveRequest === 'function');
    await page.evaluate(async () => { await handler.cancel(); resolveRequest(); });
    await page.waitForFunction(() => !handler.isActive());
    assert.equal(await page.$eval('textarea', el => el.value), 'Existing draft spoken words');

    await page.evaluate(() => { mode = 'error'; });
    await page.click('#mic-button');
    await page.waitForFunction(() => handler.isRecording && handler.recordingBytes > 0);
    await page.click('#mic-button');
    await page.waitForFunction(() => !handler.isActive());
    assert.ok((await page.evaluate(() => notices)).includes('Groq limit reached'));

    // Cancel while a permission request is still pending. Its eventual stream must stop.
    await page.evaluate(async () => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        window.trackStopped = false;
        navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.allowMic = resolve; });
        window.starting = handler.start();
        await Promise.resolve();
        await handler.cancel();
        allowMic({ getTracks: () => [{ stop: () => { trackStopped = true; } }] });
        await starting;
        navigator.mediaDevices.getUserMedia = original;
    });
    assert.equal(await page.evaluate(() => trackStopped), true);
    await page.evaluate(async () => {
        handler.canStart = () => false;
        await handler.start();
        handler.canStart = () => true;
        window.electron.auth.getSession = async () => null;
        await handler.start();
    });
    assert.ok((await page.evaluate(() => notices)).includes('Finish the current voice input first.'));
    assert.ok((await page.evaluate(() => notices)).includes('Please sign in to use voice input.'));
    assert.equal(await page.evaluate(() => handler.isActive()), false);
    await page.evaluate(async () => {
        window.electron.auth.getSession = async () => ({ access_token: 'test-session' });
        mode = 'success';
        const SmartHandler = (await import('/js/audio-input-handler.js')).default;
        window.smartHandler = new SmartHandler();
        audioInputHandler = smartHandler;
        handler.canStart = () => !(smartHandler.isRecording || smartHandler.isProcessing);
        smartHandler.isRecording = true;
        updatePrimaryComposerAction();
    });
    assert.equal(await page.$eval('#mic-button', el => el.disabled), true);
    await page.evaluate(async () => {
        await handler.start();
        smartHandler.isRecording = false;
        smartHandler.isProcessing = true;
        updatePrimaryComposerAction();
    });
    assert.equal(await page.evaluate(() => handler.isActive()), false);
    assert.equal(await page.$eval('#mic-button', el => el.disabled), true);
    await page.evaluate(async () => {
        smartHandler.isProcessing = false;
        updatePrimaryComposerAction();
        await smartHandler.transcribeWithCloud('intelligent-audio');
    });
    assert.equal(await page.$eval('#mic-button', el => el.disabled), false);
    const intelligentRequest = await page.evaluate(() => requests.at(-1));
    assert.match(intelligentRequest.url, /\/api\/mic\/transcribe$/);
    assert.deepEqual(intelligentRequest.body, { audio: 'intelligent-audio', format: 'wav', language: 'en' });
    await page.evaluate(() => handler.destroy());
    assert.deepEqual(errors, []);
});
