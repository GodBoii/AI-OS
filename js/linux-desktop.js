// linux-desktop.js - Linux desktop helpers for the computer agent.
//
// node-window-manager has no Linux addon: it loads, but getWindows() always
// returns []. On X11 the standard tools are wmctrl (list, focus, move, close)
// and xdotool (minimize). Windows returned here expose the same members the
// computer-control handler uses on node-window-manager windows, so callers do
// not branch on platform. The action methods are async; awaiting the
// synchronous node-window-manager methods is harmless.

const fs = require('fs').promises;
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10000;

const INSTALL_HINTS = Object.freeze({
    wmctrl: 'wmctrl is required for window control on Linux. Install it with your package manager (for example: sudo apt install wmctrl).',
    xdotool: 'xdotool is required to minimize windows on Linux. Install it with your package manager (for example: sudo apt install xdotool).',
});

/**
 * Wayland compositors do not let one client list, move, or inject input into
 * another client's windows. wmctrl, xdotool and nut-js (XTest) only reach
 * XWayland apps there, so the agent reports this instead of half-working.
 */
function isWaylandSession(env) {
    const sessionType = String(env.XDG_SESSION_TYPE || '').toLowerCase();
    if (sessionType === 'wayland') return true;
    if (sessionType === 'x11') return false;
    return Boolean(env.WAYLAND_DISPLAY) && !env.DISPLAY;
}

async function runTool(tool, args, run = execFileAsync) {
    try {
        return await run(tool, args, { timeout: COMMAND_TIMEOUT_MS });
    } catch (error) {
        if (error.code === 'ENOENT' && INSTALL_HINTS[tool]) {
            const missing = new Error(INSTALL_HINTS[tool]);
            missing.code = 'TOOL_MISSING';
            throw missing;
        }
        throw error;
    }
}

// `wmctrl -lpG` columns: id desktop pid x y width height host title...
// The title is the rest of the line and may be empty or contain spaces.
const WMCTRL_LINE = /^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s?(.*)$/i;

function parseWmctrlList(stdout) {
    const windows = [];
    for (const line of String(stdout || '').split(/\r?\n/)) {
        const match = WMCTRL_LINE.exec(line.trim());
        if (!match) continue;
        const [, hexId, desktop, pid, x, y, width, height, , title] = match;
        windows.push({
            id: Number.parseInt(hexId, 16),
            desktop: Number(desktop),
            processId: Number(pid),
            bounds: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) },
            title: title || '',
        });
    }
    return windows;
}

function toWindowArg(id) {
    return `0x${Number(id).toString(16)}`;
}

class LinuxWindow {
    constructor(info, { run, exePath }) {
        this.id = info.id;
        this.processId = info.processId;
        // Matches node-window-manager's `path` (executable path), used to map
        // windows to applications.
        this.path = exePath || '';
        this._title = info.title;
        this._bounds = info.bounds;
        this._run = run;
    }

    getTitle() {
        return this._title;
    }

    getBounds() {
        return { ...this._bounds };
    }

    async bringToTop() {
        await runTool('wmctrl', ['-ia', toWindowArg(this.id)], this._run);
    }

    async setBounds(bounds) {
        const next = { ...this._bounds, ...bounds };
        const geometry = [0, next.x, next.y, next.width, next.height].map((value) => Math.round(Number(value)));
        if (geometry.some((value) => !Number.isFinite(value))) {
            throw new Error('Window bounds must be numbers');
        }
        // A maximized window ignores move/resize requests.
        await runTool('wmctrl', ['-ir', toWindowArg(this.id), '-b', 'remove,maximized_vert,maximized_horz'], this._run);
        await runTool('wmctrl', ['-ir', toWindowArg(this.id), '-e', geometry.join(',')], this._run);
        this._bounds = { x: geometry[1], y: geometry[2], width: geometry[3], height: geometry[4] };
    }

    async maximize() {
        await runTool('wmctrl', ['-ir', toWindowArg(this.id), '-b', 'add,maximized_vert,maximized_horz'], this._run);
    }

    async minimize() {
        await runTool('xdotool', ['windowminimize', String(this.id)], this._run);
    }

    /** Polite close (_NET_CLOSE_WINDOW): the app can still ask to save. */
    async close() {
        await runTool('wmctrl', ['-ic', toWindowArg(this.id)], this._run);
    }
}

async function readProcessExecutable(pid, readlink = fs.readlink) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return '';
    try {
        return await readlink(`/proc/${pid}/exe`);
    } catch {
        // Other users' processes are unreadable; title matching still works.
        return '';
    }
}

async function listLinuxWindows({ run = execFileAsync, readlink = fs.readlink } = {}) {
    const { stdout } = await runTool('wmctrl', ['-lpG'], run);
    const infos = parseWmctrlList(stdout);
    return Promise.all(infos.map(async (info) => new LinuxWindow(info, {
        run,
        exePath: await readProcessExecutable(info.processId, readlink),
    })));
}

// --- .desktop Exec parsing ---------------------------------------------------
// Desktop Entry spec: arguments are space separated, may be double-quoted
// (with \ escaping " ` $ \ inside quotes), and %-prefixed field codes are
// placeholders for files/URLs that must be dropped when launching bare.

function tokenizeDesktopExec(execValue) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    let hasToken = false;
    const text = String(execValue || '');

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '\\' && i + 1 < text.length) {
                current += text[++i];
            } else if (char === '"') {
                inQuotes = false;
            } else {
                current += char;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
            hasToken = true;
        } else if (/\s/.test(char)) {
            if (hasToken) tokens.push(current);
            current = '';
            hasToken = false;
        } else {
            current += char;
            hasToken = true;
        }
    }
    if (inQuotes) throw new Error('Unterminated quote in desktop Exec value');
    if (hasToken) tokens.push(current);
    return tokens;
}

function parseDesktopExec(execValue) {
    const args = [];
    for (const token of tokenizeDesktopExec(execValue)) {
        // A token that is only a field code (%U, %f, ...) is dropped entirely.
        if (/^%[a-zA-Z]$/.test(token)) continue;
        const expanded = token.replace(/%%|%[a-zA-Z]/g, (code) => (code === '%%' ? '%' : ''));
        if (expanded) args.push(expanded);
    }
    if (args.length === 0) throw new Error('Desktop Exec value has no command');
    return { command: args[0], args: args.slice(1) };
}

/**
 * Start a GUI program without tying it to our process. Resolves once the OS
 * has started it (or rejects with ENOENT etc.), never waits for it to exit.
 */
function spawnDetached(command, args = [], spawnFn = spawn) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawnFn(command, args, { detached: true, stdio: 'ignore' });
        } catch (error) {
            reject(error);
            return;
        }
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve(child.pid);
        });
    });
}

module.exports = {
    isWaylandSession,
    parseWmctrlList,
    listLinuxWindows,
    LinuxWindow,
    tokenizeDesktopExec,
    parseDesktopExec,
    spawnDetached,
};
