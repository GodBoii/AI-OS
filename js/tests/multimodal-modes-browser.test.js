const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '../..');
const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium']
    .find(file => file && fs.existsSync(file));

function excerpt(source, start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a, start);
    return source.slice(a, b);
}

test('all composer modes accept mixed media and Plan forwards every attachment', { skip: !executablePath }, async t => {
    const html = fs.readFileSync(path.join(root, 'chat.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/js/') || req.url.startsWith('/css/')) {
            const file = path.resolve(root, `.${req.url}`);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return void res.writeHead(404).end();
            res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
            res.end(fs.readFileSync(file));
        } else res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/design-system.css"><link rel="stylesheet" href="/css/chat.css"><link rel="stylesheet" href="/css/attachments.css">${html}`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const browser = await puppeteer.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const chat = fs.readFileSync(path.join(root, 'js/chat.js'), 'utf8');
    assert.match(chat, /new FileAttachmentHandler\(null, supportedFileTypes, maxFileSize\)/);
    await page.evaluate(async () => { window.FileAttachmentHandler = (await import('/js/add-files.js')).default; });
    await page.addScriptTag({ content: `
        let currentConversationId='media', ultraThinkEnabled=false, planModeEnabled=false;
        let planGenerationInProgress=false, pendingPlanRequestId, pendingPlanMessageId;
        let connectionStatus=true;
        const conversationPrimaryRoutes=new Map();
        const contextHandler={getSelectedSessions:()=>[]};
        const ipcRenderer={send:(channel,payload)=>window.sent.push({channel,payload})};
        window.sent=[];window.notices=[];window.alerts=[];
        window.alert=message=>window.alerts.push(message);
        function showNotification(message){window.notices.push(message)}
        function updatePrimaryComposerAction(){} function addUserMessage(){}
        function createBotMessagePlaceholder(){} function appendReasoningContent(){}
        function appendPlanModeToolLog(){} function setPlanGenerating(value){planGenerationInProgress=value}
        function resolveWorkspaceContextPayload(){return {}} function buildOutgoingAgentConfig(){return {}}
        window.electron={auth:{getSession:async()=>({access_token:'fixture-token'})},
            fileArchive:{saveFile:async file=>({relativePath:file.name})}};
        const fileAttachmentHandler=new FileAttachmentHandler(null,undefined,50*1024*1024);
        fileAttachmentHandler.uploadFileToServer=async file=>'owner/'+file.name;
        ${excerpt(chat, 'function getConversationPrimaryRoute()', 'function setCurrentConversationId(')}
        ${excerpt(chat, 'function setPlanModeEnabled(', 'function setPlanGenerating(')}
        ${excerpt(chat, 'async function requestPlanFromAgent()', 'function submitApprovedPlan(')}
        document.getElementById('floating-input-container').classList.remove('hidden');
        window.exerciseMode=async (plan,ultra)=>{
            conversationPrimaryRoutes.clear();ultraThinkEnabled=false;planModeEnabled=false;planGenerationInProgress=false;
            fileAttachmentHandler.clearAttachedFiles();
            setPlanModeEnabled(plan);setUltraThinkEnabled(ultra);
            await fileAttachmentHandler.handleFileSelection({target:{files:[
                new File(['image'], 'photo.png', {type:'image/png'}),
                new File(['audio'], 'recording.wav', {type:'audio/wav'}),
                new File(['video'], 'clip.mp4', {type:'video/mp4'}),
                new File(['Full attachment text'], 'notes.txt', {type:'text/plain'})
            ]}});
            commitPrimaryRouteForSend();
            if(plan){document.getElementById('floating-input').value='Plan using these files';await requestPlanFromAgent()}
            return {mode:getComposerVisualMode(),files:fileAttachmentHandler.getAttachedFiles().map(f=>({name:f.name,status:f.status,content:f.content})),
                notices:window.notices,alerts:window.alerts,payload:window.sent.at(-1)?.payload};
        };
        window.enableAfterLegacyVideo=()=>{conversationPrimaryRoutes.set(currentConversationId,'video');ultraThinkEnabled=false;
            syncUltraThinkButton();const locked=document.getElementById('ultra-think-btn').getAttribute('aria-disabled');
            return {locked,enabled:setUltraThinkEnabled(true)}};
    ` });
    for (const [plan, ultra, name] of [[false,false,'standard'],[false,true,'ultra'],[true,false,'plan'],[true,true,'plan-ultra']]) {
        const result = await page.evaluate((plan,ultra)=>window.exerciseMode(plan,ultra), plan,ultra);
        assert.equal(result.mode,name);
        assert.equal(result.files.length,4);
        assert.ok(result.files.every(file=>file.status==='completed'));
        assert.equal(result.files[3].content,'Full attachment text');
        assert.deepEqual(result.notices,[]);
        assert.deepEqual(result.alerts,[]);
        if(plan){assert.equal(result.payload.files.length,4);assert.equal(result.payload.thinking_mode,ultra?'ultra':'standard')}
    }
    assert.deepEqual(await page.evaluate(()=>window.enableAfterLegacyVideo()),{locked:'false',enabled:true});
    assert.deepEqual(errors,[]);
});
