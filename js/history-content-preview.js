// history-content-preview.js - Inline preview component for history session content
// Displays content in read-only mode without switching to artifact workspace

class HistoryContentPreview {
    constructor() {
        this.currentContent = null;
        this.init();
    }

    init() {
        // Create preview overlay structure
        const overlay = document.createElement('div');
        overlay.id = 'history-content-preview';
        overlay.className = 'history-content-preview hidden';

        overlay.innerHTML = `
            <div class="history-preview-backdrop"></div>
            <div class="history-preview-container">
                <div class="history-preview-header">
                    <div class="history-preview-title">
                        <i class="fas fa-file"></i>
                        <span class="preview-title-text">Content Preview</span>
                    </div>
                    <div class="history-preview-actions">
                        <button class="preview-download-btn" title="Download" aria-label="Download content">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="preview-close-btn" title="Close" aria-label="Close preview">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div class="history-preview-body">
                    <div class="preview-loading hidden">
                        <i class="fas fa-spinner fa-spin"></i>
                        <span>Loading content...</span>
                    </div>
                    <div class="preview-content"></div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.bindEvents();
    }

    bindEvents() {
        const overlay = document.getElementById('history-content-preview');
        const backdrop = overlay.querySelector('.history-preview-backdrop');
        const closeBtn = overlay.querySelector('.preview-close-btn');
        const downloadBtn = overlay.querySelector('.preview-download-btn');

        // Close on backdrop click
        backdrop.addEventListener('click', () => this.hide());

        // Close button
        closeBtn.addEventListener('click', () => this.hide());

        // Download button
        downloadBtn.addEventListener('click', () => this.downloadCurrentContent());

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible()) {
                this.hide();
            }
        });
    }

    isVisible() {
        const overlay = document.getElementById('history-content-preview');
        return overlay && !overlay.classList.contains('hidden');
    }

    async show(content) {
        console.log('[HistoryContentPreview] Showing content:', content);
        this.currentContent = content;

        const overlay = document.getElementById('history-content-preview');
        const titleText = overlay.querySelector('.preview-title-text');
        const previewBody = overlay.querySelector('.preview-content');
        const loading = overlay.querySelector('.preview-loading');

        // Update title
        const metadata = content.metadata || {};
        const filename = metadata.filename || 'Content';
        titleText.textContent = filename;

        // Show loading
        loading.classList.remove('hidden');
        previewBody.innerHTML = '';

        // Show overlay with animation
        overlay.classList.remove('hidden');
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });

        try {
            // Render content based on type
            await this.renderContent(content, previewBody);
            loading.classList.add('hidden');
        } catch (error) {
            console.error('[HistoryContentPreview] Error rendering content:', error);
            loading.classList.add('hidden');
            previewBody.innerHTML = `
                <div class="preview-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Failed to load content</p>
                    <small>${this.escapeHtml(error.message)}</small>
                </div>
            `;
        }
    }

    hide() {
        const overlay = document.getElementById('history-content-preview');
        overlay.classList.remove('visible');
        
        // Wait for animation to complete before hiding
        setTimeout(() => {
            overlay.classList.add('hidden');
            this.currentContent = null;
        }, 300);
    }

    async renderContent(content, container) {
        const contentType = content.content_type;
        const metadata = content.metadata || {};

        if (contentType === 'artifact') {
            await this.renderArtifact(content, container);
        } else if (contentType === 'upload') {
            await this.renderUpload(content, container);
        } else if (contentType === 'execution') {
            await this.renderExecution(content, container);
        } else {
            throw new Error(`Unknown content type: ${contentType}`);
        }
    }

    async renderArtifact(content, container) {
        const metadata = content.metadata || {};
        const filename = metadata.filename || 'file';
        const mimeType = metadata.mime_type || 'text/plain';

        if (!content.download_url) {
            throw new Error('No download URL available');
        }

        // Fetch content
        const response = await fetch(content.download_url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Handle different types
        if (mimeType.startsWith('image/')) {
            await this.renderImage(response, container);
        } else if (mimeType.startsWith('text/') || this.isTextFile(filename)) {
            await this.renderText(response, filename, container);
        } else if (mimeType === 'application/json') {
            await this.renderJSON(response, container);
        } else if (mimeType === 'application/pdf') {
            await this.renderPDF(content.download_url, container);
        } else {
            this.renderDownloadOnly(filename, content.download_url, container);
        }
    }

    async renderUpload(content, container) {
        const metadata = content.metadata || {};
        const filename = metadata.filename || 'file';
        const mimeType = metadata.mime_type || 'application/octet-stream';
        const relativePath = metadata.relativePath;

        // Try local file first
        if (relativePath) {
            try {
                const exists = await window.electron.fileArchive.fileExists(relativePath);
                if (exists) {
                    const fileData = await window.electron.fileArchive.readFile(relativePath);
                    
                    if (mimeType.startsWith('image/')) {
                        this.renderImageFromBuffer(fileData, mimeType, container);
                    } else if (mimeType.startsWith('text/') || metadata.is_text) {
                        const text = new TextDecoder().decode(fileData);
                        this.renderTextContent(text, filename, container);
                    } else {
                        this.renderDownloadOnly(filename, null, container);
                    }
                    return;
                }
            } catch (error) {
                console.warn('[HistoryContentPreview] Could not read local file:', error);
            }
        }

        // Fallback: show download option
        this.renderDownloadOnly(filename, metadata.path, container);
    }

    async renderExecution(content, container) {
        const metadata = content.metadata || {};
        const command = metadata.command || 'Unknown command';
        const exitCode = metadata.exit_code !== undefined ? metadata.exit_code : '?';

        // Fetch stdout and stderr
        let stdout = '';
        let stderr = '';

        if (content.stdout_url) {
            try {
                const response = await fetch(content.stdout_url);
                if (response.ok) {
                    stdout = await response.text();
                }
            } catch (error) {
                stdout = `[Error fetching stdout: ${error.message}]`;
            }
        }

        if (content.stderr_url) {
            try {
                const response = await fetch(content.stderr_url);
                if (response.ok) {
                    stderr = await response.text();
                }
            } catch (error) {
                stderr = `[Error fetching stderr: ${error.message}]`;
            }
        }

        // Render terminal output
        this.renderTerminalOutput(command, exitCode, stdout, stderr, container);
    }

    async renderImage(response, container) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-image-wrapper';
        
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Preview';
        img.className = 'preview-image';
        
        wrapper.appendChild(img);
        container.appendChild(wrapper);
    }

    renderImageFromBuffer(buffer, mimeType, container) {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        const dataUrl = `data:${mimeType};base64,${base64}`;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-image-wrapper';
        
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'Preview';
        img.className = 'preview-image';
        
        wrapper.appendChild(img);
        container.appendChild(wrapper);
    }

    async renderText(response, filename, container) {
        const text = await response.text();
        this.renderTextContent(text, filename, container);
    }

    renderTextContent(text, filename, container) {
        const language = this.detectLanguage(filename);
        
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-code-wrapper';
        
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = `language-${language}`;
        code.textContent = text;
        
        pre.appendChild(code);
        wrapper.appendChild(pre);
        container.appendChild(wrapper);
        
        // Apply syntax highlighting if available
        if (typeof hljs !== 'undefined') {
            hljs.highlightElement(code);
        }
    }

    async renderJSON(response, container) {
        const text = await response.text();
        const json = JSON.parse(text);
        const formatted = JSON.stringify(json, null, 2);
        
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-code-wrapper';
        
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = 'language-json';
        code.textContent = formatted;
        
        pre.appendChild(code);
        wrapper.appendChild(pre);
        container.appendChild(wrapper);
        
        // Apply syntax highlighting if available
        if (typeof hljs !== 'undefined') {
            hljs.highlightElement(code);
        }
    }

    async renderPDF(url, container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-pdf-wrapper';
        
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.className = 'preview-pdf-frame';
        
        wrapper.appendChild(iframe);
        container.appendChild(wrapper);
    }

    renderTerminalOutput(command, exitCode, stdout, stderr, container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-terminal-wrapper';
        
        const exitCodeClass = exitCode === 0 ? 'success' : 'error';
        
        wrapper.innerHTML = `
            <div class="terminal-header">
                <div class="terminal-command">
                    <i class="fas fa-terminal"></i>
                    <code>${this.escapeHtml(command)}</code>
                </div>
                <div class="terminal-exit-code ${exitCodeClass}">
                    Exit code: ${exitCode}
                </div>
            </div>
            <div class="terminal-output">
                ${stdout ? `<div class="terminal-stdout"><strong>STDOUT:</strong><pre>${this.escapeHtml(stdout)}</pre></div>` : ''}
                ${stderr ? `<div class="terminal-stderr"><strong>STDERR:</strong><pre>${this.escapeHtml(stderr)}</pre></div>` : ''}
                ${!stdout && !stderr ? '<div class="terminal-empty">(No output)</div>' : ''}
            </div>
        `;
        
        container.appendChild(wrapper);
    }

    renderDownloadOnly(filename, url, container) {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-download-only';
        
        wrapper.innerHTML = `
            <div class="download-icon">
                <i class="fas fa-file-download"></i>
            </div>
            <div class="download-info">
                <p class="download-filename">${this.escapeHtml(filename)}</p>
                <p class="download-message">This file type cannot be previewed</p>
                ${url ? '<button class="download-now-btn"><i class="fas fa-download"></i> Download</button>' : '<p class="download-unavailable">Download not available</p>'}
            </div>
        `;
        
        if (url) {
            const downloadBtn = wrapper.querySelector('.download-now-btn');
            downloadBtn.addEventListener('click', () => {
                window.open(url, '_blank');
            });
        }
        
        container.appendChild(wrapper);
    }

    downloadCurrentContent() {
        if (!this.currentContent) return;
        
        const metadata = this.currentContent.metadata || {};
        const filename = metadata.filename || 'download';
        
        if (this.currentContent.download_url) {
            // Create temporary link and trigger download
            const a = document.createElement('a');
            a.href = this.currentContent.download_url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    }

    detectLanguage(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const langMap = {
            'js': 'javascript',
            'jsx': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'py': 'python',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'md': 'markdown',
            'sh': 'bash',
            'bash': 'bash',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'go': 'go',
            'rs': 'rust',
            'rb': 'ruby',
            'php': 'php'
        };
        return langMap[ext] || 'plaintext';
    }

    isTextFile(filename) {
        const textExtensions = ['txt', 'log', 'md', 'markdown', 'js', 'jsx', 'ts', 'tsx', 'py', 'html', 'css', 'json', 'xml', 'yaml', 'yml', 'sh', 'bash', 'java', 'cpp', 'c', 'go', 'rs', 'rb', 'php'];
        const ext = filename.split('.').pop().toLowerCase();
        return textExtensions.includes(ext);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create singleton instance
const historyContentPreview = new HistoryContentPreview();

// Expose globally
window.historyContentPreview = historyContentPreview;

export default historyContentPreview;
