const electron = require('electron');
const { app, BrowserWindow, ipcMain, BrowserView } = electron;
const path = require('path');
const PythonBridge = require('./python-bridge');

let mainWindow;
let pythonBridge;
let webView = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false
        },
        frame: true,
        transparent: true
    });

    mainWindow.maximize();
    mainWindow.loadFile('index.html');

    pythonBridge = new PythonBridge(mainWindow);
    console.log('Starting Python bridge...');
    pythonBridge.start().catch(error => {
        console.error('Python bridge error:', error.message);
        // Notify the renderer process about the error
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('socket-connection-status', { 
                connected: false,
                error: 'Failed to start Python server: ' + error.message
            });
        });
        
        // Try restarting after a delay
        setTimeout(() => {
            console.log('Attempting to restart Python bridge...');
            if (pythonBridge) {
                pythonBridge.stop();
            }
            pythonBridge = new PythonBridge(mainWindow);
            pythonBridge.start().catch(err => {
                console.error('Python bridge restart failed:', err.message);
            });
        }, 10000);
    });

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
                error: 'Failed to restart Python server: ' + error.message
            });
        });
    });

    ipcMain.on('open-webview', (event, url) => {
        if (webView) {
            mainWindow.removeBrowserView(webView);
            webView = null;
        }

        webView = new BrowserView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            }
        });
        
        mainWindow.addBrowserView(webView);
        
        // Initial bounds - account for the header height
        const bounds = {
            x: mainWindow.getSize()[0] - 420,
            y: 100,
            width: 400,
            height: 300
        };
        
        // Set bounds with padding for controls
        webView.setBounds({
            x: bounds.x,
            y: bounds.y + 40, // Add header height
            width: bounds.width,
            height: bounds.height - 40 // Subtract header height
        });
        
        webView.webContents.loadURL(url);
        event.reply('webview-created', bounds);
    });

    ipcMain.on('resize-webview', (event, bounds) => {
        if (webView) {
            webView.setBounds({
                x: bounds.x,
                y: bounds.y + 40, // Add header height
                width: bounds.width,
                height: bounds.height - 40 // Subtract header height
            });
        }
    });

    ipcMain.on('drag-webview', (event, { x, y }) => {
        if (webView) {
            const currentBounds = webView.getBounds();
            webView.setBounds({
                x: x,
                y: y + 40, // Add header height
                width: currentBounds.width,
                height: currentBounds.height
            });
        }
    });

    ipcMain.on('close-webview', () => {
        if (webView) {
            mainWindow.removeBrowserView(webView);
            webView.webContents.destroy();
            webView = null;
            mainWindow.webContents.send('webview-closed');
        }
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    // Clean up Python bridge
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
    // Clean up resources before quitting
    if (webView) {
        try {
            mainWindow.removeBrowserView(webView);
            webView.webContents.destroy();
            webView = null;
        } catch (error) {
            console.error('Error cleaning up webView:', error.message);
        }
    }
    
    // Make sure Python bridge is properly cleaned up
    if (pythonBridge) {
        try {
            pythonBridge.stop();
            pythonBridge = null;
        } catch (error) {
            console.error('Error stopping Python bridge:', error.message);
        }
    }
});