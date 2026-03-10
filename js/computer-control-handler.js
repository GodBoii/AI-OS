// js/computer-control-handler.js
// Computer Control Handler for AI Agent Desktop Automation

const { screen, clipboard, desktopCapturer, powerMonitor } = require('electron');
const { keyboard, Key, mouse, Button, straightTo, Point, Region, screen: nutScreen } = require('@nut-tree-fork/nut-js');
const activeWin = require('active-win');
const windowManager = require('node-window-manager');
const loudness = require('loudness');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const chokidar = require('chokidar');

const execAsync = promisify(exec);

class ComputerControlHandler {
    constructor(eventEmitter, appDataPath, getAuthTokenFunc) {
        this.eventEmitter = eventEmitter;
        this.appDataPath = appDataPath;
        this.getAuthToken = getAuthTokenFunc;
        this.isEnabled = false;
        this.permissionSource = null;
        this.allowedScopes = [];
        this.defaultScope = this._normalizePath(os.homedir());
        this.fileWatchers = new Map();
        this.platform = process.platform; // 'win32', 'darwin', 'linux'
        
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
                    }
                }
            );

            const { signedURL, path } = urlResponse.data;
            if (!signedURL || !path) {
                console.error('ComputerControlHandler: Backend did not return valid signed URL or path');
                return null;
            }

            // Upload to Supabase using signed URL
            await axios.put(signedURL, imageBuffer, {
                headers: { 'Content-Type': 'image/png' }
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
                        screen_size: screen.getPrimaryDisplay().size
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

                case 'watch_directory':
                    result = await this._watchDirectory(commandPayload);
                    break;

                case 'stop_watching':
                    result = await this._stopWatching(commandPayload);
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
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: screen.getPrimaryDisplay().size
        });

        if (sources.length === 0) {
            return { status: 'error', error: 'No screen sources available' };
        }

        const screenshot = sources[0].thumbnail.toPNG();
        const screenshotBase64 = screenshot.toString('base64');
        const localSave = await this._saveComputerOutputBuffer(screenshot, commandPayload, `screenshot-${Date.now()}.png`);
        
        const screenshotPath = await this._uploadScreenshot(screenshotBase64);

        return {
            status: 'success',
            screenshot_path: screenshotPath,
            width: sources[0].thumbnail.getSize().width,
            height: sources[0].thumbnail.getSize().height,
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
                    width: sources[0].thumbnail.getSize().width,
                    height: sources[0].thumbnail.getSize().height
                }
            }
        };
    }

    async _getActiveWindow() {
        try {
            const window = await activeWin();
            if (!window) {
                return { status: 'error', error: 'No active window found' };
            }

            return {
                status: 'success',
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
        const point = screen.getCursorScreenPoint();
        return {
            status: 'success',
            x: point.x,
            y: point.y
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
        const Tesseract = require('tesseract.js');
        
        // Take screenshot first
        const screenshotResult = await this._takeScreenshot({});
        if (screenshotResult.status !== 'success') {
            return screenshotResult;
        }

        // Get screenshot from Supabase
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY
        );

        const { data: imageData } = await supabase.storage
            .from('media-uploads')
            .download(screenshotResult.screenshot_path);

        const buffer = Buffer.from(await imageData.arrayBuffer());

        // Run OCR
        const { data: { text } } = await Tesseract.recognize(buffer, 'eng');

        return {
            status: 'success',
            text: text,
            screenshot_path: screenshotResult.screenshot_path
        };
    }

    // ===== INTERACTION METHODS =====

    async _moveMouse(commandPayload) {
        const { x, y, smooth } = commandPayload;
        
        if (smooth) {
            await mouse.move(straightTo(new Point(x, y)));
        } else {
            await mouse.setPosition(new Point(x, y));
        }

        return {
            status: 'success',
            message: `Mouse moved to (${x}, ${y})`
        };
    }

    async _clickMouse(commandPayload) {
        const { button = 'left', double = false, x, y } = commandPayload;

        if (x !== undefined && y !== undefined) {
            await mouse.setPosition(new Point(x, y));
        }

        const mouseButton = button === 'right' ? Button.RIGHT : 
                           button === 'middle' ? Button.MIDDLE : Button.LEFT;

        if (double) {
            await mouse.doubleClick(mouseButton);
        } else {
            await mouse.click(mouseButton);
        }

        return {
            status: 'success',
            message: `${button} mouse ${double ? 'double-' : ''}clicked`
        };
    }

    async _typeText(commandPayload) {
        const { text } = commandPayload;
        await keyboard.type(text);

        return {
            status: 'success',
            message: `Typed: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`
        };
    }

    async _pressHotkey(commandPayload) {
        const { keys } = commandPayload;
        
        // Map string keys to nut.js Key enum
        const keyMap = {
            'ctrl': Key.LeftControl,
            'control': Key.LeftControl,
            'alt': Key.LeftAlt,
            'shift': Key.LeftShift,
            'cmd': Key.LeftCmd,
            'super': Key.LeftSuper,
            'win': Key.LeftWin,
            'enter': Key.Enter,
            'tab': Key.Tab,
            'escape': Key.Escape,
            'space': Key.Space,
            'backspace': Key.Backspace,
            'delete': Key.Delete,
            'up': Key.Up,
            'down': Key.Down,
            'left': Key.Left,
            'right': Key.Right,
            'home': Key.Home,
            'end': Key.End,
            'pageup': Key.PageUp,
            'pagedown': Key.PageDown,
            'f1': Key.F1, 'f2': Key.F2, 'f3': Key.F3, 'f4': Key.F4,
            'f5': Key.F5, 'f6': Key.F6, 'f7': Key.F7, 'f8': Key.F8,
            'f9': Key.F9, 'f10': Key.F10, 'f11': Key.F11, 'f12': Key.F12
        };

        const nutKeys = keys.map(k => {
            const lower = k.toLowerCase();
            if (keyMap[lower]) return keyMap[lower];
            // Single character keys
            return Key[k.toUpperCase()] || k;
        });

        await keyboard.pressKey(...nutKeys);
        await keyboard.releaseKey(...nutKeys);

        return {
            status: 'success',
            message: `Pressed hotkey: ${keys.join('+')}`
        };
    }

    async _scroll(commandPayload) {
        const { direction, amount = 3 } = commandPayload;
        
        const scrollAmount = direction === 'down' ? -amount : amount;
        
        for (let i = 0; i < Math.abs(amount); i++) {
            await mouse.scrollDown(scrollAmount > 0 ? 1 : -1);
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return {
            status: 'success',
            message: `Scrolled ${direction} by ${amount}`
        };
    }

    async _dragDrop(commandPayload) {
        const { from_x, from_y, to_x, to_y } = commandPayload;

        await mouse.setPosition(new Point(from_x, from_y));
        await mouse.pressButton(Button.LEFT);
        await mouse.move(straightTo(new Point(to_x, to_y)));
        await mouse.releaseButton(Button.LEFT);

        return {
            status: 'success',
            message: `Dragged from (${from_x}, ${from_y}) to (${to_x}, ${to_y})`
        };
    }

    // ===== WINDOW MANAGEMENT METHODS =====

    async _listWindows() {
        const windows = windowManager.getWindows();
        
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
        const { window_id, title } = commandPayload;

        let targetWindow;
        if (window_id) {
            targetWindow = windowManager.getWindows().find(w => w.id === window_id);
        } else if (title) {
            targetWindow = windowManager.getWindows().find(w => 
                w.getTitle().toLowerCase().includes(title.toLowerCase())
            );
        }

        if (!targetWindow) {
            return { status: 'error', error: 'Window not found' };
        }

        targetWindow.bringToTop();
        return {
            status: 'success',
            message: `Focused window: ${targetWindow.getTitle()}`
        };
    }

    async _resizeWindow(commandPayload) {
        const { window_id, width, height } = commandPayload;

        const targetWindow = windowManager.getWindows().find(w => w.id === window_id);
        if (!targetWindow) {
            return { status: 'error', error: 'Window not found' };
        }

        const bounds = targetWindow.getBounds();
        targetWindow.setBounds({ ...bounds, width, height });

        return {
            status: 'success',
            message: `Resized window to ${width}x${height}`
        };
    }

    async _minimizeWindow(commandPayload) {
        const { window_id } = commandPayload;

        const targetWindow = windowManager.getWindows().find(w => w.id === window_id);
        if (!targetWindow) {
            return { status: 'error', error: 'Window not found' };
        }

        targetWindow.minimize();
        return {
            status: 'success',
            message: 'Window minimized'
        };
    }

    async _maximizeWindow(commandPayload) {
        const { window_id } = commandPayload;

        const targetWindow = windowManager.getWindows().find(w => w.id === window_id);
        if (!targetWindow) {
            return { status: 'error', error: 'Window not found' };
        }

        targetWindow.maximize();
        return {
            status: 'success',
            message: 'Window maximized'
        };
    }

    async _closeWindow(commandPayload) {
        const { window_id } = commandPayload;

        const targetWindow = windowManager.getWindows().find(w => w.id === window_id);
        if (!targetWindow) {
            return { status: 'error', error: 'Window not found' };
        }

        // Platform-specific close
        if (this.platform === 'win32') {
            await execAsync(`taskkill /PID ${targetWindow.processId} /F`);
        } else {
            await execAsync(`kill ${targetWindow.processId}`);
        }

        return {
            status: 'success',
            message: 'Window closed'
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

    async _openApplication(commandPayload) {
        const { app_name } = commandPayload;

        let command;
        if (this.platform === 'win32') {
            command = `start ${app_name}`;
        } else if (this.platform === 'darwin') {
            command = `open -a "${app_name}"`;
        } else {
            command = app_name;
        }

        try {
            await execAsync(command);
            return {
                status: 'success',
                message: `Opened application: ${app_name}`
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _closeApplication(commandPayload) {
        const { app_name } = commandPayload;

        let command;
        if (this.platform === 'win32') {
            command = `taskkill /IM ${app_name}.exe /F`;
        } else if (this.platform === 'darwin') {
            command = `pkill -f "${app_name}"`;
        } else {
            command = `pkill ${app_name}`;
        }

        try {
            await execAsync(command);
            return {
                status: 'success',
                message: `Closed application: ${app_name}`
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
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
        console.log(`ComputerControlHandler: Emitting result for request_id: ${request_id}`);
        this.eventEmitter.emit('computer-command-result', {
            request_id,
            result
        });
    }

    async cleanup() {
        console.log('ComputerControlHandler: Cleaning up...');
        
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
