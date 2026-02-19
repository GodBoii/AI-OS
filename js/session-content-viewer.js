// session-content-viewer.js - Displays all content (files, artifacts, terminal logs) for a session
import { artifactHandler } from './artifact-handler.js';

class SessionContentViewer {
    constructor() {
        this.currentSessionId = null;
        this.content = [];
        this.contentCache = new Map(); // Cache for session content
        this.cacheTimestamps = new Map(); // Track when cache was created
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache expiry
        this.init();
    }

    init() {
        // Create modal structure
        const modal = document.createElement('div');
        modal.id = 'session-content-modal';
        modal.className = 'session-content-host hidden';

        modal.innerHTML = `
            <div class="session-content-panel">
                <div class="session-content-header">
                    <div class="session-content-heading">
                        <h3>Content</h3>
                    </div>
                    <div class="session-content-actions">
                        <button class="refresh-content-btn" aria-label="Refresh content" title="Refresh content">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="close-session-content-btn" aria-label="Close">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                <div class="session-content-tabs">
                    <button class="content-tab-btn active" data-tab="files">
                        <i class="fas fa-file"></i>
                        <span>Files</span>
                    </button>
                    <button class="content-tab-btn" data-tab="terminal">
                        <i class="fas fa-terminal"></i>
                        <span>Terminal</span>
                    </button>
                </div>

                <div class="session-content-body">
                    <div class="content-tab-panel active" id="files-panel">
                        <div class="content-loading hidden">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Loading files...</span>
                        </div>
                        <div class="content-empty hidden">
                            <i class="fas fa-folder-open"></i>
                            <p>No files in this session</p>
                        </div>
                        <div class="content-list"></div>
                    </div>
                    
                    <div class="content-tab-panel" id="terminal-panel">
                        <div class="content-loading hidden">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Loading terminal logs...</span>
                        </div>
                        <div class="content-empty hidden">
                            <i class="fas fa-terminal"></i>
                            <p>No terminal executions in this session</p>
                        </div>
                        <div class="content-list"></div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Bind events
        this.bindEvents();
    }

    bindEvents() {
        const modal = document.getElementById('session-content-modal');
        const panel = modal.querySelector('.session-content-panel');
        const triggerBtn = document.getElementById('view-content-btn');

        // Close button
        modal.querySelector('.close-session-content-btn').addEventListener('click', () => {
            this.hide();
        });

        // Refresh button
        const refreshBtn = modal.querySelector('.refresh-content-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                if (!this.currentSessionId) return;
                
                // Add spinning animation
                const icon = refreshBtn.querySelector('i');
                icon.classList.add('fa-spin');
                refreshBtn.disabled = true;
                
                // Force refresh from API
                await this.loadContent(this.currentSessionId, true);
                
                // Remove spinning animation
                icon.classList.remove('fa-spin');
                refreshBtn.disabled = false;
            });
        }

        // Tab buttons
        const tabButtons = modal.querySelectorAll('.content-tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Click outside panel to close
        document.addEventListener('mousedown', (e) => {
            if (modal.classList.contains('hidden')) return;
            const clickedInsidePanel = panel.contains(e.target);
            const clickedTrigger = triggerBtn && triggerBtn.contains(e.target);
            if (!clickedInsidePanel && !clickedTrigger) {
                this.hide();
            }
        });

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                this.hide();
            }
        });

        window.addEventListener('resize', () => {
            if (this.isVisible()) {
                this.positionNearTrigger();
            }
        });
    }

    switchTab(tabName) {
        const modal = document.getElementById('session-content-modal');

        // Update tab buttons
        modal.querySelectorAll('.content-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update panels
        modal.querySelectorAll('.content-tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}-panel`);
        });
    }

    async show(sessionId, forceRefresh = false) {
        console.log('[SessionContentViewer] Opening for session:', sessionId);
        this.currentSessionId = sessionId;

        const modal = document.getElementById('session-content-modal');
        modal.classList.remove('hidden');
        this.positionNearTrigger();
        this.switchTab('files');

        // Load content (will use cache if available)
        await this.loadContent(sessionId, forceRefresh);
    }

    isVisible() {
        const modal = document.getElementById('session-content-modal');
        return modal ? !modal.classList.contains('hidden') : false;
    }

    hide() {
        const modal = document.getElementById('session-content-modal');
        modal.classList.add('hidden');
    }

    positionNearTrigger() {
        const modal = document.getElementById('session-content-modal');
        const panel = modal.querySelector('.session-content-panel');
        const trigger = document.getElementById('view-content-btn');
        if (!panel || !trigger) return;

        const triggerRect = trigger.getBoundingClientRect();
        const panelWidth = Math.min(420, Math.max(300, window.innerWidth - 24));
        const horizontalPadding = 12;

        let left = triggerRect.right - panelWidth;
        left = Math.max(horizontalPadding, Math.min(left, window.innerWidth - panelWidth - horizontalPadding));

        const bottom = Math.max(80, window.innerHeight - triggerRect.top + 10);

        modal.style.left = `${left}px`;
        modal.style.bottom = `${bottom}px`;
        modal.style.width = `${panelWidth}px`;
        modal.style.transform = 'none';
    }

    async loadContent(sessionId, forceRefresh = false) {
        console.log('[SessionContentViewer] Loading content for session:', sessionId);

        const filesPanel = document.getElementById('files-panel');
        const terminalPanel = document.getElementById('terminal-panel');

        // Check cache first
        const cachedData = this.getCachedContent(sessionId);
        if (cachedData && !forceRefresh) {
            console.log('[SessionContentViewer] Using cached content');
            this.content = cachedData;

            // Hide loading states
            filesPanel.querySelector('.content-loading').classList.add('hidden');
            terminalPanel.querySelector('.content-loading').classList.add('hidden');

            // Separate content by type
            const artifacts = this.content.filter(c => c.content_type === 'artifact');
            const uploads = this.content.filter(c => c.content_type === 'upload');
            const executions = this.content.filter(c => c.content_type === 'execution');

            // Combine artifacts and uploads for Files tab
            const files = [...artifacts, ...uploads];

            // Render content immediately from cache (renderFiles/renderTerminal will clear lists)
            this.renderFiles(files, filesPanel);
            this.renderTerminal(executions, terminalPanel);
            return;
        }

        // Show loading states
        filesPanel.querySelector('.content-loading').classList.remove('hidden');
        filesPanel.querySelector('.content-list').innerHTML = '';
        filesPanel.querySelector('.content-empty').classList.add('hidden');

        terminalPanel.querySelector('.content-loading').classList.remove('hidden');
        terminalPanel.querySelector('.content-list').innerHTML = '';
        terminalPanel.querySelector('.content-empty').classList.add('hidden');

        try {
            // Get auth session
            const session = await window.electron.auth.getSession();
            if (!session || !session.access_token) {
                throw new Error('Not authenticated');
            }

            // Fetch content from backend
            console.log('[SessionContentViewer] Fetching from API...');
            const response = await fetch(`http://localhost:8765/api/sessions/${sessionId}/content`, {
                headers: {
                    'Authorization': `Bearer ${session.access_token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch content: ${response.status}`);
            }

            const data = await response.json();
            this.content = data.content || [];

            // Cache the content
            this.cacheContent(sessionId, this.content);

            console.log('[SessionContentViewer] Loaded and cached content:', this.content.length, 'items');

            // Separate content by type
            const artifacts = this.content.filter(c => c.content_type === 'artifact');
            const uploads = this.content.filter(c => c.content_type === 'upload');
            const executions = this.content.filter(c => c.content_type === 'execution');

            // Combine artifacts and uploads for Files tab
            const files = [...artifacts, ...uploads];

            // Render content
            this.renderFiles(files, filesPanel);
            this.renderTerminal(executions, terminalPanel);

        } catch (error) {
            console.error('[SessionContentViewer] Error loading content:', error);

            // Show error state
            filesPanel.querySelector('.content-loading').classList.add('hidden');
            filesPanel.querySelector('.content-empty').classList.remove('hidden');
            filesPanel.querySelector('.content-empty p').textContent = 'Error loading files';

            terminalPanel.querySelector('.content-loading').classList.add('hidden');
            terminalPanel.querySelector('.content-empty').classList.remove('hidden');
            terminalPanel.querySelector('.content-empty p').textContent = 'Error loading terminal logs';
        }
    }

    /**
     * Cache content for a session
     */
    cacheContent(sessionId, content) {
        this.contentCache.set(sessionId, content);
        this.cacheTimestamps.set(sessionId, Date.now());
        console.log('[SessionContentViewer] Cached content for session:', sessionId);
    }

    /**
     * Get cached content if available and not expired
     */
    getCachedContent(sessionId) {
        if (!this.contentCache.has(sessionId)) {
            return null;
        }

        const timestamp = this.cacheTimestamps.get(sessionId);
        const age = Date.now() - timestamp;

        if (age > this.cacheExpiry) {
            console.log('[SessionContentViewer] Cache expired for session:', sessionId);
            this.contentCache.delete(sessionId);
            this.cacheTimestamps.delete(sessionId);
            return null;
        }

        return this.contentCache.get(sessionId);
    }

    /**
     * Invalidate cache for a session (call when new content is added)
     */
    invalidateCache(sessionId) {
        if (sessionId) {
            this.contentCache.delete(sessionId);
            this.cacheTimestamps.delete(sessionId);
            console.log('[SessionContentViewer] Invalidated cache for session:', sessionId);
        } else {
            // Clear all cache
            this.contentCache.clear();
            this.cacheTimestamps.clear();
            console.log('[SessionContentViewer] Cleared all cache');
        }
    }

    renderFiles(files, panel) {
        const loading = panel.querySelector('.content-loading');
        const empty = panel.querySelector('.content-empty');
        const list = panel.querySelector('.content-list');

        loading.classList.add('hidden');

        // Clear existing items to prevent duplicates
        list.innerHTML = '';

        if (files.length === 0) {
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');

        files.forEach(file => {
            const item = this.createFileItem(file);
            list.appendChild(item);
        });
    }

    renderTerminal(executions, panel) {
        const loading = panel.querySelector('.content-loading');
        const empty = panel.querySelector('.content-empty');
        const list = panel.querySelector('.content-list');

        loading.classList.add('hidden');

        // Clear existing items to prevent duplicates
        list.innerHTML = '';

        if (executions.length === 0) {
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');

        executions.forEach(exec => {
            const item = this.createTerminalItem(exec);
            list.appendChild(item);
        });
    }

    createFileItem(file) {
        const item = document.createElement('div');
        item.className = 'content-item file-item';

        const metadata = file.metadata || {};
        const filename = metadata.filename || 'Unknown file';
        const size = this.formatFileSize(metadata.size || 0);
        const type = file.content_type === 'artifact' ? 'Generated' : 'Uploaded';

        // Get file extension and type
        const ext = filename.split('.').pop().toLowerCase();
        const fileType = this.getFileType(ext);
        
        // Add file type as data attribute for styling
        item.setAttribute('data-file-type', fileType);

        // Get file icon
        const icon = this.getFileIcon(filename);

        item.innerHTML = `
            <div class="content-item-icon">
                <i class="${icon}"></i>
            </div>
            <div class="content-item-info">
                <div class="content-item-name">${this.escapeHtml(filename)}</div>
                <div class="content-item-meta">
                    <span class="content-item-size">${size}</span>
                    <span class="content-item-type">${type}</span>
                </div>
            </div>
            <div class="content-item-action">
                <i class="fas fa-eye"></i>
            </div>
        `;

        // Click to view
        item.addEventListener('click', () => {
            this.viewFile(file);
        });

        return item;
    }

    createTerminalItem(exec) {
        const item = document.createElement('div');
        item.className = 'content-item terminal-item';

        const metadata = exec.metadata || {};
        const command = metadata.command || 'Unknown command';
        const exitCode = metadata.exit_code !== undefined ? metadata.exit_code : '?';
        const exitCodeClass = exitCode === 0 ? 'exit-code-success' : 'exit-code-error';

        item.innerHTML = `
            <div class="content-item-icon">
                <i class="fas fa-terminal"></i>
            </div>
            <div class="content-item-info">
                <div class="content-item-name terminal-command">${this.escapeHtml(command)}</div>
                <div class="content-item-meta">
                    <span class="exit-code ${exitCodeClass}">Exit code: ${exitCode}</span>
                </div>
            </div>
            <div class="content-item-action">
                <i class="fas fa-eye"></i>
            </div>
        `;

        // Click to view
        item.addEventListener('click', () => {
            this.viewTerminal(exec);
        });

        return item;
    }

    async viewFile(file) {
        console.log('[SessionContentViewer] Viewing file:', file);

        try {
            const metadata = file.metadata || {};
            const filename = metadata.filename || 'file';

            if (file.content_type === 'artifact') {
                // Artifact - use download_url from API response
                if (!file.download_url) {
                    console.error('[SessionContentViewer] No download URL for artifact');
                    alert('File download URL is not available. The file may not have been uploaded to storage.');
                    return;
                }

                try {
                    console.log('[SessionContentViewer] Fetching artifact from:', file.download_url.substring(0, 100) + '...');
                    const response = await fetch(file.download_url);

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const content = await response.text();
                    console.log('[SessionContentViewer] Fetched artifact:', content.length, 'bytes');

                    // Detect language from filename
                    const language = this.detectLanguage(filename);

                    // Show in artifact viewer
                    this.hide();
                    artifactHandler.showArtifact('code', content, null, {
                        title: filename,
                        language,
                        defaultView: 'preview'
                    });
                } catch (error) {
                    console.error('[SessionContentViewer] Failed to fetch artifact:', error);
                    alert(`Failed to fetch file: ${error.message}`);
                }
            } else if (file.content_type === 'upload') {
                // Upload - check if file exists locally first
                const relativePath = metadata.relativePath;

                if (relativePath) {
                    try {
                        // Try to read from local archive
                        const exists = await window.electron.fileArchive.fileExists(relativePath);

                        if (exists) {
                            const fileData = await window.electron.fileArchive.readFile(relativePath);
                            const mimeType = metadata.mime_type || 'text/plain';

                            // Handle different file types
                            if (mimeType.startsWith('image/')) {
                                // Show image
                                const base64 = btoa(String.fromCharCode(...new Uint8Array(fileData)));
                                const dataUrl = `data:${mimeType};base64,${base64}`;
                                this.hide();
                                artifactHandler.showArtifact('image', dataUrl, null, {
                                    title: filename
                                });
                            } else if (mimeType.startsWith('text/') || metadata.is_text) {
                                // Show text content
                                const content = new TextDecoder().decode(fileData);
                                const language = this.detectLanguage(filename);
                                this.hide();
                                artifactHandler.showArtifact('code', content, null, {
                                    title: filename,
                                    language,
                                    defaultView: 'preview'
                                });
                            } else {
                                // For other types, open with system default
                                await window.electron.fileArchive.openFile(relativePath);
                            }
                            return;
                        }
                    } catch (error) {
                        console.warn('[SessionContentViewer] Could not read from local archive:', error);
                    }
                }

                // Fallback: try to get from Supabase
                if (metadata.path) {
                    const supabaseUrl = `https://your-supabase-url/storage/v1/object/public/${metadata.path}`;
                    window.open(supabaseUrl, '_blank');
                } else {
                    alert('File is not available locally or in cloud storage.');
                }
            }
        } catch (error) {
            console.error('[SessionContentViewer] Error viewing file:', error);
            alert(`Failed to open file: ${error.message}`);
        }
    }

    async viewTerminal(exec) {
        console.log('[SessionContentViewer] Viewing terminal:', exec);

        try {
            const metadata = exec.metadata || {};
            const command = metadata.command || 'Unknown command';

            // Check if URLs exist
            if (!exec.stdout_url && !exec.stderr_url) {
                console.warn('[SessionContentViewer] No stdout/stderr URLs available');

                // Check if output was empty
                const stdoutSize = metadata.stdout_size || 0;
                const stderrSize = metadata.stderr_size || 0;

                if (stdoutSize === 0 && stderrSize === 0) {
                    // Show message that command produced no output
                    const output = `Command: ${command}\n\nExit Code: ${metadata.exit_code || 0}\n\n(No output produced)`;
                    this.hide();
                    artifactHandler.showArtifact('code', output, null, {
                        title: 'Terminal Output',
                        language: 'bash',
                        defaultView: 'source'
                    });
                    return;
                } else {
                    alert('Terminal output URLs are not available. The logs may not have been uploaded to storage.');
                    return;
                }
            }

            // Fetch stdout and stderr from presigned URLs
            let stdout = '';
            let stderr = '';

            if (exec.stdout_url) {
                try {
                    console.log('[SessionContentViewer] Fetching stdout from:', exec.stdout_url.substring(0, 100) + '...');
                    const response = await fetch(exec.stdout_url);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    stdout = await response.text();
                    console.log('[SessionContentViewer] Fetched stdout:', stdout.length, 'bytes');
                } catch (error) {
                    console.error('[SessionContentViewer] Failed to fetch stdout:', error);
                    stdout = `[Error fetching stdout: ${error.message}]`;
                }
            }

            if (exec.stderr_url) {
                try {
                    console.log('[SessionContentViewer] Fetching stderr from:', exec.stderr_url.substring(0, 100) + '...');
                    const response = await fetch(exec.stderr_url);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    stderr = await response.text();
                    console.log('[SessionContentViewer] Fetched stderr:', stderr.length, 'bytes');
                } catch (error) {
                    console.error('[SessionContentViewer] Failed to fetch stderr:', error);
                    stderr = `[Error fetching stderr: ${error.message}]`;
                }
            }

            // Combine output
            let output = `Command: ${command}\n\nExit Code: ${metadata.exit_code || 0}\n\n`;
            if (stdout) {
                output += `=== STDOUT ===\n${stdout}\n\n`;
            }
            if (stderr) {
                output += `=== STDERR ===\n${stderr}\n`;
            }

            if (!stdout && !stderr) {
                output += '(No output produced)';
            }

            // Show in artifact viewer
            this.hide();
            artifactHandler.showArtifact('code', output, null, {
                title: 'Terminal Output',
                language: 'bash',
                defaultView: 'source'
            });
        } catch (error) {
            console.error('[SessionContentViewer] Error viewing terminal:', error);
            alert(`Failed to open terminal output: ${error.message}`);
        }
    }

    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const iconMap = {
            'js': 'fab fa-js-square',
            'jsx': 'fab fa-react',
            'ts': 'fab fa-js-square',
            'tsx': 'fab fa-react',
            'py': 'fab fa-python',
            'html': 'fab fa-html5',
            'css': 'fab fa-css3-alt',
            'json': 'fas fa-code',
            'md': 'fab fa-markdown',
            'markdown': 'fab fa-markdown',
            'txt': 'fas fa-file-alt',
            'pdf': 'fas fa-file-pdf',
            'doc': 'fas fa-file-word',
            'docx': 'fas fa-file-word',
            'xls': 'fas fa-file-excel',
            'xlsx': 'fas fa-file-excel',
            'jpg': 'fas fa-file-image',
            'jpeg': 'fas fa-file-image',
            'png': 'fas fa-file-image',
            'gif': 'fas fa-file-image',
            'svg': 'fas fa-file-image',
            'mp3': 'fas fa-file-audio',
            'wav': 'fas fa-file-audio',
            'mp4': 'fas fa-file-video',
            'avi': 'fas fa-file-video'
        };
        return iconMap[ext] || 'fas fa-file';
    }

    getFileType(ext) {
        // Map extensions to file type categories for styling
        const typeMap = {
            'js': 'js',
            'jsx': 'jsx',
            'ts': 'ts',
            'tsx': 'tsx',
            'py': 'py',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'md': 'md',
            'markdown': 'markdown',
            'txt': 'txt',
            'pdf': 'pdf',
            'doc': 'doc',
            'docx': 'docx',
            'xls': 'xls',
            'xlsx': 'xlsx',
            'jpg': 'image',
            'jpeg': 'image',
            'png': 'image',
            'gif': 'image',
            'svg': 'image',
            'webp': 'image',
            'mp3': 'audio',
            'wav': 'audio',
            'mp4': 'video',
            'avi': 'video'
        };
        return typeMap[ext] || 'default';
    }

    detectLanguage(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const langMap = {
            'js': 'javascript',
            'py': 'python',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'md': 'markdown',
            'mmd': 'mermaid',
            'sh': 'bash',
            'bash': 'bash',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'go': 'go',
            'rs': 'rust',
            'rb': 'ruby',
            'php': 'php',
            'ts': 'typescript',
            'tsx': 'typescript',
            'jsx': 'javascript'
        };
        return langMap[ext] || 'plaintext';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create singleton instance
const sessionContentViewer = new SessionContentViewer();

export default sessionContentViewer;
