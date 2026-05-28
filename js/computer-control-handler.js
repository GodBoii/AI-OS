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

                case 'list_installed_apps':
                    result = await this._listInstalledApplications();
                    break;

                case 'get_screen_elements':
                    result = await this._getScreenElements(commandPayload);
                    break;

                case 'find_element_by_text':
                    result = await this._findElementByText(commandPayload);
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

    /**
     * Apply a small random offset to a target coordinate (±pixels).
     * Simulates human targeting tolerance.
     */
    _applyClickOffset(value, maxOffset = 3) {
        return value + Math.round((Math.random() - 0.5) * 2 * maxOffset);
    }

    async _moveMouse(commandPayload) {
        const { x, y, smooth } = commandPayload;

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

    async _clickMouse(commandPayload) {
        const { button = 'left', double = false, x, y } = commandPayload;

        if (x !== undefined && y !== undefined) {
            // Apply minor random offset to target (±3px human targeting tolerance)
            const offsetX = this._applyClickOffset(x, 3);
            const offsetY = this._applyClickOffset(y, 3);

            // Use Bezier movement to reach the click target
            const currentPos = await mouse.getPosition();
            const start = { x: currentPos.x, y: currentPos.y };
            const end = { x: offsetX, y: offsetY };
            const distance = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
            const pointsCount = Math.max(10, Math.min(40, Math.round(distance / 20)));
            const bezierPath = this._generateBezierPath(start, end, pointsCount);

            for (let i = 1; i < bezierPath.length; i++) {
                await mouse.setPosition(new Point(bezierPath[i].x, bezierPath[i].y));
                await this._randomDelay(2, 6);
            }
        }

        const mouseButton = button === 'right' ? Button.RIGHT :
                           button === 'middle' ? Button.MIDDLE : Button.LEFT;

        // Humanized click: press, hold for 50-150ms, then release
        if (double) {
            await mouse.pressButton(mouseButton);
            await this._randomDelay(50, 120);
            await mouse.releaseButton(mouseButton);
            await this._randomDelay(80, 160); // Inter-click delay for double-click
            await mouse.pressButton(mouseButton);
            await this._randomDelay(50, 120);
            await mouse.releaseButton(mouseButton);
        } else {
            await mouse.pressButton(mouseButton);
            await this._randomDelay(50, 150);
            await mouse.releaseButton(mouseButton);
        }

        return {
            status: 'success',
            message: `${button} mouse ${double ? 'double-' : ''}clicked`
        };
    }

    async _typeText(commandPayload) {
        const { text } = commandPayload;

        // Humanized typing: variable inter-key delay (40ms-180ms per character)
        for (let i = 0; i < text.length; i++) {
            await keyboard.type(text[i]);
            // Variable delay: faster for common letter sequences, slower for shifts
            const baseDelay = 40;
            const variance = 140; // max additional delay
            const delay = baseDelay + Math.random() * variance;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

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

        // Humanized key chord: slight delay (10-30ms) between pressing each modifier
        for (let i = 0; i < nutKeys.length; i++) {
            await keyboard.pressKey(nutKeys[i]);
            if (i < nutKeys.length - 1) {
                await this._randomDelay(10, 30);
            }
        }
        // Brief hold at the end
        await this._randomDelay(30, 80);
        // Release in reverse order (natural human behavior)
        for (let i = nutKeys.length - 1; i >= 0; i--) {
            await keyboard.releaseKey(nutKeys[i]);
            if (i > 0) {
                await this._randomDelay(5, 15);
            }
        }

        return {
            status: 'success',
            message: `Pressed hotkey: ${keys.join('+')}`
        };
    }

    async _scroll(commandPayload) {
        const { direction, amount = 3 } = commandPayload;
        
        // Humanized scrolling: variable delays between scroll ticks
        for (let i = 0; i < amount; i++) {
            if (direction === 'down') {
                await mouse.scrollDown(1);
            } else {
                await mouse.scrollUp(1);
            }
            // Variable delay between scroll steps (humans don't scroll at constant speed)
            await this._randomDelay(30, 100);
        }

        return {
            status: 'success',
            message: `Scrolled ${direction} by ${amount}`
        };
    }

    async _dragDrop(commandPayload) {
        const { from_x, from_y, to_x, to_y } = commandPayload;

        // Move to start with Bezier curve
        const currentPos = await mouse.getPosition();
        const startPath = this._generateBezierPath(
            { x: currentPos.x, y: currentPos.y },
            { x: from_x, y: from_y },
            15
        );
        for (let i = 1; i < startPath.length; i++) {
            await mouse.setPosition(new Point(startPath[i].x, startPath[i].y));
            await this._randomDelay(3, 7);
        }

        // Press and hold
        await mouse.pressButton(Button.LEFT);
        await this._randomDelay(80, 150);

        // Drag along Bezier curve to destination
        const dragPath = this._generateBezierPath(
            { x: from_x, y: from_y },
            { x: to_x, y: to_y },
            25
        );
        for (let i = 1; i < dragPath.length; i++) {
            await mouse.setPosition(new Point(dragPath[i].x, dragPath[i].y));
            await this._randomDelay(5, 12);
        }

        // Brief pause before release (human hesitation at target)
        await this._randomDelay(50, 120);
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

    // ===== SCREEN ELEMENT DETECTION =====

    /**
     * Get interactive screen elements using Windows UI Automation (PowerShell).
     * Returns buttons, links, text fields with their coordinates for precise targeting.
     */
    async _getScreenElements(commandPayload) {
        const { window_title, element_type } = commandPayload;

        if (this.platform !== 'win32') {
            return { status: 'error', error: 'Screen element detection is currently only supported on Windows.' };
        }

        try {
            // Use UI Automation via PowerShell to get interactive elements
            let psFilter = '';
            if (element_type) {
                const typeMap = {
                    'button': 'Button',
                    'edit': 'Edit',
                    'text': 'Text',
                    'link': 'Hyperlink',
                    'checkbox': 'CheckBox',
                    'radio': 'RadioButton',
                    'combobox': 'ComboBox',
                    'list': 'List',
                    'menu': 'MenuItem',
                    'tab': 'TabItem',
                };
                psFilter = typeMap[element_type] ? `| Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.${typeMap[element_type]}' }` : '';
            }

            let windowFilter = '';
            if (window_title) {
                windowFilter = `$window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${window_title.replace(/'/g, "''")}')));\nif (-not $window) { $window = [System.Windows.Automation.AutomationElement]::RootElement }`;
            } else {
                windowFilter = '$window = [System.Windows.Automation.AutomationElement]::RootElement';
            }

            const psScript = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
${windowFilter}
$elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) ${psFilter}
$results = @()
$count = 0
foreach ($el in $elements) {
    if ($count -ge 50) { break }
    try {
        $rect = $el.Current.BoundingRectangle
        if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
            $results += @{
                Name = $el.Current.Name
                ControlType = $el.Current.ControlType.ProgrammaticName
                X = [int]($rect.X + $rect.Width / 2)
                Y = [int]($rect.Y + $rect.Height / 2)
                Width = [int]$rect.Width
                Height = [int]$rect.Height
                IsEnabled = $el.Current.IsEnabled
                AutomationId = $el.Current.AutomationId
            }
            $count++
        }
    } catch {}
}
$results | ConvertTo-Json -Compress
`.trim();

            const { stdout } = await execAsync(
                `powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
                { timeout: 15000 }
            );

            let elements = [];
            if (stdout && stdout.trim()) {
                const parsed = JSON.parse(stdout);
                elements = Array.isArray(parsed) ? parsed : [parsed];
            }

            return {
                status: 'success',
                elements: elements,
                count: elements.length
            };
        } catch (error) {
            return { status: 'error', error: `Element detection failed: ${error.message}` };
        }
    }

    /**
     * Find a specific UI element by its visible text/label and return its click coordinates.
     * Useful for "click the Save button" type commands — gives exact coordinates.
     */
    async _findElementByText(commandPayload) {
        const { text, window_title } = commandPayload;

        if (this.platform !== 'win32') {
            return { status: 'error', error: 'Element finder is currently only supported on Windows.' };
        }

        if (!text) {
            return { status: 'error', error: 'Text parameter is required.' };
        }

        try {
            const searchText = text.replace(/'/g, "''");
            let windowScope = '$root = [System.Windows.Automation.AutomationElement]::RootElement';
            if (window_title) {
                const safeTitle = window_title.replace(/'/g, "''");
                windowScope = `$root = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${safeTitle}'))); if (-not $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement }`;
            }

            const psScript = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
${windowScope}
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${searchText}')
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$results = @()
foreach ($el in $elements) {
    try {
        $rect = $el.Current.BoundingRectangle
        if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
            $results += @{
                Name = $el.Current.Name
                ControlType = $el.Current.ControlType.ProgrammaticName
                CenterX = [int]($rect.X + $rect.Width / 2)
                CenterY = [int]($rect.Y + $rect.Height / 2)
                Width = [int]$rect.Width
                Height = [int]$rect.Height
            }
        }
    } catch {}
}
$results | ConvertTo-Json -Compress
`.trim();

            const { stdout } = await execAsync(
                `powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
                { timeout: 10000 }
            );

            let elements = [];
            if (stdout && stdout.trim()) {
                const parsed = JSON.parse(stdout);
                elements = Array.isArray(parsed) ? parsed : [parsed];
            }

            if (elements.length === 0) {
                return { status: 'error', error: `No element found with text: "${text}"` };
            }

            return {
                status: 'success',
                elements: elements,
                count: elements.length,
                // Provide the first match's center as the recommended click target
                recommended_click: {
                    x: elements[0].CenterX,
                    y: elements[0].CenterY
                }
            };
        } catch (error) {
            return { status: 'error', error: `Element search failed: ${error.message}` };
        }
    }

    // ===== APPLICATION DISCOVERY =====

    async _listInstalledApplications() {
        try {
            let apps = [];

            if (this.platform === 'win32') {
                // Strategy 1: Get-StartApps (UWP + Start Menu shortcuts - fast)
                try {
                    const { stdout: startAppsJson } = await execAsync(
                        'powershell -NoProfile -Command "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress"',
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
                        const psCmd = `powershell -NoProfile -Command "Get-ItemProperty '${regPath}' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -ne $null } | Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation | ConvertTo-Json -Compress"`;
                        const { stdout: regJson } = await execAsync(psCmd, { timeout: 15000 });
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
