// artifact-handler.js (Complete, Corrected with Fall-Through Fix)

class ArtifactHandler {
    constructor() {
        this.artifacts = new Map();
        this.pendingImages = new Map();
        this.currentId = 0;
        this.browserArtifactId = 'browser_view_artifact';
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
                        <button class="copy-artifact-btn" title="Copy to Clipboard">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="download-artifact-btn" title="Download">
                            <i class="fas fa-download"></i>
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
        
        container.querySelector('.close-artifact-btn').addEventListener('click', () => {
            this.hideArtifact();
        });

        container.querySelector('.copy-artifact-btn').addEventListener('click', () => {
            this.copyArtifactContent();
        });

        container.querySelector('.download-artifact-btn').addEventListener('click', () => {
            this.downloadArtifact();
        });
    }

    cachePendingImage(artifactId, base64Data) {
        this.pendingImages.set(artifactId, base64Data);
        console.log(`ArtifactHandler: Cached pending image with ID: ${artifactId}`);
    }

    createArtifact(content, type, artifactId = null) {
        // --- START OF THE CRITICAL FIX ---
        // Handle the special case for images first.
        if (type === 'image') {
            const imageId = content; // For images, 'content' is the ID from the formatter.
            if (this.artifacts.has(imageId)) {
                // If we've already finalized this artifact due to streaming, do nothing.
                return imageId;
            }
            if (this.pendingImages.has(imageId)) {
                const imageContent = this.pendingImages.get(imageId);
                this.artifacts.set(imageId, { content: imageContent, type: 'image' });
                this.pendingImages.delete(imageId); // Clean up the cache
                console.log(`ArtifactHandler: Finalized image artifact from cache: ${imageId}`);
                // **THE FIX**: Return immediately to prevent fall-through.
                return imageId;
            } else {
                // This will still log during streaming, but it won't corrupt state.
                console.warn(`ArtifactHandler: Tried to create image artifact for ID ${imageId}, but no pending data was found.`);
                return imageId;
            }
        }
        // --- END OF THE CRITICAL FIX ---

        // For all other artifact types (code, mermaid), the logic is simple.
        const id = artifactId || `artifact-${this.currentId++}`;
        this.artifacts.set(id, { content, type });
        return id;
    }

    showArtifact(type, data, artifactId = null) {
        const container = document.getElementById('artifact-container');
        const contentDiv = container.querySelector('.artifact-content');
        const titleEl = container.querySelector('.artifact-title');
        const copyBtn = container.querySelector('.copy-artifact-btn');
        const downloadBtn = container.querySelector('.download-artifact-btn');

        contentDiv.innerHTML = '';
        let currentArtifactId = artifactId;

        switch (type) {
            case 'browser_view':
                titleEl.textContent = 'Interactive Browser';
                copyBtn.style.display = 'none';
                downloadBtn.style.display = 'none';
                this.renderBrowserView(data);
                currentArtifactId = this.browserArtifactId;
                this.artifacts.set(currentArtifactId, { content: data, type });
                break;

            case 'image':
                titleEl.textContent = 'Image Viewer';
                copyBtn.style.display = 'none';
                downloadBtn.style.display = 'inline-flex';
                this.renderImage(data, contentDiv);
                break;

            case 'mermaid':
                titleEl.textContent = 'Diagram Viewer';
                copyBtn.style.display = 'inline-flex';
                downloadBtn.style.display = 'inline-flex';
                this.renderMermaid(data, contentDiv);
                if (!currentArtifactId) {
                    currentArtifactId = this.createArtifact(data, type);
                }
                break;

            default: // Handles code blocks
                titleEl.textContent = 'Code Viewer';
                copyBtn.style.display = 'inline-flex';
                downloadBtn.style.display = 'inline-flex';
                this.renderCode(data, type, contentDiv);
                if (!currentArtifactId) {
                    currentArtifactId = this.createArtifact(data, type);
                }
                break;
        }
        
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        container.classList.remove('hidden');
        chatContainer.classList.add('with-artifact');
        inputContainer.classList.add('with-artifact');

        return currentArtifactId;
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
        const img = document.createElement('img');
        img.className = 'generated-image-artifact';
        img.src = `data:image/png;base64,${base64Data}`;
        img.alt = 'Generated Image';
        container.appendChild(img);
    }

    renderMermaid(content, container) {
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

    renderCode(content, language, container) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = `language-${language}`;
        code.textContent = content;
        pre.appendChild(code);
        container.appendChild(pre);
        hljs.highlightElement(code);
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
            console.log(`ArtifactHandler: Reopening artifact with ID: ${artifactId}`);
            this.showArtifact(artifact.type, artifact.content, artifactId);
        } else {
            console.error(`ArtifactHandler: FAILED to find valid artifact object for ID: ${artifactId}.`);
            console.log('Current Artifacts Map:', this.artifacts);
        }
    }

    async copyArtifactContent() {
        const contentDiv = document.querySelector('.artifact-content');
        let content = '';

        if (contentDiv.querySelector('.mermaid')) {
            content = contentDiv.querySelector('.mermaid').textContent;
        } else if (contentDiv.querySelector('code')) {
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
        const contentDiv = document.querySelector('.artifact-content');
        let content = '';
        let suggestedName = 'artifact';
        let extension = '.txt';
        let encoding = 'utf8';

        const imageEl = contentDiv.querySelector('.generated-image-artifact');

        if (imageEl) {
            const dataUri = imageEl.src;
            content = dataUri.split(',')[1];
            suggestedName = 'generated-image';
            extension = '.png';
            encoding = 'base64';
        } else if (contentDiv.querySelector('.mermaid')) {
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
            php: '.php', go: '.go', rust: '.rs', swift: '.swift', kotlin: '.kt',
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

    // --- Sandbox methods are unchanged ---
    showTerminal(artifactId) {
        const container = document.getElementById('artifact-container');
        const contentDiv = container.querySelector('.artifact-content');
        
        container.querySelector('.artifact-title').textContent = 'Sandbox Terminal';
        container.querySelector('.copy-artifact-btn').style.display = 'none';
        container.querySelector('.download-artifact-btn').style.display = 'none';

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