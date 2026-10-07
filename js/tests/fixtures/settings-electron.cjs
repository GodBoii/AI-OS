const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
    const window = new BrowserWindow({ show: false, width: 1280, height: 800 });
    window.webContents.on('did-finish-load', () => window.webContents.focus());
    window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
