// updater.js - in-app update download and install.
//
// The renderer talks to this over exactly two channels:
//   invoke('updater-action', { action })  version | check | download | install
//   on('updater-event', { type, ... })    available | not-available | progress | downloaded | error
//
// The update feed comes from the `publish` block in package.json, which
// electron-builder writes to resources/app-update.yml at package time. Nothing
// here can work in an unpackaged run, hence the isPackaged guard.

const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

let downloadedVersion = null;
let lastSentPercent = -1;

function initUpdater(getWindow) {
    // Downloading is an explicit user action, so the check must not start one.
    autoUpdater.autoDownload = false;

    const emit = (type, payload = {}) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('updater-event', { type, ...payload });
        }
    };

    autoUpdater.on('update-available', (info) => emit('available', {
        version: info.version,
        // GitHub releases arrive as pre-rendered HTML; anything else is dropped
        // rather than shown raw.
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    }));
    autoUpdater.on('update-not-available', () => emit('not-available'));

    // This fires per chunk. Collapsing it to whole percents keeps a 145 MB
    // download from pushing thousands of IPC messages at the renderer.
    autoUpdater.on('download-progress', ({ percent }) => {
        const whole = Math.round(percent || 0);
        if (whole === lastSentPercent) return;
        lastSentPercent = whole;
        emit('progress', { percent: whole });
    });

    autoUpdater.on('update-downloaded', (info) => {
        downloadedVersion = info.version;
        emit('downloaded', { version: info.version });
    });
    autoUpdater.on('error', (error) => emit('error', { error: error?.message || String(error) }));

    ipcMain.handle('updater-action', async (event, payload = {}) => {
        if (event.sender !== getWindow()?.webContents) return { ok: false, code: 'denied' };

        // Answered in dev too, so the settings panel can show the real version.
        // downloadedVersion lets a reloaded renderer recover the ready-to-install
        // state instead of offering the same download again.
        if (payload.action === 'version') {
            return { ok: true, version: app.getVersion(), downloadedVersion };
        }
        if (!app.isPackaged) return { ok: false, code: 'unsupported' };

        try {
            switch (payload.action) {
                case 'check':
                    await autoUpdater.checkForUpdates();
                    return { ok: true };
                case 'download':
                    lastSentPercent = -1;
                    await autoUpdater.downloadUpdate();
                    return { ok: true };
                case 'install':
                    if (!downloadedVersion) return { ok: false, code: 'not-downloaded' };
                    // Let this call return before the app tears itself down.
                    setImmediate(() => autoUpdater.quitAndInstall(true, true));
                    return { ok: true };
                default:
                    return { ok: false, code: 'unknown-action' };
            }
        } catch (error) {
            return { ok: false, code: 'failed', error: error?.message || String(error) };
        }
    });
}

module.exports = { initUpdater };
