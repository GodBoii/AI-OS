const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shot = async (win, name) => {
    const image = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, `${name}.png`), image.toPNG());
};

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 900,
        height: 620,
        show: false,
        backgroundColor: '#0b1220',
        webPreferences: { contextIsolation: true }
    });

    win.webContents.on('console-message', (_e, _level, message) => {
        console.log('PAGE:', message);
    });

    await win.loadFile(path.join(__dirname, 'harness.html'));
    await wait(400);

    // Light theme, mid-entrance so the stagger is visible.
    await win.webContents.executeJavaScript('window.__fill()');
    await wait(160);
    await shot(win, 'light-entering');

    await wait(900);
    await shot(win, 'light-settled');
    console.log('LIGHT_REPORT', JSON.stringify(await win.webContents.executeJavaScript('window.__report()'), null, 2));

    console.log('HOVER', JSON.stringify(await win.webContents.executeJavaScript('window.__hover()')));

    console.log('DISMISS_TOPS', JSON.stringify(await win.webContents.executeJavaScript('window.__dismissFirst()')));
    await wait(140);
    await shot(win, 'light-exiting');
    await wait(700);
    await shot(win, 'light-collapsed');
    console.log('AFTER_DISMISS', JSON.stringify(await win.webContents.executeJavaScript('window.__report()'), null, 2));

    // Dark theme.
    await win.webContents.executeJavaScript('window.notificationService.clear()');
    await wait(700);
    await win.webContents.executeJavaScript('window.__theme("dark")');
    await win.webContents.executeJavaScript('window.__fill()');
    await wait(1000);
    await shot(win, 'dark-settled');
    console.log('DARK_REPORT', JSON.stringify(await win.webContents.executeJavaScript('window.__report()'), null, 2));

    console.log('DONE');
    app.quit();
}).catch((error) => {
    console.error('HARNESS_ERROR', error);
    app.exit(1);
});
