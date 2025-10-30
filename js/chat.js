// chat.js (Final, Corrected Version with Simplified Event Handling)

import { messageFormatter } from './message-formatter.js';
import ContextHandler from './context-handler.js';
import FileAttachmentHandler from './add-files.js';
import WelcomeDisplay from './welcome-display.js';
import ConversationStateManager from './conversation-state-manager.js';
import FloatingWindowManager from './floating-window-manager.js';
// Directly import the artifactHandler singleton to make the dependency explicit.
import { artifactHandler } from './artifact-handler.js';

// Use the exposed electron APIs instead of direct requires
const fs = window.electron?.fs?.promises;
const path = window.electron?.path;
const ipcRenderer = window.electron?.ipcRenderer;

let currentConversationId = null;

let chatConfig = {
    memory: false,
    tasks: false,
    tools: {
        internet_search: true,
        coding_assistant: true,
        World_Agent: true,
        enable_github: true,
        enable_google_email: true,
        Planner_Agent: true,
        enable_vercel: true,
        enable_google_drive: true
    },
    deepsearch: false
};

let ongoingStreams = {};
let contextHandler = null;
let fileAttachmentHandler = null;
let shuffleMenuController = null;
let welcomeDisplay = null;
let floatingWindowManager = null;
let connectionStatus = false;
const maxFileSize = 50 * 1024 * 1024; // 50MB limit
const supportedFileTypes = {
    'txt': 'text/plain',
    'js': 'text/javascript',
    'py': 'text/x-python',
    'html': 'text/html',
    'css': 'text/css',
    'json': 'application/json',
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'c': 'text/x-c'
};

/**
 * ShuffleMenuController - Manages the shuffle button dropdown menu
 * that contains memory, tools, and tasks functionality
 */
class ShuffleMenuController {
    constructor() {
        this.shuffleBtn = null;
        this.shuffleMenu = null;
        this.isOpen = false;
        this.activeItems = new Set();
        this.animationFrame = null;
    }

    initialize() {
        try {
            this.shuffleBtn = document.querySelector('[data-tool="shuffle"]');
            this.shuffleMenu = this.shuffleBtn?.querySelector('.shuffle-menu');

            if (!this.shuffleBtn || !this.shuffleMenu) {
                console.warn('Shuffle menu elements not found');
                return;
            }

            this.bindEvents();
            this.initializeToolsState();
            console.log('ShuffleMenuController initialized successfully');
        } catch (error) {
            console.error('Error initializing ShuffleMenuController:', error);
        }
    }

    initializeToolsState() {
        // Initialize checkbox states
        const aiOsCheckbox = document.getElementById('ai_os');
        const deepSearchCheckbox = document.getElementById('deep_search');

        if (aiOsCheckbox) {
            const allToolsEnabledInitially = Object.values(chatConfig.tools).every(val => val === true);
            aiOsCheckbox.checked = allToolsEnabledInitially;
        }

        if (deepSearchCheckbox) {
            deepSearchCheckbox.checked = chatConfig.deepsearch;
        }

        // Update initial active states
        this.updateToolsActiveState();
    }

    bindEvents() {
        // Toggle menu on shuffle button click
        this.shuffleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });

        // Handle menu item clicks
        const shuffleItems = this.shuffleMenu.querySelectorAll('.shuffle-item');
        shuffleItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handleMenuItemClick(action);
            });
        });

        // Close menu on outside click
        document.addEventListener('click', (e) => {
            if (!this.shuffleBtn.contains(e.target)) {
                this.closeMenu();
            }
        });

        // Handle keyboard navigation
        this.shuffleMenu.addEventListener('keydown', (e) => {
            this.handleKeyNavigation(e);
        });
    }

    toggleMenu() {
        if (this.isOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    openMenu() {
        // Cancel any pending animation frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        this.shuffleMenu.classList.add('visible');
        this.shuffleBtn.classList.add('active');
        this.shuffleBtn.setAttribute('aria-expanded', 'true');
        this.isOpen = true;

        // Set focus to first menu item for keyboard navigation using RAF for smooth transition
        this.animationFrame = requestAnimationFrame(() => {
            const firstItem = this.shuffleMenu.querySelector('.shuffle-item');
            if (firstItem) {
                firstItem.focus();
            }
        });
    }

    closeMenu() {
        this.shuffleMenu.classList.remove('visible');
        this.shuffleBtn.classList.remove('active');
        this.shuffleBtn.setAttribute('aria-expanded', 'false');
        this.isOpen = false;

        // Close any open submenus
        this.shuffleMenu.querySelectorAll('.tools-menu.visible').forEach(menu => {
            menu.classList.remove('visible');
        });
    }

    handleMenuItemClick(action) {
        switch (action) {
            case 'memory':
                this.handleMemoryAction();
                break;
            case 'tools':
                this.handleToolsAction();
                break;
            case 'tasks':
                this.handleTasksAction();
                break;
            default:
                console.warn('Unknown shuffle menu action:', action);
        }

        // Close menu after action (except for tools which has submenu)
        if (action !== 'tools') {
            this.closeMenu();
        }
    }

    handleMemoryAction() {
        // Delegate to existing memory toggle functionality
        chatConfig.memory = !chatConfig.memory;
        this.updateItemActiveState('memory', chatConfig.memory);
    }

    handleToolsAction() {
        // For tools, we need to show the tools submenu
        const toolsItem = this.shuffleMenu.querySelector('[data-action="tools"]');
        const toolsSubmenu = toolsItem.querySelector('.tools-menu');

        if (toolsSubmenu) {
            // Close any other open submenus first
            this.shuffleMenu.querySelectorAll('.tools-menu.visible').forEach(menu => {
                if (menu !== toolsSubmenu) {
                    menu.classList.remove('visible');
                }
            });

            toolsSubmenu.classList.toggle('visible');

            // Set up tools submenu event handlers if not already done
            this.setupToolsSubmenu(toolsSubmenu);
        }
    }

    setupToolsSubmenu(toolsSubmenu) {
        // Prevent submenu from closing shuffle menu when clicked
        if (!toolsSubmenu.hasAttribute('data-shuffle-setup')) {
            toolsSubmenu.setAttribute('data-shuffle-setup', 'true');
            toolsSubmenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // Handle checkbox changes in tools submenu
        const aiOsCheckbox = toolsSubmenu.querySelector('#ai_os');
        const deepSearchCheckbox = toolsSubmenu.querySelector('#deep_search');

        if (aiOsCheckbox && !aiOsCheckbox.hasAttribute('data-shuffle-handler')) {
            aiOsCheckbox.setAttribute('data-shuffle-handler', 'true');
            aiOsCheckbox.addEventListener('change', (e) => {
                const enableAll = e.target.checked;
                for (const key in chatConfig.tools) {
                    chatConfig.tools[key] = enableAll;
                }
                if (enableAll && deepSearchCheckbox) {
                    deepSearchCheckbox.checked = false;
                    chatConfig.deepsearch = false;
                }
                this.updateToolsActiveState();
                e.stopPropagation();
            });
        }

        if (deepSearchCheckbox && !deepSearchCheckbox.hasAttribute('data-shuffle-handler')) {
            deepSearchCheckbox.setAttribute('data-shuffle-handler', 'true');
            deepSearchCheckbox.addEventListener('change', (e) => {
                chatConfig.deepsearch = e.target.checked;
                if (e.target.checked && aiOsCheckbox) {
                    aiOsCheckbox.checked = false;
                    for (const key in chatConfig.tools) {
                        chatConfig.tools[key] = false;
                    }
                }
                this.updateToolsActiveState();
                e.stopPropagation();
            });
        }
    }

    updateToolsActiveState() {
        const aiOsCheckbox = document.getElementById('ai_os');
        const deepSearchCheckbox = document.getElementById('deep_search');
        const hasActiveTools = (aiOsCheckbox?.checked) || (deepSearchCheckbox?.checked);

        this.updateItemActiveState('tools', hasActiveTools);
    }

    handleTasksAction() {
        // Delegate to existing tasks toggle functionality
        chatConfig.tasks = !chatConfig.tasks;
        this.updateItemActiveState('tasks', chatConfig.tasks);
    }

    updateItemActiveState(action, isActive) {
        const item = this.shuffleMenu.querySelector(`[data-action="${action}"]`);
        if (item) {
            item.classList.toggle('active', isActive);
        }

        if (isActive) {
            this.activeItems.add(action);
        } else {
            this.activeItems.delete(action);
        }

        // Update shuffle button active state based on any active items
        this.updateShuffleButtonState();
    }

    updateShuffleButtonState() {
        const hasActiveItems = this.activeItems.size > 0;
        this.shuffleBtn.classList.toggle('has-active', hasActiveItems);
    }

    handleKeyNavigation(e) {
        // Basic keyboard navigation support
        const items = Array.from(this.shuffleMenu.querySelectorAll('.shuffle-item'));
        const currentIndex = items.findIndex(item => item === document.activeElement);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                const nextIndex = (currentIndex + 1) % items.length;
                items[nextIndex].focus();
                break;
            case 'ArrowUp':
                e.preventDefault();
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                items[prevIndex].focus();
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (currentIndex >= 0) {
                    items[currentIndex].click();
                }
                break;
            case 'Escape':
                e.preventDefault();
                this.closeMenu();
                this.shuffleBtn.focus();
                break;
        }
    }
}

function startNewConversation() {
    if (currentConversationId) {
        terminateSession(currentConversationId);
    }

    currentConversationId = self.crypto.randomUUID();
    console.log(`Starting new conversation with ID: ${currentConversationId}`);

    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('floating-input').disabled = false;
    document.getElementById('send-message').disabled = false;

    ongoingStreams = {};
    if (contextHandler) contextHandler.clearSelectedContext();
    if (fileAttachmentHandler) fileAttachmentHandler.clearAttachedFiles();

    // Clear error recovery flag
    window.needsNewBackendSession = false;

    chatConfig = {
        memory: false, tasks: false,
        tools: { internet_search: true, Planner_Agent: true, coding_assistant: true, World_Agent: true, enable_vercel: true, enable_github: true, enable_google_email: true, enable_google_drive: true },
        deepsearch: false
    };
    const aiOsCheckbox = document.getElementById('ai_os');
    if (aiOsCheckbox) aiOsCheckbox.checked = true;

    const deepSearchCheckbox = document.getElementById('deep_search');
    if (deepSearchCheckbox) deepSearchCheckbox.checked = false;

    // Reset shuffle menu state
    if (shuffleMenuController) {
        shuffleMenuController.activeItems.clear();
        shuffleMenuController.closeMenu();
        shuffleMenuController.updateShuffleButtonState();

        // Reset shuffle menu item active states
        const shuffleItems = document.querySelectorAll('.shuffle-item');
        shuffleItems.forEach(item => item.classList.remove('active'));
    }

    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));

    // Dispatch custom event for welcome display
    document.dispatchEvent(new CustomEvent('conversationCleared'));

    // Reset input container to centered position
    if (window.conversationStateManager) {
        console.log('Calling onConversationCleared to center input');
        window.conversationStateManager.onConversationCleared();
    }
}

/**
 * Set up IPC listeners for communication with python-bridge.js
 */
function setupIpcListeners() {
    ipcRenderer.on('socket-connection-status', (data) => {
        connectionStatus = data.connected;
        if (data.connected) {
            // Remove old connection error elements
            document.querySelectorAll('.connection-error').forEach(e => e.remove());

            // Clear connection notifications
            if (window.NotificationService) {
                window.NotificationService.removeConnectionNotifications();
            }
        } else {
            let statusMessage = 'Connecting to server...';
            let showRetry = false;

            if (data.error) {
                statusMessage = `Connection error: ${data.error}`;
                showRetry = true;
            } else if (data.reconnecting) {
                statusMessage = `Reconnecting... (Attempt ${data.attempt}/${data.maxAttempts})`;
            }

            // Use notification service for connection status
            if (window.NotificationService) {
                window.NotificationService.showConnection(statusMessage, showRetry);
            } else {
                // Fallback to old method
                showConnectionError(statusMessage);
            }

            if (data.error) {
                setTimeout(() => {
                    if (!connectionStatus) ipcRenderer.send('restart-python-bridge');
                }, 30000);
            }
        }
    });

    ipcRenderer.on('chat-response', (data) => {
        try {
            if (!data) return;
            const { streaming = false, done = false, id: messageId } = data;

            if (done && messageId && ongoingStreams[messageId]) {
                const messageDiv = ongoingStreams[messageId];

                const thinkingIndicator = messageDiv.querySelector('.thinking-indicator');
                if (thinkingIndicator) {
                    // OPTION B: Swap visibility - hide live steps, show summary
                    thinkingIndicator.classList.add('steps-done');

                    const liveStepsContainer = thinkingIndicator.querySelector('.thinking-steps-container');
                    const reasoningSummary = thinkingIndicator.querySelector('.reasoning-summary');

                    if (liveStepsContainer) {
                        liveStepsContainer.classList.add('hidden');
                    }

                    if (reasoningSummary) {
                        reasoningSummary.classList.remove('hidden');

                        // Update the final summary text
                        const summaryText = reasoningSummary.querySelector('.summary-text');
                        if (summaryText) {
                            const logCount = messageDiv.querySelectorAll('.log-block').length;
                            const toolLogCount = messageDiv.querySelectorAll('.tool-log-entry').length;

                            if (logCount === 0 && toolLogCount === 0) {
                                summaryText.textContent = "Aetheria AI's Reasoning";
                            } else {
                                const parts = [];
                                if (logCount > 0) parts.push(`${logCount} agent${logCount > 1 ? 's' : ''}`);
                                if (toolLogCount > 0) parts.push(`${toolLogCount} tool${toolLogCount > 1 ? 's' : ''}`);
                                summaryText.textContent = `Reasoning involved ${parts.join(' and ')}`;
                            }
                        }
                    }
                }

                const contentBlocks = messageDiv.querySelectorAll('.content-block');
                contentBlocks.forEach(block => {
                    const ownerName = block.dataset.owner;
                    const streamId = `${messageId}-${ownerName}`;
                    const finalContent = messageFormatter.getFinalContent(streamId);
                    const innerContentDiv = block.querySelector('.inner-content');
                    if (finalContent && innerContentDiv) {
                        innerContentDiv.innerHTML = messageFormatter.format(finalContent);

                        // Apply syntax highlighting to code blocks in final formatting
                        innerContentDiv.querySelectorAll('pre code').forEach(codeBlock => {
                            if (typeof hljs !== 'undefined' && !codeBlock.dataset.highlighted) {
                                hljs.highlightElement(codeBlock);
                                codeBlock.dataset.highlighted = 'true';
                            }
                        });
                    }
                });

                messageFormatter.finishStreamingForAllOwners(messageId);
                delete ongoingStreams[messageId];
            }

            if (data.content) {
                populateBotMessage(data);
            }

            if (done || (!streaming && data.content)) {
                const inputElement = document.getElementById('floating-input');
                const sendBtn = document.getElementById('send-message');
                if (inputElement) inputElement.disabled = false;
                if (sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.classList.remove('sending');
                }
            }
        } catch (error) {
            console.error('Error handling response:', error);
            populateBotMessage({ content: 'Error processing response', id: data.id });
            const inputElement = document.getElementById('floating-input');
            const sendBtn = document.getElementById('send-message');
            if (inputElement) inputElement.disabled = false;
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.classList.remove('sending');
            }
        }
    });

    ipcRenderer.on('image_generated', (data) => {
        console.log("%c[CHAT.JS] Received 'image_generated' event:", "color: blue; font-weight: bold;", data);

        const { id: messageId, image_base64, agent_name, artifactId } = data;

        // Check payload size for debugging
        if (image_base64) {
            const sizeInMB = (image_base64.length / 1024 / 1024).toFixed(2);
            console.log(`%c[CHAT.JS] Image payload size: ${sizeInMB}MB`, "color: blue;");
        }

        if (artifactHandler && image_base64 && artifactId) {
            console.log(`%c[CHAT.JS] ✓ All data present. Calling cachePendingImage for: ${artifactId}`, "color: green; font-weight: bold;");
            artifactHandler.cachePendingImage(artifactId, image_base64);
        } else {
            console.error("%c[CHAT.JS] ✗ Missing data in image_generated event!", "color: red; font-weight: bold;", {
                artifactHandlerExists: !!artifactHandler,
                hasBase64: !!image_base64,
                base64Length: image_base64?.length || 0,
                hasArtifactId: !!artifactId,
                artifactId: artifactId
            });
        }

        // Add log entry to reasoning dropdown
        if (messageId && ongoingStreams[messageId]) {
            const messageDiv = ongoingStreams[messageId];
            const logsContainer = messageDiv.querySelector('.detailed-logs');
            if (logsContainer) {
                const logEntry = document.createElement('div');
                logEntry.className = 'tool-log-entry';
                logEntry.innerHTML = `
                    <i class="fas fa-palette tool-log-icon"></i>
                    <div class="tool-log-details">
                        <span class="tool-log-owner">${(agent_name || 'ImageTools').replace(/_/g, ' ')}</span>
                        <span class="tool-log-action"><strong>Generated an image</strong></span>
                    </div>
                    <span class="tool-log-status completed">Completed</span>
                `;
                logsContainer.appendChild(logEntry);

                // OPTION B: Update the summary live when an image is generated
                updateReasoningSummary(messageId);
            }
        }
    });

    ipcRenderer.on('agent-step', (data) => {
        const { id: messageId, type, name, agent_name, team_name, tool } = data;
        if (!messageId || !ongoingStreams[messageId]) return;

        const messageDiv = ongoingStreams[messageId];
        const toolName = name ? name.replace(/_/g, ' ') : 'Unknown Tool';
        const ownerName = agent_name || team_name || 'Assistant';
        const stepId = `step-${messageId}-${ownerName}-${name}`;

        const logsContainer = messageDiv.querySelector('.detailed-logs');
        const logEntryId = `log-entry-${stepId}`;
        let logEntry = logsContainer.querySelector(`#${logEntryId}`);

        if (type === 'tool_start') {
            if (!logEntry) {
                logEntry = document.createElement('div');
                logEntry.id = logEntryId;
                logEntry.className = 'tool-log-entry';
                logEntry.innerHTML = `
                    <i class="fas fa-wrench tool-log-icon"></i>
                    <div class="tool-log-details">
                        <span class="tool-log-owner">${ownerName}</span>
                        <span class="tool-log-action">Used tool: <strong>${toolName}</strong></span>
                    </div>
                    <span class="tool-log-status in-progress">In progress...</span>
                `;
                logsContainer.appendChild(logEntry);

                // OPTION B: Update the summary live when a tool starts
                updateReasoningSummary(messageId);
            }
        } else if (type === 'tool_end') {
            if (logEntry) {
                const statusEl = logEntry.querySelector('.tool-log-status');
                if (statusEl) {
                    statusEl.textContent = 'Completed';
                    statusEl.classList.remove('in-progress');
                    statusEl.classList.add('completed');
                }
            }

            if (name && name.startsWith('interactive_browser') && tool?.tool_output?.screenshot_base_64) {
                if (artifactHandler) {
                    console.log("Detected browser tool output. Showing artifact.");
                    artifactHandler.showArtifact('browser_view', tool.tool_output);
                }
            }

            // OPTION B: Update the summary live when a tool completes
            updateReasoningSummary(messageId);
        }

        const liveStepsContainer = messageDiv.querySelector('.thinking-steps-container');
        if (!liveStepsContainer) return;
        let liveStepDiv = liveStepsContainer.querySelector(`#${stepId}`);

        if (type === 'tool_start') {
            if (name === 'execute_in_sandbox') {
                return;
            }

            if (!liveStepDiv) {
                liveStepDiv = document.createElement('div');
                liveStepDiv.id = stepId;
                liveStepDiv.className = 'thinking-step';
                liveStepDiv.innerHTML = `
                    <i class="fas fa-cog fa-spin step-icon"></i>
                    <span class="step-text"><strong>${ownerName}:</strong> Using ${toolName}...</span>
                `;
                liveStepsContainer.appendChild(liveStepDiv);
            }
        } else if (type === 'tool_end') {
            if (liveStepDiv) {
                liveStepDiv.remove();
            }
        }
    });

    ipcRenderer.on('sandbox-command-started', (data) => {
        if (artifactHandler) {
            artifactHandler.showTerminal(data.artifactId);
            artifactHandler.updateCommand(data.artifactId, data.command);
        }
    });

    ipcRenderer.on('sandbox-command-finished', (data) => {
        if (artifactHandler) {
            artifactHandler.updateTerminalOutput(data.artifactId, data.stdout, data.stderr, data.exitCode);
        }
    });

    ipcRenderer.on('socket-error', (error) => {
        console.error('Socket error:', error);
        try {
            // Show error notification using the notification service
            if (window.NotificationService) {
                window.NotificationService.show(
                    error.message || 'An error occurred. Your conversation is preserved. You can continue chatting.',
                    'error',
                    8000 // Show for 8 seconds
                );
            } else {
                // Fallback if notification service not available
                showNotification(error.message || 'An error occurred. Your conversation is preserved.');
            }

            // Re-enable input so user can retry
            const inputElement = document.getElementById('floating-input');
            const sendBtn = document.getElementById('send-message');
            if (inputElement) inputElement.disabled = false;
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.classList.remove('sending');
            }

            // Mark that we need to start a new backend session on next message
            window.needsNewBackendSession = true;

            // DON'T clear the conversation anymore
            // if (error.reset) { startNewConversation(); }
        } catch (e) {
            console.error('Error handling socket error:', e);
        }
    });

    ipcRenderer.on('socket-status', (data) => console.log('Socket status:', data));
    ipcRenderer.send('check-socket-connection');
}

function showConnectionError(message = 'Connecting to server...') {
    let errorDiv = document.querySelector('.connection-error');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'connection-error';
        document.body.appendChild(errorDiv);
    }
    errorDiv.innerHTML = `
        <div class="connection-error-content">
            <i class="fas fa-exclamation-circle"></i>
            <span>${message}</span>
            <button class="retry-connection">Retry Connection</button>
        </div>
    `;
    errorDiv.querySelector('.retry-connection').addEventListener('click', () => {
        errorDiv.querySelector('span').textContent = 'Restarting connection...';
        ipcRenderer.send('restart-python-bridge');
    });
}

function addUserMessage(message, turnContextData = null) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-user';
    const userMessageContainer = document.createElement('div');
    userMessageContainer.className = 'user-message-container';

    if (message) {
        const textDiv = document.createElement('div');
        textDiv.className = 'user-message-text';
        textDiv.textContent = message;
        userMessageContainer.appendChild(textDiv);
    }

    if (turnContextData) {
        const sessionCount = turnContextData.sessions?.length || 0;
        const fileCount = turnContextData.files?.length || 0;
        const parts = [];
        if (sessionCount > 0) parts.push(`${sessionCount} session${sessionCount > 1 ? 's' : ''}`);
        if (fileCount > 0) parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
        const buttonText = `Context: ${parts.join(' & ')}`;
        const contextBtn = document.createElement('button');
        contextBtn.className = 'view-turn-context-btn';
        contextBtn.innerHTML = `<i class="fas fa-paperclip"></i> ${buttonText}`;
        messageDiv.dataset.context = JSON.stringify(turnContextData);
        userMessageContainer.appendChild(contextBtn);
    }

    messageDiv.appendChild(userMessageContainer);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Dispatch custom event for welcome display
    document.dispatchEvent(new CustomEvent('messageAdded'));

    // Notify conversation state manager that a message was added
    if (window.conversationStateManager) {
        console.log('Calling onMessageAdded to move input to bottom');
        window.conversationStateManager.onMessageAdded();
    }
}

/**
 * Updates the reasoning summary text live as tools/agents are used
 * This function is called every time a tool starts or an agent responds
 */
function updateReasoningSummary(messageId) {
    const messageDiv = ongoingStreams[messageId];
    if (!messageDiv) return;

    const reasoningSummary = messageDiv.querySelector('.reasoning-summary');
    if (!reasoningSummary) return;

    const summaryText = reasoningSummary.querySelector('.summary-text');
    if (!summaryText) return;

    // Count agents and tools from the detailed logs
    const logCount = messageDiv.querySelectorAll('.log-block').length;
    const toolLogCount = messageDiv.querySelectorAll('.tool-log-entry').length;

    if (logCount === 0 && toolLogCount === 0) {
        summaryText.textContent = "Reasoning: 0 agents, 0 tools";
    } else {
        const parts = [];
        if (logCount > 0) parts.push(`${logCount} agent${logCount > 1 ? 's' : ''}`);
        if (toolLogCount > 0) parts.push(`${toolLogCount} tool${toolLogCount > 1 ? 's' : ''}`);
        summaryText.textContent = `Reasoning: ${parts.join(', ')}`;
    }

    // Make the summary visible and clickable if there's any activity
    if (logCount > 0 || toolLogCount > 0) {
        reasoningSummary.classList.remove('hidden');
        // Auto-expand the dropdown during execution so user can see live updates
        if (!messageDiv.classList.contains('expanded')) {
            messageDiv.classList.add('expanded');
        }
    }
}

function createBotMessagePlaceholder(messageId) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-bot';

    // OPTION B: Create thinking indicator with BOTH live steps AND hidden summary
    const thinkingIndicator = document.createElement('div');
    thinkingIndicator.className = 'thinking-indicator';
    thinkingIndicator.innerHTML = `
        <div class="thinking-steps-container"></div>
        <div class="reasoning-summary hidden">
            <span class="summary-text">Reasoning: 0 agents, 0 tools</span>
            <i class="fas fa-chevron-down summary-chevron"></i>
        </div>
    `;
    messageDiv.appendChild(thinkingIndicator);

    const detailedLogsDiv = document.createElement('div');
    detailedLogsDiv.className = 'detailed-logs';
    detailedLogsDiv.id = `logs-${messageId}`;
    messageDiv.appendChild(detailedLogsDiv);

    const mainContentDiv = document.createElement('div');
    mainContentDiv.className = 'message-content';
    mainContentDiv.id = `main-content-${messageId}`;
    messageDiv.appendChild(mainContentDiv);

    chatMessages.appendChild(messageDiv);
    ongoingStreams[messageId] = messageDiv;

    // Add click handler to the summary (even though it's hidden initially)
    const reasoningSummary = thinkingIndicator.querySelector('.reasoning-summary');
    reasoningSummary.addEventListener('click', () => {
        messageDiv.classList.toggle('expanded');
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function populateBotMessage(data) {
    const { content, id: messageId, streaming = false, agent_name, team_name, is_log } = data;
    const messageDiv = ongoingStreams[messageId];
    if (!messageDiv) {
        console.warn("Could not find message div for ID:", messageId);
        return;
    }

    const ownerName = agent_name || team_name;
    if (!ownerName || !content) return;

    const targetContainer = is_log
        ? messageDiv.querySelector(`#logs-${messageId}`)
        : messageDiv.querySelector(`#main-content-${messageId}`);

    if (!targetContainer) {
        console.error("Target container not found for message:", messageId, "is_log:", is_log);
        return;
    }

    const contentBlockId = `content-block-${messageId}-${ownerName}`;
    let contentBlock = document.getElementById(contentBlockId);

    if (!contentBlock) {
        contentBlock = document.createElement('div');
        contentBlock.id = contentBlockId;
        contentBlock.className = is_log ? 'content-block log-block' : 'content-block';
        contentBlock.dataset.owner = ownerName;

        const header = document.createElement('div');
        header.className = 'content-block-header';
        header.textContent = ownerName.replace(/_/g, ' ');
        contentBlock.appendChild(header);

        const innerContent = document.createElement('div');
        innerContent.className = 'inner-content';
        contentBlock.appendChild(innerContent);

        targetContainer.appendChild(contentBlock);

        // OPTION B: Update the summary when a new agent block is created (only for logs)
        if (is_log) {
            updateReasoningSummary(messageId);
        }
    }

    const innerContentDiv = contentBlock.querySelector('.inner-content');
    if (innerContentDiv) {
        const streamId = `${messageId}-${ownerName}`;
        const formattedContent = messageFormatter.formatStreaming(content, streamId);
        innerContentDiv.innerHTML = formattedContent;

        // Apply live syntax highlighting to code blocks during streaming
        innerContentDiv.querySelectorAll('pre code:not([data-highlighted])').forEach(codeBlock => {
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(codeBlock);
                codeBlock.dataset.highlighted = 'true';
            }
        });
    }
}

/**
 * Renders a complete assistant turn from a static, high-fidelity 'run' object.
 * This function is now intelligent, parsing the data to separate reasoning from the final answer
 * and ignoring internal system prompts.
 * @param {HTMLElement} targetContainer - The DOM element to render the turn into.
 * @param {Object} run - The complete 'run' object from the saved session.
 */
function renderTurnFromEvents(targetContainer, run, options = {}) {
    if (!targetContainer || !run) {
        targetContainer.innerHTML = '<div class="message-text">(Could not render turn)</div>';
        return;
    }

    const events = run.events || [];
    const mainAgentName = 'Aetheria_AI';
    const inlineArtifacts = options.inlineArtifacts === true;

    // --- AGGREGATION PHASE: Loop through events once to gather all data ---
    let toolLogsHtml = '';
    let subAgentBlocksHtml = '';
    // The final, synthesized content is on the top-level run object.
    const finalContent = run.content || '';

    // Process events to build the reasoning/log section
    events.forEach(event => {
        const owner = event.agent_name || event.team_name;
        if (!owner) return;

        // Aggregate tool call events into pre-rendered HTML
        if (event.event === 'TeamToolCallCompleted' || event.event === 'ToolCallCompleted') {
            const toolName = event.tool?.tool_name?.replace(/_/g, ' ') || 'Unknown Tool';
            toolLogsHtml += `
                <div class="tool-log-entry">
                    <i class="fas fa-wrench tool-log-icon"></i>
                    <div class="tool-log-details">
                        <span class="tool-log-owner">${owner.replace(/_/g, ' ')}</span>
                        <span class="tool-log-action">Used tool: <strong>${toolName}</strong></span>
                    </div>
                    <span class="tool-log-status completed">Completed</span>
                </div>`;
        }

        // Aggregate content from sub-agent runs
        if (event.event === 'RunCompleted' && owner !== mainAgentName) {
            if (event.content) {
                const formattedContent = messageFormatter.format(event.content, { inlineArtifacts });
                subAgentBlocksHtml += `
                    <div class="content-block log-block">
                        <div class="content-block-header">${owner.replace(/_/g, ' ')}</div>
                        <div class="inner-content">${formattedContent}</div>
                    </div>`;
            }
        }
    });

    // --- ASSEMBLY PHASE: Build the final HTML from the aggregated data ---

    // Create the summary text for the collapsible "Reasoning" header
    const toolLogCount = (toolLogsHtml.match(/tool-log-entry/g) || []).length;
    const agentLogCount = (subAgentBlocksHtml.match(/log-block/g) || []).length;
    let summaryText = "Aetheria AI's Reasoning";
    let hasReasoning = toolLogCount > 0 || agentLogCount > 0;

    if (hasReasoning) {
        const parts = [];
        if (agentLogCount > 0) parts.push(`${agentLogCount} agent${agentLogCount > 1 ? 's' : ''}`);
        if (toolLogCount > 0) parts.push(`${toolLogCount} tool${toolLogCount > 1 ? 's' : ''}`);
        summaryText = `Reasoning involved ${parts.join(' and ')}`;
    }

    // Only show the reasoning header if there are logs to display.
    const reasoningHeaderHtml = hasReasoning ? `
        <div class="thinking-indicator steps-done" onclick="this.parentElement.classList.toggle('expanded')">
            <span class="summary-text">${summaryText}</span>
            <i class="fas fa-chevron-down summary-chevron"></i>
        </div>
    ` : '';

    // Assemble the final HTML structure for the assistant's message
    const finalHtml = `
        <div class="message message-bot">
            ${reasoningHeaderHtml}
            <div class="detailed-logs">${toolLogsHtml}${subAgentBlocksHtml}</div>
            <div class="message-content">
                <div class="content-block">
                    <div class="content-block-header">${mainAgentName.replace(/_/g, ' ')}</div>
                    <div class="inner-content">${messageFormatter.format(finalContent, { inlineArtifacts }) || '(No final response content)'}</div>
                </div>
            </div>
        </div>
    `;

    targetContainer.innerHTML = finalHtml;

    if (inlineArtifacts && typeof messageFormatter.applyInlineEnhancements === 'function') {
        messageFormatter.applyInlineEnhancements(targetContainer);
    }
}

/**
 * Extracts conversation history from the DOM for error recovery
 * @returns {string} Formatted conversation history
 */
function extractConversationHistory() {
    const chatMessages = document.getElementById('chat-messages');
    const messages = chatMessages.querySelectorAll('.message');
    let history = '';

    messages.forEach(msg => {
        // Skip error messages
        if (msg.classList.contains('message-error')) return;

        if (msg.classList.contains('message-user')) {
            // Extract user message text
            const textDiv = msg.querySelector('.user-message-text');
            if (textDiv) {
                history += `User: ${textDiv.textContent.trim()}\n\n`;
            }
        } else if (msg.classList.contains('message-bot')) {
            // Extract assistant message from main content (not logs)
            const mainContent = msg.querySelector('.message-content .inner-content');
            if (mainContent) {
                // Get text content, stripping HTML but preserving structure
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = mainContent.innerHTML;
                const text = tempDiv.textContent.trim();
                if (text && text !== '(No final response content)') {
                    history += `Assistant: ${text}\n\n`;
                }
            }
        }
    });

    return history;
}

async function handleSendMessage() {
    const floatingInput = document.getElementById('floating-input');
    const message = floatingInput.value.trim();
    const sendMessageBtn = document.getElementById('send-message');
    const attachedFiles = fileAttachmentHandler.getAttachedFiles();
    const selectedSessions = contextHandler.getSelectedSessions();

    // Allow sending even with just context sessions selected
    if (!message && attachedFiles.length === 0 && selectedSessions.length === 0) return;

    floatingInput.disabled = true;
    sendMessageBtn.disabled = true;
    sendMessageBtn.classList.add('sending');

    const session = await window.electron.auth.getSession();
    if (!session || !session.access_token) {
        showNotification('You must be logged in to send a message.', 'error');
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
        sendMessageBtn.classList.remove('sending');
        return;
    }

    if (!connectionStatus) {
        showNotification('Not connected to server. Please wait...', 'error');
        ipcRenderer.send('restart-python-bridge');
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
        sendMessageBtn.classList.remove('sending');
        return;
    }

    // Check if we need to create a new backend session (after error)
    if (window.needsNewBackendSession) {
        // Generate new conversation ID for backend
        currentConversationId = self.crypto.randomUUID();
        console.log(`Creating new backend session after error: ${currentConversationId}`);

        // Extract conversation history from DOM
        const conversationHistory = extractConversationHistory();

        // Prepend history to current message
        const messageWithHistory = conversationHistory
            ? `PREVIOUS CONVERSATION (Recovered after error):\n---\n${conversationHistory}---\n\nCURRENT MESSAGE:\n${message}`
            : message;

        // Clear the flag
        window.needsNewBackendSession = false;

        // Add user message to UI
        let turnContextData = null;
        if (selectedSessions.length > 0 || attachedFiles.length > 0) {
            turnContextData = { sessions: selectedSessions, files: attachedFiles };
        }
        addUserMessage(message, turnContextData);

        const messageId = Date.now().toString();
        createBotMessagePlaceholder(messageId);

        const contextSessionIds = selectedSessions.map(session => session.session_id);

        const messageData = {
            conversationId: currentConversationId,
            message: messageWithHistory, // Send with history
            id: messageId,
            files: attachedFiles,
            context_session_ids: contextSessionIds,
            is_deepsearch: chatConfig.deepsearch,
            accessToken: session.access_token,
            config: { use_memory: chatConfig.memory, ...chatConfig.tools }
        };

        try {
            ipcRenderer.send('send-message', messageData);
        } catch (error) {
            console.error('Error sending message:', error);
            populateBotMessage({ content: 'Error sending message', id: messageId });
            floatingInput.disabled = false;
            sendMessageBtn.disabled = false;
            sendMessageBtn.classList.remove('sending');
        }

        floatingInput.value = '';
        floatingInput.style.height = 'auto';
        fileAttachmentHandler.clearAttachedFiles();
        contextHandler.clearSelectedContext();
        return;
    }

    // Normal flow (no error recovery needed)
    let turnContextData = null;
    if (selectedSessions.length > 0 || attachedFiles.length > 0) {
        turnContextData = { sessions: selectedSessions, files: attachedFiles };
    }

    addUserMessage(message, turnContextData);

    const messageId = Date.now().toString();
    createBotMessagePlaceholder(messageId);

    const contextSessionIds = selectedSessions.map(session => session.session_id);

    const messageData = {
        conversationId: currentConversationId,
        message: message,
        id: messageId,
        files: attachedFiles,
        context_session_ids: contextSessionIds,
        is_deepsearch: chatConfig.deepsearch,
        accessToken: session.access_token,
        config: { use_memory: chatConfig.memory, ...chatConfig.tools }
    };

    try {
        ipcRenderer.send('send-message', messageData);
    } catch (error) {
        console.error('Error sending message:', error);
        populateBotMessage({ content: 'Error sending message', id: messageId });
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
        sendMessageBtn.classList.remove('sending');
    }

    floatingInput.value = '';
    floatingInput.style.height = 'auto';
    fileAttachmentHandler.clearAttachedFiles();
    contextHandler.clearSelectedContext();
}

async function terminateSession(conversationIdToTerminate) {
    if (!conversationIdToTerminate) return;

    console.log(`Requesting termination of conversation: ${conversationIdToTerminate}`);
    const session = await window.electron.auth.getSession();
    if (!session || !session.access_token) {
        console.log("User not logged in, cannot send termination request.");
        return;
    }
    ipcRenderer.send('send-message', {
        type: 'terminate_session',
        accessToken: session.access_token,
        conversationId: conversationIdToTerminate
    });
}

function initializeAutoExpandingTextarea() {
    const textarea = document.getElementById('floating-input');
    textarea.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
}

function showNotification(message, type = 'error', duration = 10000) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    const icon = document.createElement('i');
    icon.className = type === 'error' ? 'fas fa-exclamation-circle' : 'fas fa-info-circle';
    const textDiv = document.createElement('div');
    textDiv.className = 'notification-text';
    textDiv.textContent = message;
    notification.appendChild(icon);
    notification.appendChild(textDiv);
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
    container.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 100);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
            if (container.children.length === 0) container.remove();
        }, 300);
    }, duration);
}

class UnifiedPreviewHandler {
    constructor(contextHandler, fileAttachmentHandler) {
        this.contextHandler = contextHandler;
        this.fileAttachmentHandler = fileAttachmentHandler;
        this.viewer = document.getElementById('selected-context-viewer');
        this.initializeViewer();
    }
    initializeViewer() {
        this.viewer.querySelector('.close-viewer-btn').addEventListener('click', () => this.hideViewer());
        this.viewer.addEventListener('click', (e) => {
            if (e.target.closest('.preview-toggle')) {
                const fileItem = e.target.closest('.file-preview-item');
                if (fileItem) fileItem.querySelector('.file-preview-content-item')?.classList.toggle('visible');
                return;
            }
            if (e.target.closest('.remove-session-btn')) {
                const sessionIndex = parseInt(e.target.closest('.remove-session-btn').dataset.sessionIndex, 10);
                this.contextHandler.removeSelectedSession(sessionIndex);
                this.showViewer();
                return;
            }
            if (e.target.closest('.remove-file')) {
                const fileItem = e.target.closest('.file-preview-item');
                const fileIndex = Array.from(fileItem.parentNode.children).indexOf(fileItem);
                this.fileAttachmentHandler.removeFile(fileIndex);
                this.showViewer();
            }
        });
        const tabs = this.viewer.querySelectorAll('.viewer-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const tabId = tab.getAttribute('data-tab');
                this.viewer.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                this.viewer.querySelector(`#${tabId}-tab`).classList.add('active');
            });
        });
        this.updateContextIndicator();
    }
    showHistoricalContext(contextData) {
        this.updateContextContent(contextData.sessions);
        this.updateFilesContent(contextData.files);
        this.viewer.classList.add('visible');
    }
    showViewer() {
        this.updateContextContent(this.contextHandler.getSelectedSessions());
        this.updateFilesContent(this.fileAttachmentHandler.getAttachedFiles());
        this.viewer.classList.add('visible');
    }
    hideViewer() { this.viewer.classList.remove('visible'); }
    updateContextContent(sessions) {
        const contextContent = this.viewer.querySelector('.context-preview-content');
        if (!sessions?.length) {
            contextContent.innerHTML = '<p class="empty-state">No context sessions selected</p>';
            return;
        }
        contextContent.innerHTML = sessions.map((session, index) => `
            <div class="session-block">
                <div class="session-block-header"><h4>Session ${index + 1}</h4><button class="remove-session-btn" data-session-index="${index}" title="Remove Session"><i class="fas fa-times"></i></button></div>
                ${session.interactions.map(int => `<div class="interaction"><div class="user-message"><strong>User:</strong> ${int.user_input}</div><div class="assistant-message"><strong>Assistant:</strong> ${int.llm_output}</div></div>`).join('')}
            </div>`).join('');
    }
    updateFilesContent(files) {
        const filesContent = this.viewer.querySelector('.files-preview-content');
        if (!files?.length) {
            filesContent.innerHTML = '<p class="empty-state">No files attached</p>';
            return;
        }
        filesContent.innerHTML = files.map((file, index) => `
            <div class="file-preview-item">
                <div class="file-preview-header-item">
                    <div class="file-info"><i class="${this.fileAttachmentHandler.getFileIcon(file.name)} file-icon"></i><span class="file-name">${file.name}</span></div>
                    <div class="file-actions"><button class="preview-toggle" title="Toggle Preview"><i class="fas fa-eye"></i></button><button class="remove-file" title="Remove File"><i class="fas fa-times"></i></button></div>
                </div>
                <div class="file-preview-content-item">${file.isMedia ? this.renderMediaPreview(file) : (file.content || "No preview available")}</div>
            </div>`).join('');
    }
    renderMediaPreview(file) {
        if (file.type.startsWith('image/')) return `<img src="${file.previewUrl}" alt="${file.name}" class="media-preview"><p class="file-path-info">File path: ${file.path || "Path not available"}</p>`;
        if (file.type.startsWith('audio/')) return `<audio controls class="media-preview"><source src="${file.previewUrl}" type="${file.type}"></audio><p class="file-path-info">File path: ${file.path || "Path not available"}</p>`;
        if (file.type.startsWith('video/')) return `<video controls class="media-preview"><source src="${file.previewUrl}" type="${file.type}"></video><p class="file-path-info">File path: ${file.path || "Path not available"}</p>`;
        if (file.type === 'application/pdf') return `<iframe src="${file.previewUrl}" class="pdf-preview"></iframe><p class="file-path-info">File path: ${file.path || "Path not available"}</p>`;
        if (file.type.includes('document')) return `<div class="doc-preview">Document preview not available</div><p class="file-path-info">File path: ${file.path || "Path not available"}</p>`;
        return file.content || "No preview available";
    }
    updateContextIndicator() {
        // Context indicator is now disabled - sessions appear as chips instead
        const indicator = document.querySelector('.context-active-indicator');
        if (indicator) {
            indicator.classList.remove('visible');
            const badge = indicator.querySelector('.context-badge');
            if (badge) {
                badge.classList.remove('visible');
            }
        }
    }
}

/**
 * Initializes the chat module.
 */
function init() {
    const elements = {
        container: document.getElementById('chat-container'), messages: document.getElementById('chat-messages'),
        input: document.getElementById('floating-input'), sendBtn: document.getElementById('send-message'),
        minimizeBtn: document.getElementById('minimize-chat'), newChatBtn: document.querySelector('.add-btn'),
        attachBtn: document.getElementById('attach-file-btn')
    };
    contextHandler = new ContextHandler();
    window.contextHandler = contextHandler;
    shuffleMenuController = new ShuffleMenuController();
    shuffleMenuController.initialize();
    welcomeDisplay = new WelcomeDisplay();
    welcomeDisplay.initialize();

    if (window.electron?.auth) {
        window.electron.auth.onAuthChange((user) => {
            if (welcomeDisplay) {
                welcomeDisplay.refreshUsername();
            }
        });
    }

    // Initialize FloatingWindowManager and connect it to WelcomeDisplay
    try {
        floatingWindowManager = new FloatingWindowManager(welcomeDisplay);
        window.floatingWindowManager = floatingWindowManager;
    } catch (error) {
        console.error('Error initializing FloatingWindowManager:', error);
        // Continue without floating window management
        window.floatingWindowManager = null;
    }

    // Register floating windows with error handling
    setTimeout(() => {
        try {
            // Register AIOS settings window
            const aiosWindow = document.getElementById('floating-window');
            if (aiosWindow) {
                floatingWindowManager.registerWindow('aios-settings', aiosWindow);
            } else {
                console.warn('AIOS settings window element not found for registration');
            }

            // Register tasks window
            const tasksWindow = document.getElementById('to-do-list-container');
            if (tasksWindow) {
                floatingWindowManager.registerWindow('tasks', tasksWindow);
            } else {
                console.warn('Tasks window element not found for registration');
            }

            // Register context window
            const contextWindow = document.getElementById('context-window');
            if (contextWindow) {
                floatingWindowManager.registerWindow('context', contextWindow);
            } else {
                console.warn('Context window element not found for registration');
            }
        } catch (error) {
            console.error('Error registering floating windows:', error);
            // Continue without floating window management if registration fails
        }
    }, 100);



    // Initialize conversation state manager
    if (window.conversationStateManager) {
        window.conversationStateManager.init();
    }
    setupIpcListeners();
    initializeAutoExpandingTextarea();
    fileAttachmentHandler = new FileAttachmentHandler(null, supportedFileTypes, maxFileSize);
    window.unifiedPreviewHandler = new UnifiedPreviewHandler(contextHandler, fileAttachmentHandler);
    elements.sendBtn.addEventListener('click', handleSendMessage);
    elements.minimizeBtn?.addEventListener('click', () => window.stateManager.setState({ isChatOpen: false }));
    elements.input.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } });

    elements.newChatBtn.addEventListener('click', startNewConversation);

    elements.messages.addEventListener('click', (e) => {
        const contextBtn = e.target.closest('.view-turn-context-btn');
        if (contextBtn) {
            const messageDiv = contextBtn.closest('.message');
            const contextDataString = messageDiv.dataset.context;
            if (contextDataString) {
                try {
                    const contextData = JSON.parse(contextDataString);
                    window.unifiedPreviewHandler.showHistoricalContext(contextData);
                } catch (err) {
                    console.error("Failed to parse historical context data:", err);
                    showNotification("Could not display context for this message.", "error");
                }
            }
        }
    });

    // Expose the renderer function globally so context-handler.js can use it
    window.renderTurnFromEvents = renderTurnFromEvents;

    startNewConversation();
}

const style = document.createElement('style');
style.textContent = `
.error-message { color: var(--error-500); padding: 8px 12px; border-radius: 8px; background-color: var(--error-100); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
.dark-mode .error-message { background-color: rgba(239, 68, 68, 0.2); }
.status-message { color: var(--text-color); font-style: italic; opacity: 0.8; padding: 4px 8px; font-size: 0.9em; display: flex; align-items: center; gap: 8px; }
.content-block { margin-bottom: 10px; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
.content-block-header { background-color: var(--background-secondary); padding: 4px 8px; font-size: 0.8em; font-weight: bold; color: var(--text-muted); }
.inner-content { padding: 8px; }
`;
document.head.appendChild(style);

window.chatModule = { init };