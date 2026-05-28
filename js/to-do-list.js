// ToDoList — Minimalist amber design, mail-style output panel

class ToDoList {
    constructor() {
        this.tasks = [];
        this.userContext = {
            personal: { name:'', email:'', location:'', timezone:'', language:'' },
            preferences: { workingHours:'', communicationPreference:'', notificationPreference:'', taskPrioritization:'' },
            capabilities: { allowedActions:[], restrictedDomains:[], apiKeys:{}, tools:[] },
            goals: { shortTerm:[], longTerm:[], constraints:[] },
            systemAccess: { filesystemAccess:false, networkAccess:false, apiAccess:false, credentials:{} }
        };
        this.elements = {};
        this.subscription = null;
        this._outputPanelOpen = false;
    }

    async init() {
        this.cacheElements();
        this.setupEventListeners();
        this.setupSocketListeners();
        await this.waitForAppReady();
        await this.loadData();
        this.renderTasks();
        this.subscribeToChanges();
    }

    async waitForAppReady() {
        const maxAttempts = 30;
        let attempt = 0;
        while (attempt < maxAttempts) {
            try {
                if (window.electron?.tasks && typeof window.electron.tasks.list === 'function') {
                    await new Promise(r => setTimeout(r, 800));
                    return;
                }
            } catch (_) {}
            await new Promise(r => setTimeout(r, 500 * Math.pow(1.2, attempt)));
            attempt++;
        }
    }

    setupSocketListeners() {
        if (!window.electron?.ipcRenderer) return;
        window.electron.ipcRenderer.on('task_execution_status', (data) => {
            const { task_id, status, message } = data;
            if (status === 'started' || status === 'processing') {
                this._setCardProcessing(task_id, true);
            } else if (status === 'completed') {
                this._setCardProcessing(task_id, false);
                this.showToast(message || 'Task completed', 'success');
                this.loadData().then(() => this.renderTasks());
            } else if (status === 'error') {
                this._setCardProcessing(task_id, false);
                this.showToast(message || 'Task failed', 'error');
                this.loadData().then(() => this.renderTasks());
            }
        });
    }

    _setCardProcessing(taskId, on) {
        const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
        if (!card) return;
        const existing = card.querySelector('.task-card-processing');
        if (existing) existing.remove();
        if (on) {
            const el = document.createElement('div');
            el.className = 'task-card-processing';
            el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Running…`;
            card.querySelector('.task-card-meta')?.appendChild(el);
        }
    }

    cacheElements() {
        const g = id => document.getElementById(id);
        this.elements = {
            container: g('to-do-list-container'),
            emptyState: g('tasks-empty-state'),
            tasksGrid: g('tasks-grid'),
            addFab: g('tasks-add-fab'),
            // Create modal
            newTaskModal: g('new-task-modal'),
            taskNameInput: g('task-name'),
            taskDescriptionInput: g('task-description'),
            taskScheduleTime: g('task-schedule-time'),
            taskScheduleDate: g('task-schedule-date'),
            taskRepeat: g('task-repeat'),
            taskCustomIntervalGroup: g('task-custom-interval-group'),
            taskCustomIntervalValue: g('task-custom-interval-value'),
            taskCustomIntervalUnit: g('task-custom-interval-unit'),
            taskToolsGrid: g('task-tools-grid'),
            taskInstructions: g('task-instructions'),
            taskPriorityInput: g('task-priority'),
            taskTagsInput: g('task-tags'),
            saveTaskBtn: g('save-task-btn'),
            cancelTaskBtn: g('cancel-task-btn'),
            cancelTaskBtnFooter: g('cancel-task-btn-footer'),
            // Detail modal
            taskDetailModal: g('task-detail-modal'),
            taskDetailTitle: g('task-detail-title'),
            taskDetailBody: g('task-detail-body'),
            closeTaskDetailBtn: g('close-task-detail-btn'),
            // Output panel
            outputPanel: g('task-output-panel'),
            outputBackdrop: g('task-output-backdrop'),
            outputPanelTitle: g('task-output-panel-title'),
            outputPanelMeta: g('task-output-panel-meta'),
            outputPanelContent: g('task-output-content'),
            outputPanelClose: g('task-output-panel-close'),
            outputPanelDownload: g('task-output-panel-download'),
            // Context modal
            userContextModal: g('user-context-modal'),
            saveContextBtn: g('save-context-btn'),
            cancelContextBtn: g('cancel-context-btn'),
            cancelContextBtnFooter: g('cancel-context-btn-footer'),
            userNameInput: g('user-name'), userEmailInput: g('user-email'),
            userLocationInput: g('user-location'), userTimezoneInput: g('user-timezone'),
            userLanguageInput: g('user-language'), workingHoursInput: g('working-hours'),
            communicationPrefInput: g('communication-preference'),
            notificationPrefInput: g('notification-preference'),
            taskPrioritizationInput: g('task-prioritization'),
            allowedActionsInput: g('allowed-actions'), restrictedDomainsInput: g('restricted-domains'),
            apiKeysInput: g('api-keys'), toolsInput: g('tools'),
            shortTermGoalsInput: g('short-term-goals'), longTermGoalsInput: g('long-term-goals'),
            constraintsInput: g('constraints'), filesystemAccessInput: g('filesystem-access'),
            networkAccessInput: g('network-access'), apiAccessInput: g('api-access'),
            credentialsInput: g('credentials')
        };
    }

    setupEventListeners() {
        this.elements.addFab?.addEventListener('click', () => this.openNewTaskModal());
        this.elements.saveTaskBtn?.addEventListener('click', () => this.saveNewTask());
        this.elements.cancelTaskBtn?.addEventListener('click', () => this.closeNewTaskModal());
        this.elements.cancelTaskBtnFooter?.addEventListener('click', () => this.closeNewTaskModal());
        this.elements.closeTaskDetailBtn?.addEventListener('click', () => this.closeTaskDetailModal());
        this.elements.outputPanelClose?.addEventListener('click', () => this.closeOutputPanel());
        this.elements.outputPanelDownload?.addEventListener('click', () => this._downloadOutput());
        this.elements.outputBackdrop?.addEventListener('click', () => this.closeOutputPanel());
        this.elements.saveContextBtn?.addEventListener('click', () => this.saveUserContext());
        this.elements.cancelContextBtn?.addEventListener('click', () => this.closeContextModal());
        this.elements.cancelContextBtnFooter?.addEventListener('click', () => this.closeContextModal());

        // Close modals on overlay click
        this.elements.newTaskModal?.addEventListener('click', e => { if (e.target === this.elements.newTaskModal) this.closeNewTaskModal(); });
        this.elements.taskDetailModal?.addEventListener('click', e => { if (e.target === this.elements.taskDetailModal) this.closeTaskDetailModal(); });
        this.elements.userContextModal?.addEventListener('click', e => { if (e.target === this.elements.userContextModal) this.closeContextModal(); });

        // Custom interval toggle
        this.elements.taskRepeat?.addEventListener('change', e => {
            const show = e.target.value === 'custom';
            if (this.elements.taskCustomIntervalGroup) {
                this.elements.taskCustomIntervalGroup.style.display = show ? 'block' : 'none';
            }
        });

        // Default date
        if (this.elements.taskScheduleDate) {
            this.elements.taskScheduleDate.value = new Date().toISOString().split('T')[0];
        }
    }

    // ── Output Panel ──────────────────────────────────────────────────────
    openOutputPanel(task) {
        const panel = this.elements.outputPanel;
        if (!panel) return;

        // Store current task for download
        this._currentOutputTask = task;

        // Title
        this.elements.outputPanelTitle.textContent = task.text;

        // Meta chips
        const meta = task.metadata || {};
        const chips = [];
        chips.push(`<span class="task-output-panel-meta-chip task-card-status ${task.status}">${task.status}</span>`);
        if (meta.schedule_time) chips.push(`<span class="task-output-panel-meta-chip">${meta.schedule_time}${meta.repeat && meta.repeat !== 'none' ? ' · ' + meta.repeat : ''}</span>`);
        if (meta.tools?.length) chips.push(`<span class="task-output-panel-meta-chip">${meta.tools.join(', ')}</span>`);
        this.elements.outputPanelMeta.innerHTML = chips.join('');

        // Content
        if (task.task_work) {
            this.elements.outputPanelContent.innerHTML = this.parseMarkdownInline(task.task_work);
            if (window.hljs) {
                this.elements.outputPanelContent.querySelectorAll('pre code').forEach(b => {
                    if (!b.dataset.highlighted) window.hljs.highlightElement(b);
                });
            }
        } else {
            this.elements.outputPanelContent.innerHTML = `
                <div class="task-output-no-content">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
                    No output yet — task hasn't run
                </div>`;
        }

        // Show backdrop + panel
        this.elements.outputBackdrop?.classList.add('visible');
        panel.classList.add('visible');
        this._outputPanelOpen = true;
    }

    closeOutputPanel() {
        this.elements.outputPanel?.classList.remove('visible');
        this.elements.outputBackdrop?.classList.remove('visible');
        this._outputPanelOpen = false;
        this._currentOutputTask = null;
    }

    _downloadOutput() {
        const task = this._currentOutputTask;
        if (!task?.task_work) return;

        // Sanitize filename from task title
        const filename = (task.text || 'task-output')
            .replace(/[^a-z0-9\s\-_]/gi, '')
            .trim()
            .replace(/\s+/g, '-')
            .toLowerCase()
            .slice(0, 80) + '.md';

        // Build markdown content with header
        const meta = task.metadata || {};
        const header = [
            `# ${task.text}`,
            ``,
            `**Status:** ${task.status}  `,
            meta.schedule_time ? `**Schedule:** ${meta.schedule_time}${meta.repeat && meta.repeat !== 'none' ? ' · ' + meta.repeat : ''}  ` : '',
            meta.tools?.length ? `**Tools:** ${meta.tools.join(', ')}  ` : '',
            `**Generated:** ${new Date().toLocaleString()}`,
            ``,
            `---`,
            ``
        ].filter(Boolean).join('\n');

        const content = header + task.task_work;
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showToast('Report downloaded', 'success');
    }

    // ── Detail Modal (compact info, no output) ────────────────────────────
    openTaskDetailModal(task) {
        if (!this.elements.taskDetailTitle || !this.elements.taskDetailBody) return;
        this.elements.taskDetailTitle.textContent = task.text;
        this.elements.taskDetailBody.innerHTML = this._buildDetailContent(task);
        this.elements.taskDetailModal?.classList.remove('hidden');
    }

    closeTaskDetailModal() {
        this.elements.taskDetailModal?.classList.add('hidden');
    }

    _buildDetailContent(task) {
        const meta = task.metadata || {};
        const esc = s => this.escapeHtml(s || '');
        let html = '<div class="task-detail-content">';

        // Status + priority in one row
        html += `<div class="task-detail-row">
            <span class="task-detail-row-label">Status</span>
            <span class="task-card-status ${task.status}">${task.status}</span>
            <span class="task-detail-row-label" style="margin-left:8px">Priority</span>
            <span class="task-detail-row-value">${task.priority || 'medium'}</span>
        </div>`;

        if (task.description) {
            html += `<div class="task-detail-row"><span class="task-detail-row-label">Desc</span><span class="task-detail-row-value">${esc(task.description)}</span></div>`;
        }
        if (meta.schedule_time) {
            const sched = `${meta.schedule_time}${meta.schedule_date ? ' · ' + meta.schedule_date : ''}${meta.repeat && meta.repeat !== 'none' ? ' · ' + meta.repeat : ''}`;
            html += `<div class="task-detail-row"><span class="task-detail-row-label">Schedule</span><span class="task-detail-row-value">${sched}</span></div>`;
        }
        if (meta.tools?.length) {
            html += `<div class="task-detail-row"><span class="task-detail-row-label">Tools</span><div class="task-card-tools">${meta.tools.map(t => `<span class="task-card-tool-badge">${t.replace(/_/g,' ')}</span>`).join('')}</div></div>`;
        }
        if (meta.custom_instructions) {
            html += `<div class="task-detail-row" style="flex-direction:column;align-items:flex-start;gap:4px"><span class="task-detail-row-label">Instructions</span><span class="task-detail-row-value" style="white-space:pre-wrap">${esc(meta.custom_instructions)}</span></div>`;
        }
        if (meta.user_timezone) {
            html += `<div class="task-detail-row"><span class="task-detail-row-label">Timezone</span><span class="task-detail-row-value">${esc(meta.user_timezone)}</span></div>`;
        }
        html += `<div class="task-detail-row"><span class="task-detail-row-label">Created</span><span class="task-detail-row-value">${new Date(task.created_at).toLocaleString()}</span></div>`;
        if (task.completed_at) {
            html += `<div class="task-detail-row"><span class="task-detail-row-label">Completed</span><span class="task-detail-row-value">${new Date(task.completed_at).toLocaleString()}</span></div>`;
        }

        html += '</div>';
        return html;
    }

    // ── Render ────────────────────────────────────────────────────────────
    renderTasks() {
        const grid = this.elements.tasksGrid;
        const empty = this.elements.emptyState;
        if (!grid) return;
        grid.innerHTML = '';

        if (!this.tasks?.length) {
            if (empty) empty.style.display = 'flex';
            grid.style.display = 'none';
            return;
        }
        if (empty) empty.style.display = 'none';
        grid.style.display = 'grid';

        this.tasks.forEach((task, i) => {
            const card = this._buildCard(task, i);
            grid.appendChild(card);
        });
    }

    _buildCard(task, index) {
        const meta = task.metadata || {};
        const card = document.createElement('div');
        card.className = 'task-card';
        card.dataset.id = task.id;
        // Staggered entrance
        card.style.animationDelay = `${index * 55}ms`;

        // Click card body → detail modal
        card.addEventListener('click', () => this.openTaskDetailModal(task));

        // ── Header ──
        const header = document.createElement('div');
        header.className = 'task-card-header';

        const title = document.createElement('div');
        title.className = 'task-card-title';
        title.textContent = task.text;

        const statusBadge = document.createElement('span');
        statusBadge.className = `task-card-status ${task.status}`;
        statusBadge.textContent = task.status === 'in_progress' ? 'running' : task.status;

        header.appendChild(title);
        header.appendChild(statusBadge);
        card.appendChild(header);

        // ── Description ──
        if (task.description) {
            const desc = document.createElement('div');
            desc.className = 'task-card-description';
            desc.textContent = task.description;
            card.appendChild(desc);
        }

        // ── Meta row ──
        const metaRow = document.createElement('div');
        metaRow.className = 'task-card-meta';

        if (meta.schedule_time) {
            const sched = document.createElement('div');
            sched.className = 'task-card-schedule';
            sched.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${meta.schedule_time}${meta.repeat && meta.repeat !== 'none' ? ' · ' + meta.repeat : ''}`;
            metaRow.appendChild(sched);
        }

        const priorityDot = { low:'#4ade80', medium:'#f59e0b', high:'#f87171' };
        const pri = document.createElement('div');
        pri.className = 'task-card-meta-item';
        pri.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="${priorityDot[task.priority]||'#f59e0b'}" stroke="none"><circle cx="12" cy="12" r="8"/></svg>${task.priority||'medium'}`;
        metaRow.appendChild(pri);

        card.appendChild(metaRow);

        // ── Tool badges ──
        if (meta.tools?.length) {
            const toolsRow = document.createElement('div');
            toolsRow.className = 'task-card-tools';
            meta.tools.slice(0, 3).forEach(t => {
                const b = document.createElement('span');
                b.className = 'task-card-tool-badge';
                b.textContent = t.replace(/_/g, ' ');
                toolsRow.appendChild(b);
            });
            if (meta.tools.length > 3) {
                const more = document.createElement('span');
                more.className = 'task-card-tool-badge';
                more.textContent = `+${meta.tools.length - 3}`;
                toolsRow.appendChild(more);
            }
            card.appendChild(toolsRow);
        }

        // ── Action buttons (appear on hover) ──
        const actions = document.createElement('div');
        actions.className = 'task-card-actions';

        // View output button (file icon) — only if has output
        if (task.task_work) {
            const viewBtn = document.createElement('button');
            viewBtn.className = 'task-card-action-btn view-output';
            viewBtn.title = 'View AI output';
            viewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;
            viewBtn.addEventListener('click', e => { e.stopPropagation(); this.openOutputPanel(task); });
            actions.appendChild(viewBtn);
        }

        // Complete toggle
        const completeBtn = document.createElement('button');
        completeBtn.className = 'task-card-action-btn';
        completeBtn.title = task.status === 'completed' ? 'Mark pending' : 'Mark complete';
        completeBtn.innerHTML = task.status === 'completed'
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
        completeBtn.addEventListener('click', e => this.toggleComplete(task.id, e));

        // Delete
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'task-card-action-btn delete';
        deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
        deleteBtn.addEventListener('click', e => this.deleteTask(task.id, e));

        actions.appendChild(completeBtn);
        actions.appendChild(deleteBtn);
        card.appendChild(actions);

        return card;
    }

    // ── CRUD ──────────────────────────────────────────────────────────────
    openNewTaskModal() {
        this.elements.newTaskModal?.classList.remove('hidden');
        setTimeout(() => this.elements.taskNameInput?.focus(), 50);
    }

    closeNewTaskModal() {
        this.elements.newTaskModal?.classList.add('hidden');
        if (this.elements.taskNameInput) this.elements.taskNameInput.value = '';
        if (this.elements.taskDescriptionInput) this.elements.taskDescriptionInput.value = '';
        if (this.elements.taskScheduleTime) this.elements.taskScheduleTime.value = '09:00';
        if (this.elements.taskScheduleDate) this.elements.taskScheduleDate.value = new Date().toISOString().split('T')[0];
        if (this.elements.taskRepeat) this.elements.taskRepeat.value = 'none';
        if (this.elements.taskInstructions) this.elements.taskInstructions.value = '';
        if (this.elements.taskPriorityInput) this.elements.taskPriorityInput.value = 'medium';
        if (this.elements.taskTagsInput) this.elements.taskTagsInput.value = '';
        if (this.elements.taskCustomIntervalGroup) this.elements.taskCustomIntervalGroup.style.display = 'none';
        this.elements.taskToolsGrid?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = cb.value === 'internet_search';
        });
    }

    async saveNewTask() {
        if (this.isSubmittingTask) return;
        this.isSubmittingTask = true;
        const taskName = this.elements.taskNameInput?.value.trim();
        if (!taskName) { this.isSubmittingTask = false; return; }

        const selectedTools = [];
        this.elements.taskToolsGrid?.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => selectedTools.push(cb.value));

        const scheduleTime = this.elements.taskScheduleTime?.value || null;
        const scheduleDate = this.elements.taskScheduleDate?.value || null;
        const repeat = this.elements.taskRepeat?.value || 'none';
        let customInterval = null;
        if (repeat === 'custom') {
            customInterval = {
                value: parseInt(this.elements.taskCustomIntervalValue?.value) || 2,
                unit: this.elements.taskCustomIntervalUnit?.value || 'days'
            };
        }

        // Convert local time → UTC ISO string
        let nextRunAt = null;
        if (scheduleDate && scheduleTime) {
            nextRunAt = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
        } else if (scheduleTime) {
            const today = new Date().toISOString().split('T')[0];
            nextRunAt = new Date(`${today}T${scheduleTime}:00`).toISOString();
        }

        try {
            const newTask = await window.electron.tasks.create({
                text: taskName,
                description: this.elements.taskDescriptionInput?.value.trim() || null,
                priority: this.elements.taskPriorityInput?.value || 'medium',
                status: 'pending',
                deadline: nextRunAt,
                tags: (this.elements.taskTagsInput?.value || '').split(',').map(t => t.trim()).filter(Boolean),
                metadata: {
                    schedule_time: scheduleTime,
                    schedule_date: scheduleDate,
                    repeat, custom_interval: customInterval,
                    tools: selectedTools,
                    custom_instructions: this.elements.taskInstructions?.value.trim() || null,
                    next_run_at: nextRunAt,
                    tz_offset_minutes: new Date().getTimezoneOffset(),
                    user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    use_main_agent: true
                }
            });
            this.tasks.unshift(newTask);
            this.renderTasks();
            this.closeNewTaskModal();
            this.showToast('Task created', 'success');
        } catch (err) {
            console.error('Error creating task:', err);
            this.showToast('Error creating task', 'error');
        } finally {
            this.isSubmittingTask = false;
        }
    }

    async deleteTask(taskId, event) {
        if (event) event.stopPropagation();
        if (!this._deletingTasks) this._deletingTasks = new Set();
        if (this._deletingTasks.has(taskId)) return;
        this._deletingTasks.add(taskId);
        try {
            await window.electron.tasks.delete(taskId);
            this.tasks = this.tasks.filter(t => t.id !== taskId);
            this.renderTasks();
            this.showToast('Task deleted', 'success');
        } catch (err) {
            this.showToast('Error deleting task', 'error');
        } finally {
            this._deletingTasks.delete(taskId);
        }
    }

    async toggleComplete(taskId, event) {
        if (event) event.stopPropagation();
        try {
            const task = this.tasks.find(t => t.id === taskId);
            if (!task) return;
            const newStatus = task.status === 'completed' ? 'pending' : 'completed';
            await window.electron.tasks.update(taskId, { status: newStatus });
            const idx = this.tasks.findIndex(t => t.id === taskId);
            if (idx !== -1) {
                this.tasks[idx].status = newStatus;
                if (newStatus === 'completed') this.tasks[idx].completed_at = new Date().toISOString();
            }
            this.renderTasks();
        } catch (err) {
            this.showToast('Error updating task', 'error');
        }
    }

    async loadData() {
        try {
            this.tasks = await window.electron.tasks.list();
        } catch (err) {
            console.error('Error loading tasks:', err);
            this.tasks = [];
        }
    }

    subscribeToChanges() {
        try {
            this.subscription = window.electron.tasks.subscribe((payload) => {
                if (payload.eventType === 'INSERT') {
                    if (!this.tasks.find(t => t.id === payload.new.id)) this.tasks.unshift(payload.new);
                } else if (payload.eventType === 'UPDATE') {
                    const idx = this.tasks.findIndex(t => t.id === payload.new.id);
                    if (idx !== -1) this.tasks[idx] = payload.new;
                } else if (payload.eventType === 'DELETE') {
                    this.tasks = this.tasks.filter(t => t.id !== payload.old.id);
                }
                this.renderTasks();
            });
        } catch (err) {
            console.error('Error subscribing:', err);
        }
    }

    // ── Context modal ─────────────────────────────────────────────────────
    openContextModal() {
        this.elements.userContextModal?.classList.remove('hidden');
        const c = this.userContext;
        if (this.elements.userNameInput) this.elements.userNameInput.value = c.personal.name || '';
        if (this.elements.userEmailInput) this.elements.userEmailInput.value = c.personal.email || '';
        if (this.elements.userLocationInput) this.elements.userLocationInput.value = c.personal.location || '';
        if (this.elements.userTimezoneInput) this.elements.userTimezoneInput.value = c.personal.timezone || '';
        if (this.elements.userLanguageInput) this.elements.userLanguageInput.value = c.personal.language || '';
    }
    closeContextModal() { this.elements.userContextModal?.classList.add('hidden'); }

    async saveUserContext() {
        if (this.isSavingContext) return;
        this.isSavingContext = true;
        try {
            this.userContext = {
                personal: {
                    name: this.elements.userNameInput?.value.trim() || '',
                    email: this.elements.userEmailInput?.value.trim() || '',
                    location: this.elements.userLocationInput?.value.trim() || '',
                    timezone: this.elements.userTimezoneInput?.value.trim() || '',
                    language: this.elements.userLanguageInput?.value.trim() || ''
                },
                preferences: {
                    workingHours: this.elements.workingHoursInput?.value.trim() || '',
                    communicationPreference: this.elements.communicationPrefInput?.value || '',
                    notificationPreference: this.elements.notificationPrefInput?.value || '',
                    taskPrioritization: this.elements.taskPrioritizationInput?.value || ''
                },
                capabilities: {
                    allowedActions: (this.elements.allowedActionsInput?.value||'').split(',').map(x=>x.trim()).filter(Boolean),
                    restrictedDomains: (this.elements.restrictedDomainsInput?.value||'').split(',').map(x=>x.trim()).filter(Boolean),
                    apiKeys: JSON.parse(this.elements.apiKeysInput?.value||'{}'),
                    tools: (this.elements.toolsInput?.value||'').split(',').map(x=>x.trim()).filter(Boolean)
                },
                goals: {
                    shortTerm: (this.elements.shortTermGoalsInput?.value||'').split(',').map(x=>x.trim()).filter(Boolean),
                    longTerm: (this.elements.longTermGoalsInput?.value||'').split(',').map(x=>x.trim()).filter(Boolean),
                    constraints: (this.elements.constraintsInput?.value||'').split(',').map(x=>x.trim()).filter(Boolean)
                },
                systemAccess: {
                    filesystemAccess: this.elements.filesystemAccessInput?.checked||false,
                    networkAccess: this.elements.networkAccessInput?.checked||false,
                    apiAccess: this.elements.apiAccessInput?.checked||false,
                    credentials: JSON.parse(this.elements.credentialsInput?.value||'{}')
                }
            };
            await window.electron.userContext.save(this.userContext);
            this.closeContextModal();
            this.showToast('Context saved', 'success');
        } catch (err) {
            this.showToast('Error: ' + err.message, 'error');
        } finally {
            this.isSavingContext = false;
        }
    }

    // ── Utilities ─────────────────────────────────────────────────────────
    parseMarkdownInline(content) {
        if (!content) return '';
        if (!window.marked) return this.escapeHtml(content).replace(/\n/g, '<br>');
        try {
            const html = window.marked.parse(content);
            return window.DOMPurify ? window.DOMPurify.sanitize(html, { ADD_TAGS:['pre','code'], ADD_ATTR:['class'] }) : html;
        } catch (_) {
            return this.escapeHtml(content).replace(/\n/g, '<br>');
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    showToast(message, type = 'success') {
        if (window.NotificationService?.show) {
            window.NotificationService.show(message, type);
            return;
        }
        const t = document.createElement('div');
        t.textContent = message;
        t.style.cssText = `position:fixed;bottom:20px;right:20px;padding:10px 18px;background:${type==='success'?'#f59e0b':'#ef4444'};color:${type==='success'?'#000':'#fff'};border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3);z-index:100000;font-size:0.82rem;font-weight:500;`;
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(()=>t.remove(),300); }, 2800);
    }
}

window.todo = new ToDoList();
