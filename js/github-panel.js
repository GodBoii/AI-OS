/**
 * GitHub / Source Control panel for the Coder Workspace.
 *
 * Replaces the old "Clone GitHub Repo" sidebar accordion. Everything GitHub
 * related now lives behind the GitHub pill in the workspace super header:
 * repository detection, staging, committing, fetch/pull/push, branch
 * create/checkout, commit history, branch comparison, pull-request hand-off,
 * and repository cloning.
 *
 * All git work happens in the main process through the single
 * `project-local-git` IPC channel (see js/local-coder-handler.js). This module
 * only renders state and dispatches actions.
 */

const GIT_CHANNEL = 'project-local-git';
const REFRESH_DEBOUNCE_MS = 450;

class GithubPanel {
    constructor() {
        this.el = {};
        this.isOpen = false;
        this.activePane = 'changes';
        this.busyDepth = 0;
        this.closeTimer = null;
        this.refreshTimer = null;
        this.pillResizeObserver = null;
        this.stickyStatusUntil = 0;
        this.lastIdentityKey = null;
        // Render signatures: lists are only rebuilt when their content changes,
        // so the row entrance animation never replays for identical data.
        this.lastChangesSignature = null;
        this.lastBranchSignature = null;
        this.lastBranchDataSignature = null;
        this.lastLogSignature = null;

        this.state = {
            /** 'unavailable' | 'cloud' | 'no-folder' | 'not-repo' | 'ready' */
            gate: 'unavailable',
            rootPath: null,
            repo: null,
            status: null,
            branches: null,
            log: null,
            branchFilter: '',
            compare: null,
            lastError: null,
        };

        this.onDocumentPointerDown = this.onDocumentPointerDown.bind(this);
        this.onDocumentKeyDown = this.onDocumentKeyDown.bind(this);
        this.onViewportChange = this.onViewportChange.bind(this);

        this.init();
    }

    async init() {
        try {
            await this.waitForElement('github-panel');
            this.setupUi();
        } catch (error) {
            console.warn('[GithubPanel] Initialization skipped:', error.message);
        }
    }

    /**
     * chat.html is injected into #chat-root only after the auth gate clears, so
     * wait for the node instead of racing a fixed timeout.
     */
    waitForElement(id) {
        return new Promise((resolve) => {
            if (document.getElementById(id)) {
                resolve(true);
                return;
            }
            const observer = new MutationObserver(() => {
                if (!document.getElementById(id)) return;
                observer.disconnect();
                resolve(true);
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });
    }

    setupUi() {
        const panel = document.getElementById('github-panel');
        if (!panel) return false;
        if (panel.dataset.ghpBound === 'true') return true;
        panel.dataset.ghpBound = 'true';

        this.cacheElements();
        this.bindEvents();
        this.syncTabPill();
        return true;
    }

    cacheElements() {
        const byId = (id) => document.getElementById(id);
        this.el = {
            panel: byId('github-panel'),
            trigger: byId('super-github-btn'),

            repoName: byId('ghp-repo-name'),
            repoMeta: byId('ghp-repo-meta'),
            remoteBtn: byId('ghp-remote-btn'),
            refreshBtn: byId('ghp-refresh-btn'),
            closeBtn: byId('ghp-close-btn'),

            branchBar: byId('ghp-branchbar'),
            branchChip: byId('ghp-branch-chip'),
            branchName: byId('ghp-branch-name'),
            aheadCount: byId('ghp-ahead-count'),
            behindCount: byId('ghp-behind-count'),
            fetchBtn: byId('ghp-fetch-btn'),
            pullBtn: byId('ghp-pull-btn'),
            pushBtn: byId('ghp-push-btn'),

            tabs: byId('ghp-tabs'),
            tabsPill: document.querySelector('#ghp-tabs .ghp-tabs-pill'),
            tabButtons: Array.from(document.querySelectorAll('#ghp-tabs .ghp-tab')),
            panes: Array.from(document.querySelectorAll('#github-panel .ghp-pane')),
            body: byId('ghp-body'),

            gate: byId('ghp-gate'),
            gateIcon: byId('ghp-gate-icon'),
            gateTitle: byId('ghp-gate-title'),
            gateCopy: byId('ghp-gate-copy'),
            gateActions: byId('ghp-gate-actions'),

            commitMessage: byId('ghp-commit-message'),
            amendCheck: byId('ghp-amend-check'),
            commitBtn: byId('ghp-commit-btn'),
            commitPushBtn: byId('ghp-commit-push-btn'),
            changesList: byId('ghp-changes-list'),

            branchSearch: byId('ghp-branch-search'),
            newBranchBtn: byId('ghp-new-branch-btn'),
            newBranchFromBtn: byId('ghp-new-branch-from-btn'),
            compareBtn: byId('ghp-compare-btn'),
            prBtn: byId('ghp-pr-btn'),
            prLabel: byId('ghp-pr-label'),
            compareResult: byId('ghp-compare-result'),
            branchList: byId('ghp-branch-list'),

            logList: byId('ghp-log-list'),

            repoFacts: byId('ghp-repo-facts'),
            cloneUrl: byId('project-repo-url'),
            cloneBranch: byId('project-repo-branch'),
            cloneBtn: byId('project-clone-repo-btn'),
            openFolderBtn: byId('ghp-open-folder-btn'),
            revealFolderBtn: byId('ghp-reveal-folder-btn'),
            terminalBtn: byId('ghp-terminal-btn'),

            status: byId('ghp-status'),
        };
    }

    bindEvents() {
        this.el.closeBtn?.addEventListener('click', () => this.close());
        this.el.refreshBtn?.addEventListener('click', () => this.refresh({ announce: true }));
        this.el.remoteBtn?.addEventListener('click', () => this.openRemoteInBrowser());

        this.el.fetchBtn?.addEventListener('click', () => this.runRemoteOperation('fetch'));
        this.el.pullBtn?.addEventListener('click', () => this.runRemoteOperation('pull'));
        this.el.pushBtn?.addEventListener('click', () => this.runRemoteOperation('push'));
        this.el.branchChip?.addEventListener('click', () => this.showPane('branches', { focusSearch: true }));

        this.el.tabButtons.forEach((button) => {
            button.addEventListener('click', () => this.showPane(button.dataset.pane));
        });

        this.el.commitBtn?.addEventListener('click', () => this.commit({ push: false }));
        this.el.commitPushBtn?.addEventListener('click', () => this.commit({ push: true }));
        this.el.commitMessage?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                this.commit({ push: false });
            }
        });

        this.el.branchSearch?.addEventListener('input', () => {
            this.state.branchFilter = String(this.el.branchSearch.value || '').trim();
            this.renderBranches();
        });
        this.el.branchSearch?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const first = this.el.branchList?.querySelector('.ghp-row[data-branch]');
            if (first) this.checkoutBranch(first.dataset.branch);
        });

        this.el.newBranchBtn?.addEventListener('click', () => this.createBranch({ pickBase: false }));
        this.el.newBranchFromBtn?.addEventListener('click', () => this.createBranch({ pickBase: true }));
        this.el.compareBtn?.addEventListener('click', () => this.compareBranch());
        this.el.prBtn?.addEventListener('click', () => this.handlePullRequest());

        // Cloning still runs through ProjectWorkspace so mode switching,
        // watcher startup and tree syncing keep their existing behaviour.
        this.el.cloneBtn?.addEventListener('click', async () => {
            const workspace = window.projectWorkspace;
            if (!workspace?.cloneGithubRepo) {
                this.setStatus('Coder workspace is not ready yet.', 'error');
                return;
            }
            this.setStatus('Cloning repository…');
            this.beginBusy();
            try {
                await workspace.cloneGithubRepo();
            } finally {
                this.endBusy();
            }
            await this.refresh();
        });

        this.el.openFolderBtn?.addEventListener('click', async () => {
            const workspace = window.projectWorkspace;
            if (!workspace?.openLocalFolderSelectionFlow) return;
            this.beginBusy();
            try {
                await workspace.openLocalFolderSelectionFlow();
            } finally {
                this.endBusy();
            }
            await this.refresh();
        });

        this.el.revealFolderBtn?.addEventListener('click', () => {
            const rootPath = this.state.rootPath;
            if (!rootPath) {
                this.setStatus('No local folder selected.', 'error');
                return;
            }
            window.electron?.shell?.openPath?.(rootPath);
        });

        this.el.terminalBtn?.addEventListener('click', () => {
            this.close();
            window.projectWorkspace?.toggleTerminalOverlay?.();
        });

        // Delegated row actions keep one listener per list regardless of size.
        this.el.changesList?.addEventListener('click', (event) => this.onChangesListClick(event));
        this.el.branchList?.addEventListener('click', (event) => this.onBranchListClick(event));
        this.el.logList?.addEventListener('click', (event) => this.onLogListClick(event));

        // Rows are role="button" and focusable, so Enter / Space must activate
        // them the same way a pointer click does.
        [this.el.changesList, this.el.branchList, this.el.logList].forEach((list) => {
            list?.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const activatable = event.target?.closest?.('.ghp-row, .ghp-row-action');
                if (!activatable) return;
                event.preventDefault();
                activatable.click();
            });
        });

        // Keep the popover glued to its trigger.
        window.addEventListener('resize', this.onViewportChange);

        // Workspace mode / folder changes should re-evaluate the gate.
        document.addEventListener('project-workspace:state-change', () => {
            if (!this.isOpen) {
                this.refreshIndicator();
                return;
            }
            this.scheduleRefresh();
        });

        // A file changed on disk — the working tree probably moved with it.
        window.electron?.ipcRenderer?.on?.('local-workspace-changed', () => {
            if (!this.isOpen) return;
            this.scheduleRefresh();
        });

        if (typeof ResizeObserver === 'function' && this.el.tabs) {
            this.pillResizeObserver = new ResizeObserver(() => this.syncTabPill({ immediate: true }));
            this.pillResizeObserver.observe(this.el.tabs);
        }
    }

    /* =================================================================
       OPEN / CLOSE  (recipe 05: menu dropdown)
       ================================================================= */

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        const panel = this.el.panel;
        if (!panel) return;

        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }

        panel.classList.remove('is-closing');
        this.position();
        // Force a frame so the pre-open transform is committed before the
        // opening transition starts, otherwise the panel snaps into place.
        void panel.offsetWidth;
        panel.classList.add('is-open');
        panel.setAttribute('aria-hidden', 'false');
        this.el.trigger?.classList.add('active');
        this.el.trigger?.setAttribute('aria-expanded', 'true');
        this.isOpen = true;

        // Bound on the next tick so the click that opened the panel does not
        // immediately close it again.
        setTimeout(() => {
            document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
            document.addEventListener('keydown', this.onDocumentKeyDown, true);
        }, 0);

        this.syncTabPill({ immediate: true });
        this.refresh({ announce: false });
    }

    close() {
        const panel = this.el.panel;
        if (!panel || !this.isOpen) return;

        this.isOpen = false;
        document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
        document.removeEventListener('keydown', this.onDocumentKeyDown, true);

        panel.classList.remove('is-open');
        panel.classList.add('is-closing');
        panel.setAttribute('aria-hidden', 'true');
        this.el.trigger?.classList.remove('active');
        this.el.trigger?.setAttribute('aria-expanded', 'false');

        // Without this cleanup the next open would start from the closing
        // scale instead of the resting pre-open scale.
        const duration = this.readMotionMs('--dropdown-close-dur', 150);
        this.closeTimer = setTimeout(() => {
            panel.classList.remove('is-closing');
            this.closeTimer = null;
        }, duration + 20);
    }

    readMotionMs(variableName, fallback) {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
        if (!raw) return fallback;
        if (raw.endsWith('ms')) return parseFloat(raw) || fallback;
        if (raw.endsWith('s')) return (parseFloat(raw) || 0) * 1000 || fallback;
        return parseFloat(raw) || fallback;
    }

    onDocumentPointerDown(event) {
        const target = event.target;
        if (this.el.panel?.contains(target)) return;
        if (this.el.trigger?.contains(target)) return;
        this.close();
    }

    onDocumentKeyDown(event) {
        if (event.key !== 'Escape') return;
        // Capture phase + stopPropagation keeps Escape from also reaching the
        // workspace handler that closes the terminal / file preview.
        event.stopPropagation();
        event.preventDefault();
        this.close();
    }

    onViewportChange() {
        if (!this.isOpen) return;
        this.position();
    }

    /** Anchors the panel under the GitHub pill, flipping if space is tight. */
    position() {
        const panel = this.el.panel;
        const trigger = this.el.trigger;
        if (!panel) return;

        const gap = 8;
        const margin = 12;
        const rect = trigger?.getBoundingClientRect();

        if (!rect || (rect.width === 0 && rect.height === 0)) {
            panel.style.top = `${margin + 40}px`;
            panel.style.left = `${margin + 48}px`;
            panel.dataset.origin = 'top-left';
            return;
        }

        const panelWidth = panel.offsetWidth || 384;
        const panelHeight = panel.offsetHeight || 420;

        let left = rect.right - panelWidth;
        let origin = 'top-right';
        if (left < margin) {
            left = Math.min(rect.left, window.innerWidth - panelWidth - margin);
            origin = 'top-left';
        }
        left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));

        let top = rect.bottom + gap;
        if (top + panelHeight > window.innerHeight - margin) {
            top = Math.max(margin, window.innerHeight - panelHeight - margin);
        }

        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
        panel.dataset.origin = origin;
    }

    /* =================================================================
       TABS  (recipe 16: sliding pill)
       ================================================================= */

    showPane(name, options = {}) {
        const pane = String(name || 'changes');
        this.activePane = pane;

        this.el.tabButtons.forEach((button) => {
            button.setAttribute('aria-selected', String(button.dataset.pane === pane));
        });
        this.el.panes.forEach((section) => {
            section.classList.toggle('hidden', section.dataset.pane !== pane);
        });

        this.applyGateVisibility();
        this.syncTabPill();

        if (options.focusSearch && pane === 'branches') {
            requestAnimationFrame(() => this.el.branchSearch?.focus());
        }
    }

    syncTabPill(options = {}) {
        const pill = this.el.tabsPill;
        const active = this.el.tabButtons.find((button) => button.getAttribute('aria-selected') === 'true');
        if (!pill || !active || !this.el.tabs) return;

        const tabsRect = this.el.tabs.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        if (activeRect.width === 0) return;

        const offset = activeRect.left - tabsRect.left;

        // First paint (and resize) must land without a transition, otherwise the
        // pill animates in from translateX(0) / width:0.
        if (options.immediate) {
            pill.style.transition = 'none';
            pill.style.transform = `translateX(${offset}px)`;
            pill.style.width = `${activeRect.width}px`;
            void pill.offsetWidth;
            pill.style.transition = '';
            return;
        }

        pill.style.transform = `translateX(${offset}px)`;
        pill.style.width = `${activeRect.width}px`;
    }

    /* =================================================================
       STATE / DATA
       ================================================================= */

    getWorkspaceContext() {
        const workspace = window.projectWorkspace;
        if (workspace?.getSourceControlContext) {
            return workspace.getSourceControlContext();
        }
        return { mode: 'cloud', conversationId: null, rootPath: null, isReady: false };
    }

    async invokeGit(action, payload = {}) {
        if (!window.electron?.ipcRenderer?.invoke) {
            return { success: false, error: 'Desktop local bridge is unavailable.' };
        }

        const context = this.getWorkspaceContext();
        const rootPath = payload.rootPath || context.rootPath;
        if (!rootPath) {
            return { success: false, error: 'No local workspace folder is selected.' };
        }

        const result = await window.electron.ipcRenderer.invoke(GIT_CHANNEL, {
            ...payload,
            action,
            conversationId: context.conversationId,
            rootPath,
        });
        return result || { success: false, error: 'No response from the local git bridge.' };
    }

    beginBusy() {
        this.busyDepth += 1;
        this.el.panel?.classList.add('is-busy');
    }

    endBusy() {
        this.busyDepth = Math.max(0, this.busyDepth - 1);
        if (this.busyDepth === 0) {
            this.el.panel?.classList.remove('is-busy');
        }
    }

    setStatus(message, tone = 'neutral') {
        if (!this.el.status) return;
        this.el.status.textContent = String(message || '');
        this.el.status.dataset.tone = tone;
        this.el.status.title = String(message || '');

        // Every action ends with a refresh, and the refresh wants to describe
        // the repository. Hold outcome messages briefly so "Commit created." is
        // not swallowed by "working tree clean" a few hundred ms later.
        this.stickyStatusUntil = (tone === 'success' || tone === 'error')
            ? Date.now() + 5000
            : 0;
    }

    hasStickyStatus() {
        return Boolean(this.stickyStatusUntil && Date.now() < this.stickyStatusUntil);
    }

    scheduleRefresh() {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refresh({ announce: false });
        }, REFRESH_DEBOUNCE_MS);
    }

    /** Loads everything the panel shows in a single IPC round-trip. */
    async refresh(options = {}) {
        const { announce = false } = options;
        const context = this.getWorkspaceContext();
        this.state.rootPath = context.rootPath || null;

        if (!window.electron?.ipcRenderer?.invoke) {
            this.state.gate = 'unavailable';
            this.render();
            this.setStatus('Source control needs the desktop app bridge.', 'error');
            return;
        }

        if (context.mode !== 'local') {
            this.state.gate = 'cloud';
            this.state.repo = null;
            this.render();
            if (announce || !this.hasStickyStatus()) {
                this.setStatus('Cloud mode is active. Source control works on your local folder.');
            }
            return;
        }

        if (!context.isReady || !context.rootPath) {
            this.state.gate = 'no-folder';
            this.state.repo = null;
            this.render();
            if (announce || !this.hasStickyStatus()) {
                this.setStatus('Pick a local folder to enable source control.');
            }
            return;
        }

        this.beginBusy();
        if (announce) this.setStatus('Refreshing source control…');
        this.renderLoadingSkeletons();

        try {
            const overview = await this.invokeGit('overview');
            if (!overview?.success) {
                this.state.gate = 'not-repo';
                this.state.repo = null;
                this.state.lastError = overview?.error || 'Unable to read git state.';
                this.render();
                this.setStatus(this.state.lastError, 'error');
                return;
            }

            const repo = overview.repo || {};
            if (!repo.is_repo) {
                this.state.gate = 'not-repo';
                this.state.repo = repo;
                this.state.status = null;
                this.state.branches = null;
                this.state.log = null;
                this.render();
                if (announce || !this.hasStickyStatus()) {
                    this.setStatus('This folder is not a Git repository yet.');
                }
                return;
            }

            this.state.gate = 'ready';
            this.state.repo = repo;
            this.state.status = overview.status;
            this.state.branches = overview.branches;
            this.state.log = overview.log;
            this.state.lastError = null;
            this.render();

            if (announce || !this.hasStickyStatus()) {
                this.setStatus(this.describeRepoState(repo, overview.status?.total || 0));
            }
        } catch (error) {
            this.state.lastError = error.message;
            this.setStatus(`Source control failed: ${error.message}`, 'error');
        } finally {
            this.endBusy();
        }
    }

    describeRepoState(repo, changedCount) {
        const parts = [];
        if (repo?.is_detached) parts.push(`Detached at ${repo.detached_at || 'HEAD'}`);
        else if (repo?.branch) parts.push(`On ${repo.branch}`);

        if (!repo?.has_commits) parts.push('no commits yet');
        else if (repo?.upstream) {
            if (repo.ahead || repo.behind) {
                parts.push(`${repo.ahead} to push, ${repo.behind} to pull`);
            } else {
                parts.push('up to date');
            }
        } else if (repo?.branch) {
            parts.push('no upstream set');
        }

        parts.push(changedCount === 0
            ? 'working tree clean'
            : `${changedCount} change${changedCount === 1 ? '' : 's'}`);

        return `${parts.join(' · ')}.`;
    }

    /* =================================================================
       RENDER
       ================================================================= */

    render() {
        this.renderHeader();
        this.renderBranchBar();
        this.renderGate();
        this.renderChanges();
        this.renderBranches();
        this.renderLog();
        this.renderRepoFacts();
        this.refreshIndicator();
        this.applyGateVisibility();
        requestAnimationFrame(() => this.syncTabPill({ immediate: true }));
    }

    renderHeader() {
        const repo = this.state.repo;
        const remote = repo?.remote;

        let name = 'Source Control';
        let meta = 'Checking workspace…';

        if (this.state.gate === 'cloud') {
            name = 'Cloud Workspace';
            meta = 'Switch to Local mode for source control';
        } else if (this.state.gate === 'no-folder') {
            name = 'No folder selected';
            meta = 'Choose a local folder or clone a repository';
        } else if (this.state.gate === 'not-repo') {
            name = this.basename(this.state.rootPath) || 'Local folder';
            meta = 'Not a Git repository';
        } else if (repo?.is_repo) {
            name = remote?.slug || this.basename(repo.root_path || this.state.rootPath) || 'Repository';
            meta = repo.remote_url || repo.root_path || 'Local repository (no remote)';
        }

        const identityKey = `${name}\u0000${meta}`;
        const identityChanged = identityKey !== this.lastIdentityKey;
        this.lastIdentityKey = identityKey;

        if (this.el.repoName) this.el.repoName.textContent = name;
        if (this.el.repoMeta) {
            this.el.repoMeta.textContent = meta;
            this.el.repoMeta.title = meta;
        }

        if (this.el.remoteBtn) {
            this.el.remoteBtn.disabled = !remote?.web_url;
        }

        // Replay the reveal only when the identity actually changed. Background
        // refreshes (file watcher, polling) must not re-animate static text.
        if (identityChanged && this.isOpen && this.el.panel) {
            const lines = this.el.panel.querySelectorAll('.ghp-identity .t-stagger-line');
            lines.forEach((line) => {
                line.style.animation = 'none';
                void line.offsetWidth;
                line.style.animation = '';
            });
        }
    }

    renderBranchBar() {
        const repo = this.state.repo;
        const visible = this.state.gate === 'ready' && Boolean(repo?.is_repo);
        this.el.branchBar?.classList.toggle('hidden', !visible);
        if (!visible) return;

        const label = repo.is_detached
            ? `detached @ ${repo.detached_at || 'HEAD'}`
            : (repo.branch || 'unknown');
        if (this.el.branchName) this.el.branchName.textContent = label;
        this.el.branchChip?.classList.toggle('is-detached', Boolean(repo.is_detached));
        if (this.el.branchChip) this.el.branchChip.title = repo.upstream
            ? `Tracking ${repo.upstream}`
            : 'No upstream branch — pushing will set one';

        this.setCount(this.el.aheadCount, repo.ahead);
        this.setCount(this.el.behindCount, repo.behind);

        const hasRemote = Array.isArray(repo.remotes) && repo.remotes.length > 0;
        if (this.el.fetchBtn) this.el.fetchBtn.disabled = !hasRemote;
        if (this.el.pullBtn) this.el.pullBtn.disabled = !hasRemote || !repo.upstream;
        if (this.el.pushBtn) this.el.pushBtn.disabled = !hasRemote || !repo.has_commits || repo.is_detached;
    }

    setCount(element, value) {
        if (!element) return;
        const count = Number(value) || 0;
        const bold = element.querySelector('b');
        if (bold) bold.textContent = String(count);
        element.dataset.empty = String(count === 0);
    }

    renderGate() {
        const gate = this.state.gate;
        if (gate === 'ready' || !this.el.gate) return;

        const icons = {
            unavailable: this.svgIcon('M12 9v4', 'M12 17h.01', 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'),
            cloud: this.svgIcon('M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'),
            'no-folder': this.svgIcon('M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-1.2-1.8A2 2 0 0 0 7.55 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z'),
            'not-repo': this.svgIcon('M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M15 6a9 9 0 0 0-9 9'),
        };

        const copy = {
            unavailable: {
                title: 'Source control unavailable',
                body: this.state.lastError || 'The desktop bridge is not available in this window.',
                actions: [],
            },
            cloud: {
                title: 'Cloud mode is active',
                body: 'Source control operates on a folder on your machine. Switch to Local mode to stage, commit and push.',
                actions: [{ label: 'Switch to Local', primary: true, handler: () => this.switchToLocal() }],
            },
            'no-folder': {
                title: 'No local folder yet',
                body: 'Pick a folder on your computer, or clone a repository to create one.',
                actions: [
                    { label: 'Choose folder', primary: true, handler: () => this.el.openFolderBtn?.click() },
                    { label: 'Clone a repo', handler: () => this.showPane('repo') },
                ],
            },
            'not-repo': {
                title: 'Not a Git repository',
                body: `${this.state.rootPath || 'This folder'} has no .git directory. Initialize it to start tracking changes, or clone an existing repository.`,
                actions: [
                    { label: 'Initialize repository', primary: true, handler: () => this.initRepository() },
                    { label: 'Clone a repo', handler: () => this.showPane('repo') },
                ],
            },
        };

        const config = copy[gate] || copy.unavailable;
        if (this.el.gateIcon) this.el.gateIcon.innerHTML = icons[gate] || icons.unavailable;
        if (this.el.gateTitle) this.el.gateTitle.textContent = config.title;
        if (this.el.gateCopy) this.el.gateCopy.textContent = config.body;

        if (this.el.gateActions) {
            this.el.gateActions.innerHTML = '';
            config.actions.forEach((action) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `ghp-btn${action.primary ? ' ghp-btn-primary' : ''}`;
                button.textContent = action.label;
                button.addEventListener('click', action.handler);
                this.el.gateActions.appendChild(button);
            });
        }
    }

    /**
     * The Repo pane still works without a repository (clone / folder picking
     * live there), so the gate only replaces the git-dependent panes.
     */
    applyGateVisibility() {
        const blocked = this.state.gate !== 'ready';
        const gateReplacesPane = blocked && this.activePane !== 'repo';

        this.el.gate?.classList.toggle('hidden', !gateReplacesPane);
        this.el.panes.forEach((section) => {
            const isActive = section.dataset.pane === this.activePane;
            section.classList.toggle('hidden', !isActive || gateReplacesPane);
        });

        this.el.tabButtons.forEach((button) => {
            const gitOnly = button.dataset.pane !== 'repo';
            button.classList.toggle('is-muted', blocked && gitOnly);
        });
    }

    renderLoadingSkeletons() {
        [this.el.changesList, this.el.branchList, this.el.logList].forEach((list) => {
            if (!list || list.childElementCount > 0) return;
            list.innerHTML = '';
            for (let index = 0; index < 4; index += 1) {
                const row = document.createElement('div');
                row.className = 'ghp-skel-row';
                row.style.setProperty('--row-index', String(index));
                list.appendChild(row);
            }
        });
    }

    renderChanges() {
        const list = this.el.changesList;
        if (!list) return;

        const status = this.state.status;
        if (this.state.gate !== 'ready' || !status) {
            list.innerHTML = '';
            this.lastChangesSignature = null;
            this.setTabBadge('changes', 0);
            return;
        }

        // Rows carry an entrance animation, so rebuilding an identical list on
        // every file-watcher refresh would make the panel twitch. Only touch the
        // DOM when the set of changes actually differs.
        const signature = ['conflicted', 'staged', 'unstaged']
            .map((key) => (status[key] || []).map((entry) => `${entry.code}${entry.path}`).join(','))
            .join('|');

        if (signature !== this.lastChangesSignature) {
            this.lastChangesSignature = signature;

            const fragment = document.createDocumentFragment();
            let rowIndex = 0;

            const addGroup = (label, entries, groupKind) => {
                if (!entries.length) return;
                fragment.appendChild(this.buildGroupHeader(label, entries.length, groupKind));
                entries.forEach((entry) => {
                    fragment.appendChild(this.buildChangeRow(entry, groupKind, rowIndex));
                    rowIndex += 1;
                });
            };

            addGroup('Merge conflicts', status.conflicted || [], 'conflicted');
            addGroup('Staged changes', status.staged || [], 'staged');
            addGroup('Changes', status.unstaged || [], 'unstaged');

            list.innerHTML = '';
            if (!fragment.childNodes.length) {
                const empty = document.createElement('div');
                empty.className = 'ghp-empty';
                empty.textContent = this.state.repo?.has_commits
                    ? 'No changes. Working tree is clean.'
                    : 'No changes yet. Add files, then make your first commit.';
                list.appendChild(empty);
            } else {
                list.appendChild(fragment);
            }
        }

        const staged = (status.staged || []).length;
        const total = status.total || 0;
        const canCommit = staged > 0 || (status.unstaged || []).length > 0;
        if (this.el.commitBtn) this.el.commitBtn.disabled = !canCommit;
        if (this.el.commitPushBtn) {
            this.el.commitPushBtn.disabled = !canCommit
                || !(Array.isArray(this.state.repo?.remotes) && this.state.repo.remotes.length > 0);
        }
        this.setTabBadge('changes', total);
    }

    buildGroupHeader(label, count, groupKind) {
        const header = document.createElement('div');
        header.className = 'ghp-group-label';
        header.innerHTML = `<span>${this.escape(label)}</span><span class="ghp-group-count">${count}</span>`;

        const actions = document.createElement('span');
        actions.className = 'ghp-group-actions';

        if (groupKind === 'staged') {
            actions.appendChild(this.buildActionButton('unstage-all', 'Unstage all', 'M5 12h14'));
        } else if (groupKind === 'unstaged') {
            actions.appendChild(this.buildActionButton('discard-all', 'Discard all changes', 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8|M3 3v5h5', true));
            actions.appendChild(this.buildActionButton('stage-all', 'Stage all changes', 'M5 12h14|M12 5v14'));
        }

        if (actions.childElementCount > 0) header.appendChild(actions);
        return header;
    }

    buildActionButton(action, title, pathSpec, danger = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `ghp-row-action${danger ? ' is-danger' : ''}`;
        button.dataset.action = action;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.innerHTML = this.svgIcon(...String(pathSpec).split('|'));
        return button;
    }

    buildChangeRow(entry, groupKind, index) {
        const row = document.createElement('div');
        row.className = 'ghp-row';
        row.style.setProperty('--row-index', String(Math.min(index, 12)));
        row.dataset.path = entry.path;
        row.dataset.group = groupKind;
        row.dataset.untracked = String(Boolean(entry.untracked));
        row.setAttribute('role', 'button');
        row.tabIndex = 0;

        const fileName = entry.path.split('/').pop() || entry.path;
        const directory = entry.path.slice(0, entry.path.length - fileName.length).replace(/\/$/, '');
        const renameNote = entry.original_path ? ` ← ${entry.original_path}` : '';

        const code = document.createElement('span');
        code.className = 'ghp-code';
        code.dataset.code = entry.code;
        code.textContent = entry.code;
        code.title = entry.label;

        const copy = document.createElement('span');
        copy.className = 'ghp-row-copy';
        copy.innerHTML = `
            <span class="ghp-row-title">
                <span class="ghp-row-name">${this.escape(fileName)}</span>
                <span class="ghp-row-dir">${this.escape(directory + renameNote)}</span>
            </span>`;

        const actions = document.createElement('span');
        actions.className = 'ghp-row-actions';
        if (groupKind === 'staged') {
            actions.appendChild(this.buildActionButton('unstage', 'Unstage this file', 'M5 12h14'));
        } else {
            actions.appendChild(this.buildActionButton('discard', 'Discard changes to this file', 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8|M3 3v5h5', true));
            actions.appendChild(this.buildActionButton('stage', 'Stage this file', 'M5 12h14|M12 5v14'));
        }

        row.append(code, copy, actions);
        row.title = `${entry.label} — ${entry.path}`;
        return row;
    }

    setTabBadge(paneName, count) {
        const button = this.el.tabButtons.find((item) => item.dataset.pane === paneName);
        if (!button) return;

        const label = button.dataset.baseLabel || button.textContent.trim();
        button.dataset.baseLabel = label;

        const value = Number(count) || 0;
        if (button.dataset.badgeCount === String(value)) return;
        button.dataset.badgeCount = String(value);

        button.innerHTML = value > 0
            ? `${this.escape(label)}<span class="ghp-tab-badge">${value > 99 ? '99+' : value}</span>`
            : this.escape(label);
        requestAnimationFrame(() => this.syncTabPill({ immediate: true }));
    }

    renderBranches() {
        const list = this.el.branchList;
        if (!list) return;

        const data = this.state.branches;
        if (this.state.gate !== 'ready' || !data) {
            list.innerHTML = '';
            this.lastBranchSignature = null;
            this.lastBranchDataSignature = null;
            this.updatePullRequestAffordance();
            return;
        }

        const filter = this.state.branchFilter.toLowerCase();
        const match = (item) => !filter || item.name.toLowerCase().includes(filter);

        const dataSignature = ['local', 'remote', 'tags']
            .map((key) => (data[key] || [])
                .map((item) => `${item.is_current ? '*' : ''}${item.name}@${item.short_hash}`)
                .join(','))
            .join('|');
        const signature = `${filter}||${dataSignature}`;

        if (signature === this.lastBranchSignature) {
            this.updatePullRequestAffordance();
            return;
        }

        // Typing in the filter re-renders on every keystroke. Replaying the
        // staggered entrance each time reads as noise, so motion is reserved for
        // the case where the underlying branch data actually changed.
        const filterOnly = dataSignature === this.lastBranchDataSignature;
        this.lastBranchSignature = signature;
        this.lastBranchDataSignature = dataSignature;
        list.classList.toggle('ghp-list--no-anim', filterOnly);

        const fragment = document.createDocumentFragment();
        let rowIndex = 0;

        const addGroup = (label, entries) => {
            const filtered = entries.filter(match);
            if (!filtered.length) return;
            const header = document.createElement('div');
            header.className = 'ghp-group-label';
            header.innerHTML = `<span>${this.escape(label)}</span><span class="ghp-group-count">${filtered.length}</span>`;
            fragment.appendChild(header);

            filtered.slice(0, 60).forEach((item) => {
                fragment.appendChild(this.buildBranchRow(item, rowIndex));
                rowIndex += 1;
            });
        };

        addGroup('Local branches', data.local || []);
        addGroup('Remote branches', data.remote || []);
        addGroup('Tags', data.tags || []);

        list.innerHTML = '';
        if (!fragment.childNodes.length) {
            const empty = document.createElement('div');
            empty.className = 'ghp-empty';
            empty.textContent = filter
                ? `No branch or tag matching "${this.state.branchFilter}".`
                : 'No branches yet. Make a commit to create one.';
            list.appendChild(empty);
        } else {
            list.appendChild(fragment);
        }

        this.updatePullRequestAffordance();
    }

    buildBranchRow(item, index) {
        const row = document.createElement('div');
        row.className = `ghp-row${item.is_current ? ' is-current' : ''}`;
        row.style.setProperty('--row-index', String(Math.min(index, 12)));
        row.dataset.branch = item.name;
        row.dataset.branchType = item.type;
        row.setAttribute('role', 'button');
        row.tabIndex = 0;

        const icon = item.type === 'tag'
            ? this.svgIcon('M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z', 'M7 7h.01')
            : (item.type === 'remote'
                ? this.svgIcon('M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z')
                : this.svgIcon('M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M15 6a9 9 0 0 1-9 9'));

        const subtitle = [item.relative_date, item.subject].filter(Boolean).join(' · ');

        row.innerHTML = `
            <span class="ghp-row-icon">${icon}</span>
            <span class="ghp-row-copy">
                <span class="ghp-row-title">
                    <span class="ghp-row-name">${this.escape(item.name)}</span>
                    ${item.upstream ? `<span class="ghp-row-dir">→ ${this.escape(item.upstream)}</span>` : ''}
                </span>
                <span class="ghp-row-sub">${this.escape(subtitle)}</span>
            </span>
            <span class="ghp-row-mono">${this.escape(item.short_hash)}</span>`;

        if (item.is_current) {
            const check = document.createElement('span');
            check.className = 'ghp-check-mark';
            check.innerHTML = this.svgIcon('M20 6 9 17l-5-5');
            row.appendChild(check);
            row.title = `${item.name} (current)`;
        } else {
            const actions = document.createElement('span');
            actions.className = 'ghp-row-actions';
            actions.appendChild(this.buildActionButton('compare-with', `Compare ${item.name} with HEAD`, 'm17 3-3 3 3 3|M14 6h-4a4 4 0 0 0-4 4v1|m7 21 3-3-3-3|M10 18h4a4 4 0 0 0 4-4v-1'));
            row.appendChild(actions);
            row.title = `Check out ${item.name}`;
        }

        return row;
    }

    renderLog() {
        const list = this.el.logList;
        if (!list) return;

        const commits = this.state.log?.commits;
        if (this.state.gate !== 'ready' || !Array.isArray(commits)) {
            list.innerHTML = '';
            this.lastLogSignature = null;
            return;
        }

        const signature = commits.map((commit) => commit.hash).join(',');
        if (signature === this.lastLogSignature) return;
        this.lastLogSignature = signature;

        list.innerHTML = '';
        if (commits.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ghp-empty';
            empty.textContent = 'No commits yet.';
            list.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        commits.forEach((commit, index) => {
            const row = document.createElement('div');
            row.className = 'ghp-row';
            row.style.setProperty('--row-index', String(Math.min(index, 12)));
            row.dataset.commit = commit.hash;
            row.setAttribute('role', 'button');
            row.tabIndex = 0;
            row.title = commit.refs
                ? `${commit.subject}\n${commit.refs}`
                : commit.subject;
            row.innerHTML = `
                <span class="ghp-row-mono">${this.escape(commit.short_hash)}</span>
                <span class="ghp-row-copy">
                    <span class="ghp-row-title">
                        <span class="ghp-row-name">${this.escape(commit.subject || '(no message)')}</span>
                    </span>
                    <span class="ghp-row-sub">${this.escape([commit.author, commit.relative_date].filter(Boolean).join(' · '))}</span>
                </span>`;
            fragment.appendChild(row);
        });
        list.appendChild(fragment);
    }

    renderRepoFacts() {
        const facts = this.el.repoFacts;
        if (!facts) return;

        const repo = this.state.repo;
        const rows = [
            ['Folder', this.state.rootPath || 'Not selected'],
            ['Mode', this.getWorkspaceContext().mode === 'local' ? 'Local' : 'Cloud'],
        ];

        if (repo?.is_repo) {
            rows.push(['Branch', repo.is_detached ? `detached @ ${repo.detached_at}` : (repo.branch || '—')]);
            rows.push(['Upstream', repo.upstream || 'none']);
            rows.push(['Remote', repo.remote_url || 'none']);
            rows.push(['Default', repo.default_branch || 'unknown']);
            if (repo.last_commit) {
                rows.push(['Last commit', `${repo.last_commit.short_hash} · ${repo.last_commit.relative_date}`]);
            }
        } else {
            rows.push(['Git', 'Not initialized']);
        }

        facts.innerHTML = rows.map(([key, value]) => `
            <div class="ghp-fact">
                <span class="ghp-fact-key">${this.escape(key)}</span>
                <span class="ghp-fact-val" title="${this.escape(value)}">${this.escape(value)}</span>
            </div>`).join('');
    }

    /**
     * Called by ProjectWorkspace after it detects a repository in a freshly
     * selected folder, so the pill badge updates even when the panel is closed.
     */
    applyDetectedRepo(info, rootPath) {
        this.state.rootPath = rootPath || this.state.rootPath;
        if (info?.is_repo) {
            this.state.gate = 'ready';
            this.state.repo = info;
        } else {
            this.state.gate = info ? 'not-repo' : this.state.gate;
            this.state.repo = info || null;
        }
        this.refreshIndicator();
        if (this.isOpen) this.scheduleRefresh();
    }

    /** Mirrors repo state onto the GitHub pill so it reads at a glance. */
    refreshIndicator() {
        const trigger = this.el.trigger;
        if (!trigger) return;

        const repo = this.state.repo;
        if (this.state.gate !== 'ready' || !repo?.is_repo) {
            trigger.dataset.git = 'none';
            trigger.title = 'GitHub & source control';
            return;
        }

        trigger.dataset.git = repo.is_dirty ? 'dirty' : 'clean';
        const branch = repo.is_detached ? `detached @ ${repo.detached_at}` : repo.branch;
        trigger.title = `${repo.remote?.slug || this.basename(repo.root_path)} · ${branch}`
            + (repo.is_dirty ? ` · ${repo.changed_count} change${repo.changed_count === 1 ? '' : 's'}` : ' · clean');
    }

    updatePullRequestAffordance() {
        const button = this.el.prBtn;
        const label = this.el.prLabel;
        if (!button || !label) return;

        const repo = this.state.repo;
        if (!repo?.is_repo || !repo.remote?.web_url) {
            button.disabled = true;
            label.textContent = 'Pull request unavailable';
            button.title = 'Configure a remote to open pull requests.';
            return;
        }

        const base = repo.default_branch;
        const head = repo.branch;

        if (repo.is_detached || !head) {
            button.disabled = true;
            label.textContent = 'Pull request unavailable';
            button.title = 'Check out a branch to open a pull request.';
            return;
        }

        button.disabled = false;

        if (base && head === base) {
            label.textContent = `View pull requests`;
            button.title = `${head} is the default branch — opens the repository's pull request list.`;
            button.dataset.prMode = 'list';
            return;
        }

        if (!repo.upstream) {
            label.textContent = `Push ${head}, then open a PR`;
            button.title = 'This branch has no upstream yet. Pushing first is required to open a pull request.';
            button.dataset.prMode = 'push-first';
            return;
        }

        label.textContent = `Open pull request for ${head}`;
        button.title = `Compare ${base || 'the default branch'}...${head} on ${repo.remote.host}`;
        button.dataset.prMode = 'create';
    }

    /* =================================================================
       ACTIONS
       ================================================================= */

    onChangesListClick(event) {
        const actionButton = event.target?.closest?.('.ghp-row-action');
        if (actionButton) {
            event.stopPropagation();
            this.handleChangeAction(actionButton);
            return;
        }

        const row = event.target?.closest?.('.ghp-row[data-path]');
        if (row) this.openDiff(row);
    }

    async handleChangeAction(button) {
        const action = button.dataset.action;
        const row = button.closest('.ghp-row[data-path]');
        const status = this.state.status || {};

        if (action === 'stage-all') {
            await this.runGitTask('stage', { all: true }, 'Staged all changes.');
            return;
        }
        if (action === 'unstage-all') {
            await this.runGitTask('unstage', { all: true }, 'Unstaged all changes.');
            return;
        }
        if (action === 'discard-all') {
            const entries = [...(status.unstaged || [])].map((item) => ({
                path: item.path,
                untracked: Boolean(item.untracked),
            }));
            if (!entries.length) return;
            const confirmed = window.confirm(
                `Discard all ${entries.length} unstaged change${entries.length === 1 ? '' : 's'}?\n\n`
                + 'Modified files are reverted to the last commit and untracked files are deleted. '
                + 'This cannot be undone.'
            );
            if (!confirmed) {
                this.setStatus('Discard cancelled.');
                return;
            }
            await this.runGitTask('discard', { entries }, `Discarded ${entries.length} change(s).`);
            return;
        }

        if (!row) return;
        const path = row.dataset.path;
        const untracked = row.dataset.untracked === 'true';

        if (action === 'stage') {
            await this.runGitTask('stage', { paths: [path] }, `Staged ${path}.`);
            return;
        }
        if (action === 'unstage') {
            await this.runGitTask('unstage', { paths: [path] }, `Unstaged ${path}.`);
            return;
        }
        if (action === 'discard') {
            const confirmed = window.confirm(
                `Discard changes to ${path}?\n\n`
                + (untracked
                    ? 'This untracked file will be deleted. This cannot be undone.'
                    : 'This file will be reverted to the last commit. This cannot be undone.')
            );
            if (!confirmed) {
                this.setStatus('Discard cancelled.');
                return;
            }
            await this.runGitTask('discard', { entries: [{ path, untracked }] }, `Discarded ${path}.`);
        }
    }

    onBranchListClick(event) {
        const actionButton = event.target?.closest?.('.ghp-row-action');
        if (actionButton) {
            event.stopPropagation();
            const row = actionButton.closest('.ghp-row[data-branch]');
            if (row && actionButton.dataset.action === 'compare-with') {
                this.compareBranch(row.dataset.branch);
            }
            return;
        }

        const row = event.target?.closest?.('.ghp-row[data-branch]');
        if (!row || row.classList.contains('is-current')) return;
        this.checkoutBranch(row.dataset.branch, row.dataset.branchType);
    }

    onLogListClick(event) {
        const row = event.target?.closest?.('.ghp-row[data-commit]');
        if (!row) return;
        const commit = (this.state.log?.commits || []).find((item) => item.hash === row.dataset.commit);
        if (!commit) return;
        this.setStatus(`${commit.short_hash} — ${commit.subject}`);
    }

    /** Runs a git action, then refreshes state. Errors surface in the footer. */
    async runGitTask(action, payload, successMessage) {
        this.beginBusy();
        this.setStatus('Working…');
        try {
            const result = await this.invokeGit(action, payload);
            if (!result?.success) {
                this.setStatus(result?.error || `${action} failed.`, 'error');
                return false;
            }
            if (successMessage) this.setStatus(successMessage, 'success');
            return true;
        } catch (error) {
            this.setStatus(`${action} failed: ${error.message}`, 'error');
            return false;
        } finally {
            this.endBusy();
            await this.refresh({ announce: false });
        }
    }

    /**
     * Grow the commit textarea with its content instead of showing a native
     * resize grabber. Caps out at the CSS max-height, then scrolls.
     */
    autoSizeCommitInput() {
        const input = this.el.commitMessage;
        if (!input) return;
        input.style.height = 'auto';
        const max = parseFloat(getComputedStyle(input).maxHeight) || 150;
        input.style.height = `${Math.min(input.scrollHeight, max)}px`;
    }

    async commit(options = {}) {
        const message = String(this.el.commitMessage?.value || '').trim();
        if (!message) {
            this.setStatus('Enter a commit message first.', 'error');
            this.el.commitMessage?.focus();
            return;
        }

        const status = this.state.status || {};
        const stagedCount = (status.staged || []).length;
        const stageAll = stagedCount === 0;

        this.beginBusy();
        this.setStatus(stageAll ? 'Staging all changes and committing…' : 'Committing…');
        try {
            const result = await this.invokeGit('commit', {
                message,
                amend: Boolean(this.el.amendCheck?.checked),
                stageAll,
            });

            if (!result?.success) {
                this.setStatus(result.error || 'Commit failed.', 'error');
                return;
            }

            if (this.el.commitMessage) this.el.commitMessage.value = '';
            if (this.el.amendCheck) this.el.amendCheck.checked = false;
            this.setStatus('Commit created.', 'success');

            if (options.push) {
                this.setStatus('Commit created. Pushing…');
                const pushed = await this.invokeGit('push');
                if (!pushed?.success) {
                    this.setStatus(`Committed, but push failed: ${pushed.error}`, 'error');
                    return;
                }
                this.setStatus(pushed.set_upstream ? 'Pushed and upstream set.' : 'Pushed to remote.', 'success');
            }
        } catch (error) {
            this.setStatus(`Commit failed: ${error.message}`, 'error');
        } finally {
            this.endBusy();
            await this.refresh({ announce: false });
            window.projectWorkspace?.syncWorkspaceTree?.();
        }
    }

    async runRemoteOperation(action) {
        const verbs = { fetch: 'Fetching', pull: 'Pulling', push: 'Pushing' };
        this.beginBusy();
        this.setStatus(`${verbs[action] || 'Working'}…`);
        try {
            const result = await this.invokeGit(action);
            if (!result?.success) {
                this.setStatus(result?.error || `${action} failed.`, 'error');
                return;
            }
            const summary = String(result.output || '').split(/\r?\n/).filter(Boolean).pop();
            this.setStatus(summary || `${action} complete.`, 'success');
        } catch (error) {
            this.setStatus(`${action} failed: ${error.message}`, 'error');
        } finally {
            this.endBusy();
            await this.refresh({ announce: false });
            if (action !== 'fetch') {
                window.projectWorkspace?.syncWorkspaceTree?.();
            }
        }
    }

    async createBranch(options = {}) {
        const name = window.prompt('New branch name');
        if (name === null) return;
        const branch = String(name).trim();
        if (!branch) {
            this.setStatus('Branch name cannot be empty.', 'error');
            return;
        }
        if (/[\s~^:?*[\\]/.test(branch)) {
            this.setStatus('Branch names cannot contain spaces or ~ ^ : ? * [ \\ characters.', 'error');
            return;
        }

        let from = '';
        if (options.pickBase) {
            const suggestion = this.state.repo?.default_branch || this.state.repo?.branch || '';
            const base = window.prompt('Create the branch from which ref?', suggestion);
            if (base === null) return;
            from = String(base).trim();
        }

        const created = await this.runGitTask(
            'checkout',
            { branch, create: true, ...(from ? { from } : {}) },
            `Created and checked out ${branch}${from ? ` from ${from}` : ''}.`
        );
        if (created) window.projectWorkspace?.syncWorkspaceTree?.();
    }

    async checkoutBranch(branch, branchType = 'local') {
        const target = String(branch || '').trim();
        if (!target) return;

        if (branchType === 'tag') {
            const confirmed = window.confirm(
                `Check out tag ${target}?\n\nThis leaves HEAD detached — commits will not belong to a branch.`
            );
            if (!confirmed) return;
            const done = await this.runGitTask('checkout', { branch: target, detach: true }, `Checked out ${target} (detached).`);
            if (done) window.projectWorkspace?.syncWorkspaceTree?.();
            return;
        }

        const dirty = (this.state.status?.unstaged || []).some((item) => !item.untracked);
        if (dirty) {
            const confirmed = window.confirm(
                `You have uncommitted changes.\n\nGit will refuse to switch to ${target} if those changes conflict. Continue?`
            );
            if (!confirmed) {
                this.setStatus('Checkout cancelled.');
                return;
            }
        }

        const done = await this.runGitTask('checkout', { branch: target }, `Switched to ${target}.`);
        if (done) {
            if (this.el.branchSearch) this.el.branchSearch.value = '';
            this.state.branchFilter = '';
            window.projectWorkspace?.syncWorkspaceTree?.();
        }
    }

    async compareBranch(preselected = null) {
        const repo = this.state.repo;
        if (!repo?.is_repo) return;

        let base = preselected;
        if (!base) {
            const suggestion = repo.default_branch && repo.default_branch !== repo.branch
                ? repo.default_branch
                : (repo.upstream || repo.default_branch || 'main');
            const answer = window.prompt('Compare the current branch against which ref?', suggestion);
            if (answer === null) return;
            base = String(answer).trim();
        }
        if (!base) return;

        this.beginBusy();
        this.setStatus(`Comparing ${base}…`);
        try {
            const result = await this.invokeGit('compare', { base, head: 'HEAD' });
            if (!result?.success) {
                this.setStatus(result?.error || 'Compare failed.', 'error');
                return;
            }

            this.state.compare = result;
            this.showPane('branches');
            this.renderCompareResult(result);
            this.setStatus(`${result.ahead} ahead, ${result.behind} behind ${base}.`, 'success');
        } catch (error) {
            this.setStatus(`Compare failed: ${error.message}`, 'error');
        } finally {
            this.endBusy();
        }
    }

    renderCompareResult(result) {
        const container = this.el.compareResult;
        if (!container) return;

        const head = this.state.repo?.branch || 'HEAD';
        const lines = [result.diff_stat || 'No file changes between these refs.'];
        if (Array.isArray(result.commits) && result.commits.length) {
            lines.push('', `Commits only on ${head}:`, ...result.commits);
        }
        const body = lines.join('\n');

        container.innerHTML = `
            <div class="ghp-compare-title">${this.escape(result.base)} … ${this.escape(head)} — ${result.ahead} ahead, ${result.behind} behind</div>
            <pre class="ghp-compare-pre">${this.escape(body)}</pre>`;

        const webUrl = this.state.repo?.remote?.web_url;
        if (webUrl) {
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'ghp-btn';
            link.style.marginTop = '8px';
            link.textContent = 'Open comparison on the web';
            link.addEventListener('click', () => {
                this.openExternal(`${webUrl}/compare/${encodeURIComponent(result.base)}...${encodeURIComponent(head)}`);
            });
            container.appendChild(link);
        }

        container.classList.remove('hidden');
    }

    /**
     * Pull requests are a hosted-provider concept and the desktop client has no
     * GitHub token (tokens stay server-side), so this hands off to the browser
     * with the right compare / list URL rather than pretending to inline them.
     */
    async handlePullRequest() {
        const repo = this.state.repo;
        const webUrl = repo?.remote?.web_url;
        if (!webUrl) {
            this.setStatus('No web remote is configured for this repository.', 'error');
            return;
        }

        const mode = this.el.prBtn?.dataset.prMode;

        if (mode === 'list') {
            this.openExternal(`${webUrl}/pulls`);
            this.setStatus('Opened pull requests in your browser.');
            return;
        }

        if (mode === 'push-first') {
            const confirmed = window.confirm(
                `${repo.branch} has no upstream branch yet.\n\nPush it to ${repo.remotes[0] || 'origin'} now so a pull request can be opened?`
            );
            if (!confirmed) return;
            await this.runRemoteOperation('push');
            if (!this.state.repo?.upstream) return;
        }

        const base = this.state.repo?.default_branch;
        const head = this.state.repo?.branch;
        if (!head) return;

        const target = base && base !== head
            ? `${webUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`
            : `${webUrl}/pulls`;
        this.openExternal(target);
        this.setStatus('Opened the pull request page in your browser.');
    }

    async initRepository() {
        const rootPath = this.state.rootPath;
        if (!rootPath) return;

        const confirmed = window.confirm(`Initialize a new Git repository in:\n${rootPath}?`);
        if (!confirmed) return;

        await this.runGitTask('init', {}, 'Initialized an empty Git repository.');
    }

    async switchToLocal() {
        const workspace = window.projectWorkspace;
        if (!workspace?.switchToLocalMode) return;
        this.beginBusy();
        try {
            await workspace.switchToLocalMode();
        } finally {
            this.endBusy();
        }
        await this.refresh({ announce: false });
    }

    async openDiff(row) {
        const path = row.dataset.path;
        const staged = row.dataset.group === 'staged';
        const untracked = row.dataset.untracked === 'true';

        const workspace = window.projectWorkspace;
        if (!workspace?.showDiffPreview) {
            this.setStatus('Diff preview is unavailable.', 'error');
            return;
        }

        workspace.showDiffPreview(`${staged ? 'Staged diff' : 'Diff'} — ${path}`, 'Loading diff…');
        const result = await this.invokeGit('file_diff', { path, staged, untracked });

        if (!result?.success) {
            workspace.showDiffPreview(`Diff — ${path}`, result?.error || 'Unable to read diff.');
            return;
        }
        if (result.is_binary) {
            workspace.showDiffPreview(`Diff — ${path}`, '[Binary file] No textual diff available.');
            return;
        }

        const diff = String(result.diff || '').trim();
        workspace.showDiffPreview(
            `${staged ? 'Staged diff' : 'Diff'} — ${path}`,
            diff || 'No textual changes for this file.'
        );
    }

    openRemoteInBrowser() {
        const webUrl = this.state.repo?.remote?.web_url;
        if (!webUrl) {
            this.setStatus('No web remote is configured for this repository.', 'error');
            return;
        }
        this.openExternal(webUrl);
    }

    openExternal(url) {
        if (window.electron?.shell?.openExternal) {
            window.electron.shell.openExternal(url);
            return;
        }
        window.open(url, '_blank', 'noopener');
    }

    /* =================================================================
       HELPERS
       ================================================================= */

    basename(filePath) {
        if (!filePath) return '';
        const fromPreload = window.electron?.path?.basename?.(filePath);
        if (fromPreload) return fromPreload;
        return String(filePath).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
    }

    /**
     * Escapes for both text nodes and quoted attribute values. textContent
     * round-tripping alone leaves quotes intact, which would break the `title="…"`
     * attributes built by the template literals above.
     */
    escape(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    svgIcon(...paths) {
        const body = paths
            .filter(Boolean)
            .map((d) => `<path d="${d}"></path>`)
            .join('');
        return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"`
            + ` stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    }
}

const githubPanel = new GithubPanel();
window.githubPanel = githubPanel;

export default githubPanel;
