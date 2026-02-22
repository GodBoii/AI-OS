// history-content-sidebar.js - Left sidebar for viewing history session content
// Separate from the live chat floating window

class HistoryContentSidebar {
    constructor() {
        this.currentSessionId = null;
        this.content = [];
        this.contentCache = new Map();
        this.cacheTimestamps = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
        this.init();
    }

    init() {
        // Create sidebar structure
        const sidebar = document.createElement('div');
        sidebar.id = 'history-content-sidebar';
        sidebar.className = 'history-content-sidebar hidden';

        sidebar.innerHTML = `
            <div class="history-sidebar-overlay"></div>
            <div class="history-sidebar-panel">
                <div class="history-sidebar-header">
                    <div class="history-sidebar-heading">
                        <i class="fas fa-folder-open"></i>
                        <h3>Content</h3>
                    </div>
                    <div class="history-sidebar-actions">
                        <button class="refresh-history-content-btn" aria-label="Refresh content" title="Refresh content">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="close-history-sidebar-btn" aria-label="Close">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                <div class="history-sidebar-tabs">
                    <button class="history-tab-btn active" data-tab="files">
                        <i class="fas fa-file"></i>
                        <span>Files</span>
                    </button>
                    <button class="history-tab-btn" data-tab="terminal">
                        <i class="fas fa-terminal"></i>
                        <span>Terminal</span>
                    </button>
                </div>

                <div class="history-sidebar-body">
                    <div class="history-tab-panel active" id="history-files-panel">
                        <div class="history-content-loading hidden">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Loading files...</span>
                        </div>
                        <div class="history-content-empty hidden">
                            <i class="fas fa-folder-open"></i>
                            <p>No files in this session</p>
                        </div>
                        <div class="history-content-list"></div>
                    </div>
                    
                    <div class="history-tab-panel" id="history-terminal-panel">
                        <div class="history-content-loading hidden">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Loading terminal logs...</span>
                        </div>
                        <div class="history-content-empty hidden">
                            <i class="fas fa-terminal"></i>
                            <p>No terminal executions in this session</p>
                        </div>
                        <div class="history-content-list"></div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(sidebar);
        this.bindEvents();
    }

    bindEvents() {
        const sidebar = document.getElementById('history-content-sidebar');
        const overlay = sidebar.querySelector('.history-sidebar-overlay');
        const closeBtn = sidebar.querySelector('.close-history-sidebar-btn');
        const refreshBtn = sidebar.querySelector('.refresh-history-content-btn');

        // Close button
        closeBtn.addEventListener('click', () => this.hide());

        // Overlay click to close
        overlay.addEventListener('click', () => this.hide());

        // Refresh button
        refreshBtn.addEventListener('click', async () => {
            if (!this.currentSessionId) return;
            
            const icon = refreshBtn.querySelector('i');
            icon.classList.add('fa-spin');
            refreshBtn.disabled = true;
            
            await this.loadContent(this.currentSessionId, true);
            
            icon.classList.remove('fa-spin');
            refreshBtn.disabled = false;
        });

        // Tab buttons
        const tabButtons = sidebar.querySelectorAll('.history-tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible()) {
                this.hide();
            }
        });
    }

    switchTab(tabName) {
        const sidebar = document.getElementById('history-content-sidebar');

        // Update tab buttons
        sidebar.querySelectorAll('.history-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update panels
        sidebar.querySelectorAll('.history-tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `history-${tabName}-panel`);
        });
    }

    async show(sessionId, forceRefresh = false) {
        console.log('[HistoryContentSidebar] Opening for session:', sessionId);
        this.currentSessionId = sessionId;

        const sidebar = document.getElementById('history-content-sidebar');
        sidebar.classList.remove('hidden');
        
        // Trigger animation
        requestAnimationFrame(() => {
            sidebar.classList.add('visible');
        });

        this.switchTab('files');

        // Load content
        await this.loadContent(sessionId, forceRefresh);
    }

    hide() {
        const sidebar = document.getElementById('history-content-sidebar');
        sidebar.classList.remove('visible');
        
        // Wait for animation before hiding
        setTimeout(() => {
            sidebar.classList.add('hidden');
        }, 300);
    }

    isVisible() {
        const sidebar = document.getElementById('history-content-sidebar');
        return sidebar && !sidebar.classList.contains('hidden');
    }

    async loadContent(sessionId, forceRefresh = false) {
        console.log('[HistoryContentSidebar] Loading content for session:', sessionId);

        const filesPanel = document.getElementById('history-files-panel');
        const terminalPanel = document.getElementById('history-terminal-panel');

        // Check cache first
        const cachedData = this.getCachedContent(sessionId);
        if (cachedData && !forceRefresh) {
            console.log('[HistoryContentSidebar] Using cached content');
            this.content = cachedData;

            filesPanel.querySelector('.history-content-loading').classList.add('hidden');
            terminalPanel.querySelector('.history-content-loading').classList.add('hidden');

            const artifacts = this.content.filter(c => c.content_type === 'artifact');
            const uploads = this.content.filter(c => c.content_type === 'upload');
            const executions = this.content.filter(c => c.content_type === 'execution');

            const files = [...artifacts, ...uploads];

            this.renderFiles(files, filesPanel);
            this.renderTerminal(executions, terminalPanel);
            return;
        }

        // Show loading states
        filesPanel.querySelector('.history-content-loading').classList.remove('hidden');
        filesPanel.querySelector('.history-content-list').innerHTML = '';
        filesPanel.querySelector('.history-content-empty').classList.add('hidden');

        terminalPanel.querySelector('.history-content-loading').classList.remove('hidden');
        terminalPanel.querySelector('.history-content-list').innerHTML = '';
        terminalPanel.querySelector('.history-content-empty').classList.add('hidden');

        try {
            // Get auth session
            const session = await window.electron.auth.getSession();
            if (!session || !session.access_token) {
                throw new Error('Not authenticated');
            }

            // Fetch content from backend
            console.log('[HistoryContentSidebar] Fetching from API...');
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

            console.log('[HistoryContentSidebar] Loaded and cached content:', this.content.length, 'items');

            // Separate content by type
            const artifacts = this.content.filter(c => c.content_type === 'artifact');
            const uploads = this.content.filter(c => c.content_type === 'upload');
            const executions = this.content.filter(c => c.content_type === 'execution');

            const files = [...artifacts, ...uploads];

            // Render content
            this.renderFiles(files, filesPanel);
            this.renderTerminal(executions, terminalPanel);

        } catch (error) {
            console.error('[HistoryContentSidebar] Error loading content:', error);

            filesPanel.querySelector('.history-content-loading').classList.add('hidden');
            filesPanel.querySelector('.history-content-empty').classList.remove('hidden');
            filesPanel.querySelector('.history-content-empty p').textContent = 'Error loading files';

            terminalPanel.querySelector('.history-content-loading').classList.add('hidden');
            terminalPanel.querySelector('.history-content-empty').classList.remove('hidden');
            terminalPanel.querySelector('.history-content-empty p').textContent = 'Error loading terminal logs';
        }
    }

    cacheContent(sessionId, content) {
        this.contentCache.set(sessionId, content);
        this.cacheTimestamps.set(sessionId, Date.now());
        console.log('[HistoryContentSidebar] Cached content for session:', sessionId);
    }

    getCachedContent(sessionId) {
        if (!this.contentCache.has(sessionId)) {
            return null;
        }

        const timestamp = this.cacheTimestamps.get(sessionId);
        const age = Date.now() - timestamp;

        if (age > this.cacheExpiry) {
            console.log('[HistoryContentSidebar] Cache expired for session:', sessionId);
            this.contentCache.delete(sessionId);
            this.cacheTimestamps.delete(sessionId);
            return null;
        }

        return this.contentCache.get(sessionId);
    }

    invalidateCache(sessionId) {
        if (sessionId) {
            this.contentCache.delete(sessionId);
            this.cacheTimestamps.delete(sessionId);
            console.log('[HistoryContentSidebar] Invalidated cache for session:', sessionId);
        } else {
            this.contentCache.clear();
            this.cacheTimestamps.clear();
            console.log('[HistoryContentSidebar] Cleared all cache');
        }
    }

    renderFiles(files, panel) {
        const loading = panel.querySelector('.history-content-loading');
        const empty = panel.querySelector('.history-content-empty');
        const list = panel.querySelector('.history-content-list');

        loading.classList.add('hidden');
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
        const loading = panel.querySelector('.history-content-loading');
        const empty = panel.querySelector('.history-content-empty');
        const list = panel.querySelector('.history-content-list');

        loading.classList.add('hidden');
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
        item.className = 'history-content-item file-item';

        const metadata = file.metadata || {};
        const filename = metadata.filename || 'Unknown file';
        const size = this.formatFileSize(metadata.size || 0);
        const type = file.content_type === 'artifact' ? 'Generated' : 'Uploaded';

        const ext = filename.split('.').pop().toLowerCase();
        const fileType = this.getFileType(ext);
        
        item.setAttribute('data-file-type', fileType);

        const icon = this.getFileIcon(filename);

        item.innerHTML = `
            <div class="history-item-icon">
                <i class="${icon}"></i>
            </div>
            <div class="history-item-info">
                <div class="history-item-name">${this.escapeHtml(filename)}</div>
                <div class="history-item-meta">
                    <span class="history-item-size">${size}</span>
                    <span class="history-item-type">${type}</span>
                </div>
            </div>
            <div class="history-item-action">
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
        item.className = 'history-content-item terminal-item';

        const metadata = exec.metadata || {};
        const command = metadata.command || 'Unknown command';
        const exitCode = metadata.exit_code !== undefined ? metadata.exit_code : '?';
        const exitCodeClass = exitCode === 0 ? 'exit-code-success' : 'exit-code-error';

        item.innerHTML = `
            <div class="history-item-icon">
                <i class="fas fa-terminal"></i>
            </div>
            <div class="history-item-info">
                <div class="history-item-name terminal-command">${this.escapeHtml(command)}</div>
                <div class="history-item-meta">
                    <span class="exit-code ${exitCodeClass}">Exit code: ${exitCode}</span>
                </div>
            </div>
            <div class="history-item-action">
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
        console.log('[HistoryContentSidebar] Viewing file:', file);
        
        // Use the history content preview
        if (window.historyContentPreview) {
            this.hide(); // Close sidebar
            window.historyContentPreview.show(file);
        }
    }

    async viewTerminal(exec) {
        console.log('[HistoryContentSidebar] Viewing terminal:', exec);
        
        // Use the history content preview
        if (window.historyContentPreview) {
            this.hide(); // Close sidebar
            window.historyContentPreview.show(exec);
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
        const typeMap = {
            'js': 'js', 'jsx': 'jsx', 'ts': 'ts', 'tsx': 'tsx',
            'py': 'py', 'html': 'html', 'css': 'css', 'json': 'json',
            'md': 'md', 'markdown': 'markdown', 'txt': 'txt',
            'pdf': 'pdf', 'doc': 'doc', 'docx': 'docx',
            'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image', 'svg': 'image',
            'mp3': 'audio', 'wav': 'audio', 'mp4': 'video', 'avi': 'video'
        };
        return typeMap[ext] || 'default';
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
const historyContentSidebar = new HistoryContentSidebar();

// Expose globally
window.historyContentSidebar = historyContentSidebar;

export default historyContentSidebar;
