const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium']
    .find(file => file && fs.existsSync(file));

test('questions accept keyboard choices and custom replies, retry, and restore summaries', { skip: !executablePath }, async () => {
    const server = http.createServer((request, response) => {
        if (['/js/question-cards.js', '/css/question-cards.css'].includes(request.url)) {
            response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css');
            response.end(fs.readFileSync(path.join(root, request.url)));
        } else response.end(`<!doctype html><style>
            :root{--text-primary:#242424;--text-secondary:#595959;--bg-primary:#fff;--bg-secondary:#fafafa;--border-color:#c8c8c8}
            body{font:15px system-ui;max-width:720px;margin:24px auto;padding:12px}
            </style><main id="chat"></main><script type="module">
            import {QuestionCards} from '/js/question-cards.js';
            window.answers=[];window.fail=true;
            window.cards=new QuestionCards({submit:async payload=>{if(window.fail)throw new Error('Retry this request.');window.answers.push(payload)},cancel:async()=>{}});
            window.request={requestId:'request',conversationId:'chat',id:'message',runId:'run',status:'pending',questions:[
                {id:'one',kind:'choice',question:'Which platform?',options:[{label:'Linux',description:'Use the Ubuntu server.'},{label:'Windows'}]},
                {id:'two',kind:'text',question:'What should the project be called?',options:[]}]};
            window.cards.mount(window.request,document.getElementById('chat'));</script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForSelector('.agent-question-card');
        await page.click('.agent-question-submit');
        assert.match(await page.$eval('.agent-question-status', node => node.textContent), /Answer every/);
        await page.focus('input[value="Linux"]');
        await page.keyboard.press('Space');
        await page.type('fieldset:nth-of-type(2) textarea', 'Workbench');
        await page.click('.agent-question-submit');
        await page.waitForFunction(() => document.querySelector('.agent-question-status').textContent === 'Retry this request.');
        assert.equal(await page.$eval('.agent-question-submit', button => button.disabled), false);
        await page.evaluate(() => { window.fail = false; });
        await page.click('.agent-question-submit');
        await page.waitForFunction(() => window.answers.length === 1);
        const answers = await page.evaluate(() => window.answers[0].answers);
        assert.deepEqual(answers, { one: { selected: ['Linux'], text: '' }, two: 'Workbench' });
        await page.evaluate(() => window.cards.update({ ...window.request, status: 'answered', answers: window.answers[0].answers }));
        assert.equal(await page.$eval('.agent-question-actions', element => element.hidden), true);
        for (const viewport of [{ width: 1280, height: 850 }, { width: 390, height: 844 }]) {
            await page.setViewport(viewport);
            await page.evaluate(() => {
                document.getElementById('chat').replaceChildren();
                window.cards.mount({ ...window.request, status: 'pending' }, document.getElementById('chat'));
            });
            await page.type('fieldset:first-of-type textarea', 'macOS <img src=x onerror=alert(1)>');
            await page.type('fieldset:nth-of-type(2) textarea', 'Workbench');
            await page.click('.agent-question-submit');
            const result = await page.evaluate(() => ({
                answer: window.answers.at(-1).answers.one,
                overflow: document.documentElement.scrollWidth > window.innerWidth,
                checked: [...document.querySelectorAll('input')].some(input => input.checked),
                injected: document.querySelectorAll('.agent-question-card img').length
            }));
            assert.equal(result.answer.selected.length, 0);
            assert.match(result.answer.text, /macOS/);
            assert.equal(result.overflow, false);
            assert.equal(result.checked, false);
            assert.equal(result.injected, 0);
            fs.mkdirSync(path.join(root, '.ui-check'), { recursive: true });
            await page.screenshot({ path: path.join(root, `.ui-check/question-cards-${viewport.width}.png`) });
        }
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
