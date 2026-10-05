const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

test('workspace tree supports disclosure, keyboard navigation, previews and system accents', { skip: !executablePath }, async t => {
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 800 });
    await page.setContent('<!doctype html><html><body><div id="tree" style="width:280px"></div><pre id="preview"></pre></body></html>');
    for (const sheet of ['design-system', 'project-workspace', 'project-workspace-animations']) {
        await page.addStyleTag({ content: fs.readFileSync(path.join(root, `css/${sheet}.css`), 'utf8') });
    }
    const source = fs.readFileSync(path.join(root, 'js/project-workspace.js'), 'utf8');
    await page.addScriptTag({ content: `${source.slice(0, source.indexOf('const projectWorkspace = new ProjectWorkspace();'))}\nwindow.ProjectWorkspace = ProjectWorkspace;` });
    await page.evaluate(() => {
        const workspace = Object.create(window.ProjectWorkspace.prototype);
        workspace.el = { tree: document.getElementById('tree'), previewContent: document.getElementById('preview') };
        workspace.getExecutionTarget = () => 'cloud';
        window.currentConversationId = 'tree-check';
        workspace.callApi = async (_url, _method, payload) => ({ content: `Preview for ${payload.path}` });
        window.workspace = workspace;
        window.paths = ['src/components/button.tsx', 'src/app.js', 'assets/logo.svg', 'package.json', '__proto__/safe.txt', 'constructor/file.md', 'a-very-long-file-name-that-should-truncate-without-overflow.txt'];
        workspace.renderTreeFromPaths(window.paths);
    });
    const row = name => `.project-file-row[data-path="${name}"]`;
    assert.equal(await page.$eval(row('src'), el => el.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.$eval(row('src/components'), el => el.getAttribute('aria-expanded')), 'false');
    assert.equal(await page.$eval(row('src/components/button.tsx'), el => Boolean(el.closest('[inert]'))), true);
    assert.ok(await page.$(row('__proto__/safe.txt')));
    await page.click(row('src/components'));
    await page.waitForFunction(() => document.querySelector('[data-path="src/components/button.tsx"]').getBoundingClientRect().height > 0);
    await page.focus(row('src/components'));
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.path), 'src/components/button.tsx');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('preview').textContent === 'Preview for src/components/button.tsx');
    assert.equal(await page.$eval(row('src/components/button.tsx'), el => el.getAttribute('aria-selected')), 'true');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.path), 'src/components');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.$eval(row('src/components'), el => el.getAttribute('aria-expanded')), 'false');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.path), 'src/app.js');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('preview').textContent === 'Preview for src/app.js');
    assert.equal(await page.$eval(row('src/components/button.tsx'), el => el.getAttribute('aria-selected')), 'false');
    await page.evaluate(() => window.workspace.renderTreeFromPaths(window.paths));
    assert.equal(await page.$eval(row('src/components'), el => el.getAttribute('aria-expanded')), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.path), 'src/app.js');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.path), '__proto__');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.path), 'package.json');
    await page.hover(row('src/app.js'));
    await page.waitForFunction(() => {
        const highlight = document.querySelector('.project-tree-hover').getBoundingClientRect();
        const target = document.querySelector('[data-path="src/app.js"]').getBoundingClientRect();
        return Math.abs(highlight.top - target.top) < 1;
    });
    await page.click(row('src'));
    await page.waitForFunction(() => document.querySelector('[data-path="src"]').nextElementSibling.getBoundingClientRect().height < 1);
    await page.click(row('src'));
    await page.waitForFunction(() => document.querySelector('[data-path="src"]').nextElementSibling.getBoundingClientRect().height > 50);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.ok(await page.$eval('.project-tree-panel', el => parseFloat(getComputedStyle(el).transitionDuration) <= 0.00001));
    assert.equal(await page.$eval('.project-file-row', el => getComputedStyle(el).animationName), 'none');
    for (const dark of [false, true]) {
        for (const width of [1280, 390]) {
            await page.setViewport({ width, height: 800 });
            await page.evaluate(darkMode => {
                document.body.classList.toggle('dark-mode', darkMode);
                document.body.style.setProperty('--accent-color', '#0078d4');
                document.body.style.setProperty('--accent-color-rgb', '0, 120, 212');
            }, dark);
            await page.waitForFunction(() => getComputedStyle(document.querySelector('.project-file-row.selected')).borderLeftColor === 'rgba(0, 120, 212, 0.3)');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.screenshot({ path: path.join(os.tmpdir(), `workspace-tree-${dark ? 'dark' : 'light'}-${width}.png`) });
        }
    }
    await page.evaluate(() => {
        document.body.style.setProperty('--accent-color', '#d83b01');
        document.body.style.setProperty('--accent-color-rgb', '216, 59, 1');
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.project-file-row.selected')).borderLeftColor === 'rgba(216, 59, 1, 0.3)');
    assert.deepEqual(errors, []);
});
