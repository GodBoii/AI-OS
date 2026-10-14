// Opt-in native regression fixture. It owns every window that may receive input.
// Run: electron js/tests/computer-control-hardening-live.js
const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Handler = require('../computer-control-handler');
const { buildScript } = require('../windows-accessibility');

app.setPath('userData', path.join(app.getPath('temp'), `aetheria-hardening-fixture-${process.pid}`));
app.commandLine.appendSwitch('force-renderer-accessibility');
app.commandLine.appendSwitch('enable-features', 'UiaProvider');
app.on('window-all-closed', () => {}); // Finish assertions and cleanup before exiting.

app.whenReady().then(async () => {
    if (process.platform !== 'win32') throw new Error('This fixture requires Windows');
    app.setAccessibilitySupportEnabled(true);
    const events = new EventEmitter();
    const handler = new Handler(events, app.getPath('userData'), async () => null, { get: () => ({ typingSpeed: 'instant' }) });
    handler.grantManualPermission();
    const fixture = new BrowserWindow({ width: 780, height: 540, title: 'Aetheria hardening regression fixture' });
    let overlay;
    const results = [];
    async function command(payload) {
        const request_id = crypto.randomUUID();
        const resultPromise = new Promise(resolve => events.once('computer-command-result', response => resolve(response.result)));
        await handler.handleCommand({ ...payload, window_id: windowId, request_id });
        const result = await resultPromise;
        results.push({ action: payload.action, status: result.status, verified: result.verified,
            verification: result.verification, outcome: result.outcome, timings_ms: result.timings_ms });
        return result;
    }
    let windowId;
    async function waitForClicks(expected) {
        const deadline = Date.now() + 1500;
        let clicks;
        do {
            clicks = await fixture.webContents.executeJavaScript('window.clicks');
            if (clicks === expected) return;
            await new Promise(resolve => setTimeout(resolve, 25));
        } while (Date.now() < deadline);
        assert.equal(clicks, expected);
    }
    try {
        const buttons = Array.from({ length: 260 }, (_, index) => `<button>${index === 259 ? 'Late target' : `Item ${index}`}</button>`).join('');
        await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
            <html lang="en"><head><meta charset="utf-8"><title>Aetheria hardening regression fixture</title>
            <style>body{margin:8px;font:12px sans-serif}.grid{display:grid;grid-template-columns:repeat(13,1fr);gap:1px}button{height:18px;font-size:10px;padding:0}textarea{width:98%;height:40px}</style></head>
            <body><label>Long field<textarea aria-label="Long field"></textarea></label><p id="count" role="status">Clicks: 0</p>
            <div class="grid">${buttons}</div><script>window.clicks=0;document.querySelector('.grid').addEventListener('click',event=>{
            if(event.target.tagName==='BUTTON')document.getElementById('count').textContent='Clicks: '+(++window.clicks);});</script></body></html>`));
        fixture.show();
        fixture.focus();
        windowId = fixture.getNativeWindowHandle().readUInt32LE(0);
        const initial = await command({ action: 'get_screen_elements' });
        assert.equal(initial.status, 'success');
        assert.equal(initial.truncated, true);
        const field = initial.elements.find(el => el.Name === 'Long field' && el.Patterns.includes('Value'));
        assert.ok(field, 'Expected one editable field');
        const value = "Case-sensitive 😀 नमस्ते 'quoted'\n" + 'x'.repeat(4100);
        const typed = await command({ action: 'perform_element_action', observation_id: initial.observation_id,
            element_id: field.element_id, element_action: 'set_value', value });
        assert.equal(typed.status, 'success', typed.error);
        assert.equal(typed.verification, 'passed');
        assert.equal(await fixture.webContents.executeJavaScript('document.querySelector("textarea").value'), value);
        assert.equal(typed.state.elements.find(el => el.RuntimeId === field.RuntimeId).ValueTruncated, true);

        const mismatch = JSON.parse((await handler._runAccessibilityScript(buildScript({
            windowId, runtimeId: field.RuntimeId, expectedValue: value.replace('Case-sensitive', 'case-sensitive'),
        }))).stdout);
        assert.equal(mismatch.verified, false, 'Full-value verification must be case-sensitive');

        const late = await command({ action: 'get_screen_elements', text: 'Late target', element_type: 'button' });
        assert.equal(late.status, 'success');
        assert.ok(late.visited > 200, `Expected a control beyond the original action cap; visited ${late.visited}`);
        assert.equal(late.elements.length, 1);
        const invoked = await command({ action: 'perform_element_action', observation_id: late.observation_id,
            element_id: late.elements[0].element_id, element_action: 'invoke' });
        assert.equal(invoked.status, 'success', invoked.error);
        assert.equal(await fixture.webContents.executeJavaScript('window.clicks'), 1);

        const fresh = await command({ action: 'get_screen_elements', text: 'Late target', element_type: 'button' });
        const point = { x: fresh.elements[0].X, y: fresh.elements[0].Y };
        const dip = screen.screenToDipPoint(point);
        overlay = new BrowserWindow({ parent: fixture, x: Math.round(dip.x) - 25, y: Math.round(dip.y) - 15, width: 60, height: 35,
            frame: false, alwaysOnTop: true, show: false, skipTaskbar: true });
        await overlay.loadURL('data:text/html,<body style="margin:0;background:red">Overlay</body>');
        overlay.showInactive();
        fixture.focus();
        await new Promise(resolve => setTimeout(resolve, 100));
        const covered = await command({ action: 'click_mouse', ...point });
        assert.equal(covered.status, 'error');
        assert.equal(covered.outcome, 'not_executed');
        assert.equal(await fixture.webContents.executeJavaScript('window.clicks'), 1);
        overlay.destroy();
        overlay = null;

        const bounds = await handler._physicalWindowBounds(await handler._findManagedWindow(windowId));
        const outside = await command({ action: 'click_mouse', x: bounds.x - 10, y: point.y });
        assert.equal(outside.status, 'error');
        assert.equal(outside.outcome, 'not_executed');
        const shot = await command({ action: 'get_window_state' });
        assert.equal(shot.status, 'success', shot.error);
        const target = shot.state.elements.find(el => el.Name === 'Item 0' && el.Patterns.includes('Invoke'));
        const clicked = await command({ action: 'click_mouse', screenshot_id: shot.screenshot_id,
            x: target.X - shot.image_origin.x, y: target.Y - shot.image_origin.y });
        assert.equal(clicked.status, 'success', clicked.error);
        await waitForClicks(2);
        assert.ok(clicked.timings_ms.pointer_target >= 0);
        assert.ok(shot.timings_ms.capture >= 0);
        console.log('Native hardening fixture passed: full Unicode value, exact comparison, late control, overlay rejection, outside rejection and screenshot click.');
    } finally {
        overlay?.destroy();
        fixture.destroy();
        await handler.cleanup();
        await fs.mkdir(path.join(process.cwd(), '.ui-check'), { recursive: true });
        await fs.writeFile(path.join(process.cwd(), '.ui-check', 'computer-hardening-live.json'), JSON.stringify(results, null, 2));
    }
    app.quit();
}).catch(error => { console.error(error); app.exit(1); });
