// Real production preload and login page with an empty, isolated auth store.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(app.getPath('temp'), `aetheria-auth-preload-${process.pid}`));
const authStorage = new Map();
ipcMain.handle('secure-store', (_event, payload) => {
    if (payload.op === 'set') authStorage.set(payload.key, payload.value);
    if (payload.op === 'remove') authStorage.delete(payload.key);
    return { available: true, value: authStorage.get(payload.key) || null };
});
app.whenReady().then(() => {
    const window = new BrowserWindow({ show: false, width: 1280, height: 800,
        webPreferences: { preload: path.resolve(__dirname, '../../preload.js'),
            contextIsolation: true, nodeIntegration: true, sandbox: false } });
    window.loadFile(path.resolve(__dirname, '../../../index.html'));
});
app.on('window-all-closed', () => app.quit());
