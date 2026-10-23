// The settings page observes a lazy controller without starting a browser.
function installBrowserIpc({ ipcMain, browserHandler, browserSettings }) {
    ipcMain.handle('browser-settings:get', () => browserSettings.get());
    ipcMain.handle('browser-settings:set', (_event, patch) => browserSettings.update(patch));
    ipcMain.handle('browser-data', async (_event, payload) => {
        const { action, url, domain, id, visible } = payload || {};
        const current = browserHandler.peek();
        if (action === 'runtime') {
            return current ? current.getRuntime() : { success: true, state: 'stopped', connected: false,
                busy: false, control: 'agent', mode: null, preferredMode: browserSettings.get().visibility,
                tabs: [], activity: [] };
        }
        if (['pause', 'resume', 'takeControl', 'stop', 'switchTab', 'closeTab', 'restart'].includes(action) && !current) {
            return { success: false, error: 'Open the browser first.' };
        }
        try {
            switch (action) {
                case 'open': return await browserHandler.openBrowserWindow(url);
                case 'listSites': return await browserHandler.listSites();
                case 'clearSite': return await browserHandler.clearSite(domain);
                case 'clearAllCookies': return await browserHandler.clearAllCookies();
                case 'pause': return current.pauseAutomation();
                case 'resume': return current.resumeAutomation();
                case 'takeControl': return await current.takeControl();
                case 'stop': return await current.stopAutomation();
                case 'restart': return await current.restartBrowser({ visible: visible === true });
                case 'switchTab':
                case 'closeTab':
                    if (typeof id !== 'string' || !/^\d{1,12}$/.test(id)) return { success: false, error: 'Invalid tab. Refresh the list.' };
                    return await current.changeRuntimeTab(action, id);
                default: return { success: false, error: 'Unknown browser action.' };
            }
        } catch (error) {
            console.error('[Browser] Control failed:', action, error.message);
            return { success: false, error: 'Browser action failed. Refresh its status and try again.' };
        }
    });
}

module.exports = { installBrowserIpc };
