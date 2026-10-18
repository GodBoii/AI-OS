const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installTextContextMenu } = require('../text-context-menu');

function fixture() {
    const contents = new EventEmitter();
    const replacements = [];
    const learned = [];
    contents.mainFrame = { url: 'file:///app/index.html' };
    contents.isDestroyed = () => false;
    contents.replaceMisspelling = word => replacements.push(word);
    contents.session = { addWordToSpellCheckerDictionary: word => learned.push(word) };
    const window = { webContents: contents, isDestroyed: () => false };
    const menus = [];
    const Menu = { buildFromTemplate(template) {
        const menu = { template, popup(options) { this.options = options; },
            closePopup() { this.options.callback(); } };
        menus.push(menu);
        return menu;
    } };
    let closed = 0;
    const controller = installTextContextMenu(window, { Menu, onClose: () => closed++ });
    const params = { frame: contents.mainFrame, isEditable: true, spellcheckEnabled: true,
        misspelledWord: 'speling', dictionarySuggestions: ['spelling'], selectionText: '',
        editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true,
            canPaste: false, canSelectAll: true } };
    return { contents, params, menus, controller, replacements, learned, get closed() { return closed; } };
}

test('suggestions replace the clicked word and dictionary learning is explicit', () => {
    const f = fixture();
    f.contents.emit('context-menu', {}, f.params);
    assert.equal(f.controller.isOpen, true);
    const items = f.menus[0].template;
    items.find(item => item.label === 'spelling').click();
    assert.deepEqual(f.replacements, ['spelling']);
    assert.deepEqual(f.learned, []);
    items.find(item => item.label === 'Add to dictionary').click();
    assert.deepEqual(f.learned, ['speling']);
    assert.equal(items.find(item => item.role === 'paste').enabled, false);
    assert.equal(items.find(item => item.role === 'redo').enabled, false);
    f.controller.close();
    assert.equal(f.controller.isOpen, false);
    assert.equal(f.closed, 1);
});

test('unknown words have an empty state; excluded fields only get editing actions', () => {
    const f = fixture();
    f.contents.emit('context-menu', {}, { ...f.params, dictionarySuggestions: [] });
    assert.deepEqual(f.menus[0].template[0], { label: 'No spelling suggestions', enabled: false });
    f.contents.emit('context-menu', {}, { ...f.params, spellcheckEnabled: false,
        misspelledWord: '', dictionarySuggestions: [] });
    assert.equal(f.menus[1].template.some(item => item.label), false);
    f.contents.emit('context-menu', {}, { ...f.params, misspelledWord: '' });
    assert.equal(f.menus[2].template.some(item => item.label), false);
});

test('Windows misspellings are actionable even when Electron reports spellcheckEnabled=false', () => {
    const f = fixture();
    f.contents.emit('context-menu', {}, { ...f.params, spellcheckEnabled: false });
    f.menus[0].template.find(item => item.label === 'spelling').click();
    assert.deepEqual(f.replacements, ['spelling']);
});

test('preview frames and remote pages cannot open the app menu', () => {
    const f = fixture();
    f.contents.emit('context-menu', {}, { ...f.params, frame: { url: 'file:///app/preview.html' } });
    f.contents.emit('context-menu', {}, { ...f.params, frame: null });
    f.contents.mainFrame.url = 'https://example.com';
    f.contents.emit('context-menu', {}, f.params);
    assert.equal(f.menus.length, 0);
});

test('selected read-only text can be copied without exposing spelling or mutating actions', () => {
    const f = fixture();
    f.contents.emit('context-menu', {}, { ...f.params, isEditable: false });
    assert.equal(f.menus.length, 0);
    f.contents.emit('context-menu', {}, { ...f.params, isEditable: false, selectionText: 'Text' });
    assert.deepEqual(f.menus[0].template.filter(item => item.role).map(item => item.role), ['copy', 'selectAll']);
});

test('navigation closes the menu, invalidates corrections, and destruction removes listeners', () => {
    const f = fixture();
    f.contents.emit('context-menu', {}, f.params);
    const suggestion = f.menus[0].template[0];
    f.contents.emit('did-start-navigation', {}, 'file:///app/other.html', false, true);
    assert.equal(f.controller.isOpen, false);
    suggestion.click();
    assert.deepEqual(f.replacements, []);
    f.contents.emit('destroyed');
    assert.equal(f.contents.listenerCount('context-menu'), 0);
    assert.equal(f.contents.listenerCount('did-start-navigation'), 0);
});
