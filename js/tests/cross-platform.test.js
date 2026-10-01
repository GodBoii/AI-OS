const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const platform = require('../platform-integration');
const linuxDesktop = require('../linux-desktop');
const { getBrowserCandidates, findBrowserExecutable } = require('../browser-locations');
const ComputerControlHandler = require('../computer-control-handler');

// --- platform-integration --------------------------------------------------

test('app icon: Windows keeps .ico, macOS and Linux use .png', () => {
    const base = { isPackaged: true, resourcesPath: '/res', devAssetsDir: '/dev/assets' };
    assert.equal(path.basename(platform.resolveAppIconPath({ ...base, platform: 'win32' })), 'icon.ico');
    assert.equal(path.basename(platform.resolveAppIconPath({ ...base, platform: 'darwin' })), 'icon.png');
    assert.equal(path.basename(platform.resolveAppIconPath({ ...base, platform: 'linux' })), 'icon.png');
    assert.equal(
        platform.resolveAppIconPath({ ...base, isPackaged: false, platform: 'linux' }),
        path.join('/dev/assets', 'icon.png')
    );
});

test('Linux autostart entry quotes and escapes the Exec line', () => {
    const entry = platform.buildLinuxAutostartEntry({
        appName: 'Aetheria ai',
        execPath: '/home/me/Apps/Aetheria ai.AppImage',
        args: ['100%'],
    });
    assert.match(entry, /^\[Desktop Entry\]/);
    assert.match(entry, /^Exec="\/home\/me\/Apps\/Aetheria ai\.AppImage" "100%%"$/m);
    assert.match(entry, /^Name=Aetheria ai$/m);
});

test('Linux autostart prefers $APPIMAGE over the temporary mount path', () => {
    assert.deepEqual(
        platform.resolveLinuxLaunchCommand({ env: { APPIMAGE: '/opt/a.AppImage' }, execPath: '/tmp/.mount/app', isPackaged: true, appPath: '/x' }),
        { execPath: '/opt/a.AppImage', args: [] }
    );
    assert.deepEqual(
        platform.resolveLinuxLaunchCommand({ env: {}, execPath: '/usr/bin/electron', isPackaged: false, appPath: '/src' }),
        { execPath: '/usr/bin/electron', args: ['/src'] }
    );
});

test('Linux autostart writes and removes the desktop file', async () => {
    const files = new Map();
    const fsPromises = {
        mkdir: async () => {},
        writeFile: async (file, content) => { files.set(file, content); },
        unlink: async (file) => {
            if (!files.delete(file)) {
                const error = new Error('missing');
                error.code = 'ENOENT';
                throw error;
            }
        },
    };
    const options = {
        fsPromises,
        env: {},
        homeDir: '/home/me',
        appName: 'Aetheria ai',
        launchCommand: { execPath: '/opt/a.AppImage', args: [] },
    };

    const on = await platform.setLinuxLaunchAtStartup(true, options);
    assert.equal(on.entryPath, path.join('/home/me', '.config', 'autostart', 'aetheria-ai.desktop'));
    assert.ok(files.has(on.entryPath));

    await platform.setLinuxLaunchAtStartup(false, options);
    assert.equal(files.size, 0);
    // Disabling twice is not an error.
    await platform.setLinuxLaunchAtStartup(false, options);
});

test('login-shell PATH is merged without losing existing entries', async () => {
    assert.equal(platform.parseShellPathOutput('motd noise __AETHERIA_PATH__/opt/homebrew/bin:/usr/bin__AETHERIA_PATH__'), '/opt/homebrew/bin:/usr/bin');
    assert.equal(platform.parseShellPathOutput('no markers'), null);
    assert.equal(platform.mergePathLists('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin'), '/opt/homebrew/bin:/usr/bin:/bin');

    const env = { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' };
    const merged = await platform.applyLoginShellPath({
        env,
        execFile: async () => ({ stdout: '__AETHERIA_PATH__/opt/homebrew/bin:/usr/bin__AETHERIA_PATH__' }),
        logger: { warn() {} },
    });
    assert.equal(merged, '/opt/homebrew/bin:/usr/bin:/bin');
    assert.equal(env.PATH, merged);
});

test('a failing login shell leaves PATH unchanged and never throws', async () => {
    const env = { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' };
    const result = await platform.applyLoginShellPath({
        env,
        execFile: async () => { throw new Error('timed out'); },
        logger: { warn() {} },
    });
    assert.equal(result, null);
    assert.equal(env.PATH, '/usr/bin:/bin');
});

// --- linux-desktop ---------------------------------------------------------

test('Wayland detection', () => {
    assert.equal(linuxDesktop.isWaylandSession({ XDG_SESSION_TYPE: 'wayland' }), true);
    assert.equal(linuxDesktop.isWaylandSession({ XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' }), false);
    assert.equal(linuxDesktop.isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' }), true);
    assert.equal(linuxDesktop.isWaylandSession({ DISPLAY: ':0' }), false);
});

test('wmctrl -lpG output parses ids, pids, bounds and titles with spaces', () => {
    const windows = linuxDesktop.parseWmctrlList([
        '0x03a00007  0 4242   10   20   800  600  myhost Untitled Document 1 - gedit',
        '0x04000001 -1 99     0    0    1920 32   myhost ',
        'garbage line',
    ].join('\n'));
    assert.equal(windows.length, 2);
    assert.deepEqual(windows[0], {
        id: 0x03a00007,
        desktop: 0,
        processId: 4242,
        bounds: { x: 10, y: 20, width: 800, height: 600 },
        title: 'Untitled Document 1 - gedit',
    });
    assert.equal(windows[1].title, '');
});

test('Linux windows close politely through wmctrl, not kill', async () => {
    const calls = [];
    const run = async (tool, args) => {
        calls.push([tool, ...args]);
        return { stdout: '0x0000002a  0 7 0 0 100 100 host Notes\n' };
    };
    const [window] = await linuxDesktop.listLinuxWindows({ run, readlink: async () => '/usr/bin/gedit' });
    assert.equal(window.path, '/usr/bin/gedit');
    await window.close();
    assert.deepEqual(calls.at(-1), ['wmctrl', '-ic', '0x2a']);
});

test('missing wmctrl produces an install hint', async () => {
    const run = async () => {
        const error = new Error('spawn wmctrl ENOENT');
        error.code = 'ENOENT';
        throw error;
    };
    await assert.rejects(linuxDesktop.listLinuxWindows({ run }), /sudo apt install wmctrl/);
});

test('.desktop Exec lines drop field codes and honor quotes', () => {
    assert.deepEqual(linuxDesktop.parseDesktopExec('/usr/bin/code --unity-launch %F'), {
        command: '/usr/bin/code',
        args: ['--unity-launch'],
    });
    assert.deepEqual(linuxDesktop.parseDesktopExec('"/opt/My App/app" --flag="a b" %U'), {
        command: '/opt/My App/app',
        args: ['--flag=a b'],
    });
    assert.deepEqual(linuxDesktop.parseDesktopExec('app --pct=50%%'), { command: 'app', args: ['--pct=50%'] });
    assert.throws(() => linuxDesktop.parseDesktopExec('%U'), /no command/);
});

test('spawnDetached resolves on spawn and rejects on error', async () => {
    const makeChild = (event, payload) => {
        const child = new EventEmitter();
        child.pid = 123;
        child.unref = () => { child.unrefCalled = true; };
        setImmediate(() => child.emit(event, payload));
        return child;
    };
    let lastOptions;
    const pid = await linuxDesktop.spawnDetached('gedit', [], (cmd, args, options) => {
        lastOptions = options;
        return makeChild('spawn');
    });
    assert.equal(pid, 123);
    assert.equal(lastOptions.detached, true);
    await assert.rejects(
        linuxDesktop.spawnDetached('nope', [], () => makeChild('error', new Error('ENOENT'))),
        /ENOENT/
    );
});

// --- browser-locations -----------------------------------------------------

test('Windows browser order still starts with ProgramW6432 Chrome then Edge', () => {
    const candidates = getBrowserCandidates({
        platform: 'win32',
        env: { ProgramW6432: 'C:\\Program Files', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
        homeDir: 'C:\\Users\\me',
    });
    assert.equal(candidates[0], 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    assert.equal(candidates[1], 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
    assert.ok(candidates.includes('C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
    assert.equal(new Set(candidates).size, candidates.length);
});

test('Linux browser discovery finds Chromium when Chrome is absent', () => {
    const found = findBrowserExecutable({
        platform: 'linux',
        env: {},
        homeDir: '/home/me',
        exists: (candidate) => candidate === '/usr/bin/chromium',
    });
    assert.equal(found, '/usr/bin/chromium');
    assert.equal(findBrowserExecutable({ platform: 'linux', env: {}, homeDir: '/h', exists: () => false }), null);
});

// --- computer-control-handler on Linux -------------------------------------

function createLinuxHandler(env = { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }) {
    const emitter = new EventEmitter();
    const handler = new ComputerControlHandler(emitter, process.cwd(), async () => null);
    handler.platform = 'linux';
    handler.env = env;
    handler.isEnabled = true;
    return { handler, emitter };
}

function runCommand(handler, emitter, payload) {
    return new Promise((resolve) => {
        emitter.once('computer-command-result', ({ result }) => resolve(result));
        handler.handleCommand({ request_id: 'r1', ...payload });
    });
}

test('Wayland sessions get a clear error for input and window actions', async () => {
    const { handler, emitter } = createLinuxHandler({ XDG_SESSION_TYPE: 'wayland' });
    const result = await runCommand(handler, emitter, { action: 'move_mouse', x: 1, y: 1 });
    assert.equal(result.status, 'error');
    assert.match(result.error, /X11 session/);
});

test('Linux open_application launches the matching .desktop entry', async (t) => {
    const { handler } = createLinuxHandler();
    const desktopFile = '/usr/share/applications/org.gnome.gedit.desktop';
    handler._listInstalledApplications = async () => ({
        status: 'success',
        apps: [{ name: 'Text Editor', exec: 'gedit %U', desktop_file: desktopFile }],
    });
    const launched = [];
    handler._launchDesktopEntry = async (file) => { launched.push(file); };
    const spawned = [];
    t.mock.method(linuxDesktop, 'spawnDetached', async (command, args) => { spawned.push([command, ...args]); return 1; });

    const result = await handler._openApplication({ app_name: 'Text Editor' });
    assert.equal(result.status, 'success', result.error);
    assert.deepEqual(launched, [desktopFile]);
    assert.equal(spawned.length, 0);
});

test('Linux open_application falls back to the Exec line when gio fails', async (t) => {
    const { handler } = createLinuxHandler();
    handler._listInstalledApplications = async () => ({
        status: 'success',
        apps: [{ name: 'Text Editor', exec: 'gedit %U', desktop_file: '/usr/share/applications/gedit.desktop' }],
    });
    handler._launchDesktopEntry = async () => { throw new Error('gio missing'); };
    const spawned = [];
    t.mock.method(linuxDesktop, 'spawnDetached', async (command, args) => { spawned.push([command, ...args]); return 1; });
    t.mock.method(console, 'warn', () => {});

    const result = await handler._openApplication({ app_name: 'Text Editor' });
    assert.equal(result.status, 'success', result.error);
    assert.deepEqual(spawned, [['gedit']]);
});

test('Linux open_application with an unknown name spawns it as a program, not a shell string', async (t) => {
    const { handler } = createLinuxHandler();
    handler._listInstalledApplications = async () => ({ status: 'success', apps: [] });
    const spawned = [];
    t.mock.method(linuxDesktop, 'spawnDetached', async (command, args) => { spawned.push([command, ...args]); return 1; });

    const result = await handler._openApplication({ app_name: 'xterm; rm -rf ~' });
    assert.equal(result.status, 'success');
    assert.deepEqual(spawned[0], ['xterm;', 'rm', '-rf', '~']);
});

test('Linux close_window asks the window to close instead of killing its process', async () => {
    const { handler } = createLinuxHandler();
    let closed = false;
    handler._getManagedWindows = async () => [{
        id: 42,
        processId: 9001,
        getTitle: () => 'notes',
        close: async () => { closed = true; },
    }];
    const result = await handler._closeWindow({ window_id: 42 });
    assert.equal(result.status, 'success');
    assert.equal(closed, true);
});

test('Linux close_application closes matching windows gracefully', async () => {
    const { handler } = createLinuxHandler();
    const closedIds = [];
    const makeWindow = (id, exe, title) => ({
        id,
        path: exe,
        getTitle: () => title,
        close: async () => { closedIds.push(id); },
    });
    handler._getManagedWindows = async () => [
        makeWindow(1, '/usr/bin/gedit', 'notes - gedit'),
        makeWindow(2, '/usr/bin/firefox', 'Mozilla Firefox'),
    ];
    const result = await handler._closeApplication({ app_name: 'gedit' });
    assert.equal(result.status, 'success');
    assert.equal(result.closed_windows, 1);
    assert.deepEqual(closedIds, [1]);
});

test('Linux close_application rejects option-like names before pkill', async () => {
    const { handler } = createLinuxHandler();
    handler._getManagedWindows = async () => [];
    const result = await handler._closeApplication({ app_name: '-9' });
    assert.equal(result.status, 'error');
    assert.match(result.error, /Invalid application name/);
});

test('Windows is never blocked by the platform readiness check', () => {
    const handler = new ComputerControlHandler(new EventEmitter(), process.cwd(), async () => null);
    handler.platform = 'win32';
    handler.env = { XDG_SESSION_TYPE: 'wayland' };
    for (const action of ['move_mouse', 'list_windows', 'take_screenshot', 'run_command']) {
        assert.equal(handler._getPlatformBlocker(action), null);
    }
});
