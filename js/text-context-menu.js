// Native editing and spelling actions for app-owned text fields.
function installTextContextMenu(window, { Menu, onClose = () => {} }) {
    const contents = window.webContents;
    let activeMenu = null;
    let navigation = 0;

    const close = () => activeMenu?.closePopup();
    const onNavigation = (_event, _url, _inPlace, isMainFrame) => {
        if (!isMainFrame) return;
        navigation++;
        close();
    };
    const onContextMenu = (_event, params) => {
        // Generated previews and remote pages do not use the app's editing menu.
        if (params.frame !== contents.mainFrame || !params.frame?.url.startsWith('file:')) return;
        if (!params.isEditable && !params.selectionText) return;
        close();

        const currentNavigation = navigation;
        const canEdit = () => !window.isDestroyed() && !contents.isDestroyed()
            && navigation === currentNavigation;
        const template = [];
        // Electron 37 on Windows can report spellcheckEnabled=false even when
        // it supplies a real misspelling and suggestions. Trust the word result.
        if (params.isEditable && params.misspelledWord) {
            for (const suggestion of params.dictionarySuggestions) {
                template.push({ label: suggestion, click: () => {
                    if (canEdit()) contents.replaceMisspelling(suggestion);
                } });
            }
            if (!params.dictionarySuggestions.length) {
                template.push({ label: 'No spelling suggestions', enabled: false });
            }
            template.push({ label: 'Add to dictionary', click: () => {
                if (canEdit()) contents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
            } }, { type: 'separator' });
        }

        const flags = params.editFlags;
        if (params.isEditable) {
            template.push(
                { role: 'undo', enabled: flags.canUndo },
                { role: 'redo', enabled: flags.canRedo },
                { type: 'separator' },
                { role: 'cut', enabled: flags.canCut },
            );
        }
        template.push({ role: 'copy', enabled: flags.canCopy });
        if (params.isEditable) template.push({ role: 'paste', enabled: flags.canPaste });
        template.push({ type: 'separator' }, { role: 'selectAll', enabled: flags.canSelectAll });

        const menu = Menu.buildFromTemplate(template);
        activeMenu = menu;
        menu.popup({
            window, frame: params.frame, x: params.x, y: params.y,
            sourceType: params.menuSourceType,
            callback: () => {
                if (activeMenu !== menu) return;
                activeMenu = null;
                onClose();
            },
        });
    };

    contents.on('context-menu', onContextMenu);
    contents.on('did-start-navigation', onNavigation);
    contents.once('destroyed', () => {
        close();
        activeMenu = null;
        contents.removeListener('context-menu', onContextMenu);
        contents.removeListener('did-start-navigation', onNavigation);
    });
    return { get isOpen() { return activeMenu !== null; }, close };
}

module.exports = { installTextContextMenu };
