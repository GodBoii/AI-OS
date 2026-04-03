// ui-utilities.js
// UI utility functions for chat interface (connection errors, message actions, share modal)

// Import ipcRenderer for connection retry functionality
const ipcRenderer = window.electron?.ipcRenderer;

/**
 * Shows a connection error message with retry button
 * @param {string} message - Error message to display
 */
export function showConnectionError(message = 'Connecting to server...') {
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
        if (ipcRenderer) {
            ipcRenderer.send('restart-python-bridge');
        }
    });
}

/**
 * Adds copy and share action buttons to a completed AI message
 * @param {HTMLElement} messageDiv - The message container element
 */
export function addMessageActionButtons(messageDiv) {
    if (!messageDiv) return;

    // Check if buttons already exist
    if (messageDiv.querySelector('.message-actions')) return;

    const messageContent = messageDiv.querySelector('.message-content');
    if (!messageContent) return;

    // Create action buttons container
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    actionsDiv.innerHTML = `
        <button class="action-btn copy-btn" title="Copy response" aria-label="Copy response">
            <i class="fi fi-tr-copy"></i>
        </button>
        <button class="action-btn share-btn" title="Share response" aria-label="Share response">
            <i class="fi fi-tr-share-square"></i>
        </button>
    `;

    // Insert after message content
    messageContent.appendChild(actionsDiv);

    // Add event listeners
    const copyBtn = actionsDiv.querySelector('.copy-btn');
    const shareBtn = actionsDiv.querySelector('.share-btn');

    copyBtn.addEventListener('click', () => handleCopyMessage(messageDiv, copyBtn));
    shareBtn.addEventListener('click', () => handleShareMessage(messageDiv));
}

/**
 * Handles copying the AI message content to clipboard
 * @param {HTMLElement} messageDiv - The message container element
 * @param {HTMLElement} button - The copy button element
 */
async function handleCopyMessage(messageDiv, button) {
    try {
        // Extract text content from the message
        const contentBlock = messageDiv.querySelector('.message-content .inner-content');
        if (!contentBlock) return;

        // Create a temporary div to convert HTML to plain text properly
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentBlock.innerHTML;

        // Get text content
        let textContent = tempDiv.textContent || tempDiv.innerText || '';
        textContent = textContent.trim();

        // Copy to clipboard
        await navigator.clipboard.writeText(textContent);

        // Visual feedback
        const icon = button.querySelector('i');
        const originalClass = icon.className;
        icon.className = 'fi fi-tr-check';
        button.classList.add('copied');

        setTimeout(() => {
            icon.className = originalClass;
            button.classList.remove('copied');
        }, 2000);

    } catch (error) {
        console.error('Failed to copy message:', error);
        showNotification('Failed to copy message', 'error', 3000);
    }
}

/**
 * Handles sharing the AI message content
 * Cross-platform implementation for Windows, Linux, and macOS
 * @param {HTMLElement} messageDiv - The message container element
 */
async function handleShareMessage(messageDiv) {
    try {
        const contentBlock = messageDiv.querySelector('.message-content .inner-content');
        if (!contentBlock) return;

        // Extract text content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentBlock.innerHTML;
        let textContent = tempDiv.textContent || tempDiv.innerText || '';
        textContent = textContent.trim();

        // For desktop apps (Electron), Web Share API is not reliable
        // Use a cross-platform approach: save to file and show options
        if (window.electron && window.electron.ipcRenderer) {
            // Show share options modal
            showShareModal({ content: textContent, messageDiv });
        } else {
            // Fallback for web version: try Web Share API, then clipboard
            if (navigator.share && navigator.canShare && navigator.canShare({ text: textContent })) {
                try {
                    await navigator.share({
                        title: 'AI Response from Aetheria AI-OS',
                        text: textContent
                    });
                } catch (shareError) {
                    if (shareError.name !== 'AbortError') {
                        // If share fails, copy to clipboard
                        await navigator.clipboard.writeText(textContent);
                        showNotification('Response copied to clipboard', 'success', 3000);
                    }
                }
            } else {
                // Copy to clipboard as fallback
                await navigator.clipboard.writeText(textContent);
                showNotification('Response copied to clipboard', 'success', 3000);
            }
        }

    } catch (error) {
        console.error('Failed to share message:', error);
        showNotification('Failed to share message', 'error', 3000);
    }
}

/**
 * Shows a share modal with multiple sharing options
 * @param {{ content: string, messageDiv: HTMLElement }} options - Share options payload
 */
function showShareModal(options) {
    const content = options?.content || '';
    const messageDiv = options?.messageDiv || null;

    // Remove existing modal if any
    const existingModal = document.querySelector('.share-modal-overlay');
    if (existingModal) existingModal.remove();

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'share-modal-overlay';
    overlay.innerHTML = `
        <div class="share-modal">
            <div class="share-modal-header">
                <h3>Share Response</h3>
                <button class="share-modal-close" aria-label="Close">
                    <i class="fi fi-tr-cross"></i>
                </button>
            </div>
            <div class="share-modal-content">
                <button class="share-option" data-action="copy">
                    <i class="fi fi-tr-copy"></i>
                    <span>Copy to Clipboard</span>
                </button>
                <button class="share-option" data-action="save-txt">
                    <i class="fi fi-tr-document"></i>
                    <span>Save as Text File</span>
                </button>
                <button class="share-option" data-action="save-md">
                    <i class="fi fi-tr-file-edit"></i>
                    <span>Save as Markdown</span>
                </button>
                <button class="share-option" data-action="export-pdf">
                    <i class="fi fi-tr-file-export"></i>
                    <span>Share Entire Conversation (PDF)</span>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Add event listeners
    const closeModal = () => {
        overlay.classList.add('closing');
        setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('.share-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Handle ESC key to close modal
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleKeyDown);
        }
    };
    document.addEventListener('keydown', handleKeyDown);

    // Handle share options
    overlay.querySelectorAll('.share-option').forEach(option => {
        option.addEventListener('click', async () => {
            const action = option.dataset.action;

            try {
                if (action === 'copy') {
                    await navigator.clipboard.writeText(content);
                    showNotification('Response copied to clipboard', 'success', 3000);
                    closeModal();
                } else if (action === 'save-txt' || action === 'save-md') {
                    const extension = action === 'save-txt' ? 'txt' : 'md';
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                    const filename = `ai-response-${timestamp}.${extension}`;

                    // Use Electron's save dialog
                    if (window.electron && window.electron.ipcRenderer) {
                        window.electron.ipcRenderer.send('save-file-dialog', {
                            content: content,
                            defaultPath: filename,
                            filters: [
                                { name: extension.toUpperCase() + ' Files', extensions: [extension] },
                                { name: 'All Files', extensions: ['*'] }
                            ]
                        });

                        // Listen for save result (one-time listener)
                        const handleSaveResult = (result) => {
                            if (result.success) {
                                showNotification('Response saved successfully', 'success', 3000);
                            } else if (result.error) {
                                showNotification('Failed to save file', 'error', 3000);
                            }
                            // Clean up listener after handling
                            try {
                                window.electron.ipcRenderer.removeAllListeners('save-file-result');
                            } catch (e) {
                                console.warn('Could not remove listener:', e);
                            }
                        };

                        window.electron.ipcRenderer.on('save-file-result', handleSaveResult);
                        closeModal();
                    } else {
                        // Fallback for web: download file
                        const blob = new Blob([content], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = filename;
                        a.click();
                        URL.revokeObjectURL(url);
                        showNotification('Response downloaded', 'success', 3000);
                        closeModal();
                    }
                } else if (action === 'export-pdf') {
                    await exportEntireConversationPdf(messageDiv);
                    closeModal();
                }
            } catch (error) {
                console.error('Share action failed:', error);
                showNotification('Action failed', 'error', 3000);
            }
        });
    });

    // Show modal with animation
    setTimeout(() => overlay.classList.add('visible'), 10);
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseMessageContext(messageDiv) {
    if (!messageDiv || !messageDiv.dataset?.context) return null;
    try {
        return JSON.parse(messageDiv.dataset.context);
    } catch (error) {
        console.warn('Failed to parse message context:', error);
        return null;
    }
}

function getConversationThreadFromMessage(messageDiv) {
    return (
        messageDiv?.closest?.('.conversation-thread') ||
        document.querySelector('.conversation-thread.active') ||
        document.querySelector('#chat-messages .conversation-thread')
    );
}

function sanitizeAssistantMessageHtml(contentNode) {
    if (!contentNode) return '';

    const clone = contentNode.cloneNode(true);
    clone.querySelectorAll('.message-actions, .code-copy-btn, button, .view-turn-context-btn').forEach((node) => {
        node.remove();
    });

    // Blob URLs from renderer context won't reliably load in the hidden print window.
    clone.querySelectorAll('img').forEach((img) => {
        const src = String(img.getAttribute('src') || '');
        if (src.startsWith('blob:')) {
            const replacement = document.createElement('div');
            replacement.className = 'pdf-image-placeholder';
            replacement.textContent = '[Image omitted in export]';
            img.replaceWith(replacement);
        }
    });

    return clone.innerHTML.trim();
}

function extractConversationTurns(thread) {
    if (!thread) return [];

    const turns = [];
    const messages = thread.querySelectorAll('.message');

    messages.forEach((message) => {
        if (message.classList.contains('message-user')) {
            const text = (message.querySelector('.user-message-text')?.textContent || '').trim();
            if (!text) return;

            const context = parseMessageContext(message) || {};
            const files = Array.isArray(context.files) ? context.files : [];
            const attachments = files
                .map((file) => ({
                    name: String(file?.name || '').trim(),
                    type: String(file?.type || '').trim()
                }))
                .filter((file) => file.name);

            turns.push({
                role: 'user',
                text,
                attachments
            });
            return;
        }

        if (message.classList.contains('message-bot')) {
            const contentNode = message.querySelector('.message-content');
            const html = sanitizeAssistantMessageHtml(contentNode);
            const plain = (contentNode?.textContent || '').trim();

            if (!html && !plain) return;

            turns.push({
                role: 'assistant',
                html
            });
        }
    });

    return turns;
}

function buildConversationPdfHtml(turns, metadata = {}) {
    const { title = 'Untitled Conversation', timestamp = new Date() } = metadata;
    
    const formattedDate = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(timestamp);
    
    const formattedTime = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).format(timestamp);

    const content = turns.map((turn) => {
        if (turn.role === 'user') {
            const attachmentsHtml = (turn.attachments && turn.attachments.length > 0)
                ? `
                    <div class="turn-attachments">
                        ${turn.attachments.map((attachment) => `
                            <div class="attachment-pill">
                                <svg class="attachment-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                                </svg>
                                <div class="attachment-info">
                                    <span class="attachment-name">${escapeHtml(attachment.name)}</span>
                                    ${attachment.type ? `<span class="attachment-type">${escapeHtml(attachment.type)}</span>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `
                : '';

            return `
                <div class="turn turn-user">
                    <div class="turn-header">
                        <div class="turn-avatar turn-avatar-user">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                        </div>
                        <div class="turn-label">You</div>
                    </div>
                    <div class="turn-body user-body">
                        <p>${escapeHtml(turn.text)}</p>
                        ${attachmentsHtml}
                    </div>
                </div>
            `;
        }

        return `
            <div class="turn turn-assistant">
                <div class="turn-header">
                    <div class="turn-avatar turn-avatar-assistant">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2a10 10 0 1 0 10 10H12V2z"/>
                            <path d="M12 12 2.1 12"/>
                            <path d="M12 12l8.5-4.5"/>
                        </svg>
                    </div>
                    <div class="turn-label">Aetheria AI</div>
                </div>
                <div class="turn-body assistant-rich">
                    ${turn.html || ''}
                </div>
            </div>
        `;
    }).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} - Aetheria AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --color-brand: #6366f1;
      --color-brand-dark: #4f46e5;
      --color-text-primary: #0f172a;
      --color-text-secondary: #475569;
      --color-text-tertiary: #64748b;
      --color-surface: #ffffff;
      --color-surface-user: #f8fafc;
      --color-surface-assistant: #ffffff;
      --color-border: #e2e8f0;
      
      --font-display: 'Outfit', -apple-system, sans-serif;
      --font-body: 'Inter', -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    @page { margin: 24mm 20mm; size: A4; }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-body);
      color: var(--color-text-primary);
      background: var(--color-surface);
      line-height: 1.6;
      font-size: 14px;
    }

    /* Document Header */
    .document-header {
      padding-bottom: 24px;
      margin-bottom: 36px;
      border-bottom: 2px solid var(--color-brand);
      page-break-after: avoid;
    }

    .brand-section {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }

    .brand-logo {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--color-brand), var(--color-brand-dark));
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    .brand-name {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 700;
      color: var(--color-text-primary);
      letter-spacing: -0.02em;
    }

    .conversation-title {
      font-family: var(--font-display);
      font-size: 28px;
      font-weight: 600;
      color: var(--color-text-primary);
      margin-bottom: 12px;
      line-height: 1.3;
    }

    .conversation-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;
      color: var(--color-text-tertiary);
      font-weight: 500;
    }

    .meta-item { display: flex; align-items: center; gap: 6px; }

    /* Main Body */
    .document-body {
      max-width: 100%;
    }

    .turn {
      margin-bottom: 36px;
    }

    .turn-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
      page-break-after: avoid;
    }

    .turn-avatar {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      flex-shrink: 0;
    }

    .turn-avatar-user {
      background: #475569;
    }

    .turn-avatar-assistant {
      background: linear-gradient(135deg, var(--color-brand), var(--color-brand-dark));
    }

    .turn-label {
      font-family: var(--font-display);
      font-size: 15px;
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .turn-body {
      padding: 0 0 0 44px; /* Align with text, after avatar */
    }

    .user-body {
      font-size: 15px;
      color: var(--color-text-primary);
      white-space: pre-wrap;
      line-height: 1.7;
    }

    /* Attachments */
    .turn-attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 16px;
    }

    .attachment-pill {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: var(--color-surface-user);
      border: 1px solid var(--color-border);
      border-radius: 8px;
    }

    .attachment-icon { color: var(--color-text-tertiary); flex-shrink: 0; }

    .attachment-info {
      display: flex;
      flex-direction: column;
    }

    .attachment-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .attachment-type {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Assistant Rich Content */
    .assistant-rich {
      font-size: 14.5px;
      line-height: 1.75;
      color: var(--color-text-secondary);
    }

    .assistant-rich p { margin-bottom: 16px; }
    .assistant-rich p:last-child { margin-bottom: 0; }

    .assistant-rich h1, .assistant-rich h2, .assistant-rich h3, .assistant-rich h4 {
      font-family: var(--font-display);
      color: var(--color-text-primary);
      margin: 24px 0 12px;
      font-weight: 600;
    }
    
    .assistant-rich h1 { font-size: 20px; }
    .assistant-rich h2 { font-size: 18px; }
    .assistant-rich h3 { font-size: 16px; }

    .assistant-rich code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: var(--color-surface-user);
      border: 1px solid var(--color-border);
      padding: 2px 6px;
      border-radius: 4px;
      color: #b91c1c;
    }

    .assistant-rich pre {
      background: var(--color-surface-user);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      overflow-x: auto;
      white-space: pre-wrap;
    }

    .assistant-rich pre code {
      background: transparent;
      border: none;
      padding: 0;
      color: var(--color-text-primary);
      font-size: 13px;
    }

    .assistant-rich ul, .assistant-rich ol {
      margin: 16px 0 16px 24px;
      padding: 0;
      color: var(--color-text-secondary);
    }
    .assistant-rich li { margin-bottom: 8px; }
    
    .assistant-rich img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      border: 1px solid var(--color-border);
      margin: 16px 0;
      display: block;
    }

    .pdf-image-placeholder {
      margin: 16px 0;
      padding: 16px;
      border: 1px dashed var(--color-text-tertiary);
      border-radius: 8px;
      color: var(--color-text-tertiary);
      font-size: 13px;
      background: var(--color-surface-user);
      text-align: center;
      font-style: italic;
    }

    .assistant-rich blockquote {
      margin: 16px 0;
      padding: 12px 20px;
      border-left: 4px solid var(--color-brand);
      background: var(--color-surface-user);
      color: var(--color-text-secondary);
      font-style: italic;
      border-radius: 0 8px 8px 0;
    }

    .assistant-rich table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 13px;
    }

    .assistant-rich th, .assistant-rich td {
      border: 1px solid var(--color-border);
      padding: 12px;
      text-align: left;
    }

    .assistant-rich th {
      background: var(--color-surface-user);
      font-weight: 600;
      color: var(--color-text-primary);
    }

    /* Footer */
    .document-footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid var(--color-border);
      text-align: center;
      color: var(--color-text-tertiary);
      font-size: 12px;
      font-family: var(--font-display);
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="document-header">
    <div class="brand-section">
      <div class="brand-name">Aetheria AI</div>
    </div>
    <div class="conversation-title">${escapeHtml(title)}</div>
    <div class="conversation-meta">
      <div class="meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span>${formattedDate}</span>
      </div>
      <div class="meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>${formattedTime}</span>
      </div>
    </div>
  </div>

  <main class="document-body">
    ${content}
  </main>

  <footer class="document-footer">
    Generated by Aetheria AI • Premium Export
  </footer>
</body>
</html>
    `;
}

function sanitizeFilenameSegment(value) {
    const normalized = String(value || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.slice(0, 120) || 'aetheria-conversation';
}

async function createPdfFilename(thread) {
    const conversationId = String(thread?.dataset?.conversationId || window.currentConversationId || '').trim();
    if (conversationId && window.electron?.auth?.fetchSessionData) {
        try {
            const session = await window.electron.auth.fetchSessionData(conversationId);
            const title = String(session?.session_title || '').trim();
            if (title) {
                return `${sanitizeFilenameSegment(title)}.pdf`;
            }
        } catch (error) {
            console.warn('Could not fetch session title for PDF filename:', error);
        }
    }

    const now = new Date();
    const iso = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `aetheria-conversation-${iso}.pdf`;
}

async function exportEntireConversationPdf(messageDiv) {
    const thread = getConversationThreadFromMessage(messageDiv);
    if (!thread) {
        showNotification('Could not find conversation to export', 'error', 3000);
        return;
    }

    const turns = extractConversationTurns(thread);
    if (!turns.length) {
        showNotification('No conversation messages found to export', 'error', 3000);
        return;
    }

    // Fetch conversation metadata
    const conversationId = String(thread?.dataset?.conversationId || window.currentConversationId || '').trim();
    let title = 'Untitled Conversation';
    
    if (conversationId && window.electron?.auth?.fetchSessionData) {
        try {
            const session = await window.electron.auth.fetchSessionData(conversationId);
            title = String(session?.session_title || '').trim() || title;
        } catch (error) {
            console.warn('Could not fetch session title for PDF:', error);
        }
    }

    const metadata = {
        title,
        timestamp: new Date()
    };

    const html = buildConversationPdfHtml(turns, metadata);

    if (!window.electron?.ipcRenderer?.invoke) {
        showNotification('PDF export is available in desktop app only', 'error', 3000);
        return;
    }

    const result = await window.electron.ipcRenderer.invoke('export-conversation-pdf', {
        html,
        defaultPath: await createPdfFilename(thread)
    });

    if (result?.success) {
        showNotification('Conversation PDF exported successfully', 'success', 3000);
        return;
    }

    if (result?.canceled) {
        return;
    }

    showNotification(result?.error || 'Failed to export conversation PDF', 'error', 3000);
}

/**
 * Shows a notification message
 * @param {string} message - Notification message
 * @param {string} type - Notification type (error, success, info)
 * @param {number} duration - Duration in milliseconds
 */
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
