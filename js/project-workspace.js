class ProjectWorkspace {
    constructor() {
        this.backendBaseUrl = 'https://api.pawsitivestrides.store';
        this.activeProject = null;
        this.currentTreeSource = null;
        this.latestSyncedPaths = [];
        this.selectedFilePath = null;
        this.workspaceStates = new Map();
        this.syncDebounceTimer = null;
        this.terminalVisible = false;
        this.terminal = null;
        this.terminalFitAddon = null;
        this.terminalReady = false;
        this.terminalResizeObserver = null;
        this.terminalResizeTimer = null;
        this.terminalSessionMode = null;
        this.init();
    }

    async init() {
        try {
            await this.waitForElement('project-workspace-panel');
            this.cacheElements();
            this.bindEvents();
            this.updateModeUI();
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

    createDefaultState() {
        return {
            workspace_mode: 'cloud',
            repo_url: null,
            branch: 'main',
            local_context: {
                root_path: null,
                repo_url: null,
                branch: 'main',
                repo_name: null,
                is_ready: false,
                source_type: null,
                source_site_id: null,
                source_deployment_id: null,
                source_project_name: null,
            },
            cloud_context: {
                is_ready: false,
                site_id: null,
                deployment_id: null,
            },
            bootstrap_context_sent: false,
            bootstrap_context_key: null,
            deployment_dirty: false,
            deployment_diff_summary: null,
        };
    }

    getConversationId() {
        return window.currentConversationId || null;
    }

    getScopedConversationId(conversationId = this.getConversationId()) {
        return conversationId || '__default__';
    }

    isActiveScopedConversation(conversationId) {
        if (!conversationId) return false;
        const activeScoped = this.getScopedConversationId();
        return conversationId === activeScoped || conversationId === '__default__';
    }

    adoptDefaultWorkspaceState(conversationId) {
        if (!conversationId) return;
        const fallback = this.workspaceStates.get('__default__');
        if (!fallback) return;

        const hasFallbackContext = Boolean(
            fallback.local_context?.is_ready
            || fallback.repo_url
            || fallback.cloud_context?.is_ready
            || fallback.workspace_mode === 'local'
        );
        if (!hasFallbackContext) return;

        const existing = this.workspaceStates.get(conversationId);
        if (!existing) {
            const cloned = JSON.parse(JSON.stringify(fallback));
            this.workspaceStates.set(conversationId, cloned);
            this.workspaceStates.delete('__default__');
            return;
        }

        if (!existing.local_context?.is_ready && fallback.local_context?.is_ready) {
            existing.local_context = { ...(fallback.local_context || {}) };
        }
        if (!existing.repo_url && fallback.repo_url) {
            existing.repo_url = fallback.repo_url;
        }
        if ((!existing.branch || existing.branch === 'main') && fallback.branch) {
            existing.branch = fallback.branch;
        }
        if (!existing.cloud_context?.is_ready && fallback.cloud_context?.is_ready) {
            existing.cloud_context = { ...(fallback.cloud_context || {}) };
        }
        if (fallback.workspace_mode === 'local' && fallback.local_context?.is_ready) {
            existing.workspace_mode = 'local';
        }

        this.workspaceStates.delete('__default__');
    }

    async ensureConversationId() {
        const existing = this.getConversationId();
        if (existing) {
            this.adoptDefaultWorkspaceState(existing);
            return existing;
        }

        if (typeof window.startNewConversation === 'function') {
            await window.startNewConversation();
            const created = this.getConversationId();
            if (created) {
                this.adoptDefaultWorkspaceState(created);
            }
            return created;
        }

        const newChatBtn = document.querySelector('.add-btn');
        if (newChatBtn) {
            newChatBtn.click();
            await new Promise((resolve) => setTimeout(resolve, 160));
        }
        const created = this.getConversationId();
        if (created) {
            this.adoptDefaultWorkspaceState(created);
        }
        return created;
    }

    getState(conversationId = this.getConversationId(), create = true) {
        const key = conversationId || '__default__';
        if (!this.workspaceStates.has(key) && create) {
            this.workspaceStates.set(key, this.createDefaultState());
        }
        return this.workspaceStates.get(key) || null;
    }

    getSnapshotState() {
        const currentConversationId = this.getConversationId();
        if (currentConversationId && this.workspaceStates.has(currentConversationId)) {
            return this.workspaceStates.get(currentConversationId);
        }

        const fallback = this.workspaceStates.get('__default__');
        if (fallback) {
            return fallback;
        }

        const values = Array.from(this.workspaceStates.values());
        if (values.length === 1) {
            return values[0];
        }

        const activeSiteId = String(this.activeProject?.site_id || '').trim();
        const activeDeploymentId = String(this.activeProject?.deployment_id || '').trim();
        if (activeSiteId) {
            const matched = values.find((state) => {
                const local = state?.local_context || {};
                const cloud = state?.cloud_context || {};
                if (String(local?.source_site_id || '') !== activeSiteId && String(cloud?.site_id || '') !== activeSiteId) {
                    return false;
                }
                if (!activeDeploymentId) {
                    return true;
                }
                if (String(local?.source_deployment_id || '') === activeDeploymentId) {
                    return true;
                }
                if (String(cloud?.deployment_id || '') === activeDeploymentId) {
                    return true;
                }
                return false;
            });
            if (matched) {
                return matched;
            }
        }

        return null;
    }

    getExecutionTarget() {
        return this.getState()?.workspace_mode === 'local' ? 'local' : 'cloud';
    }

    getWorkspaceContextPayload() {
        const state = this.getState();
        if (!state) return null;
        return {
            workspace_mode: state.workspace_mode,
            is_cloud_mode: state.workspace_mode === 'cloud',
            is_local_mode: state.workspace_mode === 'local',
            repo_url: state.repo_url,
            branch: state.branch,
            local_context: { ...(state.local_context || {}) },
            cloud_context: { ...(state.cloud_context || {}) },
            site_id: this.activeProject?.site_id || null,
            deployment_id: this.activeProject?.deployment_id || null,
            project_name: this.activeProject?.project_name || null,
            slug: this.activeProject?.slug || null,
            hostname: this.activeProject?.hostname || null,
            version: this.activeProject?.version || null,
            r2_prefix: this.activeProject?.r2_prefix || null,
            url: this.activeProject?.hostname ? `https://${this.activeProject.hostname}` : null,
        };
    }

    getWorkspaceSnapshot() {
        const state = this.getSnapshotState();
        const globalState = window.stateManager?.getState ? window.stateManager.getState() : {};
        return {
            isProjectWorkspaceOpen: Boolean(globalState?.isProjectWorkspaceOpen),
            activeProject: this.activeProject ? { ...this.activeProject } : null,
            workspace_mode: state?.workspace_mode || 'cloud',
            local_context: state?.local_context ? { ...state.local_context } : null,
            cloud_context: state?.cloud_context ? { ...state.cloud_context } : null,
            currentTreeSource: this.currentTreeSource || null,
        };
    }

    emitWorkspaceStateChange() {
        document.dispatchEvent(new CustomEvent('project-workspace:state-change', {
            detail: this.getWorkspaceSnapshot()
        }));
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
            repoBranchInput: document.getElementById('project-repo-branch'),
            modeToggleBtn: document.getElementById('project-mode-toggle-btn'),
            modeCurrentLabel: document.getElementById('project-mode-current-label'),
            modeWindow: document.getElementById('project-mode-window'),
            modeWindowCurrent: document.getElementById('project-mode-window-current'),
            modeLocalBtn: document.getElementById('project-mode-local-btn'),
            modeCloudBtn: document.getElementById('project-mode-cloud-btn'),
            terminalBtn: document.getElementById('project-local-terminal-btn'),
            terminalOverlay: document.getElementById('project-local-terminal-overlay'),
            terminalShell: document.getElementById('project-local-terminal-shell'),
            terminalCloseBtn: document.getElementById('project-local-terminal-close'),
            terminalOutput: document.getElementById('project-local-terminal-output'),
            terminalInput: document.getElementById('project-local-terminal-input'),
            terminalSendBtn: document.getElementById('project-local-terminal-send'),
            // Super-header buttons
            superSidebarBtn: document.getElementById('super-sidebar-toggle-btn'),
            superTerminalBtn: document.getElementById('super-terminal-btn'),
            superSyncBtn: document.getElementById('super-sync-btn'),
            superCloudBtn: document.getElementById('super-cloud-btn'),
            superLocalBtn: document.getElementById('super-local-btn'),
            superGithubBtn: document.getElementById('super-github-btn'),
            redeployBar: document.getElementById('project-redeploy-bar'),
            redeployTitle: document.getElementById('project-redeploy-title'),
            redeploySubtitle: document.getElementById('project-redeploy-subtitle'),
            redeployBtn: document.getElementById('project-redeploy-btn'),
        };
    }

    bindEvents() {
        this.el.closeBtn?.addEventListener('click', () => this.closePanel());
        this.el.syncBtn?.addEventListener('click', () => this.syncWorkspaceTree());
        this.el.startChatBtn?.addEventListener('click', () => this.startCoderChat());
        this.el.cloneRepoBtn?.addEventListener('click', () => this.cloneGithubRepo());
        this.el.exitBtn?.addEventListener('click', () => this.exitProjectMode());
        this.el.mainPreviewCloseBtn?.addEventListener('click', () => this.hideMainFilePreview());
        this.el.redeployBtn?.addEventListener('click', () => this.redeployCurrentWorkspace());
        // modeToggleBtn removed from DOM — mode is now controlled via super-header
        this.el.modeLocalBtn?.addEventListener('click', () => this.switchToLocalMode());
        this.el.modeCloudBtn?.addEventListener('click', () => this.switchToCloudMode());
        this.el.terminalBtn?.addEventListener('click', () => this.toggleTerminalOverlay());
        this.bindSuperHeaderEvents();
        this.el.terminalCloseBtn?.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });
        this.el.terminalCloseBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.closeTerminalOverlay();
        });
        // Delegated fallback keeps close working even if chat DOM nodes are re-rendered.
        document.addEventListener('click', (event) => {
            const closeTarget = event.target?.closest?.('#project-local-terminal-close');
            if (!closeTarget) return;
            event.preventDefault();
            this.closeTerminalOverlay();
        });
        this.el.terminalSendBtn?.addEventListener('click', () => this.sendTerminalCommand());
        this.el.terminalInput?.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.sendTerminalCommand();
            }
        });
        const overlayFocusHandler = (event) => {
            if (!this.terminalVisible) return;
            if (this.isTerminalControlTarget(event?.target)) return;
            this.focusTerminal();
        };
        this.el.terminalOverlay?.addEventListener('mousedown', overlayFocusHandler);
        this.el.terminalOverlay?.addEventListener('click', overlayFocusHandler);
        this.el.terminalShell?.addEventListener('mousedown', overlayFocusHandler);
        this.el.terminalShell?.addEventListener('click', overlayFocusHandler);

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
            if (event.key !== 'Escape') return;
            if (this.terminalVisible) {
                this.closeTerminalOverlay();
                return;
            }
            if (document.body.classList.contains('project-file-preview-active')) {
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

        window.electron?.ipcRenderer?.on?.('local-workspace-changed', (data) => {
            if (data?.conversationId !== this.getConversationId()) return;
            if (this.getExecutionTarget() !== 'local') return;
            const state = this.getState();
            if (this.isDeploymentProjectActive() && String(state?.local_context?.source_type || '') === 'deployment') {
                state.deployment_dirty = true;
                this.updateRedeployUI({
                    visible: true,
                    dirty: true,
                    title: 'Local workspace has unpublished changes',
                    subtitle: 'Re-deploy to publish your latest local edits.',
                });
            }
            if (this.syncDebounceTimer) {
                clearTimeout(this.syncDebounceTimer);
            }
            this.syncDebounceTimer = setTimeout(() => this.syncWorkspaceTree(), 160);
        });

        window.electron?.ipcRenderer?.on?.('project-local-terminal-output', (data) => {
            if (data?.conversationId !== this.getConversationId()) return;
            this.appendTerminalOutput(String(data?.data || ''), String(data?.stream || 'stdout'));
        });

        window.electron?.ipcRenderer?.on?.('project-local-terminal-exit', (data) => {
            if (data?.conversationId !== this.getConversationId()) return;
            const code = Number.isInteger(data?.code) ? data.code : 0;
            this.appendTerminalOutput(`\n[process exited with code ${code}]\n`, 'stdout');
        });
    }

    bindSuperHeaderEvents() {
        // 1. Sidebar toggle — closes the project workspace panel
        this.el.superSidebarBtn?.addEventListener('click', () => {
            this.closePanel();
        });

        // 2. Terminal — toggles the terminal overlay (same as old terminal action btn)
        this.el.superTerminalBtn?.addEventListener('click', () => {
            this.toggleTerminalOverlay();
        });

        // 3. Sync — syncs the workspace file tree (same as old sync action btn)
        this.el.superSyncBtn?.addEventListener('click', () => {
            this.syncWorkspaceTree();
        });

        // 4. Cloud button — directly switches to cloud mode; updates pill active state
        this.el.superCloudBtn?.addEventListener('click', () => {
            this.switchToCloudMode();
            this.updateSuperHeaderModeUI();
        });

        // 5. Local button — directly switches to local mode; updates pill active state
        this.el.superLocalBtn?.addEventListener('click', () => {
            this.switchToLocalMode();
            this.updateSuperHeaderModeUI();
        });

        // 6. GitHub button — toggles the Clone GitHub Repo section in the sidebar
        this.el.superGithubBtn?.addEventListener('click', () => {
            const githubToggle = document.getElementById('project-github-toggle');
            const githubContent = document.getElementById('project-github-content');
            if (!githubContent || !githubToggle) return;

            const isCurrentlyOpen = !githubContent.classList.contains('hidden');
            if (isCurrentlyOpen) {
                githubContent.classList.add('hidden');
                githubToggle.classList.remove('active');
                this.el.superGithubBtn.classList.remove('active');
            } else {
                githubContent.classList.remove('hidden');
                githubToggle.classList.add('active');
                this.el.superGithubBtn.classList.add('active');
                // Scroll the github section into view smoothly
                githubContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }

    updateSuperHeaderModeUI() {
        const mode = this.getExecutionTarget(); // 'cloud' | 'local'
        if (this.el.superCloudBtn) {
            this.el.superCloudBtn.classList.toggle('active', mode === 'cloud');
        }
        if (this.el.superLocalBtn) {
            this.el.superLocalBtn.classList.toggle('active', mode === 'local');
        }
    }

    openPanel() {
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isProjectWorkspaceOpen: true });
        } else {
            this.el.panel?.classList.remove('hidden');
            document.body.classList.add('project-panel-open');
        }
        this.emitWorkspaceStateChange();
    }

    closePanel() {
        this.closeModeWindow();
        this.closeTerminalOverlay();
        this.hideMainFilePreview();
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isProjectWorkspaceOpen: false });
        } else {
            this.el.panel?.classList.add('hidden');
            document.body.classList.remove('project-panel-open');
        }
        this.emitWorkspaceStateChange();
    }

    normalizeProjectContext(project = {}) {
        const source = project && typeof project === 'object' ? project : {};
        return {
            ...source,
            agentMode: 'coder',
            isDedicatedProject: true,
            mode: 'project'
        };
    }

    isModeActive() {
        const ctx = window.projectContext || window.activeProjectContext || this.activeProject || null;
        if (!ctx || typeof ctx !== 'object') {
            return false;
        }
        if (String(ctx.agentMode || '').toLowerCase() === 'coder') {
            return true;
        }
        if (ctx.isDedicatedProject === true) {
            return true;
        }
        if (String(ctx.mode || '').toLowerCase() === 'project') {
            return true;
        }
        return false;
    }

    ensureContext(project = {}, options = {}) {
        const { syncUi = false } = options;
        const current =
            this.activeProject && typeof this.activeProject === 'object'
                ? this.activeProject
                : (window.projectContext && typeof window.projectContext === 'object' ? window.projectContext : {});

        this.activeProject = this.normalizeProjectContext({
            ...current,
            ...(project && typeof project === 'object' ? project : {})
        });

        window.projectContext = this.activeProject;
        window.activeProjectContext = this.activeProject;

        // Keep modes mutually exclusive even when project workspace is opened from sidebar icon.
        window.computerContext = null;
        if (window.computerWorkspace) {
            window.computerWorkspace.activeContext = null;
        }
        if (window.stateManager?.getState && window.stateManager?.setState) {
            const state = window.stateManager.getState();
            if (state?.isComputerWorkspaceOpen) {
                window.stateManager.setState({ isComputerWorkspaceOpen: false });
            }
        }

        if (syncUi && this.el) {
            const label = this.activeProject?.project_name || this.activeProject?.slug || 'Project Workspace';
            const sub = this.activeProject?.hostname
                || this.activeProject?.repo_url
                || this.activeProject?.local_root_path
                || 'Dedicated coding mode';
            if (this.el.title) this.el.title.textContent = label;
            if (this.el.subtitle) this.el.subtitle.textContent = sub;
        }

        const state = this.getState();
        if (this.activeProject.repo_url) {
            state.repo_url = this.activeProject.repo_url;
            state.local_context.repo_url = this.activeProject.repo_url;
        }
        if (this.activeProject.branch) {
            state.branch = this.activeProject.branch;
            state.local_context.branch = this.activeProject.branch;
        }
        if (this.activeProject.site_id) {
            state.cloud_context.site_id = this.activeProject.site_id;
            state.cloud_context.deployment_id = this.activeProject.deployment_id || null;
            state.cloud_context.is_ready = true;
        }

        this.updateModeUI();
        this.emitWorkspaceStateChange();

        return this.activeProject;
    }

    getProjectContextKey(project = this.activeProject) {
        if (!project || typeof project !== 'object') {
            return null;
        }
        const siteId = String(project.site_id || '').trim();
        const deploymentId = String(project.deployment_id || '').trim();
        if (!siteId && !deploymentId) {
            return null;
        }
        return `${siteId}::${deploymentId}`;
    }

    formatProjectBootstrapContext(paths = []) {
        if (!this.activeProject) {
            return '';
        }

        const project = this.activeProject;
        const hostname = String(project.hostname || '').trim();
        const lines = [
            'PROJECT WORKSPACE CONTEXT',
            'The user is working inside a dedicated project workspace.',
            `Project Name: ${project.project_name || 'Untitled Project'}`,
            `Hostname: ${hostname || 'Unavailable'}`,
            `Slug: ${project.slug || 'Unavailable'}`,
            `Version: ${project.version || 'Unavailable'}`,
            `Site ID: ${project.site_id || 'Unavailable'}`,
            `Deployment ID: ${project.deployment_id || 'Unavailable'}`,
            `R2 Prefix: ${project.r2_prefix || 'Unavailable'}`,
            `URL: ${hostname ? `https://${hostname}` : 'Unavailable'}`,
            `Workspace Source: ${this.currentTreeSource || 'unknown'}`,
            `File Count: ${Array.isArray(paths) ? paths.length : 0}`,
            'File Structure:',
        ];

        const normalizedPaths = Array.isArray(paths)
            ? paths.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const shown = normalizedPaths.slice(0, 120);
        if (shown.length === 0) {
            lines.push('- File structure unavailable');
        } else {
            shown.forEach((item) => lines.push(`- ${item}`));
            if (normalizedPaths.length > shown.length) {
                lines.push(`... ${normalizedPaths.length - shown.length} more files omitted`);
            }
        }

        return `${lines.join('\n')}\n`;
    }

    buildBootstrapContextForTurn(userMessage = '') {
        const state = this.getState();
        if (!state || !this.activeProject) {
            return null;
        }

        const projectKey = this.getProjectContextKey();
        if (!projectKey) {
            return null;
        }

        if (state.bootstrap_context_sent && state.bootstrap_context_key === projectKey) {
            return null;
        }

        const contextBlock = this.formatProjectBootstrapContext(this.latestSyncedPaths);
        const userText = String(userMessage || '').trim() || '(No additional user input provided.)';
        return `${contextBlock}\nUSER MESSAGE:\n${userText}`;
    }

    markBootstrapContextSent() {
        const state = this.getState();
        if (!state) return;
        state.bootstrap_context_sent = true;
        state.bootstrap_context_key = this.getProjectContextKey();
    }

    async openProject(project) {
        this.ensureContext(project, { syncUi: true });
        const state = this.getState();
        state.workspace_mode = 'cloud';
        state.bootstrap_context_sent = false;
        state.bootstrap_context_key = this.getProjectContextKey();
        this.updateModeUI();

        this.setStatus('Project mode active. Cloud mode enabled by default.');
        this.setPreviewPlaceholder('Click a file to view its content.');
        this.hideMainFilePreview();
        this.updateRedeployUI({ visible: false, dirty: false });

        this.openPanel();
        this.closeModeWindow();
        this.closeTerminalOverlay();
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

    updateModeUI() {
        const mode = this.getExecutionTarget();
        if (this.el.modeCurrentLabel) {
            this.el.modeCurrentLabel.textContent = mode === 'local' ? 'Local Mode' : 'Cloud Mode';
        }
        if (this.el.modeWindowCurrent) {
            this.el.modeWindowCurrent.textContent = `Current: ${mode === 'local' ? 'Local' : 'Cloud'}`;
        }
        if (this.el.modeLocalBtn) {
            this.el.modeLocalBtn.classList.toggle('active', mode === 'local');
        }
        if (this.el.modeCloudBtn) {
            this.el.modeCloudBtn.classList.toggle('active', mode === 'cloud');
        }
        // Keep super-header pills in sync from every code path
        this.updateSuperHeaderModeUI();
        this.emitWorkspaceStateChange();
    }

    toggleModeWindow() {
        if (!this.el.modeWindow) return;
        this.el.modeWindow.classList.toggle('hidden');
        this.updateModeUI();
    }

    closeModeWindow() {
        this.el.modeWindow?.classList.add('hidden');
    }

    async callLocalInvoke(channel, payload = {}) {
        if (!window.electron?.ipcRenderer?.invoke) {
            return { success: false, error: 'Desktop local bridge is unavailable.' };
        }
        return window.electron.ipcRenderer.invoke(channel, payload);
    }

    getTerminalConstructors() {
        const terminalModule = window.Terminal;
        const fitModule = window.FitAddon;

        const TerminalCtor =
            (terminalModule && terminalModule.Terminal)
            || terminalModule
            || null;
        const FitAddonCtor =
            (fitModule && fitModule.FitAddon)
            || fitModule
            || null;

        if (typeof TerminalCtor !== 'function' || typeof FitAddonCtor !== 'function') {
            return { ok: false, error: 'xterm runtime is not loaded yet.' };
        }
        return { ok: true, TerminalCtor, FitAddonCtor };
    }

    clearTerminalSurface() {
        if (this.terminal) {
            this.terminal.reset();
        } else if (this.el.terminalOutput) {
            this.el.terminalOutput.textContent = '';
        }
    }

    setTerminalPresentationMode(mode = 'pty') {
        this.terminalSessionMode = mode;
        const fallbackInputRow = this.el.terminalInput?.closest('.project-local-terminal-input-row');
        if (mode === 'pty') {
            this.el.terminalShell?.classList.remove('hidden');
            this.el.terminalShell?.setAttribute('aria-hidden', 'false');
            this.el.terminalOutput?.classList.add('hidden');
            this.el.terminalOutput?.setAttribute('aria-hidden', 'true');
            fallbackInputRow?.classList.add('hidden');
            fallbackInputRow?.setAttribute('aria-hidden', 'true');
            return;
        }

        // Spawn fallback (no PTY) keeps classic line-input mode for reliability.
        this.el.terminalShell?.classList.add('hidden');
        this.el.terminalShell?.setAttribute('aria-hidden', 'true');
        this.el.terminalOutput?.classList.remove('hidden');
        this.el.terminalOutput?.setAttribute('aria-hidden', 'false');
        fallbackInputRow?.classList.remove('hidden');
        fallbackInputRow?.setAttribute('aria-hidden', 'false');
    }

    async ensureTerminalClientReady() {
        if (this.terminalReady && this.terminal) return true;
        if (!this.el.terminalShell) return false;

        const constructors = this.getTerminalConstructors();
        if (!constructors.ok) {
            this.setTerminalPresentationMode('spawn');
            this.setStatus('Using basic terminal fallback mode.');
            return true;
        }

        const { TerminalCtor, FitAddonCtor } = constructors;
        this.setTerminalPresentationMode('pty');
        this.terminal = new TerminalCtor({
            cursorBlink: true,
            fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.35,
            scrollback: 5000,
            convertEol: false,
            allowProposedApi: false,
            theme: {
                background: '#030303',
                foreground: '#e0e0e0',
                cursor: '#ffffff',
                cursorAccent: '#030303',
                selectionBackground: 'rgba(255, 255, 255, 0.12)',
                black: '#1a1a1a',
                red: '#ff6b6b',
                green: '#51cf66',
                yellow: '#ffd93d',
                blue: '#74c0fc',
                magenta: '#da77f2',
                cyan: '#4dabf7',
                white: '#e0e0e0',
                brightBlack: '#404040',
                brightRed: '#ff8787',
                brightGreen: '#69db7c',
                brightYellow: '#ffe066',
                brightBlue: '#91d7ff',
                brightMagenta: '#e599f7',
                brightCyan: '#66d9ef',
                brightWhite: '#ffffff',
            },
        });

        this.terminalFitAddon = new FitAddonCtor();
        this.terminal.loadAddon(this.terminalFitAddon);
        this.terminal.open(this.el.terminalShell);
        this.terminalFitAddon.fit();

        this.terminal.onData((data) => {
            this.sendTerminalData(data);
        });

        this.terminal.onResize(({ cols, rows }) => {
            this.notifyTerminalResize(cols, rows);
        });

        if (this.terminalResizeObserver) {
            this.terminalResizeObserver.disconnect();
        }
        this.terminalResizeObserver = new ResizeObserver(() => {
            this.fitTerminal();
        });
        this.terminalResizeObserver.observe(this.el.terminalShell);

        this.terminalReady = true;
        return true;
    }

    fitTerminal() {
        if (!this.terminalReady || !this.terminalFitAddon || !this.terminal) return;
        if (this.terminalResizeTimer) {
            clearTimeout(this.terminalResizeTimer);
        }
        this.terminalResizeTimer = setTimeout(() => {
            if (!this.terminalReady || !this.terminalFitAddon || !this.terminalVisible) return;
            this.terminalFitAddon.fit();
            this.notifyTerminalResize(this.terminal.cols, this.terminal.rows);
        }, 80);
    }

    async notifyTerminalResize(cols, rows) {
        const conversationId = this.getConversationId();
        if (!conversationId) return;
        await this.callLocalInvoke('project-local-terminal-resize', {
            conversationId,
            cols,
            rows,
        });
    }

    async sendTerminalData(data) {
        if (this.getExecutionTarget() !== 'local') return;
        const conversationId = await this.ensureConversationId();
        if (!conversationId) return;
        return this.callLocalInvoke('project-local-terminal-send', {
            conversationId,
            data,
        });
    }

    isTerminalControlTarget(target) {
        if (!target || typeof target.closest !== 'function') return false;
        return Boolean(
            target.closest('button')
            || target.closest('input')
            || target.closest('textarea')
            || target.closest('a')
            || target.closest('[contenteditable="true"]')
        );
    }

    focusTerminal() {
        if (!this.terminalVisible) return;
        if (this.terminalSessionMode === 'pty' && this.terminal && typeof this.terminal.focus === 'function') {
            this.terminal.focus();
            return;
        }
        this.el.terminalInput?.focus();
    }

    disposeTerminalClient() {
        if (this.terminalResizeObserver) {
            this.terminalResizeObserver.disconnect();
            this.terminalResizeObserver = null;
        }
        if (this.terminalResizeTimer) {
            clearTimeout(this.terminalResizeTimer);
            this.terminalResizeTimer = null;
        }
        if (this.terminal) {
            try {
                this.terminal.dispose();
            } catch (_error) {
                // no-op
            }
        }
        this.terminal = null;
        this.terminalFitAddon = null;
        this.terminalReady = false;
        this.terminalSessionMode = null;
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
            const path = String(rawPath || '').trim().replace(/\\/g, '/');
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
                const isDir = item.dir;
                const pathSvg = isDir
                    ? '<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-1.2-1.8A2 2 0 0 0 7.55 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg>'
                    : '<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

                row.innerHTML = `
                    ${pathSvg}
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

            const mode = this.getExecutionTarget();
            let paths = [];
            let source = null;

            if (mode === 'local') {
                const conversationId = await this.ensureConversationId();
                const state = this.getState(conversationId);
                const rootPath = state?.local_context?.root_path;

                if (!state?.local_context?.is_ready || !rootPath) {
                    this.updateRedeployUI({ visible: false, dirty: false });
                    this.el.tree.innerHTML = '<div class="project-workspace-status">No local workspace selected.</div>';
                    this.currentTreeSource = null;
                    this.setPreviewPlaceholder('Select Local mode and choose a folder.');
                    this.setStatus('Select a local folder or clone a repository first.');
                    this.hideMainFilePreview();
                    return;
                }

                const localTree = await this.callLocalInvoke('project-local-tree', {
                    conversationId,
                    rootPath,
                });
                if (!localTree?.success) {
                    throw new Error(localTree?.error || 'Failed to read local workspace tree');
                }

                paths = (Array.isArray(localTree?.files) ? localTree.files : [])
                    .map((file) => file?.path)
                    .filter(Boolean);
                source = 'local';
            } else {
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

                const conversationId = this.getConversationId();
                if (conversationId) {
                    const workspacePayload = await this.callApi('/api/project/workspace/tree', 'POST', {
                        conversation_id: conversationId
                    });
                    const workspaceFiles = Array.isArray(workspacePayload?.files) ? workspacePayload.files : [];
                    const workspacePaths = workspaceFiles.map((f) => f.path).filter(Boolean);
                    const deploymentPathCount = Array.isArray(paths) ? paths.length : 0;
                    const hasWorkspaceIndex = workspacePaths.some((item) => String(item).toLowerCase() === 'index.html');
                    const shouldPreferWorkspace =
                        deploymentPathCount === 0
                        || workspacePaths.length >= deploymentPathCount
                        || hasWorkspaceIndex;

                    if (workspacePaths.length > 0 && shouldPreferWorkspace) {
                        paths = workspacePaths;
                        source = 'workspace';
                    }
                }
            }

            if (!paths.length) {
                if (mode === 'local') {
                    this.updateRedeployUI({ visible: false, dirty: false });
                }
                this.latestSyncedPaths = [];
                this.el.tree.innerHTML = '<div class="project-workspace-status">No files found yet.</div>';
                this.setStatus(mode === 'local'
                    ? 'No local files found in selected folder.'
                    : 'No files found. Clone repo or run project sync.');
                this.currentTreeSource = mode === 'local' ? 'local' : null;
                this.setPreviewPlaceholder('Click a file to view its content.');
                this.hideMainFilePreview();
                return;
            }

            this.currentTreeSource = source || (mode === 'local' ? 'local' : 'workspace');
            this.latestSyncedPaths = [...paths];
            this.selectedFilePath = null;
            this.renderTreeFromPaths(paths);
            this.setPreviewPlaceholder(`Loaded ${paths.length} files. Click a file to preview.`);
            this.setStatus(`Loaded ${paths.length} file${paths.length === 1 ? '' : 's'} from ${this.currentTreeSource}.`);
            await this.refreshDeploymentModificationStatus();
        } catch (error) {
            this.latestSyncedPaths = [];
            this.setStatus(`Sync failed: ${error.message}`);
            this.updateRedeployUI({
                visible: this.getExecutionTarget() === 'cloud' && Boolean(this.activeProject?.site_id),
                dirty: false,
                title: 'Workspace sync failed',
                subtitle: error.message || 'Unable to inspect workspace changes.',
            });
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

    updateRedeployUI(options = {}) {
        const {
            visible = false,
            dirty = false,
            title = null,
            subtitle = null,
            busy = false,
        } = options;

        if (this.el.redeployBar) {
            this.el.redeployBar.classList.toggle('hidden', !visible);
        }
        if (this.el.redeployTitle && title !== null) {
            this.el.redeployTitle.textContent = title;
        }
        if (this.el.redeploySubtitle && subtitle !== null) {
            this.el.redeploySubtitle.textContent = subtitle;
        }
        if (this.el.redeployBtn) {
            this.el.redeployBtn.classList.toggle('hidden', !visible || !dirty);
            this.el.redeployBtn.disabled = Boolean(busy);
        }
    }

    getDirtySummaryLine(summary = null) {
        const diff = summary && typeof summary === 'object' ? summary : {};
        const newCount = Array.isArray(diff.new_files) ? diff.new_files.length : 0;
        const changedCount = Array.isArray(diff.changed_files) ? diff.changed_files.length : 0;
        const deletedCount = Array.isArray(diff.deleted_files) ? diff.deleted_files.length : 0;
        const parts = [];
        if (changedCount) parts.push(`${changedCount} changed`);
        if (newCount) parts.push(`${newCount} new`);
        if (deletedCount) parts.push(`${deletedCount} removed`);
        return parts.length ? parts.join(', ') : 'Workspace differs from selected deployment.';
    }

    bytesToBase64(bytesLike) {
        const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike || []);
        const chunkSize = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
        }
        return btoa(binary);
    }

    async collectLocalWorkspaceDeployFiles(rootPath) {
        const normalizedRoot = String(rootPath || '').trim();
        if (!normalizedRoot) {
            throw new Error('Local workspace root is unavailable.');
        }

        const walk = async (currentPath, prefix = '') => {
            const entries = await window.electron.fs.promises.readdir(currentPath);
            const files = [];

            for (const entry of entries) {
                const name = String(entry || '').trim();
                if (!name) continue;
                if (name === '.git' || name === 'node_modules') continue;

                const fullPath = window.electron.path.join(currentPath, name);
                const relPath = prefix ? `${prefix}/${name}` : name;
                const stats = await window.electron.fs.promises.stat(fullPath);

                if (stats?.isDirectory?.()) {
                    const nested = await walk(fullPath, relPath);
                    files.push(...nested);
                    continue;
                }

                const bytes = await window.electron.fs.promises.readFile(fullPath);
                files.push({
                    path: relPath.replace(/\\/g, '/'),
                    content_base64: this.bytesToBase64(bytes),
                });
            }

            return files;
        };

        return walk(normalizedRoot, '');
    }

    async refreshDeploymentModificationStatus() {
        const state = this.getState();
        const mode = this.getExecutionTarget();
        const conversationId = this.getConversationId();
        const siteId = String(this.activeProject?.site_id || '').trim();
        const deploymentId = String(this.activeProject?.deployment_id || '').trim();

        if (this.activeProject && mode === 'local' && siteId && deploymentId && String(state?.local_context?.source_type || '') === 'deployment') {
            const dirty = Boolean(state?.deployment_dirty);
            this.updateRedeployUI({
                visible: true,
                dirty,
                title: dirty ? 'Local workspace has unpublished changes' : 'Local workspace matches selected deployment',
                subtitle: dirty
                    ? 'Re-deploy to publish your latest local edits.'
                    : 'Edit local files or use Design mode to enable re-deploy.',
            });
            return;
        }

        if (!this.activeProject || mode !== 'cloud' || !conversationId || !siteId || !deploymentId) {
            if (state) {
                state.deployment_dirty = false;
                state.deployment_diff_summary = null;
            }
            this.updateRedeployUI({ visible: false, dirty: false });
            return;
        }

        this.updateRedeployUI({
            visible: true,
            dirty: false,
            title: 'Checking workspace changes...',
            subtitle: 'Comparing sandbox files with the selected deployment version.',
        });

        try {
            const payload = await this.callApi('/api/project/workspace/deployment-status', 'POST', {
                conversation_id: conversationId,
                site_id: siteId,
                deployment_id: deploymentId,
            });

            const dirty = Boolean(payload?.modified);
            const summary = payload?.summary || null;
            if (state) {
                state.deployment_dirty = dirty;
                state.deployment_diff_summary = summary;
            }

            if (dirty) {
                this.updateRedeployUI({
                    visible: true,
                    dirty: true,
                    title: 'Workspace has unpublished changes',
                    subtitle: this.getDirtySummaryLine(summary),
                });
                return;
            }

            this.updateRedeployUI({
                visible: true,
                dirty: false,
                title: 'Workspace matches selected deployment',
                subtitle: 'The re-deploy button will appear after sandbox changes are detected.',
            });
        } catch (error) {
            if (state) {
                state.deployment_dirty = false;
                state.deployment_diff_summary = null;
            }
            this.updateRedeployUI({
                visible: true,
                dirty: false,
                title: 'Could not verify deploy status',
                subtitle: error.message || 'Workspace comparison failed.',
            });
        }
    }

    async redeployCurrentWorkspace() {
        const siteId = String(this.activeProject?.site_id || '').trim();
        if (!siteId) {
            this.setStatus('Cannot redeploy: project context is incomplete.');
            return;
        }

        const mode = this.getExecutionTarget();
        this.updateRedeployUI({
            visible: true,
            dirty: true,
            busy: true,
            title: 'Re-deploying workspace...',
            subtitle: 'Uploading sandbox files and activating a new deployment version.',
        });

        try {
            let payload = null;

            if (mode === 'local') {
                const localRoot = String(this.getState()?.local_context?.root_path || '').trim();
                const files = await this.collectLocalWorkspaceDeployFiles(localRoot);
                if (!files.length) {
                    throw new Error('No deployable local files were found.');
                }
                if (!files.some((item) => String(item.path || '').toLowerCase() === 'index.html')) {
                    throw new Error('Deployment must include index.html.');
                }

                const upload = await this.callApi('/api/deploy/upload-site', 'POST', {
                    site_id: siteId,
                    files,
                });
                const activation = await this.callApi('/api/deploy/activate', 'POST', {
                    site_id: siteId,
                    deployment_id: upload?.deployment_id,
                });
                payload = {
                    ...upload,
                    ...activation,
                    deployment_status: 'active',
                };
            } else {
                const conversationId = this.getConversationId();
                if (!conversationId) {
                    throw new Error('Conversation is required for cloud redeploy.');
                }
                payload = await this.callApi('/api/project/workspace/redeploy', 'POST', {
                    conversation_id: conversationId,
                    site_id: siteId,
                });
            }

            this.ensureContext({
                deployment_id: payload?.deployment_id || this.activeProject?.deployment_id,
                version: payload?.version || this.activeProject?.version,
                r2_prefix: payload?.r2_prefix || this.activeProject?.r2_prefix,
                hostname: payload?.hostname || this.activeProject?.hostname,
            }, { syncUi: true });

            const state = this.getState();
            if (state?.cloud_context) {
                state.cloud_context.site_id = siteId;
                state.cloud_context.deployment_id = payload?.deployment_id || state.cloud_context.deployment_id;
            }
            if (state?.local_context && mode === 'local' && String(state.local_context.source_type || '') === 'deployment') {
                state.local_context.source_deployment_id = payload?.deployment_id || state.local_context.source_deployment_id;
            }
            state.deployment_dirty = false;
            state.deployment_diff_summary = null;

            this.setStatus(`Re-deployed ${payload?.files_uploaded || 0} file${payload?.files_uploaded === 1 ? '' : 's'} as v${payload?.version || '?'}.`);
            await this.syncWorkspaceTree();
            this.updateRedeployUI({
                visible: true,
                dirty: false,
                busy: false,
                title: 'Workspace matches selected deployment',
                subtitle: `Published as v${payload?.version || '?'}.`,
            });

            if (window.AIOS?.loadDeployments) {
                window.AIOS.loadDeployments(false, { force: true });
            }
        } catch (error) {
            this.updateRedeployUI({
                visible: true,
                dirty: true,
                busy: false,
                title: 'Re-deploy failed',
                subtitle: error.message || 'Unable to publish workspace changes.',
            });
            this.setStatus(`Re-deploy failed: ${error.message}`);
        }
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
            if (this.currentTreeSource === 'local' || this.getExecutionTarget() === 'local') {
                const conversationId = await this.ensureConversationId();
                const state = this.getState(conversationId);
                const rootPath = state?.local_context?.root_path;
                if (!rootPath) {
                    throw new Error('No local workspace selected');
                }

                payload = await this.callLocalInvoke('project-local-file-content', {
                    conversationId,
                    rootPath,
                    path: String(path),
                });
                if (!payload?.success) {
                    throw new Error(payload?.error || 'Failed to read local file');
                }
            } else if (this.currentTreeSource === 'deployment' && this.activeProject?.site_id) {
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
        } else {
            await this.ensureConversationId();
        }

        input.value = message;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sendBtn.click();
    }

    async startCoderChat() {
        this.ensureContext({}, { syncUi: true });

        if (this.getExecutionTarget() === 'local') {
            const state = this.getState();
            if (!state?.local_context?.is_ready || !state?.local_context?.root_path) {
                const selected = await this.openLocalFolderSelectionFlow();
                if (!selected) return;
            }
        }

        const mode = this.getExecutionTarget();
        const localRoot = this.getState()?.local_context?.root_path;
        const intro = mode === 'local'
            ? `You are in dedicated project mode using LOCAL workspace at ${localRoot}. Inspect files, summarize tree, and wait for my next coding instruction.`
            : (this.activeProject?.site_id
                ? `You are in dedicated project mode. Inspect deployed project ${this.activeProject.slug || this.activeProject.site_id}, copy it to cloud workspace, show file tree, and wait for my next coding instruction.`
                : 'You are in dedicated coding mode. Inspect cloud workspace, summarize file tree, and wait for my coding instruction.');

        await this.sendMessageToChat(intro, true);
        this.setStatus(`Started dedicated coder chat (${mode} mode).`);
    }

    isValidRepoUrl(repoUrl) {
        return /^https?:\/\/|^git@/i.test(String(repoUrl || '').trim());
    }

    formatLocalCloneError(rawError) {
        const text = String(rawError || '').trim();
        const lower = text.toLowerCase();

        if (lower.includes('not recognized as an internal or external command') || lower.includes('enoent')) {
            return 'Clone failed: Git is not installed or not available in PATH.';
        }
        if (lower.includes('authentication failed') || lower.includes('could not read username') || lower.includes('permission denied (publickey)')) {
            return 'Clone failed: authentication denied. Check repo permissions or credentials.';
        }
        if (lower.includes('remote branch') && lower.includes('not found')) {
            return 'Clone failed: branch not found. Verify the branch name.';
        }
        if (lower.includes('access is denied') || lower.includes('eacces') || lower.includes('operation not permitted')) {
            return 'Clone failed: selected folder is not writable.';
        }

        return `Clone failed: ${text || 'Unknown error.'}`;
    }

    deriveRepoNameFromPath(localPath) {
        const fromPreload = window.electron?.path?.basename?.(localPath);
        if (fromPreload) return fromPreload;
        const normalized = String(localPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
        return normalized.split('/').pop() || 'workspace';
    }

    isDeploymentProjectActive(project = this.activeProject) {
        return Boolean(String(project?.site_id || '').trim());
    }

    getLocalDeploymentMetadata(project = this.activeProject) {
        return {
            source_type: this.isDeploymentProjectActive(project) ? 'deployment' : null,
            source_site_id: String(project?.site_id || '').trim() || null,
            source_deployment_id: String(project?.deployment_id || '').trim() || null,
            source_project_name: String(project?.project_name || project?.slug || '').trim() || null,
        };
    }

    doesLocalContextMatchActiveProject(state = this.getState()) {
        if (!this.isDeploymentProjectActive()) {
            return Boolean(state?.local_context?.is_ready && state?.local_context?.root_path);
        }
        const local = state?.local_context || {};
        return Boolean(
            local?.is_ready
            && local?.root_path
            && String(local?.source_type || '') === 'deployment'
            && String(local?.source_site_id || '') === String(this.activeProject?.site_id || '')
            && String(local?.source_deployment_id || '') === String(this.activeProject?.deployment_id || '')
        );
    }

    async fetchDeploymentFilesForLocalImport() {
        const siteId = String(this.activeProject?.site_id || '').trim();
        if (!siteId) {
            throw new Error('No deployed project is active.');
        }

        const query = new URLSearchParams({
            site_id: siteId,
            ...(this.activeProject?.deployment_id
                ? { deployment_id: String(this.activeProject.deployment_id) }
                : {})
        });
        const listing = await this.callApi(`/api/deploy/files?${query.toString()}`, 'GET');
        const files = Array.isArray(listing?.files) ? listing.files : [];
        if (!files.length) {
            throw new Error('No files were found in the selected deployment.');
        }

        const importedFiles = [];
        const batchSize = 4;

        for (let index = 0; index < files.length; index += batchSize) {
            const batch = files.slice(index, index + batchSize);
            const resolvedBatch = await Promise.all(batch.map(async (file) => {
                const fileQuery = new URLSearchParams({
                    site_id: siteId,
                    path: String(file?.path || ''),
                    include_base64: '1',
                    ...(this.activeProject?.deployment_id
                        ? { deployment_id: String(this.activeProject.deployment_id) }
                        : {})
                });
                const payload = await this.callApi(`/api/deploy/file-content?${fileQuery.toString()}`, 'GET');
                return {
                    path: String(file?.path || ''),
                    content_base64: payload?.content_base64 || null,
                    content: typeof payload?.content === 'string' ? payload.content : null,
                };
            }));

            importedFiles.push(...resolvedBatch);
            this.setStatus(`Downloading deployment files for local mode... ${Math.min(index + batch.length, files.length)}/${files.length}`);
        }

        return importedFiles;
    }

    async bootstrapActiveDeploymentToLocal(conversationId) {
        const importedFiles = await this.fetchDeploymentFilesForLocalImport();
        const result = await this.callLocalInvoke('project-local-import-files', {
            conversationId,
            projectName: this.activeProject?.project_name || this.activeProject?.slug || 'workspace',
            files: importedFiles,
            branch: this.getState(conversationId)?.branch || 'main',
            metadata: {
                ...this.getLocalDeploymentMetadata(),
                slug: this.activeProject?.slug || null,
                hostname: this.activeProject?.hostname || null,
                project_name: this.activeProject?.project_name || null,
            },
        });

        if (result?.canceled) {
            return { success: false, canceled: true };
        }
        if (!result?.success) {
            return {
                success: false,
                error: result?.error || 'Failed to create local workspace from deployment.',
            };
        }

        const state = this.getState(conversationId);
        state.workspace_mode = 'local';
        state.local_context = {
            root_path: result.root_path,
            repo_url: state.repo_url || null,
            branch: state.branch || 'main',
            repo_name: result.repo_name || this.deriveRepoNameFromPath(result.root_path),
            is_ready: true,
            ...this.getLocalDeploymentMetadata(),
        };

        this.ensureContext({ local_root_path: result.root_path }, { syncUi: true });
        await this.persistLocalContext(conversationId, state.local_context);
        await this.startLocalWatcher(conversationId, result.root_path);
        this.updateModeUI();
        this.updateRedeployUI({ visible: false, dirty: false });
        this.setStatus(`Local workspace created from deployment: ${result.repo_name || this.activeProject?.project_name || 'project'}`);
        await this.syncWorkspaceTree();

        return { success: true, root_path: result.root_path };
    }

    async persistLocalContext(conversationId, context) {
        if (!conversationId) return;
        await this.callLocalInvoke('project-local-set-context', {
            conversationId,
            context,
        });
    }

    async startLocalWatcher(conversationId, rootPath) {
        if (!conversationId || !rootPath) return;
        await this.callLocalInvoke('project-watch-local-workspace', {
            conversationId,
            rootPath,
        });
    }

    async stopLocalWatcher(conversationId) {
        if (!conversationId) return;
        await this.callLocalInvoke('project-unwatch-local-workspace', {
            conversationId,
        });
    }

    async switchToLocalMode() {
        this.closeModeWindow();

        const conversationId = await this.ensureConversationId();
        if (!conversationId) {
            this.setStatus('Unable to switch mode: conversation is not ready yet.');
            return;
        }

        const state = this.getState(conversationId);
        if (state.workspace_mode === 'local' && this.doesLocalContextMatchActiveProject(state)) {
            this.updateRedeployUI({ visible: false, dirty: false });
            this.setStatus('Already in local mode.');
            await this.syncWorkspaceTree();
            return;
        }

        if (!this.isDeploymentProjectActive() && state.local_context?.is_ready && state.local_context?.root_path) {
            state.workspace_mode = 'local';
            this.updateModeUI();
            this.updateRedeployUI({ visible: false, dirty: false });
            await this.startLocalWatcher(conversationId, state.local_context.root_path);
            this.setStatus(`Local mode active (${state.local_context.root_path}).`);
            await this.syncWorkspaceTree();
            return;
        }

        if (this.isDeploymentProjectActive()) {
            this.setStatus('Preparing a local editable copy of this deployed project...');
            const imported = await this.bootstrapActiveDeploymentToLocal(conversationId);
            if (!imported?.success && !imported?.canceled) {
                this.setStatus(imported?.error || 'Failed to switch deployed project to local mode.');
            } else if (imported?.canceled) {
                this.setStatus('Stayed in cloud mode. Local deployment import cancelled.');
            }
            return;
        }

        const selected = await this.openLocalFolderSelectionFlow();
        if (!selected) {
            this.setStatus('Stayed in cloud mode. Local folder selection cancelled.');
        }
    }

    async switchToCloudMode() {
        this.closeModeWindow();

        const conversationId = await this.ensureConversationId();
        const state = this.getState(conversationId);

        if (state.workspace_mode === 'cloud') {
            this.setStatus('Already in cloud mode.');
            await this.refreshDeploymentModificationStatus();
            return;
        }

        const repoUrl = state.repo_url || state.local_context?.repo_url || this.activeProject?.repo_url || null;
        const branch = state.branch || state.local_context?.branch || 'main';
        const proceed = window.confirm(
            'Switch to cloud mode now? This will ask Aetheria Coder to clone this repository into cloud sandbox.'
        );
        if (!proceed) {
            this.setStatus('Switch to cloud mode cancelled.');
            return;
        }

        state.workspace_mode = 'cloud';
        this.updateModeUI();
        this.closeTerminalOverlay();
        this.setStatus('Cloud mode active.');

        await this.syncWorkspaceTree();

        if (repoUrl) {
            await this.sendCloudClonePrompt(repoUrl, branch, { startNewConversation: false });
        }
    }

    async sendCloudClonePrompt(repoUrl, branch = 'main', options = {}) {
        const { startNewConversation = false } = options;
        const safeRepo = String(repoUrl || '').trim();
        if (!safeRepo) return;

        const safeBranch = String(branch || 'main').trim() || 'main';
        const cloneInstruction =
            `In dedicated coder mode (cloud workspace): clone repository ${safeRepo} (branch ${safeBranch}) `
            + 'into /home/sandboxuser/workspace, then list the project tree and prepare for edits.';

        await this.sendMessageToChat(cloneInstruction, startNewConversation);
        this.setStatus('Cloud clone request sent to dedicated coder via prompt.');
    }

    async openLocalFolderSelectionFlow() {
        const conversationId = await this.ensureConversationId();
        if (!conversationId) {
            this.setStatus('Unable to open local folder picker without active conversation.');
            return false;
        }

        const selection = await this.callLocalInvoke('project-select-local-workspace');
        if (!selection?.success) {
            if (!selection?.canceled) {
                this.setStatus(selection?.error || 'Failed to select local folder.');
            }
            return false;
        }

        const selectedPath = String(selection.selectedPath || '').trim();
        if (!selectedPath) {
            this.setStatus('No folder selected.');
            return false;
        }

        const state = this.getState(conversationId);
        const repoName = this.deriveRepoNameFromPath(selectedPath);
        state.local_context = {
            root_path: selectedPath,
            repo_url: state.repo_url || null,
            branch: state.branch || 'main',
            repo_name: repoName,
            is_ready: true,
            source_type: null,
            source_site_id: null,
            source_deployment_id: null,
            source_project_name: null,
        };
        state.workspace_mode = 'local';

        this.ensureContext({ local_root_path: selectedPath }, { syncUi: true });
        await this.persistLocalContext(conversationId, state.local_context);
        await this.startLocalWatcher(conversationId, selectedPath);

        this.updateModeUI();
        this.setStatus(`Local mode active. Workspace: ${selectedPath}`);
        await this.syncWorkspaceTree();
        return true;
    }

    async cloneGithubRepo() {
        const repoUrl = (this.el.repoUrlInput?.value || '').trim();
        const branch = (this.el.repoBranchInput?.value || '').trim() || 'main';
        if (!repoUrl) {
            this.setStatus('Enter a GitHub repo URL first.');
            return;
        }
        if (!this.isValidRepoUrl(repoUrl)) {
            this.setStatus('Enter a valid repository URL (https://... or git@...).');
            return;
        }

        this.ensureContext(
            {
                repo_url: repoUrl,
                branch,
                source: 'github'
            },
            { syncUi: true }
        );

        const conversationId = await this.ensureConversationId();
        if (!conversationId) {
            this.setStatus('Cannot clone yet: conversation is not initialized.');
            return;
        }

        this.setStatus('Cloning repository locally...');
        const result = await this.callLocalInvoke('project-local-clone-repo', {
            conversationId,
            repoUrl,
            branch,
        });

        if (result?.canceled) {
            this.setStatus('Clone cancelled.');
            return;
        }

        if (!result?.success) {
            this.setStatus(this.formatLocalCloneError(result?.error));
            return;
        }

        const state = this.getState(conversationId);
        state.repo_url = repoUrl;
        state.branch = branch;
        state.workspace_mode = 'local';
        state.local_context = {
            root_path: result.root_path,
            repo_url: repoUrl,
            branch,
            repo_name: result.repo_name || this.deriveRepoNameFromPath(result.root_path),
            is_ready: true,
            source_type: null,
            source_site_id: null,
            source_deployment_id: null,
            source_project_name: null,
        };

        this.ensureContext(
            {
                repo_url: repoUrl,
                branch,
                local_root_path: result.root_path,
            },
            { syncUi: true }
        );

        await this.persistLocalContext(conversationId, state.local_context);
        await this.startLocalWatcher(conversationId, result.root_path);

        this.updateModeUI();
        this.closeModeWindow();
        this.setStatus(`Local clone complete: ${result.repo_name || repoUrl}`);
        await this.syncWorkspaceTree();
    }

    async toggleTerminalOverlay() {
        if (this.terminalVisible) {
            this.closeTerminalOverlay();
            return;
        }

        if (this.getExecutionTarget() !== 'local') {
            this.setStatus('Switch to Local mode to use local terminal.');
            return;
        }

        const state = this.getState();
        if (!state?.local_context?.is_ready || !state?.local_context?.root_path) {
            const selected = await this.openLocalFolderSelectionFlow();
            if (!selected) return;
        }

        const conversationId = await this.ensureConversationId();
        const latestState = this.getState(conversationId);
        const cwd = latestState?.local_context?.root_path;
        if (!conversationId || !cwd) {
            this.setStatus('Local terminal unavailable: no workspace root configured.');
            return;
        }

        const ready = await this.ensureTerminalClientReady();
        if (!ready) {
            this.setStatus('Terminal UI failed to initialize.');
            return;
        }
        this.fitTerminal();

        const started = await this.callLocalInvoke('project-local-terminal-start', {
            conversationId,
            cwd,
            cols: this.terminal?.cols || 120,
            rows: this.terminal?.rows || 35,
        });

        if (!started?.success) {
            this.setStatus(`Failed to start terminal: ${started?.error || 'Unknown error'}`);
            return;
        }

        const runtimeMode = started?.mode || this.terminalSessionMode || 'spawn';
        this.setTerminalPresentationMode(runtimeMode === 'pty' ? 'pty' : 'spawn');
        if (runtimeMode !== 'pty') {
            this.setStatus('Terminal is running in compatibility mode (PTY unavailable on this machine).');
        }

        this.hideMainFilePreview();
        if (this.terminal && runtimeMode === 'pty') {
            this.terminal.writeln(`[local-terminal] Connected at ${cwd}`);
        } else if (this.el.terminalOutput && !this.el.terminalOutput.textContent.trim()) {
            this.el.terminalOutput.textContent = `[local-terminal] Connected at ${cwd}\n`;
        }

        this.el.terminalOverlay?.classList.remove('hidden');
        document.body.classList.add('project-terminal-open');
        this.terminalVisible = true;
        if (runtimeMode === 'pty') {
            this.fitTerminal();
            requestAnimationFrame(() => this.focusTerminal());
        } else {
            requestAnimationFrame(() => this.el.terminalInput?.focus());
        }
    }

    closeTerminalOverlay() {
        this.el.terminalOverlay?.classList.add('hidden');
        document.body.classList.remove('project-terminal-open');
        this.terminalVisible = false;
        this.terminal?.blur?.();
        const floatingInput = document.getElementById('floating-input');
        if (floatingInput && typeof floatingInput.focus === 'function') {
            floatingInput.focus();
        }
    }

    appendTerminalOutput(text, stream = 'stdout') {
        const normalized = String(text || '');
        if (!normalized) return;

        if (this.terminal && this.terminalSessionMode === 'pty') {
            this.terminal.write(normalized);
            return;
        }

        if (!this.el.terminalOutput) return;
        const prefix = stream === 'stderr' ? '[stderr] ' : '';
        this.el.terminalOutput.textContent += `${prefix}${normalized}`;
        this.el.terminalOutput.scrollTop = this.el.terminalOutput.scrollHeight;
    }

    async sendTerminalCommand() {
        if (this.getExecutionTarget() !== 'local') {
            this.setStatus('Local terminal works only in Local mode.');
            return;
        }

        if (this.terminal && this.terminalSessionMode === 'pty') {
            await this.sendTerminalData('\r');
            return;
        }

        const command = String(this.el.terminalInput?.value || '').trim();
        if (!command) return;

        if (this.el.terminalInput) {
            this.el.terminalInput.value = '';
        }

        this.appendTerminalOutput(`\n$ ${command}\n`, 'stdout');

        const result = await this.sendTerminalData(`${command}\n`);

        if (result && !result?.success) {
            this.appendTerminalOutput(`${result?.error || 'Failed to execute command'}\n`, 'stderr');
        }
    }

    async stopLocalTerminal(conversationId) {
        if (!conversationId) return;
        await this.callLocalInvoke('project-local-terminal-stop', { conversationId });
    }

    async exitProjectMode() {
        const conversationId = this.getConversationId();
        await this.stopLocalWatcher(conversationId);
        await this.stopLocalTerminal(conversationId);
        this.disposeTerminalClient();

        this.activeProject = null;
        window.projectContext = null;
        window.activeProjectContext = null;
        const state = this.getState(conversationId, false);
        if (state) {
            state.workspace_mode = 'cloud';
        }
        this.el.title.textContent = 'Project Workspace';
        this.el.subtitle.textContent = 'No active project';
        this.el.tree.innerHTML = '';
        if (this.el.terminalOutput) {
            this.el.terminalOutput.textContent = '';
        }
        this.currentTreeSource = null;
        this.latestSyncedPaths = [];
        this.selectedFilePath = null;
        this.hideMainFilePreview();
        this.updateRedeployUI({ visible: false, dirty: false });
        this.setPreviewPlaceholder('Click a file to view its content.');
        this.setStatus('Project mode off. Starting a new normal chat session.');
        this.closePanel();
        this.updateModeUI();

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

