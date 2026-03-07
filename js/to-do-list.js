// ToDoList module - Using Supabase database via electron APIs

class ToDoList {
    constructor() {
        this.tasks = [];
        this.userContext = {
            personal: {
                name: '',
                email: '',
                location: '',
                timezone: '',
                language: ''
            },
            preferences: {
                workingHours: '',
                communicationPreference: '',
                notificationPreference: '',
                taskPrioritization: ''
            },
            capabilities: {
                allowedActions: [],
                restrictedDomains: [],
                apiKeys: {},
                tools: []
            },
            goals: {
                shortTerm: [],
                longTerm: [],
                constraints: []
            },
            systemAccess: {
                filesystemAccess: false,
                networkAccess: false,
                apiAccess: false,
                credentials: {}
            }
        };
        this.elements = {};
        this.subscription = null;
        this.migrationCompleted = false;
    }

    async init() {
        this.cacheElements();
        this.setupEventListeners();
        this.setupSocketListeners();

        // Wait for app to be fully loaded and authenticated before loading tasks
        // This prevents race conditions where auth hasn't completed yet
        await this.waitForAppReady();

        // Check if migration is needed
        await this.checkAndMigrate();

        // Load tasks from database
        await this.loadData();
        this.renderTasks();

        // Subscribe to real-time updates
        this.subscribeToChanges();
    }

    async waitForAppReady() {
        /**
         * Wait for the application to be fully loaded and authenticated.
         * This adds a delay to ensure:
         * 1. Authentication is complete
         * 2. Database connection is established
         * 3. All services are initialized
         * 
         * Uses exponential backoff to check if electron.tasks API is available
         */
        const maxAttempts = 30; // 30 attempts
        const initialDelay = 500; // Start with 500ms
        let attempt = 0;

        while (attempt < maxAttempts) {
            try {
                // Check if electron.tasks API is available (indicates app is ready)
                if (window.electron?.tasks && typeof window.electron.tasks.list === 'function') {
                    // Additional safety delay to ensure database is fully connected
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return;
                }
            } catch (error) {
                // Continue waiting
            }

            // Exponential backoff: increase delay with each attempt
            const delay = initialDelay * Math.pow(1.2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
        }

        // If we get here, log a warning but continue anyway
        console.warn('App readiness check timed out after 30 attempts, proceeding anyway');
    }

    setupSocketListeners() {
        // Listen for task execution status updates via IPC
        if (window.electron?.ipcRenderer) {
            window.electron.ipcRenderer.on('task_execution_status', (event, data) => {
                console.log('Task execution status:', data);

                const taskId = data.task_id;
                const status = data.status;
                const message = data.message;

                // Update task UI based on status
                if (status === 'started' || status === 'processing') {
                    this.showTaskProcessing(taskId, message);
                } else if (status === 'completed') {
                    this.showToast(message || 'Task completed!', 'success');
                    // Remove processing indicator
                    const taskElement = document.querySelector(`li[data-id="${taskId}"]`);
                    if (taskElement) {
                        const indicator = taskElement.querySelector('.processing-indicator');
                        if (indicator) indicator.remove();
                    }
                } else if (status === 'error') {
                    this.showToast(message || 'Task execution failed', 'error');
                    // Remove processing indicator
                    const taskElement = document.querySelector(`li[data-id="${taskId}"]`);
                    if (taskElement) {
                        const indicator = taskElement.querySelector('.processing-indicator');
                        if (indicator) indicator.remove();
                    }
                }
            });
        }
    }

    showTaskProcessing(taskId, message) {
        // Find task element and add processing indicator
        const taskElement = document.querySelector(`li[data-id="${taskId}"]`);
        if (taskElement) {
            const existingIndicator = taskElement.querySelector('.processing-indicator');
            if (!existingIndicator) {
                const indicator = document.createElement('div');
                indicator.classList.add('processing-indicator');
                indicator.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-2 fa-spin" style="margin-right: 4px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> AI is working...';
                indicator.style.cssText = 'color: #3b82f6; font-size: 12px; margin-top: 4px;';
                taskElement.querySelector('.task-details').appendChild(indicator);
            }
        }
    }

    showTaskWorkModal(task) {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.classList.add('task-work-modal-overlay');

        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.classList.add('task-work-modal-content');

        // Header
        const header = document.createElement('div');
        header.classList.add('task-work-modal-header');

        const title = document.createElement('h3');
        title.classList.add('task-work-modal-title');
        title.textContent = task.text;

        const closeBtn = document.createElement('button');
        closeBtn.classList.add('task-work-modal-close');
        closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
        closeBtn.addEventListener('click', () => modal.remove());

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Body
        const body = document.createElement('div');
        body.classList.add('task-work-modal-body');

        const workContent = document.createElement('div');
        workContent.classList.add('task-work-modal-text');

        // Format the task work content as markdown with INLINE rendering
        // (not using artifact viewer)
        const htmlContent = this.parseMarkdownInline(task.task_work);
        workContent.innerHTML = htmlContent;

        // Initialize mermaid diagrams inline
        this.initInlineMermaid(workContent);

        // Highlight code blocks if highlight.js is available
        if (window.hljs) {
            workContent.querySelectorAll('pre code').forEach((block) => {
                if (!block.dataset.highlighted) {
                    window.hljs.highlightElement(block);
                }
            });
        }

        body.appendChild(workContent);

        // Assemble modal
        modalContent.appendChild(header);
        modalContent.appendChild(body);
        modal.appendChild(modalContent);

        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);
    }

    parseMarkdownInline(content) {
        // Parse markdown with inline code/mermaid rendering (no artifact viewer)
        if (!window.marked) {
            return this.formatPlainText(content);
        }

        try {
            // Create a custom renderer for inline display
            const inlineRenderer = {
                code: (code, language = 'plaintext') => {
                    const lang = language || 'plaintext';
                    const escapedCode = this.escapeHtml(code);

                    // Handle mermaid diagrams inline
                    if (lang === 'mermaid') {
                        return `
                            <div class="task-work-mermaid-block">
                                <div class="task-work-mermaid-diagram mermaid">${escapedCode}</div>
                            </div>
                        `;
                    }

                    // Handle image references (skip them in task work)
                    if (lang === 'image') {
                        return '<div class="task-work-image-placeholder"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> Image reference</div>';
                    }

                    // Regular code blocks - render inline with syntax highlighting
                    const validLang = (window.hljs && window.hljs.getLanguage(lang)) ? lang : 'plaintext';
                    return `
                        <div class="task-work-code-block">
                            <div class="task-work-code-header">
                                <span class="task-work-code-lang">${validLang}</span>
                                <button class="task-work-copy-btn" onclick="navigator.clipboard.writeText(this.closest('.task-work-code-block').querySelector('code').textContent)">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                                </button>
                            </div>
                            <pre><code class="language-${validLang}">${escapedCode}</code></pre>
                        </div>
                    `;
                }
            };

            // Use marked with custom inline renderer
            const markedInstance = new marked.Marked();
            markedInstance.use({ renderer: inlineRenderer });

            const rawHtml = markedInstance.parse(content);

            // Sanitize if DOMPurify is available
            if (window.DOMPurify) {
                return window.DOMPurify.sanitize(rawHtml, {
                    ADD_TAGS: ['button', 'i', 'div', 'span', 'pre', 'code'],
                    ADD_ATTR: ['class', 'onclick']
                });
            }

            return rawHtml;
        } catch (error) {
            console.error('Error parsing markdown inline:', error);
            return this.formatPlainText(content);
        }
    }

    initInlineMermaid(container) {
        // Initialize mermaid diagrams within the container
        if (!window.mermaid) return;

        const mermaidBlocks = container.querySelectorAll('.task-work-mermaid-diagram');
        if (mermaidBlocks.length === 0) return;

        try {
            mermaidBlocks.forEach((block, index) => {
                const id = `task-mermaid-${Date.now()}-${index}`;
                block.id = id;
            });

            window.mermaid.init(undefined, mermaidBlocks);
        } catch (error) {
            console.error('Error initializing mermaid in task work:', error);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatPlainText(text) {
        // Basic text formatting fallback
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^(.+)$/, '<p>$1</p>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>');
    }

    async checkAndMigrate() {
        try {
            const appPath = await window.electron.ipcRenderer.invoke('get-app-path');
            const tasklistPath = window.electron.path.join(appPath, 'tasklist.txt');

            // Check if old tasklist.txt exists
            if (window.electron.fs.existsSync(tasklistPath)) {
                const tasksData = window.electron.fs.readFileSync(tasklistPath, 'utf8');
                const localTasks = JSON.parse(tasksData || '[]');

                if (localTasks.length > 0) {
                    // Migrate each task
                    let migratedCount = 0;
                    for (const task of localTasks) {
                        try {
                            await window.electron.tasks.create({
                                text: task.text,
                                description: task.description || null,
                                priority: task.priority || 'medium',
                                status: task.completed ? 'completed' : 'pending',
                                deadline: task.deadline || null,
                                tags: task.tags || [],
                                metadata: {
                                    migrated: true,
                                    original_id: task.id,
                                    original_created_at: task.createdAt
                                }
                            });
                            migratedCount++;
                        } catch (error) {
                            console.error('Error migrating task:', error);
                        }
                    }

                    // Rename the file to mark as migrated
                    const migratedPath = window.electron.path.join(appPath, 'tasklist.txt.migrated');
                    window.electron.fs.writeFileSync(migratedPath, tasksData, 'utf8');
                    window.electron.fs.unlinkSync(tasklistPath);

                    this.showToast(`Successfully migrated ${migratedCount} tasks to database`, 'success');
                    this.migrationCompleted = true;
                }
            }
        } catch (error) {
            console.error('Error during migration:', error);
            this.showToast('Error migrating tasks. Please contact support.', 'error');
        }
    }

    async loadData() {
        try {
            // Load tasks from database
            this.tasks = await window.electron.tasks.list();
        } catch (error) {
            console.error('Error loading tasks:', error);
            this.showToast('Error loading tasks from database', 'error');
            this.tasks = [];
        }
    }

    subscribeToChanges() {
        try {
            this.subscription = window.electron.tasks.subscribe((payload) => {
                // Handle different event types
                if (payload.eventType === 'INSERT') {
                    this.tasks.push(payload.new);
                } else if (payload.eventType === 'UPDATE') {
                    const index = this.tasks.findIndex(t => t.id === payload.new.id);
                    if (index !== -1) {
                        this.tasks[index] = payload.new;
                    }
                } else if (payload.eventType === 'DELETE') {
                    this.tasks = this.tasks.filter(t => t.id !== payload.old.id);
                }

                this.renderTasks();
            });
        } catch (error) {
            console.error('Error subscribing to task changes:', error);
        }
    }

    showToast(message, type = 'success') {
        // Check if NotificationService exists, otherwise create fallback toast
        if (window.NotificationService && typeof window.NotificationService.show === 'function') {
            window.NotificationService.show(message, type);
        } else {
            // Create a simple toast element as fallback
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 12px 20px;
                background: ${type === 'success' ? '#10b981' : '#ef4444'};
                color: white;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                z-index: 10000;
                animation: slideIn 0.3s ease;
            `;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    }

    cacheElements() {
        this.elements = {
            taskList: document.getElementById('task-list'),
            addTaskBtn: document.getElementById('add-task-btn'),
            contextBtn: document.getElementById('context-btn'),
            newTaskModal: document.getElementById('new-task-modal'),
            taskNameInput: document.getElementById('task-name'),
            taskDescriptionInput: document.getElementById('task-description'),
            taskPriorityInput: document.getElementById('task-priority'),
            taskDeadlineInput: document.getElementById('task-deadline'),
            taskTagsInput: document.getElementById('task-tags'),
            saveTaskBtn: document.getElementById('save-task-btn'),
            cancelTaskBtn: document.getElementById('cancel-task-btn'),
            userContextModal: document.getElementById('user-context-modal'),
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
            credentialsInput: document.getElementById('credentials'),
            saveContextBtn: document.getElementById('save-context-btn'),
            cancelContextBtn: document.getElementById('cancel-context-btn')
        };
    }

    setupEventListeners() {
        this.elements.addTaskBtn.addEventListener('click', () => this.openNewTaskModal());
        this.elements.saveTaskBtn.addEventListener('click', () => this.saveNewTask());
        this.elements.cancelTaskBtn.addEventListener('click', () => this.closeNewTaskModal());
        this.elements.contextBtn.addEventListener('click', () => this.openContextModal());
        this.elements.saveContextBtn.addEventListener('click', () => this.saveUserContext());
        this.elements.cancelContextBtn.addEventListener('click', () => this.closeContextModal());

        this.elements.newTaskModal.addEventListener('click', (e) => {
            if (e.target === this.elements.newTaskModal) this.closeNewTaskModal();
        });
        this.elements.userContextModal.addEventListener('click', (e) => {
            if (e.target === this.elements.userContextModal) this.closeContextModal();
        });
    }

    openNewTaskModal() {
        this.elements.newTaskModal.classList.remove('hidden');
        this.elements.taskNameInput.focus();
    }

    closeNewTaskModal() {
        this.elements.newTaskModal.classList.add('hidden');
        this.elements.taskNameInput.value = '';
        this.elements.taskDescriptionInput.value = '';
        this.elements.taskPriorityInput.value = 'medium';
        this.elements.taskDeadlineInput.value = '';
        this.elements.taskTagsInput.value = '';
    }

    async saveNewTask() {
        const taskName = this.elements.taskNameInput.value.trim();
        if (!taskName) return;

        try {
            const newTask = await window.electron.tasks.create({
                text: taskName,
                description: this.elements.taskDescriptionInput.value.trim() || null,
                priority: this.elements.taskPriorityInput.value || 'medium',
                status: 'pending',
                deadline: this.elements.taskDeadlineInput.value || null,
                tags: this.elements.taskTagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag)
            });

            // Add to local array (real-time subscription will also update it)
            this.tasks.unshift(newTask);
            this.renderTasks();
            this.closeNewTaskModal();
            this.showToast('Task created successfully - AI will process it shortly', 'success');
        } catch (error) {
            console.error('Error creating task:', error);
            this.showToast('Error creating task', 'error');
        }
    }

    async toggleComplete(taskId) {
        try {
            const task = this.tasks.find(t => t.id === taskId);
            if (!task) return;

            const newStatus = task.status === 'completed' ? 'pending' : 'completed';

            await window.electron.tasks.update(taskId, { status: newStatus });

            // Update local array
            const index = this.tasks.findIndex(t => t.id === taskId);
            if (index !== -1) {
                this.tasks[index].status = newStatus;
                if (newStatus === 'completed') {
                    this.tasks[index].completed_at = new Date().toISOString();
                }
            }
            this.renderTasks();
        } catch (error) {
            console.error('Error toggling task:', error);
            this.showToast('Error updating task', 'error');
        }
    }

    async deleteTask(taskId) {
        try {
            await window.electron.tasks.delete(taskId);

            // Remove from local array
            this.tasks = this.tasks.filter(task => task.id !== taskId);
            this.renderTasks();
            this.showToast('Task deleted', 'success');
        } catch (error) {
            console.error('Error deleting task:', error);
            this.showToast('Error deleting task', 'error');
        }
    }

    openContextModal() {
        this.elements.userContextModal.classList.remove('hidden');
        const context = this.userContext;
        this.elements.userNameInput.value = context.personal.name || '';
        this.elements.userEmailInput.value = context.personal.email || '';
        this.elements.userLocationInput.value = context.personal.location || '';
        this.elements.userTimezoneInput.value = context.personal.timezone || '';
        this.elements.userLanguageInput.value = context.personal.language || '';
        this.elements.workingHoursInput.value = context.preferences.workingHours || '';
        this.elements.communicationPrefInput.value = context.preferences.communicationPreference || '';
        this.elements.notificationPrefInput.value = context.preferences.notificationPreference || '';
        this.elements.taskPrioritizationInput.value = context.preferences.taskPrioritization || '';
        this.elements.allowedActionsInput.value = context.capabilities.allowedActions.join(',') || '';
        this.elements.restrictedDomainsInput.value = context.capabilities.restrictedDomains.join(',') || '';
        this.elements.apiKeysInput.value = JSON.stringify(context.capabilities.apiKeys, null, 2) || '{}';
        this.elements.toolsInput.value = context.capabilities.tools.join(',') || '';
        this.elements.shortTermGoalsInput.value = context.goals.shortTerm.join(',') || '';
        this.elements.longTermGoalsInput.value = context.goals.longTerm.join(',') || '';
        this.elements.constraintsInput.value = context.goals.constraints.join(',') || '';
        this.elements.filesystemAccessInput.checked = context.systemAccess.filesystemAccess;
        this.elements.networkAccessInput.checked = context.systemAccess.networkAccess;
        this.elements.apiAccessInput.checked = context.systemAccess.apiAccess;
        this.elements.credentialsInput.value = JSON.stringify(context.systemAccess.credentials, null, 2) || '{}';
    }

    closeContextModal() {
        this.elements.userContextModal.classList.add('hidden');
    }

    async saveUserContext() {
        try {
            this.userContext = {
                personal: {
                    name: this.elements.userNameInput.value.trim(),
                    email: this.elements.userEmailInput.value.trim(),
                    location: this.elements.userLocationInput.value.trim(),
                    timezone: this.elements.userTimezoneInput.value.trim(),
                    language: this.elements.userLanguageInput.value.trim()
                },
                preferences: {
                    workingHours: this.elements.workingHoursInput.value.trim(),
                    communicationPreference: this.elements.communicationPrefInput.value,
                    notificationPreference: this.elements.notificationPrefInput.value,
                    taskPrioritization: this.elements.taskPrioritizationInput.value
                },
                capabilities: {
                    allowedActions: this.elements.allowedActionsInput.value.split(',').map(x => x.trim()).filter(Boolean),
                    restrictedDomains: this.elements.restrictedDomainsInput.value.split(',').map(x => x.trim()).filter(Boolean),
                    apiKeys: JSON.parse(this.elements.apiKeysInput.value || '{}'),
                    tools: this.elements.toolsInput.value.split(',').map(x => x.trim()).filter(Boolean)
                },
                goals: {
                    shortTerm: this.elements.shortTermGoalsInput.value.split(',').map(x => x.trim()).filter(Boolean),
                    longTerm: this.elements.longTermGoalsInput.value.split(',').map(x => x.trim()).filter(Boolean),
                    constraints: this.elements.constraintsInput.value.split(',').map(x => x.trim()).filter(Boolean)
                },
                systemAccess: {
                    filesystemAccess: this.elements.filesystemAccessInput.checked,
                    networkAccess: this.elements.networkAccessInput.checked,
                    apiAccess: this.elements.apiAccessInput.checked,
                    credentials: JSON.parse(this.elements.credentialsInput.value || '{}')
                }
            };

            // Save to database via backend API
            await window.electron.userContext.save(this.userContext);

            this.closeContextModal();
            this.showToast('User context saved successfully', 'success');
        } catch (error) {
            console.error('Error saving user context:', error);
            this.showToast('Error saving user context: ' + error.message, 'error');
        }
    }

    renderTasks() {
        this.elements.taskList.innerHTML = '';
        this.tasks.forEach((task) => {
            const listItem = document.createElement('li');
            listItem.dataset.id = task.id;

            // Handle status field (database) instead of completed field (old local)
            const isCompleted = task.status === 'completed';
            if (isCompleted) listItem.classList.add('completed');
            if (task.priority) listItem.dataset.priority = task.priority;

            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.classList.add('checkbox-wrapper');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isCompleted;
            checkbox.id = `checkbox-${task.id}`;
            checkbox.addEventListener('change', () => this.toggleComplete(task.id));

            const checkmark = document.createElement('label');
            checkmark.classList.add('checkmark');
            checkmark.htmlFor = checkbox.id;
            checkmark.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><path d="M20 6 9 17l-5-5"/></svg>';

            checkboxWrapper.appendChild(checkbox);
            checkboxWrapper.appendChild(checkmark);

            const taskDetails = document.createElement('div');
            taskDetails.classList.add('task-details');

            const taskText = document.createElement('span');
            taskText.classList.add('task-text');
            taskText.textContent = task.text;
            taskDetails.appendChild(taskText);

            if (task.description) {
                const description = document.createElement('span');
                description.classList.add('task-description');
                description.textContent = task.description;
                taskDetails.appendChild(description);
            }

            if (task.deadline) {
                const deadline = document.createElement('div');
                deadline.classList.add('task-deadline');
                deadline.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock" style="margin-right:4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${new Date(task.deadline).toLocaleString()}`;
                taskDetails.appendChild(deadline);
            }

            if (task.tags && task.tags.length > 0) {
                const tagsContainer = document.createElement('div');
                tagsContainer.classList.add('task-tags');
                task.tags.forEach(tag => {
                    const tagElement = document.createElement('span');
                    tagElement.classList.add('task-tag');
                    tagElement.textContent = tag;
                    tagsContainer.appendChild(tagElement);
                });
                taskDetails.appendChild(tagsContainer);
            }

            // Show AI indicator if task was created by AI (has session_id)
            if (task.session_id) {
                const aiIndicator = document.createElement('span');
                aiIndicator.classList.add('ai-indicator');
                aiIndicator.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot" style="margin-right:4px;"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg> AI Created';
                aiIndicator.title = `Created by AI in session ${task.session_id}`;
                taskDetails.appendChild(aiIndicator);
            }

            const buttonContainer = document.createElement('div');
            buttonContainer.classList.add('button-container');

            // Show "View Work" button if task work is available (add to button container)
            if (task.task_work) {
                const viewWorkButton = document.createElement('button');
                viewWorkButton.classList.add('view-work-btn');
                viewWorkButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text" style="stroke-width: 2.5px;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg><span>View Work</span>';
                viewWorkButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showTaskWorkModal(task);
                });
                buttonContainer.appendChild(viewWorkButton);
            }

            const deleteButton = document.createElement('button');
            deleteButton.classList.add('delete-btn');
            deleteButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
            deleteButton.addEventListener('click', () => this.deleteTask(task.id));

            buttonContainer.appendChild(deleteButton);

            listItem.appendChild(checkboxWrapper);
            listItem.appendChild(taskDetails);
            listItem.appendChild(buttonContainer);

            this.elements.taskList.appendChild(listItem);
        });
    }
}

window.todo = new ToDoList();