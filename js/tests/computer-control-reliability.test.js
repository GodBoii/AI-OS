const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Handler = require('../computer-control-handler');
const { buildScript } = require('../windows-accessibility');

function handler() {
    const result = new Handler(new EventEmitter(), process.cwd(), async () => null);
    result.platform = 'win32';
    result.isEnabled = true;
    result._buildToolResultMetadata = async () => null;
    return result;
}

function fakeInput(h, overrides = {}) {
    const calls = [];
    const record = name => async (...args) => { calls.push([name, ...args]); };
    h._nut = () => ({
        Point: class { constructor(x, y) { this.x = x; this.y = y; } },
        Button: { LEFT: 1, RIGHT: 2, MIDDLE: 3 },
        Key: { Escape: 0, LeftControl: 1, A: 2, Num0: 3, NumPad0: 4, Enter: 5 },
        mouse: { setPosition: record('position'), pressButton: record('press'), releaseButton: record('release'),
            scrollLeft: record('scrollLeft'), ...overrides.mouse },
        keyboard: { type: record('type'), pressKey: record('keyDown'), releaseKey: record('keyUp'), ...overrides.keyboard },
    });
    return calls;
}

test('click reaches the exact pixel with no jitter', async () => {
    const h = handler();
    const calls = fakeInput(h);
    await h._clickMouse({ x: -200, y: 100 });
    assert.deepEqual({ ...calls[0][1] }, { x: -200, y: 100 });
    assert.deepEqual(calls.slice(1), [['press', 1], ['release', 1]]);
    await assert.rejects(h._clickMouse({ x: 1 }), /both/);
    await assert.rejects(h._clickMouse({ x: NaN, y: 2 }), /integer/);
    await assert.rejects(h._clickMouse({ button: 'invalid' }), /button/);
});

test('instant typing pastes one complete Unicode string and reports no text in the result', async () => {
    const h = handler();
    const calls = fakeInput(h);
    h._pasteText = async text => { calls.push(['paste', text]); };
    const text = 'Hello 😀 नमस्ते\nsecond line';
    const result = await h._typeText({ text });
    assert.deepEqual(calls, [['paste', text]]);
    assert.equal(result.characters, [...text].length);
    assert.ok(!JSON.stringify(result).includes(text));
});

test('hotkeys map number-row and keypad keys and release even after partial failure', async () => {
    const h = handler();
    let calls = fakeInput(h);
    await h._pressHotkey({ keys: ['escape', '0', 'KP_0'] });
    assert.deepEqual(calls, [['keyDown', 0, 3, 4], ['keyUp', 4, 3, 0]]);
    calls = fakeInput(h, { keyboard: { pressKey: async () => { throw new Error('native input failed'); } } });
    await assert.rejects(h._pressHotkey({ keys: ['ctrl', 'a'] }), /native input failed/);
    assert.deepEqual(calls, [['keyUp', 2, 1]]);
    calls.length = 0;
    await assert.rejects(h._pressHotkey({ keys: ['ctrl', 'unknown key'] }), /Unknown key/);
    assert.deepEqual(calls, []);
});

test('paced typing preserves line breaks through paste and stops when locked', async () => {
    const h = handler();
    const calls = [];
    h._pasteText = async text => calls.push(['paste', text]);
    await h._typeCharacter('\n');
    assert.deepEqual(calls, [['paste', '\n']]);
    h.setSystemLocked(true);
    await assert.rejects(h._typeCharacter('a'), /unavailable/);
    assert.equal(calls.length, 1);
});

test('drag releases its button after a movement failure', async () => {
    const h = handler();
    let moves = 0;
    const calls = fakeInput(h, { mouse: { setPosition: async () => { if (++moves > 1) throw new Error('move failed'); } } });
    await assert.rejects(h._dragDrop({ from_x: 10, from_y: 10, to_x: 20, to_y: 20 }), /move failed/);
    assert.deepEqual(calls, [['press', 1], ['release', 1]]);
});

test('horizontal scrolling targets a pane and validates its amount', async () => {
    const h = handler();
    const calls = fakeInput(h);
    await h._scroll({ direction: 'left', amount: 7, x: 30, y: 40 });
    assert.equal(calls[1][0], 'scrollLeft');
    assert.equal(calls[1][1], 7);
    await assert.rejects(h._scroll({ direction: 'sideways' }), /direction/);
    await assert.rejects(h._scroll({ direction: 'left', amount: 2.5 }), /amount/);
});

test('a missing or ambiguous window never falls back to the desktop', async () => {
    const h = handler();
    h._getManagedWindows = () => [{ id: 1, getTitle: () => 'Same' }, { id: 2, getTitle: () => 'Same' }];
    await assert.rejects(h._resolveObservationWindow({ window_title: 'Missing' }), /found 0/);
    await assert.rejects(h._resolveObservationWindow({ window_title: 'Same' }), /found 2/);
    await assert.rejects(h._resolveObservationWindow({ window_id: 999 }), /not found/);
});

test('focus preserves unique partial-title matching and rejects ambiguous titles', async () => {
    const h = handler();
    h._getManagedWindows = () => [{ id: 1, getTitle: () => 'One - Notepad' }, { id: 2, getTitle: () => 'Two - Notepad' }];
    h._prepareInputWindow = async id => { assert.equal(id, 1); };
    assert.equal((await h._focusWindow({ title: 'One' })).status, 'success');
    assert.match((await h._focusWindow({ title: 'Notepad' })).error, /found 2/);
});

test('ambiguous text search does not recommend the first match', async () => {
    const h = handler();
    h._getScreenElements = async () => ({ status: 'success', elements: [
        { Name: 'Save', X: 1, Y: 2, IsEnabled: true }, { Name: 'Save', X: 3, Y: 4, IsEnabled: true },
    ] });
    const result = await h._findElementByText({ text: 'Save' });
    assert.equal(result.ambiguous, true);
    assert.equal(result.recommended_click, null);
});

test('stale accessibility references fail before sending input', async () => {
    const h = handler();
    h._prepareInputWindow = async () => { throw new Error('should not send input'); };
    h._observations.set('old', { created: Date.now() - 31000, windowId: 1, elements: [] });
    assert.match((await h._performElementAction({ observation_id: 'old' })).error, /expired/);
    h._observations.set('other', { created: Date.now(), windowId: 1, elements: [] });
    assert.match((await h._performElementAction({ observation_id: 'other', window_id: 2 })).error, /different window/);
});

test('commands are serialized and duplicate request IDs execute only once', async () => {
    const h = handler();
    const order = [];
    h._executeCommand = async payload => {
        order.push(`start ${payload.request_id}`);
        await new Promise(resolve => setTimeout(resolve, 5));
        order.push(`end ${payload.request_id}`);
        h._emitResult(payload.request_id, { status: 'success' });
    };
    await Promise.all([
        h.handleCommand({ action: 'type_text', request_id: 'one' }),
        h.handleCommand({ action: 'type_text', request_id: 'two' }),
        h.handleCommand({ action: 'type_text', request_id: 'one' }),
    ]);
    await h.handleCommand({ action: 'type_text', request_id: 'one' });
    assert.deepEqual(order, ['start one', 'end one', 'start two', 'end two']);
});

test('locked computers block observation and accessibility input as well as raw input', () => {
    const h = handler();
    h.setSystemLocked(true);
    for (const action of ['click_mouse', 'get_window_state', 'get_screen_elements', 'find_element_by_text', 'perform_element_action']) {
        assert.match(h._getPlatformBlocker(action), /locked/);
    }
});

test('expired queued commands are rejected before any input', async () => {
    const h = handler();
    h._typeText = async () => { throw new Error('Input must not run'); };
    let result;
    h.eventEmitter.once('computer-command-result', response => { result = response.result; });
    await h.handleCommand({ action: 'type_text', text: 'test', request_id: 'expired', expires_at_ms: Date.now() - 1 });
    assert.equal(result.outcome, 'not_executed');
});

test('duplicate-result cache bounds memory and does not count replayed entries twice', () => {
    const h = handler();
    const output = { status: 'success', text: 'a'.repeat(1024 * 1024) };
    for (let index = 0; index < 20; index++) h._emitResult(String(index), output);
    assert.ok(h._completedResultBytes <= 16 * 1024 * 1024);
    const previous = h._completedResultBytes;
    h._emitResult('19', output);
    assert.equal(h._completedResultBytes, previous);
});

test('screenshot coordinates map negative monitor origins and reject movement or expiration', async () => {
    const h = handler();
    const bounds = { x: -1920, y: 0, width: 500, height: 400 };
    h._findManagedWindow = async () => ({ id: 9 });
    h._physicalWindowBounds = async () => bounds;
    h._screenshots.set('shot', { created: Date.now(), windowId: 9, windowBounds: { ...bounds }, origin: { x: -1920, y: 0 }, width: 500, height: 400 });
    assert.equal((await h._mapScreenshotInput({ screenshot_id: 'shot', window_id: 9, x: 250, y: 200 })).x, -1670);
    await assert.rejects(h._mapScreenshotInput({ screenshot_id: 'shot', window_id: 9, x: 500, y: 0 }), /outside/);
    bounds.x = -1800;
    await assert.rejects(h._mapScreenshotInput({ screenshot_id: 'shot', window_id: 9, x: 1, y: 1 }), /moved/);
    h._screenshots.get('shot').created -= 31000;
    await assert.rejects(h._mapScreenshotInput({ screenshot_id: 'shot', window_id: 9, x: 1, y: 1 }), /expired/);
});

test('UIA script validates identifiers and limits traversal inside one HWND', () => {
    assert.throws(() => buildScript({ windowId: 1.2 }), /window ID/);
    assert.throws(() => buildScript({ windowId: 1, limit: 0 }), /limit/);
    assert.throws(() => buildScript({ windowId: 1, action: 'invoke', runtimeId: "1'; exit" }), /runtime ID/);
    const script = buildScript({ windowId: 42, text: "It's Save", elementType: 'button' });
    assert.match(script, /It''s Save/);
    assert.match(script, /\$maxNodes = 2000/);
    assert.doesNotMatch(script, /RootElement|FindAll/);
});

test('a screenshot failure preserves usable accessibility state', async () => {
    const h = handler();
    h._resolveObservationWindow = async () => ({ id: 9, getTitle: () => 'Test' });
    h._getScreenElements = async () => ({ status: 'success', elements: [{ Name: 'Apply' }] });
    h._takeScreenshot = async () => { throw new Error('Window is not visible'); };
    const result = await h._getWindowState({ window_id: 9 });
    assert.equal(result.status, 'success');
    assert.equal(result.screenshot_available, false);
    assert.equal(result.state.elements[0].Name, 'Apply');
});

test('local OCR returns confidence and screen coordinates without uploading an image', async () => {
    const h = handler();
    h._captureScreen = async () => ({ image: { toPNG: () => Buffer.from('test') }, origin: { x: -100, y: 30 }, coordinateSpace: 'screen_physical', windowId: 9 });
    h._saveComputerOutputBuffer = async () => ({ relativePath: 'test/ocr.png' });
    h._uploadScreenshot = async () => { throw new Error('OCR must not upload'); };
    h._ocrWorkerPromise = Promise.resolve({
        setParameters: async () => {},
        recognize: async () => ({ data: { text: 'Apply', confidence: 95, blocks: [
            { paragraphs: [{ lines: [{ words: [{ text: 'Apply', confidence: 95, bbox: { x0: 10, y0: 20, x1: 50, y1: 40 } }] }] }] },
        ] } }),
    });
    const result = await h._ocrScreen({});
    assert.equal(result.text, 'Apply');
    assert.equal(result.confidence, 95);
    assert.equal(result.words[0].x, -70);
    assert.equal(result.words[0].y, 60);
});
