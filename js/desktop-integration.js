// desktop-integration.js - taskbar / Dock behavior driven by agent activity.
//
//   progress bar      while any run is active (paused runs show as paused)
//   badge count       runs that finished while the window was in the background
//   attention         taskbar flash (Windows/Linux) or Dock bounce (macOS)
//   power blocker     keeps the OS from suspending the app during a run
//   thumbnail buttons Pause/Resume and Stop on the Windows taskbar preview
//   jump list / Dock  launch actions from app-actions.js
//
// Electron modules come in through the constructor so tests can pass fakes.

const { renderBadgePng, renderGlyphPng, badgeLabel } = require('./native-icons');
const { LAUNCH_ACTIONS, buildWindowsUserTasks } = require('./app-actions');

const DEFAULT_SETTINGS = Object.freeze({ taskbarActivity: true, keepAwake: true });

class DesktopIntegration {
    constructor({ app, nativeImage, powerSaveBlocker, Menu, platform, getWindow, onAction, logger = console }) {
        this.app = app;
        this.nativeImage = nativeImage;
        this.powerSaveBlocker = powerSaveBlocker;
        this.Menu = Menu;
        this.platform = platform;
        this.getWindow = getWindow;
        this.onAction = onAction || (() => {});
        this.logger = logger;

        this.settings = { ...DEFAULT_SETTINGS };
        this.activity = { activeCount: 0, paused: false, conversationIds: [] };
        this.unreadCount = 0;
        this.powerBlockerId = null;
        this.bounceId = null;
        this.defaultOverlay = null; // { image, description } set by main.js
        this._glyphs = null;
    }

    setDefaultOverlay(image, description) {
        this.defaultOverlay = image ? { image, description } : null;
    }

    setSettings(patch = {}) {
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
            if (typeof patch[key] === 'boolean') this.settings[key] = patch[key];
        }
        if (!this.settings.taskbarActivity) this.clearAttention();
        this._render();
    }

    onActivityChange(snapshot) {
        this.activity = { ...snapshot };
        this._render();
    }

    /** A run finished. Badge and attention only apply while the user is away. */
    notifyRunFinished({ backgrounded }) {
        if (!backgrounded || !this.settings.taskbarActivity) return;
        this.unreadCount += 1;
        this._renderBadge();
        this._requestAttention();
    }

    /** The user is looking at the window again. */
    clearAttention() {
        this.unreadCount = 0;
        this._renderBadge();
        const win = this._window();
        if (this.platform === 'darwin') {
            if (this.bounceId !== null && this.app.dock) this.app.dock.cancelBounce(this.bounceId);
            this.bounceId = null;
        } else if (win) {
            win.flashFrame(false);
        }
    }

    /** Jump list (Windows) and Dock menu (macOS). Linux uses .desktop actions. */
    installLaunchActions({ execPath, isPackaged, appPath }) {
        try {
            if (this.platform === 'win32') {
                const ok = this.app.setUserTasks(buildWindowsUserTasks({ execPath, isPackaged, appPath }));
                if (!ok) this.logger.warn('[DesktopIntegration] Windows rejected the jump list tasks.');
            } else if (this.platform === 'darwin' && this.app.dock) {
                const template = LAUNCH_ACTIONS.map((action) => ({
                    label: action.title,
                    click: () => this.onAction(action.id),
                }));
                this.app.dock.setMenu(this.Menu.buildFromTemplate(template));
            }
        } catch (error) {
            this.logger.warn('[DesktopIntegration] Could not install launch actions:', error.message);
        }
    }

    dispose() {
        this._setPowerBlocker(false);
        const win = this._window();
        if (win) {
            win.setProgressBar(-1);
            if (this.platform === 'win32') win.setThumbarButtons([]);
        }
    }

    // --- rendering ----------------------------------------------------------

    _window() {
        const win = this.getWindow();
        return win && !win.isDestroyed() ? win : null;
    }

    _render() {
        const active = this.activity.activeCount > 0;
        this._setPowerBlocker(active && this.settings.keepAwake);
        const win = this._window();
        if (!win) return;

        if (active && this.settings.taskbarActivity) {
            if (this.activity.paused) {
                win.setProgressBar(1, { mode: 'paused' });
            } else {
                // >1 means indeterminate on macOS; Windows takes the mode.
                win.setProgressBar(2, { mode: 'indeterminate' });
            }
        } else {
            win.setProgressBar(-1);
        }
        this._renderThumbar(win, active);
    }

    _renderThumbar(win, active) {
        if (this.platform !== 'win32') return;
        if (!active || !this.settings.taskbarActivity) {
            win.setThumbarButtons([]);
            return;
        }
        const glyphs = this._getGlyphs();
        const paused = this.activity.paused;
        const ok = win.setThumbarButtons([
            {
                tooltip: paused ? 'Resume agent' : 'Pause agent',
                icon: paused ? glyphs.play : glyphs.pause,
                click: () => this.onAction(paused ? 'resume-runs' : 'pause-runs'),
            },
            {
                tooltip: 'Stop agent',
                icon: glyphs.stop,
                click: () => this.onAction('stop-runs'),
            },
        ]);
        if (!ok) this.logger.warn('[DesktopIntegration] Windows rejected the thumbnail toolbar buttons.');
    }

    _renderBadge() {
        const count = this.unreadCount;
        if (this.platform === 'win32') {
            const win = this._window();
            if (!win) return;
            if (count > 0) {
                win.setOverlayIcon(this._image(renderBadgePng(count)), `${badgeLabel(count)} finished tasks`);
            } else if (this.defaultOverlay) {
                win.setOverlayIcon(this.defaultOverlay.image, this.defaultOverlay.description);
            } else {
                win.setOverlayIcon(null, '');
            }
            return;
        }
        // macOS Dock; on Linux only Unity-compatible launchers show it.
        if (typeof this.app.setBadgeCount === 'function') this.app.setBadgeCount(count);
    }

    _requestAttention() {
        if (this.platform === 'darwin') {
            if (this.app.dock && this.bounceId === null) this.bounceId = this.app.dock.bounce('informational');
            return;
        }
        const win = this._window();
        if (win) win.flashFrame(true);
    }

    _setPowerBlocker(enabled) {
        if (enabled && this.powerBlockerId === null) {
            this.powerBlockerId = this.powerSaveBlocker.start('prevent-app-suspension');
        } else if (!enabled && this.powerBlockerId !== null) {
            if (this.powerSaveBlocker.isStarted(this.powerBlockerId)) this.powerSaveBlocker.stop(this.powerBlockerId);
            this.powerBlockerId = null;
        }
    }

    _image(pngBuffer) {
        return this.nativeImage.createFromBuffer(pngBuffer, { scaleFactor: 2 });
    }

    _getGlyphs() {
        if (!this._glyphs) {
            this._glyphs = {
                pause: this._image(renderGlyphPng('pause')),
                play: this._image(renderGlyphPng('play')),
                stop: this._image(renderGlyphPng('stop')),
            };
        }
        return this._glyphs;
    }
}

module.exports = { DesktopIntegration, DEFAULT_SETTINGS };
