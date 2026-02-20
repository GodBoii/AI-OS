// artifact-handler.js (Final, Race-Condition-Proof Version)

class ArtifactHandler {
    constructor() {
        this.artifacts = new Map();
        this.pendingImages = new Map();
        this.currentId = 0;
        this.browserArtifactId = 'browser_view_artifact';
        this.currentViewMode = 'preview';
        this.backendBaseUrl = 'http://localhost:8765';
        this.deployInProgress = false;
        this.init();
    }

    init() {
        const container = document.createElement('div');
        container.id = 'artifact-container';
        container.className = 'artifact-container hidden';
        
        container.innerHTML = `
            <div class="artifact-window">
                <div class="artifact-header">
                    <div class="artifact-title">Artifact Viewer</div>
                    <div class="artifact-controls">
                        <div class="artifact-view-toggle hidden" role="group" aria-label="View mode">
                            <button type="button" class="view-toggle-btn active" data-view="preview" aria-pressed="true" title="Preview mode">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button type="button" class="view-toggle-btn" data-view="source" aria-pressed="false" title="Source mode">
                                <i class="fas fa-code"></i>
                            </button>
                        </div>
                        <button class="copy-artifact-btn" title="Copy to Clipboard">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="download-artifact-btn" title="Download">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="deploy-artifact-btn" title="Deploy HTML Site">
                            <i class="fas fa-rocket"></i>
                        </button>
                        <button class="close-artifact-btn">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="artifact-content"></div>
            </div>
        `;
        
        document.body.appendChild(container);
        this.setupDeployPreviewModal();
        
        container.querySelector('.close-artifact-btn').addEventListener('click', () => this.hideArtifact());
        container.querySelector('.copy-artifact-btn').addEventListener('click', () => this.copyArtifactContent());
        container.querySelector('.download-artifact-btn').addEventListener('click', () => this.downloadArtifact());
        container.querySelector('.deploy-artifact-btn').addEventListener('click', () => this.deployCurrentArtifact());

        this.viewToggleContainer = container.querySelector('.artifact-view-toggle');
        this.viewToggleButtons = Array.from(this.viewToggleContainer.querySelectorAll('.view-toggle-btn'));
        this.viewToggleButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.view;
                this.setViewMode(mode);
            });
        });
    }

    setupDeployPreviewModal() {
        if (document.getElementById('deploy-preview-modal')) {
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'deploy-preview-modal';
        modal.className = 'deploy-preview-modal hidden';
        modal.innerHTML = `
            <div class="deploy-preview-dialog" role="dialog" aria-modal="true" aria-label="Deploy Preview">
                <div class="deploy-preview-header">
                    <div class="deploy-preview-title">Deploy Preview</div>
                    <button type="button" class="deploy-preview-close" aria-label="Close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="deploy-preview-meta"></div>
                <div class="deploy-preview-tree"></div>
                <div class="deploy-preview-actions">
                    <button type="button" class="deploy-preview-cancel">Cancel</button>
                    <button type="button" class="deploy-preview-confirm">Deploy</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    cachePendingImage(artifactId, base64Data) {
        if (!base64Data || base64Data.length === 0) {
            console.error(`[HANDLER] Received empty base64 data for artifact ${artifactId}`);
            return;
        }

        // Check if a placeholder artifact already exists (text-first scenario)
        if (this.artifacts.has(artifactId)) {
            const artifact = this.artifacts.get(artifactId);
            
            if (artifact && artifact.isPending) {
                // Finalize the artifact by adding the content and updating its state
                artifact.content = base64Data;
                artifact.isPending = false;
                this.showArtifact('image', base64Data, artifactId);
                return;
            } else if (artifact && !artifact.isPending) {
                return;
            }
        }
        
        // If no placeholder exists, cache it for later (data-first scenario)
        this.pendingImages.set(artifactId, base64Data);
    }

    createArtifact(content, type, artifactId = null, options = {}) {
        if (type === 'image') {
            const imageId = content.trim();
            
            // If ANY artifact already exists (pending or complete), return immediately
            // This prevents duplicate placeholder creation during streaming
            if (this.artifacts.has(imageId)) {
                return imageId;
            }

            // Data-First Scenario: The image data arrived before the text reference.
            if (this.pendingImages.has(imageId)) {
                const imageContent = this.pendingImages.get(imageId);
                this.artifacts.set(imageId, { content: imageContent, type: 'image', isPending: false });
                this.pendingImages.delete(imageId);
                return imageId;
            } 
            // Text-First Scenario: The text reference arrived first. Create a placeholder.
            else {
                this.artifacts.set(imageId, { content: null, type: 'image', isPending: true });
                return imageId;
            }
        }

        // For all other artifact types (code, mermaid), the logic is simple.
        const id = artifactId || `artifact-${this.currentId++}`;
        const artifactData = {
            content,
            type,
            viewMode: options.viewMode || options.defaultView || (type === 'mermaid' ? 'preview' : 'source'),
            title: options.title || null,
            language: options.language || (type === 'mermaid' ? 'mermaid' : (type && type !== 'code' ? String(type).toLowerCase() : 'plaintext'))
        };
        this.artifacts.set(id, artifactData);
        return id;
    }

    showArtifact(type, data, artifactId = null, options = {}) {
        const container = document.getElementById('artifact-container');
        const contentDiv = container.querySelector('.artifact-content');
        const titleEl = container.querySelector('.artifact-title');
        const copyBtn = container.querySelector('.copy-artifact-btn');
        const downloadBtn = container.querySelector('.download-artifact-btn');
        const deployBtn = container.querySelector('.deploy-artifact-btn');
        const viewToggle = container.querySelector('.artifact-view-toggle');

        contentDiv.innerHTML = '';
        let currentArtifactId = artifactId;

        if (viewToggle) {
            viewToggle.classList.add('hidden');
        }

        switch (type) {
            case 'browser_view':
                titleEl.textContent = 'Interactive Browser';
                copyBtn.style.display = 'none';
                downloadBtn.style.display = 'none';
                deployBtn.style.display = 'none';
                this.renderBrowserView(data);
                currentArtifactId = this.browserArtifactId;
                this.artifacts.set(currentArtifactId, { content: data, type });
                break;

            case 'image':
                titleEl.textContent = options.title || 'Image Viewer';
                copyBtn.style.display = 'none';
                downloadBtn.style.display = 'inline-flex';
                deployBtn.style.display = 'none';
                if (data === null) {
                    contentDiv.innerHTML = '<div class="artifact-loading"><span>Loading image...</span></div>';
                } else {
                    this.renderImage(data, contentDiv);
                }
                break;

            case 'mermaid':
                titleEl.textContent = options.title || 'Diagram Viewer';
                copyBtn.style.display = 'inline-flex';
                downloadBtn.style.display = 'inline-flex';
                deployBtn.style.display = 'none';
                if (viewToggle) {
                    viewToggle.classList.remove('hidden');
                }
                const existingArtifact = currentArtifactId ? this.artifacts.get(currentArtifactId) : null;
                const viewMode = options.defaultView || (existingArtifact && existingArtifact.viewMode ? existingArtifact.viewMode : 'preview');
                this.currentViewMode = viewMode;
                this.updateViewToggleButtons(viewMode);
                this.renderMermaidView(data, contentDiv, viewMode);
                if (!currentArtifactId) {
                    currentArtifactId = this.createArtifact(data, type, null, {
                        viewMode,
                        title: options.title || null,
                        language: 'mermaid'
                    });
                } else {
                    this.updateArtifactViewMode(currentArtifactId, viewMode);
                }
                break;

            default: // Handles code blocks
                titleEl.textContent = options.title || 'Code Viewer';
                copyBtn.style.display = 'inline-flex';
                downloadBtn.style.display = 'inline-flex';
                const language = options.language || this.inferLanguageFromType(type);
                deployBtn.style.display = this.isDeployableLanguage(language) ? 'inline-flex' : 'none';
                const viewModeForCode = this.resolveInitialCodeViewMode(language, options.defaultView);
                const shouldShowToggle = this.supportsPreviewMode(language);
                if (shouldShowToggle && viewToggle) {
                    viewToggle.classList.remove('hidden');
                }
                this.currentViewMode = viewModeForCode;
                this.updateViewToggleButtons(viewModeForCode);
                this.renderTextArtifactView(data, language, contentDiv, viewModeForCode);
                if (!currentArtifactId) {
                    currentArtifactId = this.createArtifact(data, type, null, {
                        viewMode: viewModeForCode,
                        title: options.title || null,
                        language
                    });
                } else {
                    const existing = this.artifacts.get(currentArtifactId);
                    if (existing) {
                        existing.title = options.title || existing.title || null;
                        existing.language = language;
                        existing.viewMode = viewModeForCode;
                    }
                }
                break;
        }
        
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        container.classList.remove('hidden');
        chatContainer.classList.add('with-artifact');
        inputContainer.classList.add('with-artifact');

        if (currentArtifactId) {
            container.dataset.activeArtifactId = currentArtifactId;
        } else {
            delete container.dataset.activeArtifactId;
        }

        return currentArtifactId;
    }

    updateArtifactViewMode(artifactId, viewMode) {
        const artifact = this.artifacts.get(artifactId);
        if (artifact && (artifact.type === 'mermaid' || artifact.type === 'code')) {
            artifact.viewMode = viewMode;
        }
    }

    setViewMode(mode) {
        if (!mode || this.currentViewMode === mode) {
            return;
        }

        this.currentViewMode = mode;
        this.updateViewToggleButtons(mode);

        const container = document.getElementById('artifact-container');
        const contentDiv = container.querySelector('.artifact-content');
        const activeId = container.dataset.activeArtifactId;

        if (!activeId || !contentDiv) {
            return;
        }

        const artifact = this.artifacts.get(activeId);
        if (!artifact) {
            return;
        }

        if (artifact.type !== 'mermaid' && artifact.type !== 'code') {
            return;
        }

        if (artifact.type === 'code' && !this.supportsPreviewMode(artifact.language || 'plaintext')) {
            return;
        }

        this.updateArtifactViewMode(activeId, mode);
        contentDiv.innerHTML = '';
        if (artifact.type === 'mermaid') {
            this.renderMermaidView(artifact.content, contentDiv, mode);
        } else {
            this.renderTextArtifactView(artifact.content, artifact.language || 'plaintext', contentDiv, mode);
        }
    }

    updateViewToggleButtons(mode) {
        if (!Array.isArray(this.viewToggleButtons)) {
            return;
        }

        this.viewToggleButtons.forEach((button) => {
            const isActive = button.dataset.view === mode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }

    renderBrowserView(data) {
        const contentDiv = document.querySelector('#artifact-container .artifact-content');
        let browserViewContainer = document.getElementById('browser-view-content');

        if (!browserViewContainer) {
            browserViewContainer = document.createElement('div');
            browserViewContainer.id = 'browser-view-content';
            browserViewContainer.innerHTML = `
                <div class="browser-view-header">
                    <i class="fas fa-globe"></i>
                    <span class="browser-view-url" title="Current URL"></span>
                </div>
                <div class="browser-view-screenshot">
                    <img src="" alt="Browser Screenshot" />
                </div>
            `;
            contentDiv.appendChild(browserViewContainer);
        }

        const urlSpan = browserViewContainer.querySelector('.browser-view-url');
        const screenshotImg = browserViewContainer.querySelector('.browser-view-screenshot img');

        urlSpan.textContent = data.url || 'Loading...';
        if (data.screenshot_base64) {
            screenshotImg.src = `data:image/png;base64,${data.screenshot_base64}`;
        } else {
            screenshotImg.src = '';
            screenshotImg.alt = 'Screenshot not available.';
        }
    }

    renderImage(base64Data, container) {
        // Clear any loading state before rendering the image
        container.innerHTML = '';
        const img = document.createElement('img');
        img.className = 'generated-image-artifact';
        img.src = typeof base64Data === 'string' && base64Data.startsWith('data:')
            ? base64Data
            : `data:image/png;base64,${base64Data}`;
        img.alt = 'Generated Image';
        container.appendChild(img);
    }

    renderMermaidView(content, container, mode = 'preview') {
        if (mode === 'source') {
            this.renderMermaidSource(content, container);
        } else {
            this.renderMermaidPreview(content, container);
        }
    }

    renderMermaidSource(content, container) {
        this.renderCode(content, 'mermaid', container);
    }

    renderMermaidPreview(content, container) {
        const interactiveWrapper = document.createElement('div');
        interactiveWrapper.className = 'mermaid-interactive';
        interactiveWrapper.tabIndex = 0;
        interactiveWrapper.setAttribute('role', 'region');
        interactiveWrapper.setAttribute('aria-label', 'Interactive Mermaid diagram');

        const panContainer = document.createElement('div');
        panContainer.className = 'mermaid-pan-container';

        const mermaidDiv = document.createElement('div');
        mermaidDiv.className = 'mermaid';
        mermaidDiv.textContent = content;

        panContainer.appendChild(mermaidDiv);
        interactiveWrapper.appendChild(panContainer);
        container.appendChild(interactiveWrapper);

        mermaid.init(undefined, [mermaidDiv]);

        const hiddenSource = document.createElement('div');
        hiddenSource.className = 'mermaid-source-cache hidden';
        hiddenSource.textContent = content;
        container.appendChild(hiddenSource);

        const padding = 32;

        const hint = document.createElement('div');
        hint.className = 'mermaid-interactive-hint';
        hint.textContent = 'Scroll to zoom · Drag to pan · Press 0 to reset';
        interactiveWrapper.appendChild(hint);

        const transform = { x: 0, y: 0, scale: 1 };
        const bounds = { minScale: 0.3, maxScale: 3 };
        const zoomStep = 0.1;
        let isDragging = false;
        let pointerId = null;
        let lastPointerPosition = { x: 0, y: 0 };
        let hasInteracted = false;

        const applyTransform = () => {
            panContainer.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
        };

        const measureDiagram = () => {
            const svg = panContainer.querySelector('svg');
            if (!svg) {
                return { width: panContainer.offsetWidth, height: panContainer.offsetHeight };
            }
            const bbox = svg.getBBox();
            return { width: bbox.width + padding * 2, height: bbox.height + padding * 2 };
        };

        const centerDiagram = () => {
            const wrapperWidth = interactiveWrapper.clientWidth;
            const wrapperHeight = interactiveWrapper.clientHeight;
            const { width: contentWidth, height: contentHeight } = measureDiagram();

            if (!contentWidth || !contentHeight || !wrapperWidth || !wrapperHeight) {
                transform.x = 0;
                transform.y = 0;
                transform.scale = 1;
                applyTransform();
                return;
            }

            const fitScaleRaw = Math.min(wrapperWidth / contentWidth, wrapperHeight / contentHeight);
            const fitScale = Number.isFinite(fitScaleRaw) && fitScaleRaw > 0 ? Math.min(fitScaleRaw, 1) : 1;

            transform.scale = fitScale;
            const scaledWidth = contentWidth * transform.scale;
            const scaledHeight = contentHeight * transform.scale;

            transform.x = (wrapperWidth - scaledWidth) / 2;
            transform.y = (wrapperHeight - scaledHeight) / 2;
            applyTransform();
        };

        const markInteracted = () => {
            if (hasInteracted) return;
            hasInteracted = true;
            interactiveWrapper.classList.add('mermaid-interacted');
        };

        const setScale = (nextScale, centerX, centerY) => {
            const clamped = Math.min(bounds.maxScale, Math.max(bounds.minScale, nextScale));
            if (clamped === transform.scale) return;

            const rect = interactiveWrapper.getBoundingClientRect();
            const focalX = centerX !== undefined ? centerX : rect.width / 2;
            const focalY = centerY !== undefined ? centerY : rect.height / 2;

            const previousScale = transform.scale;
            const relativeX = (focalX - transform.x) / previousScale;
            const relativeY = (focalY - transform.y) / previousScale;

            transform.scale = clamped;
            transform.x = focalX - relativeX * transform.scale;
            transform.y = focalY - relativeY * transform.scale;

            applyTransform();
        };

        const zoomByStep = (direction, centerX, centerY) => {
            const factor = direction > 0 ? 1 + zoomStep : 1 - zoomStep;
            setScale(transform.scale * factor, centerX, centerY);
            markInteracted();
        };

        const resetTransform = () => {
            transform.scale = 1;
            transform.x = 0;
            transform.y = 0;
            this.normalizeMermaidSvg(panContainer, interactiveWrapper, padding);
            centerDiagram();
            applyTransform();
            markInteracted();
        };

        const prepareDiagram = () => {
            this.normalizeMermaidSvg(panContainer, interactiveWrapper, padding);
            centerDiagram();
        };

        requestAnimationFrame(prepareDiagram);

        let resizeObserver = null;
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
                if (hasInteracted) return;
                this.normalizeMermaidSvg(panContainer, interactiveWrapper, padding);
                centerDiagram();
            });
            resizeObserver.observe(interactiveWrapper);
        }

        interactiveWrapper.addEventListener('wheel', (event) => {
            event.preventDefault();
            const rect = interactiveWrapper.getBoundingClientRect();
            const localX = event.clientX - rect.left;
            const localY = event.clientY - rect.top;
            zoomByStep(event.deltaY < 0 ? 1 : -1, localX, localY);
        }, { passive: false });

        interactiveWrapper.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            isDragging = true;
            pointerId = event.pointerId;
            interactiveWrapper.setPointerCapture(pointerId);
            lastPointerPosition = { x: event.clientX, y: event.clientY };
            interactiveWrapper.classList.add('mermaid-grabbing');
            markInteracted();
        });

        interactiveWrapper.addEventListener('pointermove', (event) => {
            if (!isDragging || event.pointerId !== pointerId) return;
            const deltaX = event.clientX - lastPointerPosition.x;
            const deltaY = event.clientY - lastPointerPosition.y;
            lastPointerPosition = { x: event.clientX, y: event.clientY };
            transform.x += deltaX;
            transform.y += deltaY;
            applyTransform();
        });

        const endPointerInteraction = (event) => {
            if (!isDragging || (event && event.pointerId !== pointerId)) return;
            isDragging = false;
            interactiveWrapper.classList.remove('mermaid-grabbing');
            if (pointerId !== null) {
                interactiveWrapper.releasePointerCapture(pointerId);
            }
            pointerId = null;
        };

        ['pointerup', 'pointercancel'].forEach((evtName) => {
            interactiveWrapper.addEventListener(evtName, endPointerInteraction);
        });

        interactiveWrapper.addEventListener('pointerleave', (event) => {
            if (!isDragging) return;
            endPointerInteraction(event);
        });

        interactiveWrapper.addEventListener('keydown', (event) => {
            if (event.key === '+' || (event.key === '=' && event.shiftKey)) {
                zoomByStep(1);
                event.preventDefault();
            } else if (event.key === '-') {
                zoomByStep(-1);
                event.preventDefault();
            } else if (event.key === '0') {
                resetTransform();
                event.preventDefault();
            } else if (event.key === 'ArrowUp') {
                transform.y += 20;
                applyTransform();
                markInteracted();
                event.preventDefault();
            } else if (event.key === 'ArrowDown') {
                transform.y -= 20;
                applyTransform();
                markInteracted();
                event.preventDefault();
            } else if (event.key === 'ArrowLeft') {
                transform.x += 20;
                applyTransform();
                markInteracted();
                event.preventDefault();
            } else if (event.key === 'ArrowRight') {
                transform.x -= 20;
                applyTransform();
                markInteracted();
                event.preventDefault();
            }
        });

        const zoomControls = document.createElement('div');
        zoomControls.className = 'mermaid-controls';
        zoomControls.innerHTML = `
            <button class="zoom-in-btn" title="Zoom In"><i class="fas fa-plus"></i></button>
            <button class="zoom-out-btn" title="Zoom Out"><i class="fas fa-minus"></i></button>
            <button class="zoom-reset-btn" title="Reset View"><i class="fas fa-search"></i></button>
        `;
        container.appendChild(zoomControls);

        zoomControls.querySelector('.zoom-in-btn').addEventListener('click', () => {
            zoomByStep(1, interactiveWrapper.clientWidth / 2, interactiveWrapper.clientHeight / 2);
        });

        zoomControls.querySelector('.zoom-out-btn').addEventListener('click', () => {
            zoomByStep(-1, interactiveWrapper.clientWidth / 2, interactiveWrapper.clientHeight / 2);
        });

        zoomControls.querySelector('.zoom-reset-btn').addEventListener('click', () => {
            resetTransform();
        });
    }

    normalizeMermaidSvg(panContainer, wrapper, padding = 0) {
        if (!panContainer) return;

        const svg = panContainer.querySelector('svg');
        if (!svg) return;

        let bbox;
        try {
            bbox = svg.getBBox();
        } catch (error) {
            console.warn('ArtifactHandler: Unable to measure Mermaid diagram.', error);
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

        const targetWidth = wrapper ? Math.max(wrapper.clientWidth, viewBoxWidth) : viewBoxWidth;
        const targetHeight = wrapper ? Math.max(wrapper.clientHeight, viewBoxHeight) : viewBoxHeight;

        panContainer.style.minWidth = `${targetWidth}px`;
        panContainer.style.minHeight = `${targetHeight}px`;
        panContainer.style.padding = `${padding}px`;
    }

    inferLanguageFromType(type) {
        if (!type || type === 'code') {
            return 'plaintext';
        }
        return String(type).toLowerCase();
    }

    supportsPreviewMode(language) {
        return ['markdown', 'html', 'mermaid'].includes((language || '').toLowerCase());
    }

    isDeployableLanguage(language) {
        return (language || '').toLowerCase() === 'html';
    }

    resolveInitialCodeViewMode(language, requestedMode = null) {
        if (requestedMode === 'source' || requestedMode === 'preview') {
            return requestedMode;
        }
        return this.supportsPreviewMode(language) ? 'preview' : 'source';
    }

    renderTextArtifactView(content, language, container, mode = 'source') {
        const normalizedLanguage = (language || 'plaintext').toLowerCase();

        if (mode === 'source') {
            this.renderCode(content, normalizedLanguage, container);
            return;
        }

        if (normalizedLanguage === 'markdown') {
            this.renderMarkdownPreview(content, container);
            return;
        }

        if (normalizedLanguage === 'html') {
            this.renderHtmlPreview(content, container);
            return;
        }

        if (normalizedLanguage === 'mermaid') {
            this.renderMermaidPreview(content, container);
            return;
        }

        this.renderCode(content, normalizedLanguage, container);
    }

    renderMarkdownPreview(content, container) {
        const preview = document.createElement('div');
        preview.className = 'artifact-markdown-preview';
        const rawHtml = window.marked ? window.marked.parse(content || '') : `<pre>${this.escapeHtml(content || '')}</pre>`;
        const sanitizedHtml = window.DOMPurify
            ? window.DOMPurify.sanitize(rawHtml)
            : rawHtml;
        preview.innerHTML = sanitizedHtml;
        container.appendChild(preview);
    }

    renderHtmlPreview(content, container) {
        const previewFrame = document.createElement('iframe');
        previewFrame.className = 'artifact-html-preview';
        previewFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        previewFrame.setAttribute('title', 'HTML preview');
        const safeHtml = window.DOMPurify
            ? window.DOMPurify.sanitize(content || '', { WHOLE_DOCUMENT: true })
            : (content || '');
        previewFrame.srcdoc = safeHtml;
        container.appendChild(previewFrame);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    renderCode(content, language, container) {
        const pre = document.createElement('pre');
        pre.className = 'artifact-code';
        const code = document.createElement('code');
        code.className = `language-${language}`;
        code.textContent = content;
        pre.appendChild(code);
        container.appendChild(pre);
        if (window.hljs) {
            window.hljs.highlightElement(code);
        }
    }

    hideArtifact() {
        const container = document.getElementById('artifact-container');
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        
        container.classList.add('hidden');
        chatContainer.classList.remove('with-artifact');
        inputContainer.classList.remove('with-artifact');
    }

    reopenArtifact(artifactId) {
        const artifact = this.artifacts.get(artifactId);
        if (artifact && typeof artifact === 'object') {
            // If the artifact is pending, check if data arrived in pendingImages cache
            if (artifact.isPending && this.pendingImages.has(artifactId)) {
                const imageData = this.pendingImages.get(artifactId);
                artifact.content = imageData;
                artifact.isPending = false;
                this.pendingImages.delete(artifactId);
                this.showArtifact(artifact.type, imageData, artifactId, {
                    title: artifact.title,
                    language: artifact.language,
                    defaultView: artifact.viewMode
                });
                return;
            }
            
            // If the artifact is pending and no data available, show loading state
            // Otherwise, pass the actual content
            this.showArtifact(artifact.type, artifact.isPending ? null : artifact.content, artifactId, {
                title: artifact.title,
                language: artifact.language,
                defaultView: artifact.viewMode
            });
        } else {
            console.error(`ArtifactHandler: Failed to find artifact with ID: ${artifactId}`);
        }
    }

    async copyArtifactContent() {
        const container = document.getElementById('artifact-container');
        const contentDiv = container.querySelector('.artifact-content');
        let content = '';

        const activeId = container.dataset.activeArtifactId;
        if (activeId && this.artifacts.has(activeId)) {
            const artifact = this.artifacts.get(activeId);
            if (artifact.type === 'mermaid' || artifact.type === 'code') {
                content = artifact.content;
            }
        }

        if (!content) {
            const cachedSource = contentDiv.querySelector('.mermaid-source-cache');
            if (cachedSource) {
                content = cachedSource.textContent;
            }
        }

        if (!content && contentDiv.querySelector('code')) {
            content = contentDiv.querySelector('code').textContent;
        }

        if (content) {
            try {
                await navigator.clipboard.writeText(content);
                this.showNotification('Content copied to clipboard!', 'success');
            } catch (err) {
                this.showNotification('Failed to copy content', 'error');
            }
        }
    }

    async downloadArtifact() {
        const container = document.getElementById('artifact-container');
        const contentDiv = container.querySelector('.artifact-content');
        let content = '';
        let suggestedName = 'artifact';
        let extension = '.txt';
        let encoding = 'utf8';

        const activeId = container.dataset.activeArtifactId;
        if (activeId && this.artifacts.has(activeId)) {
            const artifact = this.artifacts.get(activeId);
            if (artifact.type === 'mermaid' || artifact.type === 'code') {
                content = artifact.content;
                extension = artifact.type === 'mermaid'
                    ? '.mmd'
                    : this.getFileExtension(artifact.language || 'plaintext');
                const safeTitle = (artifact.title || '').trim();
                suggestedName = safeTitle
                    ? safeTitle.replace(/[\\/:*?"<>|]+/g, '_')
                    : (artifact.type === 'mermaid' ? 'diagram' : 'code');
            }
        }

        if (!content) {
            const cachedSource = contentDiv.querySelector('.mermaid-source-cache');
            if (cachedSource) {
                content = cachedSource.textContent;
                extension = '.mmd';
                suggestedName = 'diagram';
            }
        }

        const imageEl = contentDiv.querySelector('.generated-image-artifact');

        if (imageEl) {
            const dataUri = imageEl.src;
            content = dataUri.split(',')[1];
            suggestedName = 'generated-image';
            extension = '.png';
            encoding = 'base64';
        } else if (!content && contentDiv.querySelector('.mermaid')) {
            content = contentDiv.querySelector('.mermaid').textContent;
            extension = '.mmd';
            suggestedName = 'diagram';
        } else if (contentDiv.querySelector('code')) {
            const code = contentDiv.querySelector('code');
            content = code.textContent;
            const language = code.className.replace('language-', '');
            extension = this.getFileExtension(language);
            suggestedName = `code`;
        }

        if (!content) return;

        try {
            const result = await window.electron.ipcRenderer.invoke('show-save-dialog', {
                title: 'Save File',
                defaultPath: suggestedName + extension,
                filters: [{ name: 'Image', extensions: ['png'] }, { name: 'All Files', extensions: ['*'] }]
            });
            
            if (result.canceled || !result.filePath) return;
            
            const success = await window.electron.ipcRenderer.invoke('save-file', {
                filePath: result.filePath,
                content: content,
                encoding: encoding 
            });
            
            if (success) {
                this.showNotification('File saved successfully', 'success');
            } else {
                this.showNotification('Failed to save file', 'error');
            }
        } catch (error) {
            console.error('Error saving file:', error);
            this.showNotification('Error: ' + error.message, 'error');
        }
    }

    getFileExtension(language) {
        const extensions = {
            javascript: '.js', python: '.py', html: '.html', css: '.css', json: '.json',
            typescript: '.ts', java: '.java', cpp: '.cpp', c: '.c', ruby: '.rb',
            php: '.php', go: '.go', rust: '.rs', swift: '.swift', kotlin: '.kt', mermaid: '.mmd',
            plaintext: '.txt'
        };
        return extensions[language] || '.txt';
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `artifact-notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    getActiveArtifact() {
        const container = document.getElementById('artifact-container');
        const activeId = container?.dataset?.activeArtifactId;
        if (!activeId) return null;
        return this.artifacts.get(activeId) || null;
    }

    isHtmlContent(content) {
        const text = String(content || '').trim().toLowerCase();
        if (!text) return false;
        return (
            text.startsWith('<!doctype html') ||
            text.includes('<html') ||
            text.includes('<body') ||
            text.includes('<head')
        );
    }

    slugify(input) {
        const base = String(input || 'site')
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');
        const root = base || 'site';
        const suffix = Math.random().toString(36).slice(2, 8);
        return `${root}-${suffix}`.slice(0, 50);
    }

    async deployApi(path, token, body = null, method = 'POST') {
        const response = await fetch(`${this.backendBaseUrl}${path}`, {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                ...(body ? { 'Content-Type': 'application/json' } : {})
            },
            ...(body ? { body: JSON.stringify(body) } : {})
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (_err) {
            payload = null;
        }

        if (!response.ok) {
            const reason = payload?.error || payload?.message || `HTTP ${response.status}`;
            throw new Error(reason);
        }
        return payload;
    }

    getCurrentConversationId() {
        const sessionId = window.currentConversationId;
        return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
    }

    inferContentTypeFromPath(path) {
        const ext = String(path || '').toLowerCase().split('.').pop();
        const map = {
            html: 'text/html',
            htm: 'text/html',
            css: 'text/css',
            js: 'text/javascript',
            mjs: 'text/javascript',
            json: 'application/json',
            txt: 'text/plain',
            md: 'text/markdown',
            svg: 'image/svg+xml',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            ico: 'image/x-icon',
            woff: 'font/woff',
            woff2: 'font/woff2',
            ttf: 'font/ttf',
            eot: 'application/vnd.ms-fontobject',
            xml: 'application/xml',
            wasm: 'application/wasm'
        };
        return map[ext] || 'application/octet-stream';
    }

    normalizeDeployPath(rawPath, fallbackName = null) {
        let path = String(rawPath || fallbackName || '')
            .replace(/\\/g, '/')
            .trim();

        if (!path) return null;

        path = path.replace(/^\/home\/sandboxuser\//, '');
        path = path.replace(/^\/+/, '');
        path = path.replace(/^\.\/+/, '');

        if (!path || path.endsWith('/') || path.split('/').includes('..')) {
            return null;
        }

        return path;
    }

    async arrayBufferToBase64(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const chunkSize = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
        }
        return btoa(binary);
    }

    async getSessionContent(accessToken, sessionId) {
        if (!sessionId) return [];

        if (window.sessionContentViewer) {
            const cached = window.sessionContentViewer.getCachedContent(sessionId);
            if (Array.isArray(cached)) {
                return cached;
            }
        }

        const response = await fetch(`${this.backendBaseUrl}/api/sessions/${sessionId}/content`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to load session files (HTTP ${response.status})`);
        }

        const payload = await response.json();
        const content = Array.isArray(payload?.content) ? payload.content : [];

        if (window.sessionContentViewer) {
            window.sessionContentViewer.cacheContent(sessionId, content);
        }

        return content;
    }

    async collectSessionDeployFiles(accessToken) {
        const sessionId = this.getCurrentConversationId();
        if (!sessionId) {
            return [];
        }

        const content = await this.getSessionContent(accessToken, sessionId);
        const artifacts = content.filter((item) => item?.content_type === 'artifact');
        if (!artifacts.length) {
            return [];
        }

        // Keep latest artifact for each path.
        const latestByPath = new Map();
        for (const item of artifacts) {
            const metadata = item?.metadata || {};
            const normalizedPath = this.normalizeDeployPath(metadata.file_path, metadata.filename);
            if (!normalizedPath || !item?.download_url) continue;
            latestByPath.set(normalizedPath, item);
        }

        const deployFiles = [];
        const MAX_FILES = 100;
        let processed = 0;

        for (const [path, item] of latestByPath) {
            if (processed >= MAX_FILES) break;

            const metadata = item?.metadata || {};
            const contentType = metadata.mime_type || this.inferContentTypeFromPath(path);

            deployFiles.push({
                path,
                content_type: contentType,
                download_url: item.download_url
            });

            processed += 1;
        }

        return deployFiles;
    }

    parseLocalAssetRefs(html) {
        const text = String(html || '');
        const refs = new Set();
        const patterns = [
            /<link[^>]+href=["']([^"']+)["']/gi,
            /<script[^>]+src=["']([^"']+)["']/gi,
            /<img[^>]+src=["']([^"']+)["']/gi
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const raw = String(match[1] || '').trim();
                if (!raw) continue;
                if (
                    raw.startsWith('http://') ||
                    raw.startsWith('https://') ||
                    raw.startsWith('//') ||
                    raw.startsWith('data:') ||
                    raw.startsWith('#')
                ) {
                    continue;
                }
                refs.add(raw.replace(/^\.\/+/, ''));
            }
        }
        return refs;
    }

    buildDeploymentDraft(files, htmlFallback) {
        const groups = new Map();
        const assetRefs = this.parseLocalAssetRefs(htmlFallback);

        for (const file of files) {
            const fullPath = String(file.path || '');
            const root = fullPath.includes('/') ? fullPath.split('/')[0] : '';
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root).push(file);
        }

        const scoreGroup = (root, items) => {
            const rebased = items.map((file) => {
                const fullPath = String(file.path || '');
                const path = root && fullPath.startsWith(`${root}/`) ? fullPath.slice(root.length + 1) : fullPath;
                return { ...file, path, _root: root };
            });

            const pathSet = new Set(rebased.map((f) => String(f.path || '').toLowerCase()));
            const hasIndex = pathSet.has('index.html');
            let matchedRefs = 0;
            for (const ref of assetRefs) {
                if (pathSet.has(String(ref).toLowerCase())) matchedRefs += 1;
            }

            // Prefer coherent website groups: has index + asset matches + richer file set.
            const score =
                (hasIndex ? 100 : 0) +
                (matchedRefs * 25) +
                Math.min(rebased.length, 30);

            return { root, rebased, score, hasIndex, matchedRefs };
        };

        const candidates = Array.from(groups.entries()).map(([root, items]) => scoreGroup(root, items));
        candidates.sort((a, b) => b.score - a.score);

        let selected = candidates.length ? candidates[0] : { root: '', rebased: [], hasIndex: false };
        let draftFiles = [...selected.rebased];

        if (!selected.hasIndex) {
            draftFiles.push({
                path: 'index.html',
                content: String(htmlFallback || ''),
                content_type: 'text/html',
                _root: 'fallback'
            });
        }

        return {
            rootPrefix: selected.root || null,
            candidateCount: candidates.length,
            files: draftFiles
        };
    }

    buildFileTreeMarkup(paths) {
        const root = {};

        for (const rawPath of paths) {
            const path = String(rawPath || '').trim();
            if (!path) continue;

            const parts = path.split('/');
            let node = root;
            for (let i = 0; i < parts.length; i += 1) {
                const part = parts[i];
                if (!part) continue;
                if (!node[part]) {
                    node[part] = { __children: {}, __file: i === parts.length - 1 };
                } else if (i === parts.length - 1) {
                    node[part].__file = true;
                }
                node = node[part].__children;
            }
        }

        const renderNode = (obj) => {
            const keys = Object.keys(obj).sort((a, b) => {
                const aFile = obj[a].__file;
                const bFile = obj[b].__file;
                if (aFile !== bFile) return aFile ? 1 : -1;
                return a.localeCompare(b);
            });

            return `<ul class="deploy-tree-list">${keys.map((key) => {
                const entry = obj[key];
                const safeName = this.escapeHtml(key);
                if (entry.__file) {
                    return `<li class="deploy-tree-file"><i class="fas fa-file-code"></i><span>${safeName}</span></li>`;
                }
                return `<li class="deploy-tree-dir"><i class="fas fa-folder"></i><span>${safeName}</span>${renderNode(entry.__children)}</li>`;
            }).join('')}</ul>`;
        };

        return renderNode(root);
    }

    async confirmDeployPreview({ files, rootPrefix, candidateCount }) {
        const modal = document.getElementById('deploy-preview-modal');
        if (!modal) return files;

        const metaEl = modal.querySelector('.deploy-preview-meta');
        const treeEl = modal.querySelector('.deploy-preview-tree');
        const confirmBtn = modal.querySelector('.deploy-preview-confirm');
        const cancelBtn = modal.querySelector('.deploy-preview-cancel');
        const closeBtn = modal.querySelector('.deploy-preview-close');

        const fileCount = files.length;
        const rootInfo = rootPrefix
            ? `Selected project root: <code>${this.escapeHtml(rootPrefix)}</code> (rebased to web root).`
            : 'Deploying from current root paths.';
        const candidateInfo = candidateCount > 1
            ? `Detected <strong>${candidateCount}</strong> project-root candidates in this session; best match selected automatically.`
            : 'Single project-root candidate detected.';

        metaEl.innerHTML = `
            <div><strong>${fileCount}</strong> file${fileCount === 1 ? '' : 's'} will be deployed.</div>
            <div>${rootInfo}</div>
            <div>${candidateInfo}</div>
        `;

        treeEl.innerHTML = `
            <div class="deploy-editor-list">
                ${files.map((file, index) => `
                    <div class="deploy-editor-row" data-row-index="${index}">
                        <input class="deploy-editor-include" type="checkbox" checked />
                        <input class="deploy-editor-path" type="text" value="${this.escapeHtml(file.path)}" />
                        <span class="deploy-editor-type">${this.escapeHtml(file.content_type || this.inferContentTypeFromPath(file.path))}</span>
                    </div>
                `).join('')}
            </div>
            <div class="deploy-editor-tree"></div>
        `;

        const rebuildTree = () => {
            const rows = Array.from(treeEl.querySelectorAll('.deploy-editor-row'));
            const selectedPaths = rows
                .filter((row) => row.querySelector('.deploy-editor-include')?.checked)
                .map((row) => (row.querySelector('.deploy-editor-path')?.value || '').trim())
                .filter(Boolean);
            const treeHtml = this.buildFileTreeMarkup(selectedPaths);
            const treeContainer = treeEl.querySelector('.deploy-editor-tree');
            if (treeContainer) treeContainer.innerHTML = treeHtml;
        };

        treeEl.querySelectorAll('.deploy-editor-include, .deploy-editor-path').forEach((el) => {
            el.addEventListener('change', rebuildTree);
            el.addEventListener('input', rebuildTree);
        });
        rebuildTree();
        modal.classList.remove('hidden');

        return new Promise((resolve) => {
            const cleanup = () => {
                modal.classList.add('hidden');
                confirmBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                closeBtn.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
            };

            const onConfirm = () => {
                const rows = Array.from(treeEl.querySelectorAll('.deploy-editor-row'));
                const selected = rows
                    .filter((row) => row.querySelector('.deploy-editor-include')?.checked)
                    .map((row) => {
                        const index = Number(row.dataset.rowIndex);
                        const editedPath = this.normalizeDeployPath(row.querySelector('.deploy-editor-path')?.value || '');
                        if (!editedPath) return null;
                        const source = files[index];
                        return {
                            ...source,
                            path: editedPath
                        };
                    })
                    .filter(Boolean);

                cleanup();
                resolve(selected);
            };

            const onCancel = () => {
                cleanup();
                resolve(null);
            };

            const onBackdrop = (event) => {
                if (event.target === modal) {
                    onCancel();
                }
            };

            confirmBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            closeBtn.addEventListener('click', onCancel);
            modal.addEventListener('click', onBackdrop);
        });
    }

    async materializeDeployFiles(files) {
        const deployFiles = [];
        for (const file of files) {
            if (file.content !== undefined) {
                deployFiles.push({
                    path: file.path,
                    content: file.content,
                    content_type: file.content_type || this.inferContentTypeFromPath(file.path)
                });
                continue;
            }

            if (!file.download_url) {
                continue;
            }

            const fileResponse = await fetch(file.download_url);
            if (!fileResponse.ok) {
                throw new Error(`Failed to fetch '${file.path}' (HTTP ${fileResponse.status})`);
            }

            const arrayBuffer = await fileResponse.arrayBuffer();
            const contentBase64 = await this.arrayBufferToBase64(arrayBuffer);
            deployFiles.push({
                path: file.path,
                content_base64: contentBase64,
                content_type: file.content_type || this.inferContentTypeFromPath(file.path)
            });
        }

        return deployFiles;
    }

    async deployCurrentArtifact() {
        if (this.deployInProgress) {
            this.showNotification('Deploy already in progress', 'info');
            return;
        }

        const artifact = this.getActiveArtifact();
        if (!artifact) {
            this.showNotification('No active artifact selected', 'error');
            return;
        }

        const language = String(artifact.language || artifact.type || '').toLowerCase();
        const html = String(artifact.content || '');
        if (!(language === 'html' || this.isHtmlContent(html))) {
            this.showNotification('Open the website entry HTML file (index.html) before deploying', 'error');
            return;
        }

        const session = await window.electron.auth.getSession();
        if (!session || !session.access_token) {
            this.showNotification('Please sign in before deploying', 'error');
            return;
        }

        const siteId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `site-${Date.now()}`;
        const slugSource = artifact.title || 'generated-site';
        const slug = this.slugify(slugSource);

        this.deployInProgress = true;
        this.showNotification('Deploy started...', 'info');

        try {
            const sessionFiles = await this.collectSessionDeployFiles(session.access_token);
            const draft = this.buildDeploymentDraft(sessionFiles, html);
            let filesToDeploy = draft.files;

            if (!filesToDeploy.length) {
                throw new Error('No deployable files found in this session');
            }

            const editedFiles = await this.confirmDeployPreview({
                files: filesToDeploy,
                rootPrefix: draft.rootPrefix,
                candidateCount: draft.candidateCount
            });
            if (!editedFiles) {
                this.showNotification('Deploy canceled', 'info');
                return;
            }

            filesToDeploy = editedFiles;
            const hasIndexHtml = filesToDeploy.some((file) => String(file.path || '').toLowerCase() === 'index.html');
            if (!hasIndexHtml) {
                throw new Error('Deployment must include index.html');
            }

            const uploadPayload = await this.materializeDeployFiles(filesToDeploy);

            if (uploadPayload.length > 1) {
                this.showNotification(`Deploying ${uploadPayload.length} files...`, 'info');
            }

            await this.deployApi('/api/deploy/site/init', session.access_token, {
                site_id: siteId,
                project_name: artifact.title || 'Generated Site',
                slug
            });

            await this.deployApi('/api/deploy/assign-subdomain', session.access_token, { site_id: siteId });

            const upload = await this.deployApi('/api/deploy/upload-site', session.access_token, {
                site_id: siteId,
                files: uploadPayload
            });

            const activated = await this.deployApi('/api/deploy/activate', session.access_token, {
                site_id: siteId,
                deployment_id: upload.deployment_id
            });

            const liveUrl = activated?.url || `https://${slug}.pawsitivestrides.store`;
            this.showNotification(`Deployed: ${liveUrl}`, 'success');

            if (window.electron?.shell?.openExternal) {
                window.electron.shell.openExternal(liveUrl);
            }
        } catch (error) {
            console.error('Deploy failed:', error);
            this.showNotification(`Deploy failed: ${error.message}`, 'error');
        } finally {
            this.deployInProgress = false;
        }
    }

    // --- Sandbox methods are unchanged ---
    showTerminal(artifactId) {
        const container = document.getElementById('artifact-container');
        const contentDiv = container.querySelector('.artifact-content');
        
        container.querySelector('.artifact-title').textContent = 'Sandbox Terminal';
        container.querySelector('.copy-artifact-btn').style.display = 'none';
        container.querySelector('.download-artifact-btn').style.display = 'none';
        container.querySelector('.deploy-artifact-btn').style.display = 'none';

        contentDiv.innerHTML = `
            <div class="terminal-output">
                <pre><code><span class="log-line log-status">Waiting for command...</span></code></pre>
            </div>
        `;

        container.classList.remove('hidden');
        container.dataset.activeArtifactId = artifactId;

        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        chatContainer.classList.add('with-artifact');
        inputContainer.classList.add('with-artifact');
    }

    updateCommand(artifactId, command) {
        const container = document.getElementById('artifact-container');
        if (container.dataset.activeArtifactId !== artifactId) return;
        
        const codeEl = container.querySelector('code');
        if (codeEl) {
            codeEl.innerHTML = `
                <span class="log-line log-command">$ ${command}</span>
                <span class="log-line log-status terminal-spinner">Running...</span>
            `;
        }
    }

    updateTerminalOutput(artifactId, stdout, stderr, exitCode) {
        const container = document.getElementById('artifact-container');
        if (container.dataset.activeArtifactId !== artifactId) return;

        const codeEl = container.querySelector('code');
        if (codeEl) {
            const spinner = codeEl.querySelector('.terminal-spinner');
            if (spinner) spinner.remove();

            if (stdout) {
                const stdoutSpan = document.createElement('span');
                stdoutSpan.className = 'log-line log-stdout';
                stdoutSpan.textContent = stdout;
                codeEl.appendChild(stdoutSpan);
            }
            if (stderr) {
                const stderrSpan = document.createElement('span');
                stderrSpan.className = 'log-line log-error';
                stderrSpan.textContent = stderr;
                codeEl.appendChild(stderrSpan);
            }
            const statusSpan = document.createElement('span');
            statusSpan.className = 'log-line log-status';
            statusSpan.textContent = `\n--- Process finished with exit code ${exitCode} ---`;
            codeEl.appendChild(statusSpan);
        }
    }
}

export const artifactHandler = new ArtifactHandler();
