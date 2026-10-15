const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function serviceFixture({ settings = { supabase: { url: 'https://auth.example.test', anonKey: 'fixture-key' } },
    getSession = async () => ({ data: { session: null } }) } = {}) {
    const calls = { clients: 0, oauth: 0, listeners: 0, stopped: 0, errors: [] };
    const client = { auth: {
        getSession,
        async stopAutoRefresh() { calls.stopped++; },
        onAuthStateChange() { calls.listeners++; },
        async signInWithOAuth() { calls.oauth++; return { data: { url: 'https://auth.example.test/auth/v1/authorize?provider=google' } }; },
    } };
    const context = { module: { exports: {} }, require(name) {
        if (name === '@supabase/supabase-js') return { createClient(url, key, options) {
            calls.clients++; calls.options = options; return client;
        } };
        if (name === './config') return settings;
        throw new Error(`Unexpected module ${name}`);
    }, console: { log() {}, warn() {}, error(...args) { calls.errors.push(args.join(' ')); } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../auth-service'), 'utf8'), context);
    return { service: context.module.exports, calls, client, settings };
}

test('missing configuration fails clearly without dereferencing a null client and can recover', async () => {
    const { service, calls, settings } = serviceFixture({ settings: { supabase: { url: '', anonKey: '' } } });
    assert.equal(await service.init(), false);
    assert.equal(await service.getSession(), null);
    for (const operation of [() => service.signInWithGoogle(), () => service.signIn('fixture@test', 'unused'),
        () => service.signUp('fixture@test', 'unused', 'Fixture', '+919876543210'),
        () => service.setSession('unused', 'unused'), () => service.signOut()]) {
        const result = await operation();
        assert.equal(result.success, false);
        assert.match(result.error, /Authentication configuration is missing/);
        assert.doesNotMatch(result.error, /null|reading 'auth'/);
    }
    assert.equal(calls.clients, 0);
    assert.equal(calls.errors.filter(error => error.startsWith('Failed to initialize')).length, 1);
    settings.supabase = { url: 'https://auth.example.test', anonKey: 'fixture-key' };
    assert.equal(await service.init(), true);
    assert.equal(service.initializationError, null);
    assert.equal((await service.signInWithGoogle()).success, true);
});

test('concurrent auth callers await one complete initialization and preserve the storage adapter', async () => {
    let ready;
    const gate = new Promise(resolve => { ready = resolve; });
    const { service, calls } = serviceFixture({ getSession: async () => { await gate; return { data: { session: null } }; } });
    const storage = { getItem() {}, setItem() {}, removeItem() {} };
    service.setStorage(storage);
    const initialization = service.init();
    const signIn = service.signInWithGoogle();
    await Promise.resolve();
    assert.equal(calls.clients, 1);
    assert.equal(calls.oauth, 0);
    ready();
    assert.equal(await initialization, true);
    assert.equal((await signIn).success, true);
    assert.equal(calls.clients, 1);
    assert.equal(calls.listeners, 1);
    assert.equal(calls.options.auth.storage, storage);
});

test('an SDK initialization failure does not leave a half-ready client and permits a retry', async () => {
    let attempt = 0;
    const { service, calls } = serviceFixture({ getSession: async () => {
        if (++attempt === 1) throw new Error('Transient session recovery failure');
        return { data: { session: { user: { id: 'fixture-user' } } } };
    } });
    assert.equal(await service.init(), false);
    assert.equal(service.supabase, null);
    assert.equal(service.initPromise, null);
    assert.equal(calls.stopped, 1);
    assert.equal(await service.init(), true);
    assert.equal(service.getCurrentUser().id, 'fixture-user');
    assert.equal(calls.listeners, 1);
});

test('email signup, signin, session restoration and signout retain their successful contracts', async () => {
    const user = { id: 'fixture-user', user_metadata: { name: 'Fixture' } };
    const { service, client } = serviceFixture();
    const requests = [];
    for (const method of ['signUp', 'signInWithPassword', 'setSession', 'signOut']) {
        client.auth[method] = async args => { requests.push({ method, args }); return { data: { user, session: { user } } }; };
    }
    assert.equal((await service.signUp('fixture@test', 'unused', ' Fixture ', '+91 9876543210')).success, true);
    assert.equal(requests[0].args.options.data.name, 'Fixture');
    assert.equal(requests[0].args.options.data.phone_number, '+919876543210');
    assert.equal((await service.signIn('fixture@test', 'unused')).success, true);
    assert.equal(service.getCurrentUser().id, user.id);
    assert.equal((await service.setSession('fixture-access', 'fixture-refresh')).success, true);
    assert.equal(requests[2].args.refresh_token, 'fixture-refresh');
    assert.equal((await service.signOut()).success, true);
});
