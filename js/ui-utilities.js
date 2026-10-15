// ui-utilities.js
// UI utility functions for chat interface (connection errors, message actions, share modal)

import { buildConversationPdfHtml } from './conversation-pdf.mjs';
import { showConversationPdfExportDialog, selectConversationPdfTurns, prepareConversationPdfTurns, prepareConversationPdfAttachments } from './conversation-pdf-export.mjs';

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

function getMainResponseText(messageDiv) {
    return [...messageDiv.querySelectorAll('.message-content .inner-content')]
        .map(node => (node.textContent || '').trim()).filter(Boolean).join('\n\n');
}

/**
 * Handles copying the AI message content to clipboard
 * @param {HTMLElement} messageDiv - The message container element
 * @param {HTMLElement} button - The copy button element
 */
async function handleCopyMessage(messageDiv, button) {
    try {
        const textContent = getMainResponseText(messageDiv);
        if (!textContent) return;

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
        const textContent = getMainResponseText(messageDiv);
        if (!textContent) return;

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
                        title: 'AI Response from Aetheria ai',
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
                    <span>Export as PDF</span>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Add event listeners
    const closeModal = () => {
        document.removeEventListener('keydown', handleKeyDown);
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
                    closeModal();
                    await exportConversationPdf(messageDiv);
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
    return messageDiv?.closest?.('.conversation-thread, .session-history-content') || null;
}

function normalizePdfAttachments(files) {
    if (!Array.isArray(files)) return [];
    return files.map(file => ({
        name: String(file?.name || '').trim(),
        type: String(file?.type || '').trim(),
        relativePath: String(file?.relativePath || ''),
        previewUrl: String(file?.previewUrl || ''),
        url: String(file?.url || file?.download_url || ''),
    })).filter(file => file.name);
}

function sanitizeAssistantMessageHtml(contentNode) {
    if (!contentNode) return '';

    const clone = contentNode.cloneNode(true);
    clone.querySelectorAll('.message-actions, .code-copy-btn, button, .view-turn-context-btn').forEach((node) => {
        node.remove();
    });

    return clone.innerHTML.trim();
}

function extractConversationTurns(thread) {
    if (!thread) return [];

    const turns = [];
    const messages = thread.querySelectorAll('.message, .turn-user-message');

    messages.forEach((message) => {
        if (message.classList.contains('message-user') || message.classList.contains('turn-user-message')) {
            const text = (message.querySelector('.user-message-text, .message-text')?.textContent || '').trim();

            const context = parseMessageContext(message) || {};
            const attachments = normalizePdfAttachments(context.files);
            if (!text && !attachments.length) return;

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

function sanitizeFilenameSegment(value) {
    const normalized = String(value || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.slice(0, 120) || 'aetheria-conversation';
}

async function createPdfFilename(conversationId) {
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

let pdfExportOpen = false;

async function exportConversationPdf(messageDiv) {
    if (pdfExportOpen) return;
    const thread = getConversationThreadFromMessage(messageDiv);
    if (!thread) {
        showNotification('Could not find conversation to export', 'error', 3000);
        return;
    }

    const turns = extractConversationTurns(thread);
    const sessionAttachments = thread.matches('.session-history-content')
        ? normalizePdfAttachments(parseMessageContext(thread)?.files) : [];
    const conversationId = String(thread.dataset.conversationId || '').trim();
    if (!turns.length) {
        showNotification('No conversation messages found to export', 'error', 3000);
        return;
    }

    if (!window.electron?.ipcRenderer?.invoke) {
        showNotification('PDF export is available in desktop app only', 'error', 3000);
        return;
    }

    const returnFocus = document.activeElement?.closest('.share-modal-overlay')
        ? messageDiv.querySelector('.share-btn') : document.activeElement;
    pdfExportOpen = true;
    try {
        await showConversationPdfExportDialog({
            turns,
            sessionAttachments,
            returnFocus,
            onExport: async (options) => {
                const selected = selectConversationPdfTurns(turns, options);
                const preparationOptions = {
                    readArchivedFile: window.electron.fileArchive?.readFile,
                };
                const prepared = await prepareConversationPdfTurns(selected, preparationOptions);
                const preparedSessionAttachments = options.scope === 'entire' && options.includeAttachments
                    ? await prepareConversationPdfAttachments(sessionAttachments, preparationOptions) : [];
                let title = 'Untitled Conversation';
                if (conversationId && window.electron.auth?.fetchSessionData) {
                    try {
                        const session = await window.electron.auth.fetchSessionData(conversationId);
                        title = String(session?.session_title || '').trim() || title;
                    } catch (error) { console.warn('Could not fetch session title for PDF:', error); }
                }
                const filename = await createPdfFilename(conversationId);
                const result = await window.electron.ipcRenderer.invoke('export-conversation-pdf', {
                    html: buildConversationPdfHtml(prepared, { title, timestamp: new Date(), scope: options.scope, sessionAttachments: preparedSessionAttachments }),
                    defaultPath: options.scope === 'latest' ? filename.replace(/\.pdf$/i, '-latest-response.pdf') : filename,
                });
                if (result?.success) showNotification('Conversation PDF exported successfully', 'success', 3000);
                return result;
            },
        });
    } catch (error) {
        showNotification(error.message || 'Could not open PDF export options', 'error', 3000);
    } finally { pdfExportOpen = false; }
}

export async function exportActiveConversationPdf() {
    const history = document.querySelector('#session-history-viewer:not(.hidden) .session-history-content');
    if (history?.querySelector('.skeleton-history-loading')) {
        showNotification('Wait for the saved conversation to finish loading', 'info', 3000);
        return;
    }
    const thread = history || document.querySelector('.conversation-thread.active') ||
        Array.from(document.querySelectorAll('#chat-messages .conversation-thread'))
            .find(candidate => candidate.style.display !== 'none');
    const message = thread?.querySelector('.message, .turn-user-message');

    if (!message) {
        showNotification('Start a conversation before exporting', 'info', 3000);
        return;
    }

    await exportConversationPdf(message);
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
