const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1024,
        height: 576,
        show: false,
        backgroundColor: '#000000',
        webPreferences: { offscreen: false },
    });

    await win.loadFile(path.join(__dirname, 'harness.html'));
    await wait(600);

    const before = await win.webContents.executeJavaScript('window.__report()');
    console.log('BEFORE_ARM', JSON.stringify(before, null, 2));

    await win.webContents.executeJavaScript('window.__arm()');
    await wait(1500);

    const after = await win.webContents.executeJavaScript('window.__report()');
    console.log('AFTER_ARM', JSON.stringify(after, null, 2));

    const image = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, 'armed.png'), image.toPNG());
    console.log('SCREENSHOT_WRITTEN');

    app.quit();
}).catch((error) => {
    console.error('HARNESS_ERROR', error);
    app.exit(1);
});
