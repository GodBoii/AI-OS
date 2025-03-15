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
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false
        },
        frame: false,
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
        console.log('Received open-webview request for URL:', url);
        
        // Close existing webview if there is one
        if (webView) {
            try {
                mainWindow.removeBrowserView(webView);
                webView.webContents.destroy();
                webView = null;
            } catch (error) {
                console.error('Error closing existing webview:', error);
            }
        }
    
        try {
            // Create new webview
            webView = new BrowserView({
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: true
                }
            });
            
            mainWindow.addBrowserView(webView);
            
            // Get the content bounds for proper sizing
            const contentBounds = mainWindow.getContentBounds();
            
            // Create a smaller window positioned in the top-right
            const bounds = {
                x: Math.round(contentBounds.width * 0.65), // Position more to the right
                y: 100, // A bit from the top
                width: Math.round(contentBounds.width * 0.30), // 30% of window width
                height: Math.round(contentBounds.height * 0.5) // 50% of window height
            };
            
            // Set bounds with offset for header and borders
            // Make the actual webview much smaller to avoid overlapping controls
            webView.setBounds({
                x: bounds.x + 10, // Add padding for left border
                y: bounds.y + 60, // Add significant padding for header 
                width: bounds.width - 20, // Remove width for left and right borders
                height: bounds.height - 70 // Remove height for header and borders
            });
            
            // Set up navigation event handlers
            webView.webContents.on('did-start-loading', () => {
                mainWindow.webContents.send('webview-navigation-updated', { 
                    url: webView.webContents.getURL(),
                    loading: true
                });
            });
            
            webView.webContents.on('did-finish-load', () => {
                const currentUrl = webView.webContents.getURL();
                mainWindow.webContents.send('webview-navigation-updated', { 
                    url: currentUrl,
                    loading: false,
                    canGoBack: webView.webContents.canGoBack(),
                    canGoForward: webView.webContents.canGoForward()
                });
                
                mainWindow.webContents.send('webview-page-loaded');
            });
            
            webView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                console.error('Webview failed to load:', errorDescription);
                mainWindow.webContents.send('webview-navigation-updated', { 
                    error: errorDescription
                });
            });
            
            // Finally load the URL
            webView.webContents.loadURL(url).then(() => {
                console.log('URL loaded successfully:', url);
                mainWindow.webContents.send('webview-created', bounds);
            }).catch((error) => {
                console.error('Failed to load URL:', error);
                mainWindow.webContents.send('socket-error', { 
                    message: `Failed to load URL: ${error.message}`
                });
            });
        } catch (error) {
            console.error('Error creating webview:', error);
            mainWindow.webContents.send('socket-error', { 
                message: `Error creating webview: ${error.message}`
            });
        }
    });

    ipcMain.on('resize-webview', (event, bounds) => {
        if (webView) {
            // Use a more aggressive padding to ensure the content doesn't overlap controls
            webView.setBounds({
                x: bounds.x + 10, // Add padding for left border
                y: bounds.y + 60, // Add significant padding for header
                width: bounds.width - 20, // Remove width for left and right borders
                height: bounds.height - 70 // Remove height for header and bottom
            });
        }
    });

    ipcMain.on('drag-webview', (event, { x, y }) => {
        if (webView) {
            const currentBounds = webView.getBounds();
            webView.setBounds({
                x: x + 10, // Add padding for left border
                y: y + 60, // Add significant padding for header
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

// File handling IPC handlers for artifact download
const fs = require('fs').promises;

// Handler for showing save dialog
ipcMain.handle('show-save-dialog', async (event, options) => {
  const { dialog } = require('electron');
  return await dialog.showSaveDialog(mainWindow, options);
});

// Handler for saving file content
ipcMain.handle('save-file', async (event, { filePath, content }) => {
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving file:', error);
    return false;
  }
});

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