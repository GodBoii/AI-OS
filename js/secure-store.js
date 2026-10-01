// secure-store.js - small key/value store encrypted with the OS credential vault.
//
// Electron's safeStorage encrypts with DPAPI on Windows, the Keychain on
// macOS and libsecret/kwallet on Linux. The renderer's Supabase client uses
// this (through preload) instead of plain localStorage for its auth tokens.
//
// Values are kept as base64 ciphertext in one JSON file under userData. When
// no real OS vault is available (Linux without a keyring falls back to a
// hard-coded key, "basic_text"), the store reports itself unavailable and the
// caller keeps using localStorage, which is the old behavior.

const path = require('path');

const STORE_FILE = 'secure-store.json';
// Only Supabase auth keys (sb-<project>-auth-token, ...-code-verifier) may be
// stored, so the IPC channel cannot become a general secret dump.
const KEY_PATTERN = /^sb-[a-z0-9-]{1,120}$/i;
const MAX_VALUE_LENGTH = 64 * 1024;

class SecureStore {
    constructor({ safeStorage, fsPromises, directory, platform = process.platform, logger = console }) {
        this.safeStorage = safeStorage;
        this.fs = fsPromises;
        this.filePath = path.join(directory, STORE_FILE);
        this.platform = platform;
        this.logger = logger;
        this._cache = null;
        // Serializes writes so two quick setItem calls cannot interleave.
        this._writeChain = Promise.resolve();
    }

    isAvailable() {
        try {
            if (!this.safeStorage.isEncryptionAvailable()) return false;
            if (this.platform === 'linux' && typeof this.safeStorage.getSelectedStorageBackend === 'function') {
                return this.safeStorage.getSelectedStorageBackend() !== 'basic_text';
            }
            return true;
        } catch (error) {
            this.logger.warn('[SecureStore] Encryption availability check failed:', error.message);
            return false;
        }
    }

    static isValidKey(key) {
        return typeof key === 'string' && KEY_PATTERN.test(key);
    }

    async get(key) {
        this._assertKey(key);
        const entries = await this._load();
        const encrypted = entries[key];
        if (typeof encrypted !== 'string') return null;
        try {
            return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
        } catch (error) {
            // Ciphertext from another OS user or a reset keychain cannot be
            // read. Drop it so the user simply signs in again.
            this.logger.warn(`[SecureStore] Could not decrypt "${key}"; discarding it:`, error.message);
            await this.remove(key);
            return null;
        }
    }

    async set(key, value) {
        this._assertKey(key);
        if (typeof value !== 'string') throw new TypeError('Secure store values must be strings');
        if (value.length > MAX_VALUE_LENGTH) throw new RangeError('Secure store value is too large');
        const encrypted = this.safeStorage.encryptString(value).toString('base64');
        await this._update((entries) => { entries[key] = encrypted; });
    }

    async remove(key) {
        this._assertKey(key);
        await this._update((entries) => { delete entries[key]; });
    }

    _assertKey(key) {
        if (!SecureStore.isValidKey(key)) throw new TypeError(`Secure store key is not allowed: ${key}`);
    }

    async _load() {
        if (this._cache) return this._cache;
        try {
            const parsed = JSON.parse(await this.fs.readFile(this.filePath, 'utf8'));
            this._cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.warn('[SecureStore] Store file unreadable; starting empty:', error.message);
            }
            this._cache = {};
        }
        return this._cache;
    }

    _update(mutate) {
        const run = async () => {
            const entries = { ...(await this._load()) };
            mutate(entries);
            const tempPath = `${this.filePath}.tmp`;
            await this.fs.writeFile(tempPath, JSON.stringify(entries), { encoding: 'utf8', mode: 0o600 });
            await this.fs.rename(tempPath, this.filePath);
            this._cache = entries;
        };
        this._writeChain = this._writeChain.then(run, run);
        return this._writeChain;
    }
}

/**
 * Supabase `auth.storage` adapter for the preload script. Moves an existing
 * localStorage session into the secure store on first read, so signed-in
 * users stay signed in after the upgrade.
 */
function createSecureAuthStorage({ invoke, localStorage, logger = console }) {
    const call = async (op, key, value) => {
        try {
            return await invoke({ op, key, value });
        } catch (error) {
            logger.warn(`[SecureAuthStorage] ${op} failed, using localStorage:`, error.message);
            return { available: false };
        }
    };

    return {
        async getItem(key) {
            const result = await call('get', key);
            if (!result || result.available === false) return localStorage.getItem(key);
            if (typeof result.value === 'string') return result.value;

            const legacy = localStorage.getItem(key);
            if (legacy !== null) {
                const saved = await call('set', key, legacy);
                if (saved && saved.ok) localStorage.removeItem(key);
            }
            return legacy;
        },
        async setItem(key, value) {
            const result = await call('set', key, value);
            if (result && result.ok) {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, value);
            }
        },
        async removeItem(key) {
            localStorage.removeItem(key);
            await call('remove', key);
        },
    };
}

module.exports = { SecureStore, createSecureAuthStorage, KEY_PATTERN };
