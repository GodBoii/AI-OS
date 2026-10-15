const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium']
    .find(file => file && fs.existsSync(file));

test('jump to latest handles layout, nested readers, input and system appearance', { skip: !executablePath }, async t => {
    const files = new Map(['/js/chat-scroll-controller.js', '/js/desktop-bridge.js',
        '/css/design-system.css', '/css/chat-variables.css', '/css/chat-layout.css']
        .map(url => [url, fs.readFileSync(path.join(root, url), 'utf8')]));
    const chat = fs.readFileSync(path.join(root, 'chat.html'), 'utf8');
    const button = chat.slice(chat.indexOf('        <button id="chat-jump-latest"'), chat.indexOf('        <div id="project-main-file-preview"'));
    const server = http.createServer((request, response) => {
        if (files.has(request.url)) {
            response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
            response.end(files.get(request.url));
            return;
        }
        response.end(`<!doctype html><html><head><meta charset="utf-8">
            <link rel="stylesheet" href="/css/design-system.css">
            <link rel="stylesheet" href="/css/chat-variables.css">
            <link rel="stylesheet" href="/css/chat-layout.css">
            <style>
                body{margin:0;font:15px Arial;background:var(--window-bg);color:var(--text-color)}
                .chat-container{width:min(90%,800px);height:calc(100% - 130px)}
                .chat-messages{min-height:0}
                .detailed-logs{max-height:220px;overflow:auto;overflow-anchor:none;scroll-behavior:auto}
                .reasoning-thought-content{max-height:120px;overflow:auto;white-space:pre-wrap;overflow-anchor:none;scroll-behavior:auto;scrollbar-width:auto}
                .reasoning-thought-content::-webkit-scrollbar{width:12px}
                .message{margin-bottom:20px}.spacer{height:1000px}
                #floating-input-container{position:fixed;bottom:12px;left:5%;width:90%;height:80px;background:var(--window-bg);border:1px solid var(--border-color)}
                .chat-jump-latest i{display:block;width:16px;height:16px}
                .chat-jump-latest i::before{content:'↓';font:20px/16px Arial}
            </style></head><body><div class="chat-container"><div class="chat-window">
            <div id="chat-messages" class="chat-messages" tabindex="-1" aria-label="Conversation">
            <section id="thread" class="conversation-thread">
                <div id="older" class="message message-bot"><button id="collapse" type="button">Collapse earlier output</button>
                <div class="detailed-logs"><div class="reasoning-thought-content">${'Earlier reasoning\n'.repeat(100)}</div></div></div>
                <div id="latest" class="message message-bot"><div class="spacer"></div>
                <div class="detailed-logs"><div class="reasoning-thought-content">${'Latest reasoning\n'.repeat(100)}</div></div>
                <button id="action" type="button">Copy response</button><div class="message-content">Latest answer</div></div>
            </section></div>${button}</div></div><div id="floating-input-container">Composer</div>
            <script>
                window.appearanceListeners = {};
                window.electron = {ipcRenderer:{on:(name, callback)=>appearanceListeners[name]=callback,
                    invoke:async()=>({accentColor:'#0078d4',dark:false})}};
                localStorage.setItem('aetheria-general-settings', JSON.stringify({useSystemAccent:true}));
            </script><script src="/js/desktop-bridge.js"></script>
            <script type="module">
                import {ChatScrollController} from '/js/chat-scroll-controller.js';
                window.root = document.getElementById('chat-messages');
                window.thread = document.getElementById('thread');
                window.controller = new ChatScrollController(root, document.getElementById('chat-jump-latest'), document.getElementById('floating-input-container'));
                controller.activate('chat',thread);
                window.settled = ()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                document.getElementById('collapse').onclick = ()=>document.querySelector('.spacer').style.height='100px';
            </script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ executablePath, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const load = async () => {
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForFunction(() => window.controller && root.scrollTop > 0);
        await page.evaluate(() => settled());
    };

    await t.test('collapsing content after a click keeps following', async () => {
        await load();
        await page.evaluate(() => {
            document.getElementById('action').onclick = document.getElementById('collapse').onclick;
        });
        await page.click('#action');
        await page.evaluate(async () => {
            await settled();
            document.querySelector('.spacer').style.height='1300px';
            await settled();
        });
        assert.equal(await page.evaluate(() => controller.views.get('chat').mode), 'following');
        assert.ok(await page.evaluate(() => controller.gap(root) < 2));
    });

    await t.test('downward wheel intent does not turn a layout clamp into a pause', async () => {
        await load();
        await page.hover('#action');
        await page.mouse.wheel({deltaY:120});
        await page.evaluate(async () => {
            document.getElementById('collapse').click();
            await settled();
            document.querySelector('.spacer').style.height='1400px';
            await settled();
        });
        assert.equal(await page.evaluate(() => controller.views.get('chat').mode), 'following');
        assert.ok(await page.evaluate(() => controller.gap(root) < 2));
    });

    await t.test('jump catches up the paused older reasoning viewport too', async () => {
        await load();
        await page.evaluate(async () => {
            const older = document.querySelector('#older .reasoning-thought-content');
            older.scrollTop = 80;
            controller.pause(older);
            await settled();
        });
        await page.focus('#chat-jump-latest');
        await page.keyboard.press('Enter');
        await page.evaluate(() => settled());
        assert.ok(await page.evaluate(() => controller.gap(document.querySelector('#older .reasoning-thought-content')) < 2));
        assert.equal(await page.evaluate(() => document.activeElement === root), true);
        assert.equal(await page.$eval('#chat-jump-latest', node => node.hidden), true);
    });

    await t.test('button keyboard activation does not pause the conversation', async () => {
        await load();
        await page.focus('#action');
        await page.keyboard.down('Shift');
        await page.keyboard.press('Space');
        await page.keyboard.up('Shift');
        assert.equal(await page.evaluate(() => controller.views.get('chat').mode), 'following');
    });

    await t.test('native scrollbar dragging stays paused during streamed updates', async () => {
        await load();
        const box = await page.$eval('#latest .reasoning-thought-content', node => {
            const rect = node.getBoundingClientRect();
            return {x:rect.right-5,y:rect.bottom-8,width:node.offsetWidth-node.clientWidth};
        });
        assert.ok(box.width > 0, 'The fixture must expose a native scrollbar '+JSON.stringify(box));
        await page.mouse.move(box.x,box.y);
        await page.mouse.down();
        // A held scrollbar must outlive the old 1.5-second intent timeout.
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve,1600)));
        await page.mouse.move(box.x,box.y-70,{steps:5});
        await page.evaluate(() => settled());
        assert.equal(await page.evaluate(() => controller.views.get('chat').mode), 'paused');
        const top = await page.$eval('#latest .reasoning-thought-content', node => node.scrollTop);
        await page.evaluate(async () => {
            document.querySelector('#latest .reasoning-thought-content').append('Still streaming\n'.repeat(30));
            await settled();
        });
        assert.equal(await page.$eval('#latest .reasoning-thought-content', node => node.scrollTop),top);
        await page.mouse.up();
        await page.click('#chat-jump-latest');
        await page.evaluate(() => settled());
        assert.ok(await page.evaluate(() => controller.scopes().every(node => controller.gap(node) < 2)));
    });

    await t.test('keyboard scrolling pauses and End resumes following', async () => {
        await load();
        await page.focus('#chat-messages');
        await page.keyboard.press('PageUp');
        await page.waitForFunction(() => controller.views.get('chat').mode === 'paused' && controller.gap(root) > 12);
        await page.keyboard.press('End');
        await page.waitForFunction(() => controller.views.get('chat').mode === 'following' && controller.gap(root) < 2);
        assert.equal(await page.$eval('#chat-jump-latest', node => node.hidden),true);
    });

    await t.test('conversation switches restore nested positions and ignore hidden scroll events', async () => {
        await load();
        const restored = await page.evaluate(async () => {
            const earlier = document.querySelector('#older .reasoning-thought-content');
            earlier.scrollTop = 85;
            root.scrollTop = 90;
            controller.pause(earlier);
            controller.capture();
            const other = document.createElement('section');
            other.innerHTML = '<div class="message message-bot" style="height:1900px">Other conversation</div>';
            root.append(other);
            thread.style.display='none';
            controller.activate('other',other);
            await settled();
            const otherTop = root.scrollTop;
            controller.schedule('chat');
            earlier.dispatchEvent(new Event('scroll'));
            await settled();
            const unchanged = otherTop === root.scrollTop;
            other.style.display='none';
            thread.style.display='';
            controller.activate('chat',thread);
            await settled();
            return {unchanged,top:root.scrollTop,nested:earlier.scrollTop,mode:controller.views.get('chat').mode};
        });
        assert.deepEqual(restored,{unchanged:true,top:90,nested:85,mode:'paused'});
    });

    await t.test('streaming catches up and a real wheel interruption stays put', async () => {
        await load();
        await page.evaluate(async () => {
            for (let i=0;i<12;i++) {
                document.querySelector('.spacer').style.height=`${1100+i*80}px`;
                document.querySelector('#latest .reasoning-thought-content').append('More tokens\n'.repeat(10));
                controller.schedule('chat');
                await new Promise(requestAnimationFrame);
            }
            await settled();
        });
        assert.ok(await page.evaluate(() => controller.scopes().every(node => controller.gap(node) < 2)));
        await page.mouse.move(640, 400);
        await page.mouse.wheel({deltaY:-240});
        await page.waitForFunction(() => controller.views.get('chat').mode === 'paused');
        await page.evaluate(() => settled());
        const before = await page.evaluate(() => root.scrollTop);
        await page.evaluate(async () => {
            document.querySelector('.spacer').style.height='2600px';
            controller.schedule('background');
            await settled();
        });
        assert.equal(await page.evaluate(() => root.scrollTop), before);
        assert.equal(await page.$eval('#chat-jump-latest', node => node.hidden), false);
        await page.click('#chat-jump-latest');
        await page.evaluate(() => settled());
        assert.ok(await page.evaluate(() => controller.gap(root) < 2));
    });

    await t.test('system accent reaches arrow, border and focus in both themes', async () => {
        await load();
        for (const dark of [false,true]) {
            for (const width of [1280,390]) {
                await page.setViewport({width,height:844});
                await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
                await page.evaluate(async dark => {
                    document.body.classList.toggle('dark-mode',dark);
                    appearanceListeners['system-appearance']({accentColor:'#0078d4',dark});
                    controller.pause(root);
                    root.scrollTop=100;
                    await settled();
                },dark);
                await page.focus('#chat-jump-latest');
                const state = await page.$eval('#chat-jump-latest', node => {
                    const style=getComputedStyle(node), icon=getComputedStyle(node.querySelector('i'));
                    const b=node.getBoundingClientRect(),c=document.getElementById('floating-input-container').getBoundingClientRect();
                    return {color:style.color,icon:icon.color,border:style.borderTopColor,outline:style.outlineColor,
                        fits:b.width>=44 && b.left>=0 && b.right<=innerWidth && b.bottom<c.top && b.top>=0,
                        reduced:style.animationName==='none' && parseFloat(style.transitionDuration)<=0.00001};
                });
                assert.equal(state.color,'rgb(0, 120, 212)');
                assert.equal(state.icon,state.color);
                assert.equal(state.border,state.color);
                assert.equal(state.outline,state.color);
                assert.equal(state.fits,true);
                assert.equal(state.reduced,true);
                await page.screenshot({path:path.join(os.tmpdir(),`aetheria-jump-${dark?'dark':'light'}-${width}.png`)});
            }
        }
        await page.evaluate(() => appearanceListeners['system-appearance']({accentColor:'#d83b01',dark:true}));
        assert.equal(await page.$eval('#chat-jump-latest', node => getComputedStyle(node).color),'rgb(216, 59, 1)');
    });

    await t.test('forget and dispose cancel queued work and release listeners', async () => {
        await load();
        await page.evaluate(async () => {
            controller.schedule();
            controller.forget('chat');
            await settled();
        });
        assert.equal(await page.evaluate(() => controller.frame),null);
        assert.equal(await page.$eval('#chat-jump-latest', node => node.hidden),true);
        const disposed = await page.evaluate(async () => {
            controller.activate('chat',thread);
            controller.schedule();
            controller.dispose();
            controller.schedule();
            root.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));
            thread.querySelector('.message-content').append('A late update');
            await settled();
            return {frame:controller.frame,intent:controller.intent,views:controller.views.size};
        });
        assert.deepEqual(disposed,{frame:null,intent:null,views:0});
    });
    assert.deepEqual(errors,[]);
});
