const { app, BrowserWindow, Menu, ipcMain, globalShortcut, screen } = require('electron');
const path = require('node:path');
const { installTextContextMenu } = require('../../text-context-menu');
const { QuickPromptWindow } = require('../../quick-prompt-window');

app.setPath('userData', process.env.SPELLING_TEST_PROFILE);
let mainWindow;
let quick;
let lastMenu;
let lastOwner;
let lastParams;
const trackedMenu = { buildFromTemplate(template) {
    const menu = Menu.buildFromTemplate(template);
    const popup = menu.popup.bind(menu);
    menu.popup = options => {
        lastMenu = menu;
        lastOwner = options.window;
        popup(options);
    };
    return menu;
} };
const watch = win => win.webContents.prependListener('context-menu', (_event, params) => {
    lastMenu = null;
    lastParams = { word: params.misspelledWord, suggestions: params.dictionarySuggestions,
        spellcheckEnabled: params.spellcheckEnabled, source: params.menuSourceType };
});

app.whenReady().then(async () => {
    mainWindow = new BrowserWindow({ show: true, width: 900, height: 650,
        webPreferences: { nodeIntegration: true, contextIsolation: false, spellcheck: true } });
    const dictionaryEvents = [];
    for (const event of ['spellcheck-dictionary-download-begin', 'spellcheck-dictionary-download-failure',
        'spellcheck-dictionary-download-success', 'spellcheck-dictionary-initialized']) {
        mainWindow.webContents.session.on(event, (_event, language) => dictionaryEvents.push({ event, language }));
    }
    if (process.platform !== 'darwin') mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);
    watch(mainWindow);
    installTextContextMenu(mainWindow, { Menu: trackedMenu });
    quick = new QuickPromptWindow({ BrowserWindow, Menu: trackedMenu, globalShortcut, screen, ipcMain,
        preloadPath: path.resolve(__dirname, '../../quick-prompt-preload.js'),
        htmlPath: path.resolve(__dirname, '../../../quick-prompt.html'), onSubmit() {} });
    ipcMain.handle('spelling-fixture', (_event, action, index) => {
        if (action === 'dictionary') return { events: dictionaryEvents,
            enabled: mainWindow.webContents.session.isSpellCheckerEnabled(),
            languages: mainWindow.webContents.session.getSpellCheckerLanguages() };
        if (action === 'menu') return { params: lastParams,
            items: lastMenu?.items.map(item => ({ label: item.label, role: item.role, enabled: item.enabled })) };
        if (action === 'choose') {
            const item = lastMenu.items[index];
            // Match Electron's native menu dispatch, including the focused contents.
            item.click({}, lastOwner, lastOwner.webContents);
            lastMenu.closePopup();
        }
        if (action === 'close') lastMenu?.closePopup();
        if (action === 'quick') {
            quick.show();
            if (!quick.watched) { watch(quick.window); quick.watched = true; }
        }
        if (action === 'quick-state') return { visible: quick.window.isVisible(), focused: quick.window.isFocused() };
        if (action === 'focus-main') { mainWindow.show(); mainWindow.focus(); }
    });
    await mainWindow.loadFile(path.resolve(__dirname, '../../../chat.html'));
});
app.on('window-all-closed', () => app.quit());
