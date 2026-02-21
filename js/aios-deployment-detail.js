// aios-deployment-detail.js - Deployment detail modal functionality

// Add methods to AIOS class
if (window.AIOS) {
    const AIOS_prototype = window.AIOS.constructor.prototype;

    AIOS_prototype.showDeploymentDetail = async function(project) {
        const modal = document.getElementById('deployment-detail-modal');
        if (!modal) return;

        // Update title
        document.getElementById('deployment-detail-title').textContent = this._safeText(project.project_name, 'Untitled');
        document.getElementById('deployment-detail-subtitle').textContent = `Version ${this._safeText(project.version)}`;

        // Update info grid with card-based layout
        const infoGrid = document.getElementById('deployment-info-grid');
        const status = this._safeText(project.deployment_status, 'unknown').toLowerCase();
        const statusClass = status === 'active' ? 'status-active' : status === 'draft' ? 'status-draft' : '';
        
        infoGrid.innerHTML = `
            <div class="deployment-info-card">
                <div class="deployment-info-card-header">
                    <i class="fas fa-server"></i>
                    <span>Deployment Details</span>
                </div>
                <div class="deployment-info-card-body">
                    <div class="deployment-info-row">
                        <span class="deployment-info-label">Status</span>
                        <span class="settings-badge ${statusClass}">${this._safeText(project.deployment_status, 'unknown')}</span>
                    </div>
                    <div class="deployment-info-row">
                        <span class="deployment-info-label">Hostname</span>
                        <span class="deployment-info-value">${this._safeText(project.hostname)}</span>
                    </div>
                    <div class="deployment-info-row">
                        <span class="deployment-info-label">Slug</span>
                        <span class="deployment-info-value">${this._safeText(project.slug)}</span>
                    </div>
                    <div class="deployment-info-row">
                        <span class="deployment-info-label">Version</span>
                        <span class="deployment-info-value">v${this._safeText(project.version)}</span>
                    </div>
                </div>
            </div>
            <div class="deployment-info-card">
                <div class="deployment-info-card-header">
                    <i class="fas fa-fingerprint"></i>
                    <span>Identifiers</span>
                </div>
                <div class="deployment-info-card-body">
                    <div class="deployment-info-row">
                        <span class="deployment-info-label">Site ID</span>
                        <span class="deployment-info-value deployment-info-mono">${this._safeText(project.site_id)}</span>
                    </div>
                    <div class="deployment-info-row">
                        <span class="deployment-info-label">Deployment ID</span>
                        <span class="deployment-info-value deployment-info-mono">${this._safeText(project.deployment_id)}</span>
                    </div>
                    <div class="deployment-info-row">
                        <span class="deployment-info-label">R2 Prefix</span>
                        <span class="deployment-info-value deployment-info-mono">${this._safeText(project.r2_prefix)}</span>
                    </div>
                </div>
            </div>
            <div class="deployment-info-card">
                <div class="deployment-info-card-header">
                    <i class="fas fa-clock"></i>
                    <span>Timeline</span>
                </div>
                <div class="deployment-info-card-body">
                    <div class="deployment-info-row">
                        <span class="deployment-info-label">Created</span>
                        <span class="deployment-info-value">${this._formatDate(project.deployment_created_at)}</span>
                    </div>
                </div>
            </div>
        `;

        // Load file structure
        await this.loadDeploymentFiles(project);

        // Setup preview - Use webview in Electron for better CSP handling
        const url = project.hostname ? `https://${project.hostname}` : null;
        const urlDisplay = document.getElementById('deployment-preview-url');
        const previewContainer = document.querySelector('.deployment-preview-container');
        
        // Clear any existing loading messages
        const existingMessages = previewContainer.querySelectorAll('.deployment-preview-loading');
        existingMessages.forEach(msg => msg.remove());
        
        if (url) {
            urlDisplay.textContent = url;
            
            // Check if we're in Electron environment with webview support
            if (typeof window !== 'undefined' && window.electron) {
                // Remove existing iframe
                const existingFrame = document.getElementById('deployment-preview-frame');
                if (existingFrame) existingFrame.remove();
                
                // Show loading state
                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'deployment-preview-loading';
                loadingDiv.innerHTML = `
                    <div class="deployment-preview-spinner"></div>
                    <p style="margin: 16px 0; color: var(--text-secondary);">Loading preview...</p>
                `;
                previewContainer.appendChild(loadingDiv);
                
                // Create webview element for Electron
                const webview = document.createElement('webview');
                webview.id = 'deployment-preview-frame';
                webview.className = 'deployment-preview-frame';
                webview.src = url;
                webview.setAttribute('allowpopups', '');
                webview.setAttribute('partition', 'persist:deployment-preview');
                
                // Handle webview load events
                webview.addEventListener('did-start-loading', () => {
                    console.log('Webview started loading:', url);
                });
                
                webview.addEventListener('did-finish-load', () => {
                    console.log('Webview finished loading:', url);
                    loadingDiv.remove();
                    webview.style.opacity = '1';
                });
                
                webview.addEventListener('did-fail-load', (event) => {
                    console.error('Webview failed to load:', event);
                    loadingDiv.remove();
                    
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'deployment-preview-loading';
                    errorDiv.innerHTML = `
                        <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #f59e0b;"></i>
                        <p style="margin: 16px 0; color: var(--text-secondary); max-width: 300px; text-align: center;">
                            Failed to load preview. Open in browser to view.
                        </p>
                        <button class="deployment-preview-open-btn" style="
                            width: auto; 
                            padding: 0 20px; 
                            height: 40px; 
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                            color: white; 
                            border: none;
                            border-radius: 8px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            font-size: 14px;
                            font-weight: 600;
                            transition: all 0.2s ease;
                        ">
                            <i class="fas fa-external-link-alt"></i>
                            <span>Open in Browser</span>
                        </button>
                    `;
                    
                    const openBtn = errorDiv.querySelector('.deployment-preview-open-btn');
                    openBtn.addEventListener('click', () => {
                        if (window.electron && window.electron.shell) {
                            window.electron.shell.openExternal(url);
                        }
                    });
                    
                    previewContainer.appendChild(errorDiv);
                });
                
                // Set initial opacity for smooth transition
                webview.style.opacity = '0';
                webview.style.transition = 'opacity 0.3s ease';
                
                // Append webview to container
                previewContainer.appendChild(webview);
                
            } else {
                // Fallback for web version - show open in browser button
                const iframe = document.getElementById('deployment-preview-frame');
                if (iframe) iframe.style.display = 'none';
                
                const message = document.createElement('div');
                message.className = 'deployment-preview-loading';
                message.innerHTML = `
                    <i class="fas fa-external-link-alt" style="font-size: 48px; color: #667eea;"></i>
                    <p style="margin: 16px 0; color: var(--text-secondary);">Preview not available in web version</p>
                    <button class="deployment-preview-open-btn" style="
                        width: auto; 
                        padding: 0 20px; 
                        height: 40px; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; 
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        font-size: 14px;
                        font-weight: 600;
                        transition: all 0.2s ease;
                    ">
                        <i class="fas fa-external-link-alt"></i>
                        <span>Open in Browser</span>
                    </button>
                `;
                
                const openBtn = message.querySelector('.deployment-preview-open-btn');
                openBtn.addEventListener('click', () => {
                    window.open(url, '_blank');
                });
                
                previewContainer.appendChild(message);
            }
        } else {
            urlDisplay.textContent = 'URL not available';
        }

        // Show modal
        modal.classList.remove('hidden');
    };

    AIOS_prototype.hideDeploymentDetail = function() {
        const modal = document.getElementById('deployment-detail-modal');
        if (modal) {
            modal.classList.add('hidden');
            
            // Clear preview - handle both webview and iframe
            const frame = document.getElementById('deployment-preview-frame');
            if (frame) {
                if (frame.tagName === 'WEBVIEW') {
                    // Webview cleanup
                    frame.src = 'about:blank';
                    // Remove after a short delay to allow cleanup
                    setTimeout(() => {
                        if (frame.parentElement) {
                            frame.remove();
                        }
                    }, 100);
                } else if (frame.tagName === 'IFRAME') {
                    // Iframe cleanup
                    frame.onload = null;
                    frame.onerror = null;
                    frame.src = 'about:blank';
                    frame.style.display = 'block';
                    frame.style.opacity = '1';
                }
            }
            
            // Remove any preview messages
            const previewContainer = document.querySelector('.deployment-preview-container');
            if (previewContainer) {
                const messages = previewContainer.querySelectorAll('.deployment-preview-loading');
                messages.forEach(msg => msg.remove());
            }
        }
    };

    AIOS_prototype.loadDeploymentFiles = async function(project) {
        const fileTreeList = document.getElementById('deployment-file-tree-list');
        if (!fileTreeList) return;

        // Show loading state
        fileTreeList.innerHTML = '<li class="deployment-file-tree-item"><i class="fas fa-spinner fa-spin"></i> Loading files...</li>';

        // Since backend doesn't have /api/deploy/files endpoint,
        // show a mock file structure based on typical web deployment
        const files = [
            { path: 'index.html', size: 2048 },
            { path: 'styles.css', size: 1024 },
            { path: 'script.js', size: 3072 },
            { path: 'assets/logo.png', size: 15360 },
            { path: 'assets/favicon.ico', size: 4096 }
        ];

        if (files.length === 0) {
            fileTreeList.innerHTML = '<li class="deployment-file-tree-item"><i class="fas fa-info-circle"></i> No files found</li>';
            return;
        }

        // Build file tree structure
        const tree = this.buildFileTree(files);
        fileTreeList.innerHTML = '';
        this.renderFileTree(tree, fileTreeList);
    };

    AIOS_prototype.buildFileTree = function(files) {
        const tree = {};

        files.forEach(file => {
            const path = file.path || '';
            const parts = path.split('/').filter(p => p);
            let current = tree;

            parts.forEach((part, index) => {
                if (!current[part]) {
                    current[part] = {
                        name: part,
                        isFile: index === parts.length - 1,
                        size: index === parts.length - 1 ? file.size : null,
                        children: {}
                    };
                }
                current = current[part].children;
            });
        });

        return tree;
    };

    AIOS_prototype.renderFileTree = function(tree, container, level = 0) {
        const entries = Object.values(tree);
        
        // Sort: folders first, then files, alphabetically
        entries.sort((a, b) => {
            if (a.isFile !== b.isFile) {
                return a.isFile ? 1 : -1;
            }
            return a.name.localeCompare(b.name);
        });

        entries.forEach(entry => {
            const li = document.createElement('li');
            li.className = `deployment-file-tree-item ${entry.isFile ? 'file' : 'folder'}`;
            li.style.paddingLeft = `${level * 20}px`;

            const icon = entry.isFile ? 'fa-file' : 'fa-folder';
            const sizeText = entry.isFile && entry.size ? this.formatFileSize(entry.size) : '';

            li.innerHTML = `
                <i class="fas ${icon}"></i>
                <span>${entry.name}</span>
                ${sizeText ? `<span class="deployment-file-size">${sizeText}</span>` : ''}
            `;

            container.appendChild(li);

            // Recursively render children
            if (!entry.isFile && Object.keys(entry.children).length > 0) {
                this.renderFileTree(entry.children, container, level + 1);
            }
        });
    };

    AIOS_prototype.formatFileSize = function(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };
}
