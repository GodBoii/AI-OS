// js/computer-control-handler.js
// Computer Control Handler for AI Agent Desktop Automation

const { screen, clipboard, desktopCapturer, powerMonitor, systemPreferences, shell, net } = require('electron');
// nut-js is loaded on first use (see _nut()). Its Linux binary links against
// libXtst; a missing system library must not stop the whole app from starting.
const { activeWindow } = require('active-win');
const { windowManager } = require('node-window-manager');
const loudness = require('loudness');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const chokidar = require('chokidar');
const linuxDesktop = require('./linux-desktop');
const macosDesktop = require('./macos-desktop');
const { SystemStatus } = require('./system-status');
const windowsAccessibility = require('./windows-accessibility');
const { WindowsAccessibilityWorker } = require('./windows-accessibility-worker');
const { getTypingSpeed, typeWithSpeed, pasteWithClipboard } = require('./typing-input');
const { unicodeTypingScript } = require('./windows-keyboard');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Capabilities that need extra OS support outside Windows.
const INPUT_ACTIONS = new Set(['move_mouse', 'click_mouse', 'type_text', 'press_hotkey', 'scroll', 'drag_drop', 'perform_element_action']);
const WINDOW_ACTIONS = new Set(['list_windows', 'focus_window', 'resize_window', 'minimize_window', 'maximize_window', 'close_window']);
const SCREEN_CAPTURE_ACTIONS = new Set(['take_screenshot', 'ocr_screen', 'get_window_state', 'get_screen_elements', 'find_element_by_text']);

class ComputerControlHandler {
    constructor(eventEmitter, appDataPath, getAuthTokenFunc, settings = null) {
        this.eventEmitter = eventEmitter;
        this.appDataPath = appDataPath;
        this.getAuthToken = getAuthTokenFunc;
        this.settings = settings;
        this.isEnabled = false;
        this.permissionSource = null;
        this.allowedScopes = [];
        this.defaultScope = this._normalizePath(os.homedir());
        this.fileWatchers = new Map();
        this.platform = process.platform; // 'win32', 'darwin', 'linux'
        this.env = process.env;
        this._nutModule = null;
        this._systemStatusService = null;
        this.systemLocked = false;
        // Each macOS privacy prompt / settings pane is shown once per session.
        this._macPermissionPrompted = new Set();
        this._commandQueue = Promise.resolve();
        this._pendingCommands = new Map();
        this._completedResults = new Map();
        this._completedResultSizes = new Map();
        this._completedResultBytes = 0;
        this._observations = new Map();
        this._screenshots = new Map();
        this._ocrWorkerPromise = null;
        this._accessibilityWorker = null;
        
        console.log(`ComputerControlHandler: Initialized for platform: ${this.platform}`);
    }

    initialize() {
        console.log('ComputerControlHandler: Setting up event listeners...');
        
        // Listen for computer control commands from Python backend
        this.eventEmitter.on('execute-computer-command', async (commandPayload) => {
            console.log('ComputerControlHandler: Received command:', commandPayload.action);
            await this.handleCommand(commandPayload);
        });
    }

    async _uploadScreenshot(screenshotBase64) {
        try {
            const token = await this.getAuthToken();
            if (!token) {
                console.error('ComputerControlHandler: No auth token available for screenshot upload');
                return null;
            }

            const axios = require('axios');
            const config = require('./config');

            const imageBuffer = Buffer.from(screenshotBase64, 'base64');
            const fileName = `computer-screenshot-${Date.now()}.png`;

            // Request signed upload URL from backend (same as browser tools)
            const urlResponse = await axios.post(
                `${config.backend.url}/api/generate-upload-url`,
                { fileName },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );

            const { signedURL, path } = urlResponse.data;
            if (!signedURL || !path) {
                console.error('ComputerControlHandler: Backend did not return valid signed URL or path');
                return null;
            }

            // Upload to Supabase using signed URL
            await axios.put(signedURL, imageBuffer, {
                headers: { 'Content-Type': 'image/png' },
                timeout: 15000
            });

            console.log(`ComputerControlHandler: Screenshot successfully uploaded to Supabase path: ${path}`);
            return path;

        } catch (error) {
            const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error('ComputerControlHandler: Screenshot upload error:', errorMessage);
            return null;
        }
    }

    async handleCommand(commandPayload) {
        if (!commandPayload || typeof commandPayload.action !== 'string' || typeof commandPayload.request_id !== 'string') {
            this._emitResult(commandPayload?.request_id, { status: 'error', error: 'action and request_id are required strings' });
            return;
        }
        const id = commandPayload.request_id;
        if (this._completedResults.has(id)) {
            this._emitResult(id, this._completedResults.get(id));
            return;
        }
        if (this._pendingCommands.has(id)) {
            const result = await this._pendingCommands.get(id);
            this._emitResult(id, result);
            return;
        }
        const job = this._commandQueue.then(async () => {
            let result;
            const capture = response => { if (response.request_id === id) result = response.result; };
            this.eventEmitter.on('computer-command-result', capture);
            try {
                await this._executeCommand(commandPayload);
                return result;
            } finally {
                this.eventEmitter.off('computer-command-result', capture);
            }
        });
        this._pendingCommands.set(id, job);
        this._commandQueue = job.catch(() => {});
        try { await job; } finally { this._pendingCommands.delete(id); }
    }

    async _executeCommand(commandPayload) {
        const { action, request_id } = commandPayload;
        console.log(`ComputerControlHandler: Processing '${action}' with request_id: ${request_id}`);

        if (!this.isEnabled && action !== 'get_status' && action !== 'request_permission') {
            this._emitResult(request_id, {
                status: 'error',
                error: 'Computer control is not enabled. Use request_permission first.'
            });
            return;
        }

        try {
            if (commandPayload.expires_at_ms !== undefined &&
                (!Number.isFinite(commandPayload.expires_at_ms) || Date.now() >= commandPayload.expires_at_ms)) {
                this._emitResult(request_id, { status: 'error', error: 'Command expired before execution. No action was taken.', outcome: 'not_executed' });
                return;
            }
            const platformBlocker = this._getPlatformBlocker(action);
            if (platformBlocker) {
                this._emitResult(request_id, { status: 'error', error: platformBlocker });
                return;
            }

            if (INPUT_ACTIONS.has(action) && action !== 'perform_element_action' && commandPayload.window_id !== undefined) {
                await this._prepareInputWindow(commandPayload.window_id);
            }
            if (INPUT_ACTIONS.has(action) && commandPayload.screenshot_id) {
                commandPayload = await this._mapScreenshotInput(commandPayload);
            }
            if ((INPUT_ACTIONS.has(action) && action !== 'perform_element_action') || (WINDOW_ACTIONS.has(action) && action !== 'list_windows')) {
                this._observations.clear();
            }
            if (INPUT_ACTIONS.has(action) || (WINDOW_ACTIONS.has(action) && action !== 'list_windows')) this._screenshots.clear();

            let result;

            switch (action) {
                // ===== PERMISSION & STATUS =====
                case 'get_status':
                    result = {
                        status: 'success',
                        enabled: this.isEnabled,
                        permission_source: this.permissionSource,
                        scopes: [...this.allowedScopes],
                        default_scope: this.defaultScope,
                        platform: this.platform,
                        screen_size: screen.getPrimaryDisplay().size,
                        locked: this.systemLocked,
                        capabilities: {
                            accessibility: this.platform === 'win32',
                            accessibility_actions: this.platform === 'win32',
                            window_targeting: true,
                            screenshot_mapping: true,
                            horizontal_scroll: true,
                            capture_source: 'visible_desktop',
                            window_capture_requires_foreground: true,
                        },
                        displays: screen.getAllDisplays().map(display => ({
                            id: String(display.id), bounds: display.bounds, scale_factor: display.scaleFactor,
                            coordinate_space: 'screen_logical',
                        }))
                    };
                    break;

                case 'request_permission':
                    this._grantPermission('llm_tool');
                    result = {
                        status: 'success',
                        message: 'Computer control enabled',
                        permission_source: this.permissionSource,
                        scopes: [...this.allowedScopes],
                        platform: this.platform
                    };
                    break;

                // ===== PERCEPTION LAYER =====
                case 'take_screenshot':
                    result = await this._takeScreenshot(commandPayload);
                    break;

                case 'get_active_window':
                    result = await this._getActiveWindow();
                    break;

                case 'get_cursor_position':
                    result = await this._getCursorPosition();
                    break;

                case 'read_clipboard':
                    result = await this._readClipboard();
                    break;

                case 'ocr_screen':
                    result = await this._ocrScreen(commandPayload);
                    break;

                // ===== INTERACTION LAYER =====
                case 'move_mouse':
                    result = await this._moveMouse(commandPayload);
                    break;

                case 'click_mouse':
                    result = await this._clickMouse(commandPayload);
                    break;

                case 'type_text':
                    result = await this._typeText(commandPayload);
                    break;

                case 'press_hotkey':
                    result = await this._pressHotkey(commandPayload);
                    break;

                case 'scroll':
                    result = await this._scroll(commandPayload);
                    break;

                case 'drag_drop':
                    result = await this._dragDrop(commandPayload);
                    break;

                // ===== WINDOW MANAGEMENT =====
                case 'list_windows':
                    result = await this._listWindows();
                    break;

                case 'focus_window':
                    result = await this._focusWindow(commandPayload);
                    break;

                case 'resize_window':
                    result = await this._resizeWindow(commandPayload);
                    break;

                case 'minimize_window':
                    result = await this._minimizeWindow(commandPayload);
                    break;

                case 'maximize_window':
                    result = await this._maximizeWindow(commandPayload);
                    break;

                case 'close_window':
                    result = await this._closeWindow(commandPayload);
                    break;

                // ===== SYSTEM LAYER =====
                case 'run_command':
                    result = await this._runCommand(commandPayload);
                    break;

                case 'list_files':
                    result = await this._listFiles(commandPayload);
                    break;

                case 'read_file':
                    result = await this._readFile(commandPayload);
                    break;

                case 'write_file':
                    result = await this._writeFile(commandPayload);
                    break;

                case 'delete_file':
                    result = await this._deleteFile(commandPayload);
                    break;

                case 'create_directory':
                    result = await this._createDirectory(commandPayload);
                    break;

                case 'open_application':
                    result = await this._openApplication(commandPayload);
                    break;

                case 'close_application':
                    result = await this._closeApplication(commandPayload);
                    break;

                case 'get_volume':
                    result = await this._getVolume();
                    break;

                case 'set_volume':
                    result = await this._setVolume(commandPayload);
                    break;

                case 'get_system_info':
                    result = await this._getSystemInfo();
                    break;

                case 'list_installed_apps':
                    result = await this._listInstalledApplications();
                    break;

                case 'get_screen_elements':
                    result = await this._getScreenElements(commandPayload);
                    break;

                case 'find_element_by_text':
                    result = await this._findElementByText(commandPayload);
                    break;

                case 'get_window_state':
                    result = await this._getWindowState(commandPayload);
                    break;

                case 'perform_element_action':
                    result = await this._performElementAction(commandPayload);
                    break;

                case 'watch_directory':
                    result = await this._watchDirectory(commandPayload);
                    break;

                case 'stop_watching':
                    result = await this._stopWatching(commandPayload);
                    break;

                // ===== OS STATUS & CONTROL =====
                case 'get_battery_status':
                    result = await this._systemStatus().getBatteryStatus();
                    break;

                case 'get_brightness':
                    result = await this._systemStatus().getBrightness();
                    break;

                case 'set_brightness':
                    result = await this._systemStatus().setBrightness(commandPayload.level);
                    break;

                case 'get_network_status':
                    result = await this._systemStatus().getNetworkStatus();
                    break;

                case 'get_bluetooth_status':
                    result = await this._systemStatus().getBluetoothStatus();
                    break;

                case 'get_focus_status':
                    result = await this._systemStatus().getFocusStatus();
                    break;

                case 'list_processes':
                    result = await this._systemStatus().listProcesses({
                        name: commandPayload.name,
                        limit: commandPayload.limit,
                    });
                    break;

                case 'kill_process':
                    result = await this._systemStatus().killProcess({
                        pid: commandPayload.pid,
                        force: commandPayload.force === true,
                    });
                    break;

                case 'open_path':
                    result = await this._openPath(commandPayload);
                    break;

                case 'reveal_in_folder':
                    result = await this._revealInFolder(commandPayload);
                    break;

                default:
                    result = {
                        status: 'error',
                        error: `Unknown computer control command: ${action}`
                    };
            }

            if (result && !result.metadata) {
                const metadata = await this._buildToolResultMetadata(action, commandPayload, result);
                if (metadata) {
                    result.metadata = metadata;
                }
            }

            this._emitResult(request_id, result);
        } catch (error) {
            console.error(`ComputerControlHandler: Error executing '${action}':`, error);
            this._emitResult(request_id, {
                status: 'error',
                error: error.message,
                stack: error.stack
            });
        }
    }

    // ===== OS STATUS, FILES AND LOCK STATE =====

    _systemStatus() {
        if (!this._systemStatusService) {
            this._systemStatusService = new SystemStatus({
                platform: this.platform,
                execFile: execFileAsync,
                runPowerShell: (script, options) => this._runPowerShell(script, options),
                fsPromises: fs,
                powerMonitor,
                net,
                homeDir: os.homedir(),
            });
        }
        return this._systemStatusService;
    }

    /** Opens a file or folder with its default app. Restricted to the scope. */
    async _openPath(commandPayload) {
        const scopeCheck = await this._ensurePathInScope(commandPayload.path, 'open_path');
        if (!scopeCheck.ok) return { status: 'error', error: scopeCheck.error };
        try {
            await fs.access(scopeCheck.path);
        } catch {
            return { status: 'error', error: `Path does not exist: ${scopeCheck.path}` };
        }
        const failure = await shell.openPath(scopeCheck.path);
        if (failure) return { status: 'error', error: failure };
        return { status: 'success', message: `Opened ${scopeCheck.path}`, path: scopeCheck.path };
    }

    /** Shows a file selected in Explorer / Finder / the file manager. */
    async _revealInFolder(commandPayload) {
        const scopeCheck = await this._ensurePathInScope(commandPayload.path, 'reveal_in_folder');
        if (!scopeCheck.ok) return { status: 'error', error: scopeCheck.error };
        try {
            await fs.access(scopeCheck.path);
        } catch {
            return { status: 'error', error: `Path does not exist: ${scopeCheck.path}` };
        }
        shell.showItemInFolder(scopeCheck.path);
        return { status: 'success', message: `Showed ${scopeCheck.path} in its folder`, path: scopeCheck.path };
    }

    /**
     * While the screen is locked (or the machine is asleep) the agent must
     * not click, type, move windows or capture the screen: nobody is
     * watching, and on some systems it would act on the lock screen itself.
     */
    setSystemLocked(locked) {
        const next = Boolean(locked);
        if (this.systemLocked !== next) {
            this._observations.clear();
            this._screenshots.clear();
        }
        this.systemLocked = next;
    }

    // ===== PLATFORM READINESS =====

    /**
     * Returns an error message when this OS cannot run the action right now,
     * or null. Windows needs nothing extra, so it always returns null there.
     */
    _getPlatformBlocker(action) {
        if (this.systemLocked && (INPUT_ACTIONS.has(action) || WINDOW_ACTIONS.has(action) || SCREEN_CAPTURE_ACTIONS.has(action))) {
            return 'The computer is locked or asleep, so the agent has paused screen, mouse, keyboard and window actions. '
                + 'They resume automatically when the user unlocks the computer.';
        }
        if (this.platform === 'linux') {
            if ((INPUT_ACTIONS.has(action) || WINDOW_ACTIONS.has(action)) && linuxDesktop.isWaylandSession(this.env)) {
                return 'This action needs an X11 session. Wayland does not allow one app to control the mouse, keyboard '
                    + 'or windows of other apps. Log in with an "Xorg"/"X11" session to use it.';
            }
            return null;
        }

        if (this.platform === 'darwin') {
            let kind = null;
            if (INPUT_ACTIONS.has(action) || WINDOW_ACTIONS.has(action)) kind = 'accessibility';
            else if (SCREEN_CAPTURE_ACTIONS.has(action)) kind = 'screen';
            if (!kind) return null;

            const firstTime = !this._macPermissionPrompted.has(kind);
            const missing = macosDesktop.checkMacPermission(kind, {
                systemPreferences,
                // Apple's Accessibility prompt has its own "Open System Settings" button.
                prompt: firstTime && kind === 'accessibility',
            });
            if (!missing) return null;

            if (firstTime) {
                this._macPermissionPrompted.add(kind);
                if (kind === 'screen') {
                    shell.openExternal(missing.settingsUrl).catch((error) => {
                        console.warn('ComputerControlHandler: Could not open Screen Recording settings:', error.message);
                    });
                }
            }
            return missing.error;
        }

        return null;
    }

    _nut() {
        if (!this._nutModule) {
            try {
                this._nutModule = require('@nut-tree-fork/nut-js');
                this._nutModule.keyboard.config.autoDelayMs = 0;
                this._nutModule.mouse.config.autoDelayMs = 0;
            } catch (error) {
                const hint = this.platform === 'linux'
                    ? ' On Linux this usually means libxtst is missing (for example: sudo apt install libxtst6).'
                    : '';
                throw new Error(`Mouse and keyboard control is unavailable: ${error.message}.${hint}`);
            }
        }
        return this._nutModule;
    }

    // ===== PERCEPTION METHODS =====

    _normalizePath(inputPath) {
        return path.resolve(String(inputPath || '').trim());
    }

    _normalizeForCompare(inputPath) {
        const normalized = this._normalizePath(inputPath);
        return this.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    _isPathInAllowedScopes(targetPath) {
        if (!this.allowedScopes.length) return false;

        const target = this._normalizeForCompare(targetPath);
        return this.allowedScopes.some((scopePath) => {
            const scope = this._normalizeForCompare(scopePath);
            if (target === scope) return true;
            return target.startsWith(scope + path.sep);
        });
    }

    async _ensurePathInScope(targetPath, operation) {
        if (!targetPath) {
            return {
                ok: false,
                error: `Missing path for ${operation}`
            };
        }

        const normalized = this._normalizePath(targetPath);
        if (!this._isPathInAllowedScopes(normalized)) {
            return {
                ok: false,
                error: `Access denied. '${operation}' is restricted to selected scope(s): ${this.allowedScopes.join(', ')}`
            };
        }

        return { ok: true, path: normalized };
    }

    _grantPermission(source = 'manual') {
        this.isEnabled = true;
        this.permissionSource = source;
        if (!this.allowedScopes.length) {
            this.allowedScopes = [this.defaultScope];
        }
    }

    getAccessState() {
        return {
            enabled: this.isEnabled,
            permissionSource: this.permissionSource,
            scopes: [...this.allowedScopes],
            defaultScope: this.defaultScope,
            platform: this.platform
        };
    }

    grantManualPermission() {
        this._grantPermission('manual_ui');
        return this.getAccessState();
    }

    setPrimaryScope(scopePath) {
        const normalized = this._normalizePath(scopePath);
        this.allowedScopes = [normalized];
        return this.getAccessState();
    }

    _isPlaceholderDirectory(rawDirectory) {
        const value = String(rawDirectory || '').trim().toLowerCase().replace(/\\/g, '/');
        if (!value) return true;

        const placeholders = new Set([
            '/path/to/folder',
            'path/to/folder',
            '/path/to/directory',
            'path/to/directory',
            '/path/to/file',
            'path/to/file',
            '/your/folder/path',
            'your/folder/path',
            '<path>',
            '<directory>'
        ]);
        if (placeholders.has(value)) return true;

        if (value.includes('path/to/')) return true;
        if (value === '/' || value === '\\') return true;
        if (value === '.' || value === './' || value === '.\\') return true;
        if (value === 'current folder' || value === 'current directory') return true;
        if (value === 'selected folder' || value === 'selected directory') return true;
        return false;
    }

    _resolveDirectoryForList(rawDirectory) {
        const primaryScope = this.allowedScopes[0] || this.defaultScope;
        const value = String(rawDirectory || '').trim();

        if (this._isPlaceholderDirectory(value)) {
            return primaryScope;
        }

        // On Windows, "/" often appears from model-generated Unix-style defaults.
        // Treat drive root requests as ambiguous and keep the user-selected scope.
        if (this.platform === 'win32') {
            const normalized = value.replace(/\//g, '\\').trim().toLowerCase();
            if (normalized === '\\') {
                return primaryScope;
            }
            if (/^[a-z]:\\?$/.test(normalized)) {
                return primaryScope;
            }
        }

        // Resolve relative paths against selected scope for better UX.
        if (!path.isAbsolute(value) && primaryScope) {
            return path.join(primaryScope, value);
        }

        return value;
    }

    _sanitizeFileSegment(value, fallback = 'output') {
        const cleaned = String(value || fallback)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim()
            .replace(/^-+|-+$/g, '');
        return cleaned || fallback;
    }

    async _saveComputerOutputBuffer(buffer, commandPayload, filename) {
        const conversationId = this._sanitizeFileSegment(commandPayload.conversation_id || 'unknown-session', 'unknown-session');
        const messageId = this._sanitizeFileSegment(commandPayload.message_id || 'unknown-message', 'unknown-message');
        const outputId = crypto.randomUUID();
        const safeName = this._sanitizeFileSegment(filename, 'output');
        const relativePath = path.join('computer-outputs', conversationId, messageId, outputId, safeName);
        const fullPath = path.join(this.appDataPath, relativePath);

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, buffer);

        return {
            outputId,
            relativePath,
            fullPath,
            size: buffer.length
        };
    }

    async _saveComputerOutputJson(payload, commandPayload, filename) {
        const jsonBuffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
        return this._saveComputerOutputBuffer(jsonBuffer, commandPayload, filename);
    }

    async _buildToolResultMetadata(action, commandPayload, result) {
        const base = {
            kind: 'computer_tool_output',
            action,
            session_id: commandPayload.conversation_id || null,
            message_id: commandPayload.message_id || null,
            delegation_id: commandPayload.delegation_id || null,
            delegated_agent: commandPayload.delegated_agent || null,
            preview_type: 'none',
            title: action.replace(/_/g, ' '),
            inline_safe: true
        };

        if (!result || result.status !== 'success') {
            if (action === 'run_command') {
                const saved = await this._saveComputerOutputJson({
                    command: commandPayload.command || '',
                    stdout: result.stdout || '',
                    stderr: result.stderr || '',
                    error: result.error || '',
                    status: result.status || 'error'
                }, commandPayload, 'command-output.json');
                return {
                    ...base,
                    output_id: saved.outputId,
                    preview_type: 'terminal',
                    title: 'Command output',
                    filename: 'command-output.json',
                    mime_type: 'application/json',
                    relativePath: saved.relativePath,
                    size: saved.size,
                    isText: true,
                    isMedia: false,
                    inline: {
                        command: commandPayload.command || '',
                        exit_code: null,
                        stdout_preview: String(result.stdout || '').slice(0, 1200),
                        stderr_preview: String(result.stderr || result.error || '').slice(0, 1200),
                        status: result.status || 'error'
                    }
                };
            }
            return null;
        }

        switch (action) {
            case 'get_status':
                return {
                    ...base,
                    preview_type: 'kv',
                    title: 'Computer status',
                    inline: {
                        enabled: result.enabled,
                        permission_source: result.permission_source,
                        scope: Array.isArray(result.scopes) ? result.scopes[0] || null : null,
                        platform: result.platform,
                        screen_size: result.screen_size || null
                    }
                };
            case 'get_active_window':
                return {
                    ...base,
                    preview_type: 'kv',
                    title: 'Active window',
                    inline: {
                        title: result.title,
                        owner: result.owner,
                        bounds: result.bounds || null,
                        platform: result.platform || null
                    }
                };
            case 'get_cursor_position':
                return {
                    ...base,
                    preview_type: 'kv',
                    title: 'Cursor position',
                    inline: {
                        x: result.x,
                        y: result.y
                    }
                };
            case 'read_clipboard':
                return {
                    ...base,
                    preview_type: 'text',
                    title: 'Clipboard',
                    inline_safe: false,
                    inline: {
                        text_preview: String(result.text || '').slice(0, 280),
                        has_image: result.has_image,
                        redacted: true
                    }
                };
            case 'ocr_screen': {
                const saved = await this._saveComputerOutputJson({
                    text: result.text || '',
                    screenshot_path: result.screenshot_path || null
                }, commandPayload, 'ocr-screen.json');
                return {
                    ...base,
                    output_id: saved.outputId,
                    preview_type: 'text',
                    title: 'OCR screen text',
                    filename: 'ocr-screen.json',
                    mime_type: 'application/json',
                    relativePath: saved.relativePath,
                    size: saved.size,
                    isText: true,
                    isMedia: false,
                    inline: {
                        text_preview: String(result.text || '').slice(0, 1200)
                    }
                };
            }
            case 'list_windows':
                return {
                    ...base,
                    preview_type: 'list',
                    title: 'Open windows',
                    inline: {
                        count: result.count || 0,
                        items: Array.isArray(result.windows) ? result.windows.slice(0, 8) : []
                    }
                };
            case 'list_files':
                return {
                    ...base,
                    preview_type: 'list',
                    title: 'Files',
                    inline: {
                        count: result.count || 0,
                        items: Array.isArray(result.files) ? result.files.slice(0, 10) : []
                    }
                };
            case 'run_command': {
                const saved = await this._saveComputerOutputJson({
                    command: commandPayload.command || '',
                    stdout: result.stdout || '',
                    stderr: result.stderr || '',
                    status: result.status || 'success'
                }, commandPayload, 'command-output.json');
                return {
                    ...base,
                    output_id: saved.outputId,
                    preview_type: 'terminal',
                    title: 'Command output',
                    filename: 'command-output.json',
                    mime_type: 'application/json',
                    relativePath: saved.relativePath,
                    size: saved.size,
                    isText: true,
                    isMedia: false,
                    inline: {
                        command: commandPayload.command || '',
                        stdout_preview: String(result.stdout || '').slice(0, 1200),
                        stderr_preview: String(result.stderr || '').slice(0, 1200),
                        status: result.status || 'success'
                    }
                };
            }
            case 'get_volume':
                return {
                    ...base,
                    preview_type: 'kv',
                    title: 'Volume',
                    inline: {
                        volume: result.volume,
                        muted: result.muted
                    }
                };
            case 'get_system_info':
                return {
                    ...base,
                    preview_type: 'kv',
                    title: 'System info',
                    inline: {
                        platform: result.platform,
                        arch: result.arch,
                        hostname: result.hostname,
                        cpu_count: result.cpu_count || result.cpu || null,
                        displays: result.displays || null
                    }
                };
            case 'list_installed_apps':
                return {
                    ...base,
                    preview_type: 'list',
                    title: 'Installed applications',
                    inline: {
                        count: result.count || 0,
                        platform: result.platform || null,
                        items: Array.isArray(result.apps) ? result.apps.slice(0, 15).map(a => ({ name: a.name, type: a.type })) : []
                    }
                };
            default:
                return {
                    ...base,
                    preview_type: 'text',
                    title: action.replace(/_/g, ' '),
                    inline: {
                        text_preview: result.message || 'Completed successfully'
                    }
                };
        }
    }

    async _takeScreenshot(commandPayload) {
        const capture = await this._captureScreen(commandPayload);
        const screenshot = capture.image.toPNG();
        const screenshotBase64 = screenshot.toString('base64');
        const localSave = await this._saveComputerOutputBuffer(screenshot, commandPayload, `screenshot-${Date.now()}.png`);
        
        const screenshotPath = await this._uploadScreenshot(screenshotBase64);
        const screenshotId = crypto.randomUUID();
        this._screenshots.set(screenshotId, { ...capture, image: undefined, created: Date.now() });
        if (this._screenshots.size > 16) this._screenshots.delete(this._screenshots.keys().next().value);

        return {
            status: 'success',
            screenshot_path: screenshotPath,
            ...(screenshotPath ? {} : { screenshot_base64: screenshotBase64 }),
            screenshot_id: screenshotId,
            width: capture.width,
            height: capture.height,
            coordinate_space: capture.coordinateSpace,
            image_origin: capture.origin,
            display_id: capture.displayId,
            window_id: capture.windowId,
            capture_source: 'visible_desktop',
            metadata: {
                kind: 'computer_tool_output',
                output_id: localSave.outputId,
                action: 'take_screenshot',
                session_id: commandPayload.conversation_id || null,
                message_id: commandPayload.message_id || null,
                delegation_id: commandPayload.delegation_id || null,
                delegated_agent: commandPayload.delegated_agent || null,
                title: 'Captured screen',
                preview_type: 'image',
                filename: path.basename(localSave.relativePath),
                mime_type: 'image/png',
                relativePath: localSave.relativePath,
                remotePath: screenshotPath || null,
                size: localSave.size,
                isMedia: true,
                isText: false,
                inline_safe: true,
                inline: {
                    width: capture.width,
                    height: capture.height
                }
            }
        };
    }

    async _getActiveWindow() {
        try {
            const window = await activeWindow();
            if (!window) {
                return { status: 'error', error: 'No active window found' };
            }

            return {
                status: 'success',
                id: window.id,
                title: window.title,
                owner: window.owner.name,
                bounds: window.bounds,
                platform: window.platform
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _getCursorPosition() {
        const dipPoint = screen.getCursorScreenPoint();
        const point = this.platform === 'win32' ? screen.dipToScreenPoint(dipPoint) : dipPoint;
        return {
            status: 'success',
            x: point.x,
            y: point.y,
            coordinate_space: this.platform === 'win32' ? 'screen_physical' : 'screen_logical'
        };
    }

    async _readClipboard() {
        const text = clipboard.readText();
        const image = clipboard.readImage();
        
        return {
            status: 'success',
            text: text || '',
            has_image: !image.isEmpty(),
            formats: clipboard.availableFormats()
        };
    }

    async _ocrScreen(commandPayload) {
        const capture = await this._captureScreen(commandPayload);
        if (!this._ocrWorkerPromise) {
            this._ocrWorkerPromise = (async () => {
                const cachePath = path.join(this.appDataPath, 'ocr-cache');
                await fs.mkdir(cachePath, { recursive: true });
                return require('tesseract.js').createWorker('eng', undefined, { cachePath });
            })().catch(error => {
                this._ocrWorkerPromise = null;
                throw error;
            });
        }
        const worker = await this._ocrWorkerPromise;
        await worker.setParameters({ tessedit_pageseg_mode: require('tesseract.js').PSM.SPARSE_TEXT });
        const png = capture.image.toPNG();
        const localCapture = await this._saveComputerOutputBuffer(png, commandPayload, 'ocr-capture.png');
        const { data } = await worker.recognize(png, {}, { text: true, blocks: true });
        const words = (data.blocks || []).flatMap(block => block.paragraphs || [])
            .flatMap(paragraph => paragraph.lines || []).flatMap(line => line.words || []).slice(0, 1000)
            .map(word => ({ text: word.text, confidence: word.confidence,
                x: Math.round(capture.origin.x + (word.bbox.x0 + word.bbox.x1) / 2),
                y: Math.round(capture.origin.y + (word.bbox.y0 + word.bbox.y1) / 2),
                bounds: word.bbox }));
        return { status: 'success', text: data.text, confidence: data.confidence,
            words, capture_relative_path: localCapture.relativePath,
            coordinate_space: capture.coordinateSpace, image_origin: capture.origin, window_id: capture.windowId };
    }

    async _physicalWindowBounds(window) {
        if (this.platform !== 'win32') return window.getBounds();
        // GetWindowRect in the Electron addon can return DPI-virtualized values.
        // UIA returns physical pixels, matching nut-js input and the captured image.
        const { stdout } = await this._runAccessibilityScript(windowsAccessibility.buildScript({ windowId: Number(window.id), limit: 1 }));
        const result = JSON.parse(stdout);
        if (result.status !== 'success' || !result.bounds) throw new Error(result.error || 'Window bounds unavailable');
        return Object.fromEntries(Object.entries(result.bounds).map(([key, value]) => [key, Math.round(value)]));
    }

    async _captureScreen(commandPayload) {
        let window = null;
        let windowBounds = null;
        if (commandPayload.window_id !== undefined) {
            window = await this._prepareInputWindow(commandPayload.window_id);
            windowBounds = await this._physicalWindowBounds(window);
        }
        const displays = screen.getAllDisplays();
        let display;
        if (commandPayload.display_id !== undefined) {
            display = displays.find(item => String(item.id) === String(commandPayload.display_id));
            if (!display) throw new Error('Requested display not found');
        } else if (windowBounds) {
            const physicalCenter = { x: Math.round(windowBounds.x + windowBounds.width / 2), y: Math.round(windowBounds.y + windowBounds.height / 2) };
            const center = this.platform === 'win32' ? screen.screenToDipPoint(physicalCenter) : physicalCenter;
            display = screen.getDisplayNearestPoint(center);
        } else {
            display = screen.getPrimaryDisplay();
        }
        const bounds = this.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : display.bounds;
        const sources = await desktopCapturer.getSources({ types: ['screen'],
            thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } });
        const source = sources.find(item => String(item.display_id) === String(display.id));
        if (!source || source.thumbnail.isEmpty()) throw new Error('Requested display has no screen capture source');
        // Normalize image pixels to the input coordinate system, including Retina displays.
        let image = source.thumbnail.resize({ width: bounds.width, height: bounds.height });
        let origin = { x: bounds.x, y: bounds.y };
        if (windowBounds) {
            const rect = { x: windowBounds.x - bounds.x, y: windowBounds.y - bounds.y, width: windowBounds.width, height: windowBounds.height };
            if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > bounds.width || rect.y + rect.height > bounds.height) {
                throw new Error('Window extends outside the selected display. Move it onto one display before capturing.');
            }
            image = image.crop(rect);
            origin = { x: windowBounds.x, y: windowBounds.y };
        }
        const size = image.getSize();
        return { image, width: size.width, height: size.height, origin, displayId: display.id,
            windowId: window ? Number(window.id) : null, windowBounds,
            coordinateSpace: this.platform === 'win32' ? 'screen_physical' : 'screen_logical' };
    }

    async _mapScreenshotInput(payload) {
        const snapshot = this._screenshots.get(payload.screenshot_id);
        if (!snapshot || Date.now() - snapshot.created > 30000) throw new Error('Screenshot expired or invalidated. Capture again.');
        if (snapshot.windowId !== null) {
            if (payload.window_id !== snapshot.windowId) throw new Error('Supply the screenshot target window_id');
            const window = await this._findManagedWindow(snapshot.windowId);
            const bounds = window && await this._physicalWindowBounds(window);
            if (!bounds || ['x', 'y', 'width', 'height'].some(key => bounds[key] !== snapshot.windowBounds[key])) {
                throw new Error('Window moved or resized since the screenshot. Capture again.');
            }
        }
        const mapped = { ...payload };
        for (const [xKey, yKey] of [['x', 'y'], ['from_x', 'from_y'], ['to_x', 'to_y']]) {
            if (payload[xKey] === undefined && payload[yKey] === undefined) continue;
            this._validatePoint(payload[xKey], payload[yKey]);
            if (payload[xKey] < 0 || payload[yKey] < 0 || payload[xKey] >= snapshot.width || payload[yKey] >= snapshot.height) {
                throw new Error('Point is outside the screenshot');
            }
            mapped[xKey] += snapshot.origin.x;
            mapped[yKey] += snapshot.origin.y;
        }
        return mapped;
    }

    // ===== INTERACTION METHODS (Humanized Physics) =====

    /**
     * Generate a natural cubic Bezier mouse path with Fitts's Law easing.
     * Mimics human hand movement: slow start, fast middle, decelerating end.
     */
    _generateBezierPath(start, end, pointsCount = 30) {
        const path = [];
        const distance = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
        
        // Scale control point randomness with distance (humans overshoot more on long moves)
        const spread = Math.min(150, distance * 0.4);

        const control1 = {
            x: start.x + (end.x - start.x) * 0.25 + (Math.random() - 0.5) * spread,
            y: start.y + (end.y - start.y) * 0.25 + (Math.random() - 0.5) * spread
        };
        const control2 = {
            x: start.x + (end.x - start.x) * 0.75 + (Math.random() - 0.5) * spread,
            y: start.y + (end.y - start.y) * 0.75 + (Math.random() - 0.5) * spread
        };

        // Human velocity curve: ease-in-out cubic (slow start, rapid middle, decelerate end)
        const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        for (let i = 0; i <= pointsCount; i++) {
            const tRaw = i / pointsCount;
            const t = easeInOutCubic(tRaw);

            const x = Math.round(
                Math.pow(1 - t, 3) * start.x +
                3 * Math.pow(1 - t, 2) * t * control1.x +
                3 * (1 - t) * Math.pow(t, 2) * control2.x +
                Math.pow(t, 3) * end.x
            );
            const y = Math.round(
                Math.pow(1 - t, 3) * start.y +
                3 * Math.pow(1 - t, 2) * t * control1.y +
                3 * (1 - t) * Math.pow(t, 2) * control2.y +
                Math.pow(t, 3) * end.y
            );

            path.push({ x, y });
        }
        return path;
    }

    /**
     * Random delay within a range (ms). Used for humanized timing.
     */
    _randomDelay(min, max) {
        return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
    }

    async _moveMouse(commandPayload) {
        const { x, y, smooth } = commandPayload;
        this._validatePoint(x, y);
        const { mouse, Point } = this._nut();

        if (smooth) {
            // Use Bezier curve path for natural movement
            const currentPos = await mouse.getPosition();
            const start = { x: currentPos.x, y: currentPos.y };
            const end = { x, y };
            const distance = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));

            // Adjust point count based on distance (Fitts's Law: longer = more points)
            const pointsCount = Math.max(15, Math.min(60, Math.round(distance / 15)));
            const bezierPath = this._generateBezierPath(start, end, pointsCount);

            // Walk along the Bezier path with variable timing
            for (let i = 1; i < bezierPath.length; i++) {
                await mouse.setPosition(new Point(bezierPath[i].x, bezierPath[i].y));
                // Variable delay between points (faster in middle, slower at edges)
                const progress = i / bezierPath.length;
                const baseDelay = progress < 0.2 || progress > 0.8 ? 8 : 3;
                await this._randomDelay(baseDelay, baseDelay + 5);
            }
        } else {
            await mouse.setPosition(new Point(x, y));
        }

        return {
            status: 'success',
            message: `Mouse moved to (${x}, ${y})`
        };
    }

    _validatePoint(x, y) {
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error('Coordinates must be finite integer pixels');
    }

    async _prepareInputWindow(windowId) {
        if (!Number.isSafeInteger(windowId) || windowId <= 0) throw new Error('Invalid window_id');
        const target = await this._findManagedWindow(windowId);
        if (!target) throw new Error('Target window is no longer available');
        if (this.platform === 'win32' && Number(windowManager.getActiveWindow()?.id) === windowId) return target;
        await target.bringToTop();
        const deadline = Date.now() + 1000;
        let foregroundId;
        do {
            const current = this.platform === 'win32' ? windowManager.getActiveWindow() : await activeWindow();
            foregroundId = current?.id;
            if (Number(current?.id) === windowId) return target;
            await new Promise(resolve => setTimeout(resolve, 25));
        } while (Date.now() < deadline);
        if (this.platform === 'win32') {
            // Some apps reject the addon's foreground request. Ask their UIA provider
            // to focus the window, then verify the actual foreground HWND again.
            try { await this._runAccessibilityScript(`
Add-Type -AssemblyName UIAutomationClient
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${windowId})
$root.SetFocus()
`, { timeout: 3000 }); } catch { /* Keep the foreground check as the final authority. */ }
            if (Number(windowManager.getActiveWindow()?.id) === windowId) return target;
        }
        throw new Error(`Target window ${windowId} could not receive focus. Foreground window is ${foregroundId ?? 'unknown'}. Input was not sent.`);
    }

    async _clickMouse(commandPayload) {
        const { button = 'left', double = false, x, y } = commandPayload;
        if (!['left', 'right', 'middle'].includes(button)) throw new Error('Invalid mouse button');
        if (typeof double !== 'boolean') throw new Error('double must be boolean');
        if ((x === undefined) !== (y === undefined)) throw new Error('Provide both x and y');
        if (x !== undefined) this._validatePoint(x, y);
        const { mouse, Point, Button } = this._nut();
        if (x !== undefined) await mouse.setPosition(new Point(x, y));
        const mouseButton = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE }[button];
        for (let i = 0; i < (double ? 2 : 1); i++) {
            try {
                await mouse.pressButton(mouseButton);
            } finally {
                await mouse.releaseButton(mouseButton);
            }
            if (double && i === 0) await new Promise(resolve => setTimeout(resolve, 75));
        }
        return { status: 'success', input_sent: true, message: `${button} mouse ${double ? 'double-' : ''}clicked` };
    }

    async _typeText(commandPayload) {
        const { text } = commandPayload;
        if (typeof text !== 'string' || text.length > 100000) throw new Error('text must be a string of at most 100000 characters');
        const speed = getTypingSpeed(this.settings);
        await typeWithSpeed(text, speed, {
            typeCharacter: character => this._typeCharacter(character, commandPayload.window_id),
            insertText: value => this._pasteText(value),
        });
        return { status: 'success', input_sent: true, typing_speed: speed, characters: [...text].length,
            message: 'Text input sent. Observe the target to verify its value.' };
    }

    async _pasteText(text) {
        await pasteWithClipboard(text, { clipboard,
            pressPaste: () => this._pressHotkey({ keys: [this.platform === 'darwin' ? 'cmd' : 'ctrl', 'v'] }),
        });
    }

    async _typeCharacter(character, windowId) {
        if (this.systemLocked || !this.isEnabled) throw new Error('Computer input stopped because control is unavailable.');
        if (this.platform === 'win32' && windowId !== undefined && Number(windowManager.getActiveWindow()?.id) !== windowId) {
            throw new Error('Target lost focus while typing. Input stopped. Observe before retrying.');
        }
        // Paste control characters literally. Enter can submit a chat message.
        if (character === '\n' || character === '\r' || character === '\t') {
            await this._pasteText(character);
            return;
        }
        if (this.platform === 'win32') {
            await this._runAccessibilityScript(unicodeTypingScript(character));
        } else {
            await this._nut().keyboard.type(character);
        }
    }

    async _pressHotkey(commandPayload) {
        const { keys } = commandPayload;
        if (!Array.isArray(keys) || keys.length < 1 || keys.length > 8 || keys.some(k => typeof k !== 'string')) {
            throw new Error('keys must contain between one and eight key names');
        }
        const { keyboard, Key } = this._nut();
        const aliases = {
            ctrl: 'LeftControl', control: 'LeftControl', control_l: 'LeftControl',
            alt: 'LeftAlt', alt_l: 'LeftAlt', shift: 'LeftShift', shift_l: 'LeftShift',
            cmd: 'LeftCmd', command: 'LeftCmd', super: 'LeftSuper', win: 'LeftWin',
            return: 'Enter', enter: 'Enter', esc: 'Escape', escape: 'Escape',
            space: 'Space', pageup: 'PageUp', pagedown: 'PageDown',
            '+': 'Add', '-': 'Minus', '.': 'Period', ',': 'Comma', '/': 'Slash',
        };
        const names = new Map(Object.keys(Key).filter(k => Number.isNaN(Number(k))).map(k => [k.toLowerCase(), k]));
        const nutKeys = keys.map(key => {
            const lower = key.toLowerCase();
            const name = aliases[lower] || (/^[0-9]$/.test(key) ? `Num${key}` :
                /^kp_[0-9]$/.test(lower) ? `NumPad${lower.slice(-1)}` : names.get(lower));
            if (!name || typeof Key[name] !== 'number') throw new Error(`Unknown key: ${key}`);
            return Key[name];
        });
        // Validate the entire chord before pressing anything; always release on failure.
        try {
            await keyboard.pressKey(...nutKeys);
        } finally {
            await keyboard.releaseKey(...[...nutKeys].reverse());
        }
        return { status: 'success', input_sent: true, message: `Pressed hotkey: ${keys.join('+')}` };
    }

    async _scroll(commandPayload) {
        const { direction, amount = 3, x, y } = commandPayload;
        const methods = { down: 'scrollDown', up: 'scrollUp', left: 'scrollLeft', right: 'scrollRight' };
        if (!methods[direction]) throw new Error('Invalid scroll direction');
        if (!Number.isInteger(amount) || amount < 1 || amount > 1000) throw new Error('amount must be between 1 and 1000');
        if ((x === undefined) !== (y === undefined)) throw new Error('Provide both x and y');
        if (x !== undefined) this._validatePoint(x, y);
        const { mouse, Point } = this._nut();
        if (x !== undefined) await mouse.setPosition(new Point(x, y));
        await mouse[methods[direction]](amount);
        return { status: 'success', input_sent: true, message: `Scrolled ${direction} by ${amount}` };
    }

    async _dragDrop(commandPayload) {
        const { from_x, from_y, to_x, to_y } = commandPayload;
        this._validatePoint(from_x, from_y);
        this._validatePoint(to_x, to_y);
        const { mouse, Point, Button } = this._nut();
        await mouse.setPosition(new Point(from_x, from_y));
        try {
            await mouse.pressButton(Button.LEFT);
            // Cross drag thresholds in a straight line with deterministic timing.
            for (let step = 1; step <= 20; step++) {
                await mouse.setPosition(new Point(
                    Math.round(from_x + (to_x - from_x) * step / 20),
                    Math.round(from_y + (to_y - from_y) * step / 20)
                ));
                await new Promise(resolve => setTimeout(resolve, 8));
            }
        } finally {
            await mouse.releaseButton(Button.LEFT);
        }
        return { status: 'success', input_sent: true, message: `Dragged from (${from_x}, ${from_y}) to (${to_x}, ${to_y})` };
    }

    // ===== WINDOW MANAGEMENT METHODS =====

    // May return an array or a promise of one; callers always await it.
    _getManagedWindows() {
        if (this.platform === 'linux') {
            return linuxDesktop.listLinuxWindows();
        }
        return windowManager.getWindows();
    }

    async _findManagedWindow(windowId) {
        const windows = await this._getManagedWindows();
        return windows.find(w => Number(w.id) === Number(windowId));
    }

    async _runPowerShell(script, options = {}) {
        const powershellExecutable = process.env.SystemRoot
            ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
            : 'powershell.exe';
        const utf8Script = "$ProgressPreference = 'SilentlyContinue'\n$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n" + script;
        const encodedCommand = Buffer.from(utf8Script, 'utf16le').toString('base64');

        try {
            return await execFileAsync(
                powershellExecutable,
                ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
                {
                    timeout: 15000,
                    windowsHide: true,
                    maxBuffer: 10 * 1024 * 1024,
                    ...options
                }
            );
        } catch (error) {
            const detail = error.killed ? 'timed out' : `failed with code ${error.code ?? 'unknown'}`;
            // child_process error.message contains the complete encoded script, including input text.
            throw new Error(`Windows helper ${detail}. ${String(error.stderr || '').slice(0, 1000)}`);
        }
    }

    async _runAccessibilityScript(script, options = {}) {
        if (!this._accessibilityWorker) this._accessibilityWorker = new WindowsAccessibilityWorker();
        return this._accessibilityWorker.run(script, options);
    }

    async _requestWindowClose(windowId) {
        const numericWindowId = Number(windowId);
        if (!Number.isSafeInteger(numericWindowId) || numericWindowId <= 0) {
            throw new Error('Invalid window ID');
        }

        const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AetheriaWindowClose {
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PostMessage(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        IntPtr lParam
    );
}
'@

$windowHandle = [IntPtr]${numericWindowId}
$closePosted = [AetheriaWindowClose]::PostMessage(
    $windowHandle,
    [uint32]0x0010,
    [IntPtr]::Zero,
    [IntPtr]::Zero
)

if (-not $closePosted) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "Unable to request window close. Windows error code: $errorCode"
}
`;
        await this._runPowerShell(script, { timeout: 10000 });
    }

    async _listWindows() {
        const windows = await this._getManagedWindows();
        
        const windowList = windows.map(win => ({
            id: win.id,
            title: win.getTitle(),
            bounds: win.getBounds(),
            process: win.processId
        }));

        return {
            status: 'success',
            windows: windowList,
            count: windowList.length
        };
    }

    async _focusWindow(commandPayload) {
        try {
            let target;
            if (commandPayload.window_id !== undefined) {
                target = await this._resolveObservationWindow({ window_id: commandPayload.window_id });
            } else if (typeof commandPayload.title === 'string' && commandPayload.title) {
                const title = commandPayload.title.toLowerCase();
                const windows = await this._getManagedWindows();
                const exact = windows.filter(window => window.getTitle().toLowerCase() === title);
                const matches = exact.length ? exact : windows.filter(window => window.getTitle().toLowerCase().includes(title));
                if (matches.length !== 1) throw new Error(`Expected one matching window, found ${matches.length}. Supply window_id.`);
                target = matches[0];
            } else {
                throw new Error('Supply window_id or title');
            }
            await this._prepareInputWindow(Number(target.id));
            return { status: 'success', window_id: Number(target.id), message: `Focused window: ${target.getTitle()}` };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _resizeWindow(commandPayload) {
        const { window_id, width, height } = commandPayload;

        const targetWindow = await this._findManagedWindow(window_id);
        if (!targetWindow) {
            return { status: 'error', error: 'Window not found' };
        }

        const bounds = targetWindow.getBounds();
        await targetWindow.setBounds({ ...bounds, width, height });

        return {
            status: 'success',
            message: `Resized window to ${width}x${height}`
        };
    }

    async _minimizeWindow(commandPayload) {
        const { window_id } = commandPayload;

        const targetWindow = await this._findManagedWindow(window_id);
        if (!targetWindow) {
            return { status: 'error', error: 'Window not found' };
        }

        await targetWindow.minimize();
        return {
            status: 'success',
            message: 'Window minimized'
        };
    }

    async _maximizeWindow(commandPayload) {
        const { window_id } = commandPayload;

        const targetWindow = await this._findManagedWindow(window_id);
        if (!targetWindow) {
            return { status: 'error', error: 'Window not found' };
        }

        await targetWindow.maximize();
        return {
            status: 'success',
            message: 'Window maximized'
        };
    }

    async _closeWindow(commandPayload) {
        const { window_id } = commandPayload;

        const numericWindowId = Number(window_id);
        if (!Number.isSafeInteger(numericWindowId) || numericWindowId <= 0) {
            return { status: 'error', error: 'A valid window ID is required' };
        }

        const targetWindow = await this._findManagedWindow(numericWindowId);
        if (!targetWindow) {
            return { status: 'error', error: 'Window not found' };
        }

        // Every platform asks the window to close (the app may still prompt
        // to save) instead of killing the process behind it.
        if (this.platform === 'win32') {
            await this._requestWindowClose(targetWindow.id);
        } else if (this.platform === 'darwin') {
            await macosDesktop.requestMacWindowClose({
                processId: targetWindow.processId,
                title: targetWindow.getTitle(),
            });
        } else {
            await targetWindow.close();
        }

        return {
            status: 'success',
            message: `Close requested for window: ${targetWindow.getTitle()}`
        };
    }

    // ===== SYSTEM METHODS =====

    async _runCommand(commandPayload) {
        const { command, timeout = 30000 } = commandPayload;

        // Security: Validate command doesn't contain dangerous patterns
        const dangerousPatterns = ['rm -rf /', 'del /f /s /q', 'format', 'mkfs'];
        if (dangerousPatterns.some(pattern => command.toLowerCase().includes(pattern))) {
            return {
                status: 'error',
                error: 'Command contains dangerous patterns and was blocked'
            };
        }

        try {
            const { stdout, stderr } = await execAsync(command, { timeout });
            return {
                status: 'success',
                stdout: stdout,
                stderr: stderr
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                stdout: error.stdout || '',
                stderr: error.stderr || ''
            };
        }
    }

    async _listFiles(commandPayload) {
        const { directory } = commandPayload;
        const resolvedDirectory = this._resolveDirectoryForList(directory) || this.allowedScopes[0] || this.defaultScope;
        const scopeCheck = await this._ensurePathInScope(resolvedDirectory, 'list_files');
        if (!scopeCheck.ok) return { status: 'error', error: scopeCheck.error };

        try {
            const files = await fs.readdir(scopeCheck.path, { withFileTypes: true });
            const fileList = files.map(file => ({
                name: file.name,
                type: file.isDirectory() ? 'directory' : 'file',
                path: path.join(scopeCheck.path, file.name)
            }));

            return {
                status: 'success',
                files: fileList,
                count: fileList.length
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _readFile(commandPayload) {
        const { file_path, encoding = 'utf8' } = commandPayload;
        const scopeCheck = await this._ensurePathInScope(file_path, 'read_file');
        if (!scopeCheck.ok) return { status: 'error', error: scopeCheck.error };

        try {
            const content = await fs.readFile(scopeCheck.path, encoding);
            return {
                status: 'success',
                content: content,
                size: content.length
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _writeFile(commandPayload) {
        const { file_path, content, encoding = 'utf8' } = commandPayload;
        const scopeCheck = await this._ensurePathInScope(file_path, 'write_file');
        if (!scopeCheck.ok) return { status: 'error', error: scopeCheck.error };

        try {
            await fs.writeFile(scopeCheck.path, content, encoding);
            return {
                status: 'success',
                message: `File written: ${scopeCheck.path}`,
                size: content.length
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _deleteFile(commandPayload) {
        const { file_path } = commandPayload;
        const scopeCheck = await this._ensurePathInScope(file_path, 'delete_file');
        if (!scopeCheck.ok) return { status: 'error', error: scopeCheck.error };

        try {
            const stats = await fs.stat(scopeCheck.path);
            if (stats.isDirectory()) {
                await fs.rmdir(scopeCheck.path, { recursive: true });
            } else {
                await fs.unlink(scopeCheck.path);
            }

            return {
                status: 'success',
                message: `Deleted: ${scopeCheck.path}`
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _createDirectory(commandPayload) {
        const { directory_path } = commandPayload;
        const scopeCheck = await this._ensurePathInScope(directory_path, 'create_directory');
        if (!scopeCheck.ok) return { status: 'error', error: scopeCheck.error };

        try {
            await fs.mkdir(scopeCheck.path, { recursive: true });
            return {
                status: 'success',
                message: `Directory created: ${scopeCheck.path}`
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    _normalizeApplicationName(value) {
        return String(value || '')
            .trim()
            .replace(/^["']|["']$/g, '')
            .replace(/\.exe$/i, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    _getWindowsApplicationAliases(app) {
        const aliases = new Set();
        const displayName = this._normalizeApplicationName(app && app.name);
        if (displayName) aliases.add(displayName);

        if (app && app.id) {
            const executableName = path.win32.basename(app.id);
            if (/\.exe$/i.test(executableName)) {
                const executableAlias = this._normalizeApplicationName(executableName);
                if (executableAlias) aliases.add(executableAlias);
            }
        }

        return aliases;
    }

    _resolveWindowsApplication(appName, apps) {
        const requestedName = this._normalizeApplicationName(appName);
        if (!requestedName || !Array.isArray(apps)) return null;

        const exactNameMatches = apps.filter(app =>
            this._normalizeApplicationName(app && app.name) === requestedName
        );
        if (exactNameMatches.length > 0) {
            return exactNameMatches.find(app => app.id) || exactNameMatches[0];
        }

        const aliasMatches = apps.filter(app =>
            this._getWindowsApplicationAliases(app).has(requestedName)
        );
        if (aliasMatches.length === 1) return aliasMatches[0];

        const partialMatches = apps.filter(app => {
            const normalizedName = this._normalizeApplicationName(app && app.name);
            return normalizedName && normalizedName.includes(requestedName);
        });
        if (partialMatches.length === 1) return partialMatches[0];

        return null;
    }

    async _launchWindowsApplication(app) {
        // Explorer may exit nonzero after successfully handing off an AppsFolder
        // launch. ShellExecute dispatches the item without using that exit code.
        const target = app?.id ? `shell:AppsFolder\\${app.id}` : String(app?.name || '').trim();
        if (!target) throw new Error('Application name is required');

        const encodedTarget = Buffer.from(target, 'utf8').toString('base64');
        const script = `
$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTarget}'))
$shell = New-Object -ComObject Shell.Application
$shell.ShellExecute($target, '', '', 'open', 1)
`;
        await this._runPowerShell(script, { timeout: 15000 });
    }

    _windowMatchesApplication(window, appName, resolvedApp = null) {
        const requestedName = this._normalizeApplicationName(appName);
        const aliases = new Set([requestedName]);
        if (resolvedApp) {
            for (const alias of this._getWindowsApplicationAliases(resolvedApp)) {
                aliases.add(alias);
            }
        }
        aliases.delete('');

        const executableAlias = this._normalizeApplicationName(
            path.win32.basename(window.path || '')
        );
        if (executableAlias && aliases.has(executableAlias)) return true;

        let title = '';
        try {
            title = this._normalizeApplicationName(window.getTitle());
        } catch {
            return false;
        }

        return [...aliases].some(alias =>
            title === alias || title.endsWith(` ${alias}`)
        );
    }

    async _openApplication(commandPayload) {
        const appName = String(commandPayload.app_name || '').trim();
        if (!appName) {
            return { status: 'error', error: 'Application name is required' };
        }

        try {
            if (this.platform === 'win32') {
                const discoveryResult = await this._listInstalledApplications();
                const resolvedApp = discoveryResult.status === 'success'
                    ? this._resolveWindowsApplication(appName, discoveryResult.apps)
                    : null;
                await this._launchWindowsApplication(resolvedApp || { name: appName });
            } else if (this.platform === 'darwin') {
                // Argument array, no shell: the name cannot inject commands.
                await execFileAsync('open', ['-a', appName], { timeout: 15000 });
            } else {
                await this._launchLinuxApplication(appName);
            }

            return {
                status: 'success',
                launch_requested: true,
                message: `Launch requested for application: ${appName}. Use list_windows to verify readiness.`
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _closeApplication(commandPayload) {
        const appName = String(commandPayload.app_name || '').trim();
        if (!appName) {
            return { status: 'error', error: 'Application name is required' };
        }

        try {
            if (this.platform === 'win32') {
                const discoveryResult = await this._listInstalledApplications();
                const resolvedApp = discoveryResult.status === 'success'
                    ? this._resolveWindowsApplication(appName, discoveryResult.apps)
                    : null;
                const matchingWindows = (await this._getManagedWindows()).filter(window =>
                    this._windowMatchesApplication(window, appName, resolvedApp)
                );

                if (matchingWindows.length === 0) {
                    return {
                        status: 'error',
                        error: `No open windows found for application: ${appName}`
                    };
                }

                for (const window of matchingWindows) {
                    await this._requestWindowClose(window.id);
                }

                return {
                    status: 'success',
                    message: `Close requested for application: ${appName}`,
                    closed_windows: matchingWindows.length
                };
            }

            if (this.platform === 'darwin') {
                // A normal Quit, like Cmd+Q: the app can still ask to save.
                const quit = await macosDesktop.quitMacApplication(appName);
                if (!quit) {
                    return { status: 'error', error: `No running application named: ${appName}` };
                }
                return {
                    status: 'success',
                    message: `Quit requested for application: ${appName}`
                };
            }

            return await this._closeLinuxApplication(appName);
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    /**
     * Linux launch. Installed apps are started from their .desktop entry
     * (gio launch, or the entry's Exec line). Anything else is treated as a
     * program name plus arguments. Either way the program is spawned detached
     * with no shell, so the tool returns as soon as it has started.
     */
    async _launchLinuxApplication(appName) {
        const discoveryResult = await this._listInstalledApplications();
        const resolvedApp = discoveryResult.status === 'success'
            ? this._resolveWindowsApplication(appName, discoveryResult.apps)
            : null;

        if (resolvedApp && resolvedApp.desktop_file) {
            try {
                await this._launchDesktopEntry(resolvedApp.desktop_file);
                return;
            } catch (error) {
                if (!resolvedApp.exec) throw error;
                console.warn('ComputerControlHandler: gio launch failed, using the Exec line instead:', error.message);
            }
        }

        if (resolvedApp && resolvedApp.exec) {
            const { command, args } = linuxDesktop.parseDesktopExec(resolvedApp.exec);
            await linuxDesktop.spawnDetached(command, args);
            return;
        }

        const [command, ...args] = appName.split(/\s+/).filter(Boolean);
        await linuxDesktop.spawnDetached(command, args);
    }

    // `gio launch` honors the entry's Path=, Terminal= and DBusActivatable= keys,
    // which a hand-built Exec command would miss.
    async _launchDesktopEntry(desktopFile) {
        await execFileAsync('gio', ['launch', desktopFile], { timeout: 15000 });
    }

    /**
     * Linux close: ask each of the app's windows to close (like clicking X).
     * When no window matches, or window listing is unavailable (no wmctrl,
     * Wayland), fall back to SIGTERM by exact process name.
     */
    async _closeLinuxApplication(appName) {
        let matchingWindows = [];
        if (!linuxDesktop.isWaylandSession(this.env)) {
            try {
                const windows = await this._getManagedWindows();
                matchingWindows = windows.filter(window => this._windowMatchesApplication(window, appName));
            } catch (error) {
                console.warn('ComputerControlHandler: Window listing failed, falling back to pkill:', error.message);
            }
        }

        if (matchingWindows.length > 0) {
            for (const window of matchingWindows) {
                await window.close();
            }
            return {
                status: 'success',
                message: `Close requested for application: ${appName}`,
                closed_windows: matchingWindows.length
            };
        }

        if (appName.startsWith('-')) {
            return { status: 'error', error: `Invalid application name: ${appName}` };
        }
        try {
            await execFileAsync('pkill', ['-x', appName], { timeout: 10000 });
        } catch (error) {
            // pkill exits 1 when nothing matched.
            if (error.code === 1) {
                return { status: 'error', error: `No running application named: ${appName}` };
            }
            throw error;
        }
        return {
            status: 'success',
            message: `Closed application: ${appName}`
        };
    }

    async _getVolume() {
        try {
            const volume = await loudness.getVolume();
            const muted = await loudness.getMuted();

            return {
                status: 'success',
                volume: volume,
                muted: muted
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _setVolume(commandPayload) {
        const { volume, mute } = commandPayload;

        try {
            if (volume !== undefined) {
                await loudness.setVolume(Math.max(0, Math.min(100, volume)));
            }
            if (mute !== undefined) {
                await loudness.setMuted(mute);
            }

            return {
                status: 'success',
                message: `Volume set to ${volume}${mute ? ' (muted)' : ''}`
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _getSystemInfo() {
        const os = require('os');
        const displays = screen.getAllDisplays();

        return {
            status: 'success',
            platform: this.platform,
            arch: os.arch(),
            hostname: os.hostname(),
            total_memory: os.totalmem(),
            free_memory: os.freemem(),
            cpu_count: os.cpus().length,
            uptime: os.uptime(),
            displays: displays.map(d => ({
                id: d.id,
                bounds: d.bounds,
                size: d.size,
                scaleFactor: d.scaleFactor
            })),
            idle_time: powerMonitor.getSystemIdleTime()
        };
    }

    // ===== SCREEN ELEMENT DETECTION =====

    /**
     * Get interactive screen elements using Windows UI Automation (PowerShell).
     * Returns buttons, links, text fields with their coordinates for precise targeting.
     */
    async _resolveObservationWindow(commandPayload) {
        const { window_id, window_title } = commandPayload;
        if (window_id !== undefined) {
            if (!Number.isSafeInteger(window_id) || window_id <= 0) throw new Error('Invalid window_id');
            const window = await this._findManagedWindow(window_id);
            if (!window) throw new Error('Target window not found');
            return window;
        }
        if (window_title) {
            if (typeof window_title !== 'string') throw new Error('window_title must be text');
            const matches = (await this._getManagedWindows()).filter(w => w.getTitle() === window_title);
            if (matches.length !== 1) throw new Error(`Expected one window with this exact title, found ${matches.length}. Use list_windows and window_id.`);
            return matches[0];
        }
        const current = await activeWindow();
        const window = current && await this._findManagedWindow(Number(current.id));
        if (!window) throw new Error('No target window. Use list_windows and supply window_id.');
        return window;
    }

    async _getScreenElements(commandPayload) {
        if (this.platform !== 'win32') return { status: 'error', error: 'Accessibility is currently supported on Windows only; use screenshots and keyboard input on this platform.' };
        try {
            const window = await this._resolveObservationWindow(commandPayload);
            const script = windowsAccessibility.buildScript({
                windowId: Number(window.id), elementType: commandPayload.element_type,
                text: commandPayload.text, limit: commandPayload.limit ?? 200,
            });
            const { stdout } = await this._runAccessibilityScript(script, { timeout: 15000 });
            const result = JSON.parse(stdout);
            if (result.status !== 'success') return result;
            const observationId = crypto.randomUUID();
            result.elements = result.elements.map((el, index) => ({ ...el, element_id: String(index + 1) }));
            const snapshot = { windowId: Number(window.id), created: Date.now(), elements: result.elements };
            this._observations.set(observationId, snapshot);
            if (this._observations.size > 16) this._observations.delete(this._observations.keys().next().value);
            return { ...result, count: result.elements.length, observation_id: observationId, window_title: window.getTitle() };
        } catch (error) {
            return { status: 'error', error: `Element detection failed: ${error.message}` };
        }
    }

    async _findElementByText(commandPayload) {
        if (typeof commandPayload.text !== 'string' || !commandPayload.text.trim()) return { status: 'error', error: 'Text parameter is required.' };
        const result = await this._getScreenElements(commandPayload);
        if (result.status !== 'success') return result;
        const candidates = result.elements.filter(el => el.IsEnabled && !el.IsOffscreen);
        if (candidates.length === 0) return { ...result, status: 'error', error: 'No enabled visible matching element found.' };
        // Never recommend an arbitrary first match for an ambiguous label.
        return { ...result, ambiguous: candidates.length > 1,
            recommended_click: candidates.length === 1 ? { x: candidates[0].X, y: candidates[0].Y } : null };
    }

    async _performElementAction(commandPayload) {
        if (this.platform !== 'win32') return { status: 'error', error: 'Accessibility actions are supported on Windows only.' };
        const { observation_id, element_id, element_action, value } = commandPayload;
        const snapshot = this._observations.get(observation_id);
        this._observations.clear();
        if (!snapshot || Date.now() - snapshot.created > 30000) return { status: 'error', error: 'Observation expired or invalidated. Observe again.' };
        if (commandPayload.window_id !== undefined && commandPayload.window_id !== snapshot.windowId) return { status: 'error', error: 'Element belongs to a different window.' };
        const el = snapshot.elements.find(element => element.element_id === String(element_id));
        if (!el || !el.IsEnabled || el.IsOffscreen) return { status: 'error', error: 'Element is missing, offscreen or disabled.' };
        try {
            if (element_action === 'set_value') {
                if (typeof value !== 'string' || value.length > 100000) throw new Error('value must be text of at most 100000 characters');
                if (el.IsReadOnly || el.IsPassword || !el.Patterns?.includes('Value')) throw new Error('Control does not support editable text');
                const focusScript = windowsAccessibility.buildScript({ windowId: snapshot.windowId, runtimeId: el.RuntimeId, action: 'focus' });
                const focused = JSON.parse((await this._runAccessibilityScript(focusScript)).stdout);
                if (focused.status !== 'success') return focused;
                await this._prepareInputWindow(snapshot.windowId);
                await this._pressHotkey({ keys: ['ctrl', 'a'] });
                await this._pressHotkey({ keys: ['backspace'] });
                const typed = await this._typeText({ text: value, window_id: snapshot.windowId });
                const state = await this._getScreenElements({ window_id: snapshot.windowId });
                const current = state.elements?.find(element => element.RuntimeId === el.RuntimeId);
                const verified = state.status === 'success' && current && !current.ValueTruncated && current.Value === value;
                return { ...typed, state, verified,
                    ...(verified ? {} : { status: 'error', outcome: 'unknown', error: 'Field value could not be verified. Inspect the state before retrying.' }) };
            }
            const script = windowsAccessibility.buildScript({ windowId: snapshot.windowId, runtimeId: el.RuntimeId, action: element_action, value });
            if (!windowsAccessibility.ACTIONS.has(element_action)) throw new Error('Unsupported accessibility action');
            const { stdout } = await this._runAccessibilityScript(script, { timeout: 15000 });
            const result = JSON.parse(stdout);
            const state = await this._getScreenElements({ window_id: snapshot.windowId });
            if (result.status !== 'success') return { ...result, state };
            return { ...result, state, message: 'Accessibility action sent. Inspect the returned state to verify the outcome.' };
        } catch (error) {
            return { status: 'error', error: `Accessibility action failed: ${error.message}` };
        }
    }

    async _getWindowState(commandPayload) {
        const window = await this._resolveObservationWindow(commandPayload);
        const state = await this._getScreenElements({ ...commandPayload, window_id: Number(window.id) });
        if (commandPayload.include_screenshot === false) return state;
        let screenshot;
        try {
            screenshot = await this._takeScreenshot({ ...commandPayload, window_id: Number(window.id) });
        } catch (error) {
            if (state.status !== 'success') throw error;
            return { status: 'success', state, window_id: Number(window.id), window_title: window.getTitle(),
                screenshot_available: false, screenshot_error: error.message, accessibility_available: state.elements.length > 0 };
        }
        if (screenshot.status !== 'success') return screenshot;
        return { ...screenshot, state, screenshot_available: true, window_id: Number(window.id), window_title: window.getTitle(),
            accessibility_available: state.status === 'success' && state.elements.length > 0 };
    }

    // ===== APPLICATION DISCOVERY =====

    async _listInstalledApplications() {
        try {
            let apps = [];

            if (this.platform === 'win32') {
                // Strategy 1: Get-StartApps (UWP + Start Menu shortcuts - fast)
                try {
                    const { stdout: startAppsJson } = await this._runPowerShell(
                        'Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress',
                        { timeout: 15000 }
                    );
                    const startApps = JSON.parse(startAppsJson);
                    const startList = Array.isArray(startApps) ? startApps : [startApps];
                    startList.forEach(item => {
                        if (item && item.Name) {
                            apps.push({
                                name: item.Name,
                                id: item.AppID || null,
                                type: 'start_menu',
                                source: 'Get-StartApps'
                            });
                        }
                    });
                } catch (e) {
                    console.warn('ComputerControlHandler: Get-StartApps failed:', e.message);
                }

                // Strategy 2: Registry Uninstall keys (legacy desktop apps)
                const registryPaths = [
                    'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
                    'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
                    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
                ];

                for (const regPath of registryPaths) {
                    try {
                        const psScript = `Get-ItemProperty '${regPath}' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -ne $null } | Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation | ConvertTo-Json -Compress`;
                        const { stdout: regJson } = await this._runPowerShell(psScript, { timeout: 15000 });
                        if (regJson && regJson.trim()) {
                            const regApps = JSON.parse(regJson);
                            const regList = Array.isArray(regApps) ? regApps : [regApps];
                            regList.forEach(item => {
                                if (item && item.DisplayName) {
                                    // Avoid duplicates from Start Menu
                                    const alreadyExists = apps.some(a =>
                                        a.name.toLowerCase() === item.DisplayName.toLowerCase()
                                    );
                                    if (!alreadyExists) {
                                        apps.push({
                                            name: item.DisplayName,
                                            version: item.DisplayVersion || null,
                                            publisher: item.Publisher || null,
                                            install_location: item.InstallLocation || null,
                                            type: 'registry_uninstall',
                                            source: regPath.includes('Wow6432Node') ? 'registry_32bit' : 'registry_64bit'
                                        });
                                    }
                                }
                            });
                        }
                    } catch (e) {
                        // Silently continue if one registry path fails
                        console.warn(`ComputerControlHandler: Registry scan failed for ${regPath}:`, e.message);
                    }
                }

            } else if (this.platform === 'darwin') {
                // macOS: Scan application directories
                const appDirs = ['/Applications', `${os.homedir()}/Applications`, '/System/Applications'];
                for (const dir of appDirs) {
                    try {
                        const files = await fs.readdir(dir);
                        files.filter(f => f.endsWith('.app')).forEach(app => {
                            apps.push({
                                name: app.replace('.app', ''),
                                path: path.join(dir, app),
                                type: 'mac_bundle',
                                source: dir
                            });
                        });
                    } catch (e) { /* directory may not exist */ }
                }

            } else {
                // Linux: Parse .desktop entry files
                const desktopDirs = [
                    '/usr/share/applications',
                    '/usr/local/share/applications',
                    `${os.homedir()}/.local/share/applications`
                ];
                for (const dir of desktopDirs) {
                    try {
                        const files = await fs.readdir(dir);
                        for (const file of files.filter(f => f.endsWith('.desktop'))) {
                            try {
                                const content = await fs.readFile(path.join(dir, file), 'utf8');
                                const nameMatch = content.match(/^Name=(.+)$/m);
                                const execMatch = content.match(/^Exec=(.+)$/m);
                                const iconMatch = content.match(/^Icon=(.+)$/m);
                                const catMatch = content.match(/^Categories=(.+)$/m);
                                if (nameMatch) {
                                    apps.push({
                                        name: nameMatch[1].trim(),
                                        exec: execMatch ? execMatch[1].trim() : null,
                                        icon: iconMatch ? iconMatch[1].trim() : null,
                                        categories: catMatch ? catMatch[1].trim() : null,
                                        desktop_file: path.join(dir, file),
                                        type: 'desktop_entry',
                                        source: dir
                                    });
                                }
                            } catch (e) { /* skip unreadable files */ }
                        }
                    } catch (e) { /* directory may not exist */ }
                }
            }

            return {
                status: 'success',
                apps: apps,
                count: apps.length,
                platform: this.platform
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _watchDirectory(commandPayload) {
        const { directory, watch_id } = commandPayload;
        const scopeCheck = await this._ensurePathInScope(directory, 'watch_directory');
        if (!scopeCheck.ok) return { status: 'error', error: scopeCheck.error };

        if (this.fileWatchers.has(watch_id)) {
            return { status: 'error', error: 'Watcher with this ID already exists' };
        }

        const watcher = chokidar.watch(scopeCheck.path, {
            persistent: true,
            ignoreInitial: true
        });

        watcher.on('all', (event, path) => {
            this.eventEmitter.emit('file-system-event', {
                watch_id,
                event,
                path
            });
        });

        this.fileWatchers.set(watch_id, watcher);

        return {
            status: 'success',
            message: `Watching directory: ${scopeCheck.path}`,
            watch_id
        };
    }

    async _stopWatching(commandPayload) {
        const { watch_id } = commandPayload;

        const watcher = this.fileWatchers.get(watch_id);
        if (!watcher) {
            return { status: 'error', error: 'Watcher not found' };
        }

        await watcher.close();
        this.fileWatchers.delete(watch_id);

        return {
            status: 'success',
            message: `Stopped watching: ${watch_id}`
        };
    }

    _emitResult(request_id, result) {
        if (typeof request_id === 'string') {
            this._completedResultBytes -= this._completedResultSizes.get(request_id) || 0;
            const maxBytes = 16 * 1024 * 1024;
            const cached = Buffer.byteLength(JSON.stringify(result)) > maxBytes
                ? { status: 'error', outcome: 'unknown', error: 'This request already executed, but its large result was not cached. Observe again before repeating an action.' }
                : result;
            const size = Buffer.byteLength(JSON.stringify(cached));
            this._completedResults.set(request_id, cached);
            this._completedResultSizes.set(request_id, size);
            this._completedResultBytes += size;
            while (this._completedResults.size > 1 && (this._completedResults.size > 128 || this._completedResultBytes > maxBytes)) {
                const oldest = this._completedResults.keys().next().value;
                this._completedResultBytes -= this._completedResultSizes.get(oldest);
                this._completedResultSizes.delete(oldest);
                this._completedResults.delete(oldest);
            }
        }
        console.log(`ComputerControlHandler: Emitting result for request_id: ${request_id}`);
        this.eventEmitter.emit('computer-command-result', {
            request_id,
            result
        });
    }

    async cleanup() {
        console.log('ComputerControlHandler: Cleaning up...');
        
        this.isEnabled = false;
        await this._commandQueue;
        this._accessibilityWorker?.close();
        this._accessibilityWorker = null;
        if (this._ocrWorkerPromise) {
            const worker = await this._ocrWorkerPromise;
            await worker.terminate();
            this._ocrWorkerPromise = null;
        }
        this._observations.clear();
        this._screenshots.clear();
        this._completedResults.clear();
        this._completedResultSizes.clear();
        this._completedResultBytes = 0;
        // Close all file watchers
        for (const [id, watcher] of this.fileWatchers) {
            await watcher.close();
        }
        this.fileWatchers.clear();
        
        this.isEnabled = false;
        this.permissionSource = null;
        this.allowedScopes = [];
    }
}

module.exports = ComputerControlHandler;
