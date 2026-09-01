// browser-settings.js
//
// Validated store for the user's browser-automation preferences.
//
// This lives in the main process on purpose. BrowserHandler (also main) reads it
// when it spawns Chrome and on every screenshot, so keeping the renderer out of
// the read path means the agent's first browser command already honours the
// user's choices even if no window has painted yet. A renderer-owned store
// (localStorage) would leave main running on defaults until the settings tab
// happened to open.

const fs = require('fs');
const path = require('path');

const VISIBILITY_MODES = ['visible', 'background', 'headless'];

// Page size and screenshot quality are deliberately absent. Both feed straight
// into what the model sees: a wrong viewport desyncs the element bounds the agent
// clicks by, and a low quality setting degrades its reading of the page. There is
// no useful reason for a user to tune either, so BrowserHandler derives them.
const DEFAULTS = Object.freeze({
    // 'visible'    - normal Chrome window, current behaviour
    // 'background' - real headful Chrome that never takes focus
    // 'headless'   - --headless=new, fastest but easier for sites to detect
    visibility: 'visible',
    // Minutes of agent inactivity before the managed Chrome is closed. 0 = never.
    idleCloseMinutes: 15,
    // Keep the automation profile (and therefore its logins) on disk between runs.
    keepSignedIn: true,
    // Hostnames the agent is refused navigation to.
    blockedDomains: []
});

const clampInt = (value, min, max, fallback) => {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

// Folds 'https://Mail.Google.com/inbox', 'www.mail.google.com' and
// 'mail.google.com' onto the same key so a blocklist entry matches whichever
// form the user typed.
const toHostname = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    try {
        return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.replace(/^www\./, '');
    } catch (_error) {
        return '';
    }
};

// Accepts partial patches from the renderer and whole objects from disk. Unknown
// and malformed keys are dropped rather than corrected, so a hand-edited file
// can never put the handler into a state it cannot launch from.
function sanitize(input) {
    const patch = input && typeof input === 'object' ? input : {};
    const out = {};

    if (VISIBILITY_MODES.includes(patch.visibility)) out.visibility = patch.visibility;
    if (patch.idleCloseMinutes !== undefined) out.idleCloseMinutes = clampInt(patch.idleCloseMinutes, 0, 600, DEFAULTS.idleCloseMinutes);
    if (patch.keepSignedIn !== undefined) out.keepSignedIn = Boolean(patch.keepSignedIn);
    if (Array.isArray(patch.blockedDomains)) {
        out.blockedDomains = [...new Set(patch.blockedDomains.map(toHostname).filter(Boolean))].slice(0, 200);
    }

    return out;
}

class BrowserSettings {
    constructor(userDataPath) {
        this.filePath = path.join(userDataPath, 'browser-settings.json');
        this.values = { ...DEFAULTS, ...this._readFromDisk() };
    }

    _readFromDisk() {
        try {
            return sanitize(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn('[BrowserSettings] Ignoring unreadable settings file:', error.message);
            }
            return {};
        }
    }

    get() {
        return { ...this.values };
    }

    /** Applies a partial patch and returns the resulting sanitized settings. */
    update(patch) {
        this.values = { ...this.values, ...sanitize(patch) };
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.values, null, 2));
        } catch (error) {
            console.error('[BrowserSettings] Failed to persist settings:', error.message);
        }
        return this.get();
    }

    /** True when a blocklist entry matches the URL's host or any parent domain. */
    isBlocked(url) {
        const host = toHostname(url);
        if (!host) return false;
        return this.values.blockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
    }
}

module.exports = BrowserSettings;
module.exports.DEFAULTS = DEFAULTS;
module.exports.VISIBILITY_MODES = VISIBILITY_MODES;
