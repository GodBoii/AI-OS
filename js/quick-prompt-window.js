// quick-prompt-window.js - system-wide hotkey that opens a small prompt box.
//
// Ctrl+Shift+Space (Cmd+Shift+Space on macOS) works from any app. The box
// floats above other windows; Enter sends the text to a new conversation in
// the main window, Esc or clicking elsewhere closes it.

const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space';
const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 132;
const MAX_PROMPT_LENGTH = 20000;

class QuickPromptWindow {
    constructor({ BrowserWindow, globalShortcut, screen, ipcMain, preloadPath, htmlPath, onSubmit, accelerator = DEFAULT_ACCELERATOR, logger = console }) {
        this.BrowserWindow = BrowserWindow;
        this.globalShortcut = globalShortcut;
        this.screen = screen;
        this.preloadPath = preloadPath;
        this.htmlPath = htmlPath;
        this.onSubmit = onSubmit;
        this.accelerator = accelerator;
        this.logger = logger;
        this.window = null;
        this.hotkeyRegistered = false;

        ipcMain.on('quick-prompt:submit', (event, text) => {
            if (!this._isOwnSender(event)) return;
            const prompt = typeof text === 'string' ? text.trim().slice(0, MAX_PROMPT_LENGTH) : '';
            this.hide();
            if (prompt) this.onSubmit(prompt);
        });
        ipcMain.on('quick-prompt:close', (event) => {
            if (this._isOwnSender(event)) this.hide();
        });
    }

    /** Registers or releases the global hotkey. Reports why it failed. */
    setHotkeyEnabled(enabled) {
        if (!enabled) {
            if (this.hotkeyRegistered) this.globalShortcut.unregister(this.accelerator);
            this.hotkeyRegistered = false;
            return { ok: true, enabled: false, accelerator: this.accelerator };
        }
        if (this.hotkeyRegistered) return { ok: true, enabled: true, accelerator: this.accelerator };

        let registered = false;
        try {
            registered = this.globalShortcut.register(this.accelerator, () => this.toggle());
        } catch (error) {
            this.logger.warn('[QuickPrompt] Hotkey registration threw:', error.message);
        }
        this.hotkeyRegistered = Boolean(registered);
        if (!registered) {
            return {
                ok: false,
                enabled: false,
                accelerator: this.accelerator,
                error: 'Another app is already using this shortcut.',
            };
        }
        return { ok: true, enabled: true, accelerator: this.accelerator };
    }

    toggle() {
        if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
            this.hide();
        } else {
            this.show();
        }
    }

    show() {
        const win = this._ensureWindow();
        const { x, y } = this._position();
        win.setBounds({ x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
        win.show();
        win.focus();
        win.webContents.send('quick-prompt:opened');
    }

    hide() {
        if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
    }

    dispose() {
        this.setHotkeyEnabled(false);
        if (this.window && !this.window.isDestroyed()) this.window.destroy();
        this.window = null;
    }

    _isOwnSender(event) {
        return Boolean(this.window && !this.window.isDestroyed() && event.sender === this.window.webContents);
    }

    // Upper third of the display under the cursor, like Spotlight.
    _position() {
        const display = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
        const area = display.workArea;
        return {
            x: Math.round(area.x + (area.width - WINDOW_WIDTH) / 2),
            y: Math.round(area.y + area.height * 0.28),
        };
    }

    _ensureWindow() {
        if (this.window && !this.window.isDestroyed()) return this.window;
        this.window = new this.BrowserWindow({
            width: WINDOW_WIDTH,
            height: WINDOW_HEIGHT,
            show: false,
            frame: false,
            transparent: true,
            resizable: false,
            movable: true,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            title: 'Quick prompt',
            webPreferences: {
                preload: this.preloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        });
        // Float above full-screen apps too.
        this.window.setAlwaysOnTop(true, 'pop-up-menu');
        this.window.on('blur', () => this.hide());
        this.window.loadFile(this.htmlPath);
        return this.window;
    }
}

module.exports = { QuickPromptWindow, DEFAULT_ACCELERATOR };
