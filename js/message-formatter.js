// js/message-formatter.js (Enhanced for inline artifact rendering)

import { artifactHandler } from './artifact-handler.js';

class MessageFormatter {
    constructor() {
        this.pendingContent = new Map();
        this.inlineRenderer = this.buildInlineRenderer();
        this.mermaidInteractionMap = new WeakMap();

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
        root.querySelectorAll('.inline-artifact-mermaid:not(.inline-mermaid-interactive)').forEach(block => {
            const graphDefinition = block.textContent;
            const mermaidBlock = this.prepareInlineMermaidBlock(block);
            if (!mermaidBlock) return;

            mermaidBlock.classList.add('mermaid-inline');
            mermaidBlock.classList.add('mermaid');
            mermaidBlock.textContent = graphDefinition;
            mermaidBlock.removeAttribute('data-processed');
            mermaidElements.push(mermaidBlock);
        });

        if (mermaidElements.length && typeof mermaid !== 'undefined') {
            mermaid.init(undefined, mermaidElements);
            mermaidElements.forEach(el => this.resetMermaidView(el));
        }
    }

    prepareInlineMermaidBlock(block) {
        if (!block || this.mermaidInteractionMap.has(block)) return block;

        const parent = block.parentNode;
        if (!parent) return null;

        const inlineWrapper = document.createElement('div');
        inlineWrapper.className = 'inline-artifact-mermaid inline-mermaid-interactive';
        inlineWrapper.tabIndex = 0;
        inlineWrapper.setAttribute('role', 'region');
        inlineWrapper.setAttribute('aria-label', 'Inline Mermaid diagram');

        const panContainer = document.createElement('div');
        panContainer.className = 'mermaid-pan-container';
        panContainer.setAttribute('data-mermaid-pan-container', 'true');

        const hint = document.createElement('div');
        hint.className = 'mermaid-interactive-hint';
        hint.textContent = 'Drag with left mouse • Scroll to zoom';

        panContainer.appendChild(block.cloneNode(true));
        inlineWrapper.appendChild(panContainer);
        inlineWrapper.appendChild(hint);

        parent.replaceChild(inlineWrapper, block);

        const mermaidContent = panContainer.querySelector(':scope > div');
        mermaidContent.dataset.mermaidInteractive = 'true';
        this.setupMermaidInteraction(mermaidContent, inlineWrapper, panContainer, hint);

        return mermaidContent;
    }

    setupMermaidInteraction(mermaidElement, wrapper, panContainer, hint) {
        if (this.mermaidInteractionMap.has(mermaidElement)) return;

        const state = {
            scale: 1,
            panX: 0,
            panY: 0,
            pointerDown: false,
            isPanning: false,
            startX: 0,
            startY: 0,
            lastX: 0,
            lastY: 0,
            pointerId: null
        };

        const entry = { wrapper, panContainer, hint, state };
        this.mermaidInteractionMap.set(mermaidElement, entry);

        panContainer.style.transformOrigin = 'center center';
        this.applyMermaidTransform(entry);
        this.normalizeInlineMermaidSvg(entry, 24);
        this.observeInlineResize(entry);

        const markInteracted = () => {
            if (hint) wrapper.classList.add('mermaid-interacted');
        };

        wrapper.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;

            state.pointerDown = true;
            state.startX = e.clientX;
            state.startY = e.clientY;
            state.lastX = e.clientX;
            state.lastY = e.clientY;
            state.pointerId = e.pointerId;

            if (wrapper.setPointerCapture) {
                wrapper.setPointerCapture(state.pointerId);
            }

            e.preventDefault();
        });

        wrapper.addEventListener('pointermove', (e) => {
            if (!state.pointerDown) return;

            const dx = e.clientX - state.lastX;
            const dy = e.clientY - state.lastY;

            state.lastX = e.clientX;
            state.lastY = e.clientY;

            if (!state.isPanning) {
                const distanceX = e.clientX - state.startX;
                const distanceY = e.clientY - state.startY;
                if (Math.abs(distanceX) > 3 || Math.abs(distanceY) > 3) {
                    state.isPanning = true;
                    wrapper.classList.add('mermaid-grabbing');
                    markInteracted();
                } else {
                    return;
                }
            }

            state.panX += dx;
            state.panY += dy;
            this.applyMermaidTransform(entry);
        });

        const endPan = (e) => {
            if (state.pointerId !== null && wrapper.releasePointerCapture) {
                wrapper.releasePointerCapture(state.pointerId);
            }

            state.pointerDown = false;
            state.isPanning = false;
            state.pointerId = null;
            wrapper.classList.remove('mermaid-grabbing');
        };

        wrapper.addEventListener('pointerup', endPan);
        wrapper.addEventListener('pointerleave', endPan);
        wrapper.addEventListener('pointercancel', endPan);

        wrapper.addEventListener('wheel', (e) => {
            if (e.ctrlKey) return;

            e.preventDefault();

            const direction = e.deltaY < 0 ? 1 : -1;
            const factor = direction > 0 ? 1.1 : 0.9;
            const newScale = Math.min(2.5, Math.max(0.5, state.scale * factor));
            if (newScale === state.scale) return;

            state.scale = newScale;
            markInteracted();
            this.applyMermaidTransform(entry);
        }, { passive: false });

        wrapper.addEventListener('dblclick', () => {
            state.scale = 1;
            state.panX = 0;
            state.panY = 0;
            state.pointerDown = false;
            state.isPanning = false;
            wrapper.classList.remove('mermaid-grabbing');
            markInteracted();
            this.applyMermaidTransform(entry);
            this.normalizeInlineMermaidSvg(entry, 24);
        });
    }

    applyMermaidTransform(entry) {
        if (!entry || !entry.panContainer) return;
        const { panContainer, state } = entry;
        panContainer.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
    }

    observeInlineResize(entry) {
        if (!entry || typeof ResizeObserver === 'undefined') return;

        const { wrapper } = entry;
        if (!wrapper) return;

        if (entry.resizeObserver) {
            entry.resizeObserver.disconnect();
        }

        entry.resizeObserver = new ResizeObserver(() => {
            const { state } = entry;
            if (!state) return;
            if (state.pointerDown || state.isPanning) return;
            if (state.scale !== 1 || state.panX !== 0 || state.panY !== 0) return;
            this.normalizeInlineMermaidSvg(entry, 24);
            this.applyMermaidTransform(entry);
        });

        entry.resizeObserver.observe(wrapper);
    }

    normalizeInlineMermaidSvg(entry, padding = 0) {
        if (!entry || !entry.panContainer || !entry.wrapper) return;

        const svg = entry.panContainer.querySelector('svg');
        if (!svg) return;

        let bbox;
        try {
            bbox = svg.getBBox();
        } catch (error) {
            console.warn('MessageFormatter: Unable to measure inline Mermaid diagram.', error);
            return;
        }

        const viewBoxWidth = bbox.width + padding * 2;
        const viewBoxHeight = bbox.height + padding * 2;
        if (!Number.isFinite(viewBoxWidth) || !Number.isFinite(viewBoxHeight) || viewBoxWidth <= 0 || viewBoxHeight <= 0) {
            return;
        }

        const viewBoxX = bbox.x - padding;
        const viewBoxY = bbox.y - padding;

        svg.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.maxWidth = 'none';
        svg.style.maxHeight = 'none';

        const targetWidth = Math.max(entry.wrapper.clientWidth, viewBoxWidth);
        const targetHeight = Math.max(entry.wrapper.clientHeight, viewBoxHeight);

        entry.panContainer.style.minWidth = `${targetWidth}px`;
        entry.panContainer.style.minHeight = `${targetHeight}px`;
        entry.panContainer.style.padding = `${padding}px`;
    }

    resetMermaidView(mermaidElement) {
        const entry = this.mermaidInteractionMap.get(mermaidElement);
        if (!entry) return;

        entry.state.scale = 1;
        entry.state.panX = 0;
        entry.state.panY = 0;
        entry.state.pointerDown = false;
        entry.state.isPanning = false;
        this.applyMermaidTransform(entry);
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