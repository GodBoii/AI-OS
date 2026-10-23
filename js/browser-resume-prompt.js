// Native recovery stays available even when the settings panel is closed.
function createBrowserResumePrompt({ dialog, getWindow }) {
    return async ({ signal }) => {
        const window = getWindow();
        if (!window || window.isDestroyed() || signal.aborted) return false;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        const result = await dialog.showMessageBox(window, {
            type: 'question',
            title: 'Resume browser automation',
            message: 'An agent task needs the browser, but browser actions are paused.',
            detail: 'Resume to let this task continue. Keep paused if you are still signing in or using the browser yourself. You can also resume in Settings > Browser, even when Chrome is closed.',
            buttons: ['Resume browser actions', 'Keep paused'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            signal,
        });
        return !signal.aborted && result.response === 0;
    };
}

module.exports = { createBrowserResumePrompt };
