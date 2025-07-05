// chat.js (Final, Definitive Version)

import { messageFormatter } from './message-formatter.js';
import ContextHandler from './context-handler.js';
import FileAttachmentHandler from './add-files.js';

// Use the exposed electron APIs instead of direct requires
const fs = window.electron?.fs?.promises;
const path = window.electron?.path;
const ipcRenderer = window.electron?.ipcRenderer;

let chatConfig = {
    memory: false,
    tasks: false,
    tools: {
        calculator: true,
        internet_search: true,
        coding_assistant: true,
        investment_assistant: true,
        web_crawler: true,
        enable_github: true,
        enable_google_email: true,
        enable_google_drive: true
    },
    deepsearch: false
};

let ongoingStreams = {};   // Tracks ongoing message streams.
let sessionActive = false;  // Flag to indicate if a chat session is active.
let contextHandler = null;  // Instance of the ContextHandler.
let fileAttachmentHandler = null; // Instance of the FileAttachmentHandler.
let connectionStatus = false; // Track connection status
const maxFileSize = 10 * 1024 * 1024; // 10MB limit
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
 * Set up IPC listeners for communication with python-bridge.js
 */
function setupIpcListeners() {
    ipcRenderer.on('socket-connection-status', (data) => {
        connectionStatus = data.connected;
        if (data.connected) {
            document.querySelectorAll('.connection-error').forEach(e => e.remove());
            sessionActive = false;
        } else {
            let statusMessage = 'Connecting to server...';
            if (data.error) statusMessage = `Connection error: ${data.error}`;
            else if (data.reconnecting) statusMessage = `Reconnecting... (Attempt ${data.attempt}/${data.maxAttempts})`;
            showConnectionError(statusMessage);
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
                    thinkingIndicator.classList.add('steps-done');
                    // --- MODIFICATION: Count all steps, including nested ones ---
                    const stepCount = messageDiv.querySelectorAll('.thinking-step').length;
                    if (stepCount > 0) {
                        thinkingIndicator.setAttribute('data-summary', `Assistant used ${stepCount} tool${stepCount > 1 ? 's' : ''}`);
                    } else {
                         thinkingIndicator.setAttribute('data-summary', `Assistant`);
                    }
                }
                messageFormatter.finishStreaming(messageId);
                delete ongoingStreams[messageId];
            }

            // --- MODIFICATION: Recursively process the response data ---
            processResponseData(data);

            if (done || (!streaming && data.content)) {
                document.getElementById('floating-input').disabled = false;
                document.getElementById('send-message').disabled = false;
            }
        } catch (error) {
            console.error('Error handling response:', error);
            populateBotMessage({ content: 'Error processing response', id: data.id });
            document.getElementById('floating-input').disabled = false;
            document.getElementById('send-message').disabled = false;
        }
    });

    ipcRenderer.on('agent-step', (data) => {
        const { id: messageId, type, name, agent_name, team_name } = data;
        if (!messageId || !ongoingStreams[messageId]) return;

        const messageDiv = ongoingStreams[messageId];
        const stepsContainer = messageDiv.querySelector('.thinking-steps-container');
        if (!stepsContainer) return;

        const toolName = name.replace(/_/g, ' ');
        const stepId = `step-${messageId}-${agent_name || team_name}-${name}`;
        let stepDiv = document.getElementById(stepId);

        if (type === 'tool_start') {
            if (!stepDiv) {
                stepDiv = document.createElement('div');
                stepDiv.id = stepId;
                stepDiv.className = 'thinking-step';
                // --- MODIFICATION: Show which agent is using the tool ---
                const ownerName = agent_name || team_name || 'Assistant';
                stepDiv.innerHTML = `
                    <i class="fas fa-cog fa-spin step-icon"></i>
                    <span class="step-text"><strong>${ownerName}:</strong> Using ${toolName}...</span>
                `;
                stepsContainer.appendChild(stepDiv);
            }
        } else if (type === 'tool_end') {
            if (stepDiv) {
                const ownerName = agent_name || team_name || 'Assistant';
                stepDiv.innerHTML = `
                    <i class="fas fa-check-circle step-icon-done"></i>
                    <span class="step-text"><strong>${ownerName}:</strong> ${toolName}</span>
                `;
            }
        }
    });


    ipcRenderer.on('sandbox-command-started', (data) => {
        if (window.artifactHandler) {
            // This now just opens a waiting terminal
            window.artifactHandler.showTerminal(data.artifactId);
        }
    });
    
    ipcRenderer.on('sandbox-command-update', (data) => {
        if (window.artifactHandler) {
            // This updates the terminal with the command being run
            window.artifactHandler.updateCommand(data.artifactId, data.command);
        }
    });
    
    ipcRenderer.on('sandbox-command-finished', (data) => {
        if (window.artifactHandler) {
            window.artifactHandler.updateTerminalOutput(data.artifactId, data.stdout, data.stderr, data.exitCode);
        }
    });

    ipcRenderer.on('socket-error', (error) => {
        console.error('Socket error:', error);
        try {
            populateBotMessage({ content: error.message || 'An error occurred', id: Date.now().toString() });
            showNotification(error.message || 'An error occurred. Starting new session.');
            if (document.getElementById('floating-input')) document.getElementById('floating-input').disabled = false;
            if (document.getElementById('send-message')) document.getElementById('send-message').disabled = false;
            if (error.reset) {
                sessionActive = false;
                const addBtn = document.querySelector('.add-btn');
                if (addBtn) addBtn.click();
            }
        } catch (e) {
            console.error('Error handling socket error:', e);
        }
    });

    ipcRenderer.on('socket-status', (data) => console.log('Socket status:', data));
    ipcRenderer.send('check-socket-connection');
}

function processResponseData(data) {
    const { content, id: messageId, streaming = false, agent_name, team_name } = data;

    if (streaming || content) {
        populateBotMessage({ content, id: messageId, streaming, agent_name, team_name });
    }

    // Recursively process member responses
    if (data.member_responses && Array.isArray(data.member_responses)) {
        data.member_responses.forEach(memberResponse => {
            // Pass the top-level messageId down to keep everything in the same message bubble
            processResponseData({ ...memberResponse, id: messageId });
        });
    }
}
/**
 * Displays a connection error message.
 */
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

/**
 * Adds a message to the chat interface.
 */
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
}

function createBotMessagePlaceholder(messageId) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message message-bot';
    
    const thinkingIndicator = document.createElement('div');
    thinkingIndicator.className = 'thinking-indicator';
    thinkingIndicator.innerHTML = `<div class="thinking-steps-container"></div>`;
    messageDiv.appendChild(thinkingIndicator);

    // --- MODIFICATION: Create a main content area for all responses ---
    const mainContentDiv = document.createElement('div');
    mainContentDiv.className = 'message-content';
    mainContentDiv.id = `main-content-${messageId}`;
    messageDiv.appendChild(mainContentDiv);

    chatMessages.appendChild(messageDiv);
    ongoingStreams[messageId] = messageDiv;
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function populateBotMessage(data) {
    const { content, id: messageId, streaming = false, agent_name, team_name } = data;
    const messageDiv = ongoingStreams[messageId];
    if (!messageDiv) {
        console.warn("Could not find message div for ID:", messageId);
        return;
    }

    const ownerName = agent_name || team_name;
    if (!ownerName || !content) return; // Don't render empty content blocks

    const contentBlockId = `content-block-${messageId}-${ownerName}`;
    let contentBlock = document.getElementById(contentBlockId);

    if (!contentBlock) {
        contentBlock = document.createElement('div');
        contentBlock.id = contentBlockId;
        contentBlock.className = 'content-block';
        
        const header = document.createElement('div');
        header.className = 'content-block-header';
        header.textContent = ownerName.replace(/_/g, ' ');
        contentBlock.appendChild(header);

        const innerContent = document.createElement('div');
        innerContent.className = 'inner-content';
        contentBlock.appendChild(innerContent);

        const mainContentContainer = messageDiv.querySelector(`#main-content-${messageId}`);
        mainContentContainer.appendChild(contentBlock);
    }
    
    const innerContentDiv = contentBlock.querySelector('.inner-content');
    if (innerContentDiv) {
        const streamId = `${messageId}-${ownerName}`;
        const formattedContent = streaming 
            ? messageFormatter.formatStreaming(content, streamId) 
            : messageFormatter.format(content);
        innerContentDiv.innerHTML = formattedContent;
        if (innerContentDiv.querySelector('.mermaid')) {
            mermaid.init(undefined, innerContentDiv.querySelectorAll('.mermaid'));
        }
    }
}

async function handleSendMessage() {
    const floatingInput = document.getElementById('floating-input');
    const message = floatingInput.value.trim();
    const sendMessageBtn = document.getElementById('send-message');
    const attachedFiles = fileAttachmentHandler.getAttachedFiles();
    const selectedSessions = contextHandler.getSelectedSessions();

    if (!message && attachedFiles.length === 0) return;

    floatingInput.disabled = true;
    sendMessageBtn.disabled = true;

    const session = await window.electron.auth.getSession();
    if (!session || !session.access_token) {
        showNotification('You must be logged in to send a message.', 'error');
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
        return;
    }

    if (!connectionStatus) {
        showNotification('Not connected to server. Please wait...', 'error');
        ipcRenderer.send('restart-python-bridge');
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
        return;
    }
    
    let turnContextData = null;
    if (selectedSessions.length > 0 || attachedFiles.length > 0) {
        turnContextData = { sessions: selectedSessions, files: attachedFiles };
    }

    addUserMessage(message, turnContextData);

    const messageId = Date.now().toString();
    createBotMessagePlaceholder(messageId);

    let combinedContextForBackend = "";
    if (selectedSessions && selectedSessions.length > 0) {
        const contextStr = selectedSessions.map(session => {
            if (!session.interactions || !session.interactions.length) return '';
            return session.interactions.map(interaction => `User: ${interaction.user_input}\nAssistant: ${interaction.llm_output}`).join('\n\n');
        }).filter(Boolean).join('\n---\n');
        if (contextStr) combinedContextForBackend += contextStr + "\n---\n";
    }

    if (chatConfig.tasks) {
        try {
            const userContextPath = path.join(__dirname, '../user_context.txt');
            const taskListPath = path.join(__dirname, '../tasklist.txt');
            const userContextContent = await fs.readFile(userContextPath, 'utf8');
            const taskListContent = await fs.readFile(taskListPath, 'utf8');
            combinedContextForBackend += `User Context:\n${userContextContent}\n---\nTask List:\n${taskListContent}\n---\n`;
            chatConfig.tasks = false;
            document.querySelector('[data-tool="tasks"]').classList.remove('active');
        } catch (error) {
            console.error("Error reading context/task files:", error);
            showNotification("Error reading context files.", "error");
        }
    }

    const messageData = {
        message: message,
        id: messageId,
        files: attachedFiles,
        is_deepsearch: chatConfig.deepsearch,
        accessToken: session.access_token,
        context: combinedContextForBackend || undefined,
    };

    if (!sessionActive) {
        messageData.config = { use_memory: chatConfig.memory, ...chatConfig.tools };
        sessionActive = true;
    }

    try {
        ipcRenderer.send('send-message', messageData);
    } catch (error) {
        console.error('Error sending message:', error);
        populateBotMessage({ content: 'Error sending message', id: messageId });
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
    }

    floatingInput.value = '';
    floatingInput.style.height = 'auto';
    fileAttachmentHandler.clearAttachedFiles();
    contextHandler.clearSelectedContext();
}

/**
 * Initializes the tools menu and its behavior.
 */
function initializeToolsMenu() {
    const toolsBtn = document.querySelector('[data-tool="tools"]');
    const toolsMenu = toolsBtn.querySelector('.tools-menu');
    const aiOsCheckbox = document.getElementById('ai_os');
    const deepSearchDiv = document.createElement('div');
    deepSearchDiv.className = 'tool-item';
    deepSearchDiv.innerHTML = `<input type="checkbox" id="deep_search" /><label for="deep_search"><i class="fa-solid fa-magnifying-glass"></i>DeepSearch</label>`;
    toolsMenu.appendChild(deepSearchDiv);
    const deepSearchCheckbox = document.getElementById('deep_search');
    const allToolsEnabledInitially = Object.values(chatConfig.tools).every(val => val === true);
    aiOsCheckbox.checked = allToolsEnabledInitially;
    deepSearchCheckbox.checked = chatConfig.deepsearch;
    window.updateToolsIndicator = function() {
        const anyActive = aiOsCheckbox.checked || deepSearchCheckbox.checked;
        toolsBtn.classList.toggle('has-active', anyActive);
    };
    toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toolsBtn.classList.toggle('active');
        toolsMenu.classList.toggle('visible');
    });
    aiOsCheckbox.addEventListener('change', (e) => {
        const enableAll = e.target.checked;
        for (const key in chatConfig.tools) chatConfig.tools[key] = enableAll;
        if (enableAll) {
            deepSearchCheckbox.checked = false;
            chatConfig.deepsearch = false;
        }
        window.updateToolsIndicator();
        e.stopPropagation();
    });
    deepSearchCheckbox.addEventListener('change', (e) => {
        chatConfig.deepsearch = e.target.checked;
        if (e.target.checked) {
            aiOsCheckbox.checked = false;
            for (const key in chatConfig.tools) chatConfig.tools[key] = false;
        }
        window.updateToolsIndicator();
        e.stopPropagation();
    });
    document.addEventListener('click', (e) => {
        if (!toolsBtn.contains(e.target)) {
            toolsBtn.classList.remove('active');
            toolsMenu.classList.remove('visible');
        }
    });
    window.updateToolsIndicator();
}

function handleMemoryToggle() {
    const memoryBtn = document.querySelector('[data-tool="memory"]');
    memoryBtn.addEventListener('click', () => {
        chatConfig.memory = !chatConfig.memory;
        memoryBtn.classList.toggle('active', chatConfig.memory);
    });
}

function handleTasksToggle() {
    const tasksBtn = document.querySelector('[data-tool="tasks"]');
    tasksBtn.addEventListener('click', () => {
        chatConfig.tasks = !chatConfig.tasks;
        tasksBtn.classList.toggle('active', chatConfig.tasks);
    });
}

async function terminateSession() {
    sessionActive = false;
    ongoingStreams = {};
    chatConfig.deepsearch = false;
    if (fileAttachmentHandler) fileAttachmentHandler.clearAttachedFiles();
    const session = await window.electron.auth.getSession();
    if (!session || !session.access_token) {
        console.log("User is not logged in, terminating session locally.");
        return;
    }
    ipcRenderer.send('terminate-session', { accessToken: session.access_token });
}

function initializeAutoExpandingTextarea() {
    const textarea = document.getElementById('floating-input');
    textarea.addEventListener('input', function() {
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
        const indicator = document.querySelector('.context-active-indicator');
        const badge = indicator.querySelector('.context-badge');
        const sessionCount = this.contextHandler?.getSelectedSessions()?.length || 0;
        const fileCount = this.fileAttachmentHandler?.getAttachedFiles()?.length || 0;
        const totalCount = sessionCount + fileCount;
        if (totalCount > 0) {
            indicator.classList.add('visible');
            if (totalCount > 1) {
                badge.textContent = totalCount;
                badge.classList.add('visible');
            } else {
                badge.classList.remove('visible');
            }
        } else {
            indicator.classList.remove('visible');
            badge.classList.remove('visible');
        }
        if (!indicator.hasClickHandler) {
            indicator.addEventListener('click', () => this.showViewer());
            indicator.hasClickHandler = true;
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
    initializeToolsMenu();
    handleMemoryToggle();
    handleTasksToggle();
    setupIpcListeners();
    initializeAutoExpandingTextarea();
    fileAttachmentHandler = new FileAttachmentHandler(null, supportedFileTypes, maxFileSize);
    window.unifiedPreviewHandler = new UnifiedPreviewHandler(contextHandler, fileAttachmentHandler);
    elements.sendBtn.addEventListener('click', handleSendMessage);
    elements.minimizeBtn?.addEventListener('click', () => window.stateManager.setState({ isChatOpen: false }));
    elements.input.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } });
    elements.newChatBtn.addEventListener('click', () => {
        terminateSession();
        document.getElementById('chat-messages').innerHTML = '';
        document.getElementById('floating-input').disabled = false;
        document.getElementById('send-message').disabled = false;
        sessionActive = false;
        ongoingStreams = {};
        contextHandler.clearSelectedContext();
        chatConfig = {
            memory: false, tasks: false,
            tools: { calculator: true, internet_search: true, coding_assistant: true, investment_assistant: true, web_crawler: true, enable_github: true, enable_google_email: true, enable_google_drive: true },
            deepsearch: false
        };
        document.getElementById('ai_os').checked = true;
        document.querySelector('[data-tool="tasks"]').classList.remove('active');
        document.getElementById('deep_search').checked = false;
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    });
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