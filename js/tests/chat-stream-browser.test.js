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

function excerpt(source, start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start);
    return source.slice(a, b);
}

test('native histories retain intermediate text, repeated tools and delegated ordering', async () => {
    const code = fs.readFileSync(path.join(root, 'js/chat-activity.js'), 'utf8');
    const { buildActivityTimeline } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const timeline = buildActivityTimeline([
        { event: 'RunContent', agent_name: 'AI', content: 'Checking now.' },
        { event: 'ToolCallStarted', agent_name: 'AI', tool: { tool_call_id: 'one', tool_name: 'screenshot' } },
        { event: 'ToolCallCompleted', agent_name: 'AI', tool: { tool_call_id: 'one', tool_name: 'screenshot', result: 'first' } },
        { type: 'reasoning_step', agent_name: 'AI', step: 'Next step.' },
        { type: 'delegation_start', delegation_id: 'child', delegated_agent: 'computer', agent_name: 'AI' },
        { event: 'ToolCallStarted', agent_name: 'Computer', delegation_id: 'child', tool: { tool_call_id: 'two', tool_name: 'screenshot' } },
        { type: 'reasoning_step', agent_name: 'Computer', delegation_id: 'child', step: 'Reading the screenshot.' },
        { event: 'ToolCallCompleted', agent_name: 'Computer', delegation_id: 'child', tool: { tool_call_id: 'two', tool_name: 'screenshot', result: 'second' } },
        { type: 'delegation_end', delegation_id: 'child', success: true },
        { channel: 'response', agent_name: 'AI', content: 'Final answer.', reasoning_content: 'Already emitted', reasoning_emitted: true },
    ], 'AI');
    assert.deepEqual(timeline.entries.map(entry => entry.kind), ['message', 'tool', 'reasoning', 'delegation', 'tool', 'reasoning']);
    assert.deepEqual(timeline.entries.filter(entry => entry.kind === 'tool').map(entry => entry.tool.result), ['first', 'second']);
    assert.equal(timeline.entries[3].status, 'completed');
    assert.equal(timeline.response, 'Final answer.');
    assert.deepEqual(buildActivityTimeline(null).entries, []);
    const separate = buildActivityTimeline(['first', 'second'].flatMap(delegation => [
        { type: 'tool_start', agent_name: 'Computer', delegation_id: delegation, tool_call_id: 'same-id', name: 'screenshot' },
        { type: 'tool_end', agent_name: 'Computer', delegation_id: delegation, tool_call_id: 'same-id', name: 'screenshot' },
    ]));
    assert.equal(separate.entries.length, 2);
    assert.notEqual(separate.entries[0].id, separate.entries[1].id);
});

test('ordered tool history and scroll following preserve the reader position', { skip: !executablePath }, async t => {
    const server = http.createServer((request, response) => {
        if (request.url.startsWith('/js/') || request.url.startsWith('/css/') || request.url.startsWith('/node_modules/dompurify/')) {
            response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
            response.end(fs.readFileSync(path.join(root, request.url)));
        } else response.end(`<!doctype html><html><head><meta charset="utf-8">
            <link rel="stylesheet" href="/css/chat-variables.css"><link rel="stylesheet" href="/css/chat-layout.css">
            <link rel="stylesheet" href="/css/chat-messages.css"><style>
            body{margin:0;font:15px Arial;background:#15191f;color:#e5e7eb}
            :root{--window-bg:#20252c;--text-color:#e5e7eb;--text-secondary:#b5bcc6;--accent-color:#93c5fd;--border-color:#626c78;--hover-bg:#303843}
            .hidden{display:none!important}.chat-container{left:50%;width:min(94%,800px);height:calc(100% - 110px)}
            .chat-messages{min-height:0}.message{margin-bottom:20px}.message-user{padding:12px;background:#28323d}
            .floating-input-container{position:fixed;bottom:12px;left:3%;width:94%;height:75px;background:#20252c;border:1px solid #626c78;border-radius:12px}
            .tool-log-preview-image img{max-width:100%}
            </style></head><body class="dark-mode"><div class="chat-container"><div class="chat-window">
            <div id="chat-messages" class="chat-messages" tabindex="-1"><section class="conversation-thread" data-conversation-id="chat">
            <div class="message message-user">Inspect the screen and explain what changed.</div>
            <div class="message message-bot" data-stream-message-id="message" id="message"><div class="thinking-indicator">
            <div class="reasoning-summary" role="button" tabindex="0"><span class="summary-text"></span></div></div>
            <div class="detailed-logs"></div><div class="message-content" id="main-content-message"></div></div></section></div>
            <button id="chat-jump-latest" class="chat-jump-latest" type="button" hidden aria-label="Jump to latest">↓</button></div></div>
            <div class="floating-input-container" id="floating-input-container">Composer</div>
            <script src="/js/vendor/highlight-11.7.0.min.js"></script><script src="/js/vendor/marked-9.1.6.min.js"></script>
            <script src="/node_modules/dompurify/dist/purify.min.js"></script><script src="/js/vendor/mermaid-10.2.4.min.js"></script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
        window.ChatScrollController = (await import('/js/chat-scroll-controller.js')).ChatScrollController;
        Object.assign(window, await import('/js/chat-activity.js'));
        window.formatter = (await import('/js/message-formatter.js')).messageFormatter;
    });
    const source = fs.readFileSync(path.join(root, 'js/chat.js'), 'utf8').replace(/\r\n/g, '\n');
    const helperCode = excerpt(source, 'function getStreamEntry(', 'function hasActiveRunForConversation(')
        + excerpt(source, 'function acceptActivityEvent(', 'function scrollActiveConversationToBottom(')
        + excerpt(source, 'function bindToolPreviewToggle(', 'function updateConversationStateForActiveThread(')
        + excerpt(source, 'function findComputerToolLogEntry(', 'async function persistComputerToolAttachment(')
        + excerpt(source, 'function updateReasoningSummary(', 'function createBotMessagePlaceholder(')
        + excerpt(source, 'function archiveIntermediateResponse(', '/**\n * Adds copy buttons')
        + excerpt(source, 'function addCopyButtonsToCodeBlocks(', '/**\n * Renders a complete assistant turn')
        + excerpt(source, 'function renderTurnFromEvents(', '/**\n * Extracts conversation history');
    await page.addScriptTag({ content: `
        let currentConversationId='chat', handleToolActivity;
        const seenActivityEvents=new WeakMap();
        const messageFormatter=window.formatter;
        const chatScroll=new ChatScrollController(document.getElementById('chat-messages'),document.getElementById('chat-jump-latest'),document.getElementById('floating-input-container'));
        window.controller=chatScroll;
        chatScroll.activate('chat',document.querySelector('.conversation-thread'));
        function autoScrollIfSticky(id='chat'){chatScroll.schedule(id)}
        const ongoingStreams={message:{conversationId:'chat',element:document.getElementById('message')}};
        function getChatMessagesRoot(){return document.getElementById('chat-messages')}
        const conversationViews={prune:async()=>{}};
        function setThinkingOrbsPaused(){} function checkAndShowContentButton(){} function updatePrimaryComposerAction(){}
        function getDelegationLogContainer(message){return message.querySelector('.detailed-logs')}
        function isProjectWorkspaceMode(){return false}
        function isConversationActive(){return true}
        function mountThinkingOrbs(){} function destroyThinkingOrbs(){} function addMessageActionButtons(){}
        const questionCards={mount(){}};
        function getComputerToolMetadata(tool){return tool?.tool_output?.metadata || null}
        function renderToolPreviewPlaceholder(metadata){return '<span class="saved-preview">'+metadata.output_id+'</span>'}
        function hydrateComputerToolPreviews(){}
        async function attachComputerToolPreview(row,metadata){
            row.dataset.outputId=metadata.output_id; row.classList.add('has-preview');
            row.querySelector('.tool-log-preview-inner').textContent=metadata.output_id;
        }
        async function persistComputerToolAttachment(){}
        function parseMaybeJson(value){return value}
        const ipcRenderer={on:(name,fn)=>{window[name]=fn}};
        ${helperCode}
        ${excerpt(source, "    ipcRenderer.on('agent-step'", "    ipcRenderer.on('reasoning-step'")}
        ${excerpt(source, "    ipcRenderer.on('chat-response'", '    const handleGeneratedMediaEvent =')}
        ${excerpt(source, "    ipcRenderer.on('run-catchup'", "    ipcRenderer.on('assistant-response-reset'")}
        ${excerpt(source, "    ipcRenderer.on('computer-tool-result-preview'", "    ipcRenderer.send('check-socket-connection'")}
        window.reason=appendReasoningContent;
        window.populate=populateBotMessage;
        window.archive=archiveIntermediateResponse;
        window.renderSaved=renderTurnFromEvents;
        bindReasoningSummary(document.querySelector('.reasoning-summary'),getStreamMessageDiv('message')); 
    ` });
    const timeline = await page.evaluate(async () => {
        const event = (type, id) => ({ id:'message', type, name:'take_screenshot', agent_name:'Aetheria_AI',
            tool_call_id:id, tool:{ tool_call_id:id, tool_output:{ metadata:{kind:'computer_tool_output',output_id:'screen-'+id} } } });
        reason('message',{content:'Before tools. ',delta:true});
        await window['agent-step'](event('tool_start','one'));
        await window['agent-step'](event('tool_end','one'));
        reason('message',{content:'After first screenshot. ',delta:true});
        for(const id of ['two','three']) await window['agent-step'](event('tool_start',id));
        await window['agent-step'](event('tool_end','three'));
        await window['agent-step'](event('tool_end','two'));
        reason('message',{content:'After third screenshot. ',delta:true});
        populate({id:'message',content:'Intermediate **response**.',agent_name:'Aetheria_AI'});
        archive(getStreamMessageDiv('message')); 
        await window['agent-step']({...event('tool_start','four'),event_id:'unique-start'});
        await window['agent-step']({...event('tool_start','four'),event_id:'unique-start'});
        populate({id:'message',content:'Final **answer**.',agent_name:'Aetheria_AI'});
        const logs=document.querySelector('.detailed-logs');
        return {order:[...logs.children].map(node=>node.classList.contains('reasoning-thought-block')?'thinking':node.classList.contains('tool-log-entry')?'tool':'message'),
            tools:logs.querySelectorAll('.tool-log-entry').length,previews:[...logs.querySelectorAll('[data-output-id]')].map(node=>node.dataset.outputId),
            final:document.querySelector('.message-content').textContent,summary:document.querySelector('.summary-text').textContent};
    });
    assert.deepEqual(timeline.order,['thinking','tool','thinking','tool','tool','thinking','message','tool']);
    assert.equal(timeline.tools,4);
    assert.deepEqual(timeline.previews,['screen-one','screen-two','screen-three']);
    assert.match(timeline.final,/Final answer/);
    assert.match(timeline.summary,/4 tools/);
    await page.click('.reasoning-summary');
    await page.evaluate(()=>reason('message',{content:'Reader collapsed the dropdown.',delta:true}));
    assert.equal(await page.$eval('#message',node=>node.classList.contains('expanded')),false);
    await page.click('.reasoning-summary');

    await page.evaluate(()=>{
        reason('message',{content:'More reasoning tokens\n'.repeat(200),delta:true});
        controller.resume();
    });
    await page.waitForFunction(()=>{
        const node=document.querySelector('.reasoning-thought-block:last-child .reasoning-thought-content');
        return node && node.scrollHeight-node.clientHeight-node.scrollTop<2;
    });
    await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('.detailed-logs')).maxHeight)>=innerHeight*0.6-0.5);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const reasoning = await page.$('.reasoning-thought-block:last-child .reasoning-thought-content');
    await reasoning.hover();
    await page.mouse.wheel({deltaY:-180});
    await page.waitForFunction(()=>controller.views.get('chat').mode==='paused',{timeout:5000}).catch(async error=>{
        const state=await page.evaluate(()=>({mode:controller.views.get('chat').mode,intent:controller.intent?.target.className,boxes:[...document.querySelectorAll('.reasoning-thought-content')].map(n=>({top:n.scrollTop,height:n.clientHeight,total:n.scrollHeight,rect:n.getBoundingClientRect().toJSON()}))}));
        await page.screenshot({path:path.join(os.tmpdir(),'aetheria-chat-scroll-failure.png')});
        throw new Error(error.message+' '+JSON.stringify(state));
    });
    const before = await reasoning.evaluate(node=>node.scrollTop);
    await page.evaluate(()=>reason('message',{content:'Streaming while reader is paused\n'.repeat(50),delta:true}));
    await page.waitForFunction(()=>!document.getElementById('chat-jump-latest').hidden);
    assert.equal(await reasoning.evaluate(node=>node.scrollTop),before);
    await page.focus('#chat-jump-latest');
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>controller.views.get('chat').mode==='following' && document.getElementById('chat-jump-latest').hidden);
    await page.evaluate(()=>{
        for(let i=0;i<15;i++) populate({id:'message',content:'Final response continues\n\n'.repeat(12),agent_name:'Aetheria_AI'});
    });
    await page.waitForFunction(()=>{const n=document.getElementById('chat-messages');return n.scrollHeight-n.clientHeight-n.scrollTop<2});
    await page.hover('#main-content-message');
    await page.mouse.wheel({deltaY:-250});
    await page.waitForFunction(()=>controller.views.get('chat').mode==='paused');
    const top = await page.$eval('#chat-messages',node=>node.scrollTop);
    await page.evaluate(()=>populate({id:'message',content:'Last tokens\n\n'.repeat(15),agent_name:'Aetheria_AI'}));
    await page.waitForFunction(()=>!document.getElementById('chat-jump-latest').hidden);
    assert.equal(await page.$eval('#chat-messages',node=>node.scrollTop),top);

    for(const viewport of [{width:1280,height:800},{width:390,height:844}]) {
        await page.setViewport(viewport);
        await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
        await page.waitForFunction(()=>!document.getElementById('chat-jump-latest').hidden);
        const fits=await page.evaluate(()=>{
            const b=document.getElementById('chat-jump-latest').getBoundingClientRect();
            const c=document.getElementById('floating-input-container').getBoundingClientRect();
            return b.width>=44 && b.left>=0 && b.right<=innerWidth && b.bottom<c.top && document.documentElement.scrollWidth<=innerWidth;
        });
        assert.equal(fits,true);
        await page.screenshot({path:path.join(os.tmpdir(),`aetheria-chat-stream-${viewport.width}.png`)});
    }
    await page.click('#chat-jump-latest');
    await page.waitForFunction(()=>document.getElementById('chat-jump-latest').hidden);
    const replay=await page.evaluate(()=>{
        const events=[{channel:'reasoning_step',step:'First',agent_name:'AI',sequence:1,event_id:'1'},
            {channel:'agent_step',type:'tool_start',name:'screenshot',tool_call_id:'a',sequence:2,event_id:'2'},
            {channel:'reasoning_step',step:'Second',agent_name:'AI',sequence:3,event_id:'3'},
            {channel:'agent_step',type:'tool_end',name:'screenshot',tool_call_id:'a',tool:{tool_output:{metadata:{output_id:'first-image'}}},sequence:4,event_id:'4'},
            {channel:'agent_step',type:'tool_start',name:'screenshot',tool_call_id:'b',sequence:5,event_id:'5'},
            {channel:'agent_step',type:'tool_end',name:'screenshot',tool_call_id:'b',tool:{tool_output:{metadata:{output_id:'second-image'}}},sequence:6,event_id:'6'}];
        const host=document.createElement('div');
        renderSaved(host,{metadata:{activity_events:[...events,events[1]]},content:'Saved final answer'});
        return {order:[...host.querySelector('.detailed-logs').children].map(n=>n.className),previews:[...host.querySelectorAll('.saved-preview')].map(n=>n.textContent)};
    });
    assert.deepEqual(replay.order,['reasoning-thought-block','tool-log-entry has-preview','reasoning-thought-block','tool-log-entry has-preview']);
    assert.deepEqual(replay.previews,['first-image','second-image']);
    const completion=await page.evaluate(async()=>{
        await window['chat-response']({id:'message',done:true,event_id:'done'});
        const node=getStreamMessageDiv('message');
        return {buffers:formatter.pendingContent.size,final:node.querySelector('.message-content').textContent,formatted:!!node.querySelector('.message-content strong')};
    });
    assert.equal(completion.buffers,0);
    assert.equal(completion.formatted,true);
    assert.match(completion.final,/Last tokens/);
    const latePreview = await page.evaluate(async () => {
        const first = document.querySelector('.tool-log-entry[data-tool-call-id="one"]');
        await window['computer-tool-result-preview']({id:'message', tool_name:'take_screenshot', invocation_id:first.dataset.invocationId,
            metadata:{kind:'computer_tool_output',output_id:'late-first-image'}});
        return [...document.querySelectorAll('.tool-log-entry[data-output-id]')].map(node=>node.dataset.outputId);
    });
    assert.deepEqual(latePreview,['late-first-image','screen-two','screen-three']);
    const catchup=await page.evaluate(()=>{
        const answers=document.createElement('form');answers.className='agent-question-card';answers.textContent='Your saved answers';
        getStreamMessageDiv('message').appendChild(answers);
        window['run-catchup']({messageId:'message',conversationId:'chat',content:'Recovered final',events:[
            {channel:'reasoning_step',step:'Before',event_id:'replay-1'},
            {channel:'agent_step',type:'tool_start',name:'screenshot',tool_call_id:'r1',event_id:'replay-2'},
            {channel:'agent_step',type:'tool_end',name:'screenshot',tool_call_id:'r1',tool:{tool_output:{metadata:{output_id:'recovered-image'}}},event_id:'replay-3'}]});
        const node=getStreamMessageDiv('message');
        node.querySelector('.reasoning-summary').click();
        return {final:node.querySelector('.message-content').textContent,preview:node.querySelector('.saved-preview').textContent,expanded:node.classList.contains('expanded'),answers:node.querySelector('.agent-question-card')===answers};
    });
    assert.match(catchup.final,/Recovered final/);
    assert.equal(catchup.preview,'recovered-image');
    assert.equal(catchup.expanded,false);
    assert.equal(catchup.answers,true);
    const switched=await page.evaluate(async()=>{
        const root=document.getElementById('chat-messages'),first=document.querySelector('.conversation-thread');
        first.classList.remove('hidden');
        root.scrollTop=10; controller.pause(root);
        const second=document.createElement('section');second.className='conversation-thread';second.innerHTML='<div class="message message-bot" style="height:1800px">Background</div>';
        root.append(second);first.classList.add('hidden');controller.activate('other',second);
        await new Promise(requestAnimationFrame);
        const otherTop=root.scrollTop;
        controller.schedule('chat');await new Promise(requestAnimationFrame);
        const unchanged=root.scrollTop===otherTop;
        second.classList.add('hidden');first.classList.remove('hidden');controller.activate('chat',first);
        await new Promise(requestAnimationFrame);
        const restored=controller.views.get('chat').mode;
        controller.reassign('chat','recovered');
        return {unchanged,restored,id:controller.id};
    });
    assert.equal(switched.unchanged,true);
    assert.equal(switched.restored,'paused');
    assert.equal(switched.id,'recovered');
    assert.deepEqual(errors,[]);
});
