// js/computer-control-handler.js
// Computer Control Handler for AI Agent Desktop Automation

const { screen, clipboard, desktopCapturer, powerMonitor } = require('electron');
const { keyboard, Key, mouse, Button, straightTo, Point, Region, screen: nutScreen } = require('@nut-tree-fork/nut-js');
const activeWin = require('active-win');
const windowManager = require('node-window-manager');
const loudness = require('loudness');
const fs = require('fs').promises;
const path = require('path');
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
                        platform: this.platform,
                        screen_size: screen.getPrimaryDisplay().size
                    };
                    break;

                case 'request_permission':
                    this.isEnabled = true;
                    result = {
                        status: 'success',
                        message: 'Computer control enabled',
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
        
        const screenshotPath = await this._uploadScreenshot(screenshotBase64);

        return {
            status: 'success',
            screenshot_path: screenshotPath,
            width: sources[0].thumbnail.getSize().width,
            height: sources[0].thumbnail.getSize().height
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

        try {
            const files = await fs.readdir(directory, { withFileTypes: true });
            const fileList = files.map(file => ({
                name: file.name,
                type: file.isDirectory() ? 'directory' : 'file',
                path: path.join(directory, file.name)
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

        try {
            const content = await fs.readFile(file_path, encoding);
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

        try {
            await fs.writeFile(file_path, content, encoding);
            return {
                status: 'success',
                message: `File written: ${file_path}`,
                size: content.length
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _deleteFile(commandPayload) {
        const { file_path } = commandPayload;

        try {
            const stats = await fs.stat(file_path);
            if (stats.isDirectory()) {
                await fs.rmdir(file_path, { recursive: true });
            } else {
                await fs.unlink(file_path);
            }

            return {
                status: 'success',
                message: `Deleted: ${file_path}`
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _createDirectory(commandPayload) {
        const { directory_path } = commandPayload;

        try {
            await fs.mkdir(directory_path, { recursive: true });
            return {
                status: 'success',
                message: `Directory created: ${directory_path}`
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

        if (this.fileWatchers.has(watch_id)) {
            return { status: 'error', error: 'Watcher with this ID already exists' };
        }

        const watcher = chokidar.watch(directory, {
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
            message: `Watching directory: ${directory}`,
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
    }
}

module.exports = ComputerControlHandler;
