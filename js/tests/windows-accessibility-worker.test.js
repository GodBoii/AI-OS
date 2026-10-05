const test = require('node:test');
const assert = require('node:assert/strict');
const { WindowsAccessibilityWorker } = require('../windows-accessibility-worker');

test('native accessibility worker reuses its process and preserves Unicode and newlines', { skip: process.platform !== 'win32' }, async t => {
    const worker = new WindowsAccessibilityWorker();
    t.after(() => worker.close());
    const script = "@{ pid = $PID; text = 'Hello 😀 नमस्ते'; lines = \"first`nsecond\" } | ConvertTo-Json -Compress";
    const first = JSON.parse((await worker.run(script)).stdout);
    const second = JSON.parse((await worker.run(script)).stdout);
    assert.equal(first.pid, second.pid);
    assert.equal(first.text, 'Hello 😀 नमस्ते');
    assert.equal(first.lines, 'first\nsecond');
    assert.equal(worker.pending.size, 0);
});

test('script errors are returned and the next observation still works', { skip: process.platform !== 'win32' }, async t => {
    const worker = new WindowsAccessibilityWorker();
    t.after(() => worker.close());
    await assert.rejects(worker.run("throw 'Test provider failure'"), /Test provider failure/);
    assert.equal((await worker.run("'recovered'")).stdout, 'recovered');
    assert.equal(worker.pending.size, 0);
});

test('timeout kills the stuck worker and restarts only for a new explicit request', { skip: process.platform !== 'win32' }, async t => {
    const worker = new WindowsAccessibilityWorker();
    t.after(() => worker.close());
    const before = (await worker.run('$PID')).stdout;
    await assert.rejects(worker.run('Start-Sleep -Milliseconds 200', { timeout: 10 }), /outcome is unknown/);
    assert.equal(worker.pending.size, 0);
    assert.equal(worker.child, null);
    const after = (await worker.run('$PID')).stdout;
    assert.notEqual(before, after);
});
