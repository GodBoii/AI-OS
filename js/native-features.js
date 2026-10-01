// native-features.js - wires the OS-native features into the main process.
//
// main.js calls installNativeFeatures() once, right after the main window is
// created. Each feature lives in its own module; this file only connects them
// to the window, the Python bridge, IPC and Electron's OS events:
//
//   desktop-integration.js  taskbar progress, badge, flash/bounce, thumbnail
//                           buttons, power-save blocker, jump list / Dock menu
//   quick-prompt-window.js  global hotkey prompt box
//   system-appearance.js    OS theme / accent / Mica & vibrancy
//   secure-store.js         OS-vault storage for the auth session
//   file-open.js            "Open with" and files dropped on the app icon
//   run-notification.js     Open chat / Reply buttons on "task finished"
//
// Settings arrive from the renderer (Settings window) over the same
// fire-and-forget channels the existing General settings use.

const path = require('path');
const { AgentActivityTracker } = require('./agent-activity');
const { DesktopIntegration } = require('./desktop-integration');
const { QuickPromptWindow } = require('./quick-prompt-window');
const { SystemAppearance } = require('./system-appearance');
const { SecureStore } = require('./secure-store');
const { readFilesForRenderer } = require('./file-open');
const { buildRunCompletedOptions } = require('./run-notification');

const RESUME_RECONNECT_DELAY_MS = 2000;

function installNativeFeatures({
    electron,
    getWindow,
    getPythonBridge,
    getComputerHandler,
    emitter,
    sendToRenderer,
    showMainWindow,
    getAuthToken,
    appRoot,
    logger = console,
}) {
    const { app, ipcMain, nativeImage, powerSaveBlocker, powerMonitor, Menu, BrowserWindow, globalShortcut, screen, nativeTheme, systemPreferences, safeStorage } = electron;
    const platform = process.platform;
    const fsPromises = require('fs').promises;

    const isMainSender = (event) => {
        const win = getWindow();
        return Boolean(win && !win.isDestroyed() && event.sender === win.webContents);
    };

    // --- secure auth storage ------------------------------------------------

    const secureStore = new SecureStore({ safeStorage, fsPromises, directory: app.getPath('userData'), logger });
    ipcMain.handle('secure-store', async (event, payload) => {
        // Anything unexpected falls back to localStorage in the renderer,
        // which is the pre-existing behavior.
        if (!isMainSender(event)) return { available: false };
        const { op, key, value } = payload || {};
        if (!SecureStore.isValidKey(key) || !secureStore.isAvailable()) return { available: false };
        try {
            if (op === 'get') return { available: true, value: await secureStore.get(key) };
            if (op === 'set') {
                await secureStore.set(key, value);
                return { available: true, ok: true };
            }
            if (op === 'remove') {
                await secureStore.remove(key);
                return { available: true, ok: true };
            }
            return { available: false };
        } catch (error) {
            logger.warn(`[NativeFeatures] secure-store ${op} failed:`, error.message);
            return { available: false };
        }
    });

    // --- agent activity -> taskbar / Dock -----------------------------------

    const tracker = new AgentActivityTracker();
    const runControl = (type) => sendRunControl(type);
    const desktop = new DesktopIntegration({
        app,
        nativeImage,
        powerSaveBlocker,
        Menu,
        platform,
        getWindow,
        logger,
        onAction: (action) => {
            if (action === 'stop-runs') runControl('stop_run');
            else if (action === 'pause-runs') runControl('pause_run');
            else if (action === 'resume-runs') runControl('resume_run');
            else handleLaunchAction(action);
        },
    });

    tracker.on('change', (snapshot) => desktop.onActivityChange(snapshot));
    emitter.on('agent-run-started', (run) => tracker.runStarted(run));
    emitter.on('agent-run-ended', (run) => tracker.runFinished(run));
    emitter.on('run-completed', (data) => tracker.runFinished({
        messageId: data?.messageId ? String(data.messageId) : null,
        conversationId: data?.conversationId,
    }));
    emitter.on('agent-runs-aborted', () => tracker.clearAll('aborted'));
    emitter.on('agent-run-control', (data) => {
        if (data?.event === 'run_paused') tracker.setPaused(true);
        else if (data?.event === 'run_resumed') tracker.setPaused(false);
    });

    async function sendRunControl(type) {
        const bridge = getPythonBridge();
        const conversationIds = tracker.activeConversationIds();
        if (!bridge || !conversationIds.length) return;
        const accessToken = await getAuthToken();
        if (!accessToken) {
            logger.warn('[NativeFeatures] Cannot send run control without a session.');
            return;
        }
        for (const conversationId of conversationIds) {
            bridge.sendMessage({ type, conversationId, accessToken, message: type });
        }
        // Show the new state right away; the backend confirms when it reaches
        // its next checkpoint (run_paused / run_resumed / response done).
        if (type === 'pause_run') tracker.setPaused(true);
        if (type === 'resume_run') tracker.setPaused(false);
        sendToRenderer('agent-run-control', { event: `${type}_requested`, conversationIds });
    }

    const win = getWindow();
    win.on('focus', () => desktop.clearAttention());
    win.on('show', () => {
        if (win.isFocused()) desktop.clearAttention();
    });

    function isBackgrounded() {
        const current = getWindow();
        if (!current || current.isDestroyed()) return true;
        return !current.isFocused() || current.isMinimized() || !current.isVisible();
    }

    // --- launch actions (jump list, Dock menu, Linux desktop actions) -------

    function handleLaunchAction(action) {
        if (action === 'quick-prompt') {
            quickPrompt.show();
            return;
        }
        showMainWindow();
        sendToRenderer('app-action', { action });
    }

    desktop.installLaunchActions({
        execPath: process.execPath,
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
    });

    // --- quick prompt hotkey --------------------------------------------------

    const quickPrompt = new QuickPromptWindow({
        BrowserWindow,
        globalShortcut,
        screen,
        ipcMain,
        preloadPath: path.join(__dirname, 'quick-prompt-preload.js'),
        htmlPath: path.join(appRoot, 'quick-prompt.html'),
        logger,
        onSubmit: (text) => {
            showMainWindow();
            sendToRenderer('app-action', { action: 'send-prompt', text, newConversation: true });
        },
    });

    // --- power and lock events ------------------------------------------------

    const lockState = { pauseOnLock: true, screenLocked: false, suspended: false };
    const applyLockState = () => {
        const handler = getComputerHandler();
        if (!handler) return;
        handler.setSystemLocked(lockState.pauseOnLock && (lockState.screenLocked || lockState.suspended));
    };
    powerMonitor.on('lock-screen', () => { lockState.screenLocked = true; applyLockState(); });
    powerMonitor.on('unlock-screen', () => { lockState.screenLocked = false; applyLockState(); });
    powerMonitor.on('suspend', () => { lockState.suspended = true; applyLockState(); });
    powerMonitor.on('resume', () => {
        lockState.suspended = false;
        applyLockState();
        // Give the network a moment to come back before reconnecting.
        setTimeout(() => {
            const bridge = getPythonBridge();
            if (bridge && typeof bridge.reviveAfterResume === 'function') {
                logger.log('[NativeFeatures] Resumed from sleep; backend connection:', bridge.reviveAfterResume());
            }
        }, RESUME_RECONNECT_DELAY_MS);
    });

    // --- system appearance ------------------------------------------------------

    const appearance = new SystemAppearance({ nativeTheme, systemPreferences, platform, logger });
    appearance.watch((state) => sendToRenderer('system-appearance', state));
    ipcMain.handle('system-appearance:get', (event) => (isMainSender(event) ? appearance.getState() : null));

    // --- settings from the renderer -------------------------------------------

    // Values are plain booleans, or { enabled, userInitiated } when the
    // renderer wants failures reported (only the hotkey does).
    const onSetting = (channel, apply) => {
        ipcMain.on(channel, (event, value) => {
            if (!isMainSender(event)) return;
            const isObject = value !== null && typeof value === 'object';
            apply(Boolean(isObject ? value.enabled : value), { userInitiated: Boolean(isObject && value.userInitiated) });
        });
    };
    onSetting('set-taskbar-activity', (enabled) => desktop.setSettings({ taskbarActivity: enabled }));
    onSetting('set-keep-awake-during-runs', (enabled) => desktop.setSettings({ keepAwake: enabled }));
    onSetting('set-pause-agent-on-lock', (enabled) => {
        lockState.pauseOnLock = enabled;
        applyLockState();
    });
    onSetting('set-quick-prompt-hotkey', (enabled, { userInitiated }) => {
        const result = quickPrompt.setHotkeyEnabled(enabled);
        if (!result.ok) logger.warn('[NativeFeatures] Quick prompt shortcut not registered:', result.error);
        sendToRenderer('setting-changed', { key: 'quickPromptHotkey', userInitiated, ...result });
    });
    onSetting('set-native-window-material', (enabled) => {
        const state = appearance.setMaterial(getWindow(), enabled);
        sendToRenderer('system-appearance', state);
    });

    // --- files opened with the app ----------------------------------------------

    async function openFiles(filePaths) {
        if (!filePaths.length) return;
        showMainWindow();
        const { files, skipped } = await readFilesForRenderer(filePaths, { fsPromises });
        sendToRenderer('open-files', {
            files: files.map(({ name, type, size, data }) => ({ name, type, size, data })),
            skipped,
        });
    }

    // --- notifications ------------------------------------------------------------

    function runCompletedNotificationOptions({ conversationId, title, body }) {
        return buildRunCompletedOptions({
            platform,
            isPackaged: app.isPackaged,
            conversationId,
            title,
            body,
            dispatch: (message) => {
                showMainWindow();
                sendToRenderer('app-action', message);
            },
        });
    }

    function onRunCompleted() {
        desktop.notifyRunFinished({ backgrounded: isBackgrounded() });
    }

    // --- recent documents -----------------------------------------------------------

    function addRecentDocument(filePath) {
        if (platform !== 'win32' && platform !== 'darwin') return;
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return;
        try {
            app.addRecentDocument(filePath);
        } catch (error) {
            logger.warn('[NativeFeatures] Could not add recent document:', error.message);
        }
    }

    function dispose() {
        quickPrompt.dispose();
        desktop.dispose();
        tracker.dispose();
    }

    return {
        handleLaunchAction,
        openFiles,
        runCompletedNotificationOptions,
        onRunCompleted,
        addRecentDocument,
        isBackgrounded,
        setDefaultOverlay: (image, description) => desktop.setDefaultOverlay(image, description),
        dispose,
    };
}

module.exports = { installNativeFeatures };
