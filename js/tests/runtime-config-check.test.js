const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function preflight(config, loadError) {
    const result = { messages: [], process: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../check-runtime-config'), 'utf8'), {
        require() { if (loadError) throw loadError; return config; }, URL, SyntaxError,
        process: result.process,
        console: { log: value => result.messages.push(value), error: value => result.messages.push(value) },
    });
    return result;
}

test('startup preflight accepts configured clients without printing configuration values', () => {
    const result = preflight({ supabase: { url: 'https://fixture.example.test', anonKey: 'fixture-private-output-marker' } });
    assert.notEqual(result.process.exitCode, 1);
    assert.equal(result.messages.length, 1);
    assert.doesNotMatch(result.messages[0], /fixture/);
});

test('startup preflight rejects absent settings and reports how to restore a worktree', () => {
    const result = preflight({ supabase: { url: '', anonKey: '' } });
    assert.equal(result.process.exitCode, 1);
    assert.match(result.messages[0], /js\/runtime-config.json/);
});

test('startup preflight rejects invalid protocols and does not echo malformed JSON contents', () => {
    assert.equal(preflight({ supabase: { url: 'file:///fixture', anonKey: 'unused' } }).process.exitCode, 1);
    const result = preflight(null, new SyntaxError('Do not echo fixture-private-output-marker'));
    assert.equal(result.process.exitCode, 1);
    assert.doesNotMatch(result.messages[0], /fixture-private/);
});
