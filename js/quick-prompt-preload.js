// Preload for quick-prompt.html. Exposes only submit/close and the "opened"
// signal; the window has no other access to Electron or Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickPrompt', {
    submit: (text) => ipcRenderer.send('quick-prompt:submit', String(text || '')),
    close: () => ipcRenderer.send('quick-prompt:close'),
    onOpened: (callback) => {
        if (typeof callback !== 'function') return;
        ipcRenderer.on('quick-prompt:opened', () => callback());
    },
});
