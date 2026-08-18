const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
let nodePty = null;
try {
    // Optional at runtime; if unavailable we fallback to stdio spawn mode.
    nodePty = require('node-pty');
} catch (_error) {
    nodePty = null;
}

const execAsync = promisify(exec);

class LocalCoderHandler {
    constructor(eventEmitter, mainWindow) {
        this.eventEmitter = eventEmitter;
        this.mainWindow = mainWindow;
        this.workspaceContexts = new Map();
        this.watchers = new Map();
        this.terminals = new Map();
        this.platform = process.platform;
        this.isShuttingDown = false;
    }

    _isRendererAvailable() {
        if (this.isShuttingDown) return false;
        if (!this.mainWindow || typeof this.mainWindow.isDestroyed !== 'function') return false;
        if (this.mainWindow.isDestroyed()) return false;
        const wc = this.mainWindow.webContents;
        if (!wc || typeof wc.isDestroyed !== 'function') return false;
        return !wc.isDestroyed();
    }

    _emitRenderer(channel, payload) {
        if (!this._isRendererAvailable()) return false;
        try {
            this.mainWindow.webContents.send(channel, payload);
            return true;
        } catch (error) {
            const message = String(error?.message || '').toLowerCase();
            if (!this.isShuttingDown && !message.includes('object has been destroyed')) {
                console.warn(`[LocalCoderHandler] Failed to emit '${channel}':`, error.message);
            }
            return false;
        }
    }

    _resolveTerminalShell() {
        if (this.platform === 'win32') {
            const winRoot = process.env.SystemRoot || 'C:\\Windows';
            const defaultPsPath = path.join(winRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            return {
                shell: defaultPsPath,
                args: ['-NoLogo'],
            };
        }

        const shell = process.env.SHELL || '/bin/bash';
        return {
            shell,
            args: ['--login'],
        };
    }

    _resolveFallbackTerminalShell(primaryShell) {
        if (this.platform === 'win32') {
            const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
            if (!primaryShell || String(primaryShell).toLowerCase().includes('powershell')) {
                return {
                    shell: comspec,
                    args: [],
                };
            }

            return {
                shell: primaryShell,
                args: [],
            };
        }

        return {
            shell: primaryShell || (process.env.SHELL || '/bin/bash'),
            args: ['-i'],
        };
    }

    initialize() {
        this.eventEmitter.on('execute-local-coder-command', async (commandPayload) => {
            await this.handleCommand(commandPayload);
        });
    }

    setWorkspaceContext(conversationId, context = {}) {
        if (!conversationId) return null;
        const existing = this.workspaceContexts.get(conversationId) || {};
        const merged = {
            ...existing,
            ...context,
        };
        this.workspaceContexts.set(conversationId, merged);
        return merged;
    }

    getWorkspaceContext(conversationId) {
        if (!conversationId) return null;
        return this.workspaceContexts.get(conversationId) || null;
    }

    clearWorkspaceContext(conversationId) {
        if (!conversationId) return;
        this.workspaceContexts.delete(conversationId);
        this.stopWatching(conversationId);
        this.stopTerminal(conversationId);
    }

    async cloneRepo({ conversationId, repoUrl, branch = 'main', parentFolder }) {
        if (!repoUrl || !/^https?:\/\/|^git@/i.test(String(repoUrl).trim())) {
            return { success: false, error: 'Invalid repository URL' };
        }
        if (!parentFolder) {
            return { success: false, error: 'Target folder is required' };
        }

        const repoName = this._deriveRepoName(repoUrl);
        const branchName = String(branch || 'main').trim() || 'main';
        const destinationPath = path.join(parentFolder, repoName);

        try {
            const exists = await this._pathExists(destinationPath);
            if (exists) {
                const entries = await fsp.readdir(destinationPath);
                if (entries.length > 0) {
                    return {
                        success: false,
                        error: `Destination already exists and is not empty: ${destinationPath}`,
                    };
                }
            }

            await fsp.mkdir(parentFolder, { recursive: true });

            const cloneResult = await this._spawnAndCollect(
                'git',
                ['clone', '--branch', branchName, '--single-branch', repoUrl, destinationPath],
                { cwd: parentFolder }
            );

            if (cloneResult.exitCode !== 0) {
                return {
                    success: false,
                    error: cloneResult.stderr || cloneResult.stdout || 'git clone failed',
                    stdout: cloneResult.stdout,
                    stderr: cloneResult.stderr,
                    exit_code: cloneResult.exitCode,
                };
            }

            const context = this.setWorkspaceContext(conversationId, {
                root_path: destinationPath,
                repo_url: repoUrl,
                branch: branchName,
                repo_name: repoName,
                is_ready: true,
            });

            return {
                success: true,
                root_path: destinationPath,
                repo_name: repoName,
                branch: branchName,
                repo_url: repoUrl,
                stdout: cloneResult.stdout,
                stderr: cloneResult.stderr,
                context,
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async importProjectFiles({
        conversationId,
        parentFolder,
        projectName,
        files = [],
        repoUrl = null,
        branch = 'main',
        metadata = {},
    }) {
        if (!parentFolder) {
            return { success: false, error: 'Target folder is required' };
        }
        if (!Array.isArray(files) || files.length === 0) {
            return { success: false, error: 'No files provided for local import' };
        }

        const workspaceName = this._deriveWorkspaceName(projectName, metadata);
        const branchName = String(branch || 'main').trim() || 'main';
        const destinationPath = path.join(parentFolder, workspaceName);

        try {
            await fsp.mkdir(parentFolder, { recursive: true });

            const exists = await this._pathExists(destinationPath);
            if (exists) {
                const entries = await fsp.readdir(destinationPath);
                if (entries.length > 0) {
                    return {
                        success: false,
                        error: `Destination already exists and is not empty: ${destinationPath}`,
                    };
                }
            } else {
                await fsp.mkdir(destinationPath, { recursive: true });
            }

            let writtenCount = 0;
            for (const file of files) {
                const relPath = String(file?.path || '').replace(/\\/g, '/').trim();
                if (!relPath || relPath.endsWith('/') || relPath.split('/').includes('..')) {
                    continue;
                }

                const target = this._resolveScopedPath(destinationPath, relPath);
                if (!target.ok) {
                    return { success: false, error: target.error };
                }

                let bytes = null;
                if (typeof file.content_base64 === 'string' && file.content_base64.length > 0) {
                    bytes = Buffer.from(file.content_base64, 'base64');
                } else if (typeof file.content === 'string') {
                    bytes = Buffer.from(file.content, 'utf8');
                } else {
                    return { success: false, error: `File '${relPath}' is missing content` };
                }

                await fsp.mkdir(path.dirname(target.path), { recursive: true });
                await fsp.writeFile(target.path, bytes);
                writtenCount += 1;
            }

            const mergedMetadata = metadata && typeof metadata === 'object' ? metadata : {};
            const context = this.setWorkspaceContext(conversationId, {
                root_path: destinationPath,
                repo_url: repoUrl,
                branch: branchName,
                repo_name: workspaceName,
                is_ready: true,
                source_type: 'deployment',
                ...mergedMetadata,
            });

            return {
                success: true,
                root_path: destinationPath,
                repo_name: workspaceName,
                branch: branchName,
                file_count: writtenCount,
                context,
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async listWorkspaceTree({ conversationId, rootPath }) {
        const root = await this._resolveRootPath(conversationId, rootPath);
        if (!root.ok) return { success: false, error: root.error };

        const files = await this._walkFiles(root.path, 800);
        return {
            success: true,
            root_path: root.path,
            files: files.map((relativePath) => ({ path: relativePath })),
            count: files.length,
        };
    }

    async readWorkspaceFile({ conversationId, rootPath, relativePath }) {
        const root = await this._resolveRootPath(conversationId, rootPath);
        if (!root.ok) return { success: false, error: root.error };
        if (!relativePath) return { success: false, error: 'path is required' };

        const target = this._resolveScopedPath(root.path, relativePath);
        if (!target.ok) return { success: false, error: target.error };

        try {
            const data = await fsp.readFile(target.path);
            const isBinary = data.includes(0);
            if (isBinary) {
                return {
                    success: true,
                    path: relativePath,
                    is_binary: true,
                    size_bytes: data.length,
                    content: null,
                    content_base64: data.toString('base64'),
                };
            }

            const textContent = data.toString('utf8');
            const limit = 300000;
            const truncated = textContent.slice(0, limit);
            return {
                success: true,
                path: relativePath,
                is_binary: false,
                size_bytes: data.length,
                truncated: textContent.length > truncated.length,
                content: truncated,
                content_base64: data.toString('base64'),
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async startWatching(conversationId, rootPath) {
        const root = await this._resolveRootPath(conversationId, rootPath);
        if (!root.ok) return { success: false, error: root.error };

        this.stopWatching(conversationId);
        const watcher = chokidar.watch(root.path, {
            persistent: true,
            ignoreInitial: true,
            ignored: [/node_modules/, /\.git/],
        });

        watcher.on('all', (event, changedPath) => {
            this._emitRenderer('local-workspace-changed', {
                conversationId,
                event,
                path: changedPath,
            });
        });

        this.watchers.set(conversationId, watcher);
        return { success: true, root_path: root.path };
    }

    stopWatching(conversationId) {
        const watcher = this.watchers.get(conversationId);
        if (!watcher) return;
        watcher.close();
        this.watchers.delete(conversationId);
    }

    async startTerminal(conversationId, cwd, options = {}) {
        if (!conversationId) {
            return { success: false, error: 'conversationId is required' };
        }

        const root = await this._resolveRootPath(conversationId, cwd);
        if (!root.ok) return { success: false, error: root.error };

        const existing = this.terminals.get(conversationId);
        if (existing && existing.proc && !existing.proc.killed) {
            return {
                success: true,
                already_running: true,
                cwd: existing.cwd,
                mode: existing.mode || 'spawn',
            };
        }

        const requestedCols = Math.max(40, Math.min(Number(options?.cols || 120), 500));
        const requestedRows = Math.max(10, Math.min(Number(options?.rows || 35), 300));
        const { shell, args } = this._resolveTerminalShell();

        if (nodePty) {
            try {
                const proc = nodePty.spawn(shell, args, {
                    name: 'xterm-256color',
                    cols: requestedCols,
                    rows: requestedRows,
                    cwd: root.path,
                    env: process.env,
                });

                proc.onData((chunk) => {
                    this._emitRenderer('project-local-terminal-output', {
                        conversationId,
                        stream: 'stdout',
                        data: String(chunk || ''),
                    });
                });

                proc.onExit(({ exitCode }) => {
                    this._emitRenderer('project-local-terminal-exit', {
                        conversationId,
                        code: Number.isInteger(exitCode) ? exitCode : null,
                    });
                    this.terminals.delete(conversationId);
                });

                this.terminals.set(conversationId, {
                    proc,
                    cwd: root.path,
                    mode: 'pty',
                });

                return {
                    success: true,
                    cwd: root.path,
                    mode: 'pty',
                    cols: requestedCols,
                    rows: requestedRows,
                };
            } catch (error) {
                // Fallback path maintains functionality even if PTY fails to initialize.
                console.warn('[LocalCoderHandler] PTY start failed, using spawn fallback:', error.message);
            }
        }

        try {
            const fallbackShell = this._resolveFallbackTerminalShell(shell);
            const proc = spawn(fallbackShell.shell, fallbackShell.args, {
                cwd: root.path,
                env: process.env,
                stdio: 'pipe',
            });

            proc.stdout.on('data', (chunk) => {
                this._emitRenderer('project-local-terminal-output', {
                    conversationId,
                    stream: 'stdout',
                    data: String(chunk),
                });
            });

            proc.stderr.on('data', (chunk) => {
                this._emitRenderer('project-local-terminal-output', {
                    conversationId,
                    stream: 'stderr',
                    data: String(chunk),
                });
            });

            proc.on('close', (code) => {
                this._emitRenderer('project-local-terminal-exit', {
                    conversationId,
                    code: Number.isInteger(code) ? code : null,
                });
                this.terminals.delete(conversationId);
            });

            this.terminals.set(conversationId, {
                proc,
                cwd: root.path,
                mode: 'spawn',
            });
            return { success: true, cwd: root.path, mode: 'spawn' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async sendTerminalInput(conversationId, inputData) {
        const terminal = this.terminals.get(conversationId);
        if (!terminal?.proc || terminal.proc.killed) {
            return { success: false, error: 'Terminal session not running' };
        }

        try {
            const payload = String(inputData || '');
            if (terminal.mode === 'pty') {
                terminal.proc.write(payload);
                return { success: true };
            }

            // Spawn fallback only supports stdin text writes.
            terminal.proc.stdin.write(payload);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    resizeTerminal(conversationId, cols, rows) {
        const terminal = this.terminals.get(conversationId);
        if (!terminal?.proc || terminal.proc.killed) {
            return { success: false, error: 'Terminal session not running' };
        }

        const safeCols = Math.max(40, Math.min(Number(cols || 120), 500));
        const safeRows = Math.max(10, Math.min(Number(rows || 35), 300));

        if (terminal.mode !== 'pty' || typeof terminal.proc.resize !== 'function') {
            return { success: true, skipped: true };
        }

        try {
            terminal.proc.resize(safeCols, safeRows);
            return { success: true, cols: safeCols, rows: safeRows };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    stopTerminal(conversationId) {
        const terminal = this.terminals.get(conversationId);
        if (!terminal?.proc) return { success: true };

        try {
            if (terminal.mode === 'pty') {
                terminal.proc.kill();
            } else {
                terminal.proc.kill();
            }
            this.terminals.delete(conversationId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleCommand(commandPayload) {
        const action = String(commandPayload?.action || '').trim();
        const requestId = commandPayload?.request_id;
        let result;

        try {
            switch (action) {
                case 'workspace_overview':
                    result = await this._workspaceOverview(commandPayload);
                    break;
                case 'list_files':
                    result = await this._listFiles(commandPayload);
                    break;
                case 'search_code':
                    result = await this._searchCode(commandPayload);
                    break;
                case 'read_file':
                    result = await this._readFile(commandPayload);
                    break;
                case 'write_file':
                    result = await this._writeFile(commandPayload);
                    break;
                case 'edit_file':
                    result = await this._editFile(commandPayload);
                    break;
                case 'create_file':
                    result = await this._createFile(commandPayload);
                    break;
                case 'delete_path':
                    result = await this._deletePath(commandPayload);
                    break;
                case 'move_path':
                    result = await this._movePath(commandPayload);
                    break;
                case 'execute_command':
                    result = await this._executeCommand(commandPayload);
                    break;
                case 'git_status':
                    result = await this._gitStatus(commandPayload);
                    break;
                case 'git_branches':
                    result = await this._gitBranches(commandPayload);
                    break;
                case 'git_diff':
                    result = await this._gitDiff(commandPayload);
                    break;
                case 'git_log':
                    result = await this._gitLog(commandPayload);
                    break;
                default:
                    result = { status: 'error', error: `Unknown local coder action: ${action}` };
                    break;
            }
        } catch (error) {
            result = { status: 'error', error: error.message };
        }

        this.eventEmitter.emit('local-coder-command-result', {
            request_id: requestId,
            result,
        });
    }

    async _workspaceOverview(commandPayload) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const files = await this._walkFiles(root.path, 250);
        return {
            status: 'success',
            root_path: root.path,
            total_files: files.length,
            files,
        };
    }

    async _listFiles(commandPayload) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const relPath = String(commandPayload.path || '.');
        const resolved = this._resolveScopedPath(root.path, relPath);
        if (!resolved.ok) return { status: 'error', error: resolved.error };

        const files = await this._walkFiles(resolved.path, 400, root.path);
        return {
            status: 'success',
            root_path: root.path,
            path: relPath,
            files,
            count: files.length,
        };
    }

    async _searchCode(commandPayload) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const query = String(commandPayload.query || '').trim();
        if (!query) return { status: 'error', error: 'query is required' };

        const maxResults = Math.max(1, Math.min(Number(commandPayload.max_results || 100), 500));
        const files = await this._walkFiles(root.path, 1000);
        const matches = [];

        for (const rel of files) {
            if (matches.length >= maxResults) break;
            if (this._isIgnoredPath(rel)) continue;
            const fullPath = path.join(root.path, rel);
            let content;
            try {
                const data = await fsp.readFile(fullPath);
                if (data.includes(0)) continue;
                content = data.toString('utf8');
            } catch (_error) {
                continue;
            }

            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i += 1) {
                if (lines[i].includes(query)) {
                    matches.push({
                        path: rel.replace(/\\/g, '/'),
                        line: i + 1,
                        text: lines[i].slice(0, 400),
                    });
                    if (matches.length >= maxResults) break;
                }
            }
        }

        return {
            status: 'success',
            query,
            matches,
            count: matches.length,
        };
    }

    async _readFile(commandPayload) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const resolved = this._resolveScopedPath(root.path, commandPayload.path);
        if (!resolved.ok) return { status: 'error', error: resolved.error };

        try {
            const data = await fsp.readFile(resolved.path);
            if (data.includes(0)) {
                return {
                    status: 'success',
                    path: this._toRelativeUnix(root.path, resolved.path),
                    is_binary: true,
                    size_bytes: data.length,
                    content: null,
                };
            }

            const text = data.toString('utf8');
            const limit = 400000;
            return {
                status: 'success',
                path: this._toRelativeUnix(root.path, resolved.path),
                is_binary: false,
                truncated: text.length > limit,
                content: text.slice(0, limit),
                size_bytes: data.length,
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _writeFile(commandPayload) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const resolved = this._resolveScopedPath(root.path, commandPayload.path);
        if (!resolved.ok) return { status: 'error', error: resolved.error };
        const content = String(commandPayload.content ?? '');

        try {
            await fsp.mkdir(path.dirname(resolved.path), { recursive: true });
            await fsp.writeFile(resolved.path, content, 'utf8');
            return {
                status: 'success',
                path: this._toRelativeUnix(root.path, resolved.path),
                bytes_written: Buffer.byteLength(content, 'utf8'),
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _editFile(commandPayload) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const resolved = this._resolveScopedPath(root.path, commandPayload.path);
        if (!resolved.ok) return { status: 'error', error: resolved.error };
        const oldText = String(commandPayload.old_text ?? '');
        const newText = String(commandPayload.new_text ?? '');
        const replaceAll = Boolean(commandPayload.replace_all);

        if (!oldText) {
            return { status: 'error', error: 'old_text is required' };
        }

        try {
            const original = await fsp.readFile(resolved.path, 'utf8');
            if (!original.includes(oldText)) {
                return { status: 'error', error: 'old_text not found in file' };
            }

            let updated;
            if (replaceAll) {
                updated = original.split(oldText).join(newText);
            } else {
                updated = original.replace(oldText, newText);
            }
            await fsp.writeFile(resolved.path, updated, 'utf8');

            return {
                status: 'success',
                path: this._toRelativeUnix(root.path, resolved.path),
                replaced: replaceAll ? original.split(oldText).length - 1 : 1,
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _createFile(commandPayload) {
        const overwrite = Boolean(commandPayload.overwrite);
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const resolved = this._resolveScopedPath(root.path, commandPayload.path);
        if (!resolved.ok) return { status: 'error', error: resolved.error };
        const content = String(commandPayload.content ?? '');

        try {
            const exists = await this._pathExists(resolved.path);
            if (exists && !overwrite) {
                return { status: 'error', error: 'File already exists. Set overwrite=true to replace.' };
            }
            await fsp.mkdir(path.dirname(resolved.path), { recursive: true });
            await fsp.writeFile(resolved.path, content, 'utf8');
            return { status: 'success', path: this._toRelativeUnix(root.path, resolved.path) };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _deletePath(commandPayload) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const resolved = this._resolveScopedPath(root.path, commandPayload.path);
        if (!resolved.ok) return { status: 'error', error: resolved.error };

        try {
            await fsp.rm(resolved.path, { recursive: true, force: true });
            return { status: 'success', path: this._toRelativeUnix(root.path, resolved.path) };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _movePath(commandPayload) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const fromPath = this._resolveScopedPath(root.path, commandPayload.from_path);
        if (!fromPath.ok) return { status: 'error', error: fromPath.error };
        const toPath = this._resolveScopedPath(root.path, commandPayload.to_path);
        if (!toPath.ok) return { status: 'error', error: toPath.error };

        try {
            await fsp.mkdir(path.dirname(toPath.path), { recursive: true });
            await fsp.rename(fromPath.path, toPath.path);
            return {
                status: 'success',
                from_path: this._toRelativeUnix(root.path, fromPath.path),
                to_path: this._toRelativeUnix(root.path, toPath.path),
            };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async _executeCommand(commandPayload) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };
        const command = String(commandPayload.command || '').trim();
        if (!command) return { status: 'error', error: 'command is required' };

        const timeoutMs = Math.max(1000, Math.min(Number(commandPayload.timeout_ms || 120000), 600000));
        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: root.path,
                timeout: timeoutMs,
                windowsHide: true,
                maxBuffer: 10 * 1024 * 1024,
            });
            return {
                status: 'success',
                command,
                stdout: stdout || '',
                stderr: stderr || '',
                exit_code: 0,
            };
        } catch (error) {
            return {
                status: 'error',
                command,
                stdout: error.stdout || '',
                stderr: error.stderr || error.message || '',
                exit_code: Number.isInteger(error.code) ? error.code : 1,
            };
        }
    }

    async _gitStatus(commandPayload) {
        return this._runGit(commandPayload, ['status', '--short', '--branch']);
    }

    async _gitBranches(commandPayload) {
        return this._runGit(commandPayload, ['branch', '--all', '--verbose']);
    }

    async _gitDiff(commandPayload) {
        const target = String(commandPayload.target || '').trim();
        const args = target ? ['diff', target] : ['diff'];
        return this._runGit(commandPayload, args);
    }

    async _gitLog(commandPayload) {
        const limit = Math.max(1, Math.min(Number(commandPayload.limit || 20), 200));
        return this._runGit(commandPayload, ['log', `-${limit}`, '--oneline', '--decorate']);
    }

    async _runGit(commandPayload, args) {
        const root = await this._resolveRootPath(commandPayload.conversation_id, commandPayload.root_path);
        if (!root.ok) return { status: 'error', error: root.error };

        const result = await this._spawnAndCollect('git', args, { cwd: root.path });
        return {
            status: result.exitCode === 0 ? 'success' : 'error',
            command: ['git', ...args].join(' '),
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exit_code: result.exitCode,
        };
    }

    /**
     * Spawns a process and buffers its output.
     *
     * `options.timeoutMs` is optional and additive: existing callers that pass
     * only `{ cwd }` keep the previous "wait forever" behaviour. Network git
     * operations pass a budget so a credential-helper stall surfaces as an
     * error instead of hanging the renderer's pending invoke() forever.
     */
    async _spawnAndCollect(command, args = [], options = {}) {
        const { timeoutMs, ...spawnOptions } = options && typeof options === 'object' ? options : {};

        return new Promise((resolve) => {
            let child;
            try {
                child = spawn(command, args, {
                    ...spawnOptions,
                    windowsHide: true,
                });
            } catch (error) {
                resolve({ exitCode: 1, stdout: '', stderr: error.message, timedOut: false });
                return;
            }

            let stdout = '';
            let stderr = '';
            let settled = false;
            let timedOut = false;
            let timer = null;

            const finish = (exitCode) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                resolve({
                    exitCode: Number.isInteger(exitCode) ? exitCode : 1,
                    stdout,
                    stderr,
                    timedOut,
                });
            };

            const budget = Number(timeoutMs);
            if (Number.isFinite(budget) && budget > 0) {
                timer = setTimeout(() => {
                    timedOut = true;
                    try {
                        child.kill();
                    } catch (_error) {
                        // Process already gone.
                    }
                    finish(124);
                }, budget);
            }

            child.stdout?.on('data', (chunk) => {
                stdout += String(chunk || '');
            });
            child.stderr?.on('data', (chunk) => {
                stderr += String(chunk || '');
            });
            child.on('close', (exitCode) => finish(exitCode));
            child.on('error', (error) => {
                stderr = `${stderr}\n${error.message}`.trim();
                finish(1);
            });
        });
    }

    async _resolveRootPath(conversationId, providedRoot) {
        const candidate = String(providedRoot || '').trim();
        if (candidate) {
            try {
                const normalized = path.resolve(candidate);
                const stats = await fsp.stat(normalized);
                if (!stats.isDirectory()) {
                    return { ok: false, error: `Not a directory: ${normalized}` };
                }
                this.setWorkspaceContext(conversationId, { root_path: normalized });
                return { ok: true, path: normalized };
            } catch (error) {
                return { ok: false, error: error.message };
            }
        }

        const ctx = this.getWorkspaceContext(conversationId);
        if (ctx?.root_path) {
            return { ok: true, path: path.resolve(ctx.root_path) };
        }
        return { ok: false, error: 'No local workspace root is configured for this conversation' };
    }

    _resolveScopedPath(rootPath, targetPath) {
        if (!targetPath) return { ok: false, error: 'path is required' };
        const root = path.resolve(rootPath);
        const resolved = path.resolve(root, String(targetPath));
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
            return { ok: false, error: 'Path escapes workspace root' };
        }
        return { ok: true, path: resolved };
    }

    async _pathExists(targetPath) {
        try {
            await fsp.access(targetPath);
            return true;
        } catch (_error) {
            return false;
        }
    }

    _deriveRepoName(repoUrl) {
        const clean = String(repoUrl || '').trim().replace(/\/+$/, '');
        const tail = clean.split('/').pop() || 'repository';
        const noGit = tail.endsWith('.git') ? tail.slice(0, -4) : tail;
        return noGit || 'repository';
    }

    _deriveWorkspaceName(projectName, metadata = {}) {
        const raw = String(
            projectName
            || metadata?.slug
            || metadata?.project_name
            || metadata?.site_id
            || 'workspace'
        ).trim();
        const sanitized = raw
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
        return sanitized || 'workspace';
    }

    _isIgnoredPath(relPath) {
        const normalized = String(relPath || '').replace(/\\/g, '/');
        return normalized.includes('/node_modules/') || normalized.startsWith('node_modules/')
            || normalized.includes('/.git/') || normalized.startsWith('.git/');
    }

    _toRelativeUnix(root, fullPath) {
        return path.relative(root, fullPath).replace(/\\/g, '/');
    }

    async _walkFiles(rootPath, limit = 500, baseRoot = rootPath) {
        const files = [];
        const stack = [rootPath];

        while (stack.length > 0 && files.length < limit) {
            const current = stack.pop();
            let entries;
            try {
                entries = await fsp.readdir(current, { withFileTypes: true });
            } catch (_error) {
                continue;
            }

            for (const entry of entries) {
                if (files.length >= limit) break;
                const absPath = path.join(current, entry.name);
                const rel = this._toRelativeUnix(baseRoot, absPath);
                if (this._isIgnoredPath(rel)) continue;

                if (entry.isDirectory()) {
                    stack.push(absPath);
                } else if (entry.isFile()) {
                    files.push(rel);
                }
            }
        }

        files.sort((a, b) => a.localeCompare(b));
        return files;
    }

    /* =====================================================================
       SOURCE CONTROL BRIDGE
       A single renderer-facing entry point (`gitAction`) backed by focused
       helpers. Everything runs with the workspace root as cwd and reuses the
       same path-scoping guard as the file helpers above, so no operation can
       escape the folder the user picked.
       ===================================================================== */

    /**
     * Git environment for non-interactive execution.
     *
     * GIT_TERMINAL_PROMPT=0 makes git fail fast instead of blocking on a stdin
     * username prompt (there is no TTY attached here). A GUI credential helper
     * such as Git Credential Manager still runs normally, so real auth flows
     * keep working. LC_ALL=C keeps stderr parseable across locales.
     */
    _gitEnv() {
        return {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_OPTIONAL_LOCKS: '0',
            GIT_PAGER: 'cat',
            LC_ALL: 'C',
        };
    }

    async _git(rootPath, args, options = {}) {
        const result = await this._spawnAndCollect('git', args, {
            cwd: rootPath,
            env: this._gitEnv(),
            timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000,
        });

        return {
            ok: result.exitCode === 0,
            exit_code: result.exitCode,
            stdout: String(result.stdout || ''),
            stderr: String(result.stderr || ''),
            timed_out: Boolean(result.timedOut),
            command: ['git', ...args].join(' '),
        };
    }

    _gitFailure(result, fallback = 'git command failed') {
        if (result?.timed_out) {
            return `${result.command} timed out. If this was a network operation, check your credentials or connection.`;
        }
        const text = String(result?.stderr || result?.stdout || '').trim();
        const lower = text.toLowerCase();
        if (lower.includes('enoent') || lower.includes('not recognized as an internal or external command')) {
            return 'Git is not installed or not available in PATH.';
        }
        if (lower.includes('could not read username') || lower.includes('terminal prompts disabled')) {
            return 'Git needs credentials for this remote. Configure a credential helper or use an SSH remote.';
        }
        return text || fallback;
    }

    /** Turns any supported remote URL into a browsable https URL + owner/name. */
    _parseGitRemote(remoteUrl) {
        const raw = String(remoteUrl || '').trim();
        if (!raw) return null;

        const patterns = [
            /^git@([^:]+):(.+?)(?:\.git)?\/?$/i,
            /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i,
            /^git:\/\/([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i,
            /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i,
        ];

        for (const pattern of patterns) {
            const match = raw.match(pattern);
            if (!match) continue;
            const host = match[1];
            const slug = String(match[2] || '').replace(/^\/+/, '').replace(/\/+$/, '');
            if (!slug) continue;
            const segments = slug.split('/').filter(Boolean);
            return {
                host,
                slug,
                owner: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
                name: segments[segments.length - 1] || slug,
                web_url: `https://${host}/${slug}`,
                is_github: /(^|\.)github\.com$/i.test(host),
            };
        }

        return null;
    }

    async gitAction(payload = {}) {
        const action = String(payload?.action || '').trim();
        if (!action) {
            return { success: false, error: 'action is required' };
        }

        const root = await this._resolveRootPath(payload?.conversationId, payload?.rootPath);
        if (!root.ok) {
            return { success: false, error: root.error };
        }

        // `init` must target exactly the folder the user selected. Everything
        // else runs from the repository top level: `git status --porcelain`
        // reports paths relative to the repo root, so using the same directory
        // as cwd keeps every path we hand back round-trippable even when the
        // selected folder is a subdirectory of a larger repository.
        let workRoot = root.path;
        if (action !== 'init') {
            const topLevel = await this._git(root.path, ['rev-parse', '--show-toplevel']);
            if (topLevel.ok && topLevel.stdout.trim()) {
                workRoot = path.resolve(topLevel.stdout.trim());
            }
        }

        try {
            switch (action) {
                case 'repo_info':
                    return await this._scRepoInfo(workRoot);
                case 'overview':
                    return await this._scOverview(workRoot);
                case 'status':
                    return await this._scStatus(workRoot);
                case 'branches':
                    return await this._scBranches(workRoot);
                case 'log':
                    return await this._scLog(workRoot, payload.limit);
                case 'file_diff':
                    return await this._scFileDiff(workRoot, payload);
                case 'stage':
                    return await this._scStage(workRoot, payload);
                case 'unstage':
                    return await this._scUnstage(workRoot, payload);
                case 'discard':
                    return await this._scDiscard(workRoot, payload);
                case 'commit':
                    return await this._scCommit(workRoot, payload);
                case 'fetch':
                    return await this._scRemoteOp(workRoot, ['fetch', '--all', '--prune']);
                case 'pull':
                    return await this._scRemoteOp(workRoot, ['pull']);
                case 'push':
                    return await this._scPush(workRoot, payload);
                case 'checkout':
                    return await this._scCheckout(workRoot, payload);
                case 'compare':
                    return await this._scCompare(workRoot, payload);
                case 'init':
                    return await this._scInit(root.path);
                default:
                    return { success: false, error: `Unknown git action: ${action}` };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async _scRepoInfo(rootPath) {
        const inside = await this._git(rootPath, ['rev-parse', '--is-inside-work-tree']);
        if (!inside.ok) {
            const lower = `${inside.stderr}`.toLowerCase();
            if (lower.includes('enoent') || lower.includes('not recognized as an internal or external command')) {
                return { success: false, error: 'Git is not installed or not available in PATH.' };
            }
            return { success: true, is_repo: false, root_path: rootPath };
        }

        const [topLevel, symbolic, abbrev, upstream, originUrl, remotes, headCommit] = await Promise.all([
            this._git(rootPath, ['rev-parse', '--show-toplevel']),
            this._git(rootPath, ['symbolic-ref', '--short', 'HEAD']),
            this._git(rootPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
            this._git(rootPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
            this._git(rootPath, ['config', '--get', 'remote.origin.url']),
            this._git(rootPath, ['remote']),
            this._git(rootPath, ['log', '-1', '--pretty=format:%H\u001f%h\u001f%s\u001f%an\u001f%ar\u001f%aI']),
        ]);

        const hasCommits = headCommit.ok && Boolean(headCommit.stdout.trim());
        const symbolicBranch = symbolic.ok ? symbolic.stdout.trim() : '';
        const abbrevBranch = abbrev.ok ? abbrev.stdout.trim() : '';
        const isDetached = !symbolicBranch && abbrevBranch === 'HEAD';
        const branch = symbolicBranch || (isDetached ? '' : abbrevBranch);

        const upstreamRef = upstream.ok ? upstream.stdout.trim() : '';
        let ahead = 0;
        let behind = 0;
        if (upstreamRef && hasCommits) {
            const counts = await this._git(rootPath, ['rev-list', '--left-right', '--count', `${upstreamRef}...HEAD`]);
            if (counts.ok) {
                const [behindRaw, aheadRaw] = counts.stdout.trim().split(/\s+/);
                behind = Number(behindRaw) || 0;
                ahead = Number(aheadRaw) || 0;
            }
        }

        const remoteUrl = originUrl.ok ? originUrl.stdout.trim() : '';
        const remoteList = remotes.ok
            ? remotes.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
            : [];

        let lastCommit = null;
        if (hasCommits) {
            const [full, short, subject, author, relative, isoDate] = headCommit.stdout.split('\u001f');
            lastCommit = {
                hash: full || '',
                short_hash: short || '',
                subject: subject || '',
                author: author || '',
                relative_date: relative || '',
                iso_date: isoDate || '',
            };
        }

        const shortStatus = await this._git(rootPath, ['status', '--porcelain', '--untracked-files=all']);
        const changedCount = shortStatus.ok
            ? shortStatus.stdout.split(/\r?\n/).filter((line) => line.trim()).length
            : 0;

        return {
            success: true,
            is_repo: true,
            root_path: topLevel.ok ? topLevel.stdout.trim() : rootPath,
            branch,
            is_detached: isDetached,
            detached_at: isDetached && lastCommit ? lastCommit.short_hash : null,
            has_commits: hasCommits,
            upstream: upstreamRef || null,
            ahead,
            behind,
            remote_url: remoteUrl || null,
            remotes: remoteList,
            remote: this._parseGitRemote(remoteUrl),
            default_branch: await this._scDefaultBranch(rootPath),
            last_commit: lastCommit,
            changed_count: changedCount,
            is_dirty: changedCount > 0,
        };
    }

    async _scDefaultBranch(rootPath) {
        const originHead = await this._git(rootPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
        if (originHead.ok) {
            const value = originHead.stdout.trim();
            if (value) return value.replace(/^origin\//, '');
        }

        for (const candidate of ['main', 'master', 'develop']) {
            const exists = await this._git(rootPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${candidate}`]);
            if (exists.ok && exists.stdout.trim()) return candidate;
        }
        for (const candidate of ['main', 'master']) {
            const exists = await this._git(rootPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]);
            if (exists.ok && exists.stdout.trim()) return candidate;
        }
        return null;
    }

    /**
     * Parses `git status --porcelain=v1 -z` into staged / unstaged buckets.
     *
     * -z is used so paths containing spaces or unicode survive intact. In -z
     * mode git drops the ` -> ` rename arrow and emits the new path first,
     * followed by the original path as a separate NUL-terminated field.
     */
    async _scStatus(rootPath) {
        const result = await this._git(rootPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
        if (!result.ok) {
            return { success: false, error: this._gitFailure(result, 'git status failed') };
        }

        const fields = result.stdout.split('\0');
        const staged = [];
        const unstaged = [];
        const conflicted = [];

        for (let index = 0; index < fields.length; index += 1) {
            const entry = fields[index];
            if (!entry || entry.length < 3) continue;

            const indexCode = entry[0];
            const workTreeCode = entry[1];
            let filePath = entry.slice(3);
            let originalPath = null;

            if (indexCode === 'R' || indexCode === 'C') {
                originalPath = fields[index + 1] || null;
                index += 1;
            }

            const base = {
                path: filePath.replace(/\\/g, '/'),
                original_path: originalPath ? originalPath.replace(/\\/g, '/') : null,
                index_code: indexCode,
                work_tree_code: workTreeCode,
            };

            const isConflict = indexCode === 'U'
                || workTreeCode === 'U'
                || (indexCode === 'A' && workTreeCode === 'A')
                || (indexCode === 'D' && workTreeCode === 'D');

            if (isConflict) {
                conflicted.push({ ...base, code: '!', label: 'Conflict', untracked: false });
                continue;
            }

            if (indexCode === '?' && workTreeCode === '?') {
                unstaged.push({ ...base, code: 'U', label: this._scCodeLabel('?'), untracked: true });
                continue;
            }

            if (indexCode !== ' ' && indexCode !== '?') {
                staged.push({ ...base, code: indexCode, label: this._scCodeLabel(indexCode), untracked: false });
            }
            if (workTreeCode !== ' ' && workTreeCode !== '?') {
                unstaged.push({ ...base, code: workTreeCode, label: this._scCodeLabel(workTreeCode), untracked: false });
            }
        }

        return {
            success: true,
            staged,
            unstaged,
            conflicted,
            total: staged.length + unstaged.length + conflicted.length,
        };
    }

    _scCodeLabel(code) {
        switch (code) {
            case 'M': return 'Modified';
            case 'A': return 'Added';
            case 'D': return 'Deleted';
            case 'R': return 'Renamed';
            case 'C': return 'Copied';
            case 'T': return 'Type changed';
            case '?': return 'Untracked';
            case 'U': return 'Conflict';
            default: return 'Changed';
        }
    }

    async _scBranches(rootPath) {
        const format = [
            '%(refname:short)',
            '%(refname)',
            '%(upstream:short)',
            '%(objectname:short)',
            '%(committerdate:relative)',
            '%(HEAD)',
            '%(contents:subject)',
        ].join('\u001f');

        const result = await this._git(rootPath, [
            'for-each-ref',
            `--format=${format}`,
            '--sort=-committerdate',
            'refs/heads',
            'refs/remotes',
            'refs/tags',
        ]);

        if (!result.ok) {
            return { success: false, error: this._gitFailure(result, 'Unable to list branches') };
        }

        const local = [];
        const remote = [];
        const tags = [];

        for (const line of result.stdout.split(/\r?\n/)) {
            if (!line.trim()) continue;
            const [shortName, fullRef, upstream, shortHash, relativeDate, headMarker, subject] = line.split('\u001f');
            if (!fullRef) continue;
            // origin/HEAD is a symbolic alias for the default branch, not a branch.
            if (/^refs\/remotes\/[^/]+\/HEAD$/.test(fullRef)) continue;

            const item = {
                name: shortName || '',
                ref: fullRef,
                upstream: upstream || null,
                short_hash: shortHash || '',
                relative_date: relativeDate || '',
                subject: subject || '',
                is_current: String(headMarker || '').trim() === '*',
            };

            if (fullRef.startsWith('refs/heads/')) {
                item.type = 'local';
                local.push(item);
            } else if (fullRef.startsWith('refs/remotes/')) {
                item.type = 'remote';
                remote.push(item);
            } else {
                item.type = 'tag';
                tags.push(item);
            }
        }

        return { success: true, local, remote, tags };
    }

    async _scLog(rootPath, limit) {
        const count = Math.max(1, Math.min(Number(limit) || 30, 200));
        const result = await this._git(rootPath, [
            'log',
            `-${count}`,
            '--pretty=format:%H\u001f%h\u001f%s\u001f%an\u001f%ar\u001f%D',
        ]);

        if (!result.ok) {
            const lower = `${result.stderr}`.toLowerCase();
            if (lower.includes('does not have any commits') || lower.includes('bad revision')) {
                return { success: true, commits: [] };
            }
            return { success: false, error: this._gitFailure(result, 'Unable to read commit history') };
        }

        const commits = result.stdout
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .map((line) => {
                const [hash, shortHash, subject, author, relativeDate, refs] = line.split('\u001f');
                return {
                    hash: hash || '',
                    short_hash: shortHash || '',
                    subject: subject || '',
                    author: author || '',
                    relative_date: relativeDate || '',
                    refs: String(refs || '').trim(),
                };
            });

        return { success: true, commits };
    }

    async _scFileDiff(rootPath, payload = {}) {
        const relativePath = String(payload?.path || '').trim();
        if (!relativePath) return { success: false, error: 'path is required' };

        const scoped = this._resolveScopedPath(rootPath, relativePath);
        if (!scoped.ok) return { success: false, error: scoped.error };

        if (payload?.untracked) {
            try {
                const data = await fsp.readFile(scoped.path);
                if (data.includes(0)) {
                    return { success: true, path: relativePath, is_binary: true, diff: '' };
                }
                const text = data.toString('utf8').slice(0, 200000);
                const body = text
                    .split(/\r?\n/)
                    .map((line) => `+${line}`)
                    .join('\n');
                return {
                    success: true,
                    path: relativePath,
                    untracked: true,
                    diff: `new file: ${relativePath}\n--- /dev/null\n+++ b/${relativePath}\n${body}`,
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        const args = payload?.staged
            ? ['diff', '--cached', '--', relativePath]
            : ['diff', '--', relativePath];
        const result = await this._git(rootPath, args);
        if (!result.ok) {
            return { success: false, error: this._gitFailure(result, 'Unable to read diff') };
        }

        return {
            success: true,
            path: relativePath,
            staged: Boolean(payload?.staged),
            diff: result.stdout,
        };
    }

    _scNormalizePaths(paths) {
        return (Array.isArray(paths) ? paths : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 500);
    }

    async _scStage(rootPath, payload = {}) {
        const args = payload?.all
            ? ['add', '-A', '--', '.']
            : ['add', '--', ...this._scNormalizePaths(payload?.paths)];

        if (!payload?.all && args.length <= 2) {
            return { success: false, error: 'No files selected to stage.' };
        }

        const result = await this._git(rootPath, args);
        return result.ok
            ? { success: true }
            : { success: false, error: this._gitFailure(result, 'Unable to stage changes') };
    }

    async _scUnstage(rootPath, payload = {}) {
        const paths = this._scNormalizePaths(payload?.paths);
        const args = payload?.all
            ? ['reset', '-q', 'HEAD', '--', '.']
            : ['reset', '-q', 'HEAD', '--', ...paths];

        if (!payload?.all && paths.length === 0) {
            return { success: false, error: 'No files selected to unstage.' };
        }

        const result = await this._git(rootPath, args);
        return result.ok
            ? { success: true }
            : { success: false, error: this._gitFailure(result, 'Unable to unstage changes') };
    }

    /**
     * Destructive: reverts working-tree changes and deletes untracked files.
     * The renderer confirms with the user before calling this.
     */
    async _scDiscard(rootPath, payload = {}) {
        const entries = Array.isArray(payload?.entries) ? payload.entries : [];
        if (entries.length === 0) {
            return { success: false, error: 'No files selected to discard.' };
        }

        const tracked = [];
        const untracked = [];
        for (const entry of entries) {
            const relativePath = String(entry?.path || '').trim();
            if (!relativePath) continue;
            if (entry?.untracked) untracked.push(relativePath);
            else tracked.push(relativePath);
        }

        const errors = [];

        for (const relativePath of untracked) {
            const scoped = this._resolveScopedPath(rootPath, relativePath);
            if (!scoped.ok) {
                errors.push(`${relativePath}: ${scoped.error}`);
                continue;
            }
            try {
                await fsp.rm(scoped.path, { recursive: true, force: true });
            } catch (error) {
                errors.push(`${relativePath}: ${error.message}`);
            }
        }

        if (tracked.length > 0) {
            const reset = await this._git(rootPath, ['reset', '-q', 'HEAD', '--', ...tracked]);
            if (!reset.ok && !`${reset.stderr}`.toLowerCase().includes('did not match')) {
                errors.push(this._gitFailure(reset, 'Unable to unstage before discarding'));
            }
            const checkout = await this._git(rootPath, ['checkout', '-q', '--', ...tracked]);
            if (!checkout.ok) {
                errors.push(this._gitFailure(checkout, 'Unable to discard tracked changes'));
            }
        }

        if (errors.length > 0) {
            return { success: false, error: errors.join(' | ') };
        }
        return { success: true, discarded: tracked.length + untracked.length };
    }

    async _scCommit(rootPath, payload = {}) {
        const message = String(payload?.message || '').trim();
        if (!message) {
            return { success: false, error: 'A commit message is required.' };
        }

        if (payload?.stageAll) {
            const staged = await this._scStage(rootPath, { all: true });
            if (!staged.success) return staged;
        }

        const args = ['commit', '-m', message];
        if (payload?.amend) args.push('--amend');

        const result = await this._git(rootPath, args, { timeoutMs: 60000 });
        if (!result.ok) {
            const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
            if (combined.includes('nothing to commit')) {
                return { success: false, error: 'Nothing to commit. Stage some changes first.' };
            }
            if (combined.includes('please tell me who you are') || combined.includes('unable to auto-detect email')) {
                return {
                    success: false,
                    error: 'Git identity is not configured. Run: git config --global user.name "..." and user.email "..."',
                };
            }
            return { success: false, error: this._gitFailure(result, 'Commit failed') };
        }

        return { success: true, output: result.stdout.trim() };
    }

    async _scRemoteOp(rootPath, args) {
        const result = await this._git(rootPath, args, { timeoutMs: 180000 });
        if (!result.ok) {
            return { success: false, error: this._gitFailure(result, `${args[0]} failed`) };
        }
        return {
            success: true,
            output: `${result.stdout}\n${result.stderr}`.trim(),
        };
    }

    async _scPush(rootPath, payload = {}) {
        const info = await this._scRepoInfo(rootPath);
        if (!info.success) return info;
        if (!info.is_repo) return { success: false, error: 'Not a Git repository.' };
        if (!info.has_commits) return { success: false, error: 'Nothing to push yet — create a commit first.' };
        if (info.is_detached) return { success: false, error: 'HEAD is detached. Check out a branch before pushing.' };

        const remote = String(payload?.remote || '').trim() || (info.remotes[0] || 'origin');
        const branch = String(payload?.branch || '').trim() || info.branch;
        if (!branch) return { success: false, error: 'Unable to resolve the current branch.' };
        if (!info.remotes.length) return { success: false, error: 'No git remote is configured for this repository.' };

        // With an upstream configured, a bare `git push` targets exactly the
        // tracked remote/branch pair. Naming a remote explicitly could send the
        // branch somewhere other than where it tracks.
        const args = info.upstream
            ? ['push']
            : ['push', '--set-upstream', remote, branch];

        const result = await this._git(rootPath, args, { timeoutMs: 180000 });
        if (!result.ok) {
            return { success: false, error: this._gitFailure(result, 'Push failed') };
        }
        return {
            success: true,
            output: `${result.stdout}\n${result.stderr}`.trim(),
            set_upstream: !info.upstream,
        };
    }

    async _scCheckout(rootPath, payload = {}) {
        const target = String(payload?.branch || payload?.ref || '').trim();
        if (!target) return { success: false, error: 'A branch name is required.' };
        if (/^-/.test(target)) return { success: false, error: 'Invalid branch name.' };

        if (payload?.create) {
            const from = String(payload?.from || '').trim();
            const args = ['checkout', '-b', target];
            if (from) args.push(from);
            const created = await this._git(rootPath, args, { timeoutMs: 60000 });
            return created.ok
                ? { success: true, branch: target, created: true }
                : { success: false, error: this._gitFailure(created, 'Unable to create branch') };
        }

        if (payload?.detach) {
            const detached = await this._git(rootPath, ['checkout', '--detach', target], { timeoutMs: 60000 });
            return detached.ok
                ? { success: true, branch: target, detached: true }
                : { success: false, error: this._gitFailure(detached, 'Unable to check out detached HEAD') };
        }

        // Checking out `origin/feature` should create a tracking local branch,
        // matching how VS Code and GitHub Desktop behave, rather than dropping
        // the user into a detached HEAD.
        const remoteMatch = target.match(/^([^/]+)\/(.+)$/);
        if (remoteMatch) {
            const remotes = await this._git(rootPath, ['remote']);
            const knownRemotes = remotes.ok
                ? remotes.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
                : [];
            if (knownRemotes.includes(remoteMatch[1])) {
                const localName = remoteMatch[2];
                const localExists = await this._git(rootPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${localName}`]);
                if (!(localExists.ok && localExists.stdout.trim())) {
                    const tracked = await this._git(rootPath, ['checkout', '-b', localName, '--track', target], { timeoutMs: 60000 });
                    return tracked.ok
                        ? { success: true, branch: localName, tracking: target }
                        : { success: false, error: this._gitFailure(tracked, 'Unable to check out remote branch') };
                }
                const switched = await this._git(rootPath, ['checkout', localName], { timeoutMs: 60000 });
                return switched.ok
                    ? { success: true, branch: localName }
                    : { success: false, error: this._gitFailure(switched, 'Unable to switch branch') };
            }
        }

        const result = await this._git(rootPath, ['checkout', target], { timeoutMs: 60000 });
        return result.ok
            ? { success: true, branch: target }
            : { success: false, error: this._gitFailure(result, 'Unable to switch branch') };
    }

    async _scCompare(rootPath, payload = {}) {
        const base = String(payload?.base || '').trim();
        const head = String(payload?.head || 'HEAD').trim();
        if (!base) return { success: false, error: 'A base branch is required.' };
        if (/^-/.test(base) || /^-/.test(head)) return { success: false, error: 'Invalid ref.' };

        const range = `${base}...${head}`;
        const [counts, stat, commits] = await Promise.all([
            this._git(rootPath, ['rev-list', '--left-right', '--count', range]),
            this._git(rootPath, ['diff', '--stat', range]),
            this._git(rootPath, ['log', '--oneline', '-20', `${base}..${head}`]),
        ]);

        if (!counts.ok) {
            return { success: false, error: this._gitFailure(counts, 'Unable to compare branches') };
        }

        const [behindRaw, aheadRaw] = counts.stdout.trim().split(/\s+/);
        return {
            success: true,
            base,
            head,
            behind: Number(behindRaw) || 0,
            ahead: Number(aheadRaw) || 0,
            diff_stat: stat.ok ? stat.stdout.trim() : '',
            commits: commits.ok
                ? commits.stdout.split(/\r?\n/).filter((line) => line.trim())
                : [],
        };
    }

    async _scInit(rootPath) {
        const withBranch = await this._git(rootPath, ['init', '-b', 'main'], { timeoutMs: 60000 });
        if (withBranch.ok) {
            return { success: true, output: withBranch.stdout.trim() };
        }

        // `git init -b` needs git >= 2.28; fall back for older installs.
        const legacy = await this._git(rootPath, ['init'], { timeoutMs: 60000 });
        return legacy.ok
            ? { success: true, output: legacy.stdout.trim() }
            : { success: false, error: this._gitFailure(legacy, 'Unable to initialize repository') };
    }

    /** Single round-trip used by the panel so one refresh is one IPC call. */
    async _scOverview(rootPath) {
        const info = await this._scRepoInfo(rootPath);
        if (!info.success) return info;
        if (!info.is_repo) {
            return { success: true, repo: info, status: null, branches: null, log: null };
        }

        const [status, branches, log] = await Promise.all([
            this._scStatus(rootPath),
            this._scBranches(rootPath),
            this._scLog(rootPath, 30),
        ]);

        return {
            success: true,
            repo: info,
            status: status.success ? status : null,
            branches: branches.success ? branches : null,
            log: log.success ? log : null,
            partial_errors: [status, branches, log]
                .filter((item) => !item.success)
                .map((item) => item.error),
        };
    }

    async cleanup() {
        this.isShuttingDown = true;
        for (const conversationId of [...this.watchers.keys()]) {
            this.stopWatching(conversationId);
        }
        for (const conversationId of [...this.terminals.keys()]) {
            this.stopTerminal(conversationId);
        }
        this.workspaceContexts.clear();
        this.mainWindow = null;
    }
}

module.exports = LocalCoderHandler;
