const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const icons = require('../native-icons');
const { AgentActivityTracker, isRunStartMessage } = require('../agent-activity');
const { DesktopIntegration } = require('../desktop-integration');
const appActions = require('../app-actions');
const fileOpen = require('../file-open');
const runNotification = require('../run-notification');
const { SecureStore, createSecureAuthStorage } = require('../secure-store');
const appearance = require('../system-appearance');
const status = require('../system-status');
const { QuickPromptWindow } = require('../quick-prompt-window');
const ComputerControlHandler = require('../computer-control-handler');

// --- native-icons ------------------------------------------------------------

test('icons are valid PNGs with a correct CRC', () => {
    assert.equal(icons.crc32(Buffer.from('IEND')), 0xae426082);
    for (const png of [icons.renderBadgePng(3), icons.renderBadgePng(42), icons.renderGlyphPng('stop'), icons.renderGlyphPng('pause'), icons.renderGlyphPng('play')]) {
        assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        assert.equal(png.readUInt32BE(16), icons.ICON_SIZE);
    }
    assert.equal(icons.badgeLabel(12), '9+');
    assert.equal(icons.badgeLabel(0), '');
    assert.throws(() => icons.renderBadgePng(0));
    assert.throws(() => icons.renderGlyphPng('nope'));
});

// --- agent-activity ------------------------------------------------------------

function fakeTimers() {
    const timers = [];
    return {
        timers,
        setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
        clearTimer: (t) => { if (t) t.cleared = true; },
    };
}

test('run start messages exclude control and terminate types', () => {
    assert.equal(isRunStartMessage({ conversationId: 'c', message: 'hi' }), true);
    for (const type of ['terminate_session', 'stop_run', 'pause_run', 'resume_run']) {
        assert.equal(isRunStartMessage({ conversationId: 'c', type }), false);
    }
    assert.equal(isRunStartMessage({ message: 'no conversation' }), false);
    assert.equal(isRunStartMessage(null), false);
});

test('tracker counts runs, finishes by message or conversation and times out', () => {
    const timers = fakeTimers();
    const tracker = new AgentActivityTracker(timers);
    const changes = [];
    tracker.on('change', (snapshot) => changes.push(snapshot));

    tracker.runStarted({ conversationId: 'c1', messageId: 'm1' });
    tracker.runStarted({ conversationId: 'c2', messageId: 'm2' });
    assert.equal(tracker.activeCount, 2);
    assert.deepEqual(tracker.activeConversationIds().sort(), ['c1', 'c2']);

    tracker.setPaused(true);
    assert.equal(tracker.paused, true);
    assert.ok(tracker.runFinished({ messageId: 'm1' }));
    assert.equal(tracker.runFinished({ messageId: 'm1' }), null);
    assert.ok(tracker.runFinished({ conversationId: 'c2' }));
    assert.equal(tracker.activeCount, 0);
    assert.equal(tracker.paused, false, 'pause clears when nothing runs');

    tracker.runStarted({ conversationId: 'c3', messageId: 'm3' });
    const finished = [];
    tracker.on('run-finished', (run) => finished.push(run.outcome));
    timers.timers.at(-1).fn();
    assert.deepEqual(finished, ['timeout']);
    assert.ok(changes.length >= 5);
});

test('clearAll ends every run once', () => {
    const tracker = new AgentActivityTracker(fakeTimers());
    tracker.runStarted({ conversationId: 'a', messageId: '1' });
    tracker.runStarted({ conversationId: 'b', messageId: '2' });
    const outcomes = [];
    tracker.on('run-finished', (run) => outcomes.push(run.outcome));
    tracker.clearAll('disconnect');
    tracker.clearAll('disconnect');
    assert.deepEqual(outcomes, ['disconnect', 'disconnect']);
    assert.equal(tracker.activeCount, 0);
});

// --- desktop-integration ---------------------------------------------------------

function fakeDesktop(platform) {
    const calls = [];
    const record = (name) => (...args) => { calls.push([name, ...args]); return true; };
    const win = {
        isDestroyed: () => false,
        setProgressBar: record('progress'),
        setThumbarButtons: record('thumbar'),
        setOverlayIcon: record('overlay'),
        flashFrame: record('flash'),
    };
    let nextBlocker = 1;
    const started = new Set();
    const app = {
        setBadgeCount: record('badge'),
        setUserTasks: record('userTasks'),
        dock: { bounce: () => { calls.push(['bounce']); return 7; }, cancelBounce: record('cancelBounce'), setMenu: record('dockMenu') },
    };
    const powerSaveBlocker = {
        start: (type) => { const id = nextBlocker++; started.add(id); calls.push(['blockerStart', type]); return id; },
        stop: (id) => { started.delete(id); calls.push(['blockerStop', id]); },
        isStarted: (id) => started.has(id),
    };
    const actions = [];
    const desktop = new DesktopIntegration({
        app,
        nativeImage: { createFromBuffer: (buffer) => ({ png: buffer.length }) },
        powerSaveBlocker,
        Menu: { buildFromTemplate: (template) => ({ template }) },
        platform,
        getWindow: () => win,
        onAction: (action) => actions.push(action),
        logger: { warn() {} },
    });
    return { desktop, calls, actions, started };
}

test('Windows: progress, thumbnail buttons, power blocker follow activity', () => {
    const { desktop, calls, actions, started } = fakeDesktop('win32');
    desktop.onActivityChange({ activeCount: 1, paused: false, conversationIds: ['c'] });
    assert.deepEqual(calls.find((c) => c[0] === 'progress'), ['progress', 2, { mode: 'indeterminate' }]);
    const thumbar = calls.filter((c) => c[0] === 'thumbar').at(-1)[1];
    assert.equal(thumbar.length, 2);
    assert.equal(thumbar[0].tooltip, 'Pause agent');
    thumbar[1].click();
    assert.deepEqual(actions, ['stop-runs']);
    assert.equal(started.size, 1);

    desktop.onActivityChange({ activeCount: 1, paused: true, conversationIds: ['c'] });
    assert.deepEqual(calls.filter((c) => c[0] === 'progress').at(-1), ['progress', 1, { mode: 'paused' }]);
    assert.equal(calls.filter((c) => c[0] === 'thumbar').at(-1)[1][0].tooltip, 'Resume agent');

    desktop.onActivityChange({ activeCount: 0, paused: false, conversationIds: [] });
    assert.deepEqual(calls.filter((c) => c[0] === 'progress').at(-1), ['progress', -1]);
    assert.deepEqual(calls.filter((c) => c[0] === 'thumbar').at(-1), ['thumbar', []]);
    assert.equal(started.size, 0);
});

test('Windows: badge overlay counts background runs and restores the default overlay', () => {
    const { desktop, calls } = fakeDesktop('win32');
    desktop.setDefaultOverlay('APP_ICON', 'Aetheria ai');
    desktop.notifyRunFinished({ backgrounded: false });
    assert.equal(calls.filter((c) => c[0] === 'overlay').length, 0);
    desktop.notifyRunFinished({ backgrounded: true });
    desktop.notifyRunFinished({ backgrounded: true });
    assert.equal(calls.filter((c) => c[0] === 'overlay').at(-1)[2], '2 finished tasks');
    assert.ok(calls.some((c) => c[0] === 'flash' && c[1] === true));
    desktop.clearAttention();
    assert.deepEqual(calls.filter((c) => c[0] === 'overlay').at(-1), ['overlay', 'APP_ICON', 'Aetheria ai']);
    assert.ok(calls.some((c) => c[0] === 'flash' && c[1] === false));
});

test('macOS: Dock badge and bounce, no thumbnail buttons', () => {
    const { desktop, calls } = fakeDesktop('darwin');
    desktop.onActivityChange({ activeCount: 1, paused: false, conversationIds: ['c'] });
    assert.equal(calls.filter((c) => c[0] === 'thumbar').length, 0);
    desktop.notifyRunFinished({ backgrounded: true });
    assert.deepEqual(calls.filter((c) => c[0] === 'badge').at(-1), ['badge', 1]);
    assert.ok(calls.some((c) => c[0] === 'bounce'));
    desktop.clearAttention();
    assert.deepEqual(calls.filter((c) => c[0] === 'badge').at(-1), ['badge', 0]);
    assert.deepEqual(calls.filter((c) => c[0] === 'cancelBounce').at(-1), ['cancelBounce', 7]);
});

test('settings turn off taskbar activity and keep-awake', () => {
    const { desktop, calls, started } = fakeDesktop('win32');
    desktop.setSettings({ taskbarActivity: false, keepAwake: false });
    desktop.onActivityChange({ activeCount: 1, paused: false, conversationIds: ['c'] });
    assert.deepEqual(calls.filter((c) => c[0] === 'progress').at(-1), ['progress', -1]);
    assert.equal(started.size, 0);
    desktop.notifyRunFinished({ backgrounded: true });
    assert.equal(calls.filter((c) => c[0] === 'flash' && c[1] === true).length, 0);
});

test('launch actions: Windows jump list and macOS Dock menu', () => {
    const win = fakeDesktop('win32');
    win.desktop.installLaunchActions({ execPath: 'C:\\app.exe', isPackaged: true, appPath: 'C:\\app' });
    const tasks = win.calls.find((c) => c[0] === 'userTasks')[1];
    assert.equal(tasks.length, appActions.LAUNCH_ACTIONS.length);
    assert.equal(tasks[0].arguments, '--aetheria-action=new-chat');

    const mac = fakeDesktop('darwin');
    mac.desktop.installLaunchActions({ execPath: '/x', isPackaged: true, appPath: '/x' });
    const menu = mac.calls.find((c) => c[0] === 'dockMenu')[1];
    menu.template[2].click();
    assert.deepEqual(mac.actions, ['voice-input']);
});

// --- app-actions -----------------------------------------------------------------

test('launch action parsing and dev-mode jump list arguments', () => {
    assert.equal(appActions.parseLaunchAction(['app.exe', '--aetheria-action=new-task']), 'new-task');
    assert.equal(appActions.parseLaunchAction(['app.exe', '--aetheria-action=format-disk']), null);
    assert.equal(appActions.parseLaunchAction(null), null);
    const [task] = appActions.buildWindowsUserTasks({ execPath: 'electron.exe', isPackaged: false, appPath: 'C:\\src app' });
    assert.equal(task.arguments, '"C:\\src app" --aetheria-action=new-chat');
});

test('package.json Linux desktop actions match the launch action list', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    assert.deepEqual(pkg.build.linux.desktop, appActions.buildLinuxDesktopActions());
});

// --- file-open ---------------------------------------------------------------------

test('argv file extraction skips flags, URLs, the app and missing files', () => {
    const cwd = path.resolve('/work');
    const existing = new Set([path.resolve(cwd, 'a.pdf'), path.resolve('/abs/b.png')]);
    const found = fileOpen.extractFilePaths(
        ['app.exe', '--flag', 'aios://auth', 'a.pdf', path.resolve('/abs/b.png'), 'missing.txt', 'a.pdf', '.'],
        { cwd, isFile: (p) => existing.has(p), ignore: [path.resolve(cwd, '.')] }
    );
    assert.deepEqual(found, [path.resolve(cwd, 'a.pdf'), path.resolve('/abs/b.png')]);
    assert.equal(fileOpen.mimeTypeFor('x.PDF'), 'application/pdf');
    assert.equal(fileOpen.mimeTypeFor('x.unknown'), 'application/octet-stream');
});

test('reading opened files enforces size and count limits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetheria-open-'));
    const small = path.join(dir, 'note.txt');
    fs.writeFileSync(small, 'hello');
    const fakeFs = {
        stat: async (p) => (p.endsWith('huge.pdf') ? { isFile: () => true, size: fileOpen.MAX_FILE_BYTES + 1 } : fs.promises.stat(p)),
        readFile: (p) => fs.promises.readFile(p),
    };
    const paths = [small, path.join(dir, 'huge.pdf'), path.join(dir, 'gone.txt')];
    for (let i = 0; i < fileOpen.MAX_FILES; i++) paths.push(small);
    const { files, skipped } = await fileOpen.readFilesForRenderer(paths, { fsPromises: fakeFs });
    assert.equal(files[0].name, 'note.txt');
    assert.equal(files[0].type, 'text/plain');
    assert.equal(files[0].data.toString(), 'hello');
    assert.ok(skipped.some((s) => s.reason === 'larger than 50 MB'));
    assert.ok(skipped.some((s) => s.reason === 'ENOENT'));
    assert.ok(skipped.some((s) => s.reason.startsWith('more than')));
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- run-notification ------------------------------------------------------------------

const CONVERSATION = '123e4567-e89b-12d3-a456-426614174000';

test('Windows toast escapes text and links buttons to aios:// actions', () => {
    const xml = runNotification.buildWindowsToastXml({ title: 'A & B', body: '<done> "x"', conversationId: CONVERSATION, silent: true });
    assert.match(xml, /A &amp; B/);
    assert.match(xml, /&lt;done&gt; &quot;x&quot;/);
    assert.match(xml, new RegExp(`arguments="aios://notification/reply\\?conversation=${CONVERSATION}"`));
    assert.match(xml, /<audio silent="true"\/>/);
});

test('notification options per platform', () => {
    const dispatched = [];
    const base = { conversationId: CONVERSATION, title: 't', body: 'b', dispatch: (m) => dispatched.push(m) };
    const mac = runNotification.buildRunCompletedOptions({ ...base, platform: 'darwin', isPackaged: true });
    assert.equal(mac.hasReply, true);
    mac.onReply('thanks');
    assert.deepEqual(dispatched.at(-1), { action: 'reply', conversationId: CONVERSATION, text: 'thanks' });
    assert.ok(runNotification.buildRunCompletedOptions({ ...base, platform: 'win32', isPackaged: true }).toastXml);
    const devWin = runNotification.buildRunCompletedOptions({ ...base, platform: 'win32', isPackaged: false });
    assert.equal(devWin.toastXml, undefined);
    devWin.onClick();
    assert.deepEqual(dispatched.at(-1), { action: 'open-conversation', conversationId: CONVERSATION });
    assert.deepEqual(runNotification.buildRunCompletedOptions({ ...base, conversationId: 'bad id!', platform: 'darwin' }), {});
});

test('notification deep links are validated', () => {
    const parse = (url) => runNotification.parseNotificationLink(new URL(url));
    assert.deepEqual(parse(`aios://notification/open?conversation=${CONVERSATION}`), { action: 'open-conversation', conversationId: CONVERSATION });
    assert.deepEqual(parse(`aios://notification/reply?conversation=${CONVERSATION}`), { action: 'focus-reply', conversationId: CONVERSATION });
    assert.equal(parse('aios://notification/delete?conversation=abc'), null);
    assert.equal(parse('aios://notification/open?conversation=../../etc'), null);
    assert.equal(parse('aios://auth/callback?provider=github'), null);
});

// --- secure-store --------------------------------------------------------------------

function fakeSafeStorage({ available = true, backend = 'gnome_libsecret' } = {}) {
    return {
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: () => backend,
        encryptString: (value) => Buffer.from(`enc:${value}`),
        decryptString: (buffer) => {
            const text = buffer.toString();
            if (!text.startsWith('enc:')) throw new Error('bad ciphertext');
            return text.slice(4);
        },
    };
}

test('secure store encrypts, persists and restricts keys', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetheria-secure-'));
    const store = new SecureStore({ safeStorage: fakeSafeStorage(), fsPromises: fs.promises, directory: dir, platform: 'win32', logger: { warn() {} } });
    assert.equal(store.isAvailable(), true);
    await store.set('sb-abc-auth-token', '{"access_token":"t"}');
    const raw = fs.readFileSync(path.join(dir, 'secure-store.json'), 'utf8');
    assert.doesNotMatch(raw, /access_token/);

    const reopened = new SecureStore({ safeStorage: fakeSafeStorage(), fsPromises: fs.promises, directory: dir, platform: 'win32' });
    assert.equal(await reopened.get('sb-abc-auth-token'), '{"access_token":"t"}');
    await reopened.remove('sb-abc-auth-token');
    assert.equal(await reopened.get('sb-abc-auth-token'), null);
    await assert.rejects(reopened.set('../../etc/passwd', 'x'), /not allowed/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('Linux basic_text backend counts as unavailable', () => {
    const store = new SecureStore({ safeStorage: fakeSafeStorage({ backend: 'basic_text' }), fsPromises: fs.promises, directory: os.tmpdir(), platform: 'linux' });
    assert.equal(store.isAvailable(), false);
});

function fakeLocalStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
    };
}

test('auth storage migrates an existing localStorage session into the vault', async () => {
    const vault = new Map();
    const invoke = async ({ op, key, value }) => {
        if (op === 'get') return { available: true, value: vault.has(key) ? vault.get(key) : null };
        if (op === 'set') { vault.set(key, value); return { available: true, ok: true }; }
        vault.delete(key);
        return { available: true, ok: true };
    };
    const local = fakeLocalStorage({ 'sb-x-auth-token': 'old-session' });
    const storage = createSecureAuthStorage({ invoke, localStorage: local });
    assert.equal(await storage.getItem('sb-x-auth-token'), 'old-session');
    assert.equal(vault.get('sb-x-auth-token'), 'old-session');
    assert.equal(local.getItem('sb-x-auth-token'), null);
    await storage.setItem('sb-x-auth-token', 'new');
    assert.equal(vault.get('sb-x-auth-token'), 'new');
    await storage.removeItem('sb-x-auth-token');
    assert.equal(vault.has('sb-x-auth-token'), false);
});

test('auth storage falls back to localStorage when the vault is unavailable or IPC fails', async () => {
    const local = fakeLocalStorage();
    const unavailable = createSecureAuthStorage({ invoke: async () => ({ available: false }), localStorage: local });
    await unavailable.setItem('sb-x-auth-token', 'v');
    assert.equal(await unavailable.getItem('sb-x-auth-token'), 'v');

    const broken = createSecureAuthStorage({ invoke: async () => { throw new Error('No handler registered'); }, localStorage: local, logger: { warn() {} } });
    assert.equal(await broken.getItem('sb-x-auth-token'), 'v');
});

// --- system-appearance ---------------------------------------------------------------

test('accent normalization and Mica support detection', () => {
    assert.equal(appearance.normalizeAccentColor('0078D4FF'), '#0078d4');
    assert.equal(appearance.normalizeAccentColor('#abc'), null);
    assert.equal(appearance.normalizeAccentColor(false), null);
    assert.equal(appearance.supportsWindowsMaterial('10.0.26200'), true);
    assert.equal(appearance.supportsWindowsMaterial('10.0.19045'), false);
    assert.equal(appearance.materialSupport('linux', '6.0'), null);
    assert.equal(appearance.materialSupport('darwin', '23.0.0'), 'vibrancy');
});

test('setMaterial applies Mica on Windows 11 and reports state', () => {
    const calls = [];
    const appearanceService = new appearance.SystemAppearance({
        nativeTheme: { shouldUseDarkColors: true, on() {} },
        systemPreferences: { getAccentColor: () => 'ff0000ff' },
        platform: 'win32',
        release: '10.0.26200',
    });
    const win = { isDestroyed: () => false, setBackgroundMaterial: (m) => calls.push(m) };
    assert.equal(appearanceService.setMaterial(win, true).materialEnabled, true);
    assert.equal(appearanceService.setMaterial(win, false).materialEnabled, false);
    assert.deepEqual(calls, ['mica', 'none']);
    assert.deepEqual(
        { dark: appearanceService.getState().dark, accent: appearanceService.getState().accentColor },
        { dark: true, accent: '#ff0000' }
    );
});

// --- system-status parsers -----------------------------------------------------------

test('battery parsers', () => {
    assert.deepEqual(status.parseWindowsBattery('{"EstimatedChargeRemaining":55,"BatteryStatus":1,"EstimatedRunTime":120}'),
        { percent: 55, state: 'discharging', minutes_remaining: 120 });
    assert.equal(status.parseWindowsBattery('{"EstimatedChargeRemaining":100,"BatteryStatus":2,"EstimatedRunTime":71582788}').minutes_remaining, null);
    assert.equal(status.parseWindowsBattery('null'), null);
    assert.deepEqual(
        status.parseMacBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t87%; discharging; 4:12 remaining present: true"),
        { percent: 87, state: 'discharging', minutes_remaining: 252 }
    );
    assert.equal(status.parseMacBattery("Now drawing from 'AC Power'\n -InternalBattery-0\t100%; charged; 0:00 remaining").state, 'full');
});

test('network, brightness, process and bluetooth parsers', () => {
    const netsh = '    Name                   : Wi-Fi\n    State                  : connected\n    SSID                   : Home Net\n    Signal                 : 88%\n    Radio type             : 802.11ax\n';
    assert.deepEqual(status.parseNetshWlan(netsh), { state: 'connected', connected: true, ssid: 'Home Net', signal_percent: 88, radio: '802.11ax' });
    assert.deepEqual(status.splitNmcliLine('yes:Cafe\\:5G:70'), ['yes', 'Cafe:5G', '70']);
    assert.deepEqual(status.parseNmcliWifi('no:Other:40\nyes:Cafe\\:5G:70\n'), { connected: true, ssid: 'Cafe:5G', signal_percent: 70 });
    assert.deepEqual(status.parseBrightnessctl('intel_backlight,backlight,12000,50%,24000\n'), { device: 'intel_backlight', percent: 50 });
    assert.deepEqual(status.parsePsOutput('  101  2.5  204800 /usr/bin/firefox\n  7 0.0 1024 bash\n')[0], { pid: 101, name: 'firefox', cpu_percent: 2.5, memory_mb: 200 });
    assert.deepEqual(status.parseBluetoothctlShow('Controller AA\n\tPowered: yes\n'), { available: true, powered: true });
    assert.deepEqual(status.parseBluetoothctlShow('No default controller available'), { available: false, powered: null });
});

test('kill_process refuses protected pids and uses graceful taskkill by default', async () => {
    const runs = [];
    const service = new status.SystemStatus({
        platform: 'win32',
        execFile: async (cmd, args) => { runs.push([cmd, ...args]); return { stdout: 'SUCCESS' }; },
        runPowerShell: async () => ({ stdout: '' }),
        ownPid: 500,
        parentPid: 400,
    });
    assert.match((await service.killProcess({ pid: 500 })).error, /Aetheria ai itself/);
    assert.match((await service.killProcess({ pid: 4 })).error, /core operating system/);
    assert.equal((await service.killProcess({ pid: 1234 })).status, 'success');
    assert.deepEqual(runs.at(-1), ['taskkill', '/PID', '1234']);
    await service.killProcess({ pid: 1234, force: true });
    assert.deepEqual(runs.at(-1), ['taskkill', '/PID', '1234', '/T', '/F']);
});

test('set_brightness validates its range', async () => {
    const service = new status.SystemStatus({ platform: 'linux', execFile: async () => ({ stdout: '' }) });
    assert.equal((await service.setBrightness(150)).status, 'error');
    assert.equal((await service.setBrightness('abc')).status, 'error');
    assert.equal((await service.setBrightness(40)).status, 'success');
});

test('missing Linux brightness tool reports an install hint', async () => {
    const service = new status.SystemStatus({
        platform: 'linux',
        execFile: async () => { const e = new Error('spawn brightnessctl ENOENT'); e.code = 'ENOENT'; throw e; },
    });
    assert.match((await service.getBrightness()).error, /brightnessctl/);
});

// --- quick-prompt-window -----------------------------------------------------------------

test('quick prompt hotkey reports conflicts and submits trimmed text', () => {
    const ipc = new EventEmitter();
    const registered = new Map();
    let refuse = true;
    const submitted = [];
    const quick = new QuickPromptWindow({
        BrowserWindow: class {},
        globalShortcut: {
            register: (accel, fn) => { if (refuse) return false; registered.set(accel, fn); return true; },
            unregister: (accel) => registered.delete(accel),
        },
        screen: {},
        ipcMain: ipc,
        preloadPath: 'p',
        htmlPath: 'h',
        onSubmit: (text) => submitted.push(text),
        logger: { warn() {} },
    });
    assert.equal(quick.setHotkeyEnabled(true).ok, false);
    refuse = false;
    assert.equal(quick.setHotkeyEnabled(true).ok, true);
    assert.ok(registered.has('CommandOrControl+Shift+Space'));
    assert.equal(quick.setHotkeyEnabled(false).enabled, false);
    assert.equal(registered.size, 0);

    // Messages from any other window are ignored.
    const sender = {};
    quick.window = { isDestroyed: () => false, webContents: sender, isVisible: () => false, hide() {} };
    ipc.emit('quick-prompt:submit', { sender: {} }, 'ignored');
    ipc.emit('quick-prompt:submit', { sender }, '   hello   ');
    ipc.emit('quick-prompt:submit', { sender }, '   ');
    assert.deepEqual(submitted, ['hello']);
});

// --- computer agent lock state -------------------------------------------------------------

test('locked computer blocks screen and input actions on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
        const handler = new ComputerControlHandler(new EventEmitter(), process.cwd(), async () => null);
        handler.platform = platform;
        handler.env = { XDG_SESSION_TYPE: 'x11' };
        handler.setSystemLocked(true);
        assert.match(handler._getPlatformBlocker('click_mouse'), /locked or asleep/);
        assert.match(handler._getPlatformBlocker('take_screenshot'), /locked or asleep/);
        assert.equal(handler._getPlatformBlocker('get_battery_status'), null);
        handler.setSystemLocked(false);
        if (platform !== 'darwin') assert.equal(handler._getPlatformBlocker('click_mouse'), null);
    }
});

test('open_path is restricted to the computer scope', async () => {
    const handler = new ComputerControlHandler(new EventEmitter(), process.cwd(), async () => null);
    handler.allowedScopes = [path.join(os.tmpdir(), 'aetheria-scope-only')];
    const result = await handler._openPath({ path: path.join(os.homedir(), 'secret.txt') });
    assert.equal(result.status, 'error');
    assert.match(result.error, /Access denied/);
});
