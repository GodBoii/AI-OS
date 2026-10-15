const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => file && fs.existsSync(file));

function excerpt(source, start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing production code: ${start}`);
    return source.slice(from, to);
}

test('search links work live, in history and after recovery without fetching collapsed icons', { skip: !executablePath }, async t => {
    const server = http.createServer((request, response) => {
        if (/^\/(js|css)\//.test(request.url)) {
            response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
            response.end(fs.readFileSync(path.join(root, request.url)));
        } else response.end(`<!doctype html><meta charset="utf-8">
            <link rel="stylesheet" href="/css/chat-messages.css">
            <style>:root{--text-color:#20252c;--text-secondary:#555;--border-color:#aaa;--hover-bg:#eee;--accent-color:#265bb6}
            *{animation:none!important;transition:none!important}
            body{margin:20px;font:15px Arial}.message{max-width:750px;margin:auto}
            .tool-log-entry{width:100%;box-sizing:border-box;animation:none}.fas.fa-globe::before{content:'◎'}
            .dark-mode{background:#16191f;--text-color:#eee;--text-secondary:#bbb;--border-color:#555;--hover-bg:#333}</style>
            <div class="message message-bot expanded" data-stream-message-id="message"><div class="detailed-logs"></div></div>
            <div id="saved"></div>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    t.after(async () => {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    browser = await puppeteer.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const errors = [];
    const iconRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (request.url().startsWith('https://') && request.url().endsWith('/favicon.ico')) {
            iconRequests.push(request.url());
            if (request.url().includes('missing.example')) return void request.respond({ status: 404 });
            return void request.respond({ status: 200, contentType: 'image/png',
                body: fs.readFileSync(path.join(__dirname, 'fixtures/generated-image.png')) });
        }
        void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => Object.assign(window, await import('/js/chat-activity.js')));
    const source = fs.readFileSync(path.join(root, 'js/chat.js'), 'utf8').replace(/\r\n/g, '\n');
    const renderer = fs.readFileSync(path.join(root, 'js/renderer.js'), 'utf8').replace(/\r\n/g, '\n');
    const clickStart = renderer.lastIndexOf("        document.addEventListener('click'", renderer.indexOf("const link = event.target?.closest?.('a[href]')"));
    const clickEnd = renderer.indexOf('\n        });', clickStart) + '\n        });'.length;
    await page.addScriptTag({ content: `
        let currentConversationId='chat', handleToolActivity;
        const ongoingStreams={message:{conversationId:'chat'}};
        const seenActivityEvents=new WeakMap();
        const questionCards={mount(){},reattach(){}};
        const artifactHandler=null;
        const messageFormatter={format:value=>escapeToolPreviewHtml(value),finishStreamingForAllOwners(){}};
        function getStreamMessageDiv(){return document.querySelector('[data-stream-message-id="message"]')}
        function getStreamConversationId(){return 'chat'}
        function getDelegationLogContainer(message){return message.querySelector('.detailed-logs')}
        function autoScrollIfSticky(){} function updateReasoningSummary(){}
        function isProjectWorkspaceMode(){return false} function isConversationActive(){return true}
        function mountThinkingOrbs(){} function destroyThinkingOrbs(){} function setThinkingOrbsPaused(){}
        function addMessageActionButtons(){} function bindReasoningSummary(){}
        function escapeReasoningHtml(value){return escapeToolPreviewHtml(value)}
        function normalizeReasoningText(value){return value}
        const ipcRenderer={on:(name,fn)=>{window[name]=fn},send:(...args)=>{window.opened=args}};
        ${excerpt(source, 'function acceptActivityEvent(', 'function scrollActiveConversationToBottom(')}
        ${excerpt(source, 'function bindToolPreviewToggle(', 'function updateConversationStateForActiveThread(')}
        ${excerpt(source, 'function escapeToolPreviewHtml(', 'function normalizeDelegatedAgent(')}
        ${excerpt(source, 'function renderTurnFromEvents(', '/**\n * Extracts conversation history')}
        ${excerpt(source, "    ipcRenderer.on('agent-step'", "    ipcRenderer.on('reasoning-step'")}
        ${excerpt(source, "    ipcRenderer.on('run-catchup'", "    ipcRenderer.on('assistant-response-reset'")}
        ${renderer.slice(clickStart, clickEnd)}
        window.searchEvents=[];
    ` });
    const links = Array.from({ length: 7 }, (_, index) => ({ url: `https://${index === 1 ? 'missing' : 'source' + index}.example/page?q=one&sort=two` }));
    await page.evaluate(async links => {
        const tool = { tool_call_id:'search-one', tool_name:'web_search', tool_output:{ok:true,
            metadata:{kind:'web_search_tool_output',preview_type:'link_list',state:'ready',inline:{links}}} };
        const start = {id:'message',type:'tool_start',name:'web_search',agent_name:'Assistant',tool_call_id:'search-one'};
        const end = {...start,type:'tool_end',tool};
        window.searchEvents=[start,end];
        await window['agent-step'](start);
        await window['agent-step'](end);
    }, links);
    assert.equal(await page.$$eval('.tool-preview-search li:not([hidden])', nodes => nodes.length), 5);
    assert.equal(await page.$eval('.tool-log-action', node => node.textContent), 'Searched the web');
    assert.equal(await page.$eval('.tool-search-count', node => node.textContent), '7 links');
    assert.equal(await page.$eval('.tool-log-header', node => node.getAttribute('aria-controls')),
        await page.$eval('.tool-log-preview-container', node => node.id));
    assert.equal(await page.$eval('.tool-log-preview-container', node => node.inert), true);
    assert.equal(iconRequests.length, 0);
    await page.evaluate(() => {
        const link = document.querySelector('.tool-search-url').parentElement;
        link.focus();
        window.collapsedLinkFocused = document.activeElement === link;
    });
    assert.equal(await page.evaluate(() => window.collapsedLinkFocused), false);
    await page.click('.tool-log-header');
    assert.equal(await page.$eval('.tool-log-entry', node => node.classList.contains('preview-expanded')), true);
    await page.waitForFunction(() => document.querySelectorAll('.tool-search-icon.has-favicon').length === 4
        && document.querySelector('.tool-preview-search li:nth-child(2) img').hidden, { timeout: 5000 }).catch(async error => {
        t.diagnostic(JSON.stringify({ iconRequests, errors, state: await page.$$eval('.tool-preview-search img', images =>
            images.map(image => ({ src: image.getAttribute('src'), hidden:image.hidden, loaded:image.complete,
                width:image.naturalWidth, parent:image.parentElement.className }))) }));
        throw error;
    });
    assert.equal(iconRequests.length, 5);
    assert.equal(await page.$eval('.tool-log-preview-container', node => node.inert), false);
    await page.click('.tool-preview-search li:first-child .tool-search-icon img');
    assert.deepEqual(await page.evaluate(() => window.opened), ['open-webview', links[0].url]);
    await page.focus('.tool-search-show-all');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.tool-search-icon.has-favicon').length === 6);
    assert.equal(iconRequests.length, 7);
    assert.equal(await page.$$eval('.tool-preview-search li:not([hidden])', nodes => nodes.length), 7);
    assert.equal(await page.$eval('.tool-search-show-all', node => node.textContent), 'Show fewer');
    assert.equal(await page.$eval('.tool-search-show-all', node => document.activeElement === node), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.$$eval('.tool-preview-search li:not([hidden])', nodes => nodes.length), 5);
    assert.equal(await page.$eval('.tool-search-show-all', node => node.getAttribute('aria-expanded')), 'false');
    await page.keyboard.press('Enter');
    assert.equal(iconRequests.length, 7);
    await page.click('.tool-log-header');
    await page.click('.tool-log-header');
    assert.equal(iconRequests.length, 7);

    const states = await page.evaluate(async () => {
        const empty = getComputerToolMetadata({tool_name:'web_search',tool_output:'[]'});
        const broken = getComputerToolMetadata({tool_name:'web_search',tool_output:'[broken'});
        const failed = getComputerToolMetadata({tool_name:'search_news',tool_output:'Provider error',tool_call_error:true});
        const mobile = getComputerToolMetadata({tool_name:'web_search',tool_output:{status:'success',action:'web_search'}});
        const legacy = getComputerToolMetadata({tool_name:'search_news',tool_output:JSON.stringify([
            {url:'https://example.com/',body:'Never show this snippet',title:'Never show this title'},
            {url:'https://EXAMPLE.com:443/'},{url:'javascript:alert(1)'},{url:'https://user:pass@example.com/'},
            {url:'https://example.com/other'},{url:'https://example.com\\evil/'}])});
        return {empty:await buildToolPreviewMarkup(empty),broken:await buildToolPreviewMarkup(broken),
            failed:await buildToolPreviewMarkup(failed),mobile,legacy,
            markup:await buildToolPreviewMarkup(legacy),
            sheets:await buildToolPreviewMarkup({kind:'google_sheets_tool_output',preview_type:'sheet_info',inline:{row_count:3}})};
    });
    assert.match(states.empty, /No results found/);
    assert.match(states.broken, /Search results unavailable/);
    assert.match(states.failed, /Search failed/);
    assert.equal(states.mobile, null);
    assert.equal(states.legacy.inline.links.length, 2);
    assert.doesNotMatch(states.markup, /Never show|javascript:|user:pass/);
    assert.match(states.sheets, /tool-preview-sheets/);

    await page.evaluate(async () => {
        for (const call of ['two','three']) await window['agent-step']({id:'message',name:'web_search',type:'tool_start',tool_call_id:call});
        for (const call of ['three','two']) await window['agent-step']({id:'message',name:'web_search',type:'tool_end',tool_call_id:call,
            tool:{tool_output:JSON.stringify([{href:'https://example.com/'+call,body:'secret'}])}});
    });
    assert.deepEqual(await page.$$eval('.tool-log-entry .tool-search-url', nodes => nodes.slice(-2).map(node => node.textContent)),
        ['https://example.com/two', 'https://example.com/three']);
    const requestsBeforeReplay = iconRequests.length;
    await page.evaluate(() => {
        renderTurnFromEvents(document.getElementById('saved'), {content:'Saved answer',events:[
            {event:'ToolCallCompleted',tool:{tool_name:'duckduckgo_search',tool_call_id:'old',
                result:JSON.stringify([{href:'https://archive.example/page',body:'Hidden history snippet'}])}}]});
        window['run-catchup']({messageId:'message',conversationId:'chat',content:'Recovered answer',events:window.searchEvents});
    });
    await page.waitForSelector('#saved .tool-search-url');
    await page.waitForSelector('[data-stream-message-id="message"] .tool-search-url');
    assert.equal(await page.$eval('#saved .tool-search-url', node => node.textContent), 'https://archive.example/page');
    assert.equal(await page.$eval('[data-stream-message-id="message"] .tool-log-header', node => node.getAttribute('aria-expanded')), 'false');
    assert.equal(iconRequests.length, requestsBeforeReplay);
    assert.doesNotMatch(await page.$eval('#saved', node => node.textContent), /Hidden history snippet/);

    await page.click('[data-stream-message-id="message"] .tool-log-header');
    // Exercise the production motion after deterministic interaction checks.
    await page.evaluate(() => {
        const sheet = [...document.styleSheets].find(sheet => sheet.ownerNode.tagName === 'STYLE');
        const index = [...sheet.cssRules].findIndex(rule => rule.selectorText === '*');
        if (index >= 0) sheet.deleteRule(index);
    });
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
    assert.equal(await page.$eval('.tool-log-search .tool-log-preview-container', node => getComputedStyle(node).transitionDuration), '0.25s, 0.25s');
    await page.click('[data-stream-message-id="message"] .tool-log-header');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-stream-message-id="message"] .tool-log-preview-container')).gridTemplateRows === '0px');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-stream-message-id="message"] .tool-log-preview-container')).opacity === '1');
    await page.hover('[data-stream-message-id="message"] .tool-preview-search a');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-stream-message-id="message"] .tool-search-outward')).opacity === '1');
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    assert.equal(await page.$eval('.tool-log-search .tool-log-preview-container', node => getComputedStyle(node).transitionDuration), '0s');
    assert.equal(await page.$eval('.tool-log-search .tool-preview-search li', node => getComputedStyle(node).animationName), 'none');

    const device = await page.createCDPSession();
    for (const width of [1440, 390]) {
        await page.setViewport({ width, height: 900 });
        await device.send('Emulation.setTouchEmulationEnabled', { enabled: width === 390, maxTouchPoints: 1 });
        if (width === 390) assert.equal(await page.$eval('.tool-preview-search a', node => getComputedStyle(node).minHeight), '44px');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const dark of [false, true]) {
            await page.evaluate(dark => document.body.classList.toggle('dark-mode', dark), dark);
            if (process.env.SEARCH_PREVIEW_SCREENSHOTS) {
                fs.mkdirSync(process.env.SEARCH_PREVIEW_SCREENSHOTS, { recursive: true });
                await page.screenshot({ path:path.join(process.env.SEARCH_PREVIEW_SCREENSHOTS, `search-${dark ? 'dark' : 'light'}-${width}.png`) });
            }
        }
    }
    assert.deepEqual(errors, []);
});
