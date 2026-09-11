const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const ComputerControlHandler = require('../computer-control-handler');

function createHandler() {
    const handler = new ComputerControlHandler(new EventEmitter(), process.cwd(), async () => null);
    handler.platform = 'win32';
    return handler;
}

test('active-window detection uses the installed active-win API', { skip: process.platform !== 'win32' }, async () => {
    const result = await createHandler()._getActiveWindow();

    assert.doesNotMatch(result.error || '', /activeWin is not a function/);
    assert.ok(['success', 'error'].includes(result.status));
    if (result.status === 'success') {
        assert.equal(typeof result.title, 'string');
    }
});

test('window listing uses the installed node-window-manager API', { skip: process.platform !== 'win32' }, async () => {
    const result = await createHandler()._listWindows();

    assert.equal(result.status, 'success');
    assert.ok(Array.isArray(result.windows));
    assert.equal(result.count, result.windows.length);
});

test('PowerShell runner preserves multiline scripts and hash literals', { skip: process.platform !== 'win32' }, async () => {
    const handler = createHandler();
    assert.equal(typeof handler._runPowerShell, 'function');

    const { stdout } = await handler._runPowerShell(`
$result = @{
    Name = 'Save'
    ControlType = 'Button'
}
$result | ConvertTo-Json -Compress
`);

    assert.deepEqual(JSON.parse(stdout), {
        Name: 'Save',
        ControlType: 'Button'
    });
});

test('screen-element detection executes its UI Automation script through the safe runner', async () => {
    const handler = createHandler();
    assert.equal(typeof handler._runPowerShell, 'function');

    let receivedScript = '';
    handler._runPowerShell = async (script) => {
        receivedScript = script;
        return {
            stdout: JSON.stringify({
                Name: 'Save',
                ControlType: 'ControlType.Button',
                X: 100,
                Y: 200
            })
        };
    };

    const result = await handler._getScreenElements({ element_type: 'button' });

    assert.match(receivedScript, /UIAutomationClient/);
    assert.match(receivedScript, /\$results \+= @\{/);
    assert.equal(result.status, 'success');
    assert.equal(result.count, 1);
    assert.equal(result.elements[0].Name, 'Save');
});

test('Windows application resolver prefers an exact Start Apps name and executable alias', () => {
    const handler = createHandler();
    assert.equal(typeof handler._resolveWindowsApplication, 'function');

    const apps = [
        {
            name: 'Visual Studio Code',
            id: '{6D809377-6AF0-444B-8957-A3773F02200E}\\Microsoft VS Code\\Code.exe',
            type: 'start_menu'
        },
        {
            name: 'Visual Studio Installer',
            id: 'Microsoft.VisualStudio.Installer',
            type: 'start_menu'
        }
    ];

    assert.equal(handler._resolveWindowsApplication('Visual Studio Code', apps).name, 'Visual Studio Code');
    assert.equal(handler._resolveWindowsApplication('code', apps).name, 'Visual Studio Code');
});

test('opening an application launches the resolved Start Apps entry', async () => {
    const handler = createHandler();
    assert.equal(typeof handler._launchWindowsApplication, 'function');

    const expectedApp = {
        name: 'Notepad',
        id: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App',
        type: 'start_menu'
    };
    handler._listInstalledApplications = async () => ({
        status: 'success',
        apps: [expectedApp]
    });

    let launchedApp = null;
    handler._launchWindowsApplication = async (app) => {
        launchedApp = app;
    };

    const result = await handler._openApplication({ app_name: 'Notepad' });

    assert.equal(result.status, 'success');
    assert.deepEqual(launchedApp, expectedApp);
});

test('closing one window requests WM_CLOSE for that window instead of killing its process', async () => {
    const handler = createHandler();
    assert.equal(typeof handler._getManagedWindows, 'function');
    assert.equal(typeof handler._requestWindowClose, 'function');

    const fakeWindow = {
        id: 42,
        processId: 9001,
        getTitle: () => 'Unsaved document - Notepad'
    };
    handler._getManagedWindows = () => [fakeWindow];

    const requestedWindowIds = [];
    handler._requestWindowClose = async (windowId) => {
        requestedWindowIds.push(windowId);
    };

    const result = await handler._closeWindow({ window_id: 42 });

    assert.equal(result.status, 'success');
    assert.deepEqual(requestedWindowIds, [42]);
});

test('closing an application matches its real executable and gracefully closes its windows', async () => {
    const handler = createHandler();
    assert.equal(typeof handler._getManagedWindows, 'function');
    assert.equal(typeof handler._requestWindowClose, 'function');

    const windows = [
        {
            id: 51,
            processId: 100,
            path: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
            getTitle: () => 'project - Visual Studio Code'
        },
        {
            id: 52,
            processId: 200,
            path: 'C:\\Windows\\System32\\notepad.exe',
            getTitle: () => 'notes - Notepad'
        }
    ];
    handler._getManagedWindows = () => windows;
    handler._listInstalledApplications = async () => ({
        status: 'success',
        apps: [{
            name: 'Visual Studio Code',
            id: '{6D809377-6AF0-444B-8957-A3773F02200E}\\Microsoft VS Code\\Code.exe',
            type: 'start_menu'
        }]
    });

    const requestedWindowIds = [];
    handler._requestWindowClose = async (windowId) => {
        requestedWindowIds.push(windowId);
    };

    const result = await handler._closeApplication({ app_name: 'Visual Studio Code' });

    assert.equal(result.status, 'success');
    assert.equal(result.closed_windows, 1);
    assert.deepEqual(requestedWindowIds, [51]);
});
