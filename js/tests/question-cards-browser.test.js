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

test('compact question deck browser flows', { skip: !executablePath }, async t => {
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (/^\/css\/[\w-]+\.css$/.test(url.pathname) || url.pathname === '/js/question-cards.js') {
            const file = path.join(root, url.pathname);
            if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
            response.setHeader('Content-Type', `${file.endsWith('.js') ? 'text/javascript' : 'text/css'}; charset=utf-8`);
            response.end(fs.readFileSync(file));
            return;
        }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <link rel="stylesheet" href="/css/design-system.css">
            <link rel="stylesheet" href="/css/style.css">
            <link rel="stylesheet" href="/css/chat.css">
            <link rel="stylesheet" href="/css/glass-overrides.css">
            <link rel="stylesheet" href="/css/theme-light.css">
            <style>body{margin:0;background:var(--bg-color);color:var(--text-color);font:15px var(--font-sans)}
            main{box-sizing:border-box;width:100%;max-width:800px;margin:64px auto;padding:16px}
            .context{margin:0 14px 22px;color:var(--text-secondary);font-size:14px}
            @media(max-width:480px){main{margin:16px auto;padding:4px}}</style>
            <body class="dark-mode"><main><p class="context">Personal profile interview</p><div id="chat" class="message-bot"></div></main>
            <script type="module">
            import {QuestionCards} from '/js/question-cards.js';
            window.answers=[];window.attempts=[];window.fail=false;window.terminals=[];window.cancellations=[];
            window.cards=new QuestionCards({submit:async payload=>{
                window.attempts.push(payload);
                if(window.delay) await new Promise(resolve=>{window.resolveSubmit=resolve});
                if(window.fail)throw new Error('Connection lost. Try again.');
                window.answers.push(payload);
            },cancel:async request=>{window.cancellations.push(request.requestId)},onTerminal:request=>window.terminals.push(request)});
            window.request={requestId:'request',conversationId:'chat',id:'message',runId:'run',status:'pending',expiresAt:Date.now()/1000+600,questions:[
                {id:'one',kind:'choice',question:'What best describes what you do?',options:[
                    {label:'Student',description:'School, college, or university'},
                    {label:'Professional',description:'Working in a company or organization'},
                    {label:'Entrepreneur',description:'Running a business or startup'},
                    {label:'Creator / freelancer',description:'Independent creative or freelance work'}]},
                {id:'two',kind:'text',question:'What should I call you?',options:[]},
                {id:'three',kind:'choice',multiSelect:true,question:'What should I mainly help you with?',options:[
                    {label:'Work & productivity',description:'Documents, spreadsheets, and organization'},
                    {label:'Tech & coding',description:'Software projects and web apps'},
                    {label:'Content & media',description:'Presentations, images, and video'},
                    {label:'Research & learning',description:'Web research and exploring new topics'}]}]};
            window.mount=(overrides={})=>{const chat=document.getElementById('chat');window.cards.releaseContainer(chat);chat.replaceChildren();
                window.cards.mount({...window.request,...overrides},chat)};
            window.mount();</script>`);
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
        await page.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href?.endsWith('question-cards.css')));

        await t.test('keyboard choices, back navigation, multi-select, safe retry, and summary', async () => {
            assert.equal(await page.$$eval('fieldset:not([hidden])', nodes => nodes.length), 1);
            assert.equal(await page.$eval('.agent-question-reply', node => node.hidden), true);
            await page.click('.agent-question-submit');
            assert.match(await page.$eval('.agent-question-status', node => node.textContent), /Choose an option/);
            await page.focus('input[value="Student"]');
            await page.keyboard.press('Space');
            await page.click('.agent-question-submit');
            assert.equal(await page.$eval('fieldset:not([hidden]) legend', node => node === document.activeElement), true);
            await page.type('fieldset:not([hidden]) textarea', 'Mira');
            await page.click('.agent-question-back');
            assert.equal(await page.$eval('input[value="Student"]', node => node.checked), true);
            await page.click('.agent-question-submit');
            assert.equal(await page.$eval('fieldset:not([hidden]) textarea', node => node.value), 'Mira');
            await page.click('.agent-question-submit');
            await page.click('input[value="Tech & coding"]');
            await page.click('input[value="Research & learning"]');
            await page.evaluate(() => { window.fail = true; });
            await page.click('.agent-question-submit');
            await page.waitForFunction(() => document.querySelector('.agent-question-status').textContent === 'Connection lost. Try again.');
            assert.equal(await page.$eval('.agent-question-submit', node => node.disabled), false);
            await page.evaluate(() => { window.fail = false; });
            await page.click('.agent-question-submit');
            await page.waitForSelector('[data-state="resuming"]');
            const result = await page.evaluate(() => ({ answers: window.answers[0].answers,
                sameId: window.attempts[0].submissionId === window.attempts[1].submissionId }));
            assert.deepEqual(result.answers, { one: { selected: ['Student'], text: '' }, two: 'Mira',
                three: { selected: ['Tech & coding', 'Research & learning'], text: '' } });
            assert.equal(result.sameId, true);
            assert.equal(await page.$eval('.agent-question-actions', node => node.hidden), true);
            assert.match(await page.$eval('.agent-question-summary', node => node.textContent), /Mira/);
            await page.evaluate(() => window.cards.update({ requestId: 'request', status: 'answered' }));
            assert.match(await page.$eval('.agent-question-summary', node => node.textContent), /Mira/);
            await page.evaluate(() => window.cards.mount(window.request, document.getElementById('chat')));
            assert.equal(await page.$eval('.agent-question-card', node => node.dataset.state), 'answered');
        });

        await t.test('custom replies replace selections, escaped summaries, and missing previous answers', async () => {
            await page.evaluate(() => window.mount());
            await page.click('input[value="Student"]');
            await page.click('fieldset:not([hidden]) .agent-question-custom');
            await page.type('fieldset:not([hidden]) textarea', 'Independent <img src=x onerror=alert(1)>');
            assert.equal(await page.$eval('input[value="Student"]', node => node.checked), false);
            await page.click('.agent-question-submit');
            await page.type('fieldset:not([hidden]) textarea', 'Mira');
            await page.click('.agent-question-submit');
            await page.click('input[value="Tech & coding"]');
            await page.click('.agent-question-submit');
            await page.waitForSelector('[data-state="resuming"]');
            assert.equal(await page.$$eval('.agent-question-card img', nodes => nodes.length), 0);
            assert.match(await page.$eval('.agent-question-summary', node => node.textContent), /<img/);
            await page.evaluate(() => window.mount());
            await page.click('.agent-question-step:nth-child(3)');
            await page.click('input[value="Tech & coding"]');
            await page.click('.agent-question-submit');
            assert.equal(await page.$eval('fieldset:not([hidden]) legend', node => node.textContent), 'What best describes what you do?');
            assert.match(await page.$eval('.agent-question-status', node => node.textContent), /Choose an option/);
        });

        await t.test('deadline expires once, never submits, and releases timers', async () => {
            const count = await page.evaluate(() => window.answers.length);
            await page.evaluate(() => window.mount({ expiresAt: Date.now() / 1000 + 1.1 }));
            assert.match(await page.$eval('.agent-question-timer', node => node.textContent), /0:0[12] left/);
            await page.waitForSelector('[data-state="expired"]');
            assert.match(await page.$eval('.agent-question-status', node => node.textContent), /Timed out/);
            assert.equal(await page.evaluate(() => window.answers.length), count);
            assert.equal(await page.evaluate(() => window.terminals.length), 1);
            await page.evaluate(() => window.cards.update({ requestId: 'request', status: 'expired' }));
            assert.equal(await page.evaluate(() => window.terminals.length), 1);
            await page.evaluate(() => window.mount({ expiresAt: Date.now() / 1000 - 1 }));
            assert.equal(await page.$eval('.agent-question-card', node => node.dataset.state), 'expired');
            await page.evaluate(() => {
                window.mount();
                window.cards.releaseContainer(document.getElementById('chat'));
            });
            assert.equal(await page.evaluate(() => window.cards.cards.size), 0);
        });

        await t.test('accepted submission crossing the deadline and terminal update during a failed send', async () => {
            await page.evaluate(() => {
                window.delay = true;
                window.mount({ expiresAt: Date.now() / 1000 + 1.1, questions: [window.request.questions[0]] });
            });
            await page.click('input[value="Student"]');
            await page.click('.agent-question-submit');
            await page.waitForFunction(() => document.querySelector('.agent-question-timer').textContent === '0:00 left');
            assert.equal(await page.$eval('.agent-question-card', node => node.dataset.state), undefined);
            await page.evaluate(() => { window.resolveSubmit(); window.delay = false; });
            await page.waitForSelector('[data-state="resuming"]');
            await page.evaluate(() => {
                window.delay = true; window.fail = true;
                window.mount({ questions: [window.request.questions[0]] });
            });
            await page.click('input[value="Student"]');
            await page.click('.agent-question-submit');
            await page.evaluate(() => {
                window.cards.update({ requestId: 'request', status: 'cancelled' });
                window.resolveSubmit(); window.delay = false;
            });
            await page.waitForFunction(() => document.querySelector('.agent-question-card').dataset.state === 'cancelled');
            assert.equal(await page.$eval('fieldset', node => node.disabled), true);
            await page.evaluate(() => { window.fail = false; window.mount(); });
            await page.click('.agent-question-stop');
            await page.waitForSelector('[data-state="cancelled"]');
            assert.equal(await page.evaluate(() => window.cancellations.length), 1);
        });

        await t.test('desktop and mobile themes, long copy, reduced motion, and restored summary', async () => {
            fs.mkdirSync(path.join(root, '.ui-check'), { recursive: true });
            for (const dark of [true, false]) {
                for (const width of [1280, 390]) {
                    await page.setViewport({ width, height: 850 });
                    await page.evaluate(dark => {
                        document.body.classList.toggle('dark-mode', dark);
                        window.mount();
                    }, dark);
                    await page.evaluate(async () => {
                        await Promise.all(document.getAnimations()
                            .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity)
                            .map(animation => animation.finished.catch(() => {})));
                    });
                    const layout = await page.evaluate(() => {
                        const card = document.querySelector('.agent-question-card').getBoundingClientRect();
                        const button = getComputedStyle(document.querySelector('.agent-question-submit'));
                        const canvas = document.createElement('canvas');
                        canvas.width = canvas.height = 1;
                        const context = canvas.getContext('2d', { willReadFrequently: true });
                        const luminance = color => {
                            context.fillStyle = color;
                            context.fillRect(0, 0, 1, 1);
                            const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
                                const channel = value / 255;
                                return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
                            });
                            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
                        };
                        const ratio = (first, second) => {
                            const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
                            return (values[0] + .05) / (values[1] + .05);
                        };
                        const cardStyle = getComputedStyle(document.querySelector('.agent-question-card'));
                        const title = getComputedStyle(document.querySelector('fieldset legend'));
                        return { overflow: document.documentElement.scrollWidth > innerWidth,
                            width: card.width, height: card.height,
                            buttonContrast: ratio(button.color, button.backgroundColor),
                            titleContrast: ratio(title.color, cardStyle.backgroundColor),
                            ink: title.color, surface: cardStyle.backgroundColor };
                    });
                    await page.screenshot({ path: path.join(root, `.ui-check/question-deck-${dark ? 'dark' : 'light'}-${width}.png`) });
                    if (dark && width === 1280) {
                        const card = await page.$('.agent-question-card');
                        await card.screenshot({ path: path.join(root, '.ui-check/question-deck-preview.png') });
                    }
                    assert.equal(layout.overflow, false);
                    assert.ok(layout.width <= 576);
                    assert.ok(layout.height < 500, JSON.stringify(layout));
                    assert.ok(layout.buttonContrast >= 4.5, JSON.stringify(layout));
                    assert.ok(layout.titleContrast >= 4.5, JSON.stringify(layout));
                }
            }
            await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
            await page.evaluate(() => window.mount({ questions: [{ ...window.request.questions[0], question: 'A'.repeat(1000),
                options: [{ label: 'B'.repeat(200), description: 'Details '.repeat(60) }, { label: 'Other' }] }] }));
            assert.equal(await page.$eval('fieldset', node => getComputedStyle(node).transitionDuration), '0s');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await page.evaluate(() => window.mount({ status: 'answered', answers: { one: { selected: ['Student'], text: '' },
                two: 'Mira', three: { selected: ['Tech & coding'], text: '' } } }));
            assert.equal(await page.$eval('.agent-question-body', node => node.hidden), true);
            assert.match(await page.$eval('.agent-question-summary', node => node.textContent), /Student/);
            await page.screenshot({ path: path.join(root, '.ui-check/question-deck-summary.png') });
        });
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
