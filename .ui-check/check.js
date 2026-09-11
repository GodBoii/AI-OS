// Renders the real Browser Automation card, pulled straight out of js/aios.js, with
// the real stylesheets in the real cascade order, then measures the layout.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const outDir = __dirname;

const chrome = [
    path.join(process.env.ProgramW6432 || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.ProgramW6432 || '', 'Microsoft/Edge/Application/msedge.exe'),
].find((p) => p && fs.existsSync(p));
if (!chrome) throw new Error('No Chrome or Edge found for the UI check.');

// Same stylesheet order index.html uses, so a collision there is a collision here.
const sheets = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .split('\n')
    .map((line) => line.match(/href="(css\/[^"]+\.css)"/))
    .filter(Boolean)
    .map((m) => m[1]);

const aios = fs.readFileSync(path.join(root, 'js/aios.js'), 'utf8');
const start = aios.indexOf('<!-- Browser Automation Section -->');
const end = aios.indexOf('<!-- Keyboard Shortcuts Section -->');
if (start < 0 || end < 0) throw new Error('Could not locate the Browser Automation card in aios.js.');
const card = aios.slice(start, end);

const page = (mode) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
${sheets.map((href) => `<link rel="stylesheet" href="../${href}">`).join('\n')}
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
  /* Approximates the width the card gets inside the Account modal content column. */
  body { margin: 0; padding: 24px; background: ${mode === 'dark' ? '#0b0b12' : '#f4f4f7'}; }
  #settings-tab { width: 730px; }
</style></head>
<body class="${mode === 'dark' ? 'dark-mode' : ''}">
  <div id="settings-tab" class="tab-content active">${card}</div>
</body></html>`;

(async () => {
    for (const mode of ['dark', 'light']) {
        fs.writeFileSync(path.join(outDir, `${mode}.html`), page(mode));
    }

    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: 'new',
        args: ['--no-sandbox', '--force-device-scale-factor=2'],
        defaultViewport: { width: 800, height: 900 },
    });

    for (const mode of ['dark', 'light']) {
        const tab = await browser.newPage();
        await tab.goto(`file://${path.join(outDir, `${mode}.html`).replace(/\\/g, '/')}`, { waitUntil: 'load' });

        // The list is populated by IPC in the real app, so seed it here to exercise
        // the populated state. Measured before this, `:empty` must hide the box.
        const emptyHidden = await tab.evaluate(() => {
            const list = document.getElementById('settings-browser-sites');
            return getComputedStyle(list).display === 'none';
        });
        await tab.evaluate(() => {
            const list = document.getElementById('settings-browser-sites');
            const sites = [
                { domain: 'accounts.google.com', cookies: 24 },
                { domain: 'github.com', cookies: 1 },
                { domain: 'a-very-long-subdomain.example-with-a-long-name.co.uk', cookies: 7 },
            ];
            for (const site of sites) {
                list.insertAdjacentHTML('beforeend',
                    `<li class="settings-site-row"><span class="settings-site-domain"></span>` +
                    `<span class="settings-site-meta">${site.cookies} cookies</span>` +
                    `<button type="button" class="settings-field-btn settings-field-btn-sm">Clear</button></li>`);
                list.lastElementChild.querySelector('.settings-site-domain').textContent = site.domain;
            }
        });
        await new Promise((r) => setTimeout(r, 400));

        if (mode === 'dark') {
            const metrics = await tab.evaluate(() => {
                const row = document.getElementById('settings-browser-visibility').closest('.settings-toggle-row');
                const rect = (el) => Math.round(el.getBoundingClientRect().width);
                const overflows = [...document.querySelectorAll('#settings-tab *')]
                    .filter((el) => el.scrollWidth > el.clientWidth + 1)
                    .map((el) => el.className || el.tagName);
                const header = document.querySelector('.settings-card-header');
                return {
                    select: rect(document.getElementById('settings-browser-visibility')),
                    label: rect(row.querySelector('.settings-toggle-info')),
                    titleLeft: Math.round(header.querySelector('.settings-card-title').getBoundingClientRect().left),
                    iconRight: Math.round(header.querySelector('.settings-card-icon').getBoundingClientRect().right),
                    labelLines: Math.round(row.querySelector('.settings-toggle-label').getBoundingClientRect().height),
                    idleInput: rect(document.getElementById('settings-browser-idle')),
                    signInInput: rect(document.getElementById('settings-browser-open-url')),
                    cards: document.querySelectorAll('#settings-tab .settings-card').length,
                    siteDomain: rect(document.querySelector('.settings-site-domain')),
                    siteBtn: rect(document.querySelector('.settings-site-row button')),
                    overflows,
                };
            });
            console.log(JSON.stringify(metrics, null, 2));

            const fail = [];
            if (metrics.select < 130 || metrics.select > 145) fail.push(`select width ${metrics.select}px, expected ~136`);
            if (metrics.label < 400) fail.push(`label column only ${metrics.label}px, it is being crushed`);
            if (metrics.labelLines > 24) fail.push(`label wrapped to ${metrics.labelLines}px tall`);
            if (metrics.signInInput < 300) fail.push(`sign-in field only ${metrics.signInInput}px`);
            if (metrics.titleLeft - metrics.iconRight > 24) {
                fail.push(`title sits ${metrics.titleLeft - metrics.iconRight}px from the icon, header is not left-aligned`);
            }
            if (metrics.cards !== 2) fail.push(`expected 2 cards, found ${metrics.cards}`);
            if (!emptyHidden) fail.push('an empty site list should collapse, not show an empty box');
            if (metrics.siteBtn < 50) fail.push(`site Clear button squeezed to ${metrics.siteBtn}px`);
            if (metrics.overflows.length) fail.push(`overflowing: ${metrics.overflows.join(', ')}`);
            if (fail.length) {
                console.error('LAYOUT FAIL:\n - ' + fail.join('\n - '));
                process.exitCode = 1;
            } else {
                console.log('LAYOUT OK');
            }
        }

        await tab.screenshot({ path: path.join(outDir, `${mode}.png`), fullPage: true });
        await tab.close();
    }

    await browser.close();
})();
