// main.js (Definitive Version with Correct Deep Link Handling and Logging)

const electron = require('electron');
const { app, BrowserWindow, ipcMain, BrowserView, shell, dialog, nativeImage, Tray, Menu, globalShortcut } = electron;
const path = require('path');
const PythonBridge = require('./python-bridge');
const http = require('http');
const { EventEmitter } = require('events');
const BrowserHandler = require('./browser-handler.js');
const BrowserSettings = require('./browser-settings.js');
const ComputerControlHandler = require('./computer-control-handler.js');
const LocalCoderHandler = require('./local-coder-handler.js');
const NativeNotificationService = require('./native-notification-service.js');
const WindowsNativeSpeechService = require('./windows-native-speech-service.js');
const { initUpdater } = require('./updater.js');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
    resolveAppIconPath,
    resolveLinuxLaunchCommand,
    setLinuxLaunchAtStartup,
    applyLoginShellPath,
} = require('./platform-integration.js');
const { installNativeFeatures } = require('./native-features.js');
const { parseLaunchAction } = require('./app-actions.js');
const { extractFilePaths } = require('./file-open.js');
const { parseNotificationLink } = require('./run-notification.js');

let mainWindow;
let appTray = null;
let minimizeToTray = false;
let computerToolNotificationsEnabled = true;
let runCompleteNotificationsEnabled = true;

// --- App Name Setup ---
app.setName('Aetheria ai');

// --- CRITICAL: Set Application User Model ID for Windows Taskbar Icon ---
// This ensures Windows properly associates the running app with its icon
// IMPORTANT: Only set this in production, not in development
if (process.platform === 'win32' && app.isPackaged) {
    app.setAppUserModelId('com.aetheria-ai.desktop');
}

// --- macOS: inherit the login shell PATH ---
// Finder/Dock launches get launchd's minimal PATH, which hides Homebrew, nvm,
// pyenv, etc. from the terminal, git and run_command tools. The window waits
// for this (bounded by a timeout inside applyLoginShellPath) so no child
// process starts with the short PATH.
const loginShellPathReady = process.platform === 'darwin'
    ? applyLoginShellPath({ env: process.env, execFile: promisify(execFile) })
    : Promise.resolve(null);

// --- Protocol Registration ---
// This tells the OS that our app can handle 'aios://' links.
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('aios', process.execPath, [path.resolve(process.argv[1])]);
    }
} else {
    app.setAsDefaultProtocolClient('aios');
}

let pythonBridge;
let browserHandler;
let browserSettings;
let computerControlHandler;
let localCoderHandler;
let nativeNotificationService;
let windowsNativeSpeechService;
let linkWebView = null;
let isAppQuitting = false;
// A deep link can arrive before the renderer can receive it: on first launch
// via a link (argv), and on macOS where 'open-url' may fire before 'ready'.
// The newest such link is held here and replayed once the page has loaded.
let pendingDeepLink = null;
let mainWindowLoaded = false;
// Set once the app is really quitting so the close handler stops hiding the
// window. Kept apart from isAppQuitting, which also gates the before-quit
// cleanup and must keep its current meaning.
let allowWindowClose = false;
// OS-native features (taskbar, quick prompt, open-with, ...). Created in
// createWindow(); null until then.
let nativeFeatures = null;
// Launch actions and opened files that arrive before nativeFeatures exists
// (first launch from a jump-list item, or macOS 'open-file' before 'ready').
let pendingLaunchAction = null;
const pendingOpenedFiles = [];
// Messages for the renderer that must wait until the page has loaded.
const pendingRendererMessages = [];

function sendToRendererWhenReady(channel, payload) {
    if (mainWindowLoaded && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    } else {
        pendingRendererMessages.push({ channel, payload });
    }
}

function flushPendingRendererMessages() {
    while (pendingRendererMessages.length && mainWindow && !mainWindow.isDestroyed()) {
        const { channel, payload } = pendingRendererMessages.shift();
        mainWindow.webContents.send(channel, payload);
    }
}

function handleLaunchAction(action) {
    if (!action) return;
    if (nativeFeatures) nativeFeatures.handleLaunchAction(action);
    else pendingLaunchAction = action;
}

function handleOpenedFiles(filePaths) {
    if (!filePaths.length) return;
    if (nativeFeatures) {
        nativeFeatures.openFiles(filePaths).catch((error) => console.error('[main.js] Opening files failed:', error.message));
    } else {
        pendingOpenedFiles.push(...filePaths);
    }
}

function filePathsFromArgv(argv, cwd) {
    const fsSync = require('fs');
    return extractFilePaths(argv, {
        cwd,
        isFile: (candidate) => {
            try {
                return fsSync.statSync(candidate).isFile();
            } catch {
                return false;
            }
        },
        ignore: [process.execPath, app.getAppPath()],
    });
}

// macOS delivers "Open with", Dock drops and recent documents through this
// event, possibly before 'ready'.
app.on('open-file', (event, filePath) => {
    event.preventDefault();
    handleOpenedFiles([filePath]);
});

const INTEGRATION_CALLBACK_PROVIDERS = new Set([
    'github',
    'google',
    'vercel',
    'supabase',
    'composio_whatsapp',
    'composio_facebook',
    'composio_instagram',
    'composio_youtube'
]);

// --- CRITICAL SECTION 1: The Deep Link Handler ---
// This function's only job is to receive the URL from the OS and pass it to the UI.
function parseTrustedDeepLink(rawUrl) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl || ''));
    } catch (error) {
        return null;
    }

    if (parsed.protocol !== 'aios:') {
        return null;
    }

    const host = parsed.hostname;
    const pathName = parsed.pathname || '';

    if (host === 'auth' && pathName === '/callback') {
        const provider = parsed.searchParams.get('provider') || 'unknown';
        if (!/^[a-z0-9_-]{1,64}$/i.test(provider) || !INTEGRATION_CALLBACK_PROVIDERS.has(provider)) {
            return null;
        }

        return {
            type: 'integration-callback',
            parsed,
            provider,
        };
    }

    if (host === 'auth-callback' || (host === 'auth' && pathName === '/auth-callback')) {
        const hash = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash);
        if (!hash.get('access_token') || !hash.get('refresh_token')) {
            return null;
        }

        return {
            type: 'auth-callback',
            parsed,
        };
    }

    // Buttons on the Windows "task finished" toast (run-notification.js).
    const notificationAction = parseNotificationLink(parsed);
    if (notificationAction) {
        return {
            type: 'notification-action',
            parsed,
            ...notificationAction,
        };
    }

    return null;
}

// Brings the main window back from any hidden/minimized state. Returns false when
// there is no usable window. `show()` is required because "minimize to tray" hides
// the window rather than minimizing it, so isMinimized()/focus() alone are no-ops.
function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
}

function handleDeepLink(url) {
    console.log('[main.js] >>> handleDeepLink function triggered.');

    const trustedLink = parseTrustedDeepLink(url);
    if (!trustedLink) {
        console.warn('[main.js] >>> Ignored untrusted or unsupported deep link.');
        return;
    }

    if (!mainWindowLoaded || !mainWindow || mainWindow.isDestroyed()) {
        console.log('[main.js] >>> Window not ready yet; deep link queued until the page loads.');
        pendingDeepLink = url;
        return;
    }

    // Bring the app window to the front, this is crucial.
    if (!showMainWindow()) {
        console.error('[main.js] >>> Error: mainWindow is not available. The app might still be launching.');
        return;
    }

    if (trustedLink.type === 'notification-action') {
        mainWindow.webContents.send('app-action', {
            action: trustedLink.action,
            conversationId: trustedLink.conversationId,
        });
        return;
    }

    if (trustedLink.type === 'integration-callback') {
        const params = trustedLink.parsed.searchParams;
        const error = params.get('error') || params.get('error_description');
        const statusParam = params.get('status');
        const successParam = params.get('success');
        const success = statusParam
            ? statusParam === 'success'
            : (successParam ? successParam === 'true' : !error);

        console.log('[main.js] >>> Emitting oauth-integration-callback from deep link.');
        mainWindow.webContents.send('oauth-integration-callback', {
            success,
            provider: trustedLink.provider,
            error: error || null,
            connectedAccountId: params.get('connected_account_id') || params.get('connectedAccountId') || null,
        });
        return;
    }

    console.log('[main.js] >>> Forwarding "auth-state-changed" IPC message to the renderer process.');
    // We send the raw URL. The Supabase client in the renderer will handle it.
    mainWindow.webContents.send('auth-state-changed', { url });
}

// --- CRITICAL SECTION 2: Single Instance Lock ---
// This ensures that when a deep link is clicked, the URL is sent to your
// ALREADY RUNNING application, instead of trying to launch a new one.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // If we don't get the lock, another instance is already running, so this new one quits.
    app.quit();
} else {
    // This event fires in the PRIMARY instance when a second instance is launched.
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('[main.js] >>> "second-instance" event fired.');
        const deepLinkUrl = commandLine.find(arg => arg.startsWith('aios://'));

        const launchAction = parseLaunchAction(commandLine);
        const openedFiles = filePathsFromArgv(commandLine, workingDirectory);

        if (deepLinkUrl) {
            console.log('[main.js] >>> Deep link found in second instance arguments.');
            handleDeepLink(deepLinkUrl);
        } else if (launchAction) {
            // Jump list / Linux desktop action while the app is running.
            handleLaunchAction(launchAction);
        } else if (openedFiles.length) {
            // "Open with Aetheria ai" or a file dropped on the shortcut.
            handleOpenedFiles(openedFiles);
        } else {
            // If it wasn't a deep link, just surface the existing window.
            showMainWindow();
        }
    });

    // This handles the case where the app is launched for the first time via a deep link.
    const deepLinkArg = process.argv.find(arg => arg.startsWith('aios://'));
    if (deepLinkArg) {
        app.whenReady().then(() => handleDeepLink(deepLinkArg));
    }

    // First launch from a jump-list task / desktop action, or "Open with".
    // Both are held until createWindow() has set up nativeFeatures.
    const firstLaunchAction = parseLaunchAction(process.argv);
    if (firstLaunchAction) pendingLaunchAction = firstLaunchAction;
    if (!deepLinkArg && !firstLaunchAction) {
        app.whenReady().then(() => {
            const files = filePathsFromArgv(process.argv);
            if (files.length) handleOpenedFiles(files);
        });
    }
}


function getAppIconPath() {
    return resolveAppIconPath({
        platform: process.platform,
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        devAssetsDir: path.join(__dirname, '..', 'assets'),
    });
}

function createSystemTray() {
    if (appTray) return;
    try {
        const fs = require('fs');
        const trayIconPath = getAppIconPath();
        if (!fs.existsSync(trayIconPath)) {
            console.error('[Tray] Icon not found:', trayIconPath);
            return;
        }
        const trayIcon = nativeImage.createFromPath(trayIconPath);
        appTray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
        appTray.setToolTip('Aetheria ai');
        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Show Aetheria ai',
                click: () => { showMainWindow(); }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    isAppQuitting = true;
                    app.quit();
                }
            }
        ]);
        appTray.setContextMenu(contextMenu);
        // 'double-click' is emitted on Windows and macOS only. Linux tray hosts
        // (AppIndicator) only expose the context menu, which has "Show".
        appTray.on('double-click', () => { showMainWindow(); });
        console.log('[Tray] System tray created successfully');
    } catch (error) {
        console.error('[Tray] Error creating system tray:', error);
    }
}

function createWindow() {
    const mainProcessEmitter = new EventEmitter();
    const fs = require('fs');

    // Resolve icon path for both development and production. Packaged builds
    // copy icon.ico and icon.png into resources/ via extraResources. Windows
    // keeps the .ico; macOS and Linux use the .png because nativeImage cannot
    // decode .ico there.
    const iconPath = getAppIconPath();
    console.log(`[Icon] ${app.isPackaged ? 'Production' : 'Development'} icon path:`, iconPath);

    // Verify icon exists
    const iconExists = fs.existsSync(iconPath);
    console.log('[Icon] Path exists:', iconExists);

    if (!iconExists) {
        console.error('[Icon] CRITICAL: Icon file not found at:', iconPath);
    }

    // Create native image from icon path
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
        console.error('[Icon] Failed to load icon from path:', iconPath);
    } else {
        console.log('[Icon] Successfully loaded icon, size:', icon.getSize());
    }

    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: icon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: true,
            enableRemoteModule: true,
            webSecurity: false,
            webviewTag: true  // Enable <webview> tag support
        },
        // macOS keeps the real traffic-light buttons over the custom chrome
        // (the renderer hides its own min/max/close there). Windows and Linux
        // stay frameless with the app's own controls.
        ...(process.platform === 'darwin'
            ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } }
            : { frame: false }),
        transparent: true,
        skipTaskbar: false  // Explicitly show in taskbar
    });

    // Additional Windows-specific icon handling
    // This ensures the icon is properly set for the window and taskbar
    if (process.platform === 'win32') {
        mainWindow.setIcon(icon);
        // Set overlay icon (shown in taskbar when app is running)
        mainWindow.setOverlayIcon(icon, 'Aetheria ai');
    }

    // Packaged macOS builds take the Dock icon from the app bundle. An
    // unpackaged run would otherwise show the generic Electron icon.
    if (process.platform === 'darwin' && !app.isPackaged && app.dock && !icon.isEmpty()) {
        app.dock.setIcon(icon);
    }

    mainWindow.webContents.once('did-finish-load', () => {
        mainWindowLoaded = true;
        flushPendingRendererMessages();
        if (pendingDeepLink) {
            const queuedLink = pendingDeepLink;
            pendingDeepLink = null;
            handleDeepLink(queuedLink);
        }
    });

    nativeFeatures = installNativeFeatures({
        electron,
        getWindow: () => mainWindow,
        getPythonBridge: () => pythonBridge,
        getComputerHandler: () => computerControlHandler,
        emitter: mainProcessEmitter,
        sendToRenderer: sendToRendererWhenReady,
        showMainWindow,
        getAuthToken: async () => {
            try {
                const session = await mainWindow.webContents.executeJavaScript('window.electron.auth.getSession()', true);
                return session ? session.access_token : null;
            } catch (error) {
                console.error('[main.js] Could not read the session for run control:', error.message);
                return null;
            }
        },
        appRoot: path.join(__dirname, '..'),
    });
    if (process.platform === 'win32' && !icon.isEmpty()) {
        // The badge replaces this overlay while unread runs exist.
        nativeFeatures.setDefaultOverlay?.(icon, 'Aetheria ai');
    }
    if (pendingLaunchAction) {
        const action = pendingLaunchAction;
        pendingLaunchAction = null;
        handleLaunchAction(action);
    }
    if (pendingOpenedFiles.length) {
        handleOpenedFiles(pendingOpenedFiles.splice(0));
    }

    mainWindow.maximize();
    mainWindow.loadFile('index.html');
    windowsNativeSpeechService = new WindowsNativeSpeechService(mainWindow);
    const devToolsAccelerator = 'CommandOrControl+Shift+D';
    const registerDevToolsAccelerator = () => {
        if (!globalShortcut.isRegistered(devToolsAccelerator)) {
            globalShortcut.register(devToolsAccelerator, () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.toggleDevTools();
                }
            });
        }
    };
    const unregisterDevToolsAccelerator = () => globalShortcut.unregister(devToolsAccelerator);
    mainWindow.on('focus', registerDevToolsAccelerator);
    mainWindow.on('blur', unregisterDevToolsAccelerator);
    mainWindow.on('closed', unregisterDevToolsAccelerator);

    pythonBridge = new PythonBridge(mainWindow, mainProcessEmitter);

    const getAuthToken = async () => {
        try {
            const session = await mainWindow.webContents.executeJavaScript(
                'window.electron.auth.getSession()',
                true
            );
            return session ? session.access_token : null;
        } catch (error) {
            console.error("Main process failed to get auth token:", error);
            return null;
        }
    };

    const appDataPath = app.getPath('userData');
    browserSettings = new BrowserSettings(appDataPath);
    browserHandler = new BrowserHandler(mainProcessEmitter, appDataPath, getAuthToken, browserSettings);

    browserHandler.initialize();

    pythonBridge.setBrowserController(browserHandler);

    // Initialize Computer Control Handler
    computerControlHandler = new ComputerControlHandler(mainProcessEmitter, appDataPath, getAuthToken);
    computerControlHandler.initialize();
    pythonBridge.setComputerController(computerControlHandler);

    // Initialize Local Coder Handler
    localCoderHandler = new LocalCoderHandler(mainProcessEmitter, mainWindow);
    localCoderHandler.initialize();
    pythonBridge.setLocalCoderController(localCoderHandler);

    nativeNotificationService = new NativeNotificationService();
    nativeNotificationService.setMainWindow(mainWindow);

    mainProcessEmitter.on('computer-tool-notification', (data) => {
        console.log('[main.js] Routing computer tool notification to native pipeline:', {
            action: data?.action || null,
            message: data?.message || null
        });
        if (!nativeNotificationService) {
            return;
        }
        if (!computerToolNotificationsEnabled) {
            return;
        }
        nativeNotificationService.queueNotification(
            data?.action || 'computer_tool',
            data?.message || 'Computer tool used',
            { urgency: 'low' }
        );
    });

    // --- Agent Run Completion → Native OS Notification ---
    mainProcessEmitter.on('run-completed', (data) => {
        // Only show native notification when user is NOT actively using the app
        const isBackgrounded = !mainWindow.isFocused() || mainWindow.isMinimized();
        // Taskbar badge + flash / Dock bounce (also counts a hidden window).
        nativeFeatures?.onRunCompleted();
        console.log('[main.js] Agent run completed:', {
            conversationId: data?.conversationId || null,
            title: data?.title || null,
            isBackgrounded,
            notificationsEnabled: runCompleteNotificationsEnabled,
        });

        if (isBackgrounded && nativeNotificationService && runCompleteNotificationsEnabled) {
            const taskTitle = (data?.title || '').trim() || 'AI task';
            const preview = (data?.preview || '').trim();
            // Build notification body: title + first few lines of preview
            let body = `Your "${taskTitle}" task is completed.`;
            if (preview) {
                // Take first ~200 chars of preview for the notification body
                const previewSnippet = preview.length > 200
                    ? preview.substring(0, 200) + '…'
                    : preview;
                body += `\n${previewSnippet}`;
            }
            nativeNotificationService.showNotification(
                'Aetheria ai',
                body,
                {
                    tag: `run-completed-${data?.conversationId || 'unknown'}`,
                    urgency: 'normal',
                    silent: false,
                    // Open chat / Reply buttons where the OS supports them.
                    ...(nativeFeatures?.runCompletedNotificationOptions({
                        conversationId: data?.conversationId,
                        title: 'Aetheria ai',
                        body,
                    }) || {}),
                }
            );
        }
    });

    // --- Fix: Handle the toggle-native-notifications IPC from renderer settings ---
    ipcMain.on('toggle-native-notifications', (event, enabled) => {
        console.log('[main.js] Native notifications toggled:', enabled);
        if (nativeNotificationService) {
            nativeNotificationService.setEnabled(enabled);
        }
    });

    // --- Granular Notification Controls ---
    ipcMain.on('toggle-computer-tool-notifications', (event, enabled) => {
        console.log('[main.js] Computer tool notifications toggled:', enabled);
        computerToolNotificationsEnabled = enabled;
    });

    ipcMain.on('toggle-run-complete-notifications', (event, enabled) => {
        console.log('[main.js] Run complete notifications toggled:', enabled);
        runCompleteNotificationsEnabled = enabled;
    });

    // --- General Settings IPC Handlers ---
    ipcMain.on('set-always-on-top', (event, enabled) => {
        console.log('[main.js] Always on top toggled:', enabled);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(enabled);
        }
    });

    ipcMain.on('set-launch-at-startup', (event, enabled) => {
        console.log('[main.js] Launch at startup toggled:', enabled);
        if (process.platform === 'linux') {
            // setLoginItemSettings() does nothing on Linux; use an XDG autostart entry.
            setLinuxLaunchAtStartup(Boolean(enabled), {
                fsPromises: require('fs').promises,
                env: process.env,
                homeDir: app.getPath('home'),
                appName: 'Aetheria ai',
                launchCommand: resolveLinuxLaunchCommand({
                    env: process.env,
                    execPath: process.execPath,
                    isPackaged: app.isPackaged,
                    appPath: app.getAppPath(),
                }),
            })
                .then((result) => console.log('[main.js] Linux autostart entry updated:', result))
                .catch((error) => console.error('[main.js] Failed to update Linux autostart entry:', error.message));
            return;
        }
        app.setLoginItemSettings({
            openAtLogin: enabled,
            name: 'Aetheria ai'
        });
    });

    ipcMain.on('toggle-devtools', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.toggleDevTools();
        }
    });

    ipcMain.on('set-minimize-to-tray', (event, enabled) => {
        console.log('[main.js] Minimize to tray toggled:', enabled);
        minimizeToTray = enabled;
        if (enabled && !appTray) {
            createSystemTray();
        } else if (!enabled && appTray) {
            appTray.destroy();
            appTray = null;
        }
    });

    // --- Close window: minimize to tray if setting is on ---
    mainWindow.on('close', (event) => {
        if (isAppQuitting || allowWindowClose) return;

        if (minimizeToTray) {
            event.preventDefault();
            if (!appTray) createSystemTray();
            // Hiding with no tray icon would leave nothing to click to get the
            // window back, so fall back to a normal minimize.
            if (appTray) {
                mainWindow.hide();
            } else {
                mainWindow.minimize();
            }
            return;
        }

        // macOS convention: closing the window keeps the app alive in the Dock,
        // and clicking the Dock icon brings it back ('activate' below). The
        // window is hidden rather than destroyed because createWindow() also
        // registers every IPC handler and cannot run a second time.
        if (process.platform === 'darwin') {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    pythonBridge.start().catch(error => {
        console.error('Python bridge error:', error.message);
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('socket-connection-status', {
                connected: false,
                error: 'Failed to connect to Python backend: ' + error.message
            });
        });

        setTimeout(() => {
            console.log('Attempting to reconnect to Python backend...');
            if (pythonBridge) {
                pythonBridge.stop();
            }
            pythonBridge = new PythonBridge(mainWindow, mainProcessEmitter);
            pythonBridge.setBrowserController(browserHandler);
            pythonBridge.setComputerController(computerControlHandler);
            pythonBridge.setLocalCoderController(localCoderHandler);
            pythonBridge.start().catch(err => {
                console.error('Python bridge reconnection failed:', err.message);
            });
        }, 10000);
    });

    ipcMain.on('minimize-window', () => { mainWindow.minimize(); });
    ipcMain.on('toggle-maximize-window', () => {
        if (mainWindow.isMaximized()) { mainWindow.unmaximize(); } else { mainWindow.maximize(); }
        mainWindow.webContents.send('window-state-changed', mainWindow.isMaximized());
    });
    ipcMain.on('close-window', () => { mainWindow.close(); });
    ipcMain.on('deepsearch-request', (event, data) => { pythonBridge.sendMessage(data); });
    ipcMain.on('check-socket-connection', (event) => {
        const isConnected = pythonBridge.socket && pythonBridge.socket.connected;
        event.reply('socket-connection-status', { connected: isConnected });
    });
    ipcMain.on('restart-python-bridge', () => {
        if (pythonBridge) { pythonBridge.stop(); }
        pythonBridge = new PythonBridge(mainWindow, mainProcessEmitter);
        pythonBridge.setBrowserController(browserHandler);
        pythonBridge.setComputerController(computerControlHandler);
        pythonBridge.setLocalCoderController(localCoderHandler);
        pythonBridge.start().catch(error => {
            console.error('Failed to restart Python bridge:', error);
            mainWindow.webContents.send('socket-connection-status', {
                connected: false,
                error: 'Failed to connect to Python backend: ' + error.message
            });
        });
    });

    // --- Browser Automation Settings ---
    // Main owns these because BrowserHandler reads them on every launch. The
    // renderer only renders and patches them, so a window that never opens
    // cannot leave the agent running on stale values.
    ipcMain.handle('browser-settings:get', () => browserSettings.get());

    ipcMain.handle('browser-settings:set', async (event, patch) => {
        const before = browserSettings.get();
        const after = browserSettings.update(patch);
        // Window mode is a Chrome command-line flag, fixed for the life of the
        // process. Drop the running instance so the next command relaunches with
        // the new flags rather than silently ignoring the change.
        if (before.visibility !== after.visibility && browserHandler) {
            await browserHandler.closeBrowser();
        }
        return after;
    });

    // One channel for every browser profile action. The action travels in the
    // payload, so adding a session or cookie feature never needs a new channel
    // (and never needs another preload whitelist entry).
    ipcMain.handle('browser-data', async (event, payload) => {
        if (!browserHandler) {
            return { success: false, error: 'Browser handler not initialized' };
        }
        const { action, url, domain } = payload || {};
        switch (action) {
            case 'open': return browserHandler.openBrowserWindow(url);
            case 'listSites': return browserHandler.listSites();
            case 'clearSite': return browserHandler.clearSite(domain);
            case 'clearAllCookies': return browserHandler.clearAllCookies();
            default: return { success: false, error: `Unknown browser action: ${action}` };
        }
    });

    ipcMain.handle('computer-get-access-state', async () => {
        if (!computerControlHandler) {
            return { success: false, error: 'Computer control handler not initialized' };
        }
        return { success: true, state: computerControlHandler.getAccessState() };
    });

    ipcMain.handle('computer-manual-grant', async () => {
        if (!computerControlHandler) {
            return { success: false, error: 'Computer control handler not initialized' };
        }
        const state = computerControlHandler.grantManualPermission();
        return { success: true, state };
    });

    ipcMain.handle('computer-select-scope', async () => {
        if (!computerControlHandler) {
            return { success: false, error: 'Computer control handler not initialized' };
        }

        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Computer Tool Scope',
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: 'Use This Folder'
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }

        const state = computerControlHandler.setPrimaryScope(result.filePaths[0]);
        return { success: true, state, selectedPath: result.filePaths[0] };
    });

    ipcMain.handle('project-select-local-workspace', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Local Project Folder',
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: 'Use Folder',
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }
        return { success: true, selectedPath: result.filePaths[0] };
    });

    ipcMain.handle('project-local-clone-repo', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }

        const body = payload && typeof payload === 'object' ? payload : {};
        let selectedFolder = String(body.parentFolder || '').trim();
        if (!selectedFolder) {
            const selection = await dialog.showOpenDialog(mainWindow, {
                title: 'Choose Destination Folder',
                properties: ['openDirectory', 'createDirectory'],
                buttonLabel: 'Clone Here',
            });
            if (selection.canceled || !selection.filePaths || selection.filePaths.length === 0) {
                return { success: false, canceled: true };
            }
            selectedFolder = selection.filePaths[0];
        }

        return localCoderHandler.cloneRepo({
            conversationId: body.conversationId,
            repoUrl: body.repoUrl,
            branch: body.branch || 'main',
            parentFolder: selectedFolder,
        });
    });

    ipcMain.handle('project-local-import-files', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }

        const body = payload && typeof payload === 'object' ? payload : {};
        let selectedFolder = String(body.parentFolder || '').trim();
        if (!selectedFolder) {
            const selection = await dialog.showOpenDialog(mainWindow, {
                title: 'Choose Location For Deployed Project',
                properties: ['openDirectory', 'createDirectory'],
                buttonLabel: 'Save Project Here',
            });
            if (selection.canceled || !selection.filePaths || selection.filePaths.length === 0) {
                return { success: false, canceled: true };
            }
            selectedFolder = selection.filePaths[0];
        }

        return localCoderHandler.importProjectFiles({
            conversationId: body.conversationId,
            parentFolder: selectedFolder,
            projectName: body.projectName,
            files: Array.isArray(body.files) ? body.files : [],
            repoUrl: body.repoUrl || null,
            branch: body.branch || 'main',
            metadata: body.metadata || {},
        });
    });

    ipcMain.handle('project-local-set-context', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }

        const body = payload && typeof payload === 'object' ? payload : {};
        if (!body.conversationId) {
            return { success: false, error: 'conversationId is required' };
        }
        const context = localCoderHandler.setWorkspaceContext(body.conversationId, body.context || {});
        return { success: true, context };
    });

    ipcMain.handle('project-local-tree', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }
        const body = payload && typeof payload === 'object' ? payload : {};
        return localCoderHandler.listWorkspaceTree({
            conversationId: body.conversationId,
            rootPath: body.rootPath,
        });
    });

    ipcMain.handle('project-local-file-content', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }
        const body = payload && typeof payload === 'object' ? payload : {};
        return localCoderHandler.readWorkspaceFile({
            conversationId: body.conversationId,
            rootPath: body.rootPath,
            relativePath: body.path,
        });
    });

    ipcMain.handle('project-watch-local-workspace', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }
        const body = payload && typeof payload === 'object' ? payload : {};
        return localCoderHandler.startWatching(body.conversationId, body.rootPath);
    });

    ipcMain.handle('project-unwatch-local-workspace', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }
        const body = payload && typeof payload === 'object' ? payload : {};
        localCoderHandler.stopWatching(body.conversationId);
        return { success: true };
    });

    // Single entry point for every source-control operation. The action name
    // travels in the payload so adding git features never needs a new channel
    // (and never needs another preload whitelist entry).
    ipcMain.handle('project-local-git', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }
        const body = payload && typeof payload === 'object' ? payload : {};
        return localCoderHandler.gitAction(body);
    });

    ipcMain.handle('project-local-terminal-start', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }
        const body = payload && typeof payload === 'object' ? payload : {};
        return localCoderHandler.startTerminal(body.conversationId, body.cwd, {
            cols: body.cols,
            rows: body.rows,
        });
    });

    ipcMain.handle('project-local-terminal-send', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }
        const body = payload && typeof payload === 'object' ? payload : {};
        const data = body.data != null ? body.data : body.command;
        return localCoderHandler.sendTerminalInput(body.conversationId, data);
    });

    ipcMain.handle('project-local-terminal-resize', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }
        const body = payload && typeof payload === 'object' ? payload : {};
        return localCoderHandler.resizeTerminal(body.conversationId, body.cols, body.rows);
    });

    ipcMain.handle('project-local-terminal-stop', async (event, payload) => {
        if (!localCoderHandler) {
            return { success: false, error: 'Local coder handler not initialized' };
        }
        const body = payload && typeof payload === 'object' ? payload : {};
        return localCoderHandler.stopTerminal(body.conversationId);
    });

    ipcMain.on('open-webview', (event, url) => {
        console.log('Received open-webview request for URL:', url);

        if (linkWebView) {
            try {
                mainWindow.removeBrowserView(linkWebView);
                linkWebView.webContents.destroy();
                linkWebView = null;
            } catch (error) {
                console.error('Error closing existing linkWebView:', error);
            }
        }

        try {
            linkWebView = new BrowserView({
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: true
                }
            });

            mainWindow.addBrowserView(linkWebView);

            const contentBounds = mainWindow.getContentBounds();
            const bounds = {
                x: Math.round(contentBounds.width * 0.65),
                y: 100,
                width: Math.round(contentBounds.width * 0.30),
                height: Math.round(contentBounds.height * 0.5)
            };

            linkWebView.setBounds({
                x: bounds.x + 10,
                y: bounds.y + 60,
                width: bounds.width - 20,
                height: bounds.height - 70
            });

            linkWebView.webContents.on('did-start-loading', () => {
                mainWindow.webContents.send('webview-navigation-updated', { url: linkWebView.webContents.getURL(), loading: true });
            });
            linkWebView.webContents.on('did-finish-load', () => {
                const currentUrl = linkWebView.webContents.getURL();
                mainWindow.webContents.send('webview-navigation-updated', { url: currentUrl, loading: false, canGoBack: linkWebView.webContents.canGoBack(), canGoForward: linkWebView.webContents.canGoForward() });
                mainWindow.webContents.send('webview-page-loaded');
            });
            linkWebView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                console.error('linkWebView failed to load:', errorDescription);
                mainWindow.webContents.send('webview-navigation-updated', { error: errorDescription });
            });

            // Listen for navigation to aios:// deep link (OAuth callback)
            linkWebView.webContents.on('will-navigate', (event, navigationUrl) => {
                console.log('linkWebView will-navigate');

                // Check if navigating to aios:// deep link
                if (navigationUrl.startsWith('aios://')) {
                    event.preventDefault();
                    const trustedLink = parseTrustedDeepLink(navigationUrl);
                    if (!trustedLink || trustedLink.type !== 'integration-callback') {
                        console.warn('Ignored untrusted webview deep link navigation.');
                        return;
                    }
                    console.log('OAuth callback detected, closing webview and processing deep link');

                    // Parse the deep link URL
                    try {
                        const url = trustedLink.parsed;
                        const params = new URLSearchParams(url.search);
                        const statusParam = params.get('status');
                        const successParam = params.get('success');
                        const error = params.get('error') || params.get('error_description');
                        const success = statusParam
                            ? statusParam === 'success'
                            : (successParam ? successParam === 'true' : !error);
                        const provider = trustedLink.provider;

                        // Close the webview
                        if (linkWebView) {
                            mainWindow.removeBrowserView(linkWebView);
                            linkWebView.webContents.destroy();
                            linkWebView = null;
                            mainWindow.webContents.send('webview-closed');
                        }

                        // Send OAuth callback result to renderer
                        mainWindow.webContents.send('oauth-integration-callback', {
                            success: success,
                            provider: provider,
                            error: error,
                            connectedAccountId: params.get('connected_account_id') || params.get('connectedAccountId') || null
                        });

                    } catch (e) {
                        console.error('Error parsing OAuth callback URL:', e);
                    }
                }
            });
            linkWebView.webContents.loadURL(url).then(() => {
                console.log('URL loaded successfully:', url);
                mainWindow.webContents.send('webview-created', bounds);
            }).catch((error) => {
                console.error('Failed to load URL:', error);
                mainWindow.webContents.send('socket-error', { message: `Failed to load URL: ${error.message}` });
            });
        } catch (error) {
            console.error('Error creating linkWebView:', error);
            mainWindow.webContents.send('socket-error', { message: `Error creating linkWebView: ${error.message}` });
        }
    });
    ipcMain.on('resize-webview', (event, bounds) => { if (linkWebView) { linkWebView.setBounds({ x: bounds.x + 10, y: bounds.y + 60, width: bounds.width - 20, height: bounds.height - 70 }); } });
    ipcMain.on('drag-webview', (event, { x, y }) => { if (linkWebView) { const currentBounds = linkWebView.getBounds(); linkWebView.setBounds({ x: x + 10, y: y + 60, width: currentBounds.width, height: currentBounds.height }); } });
    ipcMain.on('close-webview', () => { if (linkWebView) { mainWindow.removeBrowserView(linkWebView); linkWebView.webContents.destroy(); linkWebView = null; mainWindow.webContents.send('webview-closed'); } });

    // User context handlers - forward to backend via Socket.IO
    ipcMain.on('save-user-context', async (event, data) => {
        try {
            const session = await mainWindow.webContents.executeJavaScript('window.electron.auth.getSession()', true);
            if (!session || !session.access_token) {
                mainWindow.webContents.send('user-context-saved', { success: false, error: 'Not authenticated' });
                return;
            }

            // Forward to backend via python bridge
            if (pythonBridge && pythonBridge.socket && pythonBridge.socket.connected) {
                pythonBridge.socket.emit('save-user-context', {
                    accessToken: session.access_token,
                    context: data.context
                });

                // Listen for response
                pythonBridge.socket.once('user-context-saved', (result) => {
                    mainWindow.webContents.send('user-context-saved', result);
                });
            } else {
                mainWindow.webContents.send('user-context-saved', { success: false, error: 'Backend not connected' });
            }
        } catch (error) {
            console.error('Error saving user context:', error);
            mainWindow.webContents.send('user-context-saved', { success: false, error: error.message });
        }
    });

    ipcMain.on('get-user-context', async (event) => {
        try {
            const session = await mainWindow.webContents.executeJavaScript('window.electron.auth.getSession()', true);
            if (!session || !session.access_token) {
                mainWindow.webContents.send('user-context-retrieved', { success: false, error: 'Not authenticated' });
                return;
            }

            // Forward to backend via python bridge
            if (pythonBridge && pythonBridge.socket && pythonBridge.socket.connected) {
                pythonBridge.socket.emit('get-user-context', {
                    accessToken: session.access_token
                });

                // Listen for response
                pythonBridge.socket.once('user-context-retrieved', (result) => {
                    mainWindow.webContents.send('user-context-retrieved', result);
                });
            } else {
                mainWindow.webContents.send('user-context-retrieved', { success: false, error: 'Backend not connected' });
            }
        } catch (error) {
            console.error('Error getting user context:', error);
            mainWindow.webContents.send('user-context-retrieved', { success: false, error: error.message });
        }
    });
}

// --- macOS Deep Link Handler ---
app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
});

const fs = require('fs').promises;
ipcMain.handle('show-save-dialog', async (event, options) => { return await dialog.showSaveDialog(mainWindow, options); });
ipcMain.handle('save-file', async (event, { filePath, content, encoding = 'utf8' }) => {
    try {
        if (encoding === 'base64') {
            await fs.writeFile(filePath, Buffer.from(content, 'base64'));
        } else if (encoding === 'binary') {
            await fs.writeFile(filePath, Buffer.from(content, 'binary'));
        } else {
            await fs.writeFile(filePath, content, 'utf8');
        }
        nativeFeatures?.addRecentDocument(filePath);
        return true;
    } catch (error) {
        console.error('Error saving file:', error);
        return false;
    }
});
ipcMain.handle('export-conversation-pdf', async (event, payload) => {
    const html = String(payload?.html || '').trim();
    const defaultPath = String(payload?.defaultPath || 'aetheria-conversation.pdf').trim() || 'aetheria-conversation.pdf';

    if (!html) {
        return { success: false, error: 'No conversation HTML provided.' };
    }

    let exportWindow = null;
    try {
        const saveResult = await dialog.showSaveDialog(mainWindow, {
            defaultPath,
            filters: [
                { name: 'PDF Files', extensions: ['pdf'] }
            ]
        });

        if (saveResult.canceled || !saveResult.filePath) {
            return { canceled: true };
        }

        exportWindow = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true
            }
        });

        await exportWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
        const pdfBuffer = await exportWindow.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
            pageSize: 'A4',
            marginsType: 1,
            landscape: false
        });

        await fs.writeFile(saveResult.filePath, pdfBuffer);
        nativeFeatures?.addRecentDocument(saveResult.filePath);
        return { success: true, filePath: saveResult.filePath };
    } catch (error) {
        console.error('Error exporting conversation PDF:', error);
        return { success: false, error: error.message || 'Failed to export PDF.' };
    } finally {
        if (exportWindow && !exportWindow.isDestroyed()) {
            exportWindow.destroy();
        }
    }
});
ipcMain.handle('get-path', (event, pathName) => { try { return app.getPath(pathName); } catch (error) { console.error(`Error getting path for ${pathName}:`, error); return null; } });
ipcMain.handle('get-app-path', () => { return app.getAppPath(); });
ipcMain.handle('resolve-app-resource', (event, ...segments) => { return path.join(app.getAppPath(), ...segments); });
ipcMain.handle('native-speech-status', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !windowsNativeSpeechService) {
        return { supported: false, active: false, ready: false };
    }
    return windowsNativeSpeechService.getStatus();
});
ipcMain.handle('native-speech-start', (event, options = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !windowsNativeSpeechService) {
        return { ok: false, code: 'unavailable', error: 'Windows speech input is unavailable.' };
    }
    return windowsNativeSpeechService.start({ language: options?.language });
});
ipcMain.handle('native-speech-stop', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !windowsNativeSpeechService) {
        return { ok: false, code: 'unavailable', error: 'Windows speech input is unavailable.' };
    }
    return windowsNativeSpeechService.stop();
});

// Handle save file dialog for sharing AI responses
ipcMain.on('save-file-dialog', async (event, { content, defaultPath, filters }) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultPath,
            filters: filters || [
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'Markdown Files', extensions: ['md'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result.canceled && result.filePath) {
            await fs.writeFile(result.filePath, content, 'utf8');
            nativeFeatures?.addRecentDocument(result.filePath);
            event.reply('save-file-result', { success: true, filePath: result.filePath });
        } else {
            event.reply('save-file-result', { canceled: true });
        }
    } catch (error) {
        console.error('Error saving file:', error);
        event.reply('save-file-result', { success: false, error: error.message });
    }
});

initUpdater(() => mainWindow);

// Only the instance holding the single-instance lock builds a window. A
// second launch (jump list, "Open with", deep link) hands its argv to the
// running app via 'second-instance' and quits without touching the backend.
if (gotTheLock) {
    app.whenReady()
        .then(() => loginShellPathReady)
        .then(createWindow);
}

// macOS: clicking the Dock icon (or relaunching from Finder) while the app is
// running with its window hidden brings the window back.
app.on('activate', () => {
    showMainWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Squirrel.Mac closes every window *before* emitting 'before-quit' when it
// installs an update, so the macOS hide-on-close behavior has to be lifted here
// or the update would never get to restart the app.
if (process.platform === 'darwin') {
    electron.autoUpdater.on('before-quit-for-update', () => {
        allowWindowClose = true;
    });
}

app.on('before-quit', async () => {
    allowWindowClose = true;
    if (nativeFeatures) {
        try {
            nativeFeatures.dispose();
        } catch (error) {
            console.error('Error cleaning up native features:', error.message);
        }
        nativeFeatures = null;
    }
    if (windowsNativeSpeechService) {
        windowsNativeSpeechService.dispose();
        windowsNativeSpeechService = null;
    }

    if (isAppQuitting) return;
    isAppQuitting = true;

    if (browserHandler) {
        try {
            await browserHandler.cleanup();
        } catch (error) {
            console.error('Error cleaning up BrowserHandler:', error.message);
        }
    }

    if (localCoderHandler) {
        try {
            await localCoderHandler.cleanup();
        } catch (error) {
            console.error('Error cleaning up LocalCoderHandler:', error.message);
        }
    }

    if (linkWebView) {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.removeBrowserView(linkWebView);
            }
            if (linkWebView.webContents && !linkWebView.webContents.isDestroyed()) {
                linkWebView.webContents.destroy();
            }
            linkWebView = null;
        } catch (error) {
            console.error('Error cleaning up linkWebView:', error.message);
        }
    }

    if (appTray) {
        try {
            appTray.destroy();
            appTray = null;
        } catch (error) {
            console.error('Error cleaning up tray:', error.message);
        }
    }

    if (pythonBridge) {
        try {
            pythonBridge.stop();
            pythonBridge = null;
        } catch (error) {
            console.error('Error stopping Python bridge:', error.message);
        }
    }

});
