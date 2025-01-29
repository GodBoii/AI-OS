// chat.js
let chatConfig = {
    memory: false,
    tools: {
        calculator: true,
        ddg_search: true,
        python_assistant: true,
        investment_assistant: true,
        shell_tools: true,
        web_crawler: true
    }
};

let socket = null;
let ongoingStreams = {};
let sessionActive = false;

function connectSocket() {
    socket = io('http://localhost:8765', {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        transports: ['websocket']
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        document.querySelectorAll('.connection-error').forEach(e => e.remove());
        sessionActive = false; 
    });

    socket.on('response', (data) => { 
        console.log('Raw response:', data); 
        try {
            const isStreaming = data.streaming || false;
            const isDone = data.done || false;
            const messageId = data.id;
            
            if (isStreaming) {
                addMessage(data, false, true, messageId, isDone);
            } else if (data.content || data.message) {
                addMessage(data, false);
            }
            
            // Re-enable UI after response
            document.getElementById('floating-input').disabled = false;
            document.getElementById('send-message').disabled = false;
            
        } catch (error) {
            console.error('Error handling response:', error);
            addMessage('Error processing response', false);
        }
    });

    socket.on('error', (error) => {
        console.error('Error:', error);
        addMessage(error.message || 'An error occurred', false);
        
        // Reset UI and start new chat if needed
        document.getElementById('floating-input').disabled = false;
        document.getElementById('send-message').disabled = false;
        
        if (error.reset) {
            sessionActive = false;
            document.querySelector('.add-btn').click();
        }
    });

    socket.on('disconnect', () => {
        sessionActive = false;
        if (!document.querySelector('.connection-error')) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'connection-error';
            errorDiv.textContent = 'Connecting to server...';
            document.body.appendChild(errorDiv);
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Connection Error:', error);
        sessionActive = false;
        showConnectionError();
    });
}

function showConnectionError() {
    if (!document.querySelector('.connection-error')) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'connection-error';
        errorDiv.textContent = 'Connecting to server...';
        document.body.appendChild(errorDiv);
    }
}

function addMessage(message, isUser, isStreaming = false, messageId = null, isDone = false) {
    const chatMessages = document.getElementById('chat-messages');
    
    if (isStreaming && !isUser) {
        if (!messageId) return;

        let messageDiv = ongoingStreams[messageId];
        if (!messageDiv) {
            messageDiv = document.createElement('div');
            messageDiv.className = 'message message-bot';
            chatMessages.appendChild(messageDiv);
            ongoingStreams[messageId] = messageDiv;
        }

        if (typeof message === 'object' && message.content) {
            // Process markdown with table support
            const markedOptions = {
                breaks: true,
                gfm: true,
                tables: true,
                renderer: new marked.Renderer()
            };

            // Custom table renderer
            markedOptions.renderer.table = function(header, body) {
                return `<div class="table-container"><table>
                    <thead>${header}</thead>
                    <tbody>${body}</tbody>
                </table></div>`;
            };

            // Process content
            const renderedContent = marked.parse(message.content, markedOptions);
            
            // Clean up and standardize table formatting
            const cleanedContent = renderedContent
                .replace(/\|(\s*[-:]+[-| :]*)\|/g, (match) => {
                    // Standardize separator rows in markdown tables
                    return match.replace(/\s+/g, '');
                });

            messageDiv.innerHTML += cleanedContent;
            
            // Highlight code blocks
            messageDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

        if (isDone) {
            delete ongoingStreams[messageId];
        }
    } else {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'message-user' : 'message-bot'}`;
        
        if (isUser) {
            messageDiv.textContent = message;
        } else {
            if (typeof message === 'object' && message.content) {
                // Process markdown while preserving natural text flow
                messageDiv.innerHTML = marked.parse(message.content, {
                    breaks: false,
                    gfm: true
                });
                messageDiv.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            } else {
                messageDiv.textContent = message;
            }
        }
        
        chatMessages.appendChild(messageDiv);
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function handleSendMessage() {
    const floatingInput = document.getElementById('floating-input');
    const sendMessageBtn = document.getElementById('send-message');
    const message = floatingInput.value.trim();
    
    if (!message || !socket?.connected) return;
    
    floatingInput.disabled = true;
    sendMessageBtn.disabled = true;
    
    addMessage(message, true);
    
    const messageId = Date.now().toString();
    const messageData = {
        message: message,
        id: messageId
    };

    // Only send config on first message of new session
    if (!sessionActive) {
        messageData.config = {
            use_memory: chatConfig.memory,
            ...chatConfig.tools
        };
        sessionActive = true;
    }

    try {
        socket.emit('send_message', JSON.stringify(messageData));
    } catch (error) {
        console.error('Error sending message:', error);
        addMessage('Error sending message', false);
        floatingInput.disabled = false;
        sendMessageBtn.disabled = false;
    }
    
    floatingInput.value = '';
    floatingInput.style.height = 'auto';
}

function initializeToolsMenu() {
    const toolsBtn = document.querySelector('[data-tool="tools"]');
    const toolsMenu = toolsBtn.querySelector('.tools-menu');
    const checkboxes = toolsMenu.querySelectorAll('input[type="checkbox"]');
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = chatConfig.tools[checkbox.id] || false;
    });

    const updateToolsIndicator = () => {
        const anyActive = Array.from(checkboxes).some(c => c.checked);
        toolsBtn.classList.toggle('has-active', anyActive);
    };

    toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toolsBtn.classList.toggle('active');
        toolsMenu.classList.toggle('visible');
    });

    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            chatConfig.tools[e.target.id] = e.target.checked;
            updateToolsIndicator();
            e.stopPropagation();
        });
    });

    document.addEventListener('click', (e) => {
        if (!toolsBtn.contains(e.target)) {
            toolsBtn.classList.remove('active');
            toolsMenu.classList.remove('visible');
        }
    });

    updateToolsIndicator();
}

function handleMemoryToggle() {
    const memoryBtn = document.querySelector('[data-tool="memory"]');
    memoryBtn.addEventListener('click', () => {
        chatConfig.memory = !chatConfig.memory;
        memoryBtn.classList.toggle('active', chatConfig.memory);
    });
}

function init() {
    const elements = {
        container: document.getElementById('chat-container'),
        messages: document.getElementById('chat-messages'),
        input: document.getElementById('floating-input'),
        sendBtn: document.getElementById('send-message'),
        minimizeBtn: document.getElementById('minimize-chat'),
        closeBtn: document.getElementById('close-chat'),
        newChatBtn: document.querySelector('.add-btn')
    };

    initializeToolsMenu();
    handleMemoryToggle();
    connectSocket();

    elements.sendBtn.addEventListener('click', handleSendMessage);

    elements.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    elements.newChatBtn.addEventListener('click', () => {
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.innerHTML = '';
        
        chatConfig = {
            memory: false,
            tools: {
                calculator: true,
                ddg_search: true,
                python_assistant: true,
                investment_assistant: true,
                shell_tools: true,
                web_crawler: true
            }
        };
        
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        document.querySelectorAll('.tools-menu input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = chatConfig.tools[checkbox.id] || false;
        });
    
        // Send reinitialize request with flattened config
        if (socket?.connected) {
            socket.emit('send_message', JSON.stringify({
                type: 'new_chat'
            }));
            sessionActive = false;
        }

        elements.minimizeBtn.addEventListener('click', () => {
            elements.container.classList.add('hidden');
            document.getElementById('floating-input-container').classList.add('hidden');
        });
    
        elements.closeBtn.addEventListener('click', () => {
            elements.container.classList.add('hidden');
            document.getElementById('floating-input-container').classList.add('hidden');
        });
    });

    // Send initial config on connection
    socket.on('connect', () => {
        socket.emit('send_message', JSON.stringify({
            type: 'initialize',
            config: {
                calculator: true,
                ddg_search: true,
                python_assistant: true,
                investment_assistant: true,
                shell_tools: true,
                web_crawler: true,
                use_memory: chatConfig.memory
            }
        }));
    });
}

window.chatModule = { init };