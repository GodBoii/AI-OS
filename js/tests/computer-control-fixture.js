// A separate disposable app, so the driver exercises cross-process automation.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(app.getPath('temp'), `aetheria-computer-fixture-${process.pid}`));
app.commandLine.appendSwitch('force-renderer-accessibility');
app.commandLine.appendSwitch('enable-features', 'UiaProvider');
let window;
app.whenReady().then(async () => {
    app.setAccessibilitySupportEnabled(true);
    window = new BrowserWindow({ width: 720, height: 560, title: 'Computer control test form' });
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
        <html lang="en"><head><meta charset="utf-8"><title>Computer control test form</title></head>
        <body><h1>Computer control test form</h1>
        <label>Test text <textarea aria-label="Test text" rows="4" cols="50"></textarea></label>
        <label><input type="checkbox">Test option</label>
        <button id="apply">Apply test</button><button disabled>Disabled test</button>
        <p role="status" id="result">Clicks: 0</p>
        <script>let clicks = 0; document.getElementById('apply').onclick = () => {
            document.getElementById('result').textContent = 'Clicks: ' + (++clicks);
        };</script></body></html>`));
    window.show();
    window.focus();
    if (process.send) process.send({ ready: true });
}).catch(error => {
    console.error('Test fixture startup failed:', error);
    app.exit(1);
});
process.on('message', message => {
    if (message.close) {
        window?.destroy();
        app.quit();
    }
});
process.on('disconnect', () => app.quit());
