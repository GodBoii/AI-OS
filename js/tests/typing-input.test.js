const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BrowserSettings = require('../browser-settings');
const { typeWithSpeed, pasteWithClipboard, getTypingSpeed } = require('../typing-input');

test('typing preference persists, rejects invalid modes, and defaults to instant', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aetheria-typing-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const settings = new BrowserSettings(directory);
    assert.equal(getTypingSpeed(settings), 'instant');
    settings.update({ typingSpeed: 'slow' });
    assert.equal(getTypingSpeed(new BrowserSettings(directory)), 'slow');
    assert.equal(settings.update({ typingSpeed: 'invalid' }).typingSpeed, 'slow');
    settings.update({ typingSpeed: 'fast' });
    assert.equal(getTypingSpeed(new BrowserSettings(directory)), 'fast');
    assert.equal(getTypingSpeed(null), 'instant');
});

test('a failed disk write does not change the active typing preference', () => {
    const settings = new BrowserSettings(path.join(os.tmpdir(), 'aetheria-directory-that-does-not-exist', 'nested'));
    assert.throws(() => settings.update({ typingSpeed: 'slow' }), /ENOENT/);
    assert.equal(settings.get().typingSpeed, 'instant');
});

test('instant inserts one complete string; fast and slow preserve Unicode with different pauses', async () => {
    const text = 'A😀\nB';
    for (const speed of ['instant', 'fast', 'slow']) {
        const inserts = [], characters = [], pauses = [];
        await typeWithSpeed(text, speed, {
            insertText: async value => inserts.push(value), typeCharacter: async value => characters.push(value),
            sleep: async ms => pauses.push(ms), random: () => 0.5,
        });
        if (speed === 'instant') {
            assert.deepEqual(inserts, [text]);
            assert.deepEqual(characters, []);
            assert.deepEqual(pauses, []);
        } else {
            assert.deepEqual(characters, ['A', '😀', '\n', 'B']);
            assert.deepEqual(pauses, [speed === 'fast' ? 40 : 130, speed === 'fast' ? 40 : 130, speed === 'fast' ? 40 : 130]);
            assert.deepEqual(inserts, []);
        }
    }
});

function fakeClipboard() {
    const clipboard = {
        value: 'previous text', writes: [],
        readText() { return this.value; }, readHTML: () => '<b>previous text</b>', readRTF: () => '{\\rtf1 previous text}',
        readImage: () => ({ isEmpty: () => true }), readBookmark: () => ({ title: '', url: '' }),
        writeText(text) { this.value = text; },
        write(data) { this.writes.push(data); this.value = data.text; },
    };
    return clipboard;
}

test('native paste restores supported rich clipboard formats, including after failure', async () => {
    for (const fails of [false, true]) {
        const clipboard = fakeClipboard();
        const task = pasteWithClipboard('new text', {
            clipboard, sleep: async () => {}, pressPaste: async () => { assert.equal(clipboard.value, 'new text'); if (fails) throw new Error('input failure'); },
        });
        if (fails) await assert.rejects(task, /input failure/);
        else await task;
        assert.equal(clipboard.value, 'previous text');
        assert.deepEqual(clipboard.writes[0], { text: 'previous text', html: '<b>previous text</b>', rtf: '{\\rtf1 previous text}' });
    }
});

test('native paste keeps a newer clipboard change made by the user', async () => {
    const clipboard = fakeClipboard();
    await pasteWithClipboard('new text', { clipboard, sleep: async () => {}, pressPaste: async () => { clipboard.value = 'user copied something else'; } });
    assert.equal(clipboard.value, 'user copied something else');
    assert.equal(clipboard.writes.length, 0);
});
