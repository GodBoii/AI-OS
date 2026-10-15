const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(app.getPath('temp'), `aetheria-drag-fixture-${process.pid}`));
app.commandLine.appendSwitch('force-renderer-accessibility');
app.commandLine.appendSwitch('enable-features', 'UiaProvider');
let source, destination;
app.whenReady().then(async () => {
    app.setAccessibilitySupportEnabled(true);
    source = new BrowserWindow({ x: 20, y: 20, width: 300, height: 220, show: false });
    destination = new BrowserWindow({ x: 700, y: 20, width: 300, height: 220, show: false });
    await source.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html lang="en"><title>Disposable drag source</title><body>
        <div draggable="true" role="button" tabindex="0" aria-label="Drag source" style="height:120px;background:lightblue">Drag source</div>
        <script>document.querySelector('div').ondragstart=event=>event.dataTransfer.setData('text/plain','fixture-drag');</script></body></html>`));
    await destination.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html lang="en"><title>Disposable drop target</title><body>
        <div role="button" aria-label="Drop target" style="height:120px;background:lightblue">Drop target</div>
        <script>window.drops=0;document.body.ondragover=event=>event.preventDefault();document.body.ondrop=event=>{
        event.preventDefault();if(event.dataTransfer.getData('text/plain')==='fixture-drag')window.drops++;};</script></body></html>`));
    destination.showInactive(); source.show(); source.focus();
    process.send({ ready: true, source: source.getNativeWindowHandle().readUInt32LE(0),
        destination: destination.getNativeWindowHandle().readUInt32LE(0) });
}).catch(error => { console.error(error); app.exit(1); });
process.on('message', async message => {
    if (message.op === 'drops') process.send({ id: message.id, drops: await destination.webContents.executeJavaScript('window.drops') });
    if (message.op === 'close') { source?.destroy(); destination?.destroy(); app.quit(); }
});
process.on('disconnect', () => app.quit());
