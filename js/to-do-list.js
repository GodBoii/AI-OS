// ToDoList module - Redesigned full-screen task automation panel

class ToDoList {
    constructor() {
        this.tasks = [];
        this.userContext = {
            personal: { name: '', email: '', location: '', timezone: '', language: '' },
            preferences: { workingHours: '', communicationPreference: '', notificationPreference: '', taskPrioritization: '' },
            capabilities: { allowedActions: [], restrictedDomains: [], apiKeys: {}, tools: [] },
            goals: { shortTerm: [], longTerm: [], constraints: [] },
            systemAccess: { filesystemAccess: false, networkAccess: false, apiAccess: false, credentials: {} }
        };
        this.elements = {};
        this.subscription = null;
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
        const initialDelay = 500;
        let attempt = 0;
        while (attempt < maxAttempts) {
            try {
                if (window.electron?.tasks && typeof window.electron.tasks.list === 'function') {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return;
                }
            } catch (error) { /* continue */ }
            const delay = initialDelay * Math.pow(1.2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
        }
        console.warn('App readiness check timed out, proceeding anyway');
    }

    setupSocketListeners() {
        if (window.electron?.ipcRenderer) {
            window.electron.ipcRenderer.on('task_execution_status', (data) => {
                const taskId = data.task_id;
                const status = data.status;
                const message = data.message;

                if (status === 'started' || status === 'processing') {
                    this.updateTaskCardStatus(taskId, 'processing', message);
                } else if (status === 'completed') {
                    this.showToast(message || 'Task completed!', 'success');
                    this.loadData().then(() => this.renderTasks());
                } else if (status === 'error') {
                    this.showToast(message || 'Task execution failed', 'error');
                    this.loadData().then(() => this.renderTasks());
                }
            });
        }
    }

    updateTaskCardStatus(taskId, status, message) {
        const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
        if (!card) return;
        const existing = card.querySelector('.task-card-processing');
        if (existing) existing.remove();

        if (status === 'processing') {
            const indicator = document.createElement('div');
            indicator.className = 'task-card-processing';
            indicator.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> AI working...`;
            card.querySelector('.task-card-meta')?.appendChild(indicator);
        }
    }

    cacheElements() {
        this.elements = {
            container: document.getElementById('to-do-list-container'),
            cardsArea: document.getElementById('tasks-cards-area'),
            emptyState: document.getElementById('tasks-empty-state'),
            tasksGrid: document.getElementById('tasks-grid'),
            addFab: document.getElementById('tasks-add-fab'),
            // Modal elements
            newTaskModal: document.getElementById('new-task-modal'),
            taskNameInput: document.getElementById('task-name'),
            taskDescriptionInput: document.getElementById('task-description'),
            taskScheduleTime: document.getElementById('task-schedule-time'),
            taskScheduleDate: document.getElementById('task-schedule-date'),
            taskRepeat: document.getElementById('task-repeat'),
            taskCustomIntervalGroup: document.getElementById('task-custom-interval-group'),
            taskCustomIntervalValue: document.getElementById('task-custom-interval-value'),
            taskCustomIntervalUnit: document.getElementById('task-custom-interval-unit'),
            taskToolsGrid: document.getElementById('task-tools-grid'),
            taskInstructions: document.getElementById('task-instructions'),
            taskPriorityInput: document.getElementById('task-priority'),
            taskTagsInput: document.getElementById('task-tags'),
            saveTaskBtn: document.getElementById('save-task-btn'),
            cancelTaskBtn: document.getElementById('cancel-task-btn'),
            cancelTaskBtnFooter: document.getElementById('cancel-task-btn-footer'),
            // Detail modal
            taskDetailModal: document.getElementById('task-detail-modal'),
            taskDetailTitle: document.getElementById('task-detail-title'),
            taskDetailBody: document.getElementById('task-detail-body'),
            closeTaskDetailBtn: document.getElementById('close-task-detail-btn'),
            // Context modal
            userContextModal: document.getElementById('user-context-modal'),
            saveContextBtn: document.getElementById('save-context-btn'),
            cancelContextBtn: document.getElementById('cancel-context-btn'),
            cancelContextBtnFooter: document.getElementById('cancel-context-btn-footer'),
            // Context form fields
            userNameInput: document.getElementById('user-name'),
            userEmailInput: document.getElementById('user-email'),
            userLocationInput: document.getElementById('user-location'),
            userTimezoneInput: document.getElementById('user-timezone'),
            userLanguageInput: document.getElementById('user-language'),
            workingHoursInput: document.getElementById('working-hours'),
            communicationPrefInput: document.getElementById('communication-preference'),
            notificationPrefInput: document.getElementById('notification-preference'),
            taskPrioritizationInput: document.getElementById('task-prioritization'),
            allowedActionsInput: document.getElementById('allowed-actions'),
            restrictedDomainsInput: document.getElementById('restricted-domains'),
            apiKeysInput: document.getElementById('api-keys'),
            toolsInput: document.getElementById('tools'),
            shortTermGoalsInput: document.getElementById('short-term-goals'),
            longTermGoalsInput: document.getElementById('long-term-goals'),
            constraintsInput: document.getElementById('constraints'),
            filesystemAccessInput: document.getElementById('filesystem-access'),
            networkAccessInput: document.getElementById('network-access'),
            apiAccessInput: document.getElementById('api-access'),
            credentialsInput: document.getElementById('credentials')
        };
    }

    setupEventListeners() {
        // Add task button
        this.elements.addFab?.addEventListener('click', () => this.openNewTaskModal());

        // Save/Cancel task
        this.elements.saveTaskBtn?.addEventListener('click', () => this.saveNewTask());
        this.elements.cancelTaskBtn?.addEventListener('click', () => this.closeNewTaskModal());
        this.elements.cancelTaskBtnFooter?.addEventListener('click', () => this.closeNewTaskModal());

        // Task detail modal
        this.elements.closeTaskDetailBtn?.addEventListener('click', () => this.closeTaskDetailModal());

        // Context modal
        this.elements.saveContextBtn?.addEventListener('click', () => this.saveUserContext());
        this.elements.cancelContextBtn?.addEventListener('click', () => this.closeContextModal());
        this.elements.cancelContextBtnFooter?.addEventListener('click', () => this.closeContextModal());

        // Modal overlay close
        this.elements.newTaskModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.newTaskModal) this.closeNewTaskModal();
        });
        this.elements.taskDetailModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.taskDetailModal) this.closeTaskDetailModal();
        });
        this.elements.userContextModal?.addEventListener('click', (e) => {
            if (e.target === this.elements.userContextModal) this.closeContextModal();
        });

        // Repeat select - show/hide custom interval
        this.elements.taskRepeat?.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                this.elements.taskCustomIntervalGroup?.classList.remove('hidden');
            } else {
                this.elements.taskCustomIntervalGroup?.classList.add('hidden');
            }
        });

        // Set default date to today
        if (this.elements.taskScheduleDate) {
            this.elements.taskScheduleDate.value = new Date().toISOString().split('T')[0];
        }
    }

    openNewTaskModal() {
        this.elements.newTaskModal?.classList.remove('hidden');
        this.elements.taskNameInput?.focus();
    }

    closeNewTaskModal() {
        this.elements.newTaskModal?.classList.add('hidden');
        // Reset form
        if (this.elements.taskNameInput) this.elements.taskNameInput.value = '';
        if (this.elements.taskDescriptionInput) this.elements.taskDescriptionInput.value = '';
        if (this.elements.taskScheduleTime) this.elements.taskScheduleTime.value = '09:00';
        if (this.elements.taskScheduleDate) this.elements.taskScheduleDate.value = new Date().toISOString().split('T')[0];
        if (this.elements.taskRepeat) this.elements.taskRepeat.value = 'none';
        if (this.elements.taskInstructions) this.elements.taskInstructions.value = '';
        if (this.elements.taskPriorityInput) this.elements.taskPriorityInput.value = 'medium';
        if (this.elements.taskTagsInput) this.elements.taskTagsInput.value = '';
        this.elements.taskCustomIntervalGroup?.classList.add('hidden');
        // Reset tool checkboxes - keep web search checked
        this.elements.taskToolsGrid?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = cb.value === 'internet_search';
        });
    }

    openTaskDetailModal(task) {
        this.elements.taskDetailTitle.textContent = task.text;
        this.elements.taskDetailBody.innerHTML = this.buildTaskDetailContent(task);
        this.elements.taskDetailModal?.classList.remove('hidden');

        // Highlight code blocks
        if (window.hljs) {
            this.elements.taskDetailBody.querySelectorAll('pre code').forEach((block) => {
                if (!block.dataset.highlighted) window.hljs.highlightElement(block);
            });
        }
    }

    closeTaskDetailModal() {
        this.elements.taskDetailModal?.classList.add('hidden');
    }

    buildTaskDetailContent(task) {
        let html = '<div class="task-detail-content">';

        // Status & Priority
        html += `<div class="task-detail-section">
            <div class="task-detail-section-title">Status</div>
            <div style="display:flex;gap:12px;align-items:center;">
                <span class="task-card-status ${task.status}">${task.status}</span>
                <span style="font-size:0.8rem;color:var(--text-secondary);">Priority: ${task.priority || 'medium'}</span>
            </div>
        </div>`;

        // Description
        if (task.description) {
            html += `<div class="task-detail-section">
                <div class="task-detail-section-title">Description</div>
                <div style="font-size:0.85rem;color:var(--text-primary);line-height:1.6;">${this.escapeHtml(task.description)}</div>
            </div>`;
        }

        // Schedule info
        const meta = task.metadata || {};
        if (meta.schedule_time || meta.repeat) {
            html += `<div class="task-detail-section">
                <div class="task-detail-section-title">Schedule</div>
                <div style="font-size:0.85rem;color:var(--text-primary);">`;
            if (meta.schedule_time) html += `<div>Time: ${meta.schedule_time}</div>`;
            if (meta.schedule_date) html += `<div>Start: ${meta.schedule_date}</div>`;
            if (meta.repeat && meta.repeat !== 'none') html += `<div>Repeat: ${meta.repeat}</div>`;
            html += `</div></div>`;
        }

        // Tools
        if (meta.tools && meta.tools.length > 0) {
            html += `<div class="task-detail-section">
                <div class="task-detail-section-title">Tools</div>
                <div class="task-card-tools" style="gap:6px;">
                    ${meta.tools.map(t => `<span class="task-card-tool-badge">${t}</span>`).join('')}
                </div>
            </div>`;
        }

        // Custom Instructions
        if (meta.custom_instructions) {
            html += `<div class="task-detail-section">
                <div class="task-detail-section-title">Custom Instructions</div>
                <div style="font-size:0.85rem;color:var(--text-primary);line-height:1.6;white-space:pre-wrap;">${this.escapeHtml(meta.custom_instructions)}</div>
            </div>`;
        }

        // Task Work Output
        if (task.task_work) {
            html += `<div class="task-detail-section">
                <div class="task-detail-section-title">AI Output</div>
                <div class="task-detail-work-content">${this.parseMarkdownInline(task.task_work)}</div>
            </div>`;
        }

        // Timestamps
        html += `<div class="task-detail-section">
            <div class="task-detail-section-title">Timeline</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);display:flex;flex-direction:column;gap:4px;">
                <div>Created: ${new Date(task.created_at).toLocaleString()}</div>
                ${task.completed_at ? `<div>Completed: ${new Date(task.completed_at).toLocaleString()}</div>` : ''}
            </div>
        </div>`;

        html += '</div>';
        return html;
    }

    async saveNewTask() {
        if (this.isSubmittingTask) return;
        this.isSubmittingTask = true;

        const taskName = this.elements.taskNameInput?.value.trim();
        if (!taskName) { this.isSubmittingTask = false; return; }

        // Gather selected tools
        const selectedTools = [];
        this.elements.taskToolsGrid?.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selectedTools.push(cb.value);
        });

        // Build schedule metadata
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

        const customInstructions = this.elements.taskInstructions?.value.trim() || null;

        // Compute next_run_at from schedule — CONVERT LOCAL TIME TO UTC
        let nextRunAt = null;
        if (scheduleDate && scheduleTime) {
            // Create a Date from the local date+time inputs (browser interprets as local)
            const localDate = new Date(`${scheduleDate}T${scheduleTime}:00`);
            // Convert to ISO (UTC) string
            nextRunAt = localDate.toISOString();
        } else if (scheduleTime) {
            const today = new Date().toISOString().split('T')[0];
            const localDate = new Date(`${today}T${scheduleTime}:00`);
            nextRunAt = localDate.toISOString();
        }

        // Get user's timezone offset in minutes (for recurring schedule computation)
        const tzOffsetMinutes = new Date().getTimezoneOffset(); // e.g., -330 for IST

        try {
            const newTask = await window.electron.tasks.create({
                text: taskName,
                description: this.elements.taskDescriptionInput?.value.trim() || null,
                priority: this.elements.taskPriorityInput?.value || 'medium',
                status: 'pending',
                deadline: nextRunAt,
                tags: this.elements.taskTagsInput?.value.split(',').map(tag => tag.trim()).filter(tag => tag),
                metadata: {
                    schedule_time: scheduleTime,
                    schedule_date: scheduleDate,
                    repeat: repeat,
                    custom_interval: customInterval,
                    tools: selectedTools,
                    custom_instructions: customInstructions,
                    next_run_at: nextRunAt,
                    tz_offset_minutes: tzOffsetMinutes,
                    user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    use_main_agent: true
                }
            });

            this.tasks.unshift(newTask);
            this.renderTasks();
            this.closeNewTaskModal();
            this.showToast('Task created — will run at scheduled time', 'success');
        } catch (error) {
            console.error('Error creating task:', error);
            this.showToast('Error creating task', 'error');
        } finally {
            this.isSubmittingTask = false;
        }
    }

    async deleteTask(taskId, event) {
        if (event) event.stopPropagation();
        if (this._deletingTasks?.has(taskId)) return;
        if (!this._deletingTasks) this._deletingTasks = new Set();
        this._deletingTasks.add(taskId);

        try {
            await window.electron.tasks.delete(taskId);
            this.tasks = this.tasks.filter(task => task.id !== taskId);
            this.renderTasks();
            this.showToast('Task deleted', 'success');
        } catch (error) {
            console.error('Error deleting task:', error);
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
        } catch (error) {
            console.error('Error toggling task:', error);
            this.showToast('Error updating task', 'error');
        }
    }

    renderTasks() {
        const grid = this.elements.tasksGrid;
        const emptyState = this.elements.emptyState;
        if (!grid) return;

        grid.innerHTML = '';

        if (!this.tasks || this.tasks.length === 0) {
            if (emptyState) emptyState.style.display = 'flex';
            grid.style.display = 'none';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        grid.style.display = 'grid';

        this.tasks.forEach((task) => {
            const card = document.createElement('div');
            card.className = 'task-card';
            card.dataset.id = task.id;
            card.addEventListener('click', () => this.openTaskDetailModal(task));

            const meta = task.metadata || {};

            // Header
            const header = document.createElement('div');
            header.className = 'task-card-header';

            const title = document.createElement('div');
            title.className = 'task-card-title';
            title.textContent = task.text;

            const status = document.createElement('span');
            status.className = `task-card-status ${task.status}`;
            status.textContent = task.status === 'in_progress' ? 'running' : task.status;

            header.appendChild(title);
            header.appendChild(status);
            card.appendChild(header);

            // Description
            if (task.description) {
                const desc = document.createElement('div');
                desc.className = 'task-card-description';
                desc.textContent = task.description;
                card.appendChild(desc);
            }

            // Meta row
            const metaRow = document.createElement('div');
            metaRow.className = 'task-card-meta';

            // Schedule badge
            if (meta.schedule_time) {
                const sched = document.createElement('div');
                sched.className = 'task-card-schedule';
                sched.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${meta.schedule_time}`;
                if (meta.repeat && meta.repeat !== 'none') {
                    sched.innerHTML += ` · ${meta.repeat}`;
                }
                metaRow.appendChild(sched);
            }

            // Priority
            const priorityColors = { low: '#4ade80', medium: '#fbbf24', high: '#f87171' };
            const priorityItem = document.createElement('div');
            priorityItem.className = 'task-card-meta-item';
            priorityItem.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="${priorityColors[task.priority] || '#fbbf24'}" stroke="none"><circle cx="12" cy="12" r="6"/></svg> ${task.priority || 'medium'}`;
            metaRow.appendChild(priorityItem);

            card.appendChild(metaRow);

            // Tools badges
            if (meta.tools && meta.tools.length > 0) {
                const toolsRow = document.createElement('div');
                toolsRow.className = 'task-card-tools';
                meta.tools.slice(0, 4).forEach(tool => {
                    const badge = document.createElement('span');
                    badge.className = 'task-card-tool-badge';
                    badge.textContent = tool.replace(/_/g, ' ');
                    toolsRow.appendChild(badge);
                });
                if (meta.tools.length > 4) {
                    const more = document.createElement('span');
                    more.className = 'task-card-tool-badge';
                    more.textContent = `+${meta.tools.length - 4}`;
                    toolsRow.appendChild(more);
                }
                card.appendChild(toolsRow);
            }

            // Action buttons (hover)
            const actions = document.createElement('div');
            actions.className = 'task-card-actions';

            const completeBtn = document.createElement('button');
            completeBtn.className = 'task-card-action-btn';
            completeBtn.title = task.status === 'completed' ? 'Mark pending' : 'Mark complete';
            completeBtn.innerHTML = task.status === 'completed'
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
            completeBtn.addEventListener('click', (e) => this.toggleComplete(task.id, e));

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'task-card-action-btn delete';
            deleteBtn.title = 'Delete task';
            deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
            deleteBtn.addEventListener('click', (e) => this.deleteTask(task.id, e));

            actions.appendChild(completeBtn);
            actions.appendChild(deleteBtn);
            card.appendChild(actions);

            grid.appendChild(card);
        });
    }

    async loadData() {
        try {
            this.tasks = await window.electron.tasks.list();
        } catch (error) {
            console.error('Error loading tasks:', error);
            this.showToast('Error loading tasks', 'error');
            this.tasks = [];
        }
    }

    subscribeToChanges() {
        try {
            this.subscription = window.electron.tasks.subscribe((payload) => {
                if (payload.eventType === 'INSERT') {
                    // Avoid duplicate
                    if (!this.tasks.find(t => t.id === payload.new.id)) {
                        this.tasks.unshift(payload.new);
                    }
                } else if (payload.eventType === 'UPDATE') {
                    const index = this.tasks.findIndex(t => t.id === payload.new.id);
                    if (index !== -1) this.tasks[index] = payload.new;
                } else if (payload.eventType === 'DELETE') {
                    this.tasks = this.tasks.filter(t => t.id !== payload.old.id);
                }
                this.renderTasks();
            });
        } catch (error) {
            console.error('Error subscribing to task changes:', error);
        }
    }

    // Context modal methods (kept for compatibility)
    openContextModal() {
        this.elements.userContextModal?.classList.remove('hidden');
        const ctx = this.userContext;
        if (this.elements.userNameInput) this.elements.userNameInput.value = ctx.personal.name || '';
        if (this.elements.userEmailInput) this.elements.userEmailInput.value = ctx.personal.email || '';
        if (this.elements.userLocationInput) this.elements.userLocationInput.value = ctx.personal.location || '';
        if (this.elements.userTimezoneInput) this.elements.userTimezoneInput.value = ctx.personal.timezone || '';
        if (this.elements.userLanguageInput) this.elements.userLanguageInput.value = ctx.personal.language || '';
        if (this.elements.workingHoursInput) this.elements.workingHoursInput.value = ctx.preferences.workingHours || '';
        if (this.elements.communicationPrefInput) this.elements.communicationPrefInput.value = ctx.preferences.communicationPreference || '';
        if (this.elements.notificationPrefInput) this.elements.notificationPrefInput.value = ctx.preferences.notificationPreference || '';
        if (this.elements.taskPrioritizationInput) this.elements.taskPrioritizationInput.value = ctx.preferences.taskPrioritization || '';
    }

    closeContextModal() {
        this.elements.userContextModal?.classList.add('hidden');
    }

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
                    allowedActions: (this.elements.allowedActionsInput?.value || '').split(',').map(x => x.trim()).filter(Boolean),
                    restrictedDomains: (this.elements.restrictedDomainsInput?.value || '').split(',').map(x => x.trim()).filter(Boolean),
                    apiKeys: JSON.parse(this.elements.apiKeysInput?.value || '{}'),
                    tools: (this.elements.toolsInput?.value || '').split(',').map(x => x.trim()).filter(Boolean)
                },
                goals: {
                    shortTerm: (this.elements.shortTermGoalsInput?.value || '').split(',').map(x => x.trim()).filter(Boolean),
                    longTerm: (this.elements.longTermGoalsInput?.value || '').split(',').map(x => x.trim()).filter(Boolean),
                    constraints: (this.elements.constraintsInput?.value || '').split(',').map(x => x.trim()).filter(Boolean)
                },
                systemAccess: {
                    filesystemAccess: this.elements.filesystemAccessInput?.checked || false,
                    networkAccess: this.elements.networkAccessInput?.checked || false,
                    apiAccess: this.elements.apiAccessInput?.checked || false,
                    credentials: JSON.parse(this.elements.credentialsInput?.value || '{}')
                }
            };
            await window.electron.userContext.save(this.userContext);
            this.closeContextModal();
            this.showToast('User context saved', 'success');
        } catch (error) {
            console.error('Error saving user context:', error);
            this.showToast('Error saving user context: ' + error.message, 'error');
        } finally {
            this.isSavingContext = false;
        }
    }

    // Utility methods
    parseMarkdownInline(content) {
        if (!content) return '';
        if (!window.marked) return this.escapeHtml(content).replace(/\n/g, '<br>');
        try {
            const rawHtml = window.marked.parse(content);
            if (window.DOMPurify) {
                return window.DOMPurify.sanitize(rawHtml, { ADD_TAGS: ['button', 'pre', 'code'], ADD_ATTR: ['class'] });
            }
            return rawHtml;
        } catch (e) {
            return this.escapeHtml(content).replace(/\n/g, '<br>');
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'success') {
        if (window.NotificationService && typeof window.NotificationService.show === 'function') {
            window.NotificationService.show(message, type);
        } else {
            const toast = document.createElement('div');
            toast.textContent = message;
            toast.style.cssText = `position:fixed;bottom:20px;right:20px;padding:12px 20px;background:${type === 'success' ? '#10b981' : '#ef4444'};color:white;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:100000;font-size:0.85rem;`;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    }
}

window.todo = new ToDoList();
