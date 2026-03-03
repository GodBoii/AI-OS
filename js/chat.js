// chat.js (Final, Corrected Version with Simplified Event Handling)

import { messageFormatter } from './message-formatter.js';
import ContextHandler from './context-handler.js';
import FileAttachmentHandler from './add-files.js';
import WelcomeDisplay from './welcome-display.js';
import ConversationStateManager from './conversation-state-manager.js';
import FloatingWindowManager from './floating-window-manager.js';
import ShuffleMenuController from './shuffle-menu-controller.js';
import { showConnectionError, addMessageActionButtons } from './ui-utilities.js';
// Directly import the artifactHandler singleton to make the dependency explicit.
import { artifactHandler } from './artifact-handler.js';
import sessionContentViewer from './session-content-viewer.js';

// Use the exposed electron APIs instead of direct requires
const fs = window.electron?.fs?.promises;
const path = window.electron?.path;
const ipcRenderer = window.electron?.ipcRenderer;

let currentConversationId = null;
window.currentConversationId = currentConversationId;

let chatConfig = {
    memory: true,
    tools: {
        internet_search: true,
        coding_assistant: true,
        World_Agent: true,
        enable_github: true,
        enable_google_email: true,
        Planner_Agent: true,
        enable_vercel: true,
        enable_google_drive: true,
        computer_control: true  // NEW: Computer control enabled by default (desktop only)
    },
    deepsearch: false
};

let ongoingStreams = {};
let contextHandler = null;
let fileAttachmentHandler = null;
let shuffleMenuController = null;
let welcomeDisplay = null;
let floatingWindowManager = null;
let audioInputHandler = null;
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

function resolveAgentMode() {
    const ctx = window.projectContext || window.activeProjectContext || null;
    if (!ctx || typeof ctx !== 'object') {
        return 'default';
    }

    if (String(ctx.agentMode || '').toLowerCase() === 'coder') {
        return 'coder';
    }
    if (ctx.isDedicatedProject === true) {
        return 'coder';
    }
    if (String(ctx.mode || '').toLowerCase() === 'project') {
        return 'coder';
    }
    return 'default';
}

function isProjectWorkspaceMode() {
    const ctx = window.projectContext || window.activeProjectContext || null;
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

async function startNewConversation() {
    // Stop any ongoing audio recording
    if (audioInputHandler && audioInputHandler.isRecording) {
        audioInputHandler.stopRecording();
    }

    // CRITICAL: Save any pending attachment metadata before terminating
    if (window.pendingAttachmentMetadata) {
        console.log('[AttachmentDB] Saving pending metadata before starting new conversation');
        await persistAttachmentMetadata(
            window.pendingAttachmentMetadata.sessionId,
            window.pendingAttachmentMetadata.files,
            window.pendingAttachmentMetadata.userId
        );
        window.pendingAttachmentMetadata = null;
    }

    if (currentConversationId) {
        terminateSession(currentConversationId);
    }

    currentConversationId = self.crypto.randomUUID();
    window.currentConversationId = currentConversationId;
    console.log(`Starting new conversation with ID: ${currentConversationId}`);

    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('floating-input').disabled = false;
    document.getElementById('send-message').disabled = false;

    ongoingStreams = {};
    if (contextHandler) {
        contextHandler.clearSelectedContext();
        // Invalidate cache so next time context window opens, it shows the new conversation
        contextHandler.invalidateCache();
    }
    if (fileAttachmentHandler) fileAttachmentHandler.clearAttachedFiles();

    // Hide content button for new conversation
    hideContentButton();

    // Invalidate session content cache
    if (window.sessionContentViewer) {
        window.sessionContentViewer.invalidateCache(currentConversationId);
    }

    // Clear error recovery flag
    window.needsNewBackendSession = false;

    chatConfig = {
        memory: true, tasks: false,
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

        // Re-enable memory if it's on by default
        if (chatConfig.memory) {
            shuffleMenuController.updateItemActiveState('memory', true);
        }
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

    ipcRenderer.on('chat-response', async (data) => {
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
                        const inlineArtifacts = isProjectWorkspaceMode();
                        innerContentDiv.innerHTML = messageFormatter.format(finalContent, { inlineArtifacts });

                        if (inlineArtifacts) {
                            if (typeof messageFormatter.applyInlineEnhancements === 'function') {
                                messageFormatter.applyInlineEnhancements(innerContentDiv);
                            }
                        } else {
                            // Apply syntax highlighting to code blocks in final formatting
                            innerContentDiv.querySelectorAll('pre code').forEach(codeBlock => {
                                if (typeof hljs !== 'undefined' && !codeBlock.dataset.highlighted) {
                                    hljs.highlightElement(codeBlock);
                                    codeBlock.dataset.highlighted = 'true';
                                }
                            });

                            // Add copy buttons to code blocks in live messages
                            addCopyButtonsToCodeBlocks(innerContentDiv);
                        }
                    }
                });

                messageFormatter.finishStreamingForAllOwners(messageId);
                delete ongoingStreams[messageId];

                // Add action buttons (copy, share) to the completed message
                addMessageActionButtons(messageDiv);

                // CORRECTED FLOW: Save attachment metadata AFTER AI response completes successfully
                if (window.pendingAttachmentMetadata) {
                    console.log('[AttachmentDB] AI response completed, now persisting attachment metadata');
                    await persistAttachmentMetadata(
                        window.pendingAttachmentMetadata.sessionId,
                        window.pendingAttachmentMetadata.files,
                        window.pendingAttachmentMetadata.userId
                    );
                    // Clear pending metadata
                    window.pendingAttachmentMetadata = null;
                }

                // Check if session has content to show button
                checkAndShowContentButton();
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
        const { id: messageId, image_base64, artifactId } = data;

        // Filter events by message ID to ensure this client should process it
        if (!ongoingStreams[messageId]) {
            return;
        }

        if (artifactHandler && image_base64 && artifactId) {
            artifactHandler.cachePendingImage(artifactId, image_base64);
        }

        // Add log entry to reasoning dropdown
        if (messageId && ongoingStreams[messageId]) {
            const messageDiv = ongoingStreams[messageId];
            const logsContainer = messageDiv.querySelector('.detailed-logs');
            if (logsContainer) {
                const logEntry = document.createElement('div');
                logEntry.className = 'tool-log-entry';
                logEntry.innerHTML = `
                    <i class="fi fi-tr-wisdom tool-log-icon"></i>
                    <div class="tool-log-details">
                        <span class="tool-log-action"><strong>Generated an image</strong></span>
                    </div>
                    <span class="tool-log-status completed"></span>
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
                    <i class="fi fi-tr-wisdom tool-log-icon"></i>
                    <div class="tool-log-details">
                        <span class="tool-log-action">Used tool: <strong>${toolName}</strong></span>
                    </div>
                    <span class="tool-log-status in-progress"></span>
                `;
                logsContainer.appendChild(logEntry);

                // OPTION B: Update the summary live when a tool starts
                updateReasoningSummary(messageId);
            }
        } else if (type === 'tool_end') {
            if (logEntry) {
                const statusEl = logEntry.querySelector('.tool-log-status');
                if (statusEl) {
                    statusEl.textContent = '';
                    statusEl.classList.remove('in-progress');
                    statusEl.classList.add('completed');
                }
            }

            if (name && name.startsWith('interactive_browser') && tool?.tool_output?.screenshot_base_64) {
                if (artifactHandler && !isProjectWorkspaceMode()) {
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
        if (artifactHandler && !isProjectWorkspaceMode()) {
            artifactHandler.showTerminal(data.artifactId);
            artifactHandler.updateCommand(data.artifactId, data.command);
        }
    });

    ipcRenderer.on('sandbox-command-finished', (data) => {
        if (artifactHandler && !isProjectWorkspaceMode()) {
            artifactHandler.updateTerminalOutput(data.artifactId, data.stdout, data.stderr, data.exitCode);
        }
        
        // Invalidate cache when new execution content is added
        if (window.sessionContentViewer && currentConversationId) {
            window.sessionContentViewer.invalidateCache(currentConversationId);
        }
        
        // Check if session has content to show button
        checkAndShowContentButton();
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

            // Clear pending attachment metadata on error (won't be saved)
            console.log('[AttachmentDB] Clearing pending metadata due to error');
            window.pendingAttachmentMetadata = null;

            // DON'T clear the conversation anymore
            // if (error.reset) { startNewConversation(); }
        } catch (e) {
            console.error('Error handling socket error:', e);
        }
    });

    ipcRenderer.on('socket-status', (data) => console.log('Socket status:', data));
    
    // Listen for computer tool notifications
    ipcRenderer.on('computer-tool-notification', (data) => {
        if (window.notificationService) {
            window.notificationService.showComputerTool(data.message, data.action);
        }
    });
    
    ipcRenderer.send('check-socket-connection');
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
        const inlineArtifacts = isProjectWorkspaceMode();
        if (inlineArtifacts && artifactHandler) {
            artifactHandler.hideArtifact();
        }
        const formattedContent = messageFormatter.formatStreaming(content, streamId, { inlineArtifacts });
        innerContentDiv.innerHTML = formattedContent;

        if (inlineArtifacts) {
            if (typeof messageFormatter.applyInlineEnhancements === 'function') {
                messageFormatter.applyInlineEnhancements(innerContentDiv);
            }
        } else {
            // Apply live syntax highlighting to code blocks during streaming
            innerContentDiv.querySelectorAll('pre code:not([data-highlighted])').forEach(codeBlock => {
                if (typeof hljs !== 'undefined') {
                    hljs.highlightElement(codeBlock);
                    codeBlock.dataset.highlighted = 'true';
                }
            });

            // Add copy buttons to code blocks during streaming
            addCopyButtonsToCodeBlocks(innerContentDiv);
        }
    }
}

/**
 * Adds copy buttons to code blocks that don't have them yet
 * @param {HTMLElement} container - Container element to search for code blocks
 */
function addCopyButtonsToCodeBlocks(container) {
    if (!container) return;

    // Find all pre elements that don't already have a wrapper
    container.querySelectorAll('pre:not(.inline-artifact-code):not(.inline-mermaid-source)').forEach(pre => {
        // Skip if already wrapped
        if (pre.parentElement?.classList.contains('code-block-wrapper')) return;

        // Skip if it's inside a code-block-wrapper already
        if (pre.closest('.code-block-wrapper')) return;

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';

        // Create copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.title = 'Copy code';
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.innerHTML = '<i class="fi fi-tr-copy"></i>';

        // Add click handler
        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
                const codeEl = pre.querySelector('code');
                if (!codeEl) return;

                const code = codeEl.textContent || codeEl.innerText || '';
                await navigator.clipboard.writeText(code);

                // Visual feedback
                const icon = copyBtn.querySelector('i');
                const originalClass = icon.className;

                copyBtn.classList.add('copied');
                icon.className = 'fi fi-tr-check';

                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    icon.className = originalClass;
                }, 2000);

            } catch (error) {
                console.error('Failed to copy code:', error);
            }
        });

        // Wrap the pre element
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(copyBtn);
        wrapper.appendChild(pre);
    });
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
                    <i class="fi fi-tr-wisdom tool-log-icon"></i>
                    <div class="tool-log-details">
                        <span class="tool-log-action">Used tool: <strong>${toolName}</strong></span>
                    </div>
                    <span class="tool-log-status completed"></span>
                </div>`;
        }

        // Aggregate content from sub-agent runs
        if (event.event === 'RunCompleted' && owner !== mainAgentName) {
            if (event.content) {
                const formattedContent = messageFormatter.format(event.content, { inlineArtifacts });
                subAgentBlocksHtml += `
                    <div class="content-block log-block">
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
                    <div class="inner-content">${messageFormatter.format(finalContent, { inlineArtifacts }) || '(No final response content)'}</div>
                </div>
            </div>
        </div>
    `;

    targetContainer.innerHTML = finalHtml;

    if (inlineArtifacts && typeof messageFormatter.applyInlineEnhancements === 'function') {
        messageFormatter.applyInlineEnhancements(targetContainer);
    }

    // Add action buttons to historical messages
    const messageDiv = targetContainer.querySelector('.message-bot');
    if (messageDiv) {
        addMessageActionButtons(messageDiv);
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
        window.currentConversationId = currentConversationId;
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

        // Store attachment metadata temporarily (will persist after AI response)
        if (attachedFiles.length > 0) {
            console.log(`[AttachmentDB] Storing ${attachedFiles.length} files metadata temporarily (error recovery flow)`);
            window.pendingAttachmentMetadata = {
                sessionId: currentConversationId,
                files: attachedFiles,
                userId: session.user.id
            };
        } else {
            window.pendingAttachmentMetadata = null;
        }

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
            agent_mode: resolveAgentMode(),
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

    // CORRECTED FLOW: Store attachment metadata temporarily, will persist after AI response
    if (attachedFiles.length > 0) {
        console.log(`[AttachmentDB] Storing ${attachedFiles.length} files metadata temporarily, will persist after AI response`);
        window.pendingAttachmentMetadata = {
            sessionId: currentConversationId,
            files: attachedFiles,
            userId: session.user.id
        };
    } else {
        // Clear any pending metadata if no files attached
        window.pendingAttachmentMetadata = null;
    }

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
        agent_mode: resolveAgentMode(),
        accessToken: session.access_token,
        config: { use_memory: chatConfig.memory, ...chatConfig.tools }
    };

    try {
        ipcRenderer.send('send-message', messageData);

        // Check if session has content after sending (files will be registered by backend)
        if (attachedFiles.length > 0) {
            // Delay check slightly to allow backend to register
            setTimeout(() => checkAndShowContentButton(), 1000);
        }
    } catch (error) {
        console.error('Error sending message:', error);
        populateBotMessage({ content: 'Error sending message', id: messageId });
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
        sendMessageBtn.classList.remove('sending');
        // Clear pending metadata on error
        window.pendingAttachmentMetadata = null;
    }

    floatingInput.value = '';
    floatingInput.style.height = 'auto';
    fileAttachmentHandler.clearAttachedFiles();
    contextHandler.clearSelectedContext();
}

/**
 * Persists attachment metadata to the Supabase attachment table
 * @param {string} sessionId - Current conversation/session ID
 * @param {Array} files - Array of file objects with metadata
 * @param {string} userId - Current user ID
 */
async function persistAttachmentMetadata(sessionId, files, userId) {
    try {
        console.log(`[AttachmentDB] Persisting metadata for ${files.length} files to session ${sessionId}`);

        // Prepare attachment records
        const attachmentRecords = files.map(file => ({
            session_id: sessionId,
            user_id: userId,
            metadata: {
                file_id: file.file_id,
                name: file.name,
                type: file.type,
                size: file.size,
                relativePath: file.relativePath,
                supabasePath: file.path || null,
                isMedia: file.isMedia,
                isText: file.isText
            }
        }));

        // Insert into attachment table using exposed method
        const { data, error } = await window.electron.auth.insertAttachments(attachmentRecords);

        if (error) {
            console.error('[AttachmentDB] Error inserting attachment metadata:', error);
            // Don't throw - this is non-critical, message should still send
        } else {
            console.log(`[AttachmentDB] Successfully persisted ${files.length} attachment records`);
            
            // Invalidate cache when new attachment content is added
            if (window.sessionContentViewer && sessionId) {
                window.sessionContentViewer.invalidateCache(sessionId);
            }
        }
    } catch (error) {
        console.error('[AttachmentDB] Exception persisting attachment metadata:', error);
        // Don't throw - this is non-critical
    }
}

async function terminateSession(conversationIdToTerminate) {
    if (!conversationIdToTerminate) return;

    // CRITICAL: Save pending attachments for this session before terminating
    if (window.pendingAttachmentMetadata &&
        window.pendingAttachmentMetadata.sessionId === conversationIdToTerminate) {
        console.log('[AttachmentDB] Saving pending metadata before session termination');
        await persistAttachmentMetadata(
            window.pendingAttachmentMetadata.sessionId,
            window.pendingAttachmentMetadata.files,
            window.pendingAttachmentMetadata.userId
        );
        window.pendingAttachmentMetadata = null;
    }

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
    if (type === 'error') {
        icon.className = 'fas fa-exclamation-circle';
    } else if (type === 'success') {
        icon.className = 'fas fa-check-circle';
    } else {
        icon.className = 'fas fa-info-circle';
    }
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
        this.updateContextIndicator();
    }
    showHistoricalContext(contextData) {
        this.updateContextContent(contextData.sessions);
        this.updateFilesContent(contextData.files);
        this.viewer.classList.add('visible');
    }
    showViewer() {
        const sessions = this.contextHandler.getSelectedSessions();
        const files = this.fileAttachmentHandler.getAttachedFiles();

        // Update both contents
        this.updateContextContent(sessions);
        this.updateFilesContent(files);

        // Show empty state if nothing is selected
        const unifiedContent = this.viewer.querySelector('.unified-context-content');
        if ((!sessions || sessions.length === 0) && (!files || files.length === 0)) {
            unifiedContent.innerHTML = '<div class="empty-state"><i class="fas fa-inbox" style="font-size: 2.5rem; margin-bottom: 12px; opacity: 0.3;"></i><p>No context or files selected</p></div>';
        }

        this.viewer.classList.add('visible');
    }
    hideViewer() { this.viewer.classList.remove('visible'); }
    updateContextContent(sessions) {
        const contextContent = this.viewer.querySelector('.context-preview-content');
        if (!sessions?.length) {
            contextContent.innerHTML = '';
            return;
        }

        let html = sessions.map((session, index) => `
            <div class="session-block">
                <div class="session-block-header">
                    <h4>Session ${index + 1}</h4>
                </div>
                ${session.interactions && session.interactions.length > 0
                ? session.interactions.map(int => `
                        <div class="interaction">
                            <div class="user-message"><strong>You:</strong> ${this.escapeHtml(int.user_input)}</div>
                            <div class="assistant-message"><strong>Assistant:</strong> ${this.escapeHtml(int.llm_output)}</div>
                        </div>`).join('')
                : '<div class="interaction"><p style="color: var(--text-secondary); margin: 0;">No interactions in this session</p></div>'
            }
            </div>`).join('');
        contextContent.innerHTML = html;
    }

    updateFilesContent(files) {
        const filesContent = this.viewer.querySelector('.files-preview-content');
        if (!files?.length) {
            filesContent.innerHTML = '';
            return;
        }

        let html = '';
        if (files.length > 0) {
            html += '<div class="section-header"><i class="fas fa-paperclip"></i> Files</div>';
            html += files.map((file, index) => `
                <div class="file-preview-item">
                    <div class="file-preview-header-item">
                        <div class="file-info">
                            <i class="${this.fileAttachmentHandler.getFileIcon(file.name)} file-icon"></i>
                            <span class="file-name" title="${file.name}">${file.name}</span>
                        </div>
                        <div class="file-actions">
                            <button class="preview-toggle" title="Toggle Preview" aria-label="Toggle file preview">
                                <i class="fas fa-chevron-down"></i>
                            </button>
                            <button class="remove-file" title="Remove File" aria-label="Remove file">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                    <div class="file-preview-content-item">
                        ${file.isMedia ? this.renderMediaPreview(file) : (file.content || "No preview available")}
                    </div>
                </div>`).join('');
        }
        filesContent.innerHTML = html;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
 * Sets up the View Content button click handler
 */
function setupViewContentButton() {
    const viewContentBtn = document.getElementById('view-content-btn');
    if (!viewContentBtn) {
        console.warn('[Chat] View content button not found');
        return;
    }

    viewContentBtn.addEventListener('click', () => {
        if (!currentConversationId || !window.sessionContentViewer) {
            return;
        }

        if (window.sessionContentViewer.isVisible()) {
            window.sessionContentViewer.hide();
        } else {
            window.sessionContentViewer.show(currentConversationId);
        }
    });

    console.log('[Chat] View content button setup complete');
}

/**
 * Checks if current session has content and shows/hides the View Content button
 */
async function checkAndShowContentButton() {
    if (!currentConversationId) {
        hideContentButton();
        return;
    }

    try {
        // Check if sessionContentViewer has cached data for this session
        if (window.sessionContentViewer) {
            const cachedContent = window.sessionContentViewer.getCachedContent(currentConversationId);
            if (cachedContent) {
                console.log('[Chat] Using cached content count:', cachedContent.length);
                if (cachedContent.length > 0) {
                    showContentButton();
                } else {
                    hideContentButton();
                }
                return;
            }
        }

        const session = await window.electron.auth.getSession();
        if (!session || !session.access_token) {
            hideContentButton();
            return;
        }

        // Fetch content count from backend
        const response = await fetch(`http://localhost:8765/api/sessions/${currentConversationId}/content`, {
            headers: {
                'Authorization': `Bearer ${session.access_token}`
            }
        });

        if (!response.ok) {
            console.warn('[Chat] Failed to fetch content count:', response.status);
            hideContentButton();
            return;
        }

        const data = await response.json();
        const count = data.count || 0;

        // Cache the content in sessionContentViewer
        if (window.sessionContentViewer && data.content) {
            window.sessionContentViewer.cacheContent(currentConversationId, data.content);
        }

        console.log('[Chat] Content count for session:', count);

        if (count > 0) {
            showContentButton();
        } else {
            hideContentButton();
        }
    } catch (error) {
        console.error('[Chat] Error checking content:', error);
        hideContentButton();
    }
}

/**
 * Shows the View Content button
 */
function showContentButton() {
    const viewContentBtn = document.getElementById('view-content-btn');

    if (viewContentBtn) {
        viewContentBtn.classList.remove('hidden');
    }
}

/**
 * Hides the View Content button
 */
function hideContentButton() {
    const viewContentBtn = document.getElementById('view-content-btn');

    if (viewContentBtn) {
        viewContentBtn.classList.add('hidden');
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

    // Start background loading of sessions after a short delay
    // This happens automatically without user interaction
    contextHandler.preloadSessions();

    shuffleMenuController = new ShuffleMenuController(chatConfig);
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

            // Register project workspace window
            const projectWindow = document.getElementById('project-workspace-panel');
            if (projectWindow) {
                floatingWindowManager.registerWindow('project-workspace', projectWindow);
            } else {
                console.warn('Project workspace element not found for registration');
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

    // Expose fileAttachmentHandler globally for context re-use
    window.fileAttachmentHandler = fileAttachmentHandler;

    window.unifiedPreviewHandler = new UnifiedPreviewHandler(contextHandler, fileAttachmentHandler);

    // Initialize session content viewer
    window.sessionContentViewer = sessionContentViewer;
    setupViewContentButton();
    console.log('[Chat] Session content viewer initialized');

    // Initialize audio input handler with model check
    const micButton = document.getElementById('mic-button');
    if (micButton && window.AudioInputHandler) {
        audioInputHandler = new AudioInputHandler();
        const initialized = audioInputHandler.initialize(micButton, elements.input);

        if (initialized) {
            // Check if model is already available
            audioInputHandler.checkModelAvailability().then(isAvailable => {
                if (!isAvailable) {
                    console.log('[Chat] Voice model not available, starting download...');
                    // Download model in background
                    audioInputHandler.downloadModel();
                } else {
                    console.log('[Chat] Voice model already available');
                }
            });
        } else {
            console.warn('Audio input handler could not be initialized');
        }
    }

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

    // CRITICAL: Save pending attachments before window closes or app quits
    window.addEventListener('beforeunload', async (event) => {
        if (window.pendingAttachmentMetadata) {
            console.log('[AttachmentDB] Saving pending metadata before window closes');
            // Prevent window from closing immediately
            event.preventDefault();
            event.returnValue = '';

            // Save metadata
            await persistAttachmentMetadata(
                window.pendingAttachmentMetadata.sessionId,
                window.pendingAttachmentMetadata.files,
                window.pendingAttachmentMetadata.userId
            );
            window.pendingAttachmentMetadata = null;
        }
    });

    startNewConversation();
}

window.chatModule = { init };
