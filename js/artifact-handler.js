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
        const mermaidDiv = document.createElement('div');
        mermaidDiv.className = 'mermaid';
        mermaidDiv.textContent = content;
        container.appendChild(mermaidDiv);
        mermaid.init(undefined, [mermaidDiv]);

        const zoomControls = document.createElement('div');
        zoomControls.className = 'mermaid-controls';
        zoomControls.innerHTML = `
            <button class="zoom-in-btn" title="Zoom In"><i class="fas fa-plus"></i></button>
            <button class="zoom-out-btn" title="Zoom Out"><i class="fas fa-minus"></i></button>
            <button class="zoom-reset-btn" title="Reset Zoom"><i class="fas fa-search"></i></button>
        `;
        container.appendChild(zoomControls);

        let currentZoom = 1;
        zoomControls.querySelector('.zoom-in-btn').addEventListener('click', () => {
            currentZoom = Math.min(currentZoom + 0.1, 2);
            mermaidDiv.style.transform = `scale(${currentZoom})`;
        });
        zoomControls.querySelector('.zoom-out-btn').addEventListener('click', () => {
            currentZoom = Math.max(currentZoom - 0.1, 0.5);
            mermaidDiv.style.transform = `scale(${currentZoom})`;
        });
        zoomControls.querySelector('.zoom-reset-btn').addEventListener('click', () => {
            currentZoom = 1;
            mermaidDiv.style.transform = 'scale(1)';
        });
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