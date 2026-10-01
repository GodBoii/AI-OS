// platform-integration.js - main-process helpers whose behavior differs per OS.
//
// Everything here takes its OS facts (platform, paths, env, fs, execFile) as
// arguments so the logic can be tested on any machine. main.js supplies the
// real values.

const path = require('path');

const APP_ICON_FILES = Object.freeze({
    win32: 'icon.ico',
    // macOS and Linux cannot decode .ico through nativeImage, so they get the PNG.
    default: 'icon.png',
});

/**
 * Icon used for the window, the tray, and notifications.
 * Packaged builds copy both icon files into resources/ via extraResources.
 */
function resolveAppIconPath({ platform, isPackaged, resourcesPath, devAssetsDir }) {
    const fileName = APP_ICON_FILES[platform] || APP_ICON_FILES.default;
    return path.join(isPackaged ? resourcesPath : devAssetsDir, fileName);
}

// --- Linux autostart -------------------------------------------------------
// Electron's app.setLoginItemSettings() is a no-op on Linux. The freedesktop
// convention is a .desktop file in $XDG_CONFIG_HOME/autostart.

const LINUX_AUTOSTART_FILE = 'aetheria-ai.desktop';

function getLinuxAutostartPath({ env, homeDir }) {
    const configHome = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
        ? env.XDG_CONFIG_HOME
        : path.join(homeDir, '.config');
    return path.join(configHome, 'autostart', LINUX_AUTOSTART_FILE);
}

// Desktop Entry spec: quote each argument, backslash-escape " ` $ \ inside the
// quotes, then apply the general string escape (\ becomes \\) and double % so
// it is not read as a field code.
function quoteDesktopExecArg(arg) {
    const quoted = `"${String(arg).replace(/(["`$\\])/g, '\\$1')}"`;
    return quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%');
}

function buildLinuxAutostartEntry({ appName, execPath, args = [] }) {
    const execLine = [execPath, ...args].map(quoteDesktopExecArg).join(' ');
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Version=1.0',
        `Name=${appName}`,
        `Exec=${execLine}`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        '',
    ].join('\n');
}

/**
 * The executable that should run at login. An AppImage mounts itself at a new
 * temp path on every launch, so process.execPath would go stale; the AppImage
 * runtime exports the stable file location as $APPIMAGE.
 */
function resolveLinuxLaunchCommand({ env, execPath, isPackaged, appPath }) {
    if (env.APPIMAGE) return { execPath: env.APPIMAGE, args: [] };
    if (isPackaged) return { execPath, args: [] };
    return { execPath, args: [appPath] };
}

async function setLinuxLaunchAtStartup(enabled, { fsPromises, env, homeDir, appName, launchCommand }) {
    const entryPath = getLinuxAutostartPath({ env, homeDir });

    if (!enabled) {
        try {
            await fsPromises.unlink(entryPath);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        return { enabled: false, entryPath };
    }

    await fsPromises.mkdir(path.dirname(entryPath), { recursive: true });
    await fsPromises.writeFile(entryPath, buildLinuxAutostartEntry({ appName, ...launchCommand }), 'utf8');
    return { enabled: true, entryPath };
}

// --- macOS login-shell PATH ------------------------------------------------
// Apps started from Finder or the Dock inherit launchd's minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), so Homebrew, nvm, pyenv and friends are
// missing. Asking the user's login shell for its PATH matches what they get
// in Terminal.

const PATH_MARKER = '__AETHERIA_PATH__';

function parseShellPathOutput(stdout) {
    const text = String(stdout || '');
    const start = text.indexOf(PATH_MARKER);
    const end = text.indexOf(PATH_MARKER, start + PATH_MARKER.length);
    if (start === -1 || end === -1) return null;
    const value = text.slice(start + PATH_MARKER.length, end).trim();
    return value || null;
}

// Login-shell entries win; anything only present in the current PATH is kept
// at the end so nothing the app already relied on disappears.
function mergePathLists(loginPath, currentPath, delimiter = ':') {
    const seen = new Set();
    const merged = [];
    for (const entry of [...String(loginPath || '').split(delimiter), ...String(currentPath || '').split(delimiter)]) {
        if (!entry || seen.has(entry)) continue;
        seen.add(entry);
        merged.push(entry);
    }
    return merged.join(delimiter);
}

async function readLoginShellPath({ shell, execFile, env, timeoutMs = 5000 }) {
    const { stdout } = await execFile(
        shell,
        ['-ilc', `printf '%s' "${PATH_MARKER}$PATH${PATH_MARKER}"`],
        {
            timeout: timeoutMs,
            // oh-my-zsh otherwise may block on an update prompt.
            env: { ...env, DISABLE_AUTO_UPDATE: 'true' },
        }
    );
    return parseShellPathOutput(stdout);
}

/**
 * Resolves to the merged PATH, or null when nothing changed. Never rejects:
 * a broken shell rc file must not stop the app from starting.
 */
async function applyLoginShellPath({ env, execFile, logger = console }) {
    const shell = env.SHELL || '/bin/zsh';
    try {
        const loginPath = await readLoginShellPath({ shell, execFile, env });
        if (!loginPath) {
            logger.warn('[platform] Login shell returned no PATH; keeping the inherited PATH.');
            return null;
        }
        const merged = mergePathLists(loginPath, env.PATH);
        env.PATH = merged;
        return merged;
    } catch (error) {
        logger.warn('[platform] Could not read PATH from login shell:', error.message);
        return null;
    }
}

module.exports = {
    resolveAppIconPath,
    getLinuxAutostartPath,
    quoteDesktopExecArg,
    buildLinuxAutostartEntry,
    resolveLinuxLaunchCommand,
    setLinuxLaunchAtStartup,
    parseShellPathOutput,
    mergePathLists,
    applyLoginShellPath,
};
