// app-actions.js - shortcuts the OS can start the app with.
//
// The Windows jump list, the macOS Dock menu and the Linux launcher's desktop
// actions all launch (or re-launch) the app with `--aetheria-action=<id>`.
// main.js reads the flag from argv (first launch or `second-instance`) and
// forwards the action to the renderer as `app-action`.

const ACTION_FLAG = '--aetheria-action=';

const LAUNCH_ACTIONS = Object.freeze([
    { id: 'new-chat', title: 'New chat', description: 'Start a new conversation' },
    { id: 'new-task', title: 'New task', description: 'Add a task to your list' },
    { id: 'voice-input', title: 'Voice input', description: 'Start dictating a message' },
    { id: 'quick-prompt', title: 'Quick prompt', description: 'Open the quick prompt box' },
]);

const LAUNCH_ACTION_IDS = new Set(LAUNCH_ACTIONS.map((action) => action.id));

/** The launch action in argv, or null. Unknown ids are ignored. */
function parseLaunchAction(argv) {
    if (!Array.isArray(argv)) return null;
    for (const arg of argv) {
        if (typeof arg !== 'string' || !arg.startsWith(ACTION_FLAG)) continue;
        const id = arg.slice(ACTION_FLAG.length).trim();
        if (LAUNCH_ACTION_IDS.has(id)) return id;
    }
    return null;
}

/**
 * Windows jump-list tasks. In development the Electron binary needs the app
 * directory as its first argument, the same way setAsDefaultProtocolClient is
 * registered in main.js.
 */
function buildWindowsUserTasks({ execPath, isPackaged, appPath }) {
    const prefix = isPackaged ? '' : `"${appPath}" `;
    return LAUNCH_ACTIONS.map((action) => ({
        program: execPath,
        arguments: `${prefix}${ACTION_FLAG}${action.id}`,
        iconPath: execPath,
        iconIndex: 0,
        title: action.title,
        description: action.description,
    }));
}

/** electron-builder `linux.desktop` block: one desktop action per launch action. */
function buildLinuxDesktopActions(executable = 'AppRun') {
    const toKey = (id) => id.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
    const desktopActions = {};
    for (const action of LAUNCH_ACTIONS) {
        desktopActions[toKey(action.id)] = {
            Name: action.title,
            Exec: `${executable} ${ACTION_FLAG}${action.id}`,
        };
    }
    return {
        entry: { Actions: `${Object.keys(desktopActions).join(';')};` },
        desktopActions,
    };
}

module.exports = {
    ACTION_FLAG,
    LAUNCH_ACTIONS,
    parseLaunchAction,
    buildWindowsUserTasks,
    buildLinuxDesktopActions,
};
