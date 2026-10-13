const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false,
    } });
    try {
        const { conversationPdfPrintOptions } = await import('../../conversation-pdf.mjs');
        const html = await fs.readFile(path.resolve(process.argv[2]), 'utf8');
        await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
        const pdf = await window.webContents.printToPDF(conversationPdfPrintOptions);
        await fs.writeFile(path.resolve(process.argv[3]), pdf);
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        window.destroy();
        app.exit(process.exitCode || 0);
    }
});
