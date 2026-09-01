// browser-handler.js

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const net = require('net');
const axios = require('axios');
const electron = require('electron');
const config = require('./config');

// JPEG quality for the page images handed to the model. High enough that small
// text stays legible, low enough that a view stays well under 100KB on the round
// trip through storage. Not user-facing: lowering it degrades what the agent can
// read, and raising it only costs latency.
const SCREENSHOT_QUALITY = 72;

// Bounds for the headless viewport. The floor keeps desktop layouts from
// collapsing to a mobile breakpoint; the ceiling stops a 4K display from
// producing screenshots that cost upload time and tokens for no extra detail.
const HEADLESS_VIEWPORT = { minWidth: 1280, maxWidth: 1920, minHeight: 720, maxHeight: 1080 };

/**
 * Collapses raw cookie records into one entry per site.
 *
 * A single login scatters cookies across several hosts (`.google.com`,
 * `accounts.google.com`, `mail.google.com`), which would list the same account
 * three times. Grouping under the shortest domain that is a suffix of the others
 * fixes that without a public suffix list: browsers refuse cookies set on a bare
 * public suffix, so the shortest domain actually present is the real site. Sorting
 * by length first guarantees a parent is created before any of its children.
 */
function groupCookiesBySite(cookies) {
    const counts = new Map();
    for (const cookie of cookies) {
        const host = cookie.domain.replace(/^\./, '').replace(/^www\./, '');
        if (host) counts.set(host, (counts.get(host) || 0) + 1);
    }

    const sites = new Map();
    for (const host of [...counts.keys()].sort((a, b) => a.length - b.length)) {
        const parent = [...sites.keys()].find((site) => host === site || host.endsWith(`.${site}`));
        const key = parent || host;
        sites.set(key, (sites.get(key) || 0) + counts.get(host));
    }

    return [...sites]
        .map(([domain, cookies]) => ({ domain, cookies }))
        .sort((a, b) => a.domain.localeCompare(b.domain));
}

class BrowserHandler {
    constructor(eventEmitter, appDataPath, getAuthTokenFunc, settings) {
        this.eventEmitter = eventEmitter;
        this.appDataPath = appDataPath;
        this.getAuthToken = getAuthTokenFunc;
        this.settings = settings;

        this.managedBrowserProcess = null;
        this.browser = null;
        this.page = null;
        this.isConnected = false;
        this.debugPort = 9222;
        this.connectPromise = null;
        this.commandQueue = Promise.resolve();
        this.isProcessingCommand = false;
        this.idleTimer = null;
        // Set while a user-initiated sign-in window is open so the idle reaper
        // cannot close Chrome out from under someone entering a password.
        this.signInPending = false;
    }

    async _uploadScreenshot(screenshotBase64) {
        try {
            const token = await this.getAuthToken();
            if (!token) {
                throw new Error("Authentication token not available for screenshot upload.");
            }

            const imageBuffer = Buffer.from(screenshotBase64, 'base64');
            const fileName = `screenshot-${Date.now()}.jpg`;

            const urlResponse = await axios.post(
                `${config.backend.url}/api/generate-upload-url`,
                { fileName },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const { signedURL, path } = urlResponse.data;
            if (!signedURL || !path) {
                throw new Error("Backend did not return a valid signed URL or path.");
            }

            await axios.put(signedURL, imageBuffer, {
                headers: { 'Content-Type': 'image/jpeg' }
            });

            console.log(`Screenshot successfully uploaded to Supabase path: ${path}`);
            return path;

        } catch (error) {
            const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error("Screenshot upload failed:", errorMessage);
            return null;
        }
    }

    _getBrowserPaths() {
        let executablePath;
        try {
            if (process.platform === 'win32') {
                const programFiles = process.env.ProgramW6432;
                const chromePath = path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
                const edgePath = path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
                if (fs.existsSync(chromePath)) executablePath = chromePath;
                else if (fs.existsSync(edgePath)) executablePath = edgePath;
            } else if (process.platform === 'darwin') {
                const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
                const edgePath = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
                if (fs.existsSync(chromePath)) executablePath = chromePath;
                else if (fs.existsSync(edgePath)) executablePath = edgePath;
            } else {
                executablePath = '/usr/bin/google-chrome';
            }
            if (!executablePath || !fs.existsSync(executablePath)) return null;
        } catch (error) {
            console.error('Error getting browser executable path:', error);
            return null;
        }
        const userDataDir = path.join(this.appDataPath, 'aios-browser-profile');
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        return { executablePath, userDataDir };
    }

    async _isPortInUse(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
            server.once('listening', () => {
                server.close();
                resolve(false);
            });
            server.listen(port, '127.0.0.1');
        });
    }

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    _getBrowserUrl() {
        return `http://127.0.0.1:${this.debugPort}`;
    }

    async _resolveDebugPort() {
        if (await this._isPortInUse(this.debugPort)) {
            for (let candidate = 9222; candidate <= 9240; candidate += 1) {
                if (!(await this._isPortInUse(candidate))) {
                    this.debugPort = candidate;
                    return this.debugPort;
                }
            }
            throw new Error('No available remote-debugging port found in range 9222-9240.');
        }
        return this.debugPort;
    }

    async _waitForBrowserReady(timeoutMs = 15000) {
        const started = Date.now();
        while ((Date.now() - started) < timeoutMs) {
            const connected = await this._connect();
            if (connected) {
                return true;
            }
            await this._sleep(400);
        }
        return false;
    }

    async _stabilizeAfterInteraction(timeoutMs = 5000) {
        if (!this.page) return;

        // Try to wait for network to settle, but never fail the action if a page keeps long-lived connections.
        await this.page.waitForNetworkIdle({ idleTime: 500, timeout: timeoutMs }).catch(() => {});
    }

    /**
     * Runs a task only once everything already queued has finished, so nothing
     * ever touches the same page or process concurrently. Both agent commands and
     * user-initiated actions go through here; the sign-in flow closes and
     * relaunches Chrome, which would corrupt a command running at the same time.
     */
    _serialize(task) {
        // Runs on both settle paths so one failed task cannot stall the queue.
        const result = this.commandQueue.then(task, task);
        this.commandQueue = result.then(() => {}, () => {});
        return result;
    }

    _enqueueCommand(commandPayload) {
        this._clearIdleTimer();
        // Reporting and bookkeeping live inside the serialized task so the next
        // queued command cannot start before this one has released the flag.
        this._serialize(async () => {
            this.isProcessingCommand = true;
            try {
                await this.handleCommand(commandPayload);
            } catch (error) {
                const action = commandPayload?.action || 'unknown';
                const requestId = commandPayload?.request_id;
                console.error(`BrowserHandler queue error while processing '${action}':`, error?.message || error);
                if (requestId) {
                    this._emitResult(requestId, { status: 'error', error: `Internal queue error: ${error?.message || String(error)}` });
                }
            } finally {
                this.isProcessingCommand = false;
                // Armed only after the queue drains, so a long run of commands
                // never races the reaper.
                this._touchIdle();
            }
        });
    }

    initialize() {
        this.eventEmitter.on('execute-browser-command', (commandPayload) => {
            this._enqueueCommand(commandPayload);
        });
        console.log('BrowserHandler initialized and listening for commands.');
        const paths = this._getBrowserPaths();
        if (paths) {
            console.log('BrowserHandler: Found browser at:', paths.executablePath);
            console.log('BrowserHandler: Using data directory:', paths.userDataDir);
        } else {
            console.error('BrowserHandler: Could not find browser executable');
        }
    }

    /**
     * Size for headless runs only. A headful window inherits a real size from the
     * desktop, but headless Chrome has no window and falls back to 800x600, which
     * would shrink every screenshot and desync the element bounds the model clicks
     * by. Matching the user's own screen keeps sites rendering the layout they
     * would see themselves.
     */
    _headlessViewport() {
        try {
            const { width, height } = electron.screen.getPrimaryDisplay().workAreaSize;
            return {
                width: Math.min(HEADLESS_VIEWPORT.maxWidth, Math.max(HEADLESS_VIEWPORT.minWidth, width)),
                height: Math.min(HEADLESS_VIEWPORT.maxHeight, Math.max(HEADLESS_VIEWPORT.minHeight, height))
            };
        } catch (error) {
            console.warn('BrowserHandler: could not read display size, using 1440x900:', error.message);
            return { width: 1440, height: 900 };
        }
    }

    /**
     * Chrome bakes these flags in at spawn time, so a visibility change only takes
     * effect on the next launch. main.js closes the running instance when that
     * setting changes so the next command relaunches here.
     */
    _launchArgs(userDataDir, visibility) {
        const args = [
            `--remote-debugging-port=${this.debugPort}`,
            `--user-data-dir=${userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ];

        if (visibility === 'headless') {
            const { width, height } = this._headlessViewport();
            args.push('--headless=new', `--window-size=${width},${height}`);
        } else if (visibility === 'background' && process.platform !== 'darwin') {
            // Real headful Chrome parked outside every display. Keeps the genuine
            // fingerprint and GPU path that makes this tool work on sites that
            // reject headless, without a window covering the user's screen.
            // macOS clamps window positions to the visible desktop, so there it
            // relies on never being brought to front instead.
            args.push('--window-position=-32000,-32000');
        }

        return args;
    }

    /**
     * @param {string} [visibilityOverride] Forces a mode for this launch only,
     *   used by the sign-in flow which always needs a window the user can see.
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async _launchManagedBrowser(visibilityOverride) {
        if (this.managedBrowserProcess) return { ok: true };
        const paths = this._getBrowserPaths();
        if (!paths) {
            return { ok: false, error: 'No Chrome or Edge installation was found on this computer.' };
        }
        await this._resolveDebugPort();
        const visibility = visibilityOverride || this.settings.get().visibility;
        const args = this._launchArgs(paths.userDataDir, visibility);
        console.log(`Launching browser (${visibility}): ${paths.executablePath} ${args.join(' ')}`);
        try {
            this.managedBrowserProcess = spawn(paths.executablePath, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
            this.managedBrowserProcess.stdout.on('data', (data) => console.log(`BrowserHandler (stdout): ${data}`));
            this.managedBrowserProcess.stderr.on('data', (data) => console.error(`BrowserHandler (stderr): ${data}`));
            this.managedBrowserProcess.on('error', (err) => console.error('Failed to start browser process:', err));
            this.managedBrowserProcess.on('close', (code) => {
                console.log(`Browser process exited with code ${code}`);
                this.managedBrowserProcess = null;
                this.isConnected = false;
            });
            console.log('Browser process launched successfully');
            return { ok: true };
        } catch (error) {
            console.error('Error launching browser:', error);
            return { ok: false, error: `Failed to start the browser: ${error.message}` };
        }
    }

    /**
     * Drops the CDP connection and kills Chrome if we own the process. Called by
     * the idle reaper, by settings changes that need a relaunch, and on quit.
     * Safe to call when nothing is running.
     */
    async closeBrowser() {
        this._clearIdleTimer();
        this.signInPending = false;
        if (this.browser) {
            // A disconnect during shutdown is not worth failing the caller over.
            await this.browser.disconnect().catch(() => {});
        }
        this.browser = null;
        this.page = null;
        this.isConnected = false;
        if (this.managedBrowserProcess) {
            this.managedBrowserProcess.kill();
            this.managedBrowserProcess = null;
        }
    }

    _clearIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * Restarts the inactivity countdown. Chrome holds a few hundred MB and, being
     * spawned detached, survives an Electron crash while still owning the debug
     * port, so reaping an unused instance is worth the ~4s relaunch it costs.
     */
    _touchIdle() {
        this._clearIdleTimer();
        this.signInPending = false;
        const minutes = this.settings.get().idleCloseMinutes;
        if (!minutes) return;
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.isProcessingCommand || this.signInPending) return;
            console.log(`BrowserHandler: closing browser after ${minutes} idle minute(s).`);
            this.closeBrowser().catch((error) => console.error('Idle close failed:', error.message));
        }, minutes * 60_000);
    }

    /** Bringing a window forward is only correct when the user asked to see it. */
    async _focusPage() {
        if (!this.page) return;
        if (this.settings.get().visibility !== 'visible') return;
        await this.page.bringToFront().catch(() => {});
    }

    /**
     * Opens the agent's own Chrome profile in a window the user drives, with no
     * agent attached. This is how a signed-in browser gets created without asking
     * the agent to open one first: sign in to Chrome or to any site here, and the
     * profile directory keeps the session for every later run, including hidden mode.
     *
     * @param {string} [url] Optional starting page. Omitted, it just opens the window.
     */
    async openBrowserWindow(url) {
        const target = String(url || '').trim();
        const normalized = target && !/^https?:\/\//i.test(target) ? `https://${target}` : target;
        if (normalized && this.settings.isBlocked(normalized)) {
            return { success: false, error: 'That site is on your blocked list.' };
        }

        return this._serialize(async () => {
            try {
                // The profile directory only supports one Chrome at a time, so a
                // hidden instance has to go before a visible one can take its place.
                await this.closeBrowser();
                const launch = await this._launchManagedBrowser('visible');
                if (!launch.ok) return { success: false, error: launch.error };
                if (!(await this._waitForBrowserReady(15000))) {
                    return { success: false, error: 'The browser did not become ready in time.' };
                }

                // Suppresses the idle reaper: nothing should kill a window while
                // someone is halfway through a password or a 2FA code.
                this.signInPending = true;
                if (normalized) {
                    this.page = await this.browser.newPage();
                    await this.page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: 30000 });
                }
                await this.page.bringToFront();
                return { success: true, url: this.page.url() };
            } catch (error) {
                console.error('BrowserHandler: could not open the browser window:', error.message);
                return { success: false, error: error.message };
            }
        });
    }

    /**
     * Runs `work` against a browser-attached CDP session.
     *
     * Cookies cannot be read from disk: Chrome encrypts the profile's cookie store
     * with an OS-held key. So inspecting them needs a live browser. If the agent's
     * browser is already up we borrow it and leave it alone; otherwise we start a
     * headless one purely for the call and shut it down after, which keeps a window
     * from appearing just because someone opened the settings panel.
     *
     * Only reached when nothing else is running, because a live connection means an
     * agent may be mid-task, and that case takes the borrow path instead.
     */
    async _withCdpSession(work) {
        const borrowed = this.isConnected || !!this.managedBrowserProcess;
        if (!this.isConnected) {
            const launch = await this._launchManagedBrowser(borrowed ? undefined : 'headless');
            if (!launch.ok) return { success: false, error: launch.error };
            if (!(await this._waitForBrowserReady(15000))) {
                return { success: false, error: 'The browser did not start in time.' };
            }
        }

        let session;
        try {
            session = await this.page.target().createCDPSession();
            return await work(session);
        } catch (error) {
            console.error('BrowserHandler: CDP session failed:', error.message);
            return { success: false, error: error.message };
        } finally {
            if (session) await session.detach().catch(() => {});
            if (!borrowed) await this.closeBrowser();
        }
    }

    /** Every site the agent's browser is holding cookies for, one entry per site. */
    async listSites() {
        return this._serialize(() => this._withCdpSession(async (session) => {
            const { cookies } = await session.send('Storage.getCookies');
            return { success: true, sites: groupCookiesBySite(cookies) };
        }));
    }

    /** Signs the agent out of one site by removing everything that site stored. */
    async clearSite(domain) {
        const site = String(domain || '').trim().toLowerCase().replace(/^\./, '');
        if (!site) return { success: false, error: 'No site was given.' };

        return this._serialize(() => this._withCdpSession(async (session) => {
            // Network.deleteCookies needs the domain enabled on this session first.
            await session.send('Network.enable');
            const { cookies } = await session.send('Storage.getCookies');
            const owned = cookies.filter((cookie) => {
                const host = cookie.domain.replace(/^\./, '');
                return host === site || host.endsWith(`.${site}`);
            });
            for (const cookie of owned) {
                await session.send('Network.deleteCookies', {
                    name: cookie.name,
                    domain: cookie.domain,
                    path: cookie.path
                });
            }
            // Cookies are only half a login. Modern sites also keep tokens in
            // localStorage, IndexedDB and service workers, so clear the origin too
            // or the site stays signed in with no cookies to show for it.
            await session.send('Storage.clearDataForOrigin', {
                origin: `https://${site}`,
                storageTypes: 'all'
            });
            return { success: true, removed: owned.length };
        }));
    }

    /** Drops every cookie in the profile. Logins that use only cookies end here. */
    async clearAllCookies() {
        return this._serialize(() => this._withCdpSession(async (session) => {
            const { cookies } = await session.send('Storage.getCookies');
            await session.send('Network.clearBrowserCookies');
            return { success: true, removed: cookies.length };
        }));
    }

    async _connect() {
        if (this.isConnected) return true;
        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.connectPromise = (async () => {
            try {
                const browserUrl = this._getBrowserUrl();
                console.log(`Attempting to connect to browser at ${browserUrl}...`);
                // null means "use the real window size", which is right for both
                // headful modes. Headless has no window, so it needs an explicit
                // viewport to match the one requested at launch.
                const defaultViewport = this.settings.get().visibility === 'headless'
                    ? this._headlessViewport()
                    : null;
                this.browser = await puppeteer.connect({ browserURL: browserUrl, defaultViewport });
                this.isConnected = true;
                console.log('Successfully connected to browser via CDP.');
                const pages = await this.browser.pages();
                this.page = pages[0] || await this.browser.newPage();
                console.log(`Connected to page: ${this.page.url()}`);
                this.browser.removeAllListeners('disconnected');
                this.browser.on('disconnected', () => {
                    console.log('Browser disconnected.');
                    this.isConnected = false;
                    this.browser = null;
                    this.page = null;
                });
                return true;
            } catch (error) {
                console.log('Failed to connect to browser:', error.message);
                return false;
            } finally {
                this.connectPromise = null;
            }
        })();

        return this.connectPromise;
    }

    async handleCommand(commandPayload) {
        const { action, request_id } = commandPayload;
        console.log(`BrowserHandler: Processing command '${action}' with request_id: ${request_id}`);
        if (!this.isConnected && !['status', 'list_tabs'].includes(action)) {
            this._emitResult(request_id, { status: 'error', error: 'Browser is not connected. Use the "get_status" tool first.' });
            return;
        }
        // Single gate for every action that can reach a new origin. The profile
        // holds the user's real logged-in sessions, so the blocklist is checked
        // here rather than trusting each branch below to remember.
        if (['navigate', 'open_new_tab'].includes(action) && this.settings.isBlocked(commandPayload.url)) {
            this._emitResult(request_id, {
                status: 'error',
                error: `Navigation to ${commandPayload.url} was refused: the user has blocked this site for browser automation.`
            });
            return;
        }
        try {
            let result;
            switch (action) {
                case 'status':
                    const isConnected = await this._connect();
                    if (isConnected) {
                        result = { status: 'connected', url: await this.page.url() };
                    } else {
                        const launch = await this._launchManagedBrowser();
                        if (!launch.ok) {
                            result = { status: 'disconnected', error: launch.error };
                            break;
                        }
                        const isNowConnected = await this._waitForBrowserReady(15000);
                        result = isNowConnected ? { status: 'connected', url: await this.page.url() } : { status: 'disconnected', error: 'Connection failed after launch.' };
                    }
                    break;
                case 'navigate':
                    await this.page.goto(commandPayload.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await this._stabilizeAfterInteraction(5000);
                    result = await this.getView();
                    break;
                case 'get_view':
                    result = await this.getView();
                    break;
                case 'click':
                    {
                        const clickSelector = `[data-aios-id="${commandPayload.element_id}"]`;
                        
                        // Scroll element into view first (critical for off-screen elements)
                        await this.page.$eval(clickSelector, (el) => {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                        }).catch(() => {});
                        await new Promise(resolve => setTimeout(resolve, 300));

                        // Try standard click first
                        try {
                            await this.page.click(clickSelector, { timeout: 5000 });
                        } catch (clickError) {
                            // If standard click fails (element obscured/intercepted), try alternative strategies
                            console.log(`BrowserHandler: Standard click failed for element ${commandPayload.element_id}, trying alternatives...`);

                            try {
                                // Strategy 2: Force click via JavaScript (bypasses overlay intercepts)
                                await this.page.$eval(clickSelector, (el) => {
                                    el.focus();
                                    el.click();
                                    // Also dispatch pointer events for frameworks that listen to those
                                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                });
                            } catch (jsClickError) {
                                // Strategy 3: Click by coordinates (last resort)
                                const box = await this.page.$eval(clickSelector, (el) => {
                                    const rect = el.getBoundingClientRect();
                                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                                });
                                await this.page.mouse.click(box.x, box.y);
                            }
                        }
                    }
                    await this._stabilizeAfterInteraction(5000);
                    result = await this.getView();
                    break;
                case 'type':
                    {
                        const selector = `[data-aios-id="${commandPayload.element_id}"]`;
                        const clearExisting = commandPayload.clear_existing !== false;
                        const text = commandPayload.text;

                        // Determine element type for appropriate input strategy
                        const elementInfo = await this.page.$eval(selector, (el) => {
                            return {
                                tag: el.tagName.toLowerCase(),
                                isContentEditable: el.isContentEditable,
                                type: el.getAttribute('type') || '',
                                role: el.getAttribute('role') || ''
                            };
                        }).catch(() => null);

                        if (!elementInfo) {
                            result = { status: 'error', error: `Element with id ${commandPayload.element_id} not found.` };
                            break;
                        }

                        // Click the element first to ensure it's focused (critical for reply boxes)
                        await this.page.click(selector).catch(() => {});
                        await new Promise(resolve => setTimeout(resolve, 200));

                        // Focus the element explicitly
                        await this.page.focus(selector).catch(() => {});
                        await new Promise(resolve => setTimeout(resolve, 100));

                        if (elementInfo.isContentEditable || elementInfo.role === 'textbox') {
                            // ContentEditable strategy (Slack, Gmail, Teams reply boxes, etc.)
                            if (clearExisting) {
                                // Select all and delete for contenteditable
                                await this.page.keyboard.down('Control');
                                await this.page.keyboard.press('a');
                                await this.page.keyboard.up('Control');
                                await new Promise(resolve => setTimeout(resolve, 50));
                                await this.page.keyboard.press('Backspace');
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }

                            // Type character by character for contenteditable (more reliable than bulk)
                            // Some apps (Slack, Discord) intercept programmatic input events
                            // Using keyboard.type() with delay simulates real key presses
                            await this.page.keyboard.type(text, { delay: 30 });

                        } else if (elementInfo.tag === 'input' || elementInfo.tag === 'textarea') {
                            // Standard form field strategy
                            if (clearExisting) {
                                await this.page.$eval(selector, (el) => {
                                    el.value = '';
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                }).catch(() => {});

                                // Also use keyboard select-all + delete as fallback
                                await this.page.keyboard.down('Control');
                                await this.page.keyboard.press('a');
                                await this.page.keyboard.up('Control');
                                await this.page.keyboard.press('Backspace');
                                await new Promise(resolve => setTimeout(resolve, 50));
                            }

                            // Type using Puppeteer's type method (dispatches proper keydown/keyup)
                            await this.page.type(selector, text, { delay: 20 });

                        } else {
                            // Fallback: try focus + keyboard.type
                            if (clearExisting) {
                                await this.page.keyboard.down('Control');
                                await this.page.keyboard.press('a');
                                await this.page.keyboard.up('Control');
                                await this.page.keyboard.press('Backspace');
                            }
                            await this.page.keyboard.type(text, { delay: 30 });
                        }
                    }
                    await this._stabilizeAfterInteraction(3000);
                    result = await this.getView();
                    break;
                case 'scroll':
                    await this.page.evaluate(direction => window.scrollBy(0, direction === 'down' ? window.innerHeight * 0.8 : -window.innerHeight * 0.8), commandPayload.direction);
                    await this._stabilizeAfterInteraction(2000);
                    result = await this.getView();
                    break;
                case 'go_back':
                    await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    await this._stabilizeAfterInteraction(5000);
                    result = await this.getView();
                    break;
                case 'go_forward':
                    await this.page.goForward({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    await this._stabilizeAfterInteraction(5000);
                    result = await this.getView();
                    break;
                case 'list_tabs':
                    if (!this.isConnected) {
                        result = { status: 'disconnected', tabs: [], message: 'Browser is not connected.' };
                        break;
                    }
                    const pages = await this.browser.pages();
                    result = {
                        status: 'success',
                        tabs: await Promise.all(pages.map(async (p, i) => ({
                            index: i,
                            title: await p.title(),
                            url: p.url()
                        })))
                    };
                    break;
                case 'open_new_tab':
                    this.page = await this.browser.newPage();
                    await this.page.goto(commandPayload.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await this._stabilizeAfterInteraction(5000);
                    await this._focusPage();
                    result = await this.getView();
                    break;
                case 'switch_to_tab':
                    const allPages = await this.browser.pages();
                    if (commandPayload.tab_index >= 0 && commandPayload.tab_index < allPages.length) {
                        this.page = allPages[commandPayload.tab_index];
                        await this._focusPage();
                        result = await this.getView();
                    } else {
                        result = { status: 'error', error: 'Invalid tab index.' };
                    }
                    break;
                case 'close_tab':
                    const pagesToClose = await this.browser.pages();
                    if (commandPayload.tab_index >= 0 && commandPayload.tab_index < pagesToClose.length) {
                        if (pagesToClose.length === 1) {
                            result = { status: 'error', error: 'Cannot close the last tab.' };
                            break;
                        }
                        await pagesToClose[commandPayload.tab_index].close();
                        const remainingPages = await this.browser.pages();
                        this.page = remainingPages[0];
                        await this._focusPage();
                        result = { status: 'success', message: `Tab ${commandPayload.tab_index} closed.` };
                    } else {
                        result = { status: 'error', error: 'Invalid tab index.' };
                    }
                    break;
                case 'hover':
                    await this.page.hover(`[data-aios-id="${commandPayload.element_id}"]`);
                    await new Promise(resolve => setTimeout(resolve, 500)); 
                    result = await this.getView();
                    break;
                case 'focus_element':
                    {
                        const focusSelector = `[data-aios-id="${commandPayload.element_id}"]`;
                        await this.page.$eval(focusSelector, (el) => {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }).catch(() => {});
                        await new Promise(resolve => setTimeout(resolve, 200));
                        await this.page.click(focusSelector).catch(() => {});
                        await this.page.focus(focusSelector).catch(() => {});
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    result = await this.getView();
                    break;
                case 'click_by_text':
                    {
                        const searchText = commandPayload.text;
                        const elementType = commandPayload.element_type || '';
                        
                        // Build XPath or use text content matching
                        const clicked = await this.page.evaluate(({ searchText, elementType }) => {
                            // Strategy 1: Exact text match across interactive elements
                            const interactiveSelectors = elementType
                                ? elementType
                                : 'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"]';
                            
                            const candidates = Array.from(document.querySelectorAll(interactiveSelectors));
                            
                            // Try exact match first
                            let target = candidates.find(el => {
                                const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
                                return text === searchText;
                            });
                            
                            // Try contains match
                            if (!target) {
                                const lowerSearch = searchText.toLowerCase();
                                target = candidates.find(el => {
                                    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
                                    return text.includes(lowerSearch);
                                });
                            }

                            // Try aria-label match
                            if (!target) {
                                target = candidates.find(el => {
                                    const label = (el.getAttribute('aria-label') || '').toLowerCase();
                                    return label.includes(searchText.toLowerCase());
                                });
                            }
                            
                            if (target) {
                                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                target.click();
                                return { found: true, text: target.innerText?.substring(0, 80) || '', tag: target.tagName };
                            }
                            return { found: false };
                        }, { searchText, elementType });

                        if (clicked.found) {
                            await this._stabilizeAfterInteraction(3000);
                            result = await this.getView();
                            result.message = `Clicked element with text: "${clicked.text}" (${clicked.tag})`;
                        } else {
                            result = { status: 'error', error: `No clickable element found with text: "${searchText}"` };
                        }
                    }
                    break;
                case 'click_coordinates':
                    {
                        const cx = commandPayload.x;
                        const cy = commandPayload.y;
                        await this.page.mouse.click(cx, cy);
                    }
                    await this._stabilizeAfterInteraction(3000);
                    result = await this.getView();
                    break;
                case 'select_option':
                    await this.page.select(`[data-aios-id="${commandPayload.element_id}"]`, commandPayload.value);
                    result = await this.getView();
                    break;
                case 'handle_alert':
                    this.page.once('dialog', async dialog => {
                        await dialog[commandPayload.alert_action]();
                    });
                    result = { status: 'success', message: `Alert handler for '${commandPayload.alert_action}' is ready.` };
                    break;
                case 'press_key':
                    {
                        const keyInput = commandPayload.key;
                        // Support key combinations like "Control+Enter", "Shift+Tab", etc.
                        if (keyInput.includes('+')) {
                            const parts = keyInput.split('+');
                            const modifiers = parts.slice(0, -1);
                            const finalKey = parts[parts.length - 1];
                            
                            for (const mod of modifiers) {
                                await this.page.keyboard.down(mod);
                            }
                            await this.page.keyboard.press(finalKey);
                            for (const mod of modifiers.reverse()) {
                                await this.page.keyboard.up(mod);
                            }
                        } else {
                            await this.page.keyboard.press(keyInput);
                        }
                    }
                    await this._stabilizeAfterInteraction(5000);
                    result = await this.getView();
                    break;
                case 'extract_text':
                    const text = await this.page.$eval(`[data-aios-id="${commandPayload.element_id}"]`, el => el.innerText);
                    result = { status: 'success', text: text };
                    break;
                case 'get_attributes':
                    const attrs = await this.page.$eval(`[data-aios-id="${commandPayload.element_id}"]`, el => {
                        const attributes = {};
                        for (const attr of el.attributes) {
                            attributes[attr.name] = attr.value;
                        }
                        return attributes;
                    });
                    result = { status: 'success', attributes: attrs };
                    break;
                case 'extract_table':
                    const markdownTable = await this.page.$eval(`[data-aios-id="${commandPayload.element_id}"]`, table => {
                        const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim().replace(/\|/g, ''));
                        const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => 
                            Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim().replace(/\|/g, ''))
                        );
                        let markdown = `| ${headers.join(' | ')} |\n`;
                        markdown += `| ${headers.map(() => '---').join(' | ')} |\n`;
                        rows.forEach(row => {
                            markdown += `| ${row.join(' | ')} |\n`;
                        });
                        return markdown;
                    });
                    result = { status: 'success', table_markdown: markdownTable };
                    break;
                case 'refresh':
                    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    await this._stabilizeAfterInteraction(5000);
                    result = await this.getView();
                    break;
                case 'wait_for_element':
                    try {
                        await this.page.waitForSelector(commandPayload.selector, { timeout: commandPayload.timeout * 1000 });
                        result = { status: 'success', message: `Element '${commandPayload.selector}' appeared.` };
                    } catch (error) {
                        result = { status: 'error', error: `Element '${commandPayload.selector}' did not appear within ${commandPayload.timeout} seconds.` };
                    }
                    break;
                case 'manage_cookies':
                    if (commandPayload.cookie_action === 'clear_all') {
                        const client = await this.page.target().createCDPSession();
                        await client.send('Network.clearBrowserCookies');
                        result = { status: 'success', message: 'All cookies cleared.' };
                    } else if (commandPayload.cookie_action === 'accept_all') {
                        const selectors = ['[id*="consent"]', '[class*="consent"]', '[id*="cookie"]', '[class*="cookie"]', 'button', 'a'];
                        const texts = /Accept|Allow|Agree|OK|Got it|I understand|I agree/i;
                        const clicked = await this.page.evaluate((selectors, textsSource) => {
                            const buttons = Array.from(document.querySelectorAll(selectors.join(',')));
                            const textsRegex = new RegExp(textsSource, 'i');
                            const target = buttons.find(el => textsRegex.test(el.innerText));
                            if (target) {
                                target.click();
                                return true;
                            }
                            return false;
                        }, selectors, texts.source);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        result = await this.getView();
                        result.message = clicked ? 'Attempted to accept cookies.' : 'No common cookie button found.';
                    }
                    break;
                default:
                    result = { status: 'error', error: `Unknown browser command: ${action}` };
            }
            this._emitResult(request_id, result);
        } catch (error) {
            console.error(`BrowserHandler: Error executing browser command '${action}':`, error.message);
            this._emitResult(request_id, { status: 'error', error: error.message });
        }
    }

    async getView() {
        if (!this.isConnected) return { status: 'error', error: 'Browser not connected.' };
        try {
            const interactive_elements = await this.page.evaluate(() => {
                // Comprehensive selector covering ALL interactive element types
                const selectors = [
                    'a[href]',
                    'button',
                    'input',
                    'textarea',
                    'select',
                    '[role="button"]',
                    '[role="link"]',
                    '[role="textbox"]',
                    '[role="searchbox"]',
                    '[role="combobox"]',
                    '[role="menuitem"]',
                    '[role="tab"]',
                    '[role="option"]',
                    '[role="switch"]',
                    '[role="checkbox"]',
                    '[role="radio"]',
                    '[contenteditable="true"]',
                    '[contenteditable=""]',
                    '[tabindex]:not([tabindex="-1"])',
                    '[onclick]',
                    '[data-action]',
                    '[data-testid]',
                    'summary',
                    'details',
                    'label[for]'
                ];

                const elements = Array.from(document.querySelectorAll(selectors.join(', ')));
                const visibleElements = [];
                let nextId = Number(window.__aiosNextElementId || 1);

                // Deduplicate (same element can match multiple selectors)
                const seen = new WeakSet();

                elements.forEach((el) => {
                    if (seen.has(el)) return;
                    seen.add(el);

                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    const isVisible = (
                        rect.width > 0 &&
                        rect.height > 0 &&
                        style.visibility !== 'hidden' &&
                        style.display !== 'none' &&
                        style.opacity !== '0' &&
                        rect.bottom >= 0 &&
                        rect.right >= 0 &&
                        rect.top <= window.innerHeight &&
                        rect.left <= window.innerWidth
                    );

                    if (isVisible) {
                        let elementId = el.getAttribute('data-aios-id');
                        if (!elementId) {
                            elementId = String(nextId++);
                            el.setAttribute('data-aios-id', elementId);
                        }

                        const tag = el.tagName.toLowerCase();
                        const role = el.getAttribute('role') || '';
                        const type = el.getAttribute('type') || '';
                        const placeholder = el.getAttribute('placeholder') || '';
                        const ariaLabel = el.getAttribute('aria-label') || '';
                        const title = el.getAttribute('title') || '';
                        const name = el.getAttribute('name') || '';
                        const isEditable = el.isContentEditable || tag === 'textarea' || (tag === 'input' && !['checkbox','radio','submit','button','file','hidden','image','reset'].includes(type));
                        const isFocused = document.activeElement === el;
                        const value = el.value || '';
                        const textContent = (el.innerText || '').trim().substring(0, 100);
                        
                        // Get parent context for better identification
                        const parentLabel = el.closest('label')?.innerText?.trim()?.substring(0, 60) || '';
                        const ariaDescribedBy = el.getAttribute('aria-describedby') || '';
                        const dataTestId = el.getAttribute('data-testid') || '';

                        visibleElements.push({
                            id: Number(elementId),
                            tag: tag,
                            type: type,
                            role: role,
                            text: textContent,
                            value: value.substring(0, 100),
                            placeholder: placeholder,
                            ariaLabel: ariaLabel,
                            title: title,
                            name: name,
                            isEditable: isEditable,
                            isFocused: isFocused,
                            isContentEditable: el.isContentEditable,
                            parentLabel: parentLabel,
                            dataTestId: dataTestId,
                            // Bounding box for coordinate-based fallback
                            bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
                        });
                    }
                });
                window.__aiosNextElementId = nextId;
                return visibleElements;
            });

            // Every view costs an upload from the user's machine plus a download on
            // the backend, so the encoding is the single biggest lever on browser
            // latency. A full-viewport PNG runs several hundred KB; JPEG at this
            // quality lands under 100KB with no loss the model notices.
            const screenshot_base64 = await this.page.screenshot({
                encoding: 'base64',
                type: 'jpeg',
                quality: SCREENSHOT_QUALITY
            });
            const screenshot_path = await this._uploadScreenshot(screenshot_base64);
            const viewData = {
                status: 'success',
                title: await this.page.title(),
                url: this.page.url(),
                interactive_elements: interactive_elements,
                element_count: interactive_elements.length,
                editable_elements: interactive_elements.filter(e => e.isEditable).length,
                focused_element: interactive_elements.find(e => e.isFocused) || null
            };
            if (screenshot_path) {
                viewData.screenshot_path = screenshot_path;
            } else {
                console.warn("getView: Screenshot upload failed, path not included in result.");
            }
            return viewData;
        } catch (error) {
            console.error("Error in getView:", error.message);
            return { status: 'error', error: `Failed to get page view: ${error.message}` };
        }
    }

    _emitResult(request_id, result) {
        this.eventEmitter.emit('browser-command-result', { request_id, result });
    }

    async cleanup() {
        console.log('Cleaning up BrowserHandler...');
        await this.closeBrowser();

        // The profile directory is where the agent's logins live. Wiping it is now
        // the user's explicit choice instead of a build-time decision.
        if (this.settings.get().keepSignedIn) return;
        try {
            // Chrome keeps file locks on the profile for a moment after the kill
            // signal. Deleting too early leaves a half-removed directory that the
            // next launch reports as a corrupt profile.
            await this._sleep(500);
            const profilePath = path.join(this.appDataPath, 'aios-browser-profile');
            if (fs.existsSync(profilePath)) {
                console.log(`Removing browser profile at: ${profilePath}`);
                fs.rmSync(profilePath, { recursive: true, force: true });
            }
        } catch (error) {
            console.error('Error removing browser profile directory:', error.message);
        }
    }
}

module.exports = BrowserHandler;
// Exported for the cookie-grouping check in .ui-check/group.js.
module.exports.groupCookiesBySite = groupCookiesBySite;
