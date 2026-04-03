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

function buildConversationPdfHtml(turns) {
    const content = turns.map((turn) => {
        if (turn.role === 'user') {
            const attachmentsHtml = (turn.attachments && turn.attachments.length > 0)
                ? `
                    <div class="turn-attachments">
                        ${turn.attachments.map((attachment) => `
                            <div class="attachment-pill">
                                <span class="attachment-name">${escapeHtml(attachment.name)}</span>
                                ${attachment.type ? `<span class="attachment-type">${escapeHtml(attachment.type)}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                `
                : '';

            return `
                <section class="turn turn-user">
                    <div class="turn-label">You</div>
                    <div class="turn-body">
                        <p>${escapeHtml(turn.text)}</p>
                        ${attachmentsHtml}
                    </div>
                </section>
            `;
        }

        return `
            <section class="turn turn-assistant">
                <div class="turn-label">Aetheria AI</div>
                <div class="turn-body assistant-rich">
                    ${turn.html || ''}
                </div>
            </section>
        `;
    }).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Aetheria Conversation</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
      color: #0f172a;
      background: #ffffff;
      line-height: 1.5;
    }
    .document {
      max-width: 840px;
      margin: 0 auto;
    }
    .turn {
      margin-bottom: 16px;
      border: 1px solid #dbe3ef;
      border-radius: 12px;
      page-break-inside: avoid;
      overflow: hidden;
    }
    .turn-label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 9px 12px;
      border-bottom: 1px solid #dbe3ef;
    }
    .turn-user .turn-label {
      color: #0c4a6e;
      background: #e6f4ff;
    }
    .turn-assistant .turn-label {
      color: #1e293b;
      background: #f8fafc;
    }
    .turn-body {
      padding: 12px 14px;
      font-size: 13px;
      word-break: break-word;
      white-space: normal;
    }
    .turn-user .turn-body {
      white-space: pre-wrap;
    }
    .turn-body p {
      margin: 0 0 8px;
    }
    .turn-body p:last-child {
      margin-bottom: 0;
    }
    .turn-attachments {
      margin-top: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .attachment-pill {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      font-size: 11px;
      color: #1e3a8a;
    }
    .attachment-type {
      opacity: 0.8;
      font-family: Consolas, "Courier New", monospace;
    }
    .assistant-rich pre {
      margin: 10px 0;
      padding: 10px 12px;
      border: 1px solid #dbe3ef;
      border-radius: 10px;
      background: #f8fafc;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 11px;
      line-height: 1.5;
      font-family: Consolas, "Courier New", monospace;
    }
    .assistant-rich code {
      font-family: Consolas, "Courier New", monospace;
      font-size: 11px;
      background: #eef2ff;
      border: 1px solid #dbe3ef;
      border-radius: 6px;
      padding: 1px 5px;
    }
    .assistant-rich pre code {
      background: transparent;
      border: none;
      padding: 0;
    }
    .assistant-rich ul, .assistant-rich ol {
      margin: 8px 0 8px 20px;
      padding: 0;
    }
    .assistant-rich blockquote {
      margin: 10px 0;
      padding: 8px 12px;
      border-left: 4px solid #cbd5e1;
      background: #f8fafc;
      color: #334155;
    }
    .assistant-rich table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 12px;
    }
    .assistant-rich th, .assistant-rich td {
      border: 1px solid #dbe3ef;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }
    .assistant-rich th {
      background: #f1f5f9;
      font-weight: 700;
    }
    .assistant-rich img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      border: 1px solid #dbe3ef;
      margin-top: 8px;
    }
    .pdf-image-placeholder {
      margin-top: 8px;
      padding: 8px 10px;
      border: 1px dashed #94a3b8;
      border-radius: 8px;
      color: #475569;
      font-size: 11px;
      background: #f8fafc;
    }
  </style>
</head>
<body>
  <main class="document">
    ${content}
  </main>
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

    const html = buildConversationPdfHtml(turns);

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
