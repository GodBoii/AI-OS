const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1024, height: 576, show: true, backgroundColor: '#000000' });
    await win.loadFile(path.join(__dirname, 'harness.html'));
    await wait(500);
    await win.webContents.executeJavaScript('window.__arm()');
    await wait(1200);

    const probe = async (label, script) => {
        try {
            const value = await win.webContents.executeJavaScript(script);
            console.log(label, value);
        } catch (error) {
            console.log(label, 'FAILED', String(error));
        }
    };

    await probe('STACK_AT_CENTRE', `
        (() => {
            const el = document.getElementById('floating-input-container');
            const b = el.getBoundingClientRect();
            const nodes = document.elementsFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return nodes.map((n) => {
                const s = getComputedStyle(n);
                return n.tagName + '.' + (n.className || '(none)')
                    + ' bg=' + s.backgroundColor
                    + ' op=' + s.opacity;
            }).join(' | ');
        })()
    `);

    await probe('PSEUDO_AFTER', `
        (() => {
            const el = document.getElementById('floating-input-container');
            const p = getComputedStyle(el, '::after');
            return [p.content, p.backgroundColor, p.opacity, p.width, p.height, p.boxShadow, p.animationName].join(' ~ ');
        })()
    `);

    // Drop the plan-mode class but keep the shader running: isolates my CSS
    // from the canvas paint.
    await win.webContents.executeJavaScript(
        "document.getElementById('floating-input-container').classList.remove('plan-mode-active');"
    );
    await wait(400);
    fs.writeFileSync(
        path.join(__dirname, 'diag-no-planclass.png'),
        (await win.capturePage()).toPNG()
    );

    // Now also hide the canvas entirely.
    await win.webContents.executeJavaScript(
        "document.querySelector('.composer-metal-canvas').style.display = 'none';"
    );
    await wait(400);
    fs.writeFileSync(
        path.join(__dirname, 'diag-no-canvas.png'),
        (await win.capturePage()).toPNG()
    );

    console.log('DIAG_DONE');
    app.quit();
}).catch((error) => {
    console.error('DIAG_ERROR', error);
    app.exit(1);
});
