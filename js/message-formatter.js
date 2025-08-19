// js/message-formatter.js (Complete, Final, with Single-Parse Strategy)

import { artifactHandler } from './artifact-handler.js';

/**
 * Handles formatting of chat messages from Markdown to HTML,
 * including special handling for code blocks, mermaid diagrams, and custom artifacts.
 * It also manages the global click handling for reopening artifacts.
 */
class MessageFormatter {
    constructor() {
        this.pendingContent = new Map();
        
        mermaid.initialize({
            startOnLoad: true,
            theme: document.body.classList.contains('dark-mode') ? 'dark' : 'default',
            securityLevel: 'loose',
            fontFamily: 'inherit'
        });

        this.setupMermaidThemeObserver();

        marked.setOptions({
            breaks: true,
            gfm: true,
            pedantic: false,
            silent: true,
            highlight: (code, lang) => {
                if (!lang) return hljs.highlightAuto(code).value;
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch {
                    return hljs.highlightAuto(code).value;
                }
            }
        });

        const renderer = {
            code: (code, language) => {
                if (language === 'image') {
                    const artifactId = code.trim();
                    artifactHandler.createArtifact(artifactId, 'image');
                    return `<button class="artifact-reference" data-artifact-id="${artifactId}">
                        <i class="fas fa-image"></i>
                        View Generated Image
                    </button>`;
                }

                if (language === 'mermaid') {
                    const artifactId = artifactHandler.createArtifact(code, 'mermaid');
                    artifactHandler.showArtifact('mermaid', code, artifactId);
                    return `<button class="artifact-reference" data-artifact-id="${artifactId}">
                        <i class="fas fa-diagram-project"></i>
                        View Mermaid Diagram
                    </button>`;
                }

                const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
                const artifactId = artifactHandler.createArtifact(code, validLanguage);
                return `<button class="artifact-reference" data-artifact-id="${artifactId}">
                    <i class="fas fa-code"></i>
                    View ${validLanguage} Code Block
                </button>`;
            }, 
            table: (header, body) => {
                return `<div class="table-container"><table class="formatted-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
            }
        };

        marked.use({ renderer });

        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.artifact-reference');
            if (btn && btn.dataset.artifactId) {
                e.preventDefault();
                artifactHandler.reopenArtifact(btn.dataset.artifactId);
            }
        });
    }
    
    setupMermaidThemeObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const isDarkMode = document.body.classList.contains('dark-mode');
                    mermaid.initialize({ 
                        theme: isDarkMode ? 'dark' : 'default'
                    });
                    document.querySelectorAll('.mermaid:not([data-processed="true"])').forEach(el => {
                       mermaid.init(undefined, el);
                    });
                }
            });
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    // --- MODIFICATION START (Single-Parse Strategy) ---
    /**
     * Appends new content to a pending stream.
     * This version does NOT parse Markdown. It only sanitizes the raw text for safe display
     * during the stream. The full Markdown parsing happens only once at the end.
     * @param {string} content - The new chunk of content to add.
     * @param {string} streamId - The unique ID for the message stream (e.g., "messageId-agentName").
     * @returns {string} The sanitized, HTML-escaped text of the entire stream so far.
     */
    formatStreaming(content, streamId) {
        if (!this.pendingContent.has(streamId)) {
            this.pendingContent.set(streamId, '');
        }

        const newTotalContent = this.pendingContent.get(streamId) + content;
        this.pendingContent.set(streamId, newTotalContent);

        // Sanitize and escape HTML to prevent rendering issues during the stream.
        // This shows the raw markdown characters as they arrive.
        const sanitized = DOMPurify.sanitize(newTotalContent, { USE_PROFILES: { html: false } });
        // Replace newlines with <br> for proper line breaks in the pre-like display.
        return sanitized.replace(/\n/g, '<br>');
    }
    // --- MODIFICATION END ---

    /**
     * Formats a complete string of Markdown content into safe, fully rendered HTML.
     * This should only be called ONCE when the message stream is complete.
     * @param {string} content - The final, complete Markdown content to format.
     * @returns {string} Sanitized, fully rendered HTML string.
     */
    format(content) {
        if (!content) return '';

        const rawHtml = marked.parse(content);

        const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
            ADD_TAGS: ['button', 'i', 'div', 'span', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
            ADD_ATTR: ['class', 'id', 'data-artifact-id']
        });

        return sanitizedHtml;
    }

    // --- NEW HELPER METHODS for Single-Parse Strategy ---
    /**
     * Retrieves the final, complete content for a given stream ID.
     * @param {string} streamId - The unique ID of the stream.
     * @returns {string|undefined} The complete content string.
     */
    getFinalContent(streamId) {
        return this.pendingContent.get(streamId);
    }

    /**
     * Clears all pending content streams associated with a main message ID.
     * @param {string} messageId - The unique ID of the overall message.
     */
    finishStreamingForAllOwners(messageId) {
        for (const key of this.pendingContent.keys()) {
            if (key.startsWith(messageId)) {
                this.pendingContent.delete(key);
            }
        }
    }
}

// Export a singleton instance to be used throughout the application
export const messageFormatter = new MessageFormatter();