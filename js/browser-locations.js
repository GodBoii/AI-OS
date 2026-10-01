// browser-locations.js - where Chromium-based browsers are installed, per OS.
//
// The browser tool drives the browser over the DevTools protocol, so any
// Chromium build works. Candidates are listed in preference order; the first
// one that exists on disk is used.

const path = require('path');

function getBrowserCandidates({ platform, env, homeDir }) {
    if (platform === 'win32') {
        // ProgramW6432 Chrome, then Edge, stays first so existing installs keep
        // picking the same browser they always did.
        const roots = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
        const uniqueRoots = [...new Set(roots)];
        const candidates = [];
        for (const root of uniqueRoots) {
            candidates.push(path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
            candidates.push(path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
        }
        // Per-user installs (Chrome's non-admin installer, Brave).
        if (env.LOCALAPPDATA) {
            candidates.push(path.win32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
            candidates.push(path.win32.join(env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
        }
        for (const root of uniqueRoots) {
            candidates.push(path.win32.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
        }
        return candidates;
    }

    if (platform === 'darwin') {
        const bundles = [
            ['Google Chrome.app', 'Google Chrome'],
            ['Microsoft Edge.app', 'Microsoft Edge'],
            ['Brave Browser.app', 'Brave Browser'],
            ['Chromium.app', 'Chromium'],
        ];
        const appDirs = ['/Applications', path.posix.join(homeDir, 'Applications')];
        const candidates = [];
        for (const dir of appDirs) {
            for (const [bundle, binary] of bundles) {
                candidates.push(path.posix.join(dir, bundle, 'Contents', 'MacOS', binary));
            }
        }
        return candidates;
    }

    // Linux: distro packages, then the vendor's /opt install, then Snap.
    return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/opt/google/chrome/chrome',
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/usr/bin/brave-browser',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
    ];
}

function findBrowserExecutable({ platform, env, homeDir, exists }) {
    return getBrowserCandidates({ platform, env, homeDir }).find((candidate) => exists(candidate)) || null;
}

module.exports = { getBrowserCandidates, findBrowserExecutable };
