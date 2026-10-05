const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const puppeteer = require('puppeteer-core');
const BrowserHandler = require('../browser-handler');
const BrowserSettings = require('../browser-settings');

const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => file && fs.existsSync(file));

test('managed browser honors persisted typing modes for fields and contenteditable', { skip: !executablePath }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'typing-browser-'));
    const settings = new BrowserSettings(directory);
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(async () => { await browser.close(); fs.rmSync(directory, { recursive: true, force: true }); });
    const page = await browser.newPage();
    const handler = Object.create(BrowserHandler.prototype);
    handler.page = page;
    handler.settings = settings;
    await page.setContent('<label>Text<textarea data-aios-id="1"></textarea></label><div data-aios-id="2" contenteditable="true" role="textbox" aria-label="Editor"></div><input data-aios-id="3" disabled><button data-aios-id="4">Button</button>');
    await page.evaluate(() => {
        window.inputEvents = [];
        document.addEventListener('input', event => window.inputEvents.push({ text: event.data, type: event.inputType }));
    });
    const text = 'Hi 😀 नमस्ते\nOK';
    for (const speed of ['instant', 'fast', 'slow']) {
        settings.update({ typingSpeed: speed });
        for (const element_id of [1, 2]) {
            await page.evaluate(() => { window.inputEvents = []; });
            assert.equal(await handler._typeText({ element_id, text }), speed);
            const result = await page.$eval(`[data-aios-id="${element_id}"]`, el => ({ value: el.value ?? el.innerText, focused: el === document.activeElement }));
            assert.equal(result.value, text);
            assert.equal(result.focused, true);
            const events = await page.evaluate(() => window.inputEvents.filter(event => event.text));
            if (speed === 'instant') assert.ok(events.some(event => event.text.includes('Hi 😀 नमस्ते')), JSON.stringify(events));
            else assert.ok(events.length > 5);
        }
    }
    settings.update({ typingSpeed: 'instant' });
    await handler._typeText({ element_id: 1, text: '!', clear_existing: false });
    assert.equal(await page.$eval('[data-aios-id="1"]', el => el.value), text + '!');
    await assert.rejects(handler._typeText({ element_id: 3, text: 'bad' }), /editable/);
    await assert.rejects(handler._typeText({ element_id: 4, text: 'bad' }), /editable/);
    await assert.rejects(handler._typeText({ element_id: -1, text: 'bad' }), /element ID/);
    const html = await page.content();
    assert.ok(!html.includes('bad'));
});
