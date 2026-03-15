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

    async _spawnAndCollect(command, args = [], options = {}) {
        return new Promise((resolve) => {
            const child = spawn(command, args, {
                ...options,
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (chunk) => {
                stdout += String(chunk || '');
            });
            child.stderr.on('data', (chunk) => {
                stderr += String(chunk || '');
            });
            child.on('close', (exitCode) => {
                resolve({ exitCode: Number.isInteger(exitCode) ? exitCode : 1, stdout, stderr });
            });
            child.on('error', (error) => {
                resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
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
