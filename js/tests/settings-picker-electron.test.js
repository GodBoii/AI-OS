const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

test('settings pickers stay visible inside a transformed Account window in Electron', async t => {
    const root = path.resolve(__dirname, '../..');
    const source = fs.readFileSync(path.join(root, 'js/aios.js'), 'utf8');
    const selects = ['settings-typing-speed', 'settings-browser-visibility'].map(id => {
        const markup = source.match(new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`))[0];
        return markup.replace(' disabled', '');
    });
    const browser = await puppeteer.launch({
        executablePath: require('electron'),
        ignoreDefaultArgs: true,
        args: [path.join(__dirname, 'fixtures/settings-electron.cjs'), '--remote-debugging-port=0'],
    });
    t.after(() => browser.close());
    const page = (await browser.pages())[0];
    await page.setContent(`<body class="dark-mode"><div style="position:fixed;left:52.5%;top:50%;width:700px;height:500px;transform:translate(-50%,-50%);overflow:auto">
        ${selects.map(select => `<section style="margin:80px 24px;transform:translateY(-4px)">${select}</section>`).join('')}
        </div></body>`);
    await page.addStyleTag({ path: path.join(root, 'css/app-settings.css') });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
        window.AIOS.initSettingsSelectPickers();
        window.panelEscapes = 0;
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') window.panelEscapes++;
        });
    });
    for (const id of ['settings-typing-speed', 'settings-browser-visibility']) {
        await page.click(`#${id}`);
        const state = await page.$eval(`#${id}`, el => ({
            open: el.matches(':open'),
            opacity: getComputedStyle(el, '::picker(select)').opacity,
            display: getComputedStyle(el, '::picker(select)').display,
        }));
        assert.equal(state.open, true);
        assert.equal(state.opacity, '1');
        assert.notEqual(state.display, 'none');
        const layout = await page.$eval(`#${id}`, el => {
            const trigger = el.getBoundingClientRect();
            return [...el.options].map(option => {
                const r = option.getBoundingClientRect();
                return {
                    inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
                    aligned: Math.abs(r.left - trigger.left) < 12,
                };
            });
        });
        for (const option of layout) {
            assert.equal(option.inViewport, true);
            assert.equal(option.aligned, true);
        }
        await page.click(`#${id} option:last-child`);
        assert.equal(await page.$eval(`#${id}`, el => el.value), id === 'settings-typing-speed' ? 'slow' : 'headless');
        await page.click(`#${id}`);
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval(`#${id}`, el => el.matches(':open')), false);
        assert.equal(await page.evaluate(() => window.panelEscapes), 0);
    }
});
