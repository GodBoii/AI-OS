class ProjectWorkspace {
    constructor() {
        this.backendBaseUrl = 'http://localhost:8765';
        this.activeProject = null;
        this.currentTreeSource = null;
        this.selectedFilePath = null;
        this.initialized = false;
        this.syncDebounceTimer = null;
        this.init();
    }

    async init() {
        try {
            await this.waitForElement('project-workspace-panel');
            this.cacheElements();
            this.bindEvents();
            this.initialized = true;
        } catch (error) {
            console.warn('[ProjectWorkspace] Initialization skipped:', error.message);
        }
    }

    waitForElement(id, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const timer = setInterval(() => {
                if (document.getElementById(id)) {
                    clearInterval(timer);
                    resolve(true);
                    return;
                }
                if (Date.now() - started > timeoutMs) {
                    clearInterval(timer);
                    reject(new Error(`Element '${id}' not found`));
                }
            }, 80);
        });
    }

    cacheElements() {
        this.el = {
            panel: document.getElementById('project-workspace-panel'),
            title: document.getElementById('project-workspace-title'),
            subtitle: document.getElementById('project-workspace-subtitle'),
            status: document.getElementById('project-workspace-status'),
            tree: document.getElementById('project-file-tree'),
            previewTitle: document.getElementById('project-file-preview-title'),
            previewContent: document.getElementById('project-file-preview-content'),
            mainPreview: document.getElementById('project-main-file-preview'),
            mainPreviewTitle: document.getElementById('project-main-file-preview-title'),
            mainPreviewContent: document.getElementById('project-main-file-preview-content'),
            mainPreviewCloseBtn: document.getElementById('project-main-file-preview-close'),
            closeBtn: document.getElementById('project-workspace-close'),
            syncBtn: document.getElementById('project-sync-files-btn'),
            startChatBtn: document.getElementById('project-start-chat-btn'),
            cloneRepoBtn: document.getElementById('project-clone-repo-btn'),
            exitBtn: document.getElementById('project-exit-btn'),
            repoUrlInput: document.getElementById('project-repo-url'),
            repoBranchInput: document.getElementById('project-repo-branch')
        };
    }

    bindEvents() {
        this.el.closeBtn?.addEventListener('click', () => this.closePanel());
        this.el.syncBtn?.addEventListener('click', () => this.syncWorkspaceTree());
        this.el.startChatBtn?.addEventListener('click', () => this.startCoderChat());
        this.el.cloneRepoBtn?.addEventListener('click', () => this.cloneGithubRepo());
        this.el.exitBtn?.addEventListener('click', () => this.exitProjectMode());
        this.el.mainPreviewCloseBtn?.addEventListener('click', () => this.hideMainFilePreview());

        // GitHub dropdown toggle
        const githubToggle = document.getElementById('project-github-toggle');
        const githubContent = document.getElementById('project-github-content');

        githubToggle?.addEventListener('click', () => {
            const isHidden = githubContent.classList.contains('hidden');
            if (isHidden) {
                githubContent.classList.remove('hidden');
                githubToggle.classList.add('active');
            } else {
                githubContent.classList.add('hidden');
                githubToggle.classList.remove('active');
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && document.body.classList.contains('project-file-preview-active')) {
                this.hideMainFilePreview();
            }
        });

        document.addEventListener('project-workspace:open', (event) => {
            this.openProject(event?.detail || {});
        });

        document.addEventListener('session-content:updated', (event) => {
            const detail = event?.detail || {};
            if (!this.activeProject) return;
            if (!window.currentConversationId) return;
            if (detail.conversationId && detail.conversationId !== window.currentConversationId) return;

            if (this.syncDebounceTimer) {
                clearTimeout(this.syncDebounceTimer);
            }
            this.syncDebounceTimer = setTimeout(() => {
                this.syncWorkspaceTree();
            }, 300);
        });
    }

    openPanel() {
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isProjectWorkspaceOpen: true });
        } else {
            this.el.panel?.classList.remove('hidden');
            document.body.classList.add('project-panel-open');
        }
    }

    closePanel() {
        this.hideMainFilePreview();
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isProjectWorkspaceOpen: false });
        } else {
            this.el.panel?.classList.add('hidden');
            document.body.classList.remove('project-panel-open');
        }
    }

    async openProject(project) {
        this.activeProject = {
            ...project,
            agentMode: 'coder',
            isDedicatedProject: true,
            mode: 'project'
        };
        window.projectContext = this.activeProject;

        const label = project?.project_name || project?.slug || 'Project Workspace';
        const sub = project?.hostname || project?.repo_url || 'Dedicated coding mode';
        this.el.title.textContent = label;
        this.el.subtitle.textContent = sub;
        this.setStatus('Project mode active. Messages will route to dedicated coder agent.');
        this.setPreviewPlaceholder('Click a file to view its content.');
        this.hideMainFilePreview();

        this.openPanel();
        await this.syncWorkspaceTree();
    }

    async getAccessToken() {
        const session = await window.electron?.auth?.getSession?.();
        return session?.access_token || null;
    }

    async callApi(path, method = 'GET', body = null) {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Please sign in');
        }

        const response = await fetch(`${this.backendBaseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body ? { 'Content-Type': 'application/json' } : {})
            },
            ...(body ? { body: JSON.stringify(body) } : {})
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error || `HTTP ${response.status}`);
        }
        return payload;
    }

    setStatus(message) {
        if (this.el.status) {
            this.el.status.textContent = message;
        }
    }

    showMainFilePreview() {
        if (this.el.mainPreview) {
            this.el.mainPreview.classList.remove('hidden');
        }
        document.body.classList.add('project-file-preview-active');
    }

    hideMainFilePreview() {
        if (this.el.mainPreview) {
            this.el.mainPreview.classList.add('hidden');
        }
        document.body.classList.remove('project-file-preview-active');
    }

    renderTreeFromPaths(paths) {
        const root = {};
        for (const rawPath of paths) {
            const path = String(rawPath || '').trim();
            if (!path) continue;
            const parts = path.split('/').filter(Boolean);
            let node = root;
            for (let i = 0; i < parts.length; i += 1) {
                const part = parts[i];
                if (!node[part]) {
                    node[part] = { dir: i < parts.length - 1, children: {} };
                }
                node = node[part].children;
            }
        }

        const ul = document.createElement('ul');
        ul.className = 'project-file-tree';

        const renderNode = (nodeObj, container, depth = 0, parentPath = '') => {
            const keys = Object.keys(nodeObj).sort((a, b) => {
                const aDir = nodeObj[a].dir;
                const bDir = nodeObj[b].dir;
                if (aDir !== bDir) return aDir ? -1 : 1;
                return a.localeCompare(b);
            });
            for (const key of keys) {
                const item = nodeObj[key];
                const fullPath = parentPath ? `${parentPath}/${key}` : key;
                const li = document.createElement('li');
                const row = document.createElement('div');
                row.className = `project-file-row ${item.dir ? 'dir' : 'file'}`;
                row.style.paddingLeft = `${6 + depth * 14}px`;
                row.dataset.path = fullPath;
                row.innerHTML = `
                    <i class="file-icon fas ${item.dir ? 'fa-folder' : 'fa-file-code'}"></i>
                    <span class="file-name">${this.escapeHtml(key)}</span>
                `;
                if (!item.dir) {
                    row.addEventListener('click', () => this.openFilePreview(fullPath, row));
                }
                li.appendChild(row);
                container.appendChild(li);

                if (item.dir && Object.keys(item.children).length > 0) {
                    renderNode(item.children, container, depth + 1, fullPath);
                }
            }
        };

        renderNode(root, ul, 0, '');
        this.el.tree.innerHTML = '';
        this.el.tree.appendChild(ul);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async syncWorkspaceTree() {
        if (!this.activeProject) {
            this.setStatus('Open a project first.');
            this.el.tree.innerHTML = '';
            return;
        }

        try {
            this.setStatus('Syncing files...');

            let paths = [];
            let source = null;

            if (this.activeProject.site_id) {
                const query = new URLSearchParams({
                    site_id: String(this.activeProject.site_id),
                    ...(this.activeProject.deployment_id
                        ? { deployment_id: String(this.activeProject.deployment_id) }
                        : {})
                });
                const payload = await this.callApi(`/api/deploy/files?${query.toString()}`, 'GET');
                const files = Array.isArray(payload?.files) ? payload.files : [];
                paths = files.map((f) => f.path).filter(Boolean);
                source = 'deployment';
            }

            const conversationId = window.currentConversationId;
            if (conversationId) {
                const workspacePayload = await this.callApi('/api/project/workspace/tree', 'POST', {
                    conversation_id: conversationId
                });
                const workspaceFiles = Array.isArray(workspacePayload?.files) ? workspacePayload.files : [];
                if (workspaceFiles.length > 0) {
                    paths = workspaceFiles.map((f) => f.path).filter(Boolean);
                    source = 'workspace';
                }
            }

            if (!paths.length) {
                this.el.tree.innerHTML = '<div class="project-workspace-status">No files found yet.</div>';
                this.setStatus('No files found. Clone repo or run project sync.');
                this.currentTreeSource = null;
                this.setPreviewPlaceholder('Click a file to view its content.');
                this.hideMainFilePreview();
                return;
            }

            this.currentTreeSource = source || 'workspace';
            this.selectedFilePath = null;
            this.renderTreeFromPaths(paths);
            this.setPreviewPlaceholder(`Loaded ${paths.length} files. Click a file to preview.`);
            this.setStatus(`Loaded ${paths.length} file${paths.length === 1 ? '' : 's'} from ${this.currentTreeSource}.`);
        } catch (error) {
            this.setStatus(`Sync failed: ${error.message}`);
        }
    }

    setPreviewPlaceholder(message) {
        if (this.el.previewTitle) {
            this.el.previewTitle.textContent = 'File Preview';
        }
        if (this.el.previewContent) {
            this.el.previewContent.textContent = message;
        }
        if (this.el.mainPreviewTitle) {
            this.el.mainPreviewTitle.textContent = 'File Preview';
        }
        if (this.el.mainPreviewContent) {
            this.el.mainPreviewContent.textContent = message;
        }
    }

    clearSelectedRows() {
        this.el.tree.querySelectorAll('.project-file-row.selected').forEach((row) => {
            row.classList.remove('selected');
        });
    }

    async openFilePreview(path, rowEl) {
        if (!path) return;

        this.clearSelectedRows();
        if (rowEl) {
            rowEl.classList.add('selected');
        }

        this.selectedFilePath = path;
        if (this.el.previewTitle) {
            this.el.previewTitle.textContent = path;
        }
        if (this.el.previewContent) {
            this.el.previewContent.textContent = 'Loading file content...';
        }
        if (this.el.mainPreviewTitle) {
            this.el.mainPreviewTitle.textContent = path;
        }
        if (this.el.mainPreviewContent) {
            this.el.mainPreviewContent.textContent = 'Loading file content...';
        }
        this.showMainFilePreview();

        try {
            let payload;
            if (this.currentTreeSource === 'deployment' && this.activeProject?.site_id) {
                const query = new URLSearchParams({
                    site_id: String(this.activeProject.site_id),
                    path: String(path),
                    ...(this.activeProject?.deployment_id
                        ? { deployment_id: String(this.activeProject.deployment_id) }
                        : {})
                });
                payload = await this.callApi(`/api/deploy/file-content?${query.toString()}`, 'GET');
            } else {
                const conversationId = window.currentConversationId;
                if (!conversationId) {
                    throw new Error('No active conversation for workspace file preview');
                }
                payload = await this.callApi('/api/project/workspace/file-content', 'POST', {
                    conversation_id: conversationId,
                    path: String(path),
                });
            }

            if (payload?.is_binary) {
                const binaryText =
                    `[Binary file]\nPath: ${path}\nSize: ${payload.size_bytes || 0} bytes\n\nBinary content preview is not shown.`;
                this.el.previewContent.textContent = binaryText;
                if (this.el.mainPreviewContent) {
                    this.el.mainPreviewContent.textContent = binaryText;
                }
                return;
            }

            const body = String(payload?.content || '');
            const truncNote = payload?.truncated
                ? '\n\n[Preview truncated for large file]'
                : '';
            const previewText = `${body}${truncNote}`;
            this.el.previewContent.textContent = previewText;
            if (this.el.mainPreviewContent) {
                this.el.mainPreviewContent.textContent = previewText;
            }
        } catch (error) {
            const errorText = `Failed to load file: ${error.message}`;
            this.el.previewContent.textContent = errorText;
            if (this.el.mainPreviewContent) {
                this.el.mainPreviewContent.textContent = errorText;
            }
        }
    }

    async sendMessageToChat(message, startNew = false) {
        const input = document.getElementById('floating-input');
        const sendBtn = document.getElementById('send-message');
        const newChatBtn = document.querySelector('.add-btn');

        if (!input || !sendBtn) return;
        if (startNew) {
            if (typeof window.startNewConversation === 'function') {
                await window.startNewConversation();
            } else if (newChatBtn) {
                newChatBtn.click();
                await new Promise((resolve) => setTimeout(resolve, 150));
            }
        }

        input.value = message;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sendBtn.click();
    }

    async startCoderChat() {
        const intro = this.activeProject?.site_id
            ? `You are in dedicated project mode. Inspect deployed project ${this.activeProject.slug || this.activeProject.site_id}, copy it to workspace, show file tree, and wait for my next coding instruction.`
            : 'You are in dedicated coding mode. Inspect workspace, summarize file tree, and wait for my coding instruction.';
        await this.sendMessageToChat(intro, true);
        this.setStatus('Started dedicated coder chat.');
    }

    async cloneGithubRepo() {
        const repoUrl = (this.el.repoUrlInput?.value || '').trim();
        const branch = (this.el.repoBranchInput?.value || '').trim() || 'main';
        if (!repoUrl) {
            this.setStatus('Enter a GitHub repo URL first.');
            return;
        }

        this.activeProject = {
            ...(this.activeProject || {}),
            repo_url: repoUrl,
            branch,
            source: 'github',
            isDedicatedProject: true,
            mode: 'project',
            agentMode: 'coder'
        };
        window.projectContext = this.activeProject;

        const cloneInstruction =
            `In dedicated coder mode: clone repository ${repoUrl} (branch ${branch}) into /home/sandboxuser/workspace, ` +
            'then list the project tree and prepare for edits.';
        await this.sendMessageToChat(cloneInstruction, true);
        this.setStatus('Clone request sent to dedicated coder.');
    }

    exitProjectMode() {
        this.activeProject = null;
        window.projectContext = null;
        this.el.title.textContent = 'Project Workspace';
        this.el.subtitle.textContent = 'No active project';
        this.el.tree.innerHTML = '';
        this.currentTreeSource = null;
        this.selectedFilePath = null;
        this.hideMainFilePreview();
        this.setPreviewPlaceholder('Click a file to view its content.');
        this.setStatus('Project mode off. Starting a new normal chat session.');
        this.closePanel();

        // Force a brand-new chat session so subsequent messages use default llm_os flow.
        const newChatBtn = document.querySelector('.add-btn');
        if (newChatBtn) {
            newChatBtn.click();
        }
    }
}

const projectWorkspace = new ProjectWorkspace();
window.projectWorkspace = projectWorkspace;

export default projectWorkspace;