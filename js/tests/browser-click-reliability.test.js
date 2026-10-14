const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const puppeteer = require('puppeteer-core');
const BrowserHandler = require('../browser-handler');

const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => file && fs.existsSync(file));

test('browser fallback activates once, toggles once and preserves mouse event order in Chromium', { skip: !executablePath }, async t => {
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<button data-aios-id="1">Apply</button><label><input data-aios-id="2" type="checkbox">Option</label><button data-aios-id="3" disabled>Disabled</button>');
    await page.evaluate(() => {
        window.events = [];
        for (const type of ['mousedown', 'mouseup', 'click']) {
            document.addEventListener(type, event => window.events.push({ type, id: event.target.dataset.aiosId }));
        }
    });
    const emitter = new EventEmitter();
    const handler = new BrowserHandler(emitter, process.cwd(), async () => null, { isBlocked: () => false });
    handler.isConnected = true;
    handler.page = new Proxy(page, { get(target, key) {
        if (key === 'click') return async () => { throw new Error('Exercise the existing fallback'); };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
    } });
    handler._stabilizeAfterInteraction = async () => {};
    handler.getView = async () => ({ status: 'success' });
    const results = [];
    emitter.on('browser-command-result', payload => results.push(payload.result));
    for (const element_id of [1, 2, 3]) {
        await handler.handleCommand({ action: 'click', element_id, request_id: `fallback-${element_id}` });
    }
    const events = await page.evaluate(() => window.events);
    assert.deepEqual(events.filter(event => event.id === '1').map(event => event.type), ['mousedown', 'mouseup', 'click']);
    assert.equal(events.filter(event => event.id === '2' && event.type === 'click').length, 1);
    assert.equal(await page.$eval('[data-aios-id="2"]', el => el.checked), true);
    assert.equal(events.filter(event => event.id === '3' && event.type === 'click').length, 0);
    assert.ok(results.every(result => result.status === 'success'));
});
