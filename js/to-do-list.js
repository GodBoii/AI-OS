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
        
        // Check if migration is needed
        await this.checkAndMigrate();
        
        // Load tasks from database
        await this.loadData();
        this.renderTasks();
        
        // Subscribe to real-time updates
        this.subscribeToChanges();
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
                indicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AI is working...';
                indicator.style.cssText = 'color: #3b82f6; font-size: 12px; margin-top: 4px;';
                taskElement.querySelector('.task-details').appendChild(indicator);
            }
        }
    }

    showTaskWorkModal(task) {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.classList.add('task-work-modal');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            padding: 20px;
        `;
        
        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            border-radius: 12px;
            max-width: 800px;
            width: 100%;
            max-height: 80vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        `;
        
        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 20px 24px;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const title = document.createElement('h3');
        title.style.cssText = 'margin: 0; font-size: 18px; color: #1e293b;';
        title.textContent = task.text;
        
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            font-size: 20px;
            color: #64748b;
            cursor: pointer;
            padding: 4px 8px;
        `;
        closeBtn.addEventListener('click', () => modal.remove());
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        
        // Body
        const body = document.createElement('div');
        body.style.cssText = `
            padding: 24px;
            overflow-y: auto;
            flex: 1;
        `;
        
        const workContent = document.createElement('div');
        workContent.style.cssText = `
            font-size: 14px;
            line-height: 1.8;
            color: #334155;
            white-space: pre-wrap;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        workContent.textContent = task.task_work;
        
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
            checkmark.innerHTML = '<i class="fas fa-check"></i>';

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
                deadline.innerHTML = `<i class="fas fa-clock"></i>${new Date(task.deadline).toLocaleString()}`;
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
                aiIndicator.innerHTML = '<i class="fas fa-robot"></i> AI Created';
                aiIndicator.title = `Created by AI in session ${task.session_id}`;
                taskDetails.appendChild(aiIndicator);
            }

            // Show task work if available
            if (task.task_work) {
                const workContainer = document.createElement('div');
                workContainer.classList.add('task-work-container');
                workContainer.style.cssText = `
                    margin-top: 12px;
                    padding: 12px;
                    background: #f8fafc;
                    border-left: 3px solid #3b82f6;
                    border-radius: 4px;
                    max-height: 200px;
                    overflow-y: auto;
                `;
                
                const workHeader = document.createElement('div');
                workHeader.style.cssText = 'font-weight: 600; color: #3b82f6; margin-bottom: 8px; font-size: 13px;';
                workHeader.innerHTML = '<i class="fas fa-file-alt"></i> Deliverable:';
                
                const workContent = document.createElement('div');
                workContent.classList.add('task-work-content');
                workContent.style.cssText = 'font-size: 13px; line-height: 1.6; color: #334155; white-space: pre-wrap;';
                workContent.textContent = task.task_work;
                
                const viewFullButton = document.createElement('button');
                viewFullButton.classList.add('view-work-btn');
                viewFullButton.innerHTML = '<i class="fas fa-expand"></i> View Full';
                viewFullButton.style.cssText = `
                    margin-top: 8px;
                    padding: 4px 12px;
                    background: #3b82f6;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                `;
                viewFullButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showTaskWorkModal(task);
                });
                
                workContainer.appendChild(workHeader);
                workContainer.appendChild(workContent);
                workContainer.appendChild(viewFullButton);
                taskDetails.appendChild(workContainer);
            }

            const buttonContainer = document.createElement('div');
            buttonContainer.classList.add('button-container');

            const deleteButton = document.createElement('button');
            deleteButton.classList.add('delete-btn');
            deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
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