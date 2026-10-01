// macos-desktop.js - macOS helpers for the computer agent.
//
// AppleScript values are passed through `on run argv`, never spliced into the
// script text, so window titles and app names cannot inject script code.

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const OSASCRIPT_TIMEOUT_MS = 15000;

const PRIVACY_PANES = Object.freeze({
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
});

function runAppleScript(lines, args, run = execFileAsync) {
    const scriptArgs = lines.flatMap((line) => ['-e', line]);
    return run('osascript', [...scriptArgs, ...args.map(String)], { timeout: OSASCRIPT_TIMEOUT_MS });
}

// Clicks the window's red close button through System Events, the same as a
// user would, so unsaved-changes prompts still appear. Needs Accessibility.
const CLOSE_WINDOW_SCRIPT = [
    'on run argv',
    'set targetPid to (item 1 of argv) as integer',
    'set targetTitle to item 2 of argv',
    'tell application "System Events"',
    'set targetProcess to first application process whose unix id is targetPid',
    'tell targetProcess',
    'set matchingWindows to (windows whose name is targetTitle)',
    'if (count of matchingWindows) is 0 then error "Window is no longer open"',
    'click (first button of (item 1 of matchingWindows) whose subrole is "AXCloseButton")',
    'end tell',
    'end tell',
    'end run',
];

async function requestMacWindowClose({ processId, title }, run = execFileAsync) {
    const pid = Number(processId);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid window process ID');
    await runAppleScript(CLOSE_WINDOW_SCRIPT, [pid, String(title || '')], run);
}

// `application X is running` does not launch the app, unlike `tell`.
const QUIT_APP_SCRIPT = [
    'on run argv',
    'set appName to item 1 of argv',
    'if application appName is running then',
    'tell application appName to quit',
    'return "quit"',
    'end if',
    'return "not-running"',
    'end run',
];

/** Asks the app to quit normally. Returns false when it was not running. */
async function quitMacApplication(appName, run = execFileAsync) {
    const { stdout } = await runAppleScript(QUIT_APP_SCRIPT, [appName], run);
    return String(stdout || '').trim() === 'quit';
}

/**
 * Reports a missing macOS privacy permission for a capability, or null.
 * `prompt` lets the first failure show Apple's own permission prompt.
 */
function checkMacPermission(kind, { systemPreferences, prompt = false }) {
    if (kind === 'accessibility') {
        if (systemPreferences.isTrustedAccessibilityClient(prompt)) return null;
        return {
            kind,
            settingsUrl: PRIVACY_PANES.accessibility,
            error: 'Aetheria ai needs Accessibility permission to control the mouse, keyboard and windows. '
                + 'Enable it in System Settings > Privacy & Security > Accessibility, then try again.',
        };
    }
    if (kind === 'screen') {
        // 'not-determined' is allowed through: the first capture triggers the prompt.
        const status = systemPreferences.getMediaAccessStatus('screen');
        if (status !== 'denied' && status !== 'restricted') return null;
        return {
            kind,
            settingsUrl: PRIVACY_PANES.screen,
            error: 'Aetheria ai needs Screen Recording permission to capture the screen. '
                + 'Enable it in System Settings > Privacy & Security > Screen Recording, then restart the app.',
        };
    }
    throw new Error(`Unknown macOS permission kind: ${kind}`);
}

module.exports = {
    requestMacWindowClose,
    quitMacApplication,
    checkMacPermission,
};
