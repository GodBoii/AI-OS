const electron = require('electron');
const { app, BrowserWindow, ipcMain, BrowserView, dialog } = electron; // Added 'dialog'
const path = require('path');
const fs = require('fs'); // Added 'fs' for path checking
const PythonBridge = require('./python-bridge');
const { spawn } = require('child_process');
const http = require('http');

// --- START: NEW BROWSER MANAGEMENT SECTION ---

// This global variable will hold the single, managed browser process.
// It acts as the source of truth for whether the controlled browser is running.
let managedBrowserProcess = null;

/**
 * Finds the executable and user data paths for common Chromium browsers.
 * This is OS-aware.
 * @returns {object|null} An object with { exePath, userDataDir } or null if not found.
 */
function getBrowserPaths() {
    const homeDir = app.getPath('home');
    let paths = {};

    switch (process.platform) {
        case 'win32': // Windows
            const localAppData = process.env.LOCALAPPDATA;
            paths = {
                Chrome: {
                    exePath: path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                    userDataDir: path.join(localAppData, 'Google', 'Chrome', 'User Data')
                },
                Edge: {
                    exePath: path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                    userDataDir: path.join(localAppData, 'Microsoft', 'Edge', 'User Data')
                }
            };
            break;

        case 'darwin': // macOS
            paths = {
                Chrome: {
                    exePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    userDataDir: path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome')
                },
                Edge: {
                    exePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                    userDataDir: path.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge')
                }
            };
            break;

        case 'linux': // Linux
            paths = {
                Chrome: {
                    exePath: '/usr/bin/google-chrome',
                    userDataDir: path.join(homeDir, '.config', 'google-chrome')
                },
                Edge: {
                    exePath: '/usr/bin/microsoft-edge',
                    userDataDir: path.join(homeDir, '.config', 'microsoft-edge')
                }
            };
            break;
    }

    // Find the first installed browser from our list and return its paths
    for (const browser in paths) {
        if (fs.existsSync(paths[browser].exePath)) {
            return paths[browser];
        }
    }

    return null; // No supported browser found
}

/**
 * Launches the user's default browser in a managed, controllable state.
 * Asks for user permission before proceeding.
 * @returns {Promise<boolean>} True if the browser was launched successfully, false otherwise.
 */
async function launchManagedBrowser() {
    if (managedBrowserProcess) {
        console.log('Managed browser is already running.');
        return true;
    }

    const browserPaths = getBrowserPaths();
    if (!browserPaths) {
        console.error('No supported browser (Chrome, Edge) found on this system.');
        dialog.showErrorBox('Browser Not Found', 'Could not find a compatible browser (Chrome or Edge) to control.');
        return false;
    }

    // Ask user for permission to relaunch their browser
    const userResponse = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Relaunch Browser', 'Cancel'],
        defaultId: 0,
        title: 'Browser Control Request',
        message: 'Aetheria AI needs to control your browser.',
        detail: 'To securely interact with websites on your behalf without asking for passwords, the application needs to relaunch your default browser in a special automation mode. Your existing tabs can be restored. Is this okay?'
    });

    if (userResponse.response !== 0) { // User clicked "Cancel"
        console.log('User denied browser control permission.');
        return false;
    }

    console.log(`Launching browser from: ${browserPaths.exePath}`);
    try {
        managedBrowserProcess = spawn(browserPaths.exePath, [
            '--remote-debugging-port=9222',
            '--remote-debugging-address=0.0.0.0',
            `--user-data-dir=${browserPaths.userDataDir}`
        ]);

        managedBrowserProcess.on('exit', (code) => {
            console.log(`Managed browser process exited with code ${code}.`);
            managedBrowserProcess = null; // Reset the state
            // Optionally notify the renderer that the connection is lost
            mainWindow.webContents.send('browser-connection-lost');
        });

        managedBrowserProcess.on('error', (err) => {
            console.error('Failed to start managed browser process:', err);
            managedBrowserProcess = null;
        });

        // Give the browser a moment to start up before confirming readiness
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('Managed browser launched successfully.');
        return true;

    } catch (error) {
        console.error('Error spawning managed browser:', error);
        dialog.showErrorBox('Launch Error', 'Failed to launch the browser. Please ensure it is not running and try again.');
        return false;
    }
}

/**
 * Terminates the managed browser process if it is running.
 */
function killManagedBrowser() {
    if (managedBrowserProcess) {
        console.log('Terminating managed browser process.');
        managedBrowserProcess.kill();
        managedBrowserProcess = null;
    }
}

// --- END: NEW BROWSER MANAGEMENT SECTION ---


// Enable Chrome DevTools Protocol for all browser instances at startup
// This must be called before app.whenReady()
app.commandLine.appendSwitch('enable-features', 'NetworkService,NetworkServiceInProcess');

// Register custom protocol for deep linking
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('aios', process.execPath, [path.resolve(process.argv[1])]);
    }
} else {
    app.setAsDefaultProtocolClient('aios');
}

let mainWindow;
let pythonBridge;
let linkWebView = null; // Keep existing linkWebView

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(app.getAppPath(), 'assets/icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: true,
            enableRemoteModule: true,
            webSecurity: false
        },
        frame: false,
        transparent: true
    });

    mainWindow.maximize();
    mainWindow.loadFile('index.html');

    // Initialize the Python bridge to connect to the Docker container
    pythonBridge = new PythonBridge(mainWindow);
    console.log('Connecting to Python backend in Docker...');
    pythonBridge.start().catch(error => {
        console.error('Python bridge error:', error.message);
        // Notify the renderer process about the error
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('socket-connection-status', {
                connected: false,
                error: 'Failed to connect to Python backend: ' + error.message
            });
        });

        // Try reconnecting after a delay
        setTimeout(() => {
            console.log('Attempting to reconnect to Python backend...');
            if (pythonBridge) {
                pythonBridge.stop();
            }
            pythonBridge = new PythonBridge(mainWindow);
            pythonBridge.start().catch(err => {
                console.error('Python bridge reconnection failed:', err.message);
            });
        }, 10000);
    });

    // --- START: NEW IPC HANDLERS FOR BROWSER CONTROL ---
    ipcMain.on('start-browser', async (event) => {
        const success = await launchManagedBrowser();
        if (success) {
            event.sender.send('browser-ready');
        } else {
            event.sender.send('browser-start-denied');
        }
    });

    ipcMain.on('stop-browser', () => {
        killManagedBrowser();
    });
    // --- END: NEW IPC HANDLERS ---


    ipcMain.on('minimize-window', () => {
        mainWindow.minimize();
    });

    ipcMain.on('toggle-maximize-window', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
        mainWindow.webContents.send('window-state-changed', mainWindow.isMaximized());
    });

    ipcMain.on('close-window', () => {
        mainWindow.close();
    });

    ipcMain.on('deepsearch-request', (event, data) => {
        pythonBridge.sendMessage(data);
    });

    ipcMain.on('check-socket-connection', (event) => {
        const isConnected = pythonBridge.socket && pythonBridge.socket.connected;
        event.reply('socket-connection-status', { connected: isConnected });
    });

    ipcMain.on('restart-python-bridge', () => {
        if (pythonBridge) {
            pythonBridge.stop();
        }
        pythonBridge = new PythonBridge(mainWindow);
        pythonBridge.start().catch(error => {
            console.error('Failed to restart Python bridge:', error);
            mainWindow.webContents.send('socket-connection-status', {
                connected: false,
                error: 'Failed to connect to Python backend: ' + error.message
            });
        });
    });

    // This 'open-webview' functionality is for the small, embedded view and is separate
    // from the main browser control. It remains unchanged.
    ipcMain.on('open-webview', (event, url) => {
        console.log('Received open-webview request for URL:', url);

        if (linkWebView) {
            try {
                mainWindow.removeBrowserView(linkWebView);
                linkWebView.webContents.destroy();
                linkWebView = null;
            } catch (error) {
                console.error('Error closing existing linkWebView:', error);
            }
        }

        try {
            linkWebView = new BrowserView({
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: true
                }
            });

            mainWindow.addBrowserView(linkWebView);
            const contentBounds = mainWindow.getContentBounds();
            const bounds = {
                x: Math.round(contentBounds.width * 0.65),
                y: 100,
                width: Math.round(contentBounds.width * 0.30),
                height: Math.round(contentBounds.height * 0.5)
            };
            linkWebView.setBounds({
                x: bounds.x + 10,
                y: bounds.y + 60,
                width: bounds.width - 20,
                height: bounds.height - 70
            });

            linkWebView.webContents.on('did-start-loading', () => {
                mainWindow.webContents.send('webview-navigation-updated', {
                    url: linkWebView.webContents.getURL(),
                    loading: true
                });
            });

            linkWebView.webContents.on('did-finish-load', () => {
                const currentUrl = linkWebView.webContents.getURL();
                mainWindow.webContents.send('webview-navigation-updated', {
                    url: currentUrl,
                    loading: false,
                    canGoBack: linkWebView.webContents.canGoBack(),
                    canGoForward: linkWebView.webContents.canGoForward()
                });
                mainWindow.webContents.send('webview-page-loaded');
            });

            linkWebView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                console.error('linkWebView failed to load:', errorDescription);
                mainWindow.webContents.send('webview-navigation-updated', {
                    error: errorDescription
                });
            });

            linkWebView.webContents.loadURL(url).then(() => {
                console.log('URL loaded successfully:', url);
                mainWindow.webContents.send('webview-created', bounds);
            }).catch((error) => {
                console.error('Failed to load URL:', error);
                mainWindow.webContents.send('socket-error', {
                    message: `Failed to load URL: ${error.message}`
                });
            });
        } catch (error) {
            console.error('Error creating linkWebView:', error);
            mainWindow.webContents.send('socket-error', {
                message: `Error creating linkWebView: ${error.message}`
            });
        }
    });

    ipcMain.on('resize-webview', (event, bounds) => {
        if (linkWebView) {
            linkWebView.setBounds({
                x: bounds.x + 10,
                y: bounds.y + 60,
                width: bounds.width - 20,
                height: bounds.height - 70
            });
        }
    });

    ipcMain.on('drag-webview', (event, { x, y }) => {
        if (linkWebView) {
            const currentBounds = linkWebView.getBounds();
            linkWebView.setBounds({
                x: x + 10,
                y: y + 60,
                width: currentBounds.width,
                height: currentBounds.height
            });
        }
    });

    ipcMain.on('close-webview', () => {
        if (linkWebView) {
            mainWindow.removeBrowserView(linkWebView);
            linkWebView.webContents.destroy();
            linkWebView = null;
            mainWindow.webContents.send('webview-closed');
        }
    });
}

// Handle deep linking on macOS
app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
});

// Handle deep linking on Windows
function handleDeepLink(url) {
    if (!url || !url.startsWith('aios://')) return;
    
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'auth-callback') {
            const token = urlObj.searchParams.get('token');
            const refreshToken = urlObj.searchParams.get('refresh_token');
            if (token && mainWindow) {
                mainWindow.webContents.send('auth-state-changed', { token, refreshToken });
            }
        }
    } catch (error) {
        console.error('Error handling deep link:', error);
    }
}

// File handling IPC handlers for artifact download
const fsPromises = require('fs').promises;

ipcMain.handle('show-save-dialog', async (event, options) => {
  const { dialog } = require('electron');
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('save-file', async (event, { filePath, content }) => {
  try {
    await fsPromises.writeFile(filePath, content, 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving file:', error);
    return false;
  }
});

// Path resolution IPC handlers
ipcMain.handle('get-path', (event, pathName) => {
    try {
        return app.getPath(pathName);
    } catch (error) {
        console.error(`Error getting path for ${pathName}:`, error);
        return null;
    }
});

ipcMain.handle('get-app-path', () => {
    return app.getAppPath();
});

ipcMain.handle('resolve-app-resource', (event, ...segments) => {
    return path.join(app.getAppPath(), ...segments);
});

app.whenReady().then(createWindow);

// Handle deep linking on Windows
if (process.platform === 'win32') {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
        const deepLinkUrl = commandLine.find(arg => arg.startsWith('aios://'));
        if (deepLinkUrl) {
            handleDeepLink(deepLinkUrl);
        }
    });
    
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
    } else {
        const deepLinkArg = process.argv.find(arg => arg.startsWith('aios://'));
        if (deepLinkArg) {
            handleDeepLink(deepLinkArg);
        }
    }
}

app.on('window-all-closed', () => {
    if (pythonBridge) {
        try {
            pythonBridge.stop();
            pythonBridge = null;
        } catch (error) {
            console.error('Error stopping Python bridge:', error.message);
        }
    }
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', (event) => {
    // --- MODIFIED: Add cleanup for the managed browser ---
    console.log('App is quitting. Cleaning up resources...');
    killManagedBrowser(); // Ensure the browser we launched is closed.
    
    if (linkWebView) {
        try {
            mainWindow.removeBrowserView(linkWebView);
            linkWebView.webContents.destroy();
            linkWebView = null;
        } catch (error) {
            console.error('Error cleaning up linkWebView:', error.message);
        }
    }
    
    if (pythonBridge) {
        try {
            pythonBridge.stop();
            pythonBridge = null;
        } catch (error) {
            console.error('Error stopping Python bridge:', error.message);
        }
    }
});