// preload.js (Verified Correct Version)

const { contextBridge, ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const authService = require('./auth-service');

// Define allowed IPC channels for security
const validSendChannels = [
    'minimize-window',
    'toggle-maximize-window',
    'close-window',
    'open-webview',
    'send-message',
    'webview-navigate',
    'close-webview',
    'resize-webview',
    'drag-webview',
    'check-socket-connection',
    'restart-python-bridge',
    'terminate-session',
    'deepsearch-request',
    'open-browse-ai-webview',
    'close-browse-ai-webview',
    'browse-ai-webview-navigate',
    'browse-ai-header-height',
    'browse-ai-send-message',
    'initialize-browser-agent',
    'handle-auth-redirect'
];

const validReceiveChannels = [
    'chat-response',
    'socket-error',
    'socket-status',
    'socket-connection-status',
    'agent-step', 
    'webview-created',
    'webview-closed',
    'webview-navigation-updated',
    'webview-page-loaded',
    'webview-content-captured',
    'window-state-changed',
    'sandbox-command-started',
    'sandbox-command-update',
    'sandbox-command-finished',
    'image_generated',
    'browse-ai-webview-created',
    'browse-ai-webview-closed',
    'browse-ai-webview-navigation-updated',
    'browse-ai-response',
    'browse-ai-error',
    'browse-ai-status',
    'browse-ai-interaction',
    'browse-ai-agent-initialized',
    'auth-state-changed'
];

const validInvokeChannels = [
    'show-save-dialog',
    'save-file',
    'get-path',
    'get-app-path',
    'resolve-app-resource'
];

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld(
    "electron", {
        // Exposes the ability to open external links in the user's default browser
        shell: {
            openExternal: (url) => shell.openExternal(url)
        },
        
        // Exposes secure IPC communication channels
        ipcRenderer: {
            send: (channel, data) => {
                if (validSendChannels.includes(channel)) {
                    ipcRenderer.send(channel, data);
                }
            },
            on: (channel, func) => {
                if (validReceiveChannels.includes(channel)) {
                    // Deliberately strip event as it includes sender
                    ipcRenderer.on(channel, (event, ...args) => func(...args));
                }
            },
            invoke: async (channel, ...args) => {
                if (validInvokeChannels.includes(channel)) {
                    return await ipcRenderer.invoke(channel, ...args);
                }
                return null;
            },
            removeAllListeners: (channel) => {
                if (validReceiveChannels.includes(channel)) {
                    ipcRenderer.removeAllListeners(channel);
                }
            }
        },

        // Exposes file system utilities
        fs: {
            existsSync: (path) => fs.existsSync(path),
            readFileSync: (path, options) => fs.readFileSync(path, options),
            writeFileSync: (path, data, options) => fs.writeFileSync(path, data, options),
            unlinkSync: (path) => fs.unlinkSync(path),
            mkdirSync: (path, options) => fs.mkdirSync(path, options),
            readdirSync: (path, options) => fs.readdirSync(path, options),
            statSync: (path, options) => {
                const stat = fs.statSync(path, options);
                return {
                    isFile: () => stat.isFile(),
                    isDirectory: () => stat.isDirectory(),
                    mtime: stat.mtime,
                    size: stat.size
                };
            },
            promises: {
                readFile: async (path, options) => await fs.promises.readFile(path, options),
                writeFile: async (path, data, options) => await fs.promises.writeFile(path, data, options),
                unlink: async (path) => await fs.promises.unlink(path),
                mkdir: async (path, options) => await fs.promises.mkdir(path, options),
                readdir: async (path, options) => await fs.promises.readdir(path, options),
                stat: async (path, options) => {
                    const stat = await fs.promises.stat(path, options);
                    return {
                        isFile: () => stat.isFile(),
                        isDirectory: () => stat.isDirectory(),
                        mtime: stat.mtime,
                        size: stat.size
                    };
                }
            }
        },

        // Exposes path utilities
        path: {
            join: (...paths) => path.join(...paths),
            basename: (path, ext) => path.basename(path, ext),
            dirname: (path) => path.dirname(path),
            extname: (path) => path.extname(path),
            resolve: (...paths) => path.resolve(...paths),
            isAbsolute: (path) => path.isAbsolute(path)
        },

        // Exposes child process utilities
        childProcess: {
            spawn: (command, args, options) => {
                const childProcess = spawn(command, args, options);
                return {
                    pid: childProcess.pid,
                    stdout: { on: (event, callback) => { if (event === 'data') { childProcess.stdout.on('data', (data) => callback(data.toString())); } } },
                    stderr: { on: (event, callback) => { if (event === 'data') { childProcess.stderr.on('data', (data) => callback(data.toString())); } } },
                    on: (event, callback) => { if (['close', 'exit', 'error'].includes(event)) { childProcess.on(event, callback); } },
                    kill: (signal) => childProcess.kill(signal)
                };
            }
        },

        // Exposes the full authentication service API
        auth: {
            init: async () => await authService.init(),
            signUp: async (email, password, name) => await authService.signUp(email, password, name),
            signIn: async (email, password) => await authService.signIn(email, password),
            signInWithGoogle: async () => await authService.signInWithGoogle(),
            signOut: async () => await authService.signOut(),
            getCurrentUser: () => authService.getCurrentUser(),
            isAuthenticated: () => authService.isAuthenticated(),
            getSession: async () => await authService.getSession(),
            onAuthChange: (callback) => {
                const wrappedCallback = (user) => callback(user);
                return authService.onAuthChange(wrappedCallback);
            }
        }
    }
);