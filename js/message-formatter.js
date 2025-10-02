// js/message-formatter.js (Enhanced for inline artifact rendering)

import { artifactHandler } from './artifact-handler.js';

class MessageFormatter {
    constructor() {
        this.pendingContent = new Map();
        this.inlineRenderer = this.buildInlineRenderer();

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
                } catch (err) {
                    return hljs.highlightAuto(code).value;
                }
            }
        });

        const artifactRenderer = {
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

        marked.use({ renderer: artifactRenderer });

        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.artifact-reference');
            if (btn && btn.dataset.artifactId) {
                e.preventDefault();
                artifactHandler.reopenArtifact(btn.dataset.artifactId);
            }
        });
    }

    buildInlineRenderer() {
        const renderer = new marked.Renderer();
        renderer.code = (code, language = 'plaintext') => {
            if (language === 'image') {
                return '<div class="inline-artifact-placeholder">Image preview unavailable for saved sessions.</div>';
            }

            if (language === 'mermaid') {
                return this.renderMermaidInline(code);
            }

            const normalizedLang = hljs.getLanguage(language) ? language : 'plaintext';
            return this.renderCodeInline(code, normalizedLang);
        };

        renderer.table = (header, body) => {
            return `<div class="table-container"><table class="formatted-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
        };

        return renderer;
    }

    renderCodeInline(code, language) {
        const sanitizedCode = DOMPurify.sanitize(code, { USE_PROFILES: { html: false } });
        return `<pre class="inline-artifact-code"><code class="language-${language}">${sanitizedCode}</code></pre>`;
    }

    renderMermaidInline(code) {
        const sanitized = DOMPurify.sanitize(code, { USE_PROFILES: { html: false } });
        return `<div class="inline-artifact-mermaid">${sanitized}</div>`;
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

    formatStreaming(content, streamId) {
        if (!this.pendingContent.has(streamId)) {
            this.pendingContent.set(streamId, '');
        }

        const newTotalContent = this.pendingContent.get(streamId) + content;
        this.pendingContent.set(streamId, newTotalContent);

        const sanitized = DOMPurify.sanitize(newTotalContent, { USE_PROFILES: { html: false } });
        return sanitized.replace(/\n/g, '<br>');
    }

    format(content, options = {}) {
        if (!content) return '';

        const inlineArtifacts = options.inlineArtifacts === true;

        if (!inlineArtifacts) {
            const rawHtml = marked.parse(content);
            return DOMPurify.sanitize(rawHtml, {
                ADD_TAGS: ['button', 'i', 'div', 'span', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
                ADD_ATTR: ['class', 'id', 'data-artifact-id']
            });
        }

        const rawHtml = marked.parse(content, { renderer: this.inlineRenderer });
        return DOMPurify.sanitize(rawHtml, {
            ADD_TAGS: ['div', 'span', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
            ADD_ATTR: ['class']
        });
    }

    applyInlineEnhancements(root) {
        if (!root) return;

        root.querySelectorAll('.inline-artifact-code code').forEach(codeEl => {
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(codeEl);
            }
        });

        const mermaidElements = [];
        root.querySelectorAll('.inline-artifact-mermaid').forEach(block => {
            const graphDefinition = block.textContent;
            block.classList.add('mermaid-inline');
            block.classList.add('mermaid');
            block.textContent = graphDefinition;
            block.removeAttribute('data-processed');
            mermaidElements.push(block);
        });

        if (mermaidElements.length && typeof mermaid !== 'undefined') {
            mermaid.init(undefined, mermaidElements);
        }
    }

    getFinalContent(streamId) {
        return this.pendingContent.get(streamId);
    }

    finishStreamingForAllOwners(messageId) {
        for (const key of this.pendingContent.keys()) {
            if (key.startsWith(messageId)) {
                this.pendingContent.delete(key);
            }
        }
    }
}

export const messageFormatter = new MessageFormatter();
