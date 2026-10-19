const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const LocalCoderHandler = require('../local-coder-handler');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aetheria-files-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, handler: new LocalCoderHandler(null, null) };
}

test('tree excludes dependency and environment folders before the file limit', async t => {
    const { root, handler } = await fixture(t);
    for (const folder of ['node_modules/pkg', '.git/objects', 'backend/.venv-runtime/lib', 'backend/__pycache__', 'src/deep', 'build']) {
        await fs.mkdir(path.join(root, folder), { recursive: true });
        await fs.writeFile(path.join(root, folder, 'file.py'), 'pass');
    }
    const tree = await handler.listWorkspaceTree({ rootPath: root });
    assert.deepEqual(tree.files.map(file => file.path), ['build/file.py', 'src/deep/file.py']);
    assert.equal(handler._isIgnoredPath('src/.github/workflows/ci.yml'), false);
    assert.equal(handler._isIgnoredPath('src/node_modules-guide.md'), false);
    assert.equal(handler._isIgnoredPath('node_modules'), true);
    assert.equal((await handler._walkFiles(root, 1)).length, 1);
});

test('preview reads are bounded while deployment reads preserve full bytes', async t => {
    const { root, handler } = await fixture(t);
    const source = 'a'.repeat(299999) + '€' + 'b'.repeat(1000000);
    await fs.writeFile(path.join(root, 'large.txt'), source);
    const preview = await handler.readWorkspaceFile({ rootPath: root, relativePath: 'large.txt', previewOnly: true });
    assert.equal(preview.success, true);
    assert.equal(preview.truncated, true);
    assert.equal(preview.content.length, 299999);
    assert.equal(preview.content.includes('\uFFFD'), false);
    assert.equal(preview.content_base64, undefined);
    assert.equal(preview.size_bytes, Buffer.byteLength(source));
    const full = await handler.readWorkspaceFile({ rootPath: root, relativePath: 'large.txt' });
    assert.equal(Buffer.from(full.content_base64, 'base64').toString(), source);
    await fs.writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2]));
    const binary = await handler.readWorkspaceFile({ rootPath: root, relativePath: 'binary.dat', previewOnly: true });
    assert.equal(binary.is_binary, true);
    assert.equal(binary.content_base64, undefined);
    assert.equal((await handler.readWorkspaceFile({ rootPath: root, relativePath: '../outside' })).success, false);
});

test('watcher reuses a root and prunes generated folder events', async t => {
    const { root, handler } = await fixture(t);
    await fs.mkdir(path.join(root, 'backend', '.venv-runtime'), { recursive: true });
    await fs.mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(root, 'backend', '.venv-runtime', 'ignored.py'), 'pass');
    await handler.startWatching('test', root);
    const watcher = handler.watchers.get('test');
    t.after(() => handler.stopWatching('test'));
    await handler.startWatching('test', root);
    assert.equal(handler.watchers.get('test'), watcher);
    await new Promise(resolve => watcher.once('ready', resolve));
    const watched = Object.keys(watcher.getWatched()).map(folder => folder.replace(/\\/g, '/'));
    assert.equal(watched.some(folder => folder.endsWith('/.venv-runtime')), false);
    assert.equal(watched.some(folder => folder.endsWith('/.github/workflows')), true);
});
