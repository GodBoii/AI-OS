const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const puppeteer = require('puppeteer-core');
const BrowserHandler = require('../browser-handler');
const BrowserSettings = require('../browser-settings');
const { installBrowserIpc } = require('../browser-ipc');
const { createLazyDesktopController } = require('../lazy-desktop-controller');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

function setup(t) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aetheria-browser-runtime-'));
    const settings = new BrowserSettings(folder);
    const emitter = new EventEmitter();
    const handler = new BrowserHandler(emitter, folder, async () => null, settings);
    t.after(async () => {
        handler._clearIdleTimer();
        if (handler.managedBrowserProcess) await handler.closeBrowser();
        fs.rmSync(folder, { recursive: true, force: true });
    });
    return { handler, settings, emitter };
}

test('status stays lazy and mode changes persist without closing a running browser', async t => {
    const { handler, settings, emitter } = setup(t);
    let created = 0;
    let closed = 0;
    handler.closeBrowser = async () => { closed++; };
    const controller = createLazyDesktopController({ factory: () => { created++; return handler; }, emitter,
        commandChannel: 'execute-browser-command', resultChannel: 'browser-command-result', commandMethod: '_enqueueCommand' });
    const routes = new Map();
    installBrowserIpc({ ipcMain: { handle: (name, callback) => routes.set(name, callback) }, browserHandler: controller, browserSettings: settings });
    const invoke = (name, payload) => routes.get(name)(null, payload);
    assert.equal((await invoke('browser-data', { action: 'runtime' })).state, 'stopped');
    assert.equal((await invoke('browser-data', { action: 'pause' })).success, false);
    assert.equal(created, 0);
    await invoke('browser-settings:set', { visibility: 'headless' });
    assert.equal(created, 0);
    controller.pauseAutomation();
    handler.activeVisibility = 'visible';
    await invoke('browser-settings:set', { visibility: 'background' });
    assert.equal(closed, 0);
    assert.equal(handler.activeVisibility, 'visible');
    assert.equal(new BrowserSettings(settings.filePath.replace(/[/\\]browser-settings\.json$/, '')).get().visibility, 'background');
    const status = await invoke('browser-data', { action: 'runtime' });
    assert.equal(status.preferredMode, 'background');
    assert.equal((await invoke('browser-data', { action: 'switchTab', id: '../bad' })).success, false);
});

test('pause finishes the active action, rejects queued actions and never replays them on resume', async t => {
    const { handler, emitter } = setup(t);
    const results = [];
    emitter.on('browser-command-result', payload => results.push(payload));
    let finish;
    let started;
    const starting = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { finish = resolve; });
    const executed = [];
    handler.handleCommand = async payload => {
        executed.push(payload.request_id);
        started();
        if (payload.request_id === 'first') await gate;
        handler._emitResult(payload.request_id, { status: 'success' });
    };
    const first = handler._enqueueCommand({ action: 'click', request_id: 'first' });
    await starting;
    const queued = handler._enqueueCommand({ action: 'type', request_id: 'queued', text: 'secret must not be stored' });
    handler.pauseAutomation();
    assert.equal(handler.resumeAutomation().success, false);
    await handler._enqueueCommand({ action: 'click', request_id: 'paused' });
    finish();
    await Promise.all([first, queued]);
    assert.deepEqual(executed, ['first']);
    assert.equal(results.find(item => item.request_id === 'queued').result.paused, true);
    assert.equal(results.find(item => item.request_id === 'paused').result.paused, true);
    assert.equal(handler.resumeAutomation().success, true);
    await handler._enqueueCommand({ action: 'get_view', request_id: 'fresh' });
    assert.deepEqual(executed, ['first', 'fresh']);
    assert.equal(handler.runtimeSnapshot().activity[0].status, 'completed');
    assert.ok(!JSON.stringify(handler.runtimeSnapshot()).includes('secret'));
});

test('quick resume still discards commands queued before pause', async t => {
    const { handler, emitter } = setup(t);
    const results = [];
    emitter.on('browser-command-result', payload => results.push(payload));
    const pending = handler._enqueueCommand({ action: 'click', request_id: 'old' });
    handler.pauseAutomation();
    assert.equal(handler.resumeAutomation().success, true);
    await pending;
    assert.equal(results[0].result.paused, true);
});

test('headless takeover pauses without restarting or losing the page', async t => {
    const { handler } = setup(t);
    handler.isConnected = true;
    handler.activeVisibility = 'headless';
    handler.page = { url: () => 'https://example.com/form' };
    const page = handler.page;
    let closed = false;
    handler.closeBrowser = async () => { closed = true; };
    const pending = handler.takeControl();
    assert.equal(handler.resumeAutomation().success, false);
    const result = await pending;
    assert.equal(result.requiresRestart, true);
    assert.equal(handler.page, page);
    assert.equal(closed, false);
    assert.equal(handler.controlMode, 'manual');
    handler._touchIdle();
    assert.equal(handler.idleTimer, null);
});

test('activity stays bounded and a failed command leaves the queue usable', async t => {
    const { handler } = setup(t);
    handler.handleCommand = async payload => {
        if (payload.request_id === '0') throw new Error('Fixture failure');
        handler._emitResult(payload.request_id, { status: 'success' });
    };
    for (let i = 0; i < 35; i++) await handler._enqueueCommand({ action: 'get_view', request_id: String(i) });
    assert.equal(handler.activity.length, 30);
    assert.equal(handler.activity[0].status, 'completed');
    assert.equal(handler.isProcessingCommand, false);
});

const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium']
    .find(file => file && fs.existsSync(file));

test('real Chromium tabs keep stable identities and preserve a form during takeover', { skip: !executablePath }, async t => {
    const { handler } = setup(t);
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = (await browser.pages())[0];
    await page.setContent('<title>Form</title><input id="draft" value="unsaved draft">');
    const second = await browser.newPage();
    await second.setContent('<title>Second</title>');
    handler.browser = browser;
    handler.page = page;
    handler.isConnected = true;
    handler.runtimeState = 'connected';
    handler.activeVisibility = 'headless';
    const initial = await handler.getRuntime();
    const firstId = initial.tabs.find(tab => tab.title === 'Form').id;
    const secondId = initial.tabs.find(tab => tab.title === 'Second').id;
    assert.equal((await handler.changeRuntimeTab('switchTab', secondId)).success, false);
    await handler.takeControl();
    assert.equal(await page.$eval('#draft', input => input.value), 'unsaved draft');
    assert.equal((await handler.changeRuntimeTab('switchTab', secondId)).success, true);
    assert.equal(handler.page, second);
    assert.equal((await handler.changeRuntimeTab('closeTab', firstId)).success, true);
    const remaining = await handler.getRuntime();
    assert.equal(remaining.tabs[0].id, secondId);
    assert.equal((await handler.changeRuntimeTab('closeTab', secondId)).success, false);
    assert.equal((await handler.changeRuntimeTab('switchTab', firstId)).success, false);
});

test('managed headless restart releases the profile and preserves saved cookies', { skip: !executablePath, timeout: 45000 }, async t => {
    const { handler, settings } = setup(t);
    settings.update({ visibility: 'headless' });
    t.after(() => handler.closeBrowser());
    assert.equal((await handler._launchManagedBrowser()).ok, true);
    assert.equal(await handler._waitForBrowserReady(), true);
    await handler.browser.setCookie({ name: 'session', value: 'saved-cookie', domain: 'example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 });
    const previous = handler.browser;
    const result = await handler.restartBrowser();
    assert.equal(result.success, true);
    assert.notEqual(handler.browser, previous);
    assert.equal(handler.runtimeSnapshot().state, 'connected');
    assert.equal(handler.runtimeSnapshot().mode, 'headless');
    assert.equal(handler.runtimeSnapshot().control, 'manual');
    assert.ok((await handler.browser.cookies()).some(cookie => cookie.name === 'session' && cookie.value === 'saved-cookie'));
});

test('Electron takeover reveals a background window without replacing its page', { skip: !executablePath, timeout: 45000 }, async () => {
    const { stdout } = await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/browser-runtime-electron.cjs')],
        { timeout: 40000, windowsHide: true, maxBuffer: 1024 * 1024 });
    assert.ok(stdout.includes('BROWSER_TAKEOVER_OK'));
});
