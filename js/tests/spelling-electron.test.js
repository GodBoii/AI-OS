const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { setTimeout: delay } = require('node:timers/promises');

test('Electron corrects one occurrence with undo and preserves Quick Prompt during menu use', { timeout: 90000 }, async t => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aetheria-spelling-'));
    const browser = await puppeteer.launch({ executablePath: require('electron'), ignoreDefaultArgs: true,
        args: [path.join(__dirname, 'fixtures/spelling-electron.cjs'), '--remote-debugging-port=0'],
        env: { ...process.env, SPELLING_TEST_PROFILE: profile } });
    t.after(async () => {
        await browser.close();
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const page = (await browser.pages())[0];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof require === 'function');
    const invoke = (action, index) => page.evaluate((action, index) =>
        require('electron').ipcRenderer.invoke('spelling-fixture', action, index), action, index);
    await page.setContent('<textarea id="prose" spellcheck="true" aria-label="Message" style="font:20px monospace;width:700px;height:120px"></textarea><textarea id="code" spellcheck="false" aria-label="JSON"></textarea><iframe srcdoc="<textarea>speling</textarea>"></iframe>');
    await page.evaluate(() => {
        window.inputEvents = 0;
        document.getElementById('prose').addEventListener('input', () => window.inputEvents++);
    });
    if (process.platform !== 'darwin') {
        await page.waitForFunction(() => require('electron').ipcRenderer.invoke('spelling-fixture', 'dictionary')
            .then(result => result.events.some(event => event.event === 'spellcheck-dictionary-initialized')),
        { timeout: 45000 });
    }
    await page.focus('#prose');
    await page.keyboard.type('speling speling ');
    const box = await page.$eval('#prose', el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y };
    });
    const openSpellingMenu = async (targetPage, x, y) => {
        // Dictionary initialization precedes renderer readiness. Retry the real
        // context-menu result, as Electron's own spellchecker tests do.
        for (let attempt = 0; attempt < 100; attempt++) {
            await targetPage.mouse.click(x, y, { button: 'right' });
            const result = await invoke('menu');
            if (result.params?.word === 'speling') return result;
            await invoke('close');
            await delay(100);
        }
        assert.fail(`No spelling result: ${JSON.stringify(await invoke('menu'))}; ${JSON.stringify(await invoke('dictionary'))}`);
    };
    let menu = await openSpellingMenu(page, box.x + 112, box.y + 12);
    const suggestionIndex = menu.items.findIndex(item => item.label === 'spelling');
    assert.ok(suggestionIndex >= 0, JSON.stringify(menu));
    const before = await page.evaluate(() => window.inputEvents);
    await invoke('choose', suggestionIndex);
    await page.waitForFunction(() => document.getElementById('prose').value === 'speling spelling ');
    assert.ok(await page.evaluate(() => window.inputEvents) > before, 'Native correction must emit input');
    await page.mouse.click(box.x + 112, box.y + 12, { button: 'right' });
    menu = await invoke('menu');
    await invoke('choose', menu.items.findIndex(item => item.role === 'undo'));
    await page.waitForFunction(() => document.getElementById('prose').value === 'speling speling ');
    await page.mouse.click(box.x + 112, box.y + 12, { button: 'right' });
    menu = await invoke('menu');
    await invoke('choose', menu.items.findIndex(item => item.role === 'redo'));
    await page.waitForFunction(() => document.getElementById('prose').value === 'speling spelling ');

    await page.click('#code');
    await page.keyboard.type('speling ');
    await page.click('#code', { button: 'right' });
    menu = await invoke('menu');
    assert.equal(menu.params.spellcheckEnabled, false);
    assert.equal(menu.items.some(item => item.label === 'Add to dictionary'), false);
    await invoke('close');

    await page.focus('#prose');
    await page.keyboard.down('Shift');
    await page.keyboard.press('F10');
    await page.keyboard.up('Shift');
    menu = await invoke('menu');
    assert.equal(menu.params.source, 'keyboard');
    assert.ok(menu.items.length);
    await invoke('close');

    const preview = page.frames().find(frame => frame !== page.mainFrame());
    await preview.click('textarea', { button: 'right' });
    assert.equal((await invoke('menu')).items, undefined, 'Generated previews must not receive the app menu');

    await invoke('quick');
    const target = await browser.waitForTarget(target => target.type() === 'page' && target !== page.target());
    const quickPage = await target.page();
    quickPage.on('pageerror', error => errors.push(error.message));
    await quickPage.waitForSelector('#quick-prompt-input');
    await quickPage.type('#quick-prompt-input', 'speling ');
    const quickBox = await quickPage.$eval('#quick-prompt-input', el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y };
    });
    menu = await openSpellingMenu(quickPage, quickBox.x + 12, quickBox.y + 10);
    assert.equal((await invoke('quick-state')).visible, true);
    await invoke('choose', menu.items.findIndex(item => item.label === 'spelling'));
    await quickPage.waitForFunction(() => document.getElementById('quick-prompt-input').value === 'spelling ');
    await invoke('close');
    await page.waitForFunction(() => require('electron').ipcRenderer.invoke('spelling-fixture', 'quick-state')
        .then(result => result.visible && result.focused));
    await invoke('focus-main');
    await page.waitForFunction(() => require('electron').ipcRenderer.invoke('spelling-fixture', 'quick-state')
        .then(result => !result.visible));
    assert.equal(await page.$eval('#prose', el => el.value), 'speling spelling ');
    assert.deepEqual(errors, []);
});
