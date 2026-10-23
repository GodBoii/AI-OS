const { app, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const BrowserHandler = require('../../browser-handler');
const BrowserSettings = require('../../browser-settings');

app.whenReady().then(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aetheria-browser-window-'));
    const settings = new BrowserSettings(folder);
    settings.update({ visibility: 'background' });
    const handler = new BrowserHandler(new EventEmitter(), folder, async () => null, settings);
    let exitCode = 0;
    try {
        assert.equal((await handler._launchManagedBrowser()).ok, true);
        assert.equal(await handler._waitForBrowserReady(), true);
        await handler.page.goto('about:blank');
        await handler.page.setContent('<title>Takeover fixture</title><input id="draft" value="keep this draft">');
        const browser = handler.browser;
        const page = handler.page;
        assert.equal((await handler.takeControl()).success, true);
        assert.equal(handler.browser, browser);
        assert.equal(handler.page, page);
        assert.equal(await page.$eval('#draft', input => input.value), 'keep this draft');
        const session = await page.createCDPSession();
        const { bounds } = await session.send('Browser.getWindowForTarget');
        const area = screen.getPrimaryDisplay().workArea;
        assert.ok(bounds.left >= area.x && bounds.left < area.x + area.width);
        assert.ok(bounds.top >= area.y && bounds.top < area.y + area.height);
        await session.detach();
        assert.equal(handler.resumeAutomation().success, true);
        process.stdout.write('BROWSER_TAKEOVER_OK\n');
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        await handler.closeBrowser();
        fs.rmSync(folder, { recursive: true, force: true });
        app.exit(exitCode);
    }
});
