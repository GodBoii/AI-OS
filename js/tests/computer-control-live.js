// Opt-in local smoke test. Run with Electron, never as part of npm test.
// All input is restricted to an exactly named test window.
const { app } = require('electron');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const Handler = require('../computer-control-handler');
const { TYPING_SPEEDS } = require('../typing-input');
app.commandLine.appendSwitch('force-renderer-accessibility');
app.commandLine.appendSwitch('enable-features', 'UiaProvider');

app.whenReady().then(async () => {
    const plan = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    if (!['Calculator', 'Computer control test form'].includes(plan.title)) {
        throw new Error('Only Calculator or the dedicated test form may receive input');
    }
    await fs.mkdir(path.dirname(plan.output), { recursive: true });
    const events = new EventEmitter();
    let fixture;
    if (plan.title === 'Computer control test form' && !plan.reuse_fixture) {
        fixture = spawn(process.execPath, [path.join(__dirname, 'computer-control-fixture.js')], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                fixture.kill();
                reject(new Error('Test fixture did not start'));
            }, 15000);
            fixture.once('message', message => { clearTimeout(timer); message.ready ? resolve() : reject(new Error('Invalid fixture response')); });
            fixture.once('error', error => { clearTimeout(timer); reject(error); });
            fixture.once('exit', code => { clearTimeout(timer); reject(new Error(`Test fixture exited: ${code}`)); });
        });
    }
    const typingSpeed = process.argv[3] || plan.typing_speed || 'instant';
    if (!TYPING_SPEEDS.includes(typingSpeed)) throw new Error('Invalid test typing speed');
    const handler = new Handler(events, app.getPath('temp'), async () => null, { get: () => ({ typingSpeed }) });
    handler.grantManualPermission();
    let windows = (await handler._getManagedWindows()).filter(w => w.getTitle() === plan.title);
    if (plan.title === 'Calculator' && windows.length === 0) {
        const launched = await handler._openApplication({ app_name: 'Calculator' });
        if (launched.status !== 'success') throw new Error(launched.error);
        const deadline = Date.now() + 10000;
        do {
            windows = (await handler._getManagedWindows()).filter(w => w.getTitle() === plan.title);
            if (windows.length === 1) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
    }
    if (windows.length !== 1) throw new Error(`Expected one test window, found ${windows.length}`);
    const windowId = windows[0].id;
    const results = [];
    let latestState;
    let latestScreenshot;
    for (const command of plan.commands) {
        const payload = { ...command };
        if (payload.element_name) {
            const pattern = { invoke: 'Invoke', set_value: 'Value', toggle: 'Toggle' }[payload.element_action];
            const matches = latestState?.elements?.filter(el => el.Name === payload.element_name && el.IsEnabled && (!pattern || el.Patterns.includes(pattern)));
            if (matches?.length !== 1) {
                await fs.writeFile(plan.output, JSON.stringify(results, null, 2));
                throw new Error(`Expected one observed control: ${payload.element_name}`);
            }
            const el = matches[0];
            delete payload.element_name;
            if (payload.action === 'perform_element_action') {
                payload.element_id = el.element_id;
                payload.observation_id = latestState.observation_id;
            } else if (payload.action === 'click_mouse') {
                payload.x = el.X;
                payload.y = el.Y;
                if (latestScreenshot) {
                    payload.x -= latestScreenshot.image_origin.x;
                    payload.y -= latestScreenshot.image_origin.y;
                    payload.screenshot_id = latestScreenshot.screenshot_id;
                }
            }
        }
        const requestId = require('node:crypto').randomUUID();
        const started = performance.now();
        const response = new Promise(resolve => events.once('computer-command-result', resolve));
        await handler.handleCommand({ ...payload, window_id: windowId, window_title: plan.title, request_id: requestId });
        const { result } = await response;
        if (result.state) latestState = result.state;
        else if (result.elements) latestState = result;
        if (result.screenshot_id) latestScreenshot = result;
        else if (['click_mouse', 'type_text', 'press_hotkey', 'perform_element_action'].includes(payload.action)) latestScreenshot = null;
        if (result.status === 'success' && command.expect_text) {
            const names = latestState?.elements?.map(el => el.Name) || [];
            result.verified = names.some(name => name.includes(command.expect_text));
            if (!result.verified) {
                result.status = 'error';
                result.error = `Expected visible text: ${command.expect_text}`;
            }
        }
        if (result.status === 'success' && command.expect_value !== undefined) {
            result.verified = latestState?.elements?.some(el => el.Name === 'Test text' && el.Value === command.expect_value);
            if (!result.verified) {
                result.status = 'error';
                result.error = 'Expected field value did not match';
            }
        }
        if (result.status === 'success' && command.expect_toggle) {
            result.verified = latestState?.elements?.some(el => el.Name === 'Test option' && el.ToggleState === command.expect_toggle);
            if (!result.verified) {
                result.status = 'error';
                result.error = 'Expected checkbox state did not match';
            }
        }
        if (result.status === 'success' && command.expect_ocr) {
            result.verified = result.text?.includes(command.expect_ocr) === true;
            if (!result.verified) {
                result.status = 'error';
                result.error = 'Expected text was absent from OCR output';
            }
        }
        if (result.screenshot_base64) {
            const imagePath = path.join(path.dirname(plan.output), `computer-live-${results.length}.png`);
            await fs.writeFile(imagePath, Buffer.from(result.screenshot_base64, 'base64'));
            delete result.screenshot_base64;
            result.evidence_image = imagePath;
        }
        results.push({ action: command.action, elapsed_ms: Math.round(performance.now() - started), result });
        if (result.status === 'error') break;
    }
    await fs.writeFile(plan.output, JSON.stringify(results, null, 2));
    if (Number.isInteger(plan.keep_open_ms) && plan.keep_open_ms > 0 && plan.keep_open_ms <= 60000) {
        await new Promise(resolve => setTimeout(resolve, plan.keep_open_ms));
    }
    await handler.cleanup();
    if (fixture?.connected) fixture.send({ close: true });
    if (results.some(item => item.result.status === 'error')) app.exit(1);
    else app.quit();
}).catch(error => {
    console.error(error);
    app.exit(1);
});
