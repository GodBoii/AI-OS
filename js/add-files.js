// add-files.js (Corrected with proper URL, Race Condition Fix, and Drag & Drop Support)

class FileAttachmentHandler {
    constructor(socket, supportedFileTypes, maxFileSize) {
        this.supportedFileTypes = supportedFileTypes || {
            // Text / code files (content sent inline with query)
            'txt': 'text/plain', 'js': 'text/javascript', 'jsx': 'text/javascript',
            'ts': 'text/typescript', 'tsx': 'text/typescript',
            'py': 'text/x-python', 'html': 'text/html', 'htm': 'text/html',
            'css': 'text/css', 'scss': 'text/x-scss', 'sass': 'text/x-sass', 'less': 'text/x-less',
            'json': 'application/json', 'jsonl': 'application/json',
            'c': 'text/x-c', 'cpp': 'text/x-c++', 'h': 'text/x-c', 'hpp': 'text/x-c++',
            'java': 'text/x-java', 'kt': 'text/x-kotlin', 'kts': 'text/x-kotlin',
            'swift': 'text/x-swift', 'dart': 'text/x-dart',
            'go': 'text/x-go', 'rs': 'text/x-rust', 'rb': 'text/x-ruby',
            'php': 'text/x-php', 'lua': 'text/x-lua', 'pl': 'text/x-perl',
            'r': 'text/x-r', 'R': 'text/x-r', 'scala': 'text/x-scala',
            'sh': 'text/x-shellscript', 'bash': 'text/x-shellscript', 'zsh': 'text/x-shellscript',
            'bat': 'text/x-bat', 'ps1': 'text/x-powershell', 'cmd': 'text/x-bat',
            'md': 'text/markdown', 'mdx': 'text/markdown', 'rst': 'text/x-rst',
            'xml': 'text/xml', 'yaml': 'text/yaml', 'yml': 'text/yaml',
            'toml': 'text/x-toml', 'ini': 'text/x-ini', 'cfg': 'text/x-ini',
            'conf': 'text/x-ini', 'env': 'text/plain', 'properties': 'text/x-properties',
            'sql': 'text/x-sql', 'graphql': 'text/x-graphql', 'gql': 'text/x-graphql',
            'vue': 'text/x-vue', 'svelte': 'text/x-svelte',
            'csv': 'text/csv', 'tsv': 'text/tab-separated-values',
            'log': 'text/plain', 'diff': 'text/x-diff', 'patch': 'text/x-diff',
            'dockerfile': 'text/x-dockerfile', 'makefile': 'text/x-makefile',
            'cmake': 'text/x-cmake', 'gradle': 'text/x-gradle',
            'tf': 'text/x-terraform', 'hcl': 'text/x-hcl',
            'proto': 'text/x-protobuf',
            // Media and Document files (uploaded to Supabase)
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'doc': 'application/msword',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'xls': 'application/vnd.ms-excel',
            'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'ppt': 'application/vnd.ms-powerpoint',
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif',
            'svg': 'image/svg+xml', 'webp': 'image/webp', 'bmp': 'image/bmp', 'ico': 'image/x-icon',
            'tiff': 'image/tiff', 'tif': 'image/tiff',
            'mp3': 'audio/mpeg', 'wav': 'audio/wav',
            'ogg': 'audio/ogg', 'm4a': 'audio/mp4', 'flac': 'audio/flac', 'aac': 'audio/aac',
            'mp4': 'video/mp4', 'webm': 'video/webm',
            'avi': 'video/x-msvideo', 'mov': 'video/quicktime', 'mkv': 'video/x-matroska',
            'zip': 'application/zip', 'tar': 'application/x-tar', 'gz': 'application/gzip',
            'rar': 'application/vnd.rar', '7z': 'application/x-7z-compressed'
        };

        // Extensions that should use Supabase upload (media, documents, archives)
        // Everything NOT in this set will be treated as text and read inline
        this.mediaExtensions = new Set([
            // Images
            'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'tif',
            // Audio
            'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac',
            // Video
            'mp4', 'webm', 'avi', 'mov', 'mkv',
            // Documents (binary formats)
            'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
            // Archives
            'zip', 'tar', 'gz', 'rar', '7z'
        ]);

        this.maxFileSize = maxFileSize || 50 * 1024 * 1024; // 50MB default
        this.attachedFiles = [];
        this.dragCounter = 0; // Track nested drag events
        this.initialize();
    }

    initialize() {
        this.attachButton = document.getElementById('attach-file-btn');
        this.fileInput = document.getElementById('file-input');
        this.inputContainer = document.getElementById('floating-input-container');
        this.contextFilesBar = document.getElementById('context-files-bar');
        this.contextFilesContent = this.contextFilesBar.querySelector('.context-files-content');

        this.sidebar = document.getElementById('file-preview-sidebar');
        this.previewContent = this.sidebar.querySelector('.file-preview-content');
        this.fileCount = this.sidebar.querySelector('.file-count');

        this.sidebar.classList.add('hidden');
        this.contextFilesBar.classList.add('hidden');

        this.attachButton.addEventListener('click', (event) => {
            event.preventDefault();
            this.fileInput.click();
        });

        this.fileInput.addEventListener('change', async (event) => {
            await this.handleFileSelection(event);
        });

        this.sidebar.querySelector('.close-preview-btn').addEventListener('click', () => {
            this.toggleSidebar(false);
        });

        if (window.conversationStateManager) {
            window.conversationStateManager.setFileHandler(this);
            window.conversationStateManager.init();
        }

        this.updateInputPositioning();

        // Initialize drag and drop
        this.setupDragAndDrop();
    }

    // =========================================================================
    // DRAG AND DROP
    // =========================================================================

    setupDragAndDrop() {
        // Create the drag overlay element
        this.dragOverlay = this.createDragOverlay();

        // We attach drag listeners to the entire document body so that
        // dragging files anywhere over the app window triggers the overlay,
        // but the overlay itself is anchored to the input container.
        const chatContainer = document.getElementById('chat-container') || document.body;

        chatContainer.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dragCounter++;
            // Only show overlay if dragging files (not text/other drags)
            if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                this.showDragOverlay();
            }
        });

        chatContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
        });

        chatContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dragCounter--;
            if (this.dragCounter <= 0) {
                this.dragCounter = 0;
                this.hideDragOverlay();
            }
        });

        chatContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dragCounter = 0;
            
            // Trigger success animation
            if (this.dragOverlay) {
                this.dragOverlay.classList.add('dropping');
                setTimeout(() => {
                    this.hideDragOverlay();
                }, 600);
            }

            if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                this.handleDrop(e.dataTransfer.files);
            }
        });

        console.log('[FileAttachment] Drag and drop initialized');
    }

    createDragOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'drag-drop-overlay';
        overlay.innerHTML = `
            <div class="drag-drop-background-effect"></div>
            <canvas class="drag-drop-particles" width="800" height="600"></canvas>
            <div class="drag-drop-overlay-content">
                <div class="drag-drop-orbital-system">
                    <div class="drag-drop-orbit-ring orbit-1"></div>
                    <div class="drag-drop-orbit-ring orbit-2"></div>
                    <div class="drag-drop-orbit-ring orbit-3"></div>
                    <div class="drag-drop-core">
                        <div class="drag-drop-core-glow"></div>
                        <div class="drag-drop-icon-container">
                            <i class="fas fa-cloud-upload-alt drag-drop-icon"></i>
                            <div class="drag-drop-icon-pulse"></div>
                        </div>
                    </div>
                </div>
                <div class="drag-drop-text-container">
                    <div class="drag-drop-text-primary">
                        <span class="text-word">Release</span>
                        <span class="text-word">to</span>
                        <span class="text-word">Upload</span>
                    </div>
                    <div class="drag-drop-text-secondary">
                        <span class="file-type-indicator">
                            <i class="fas fa-file-alt"></i>
                            <i class="fas fa-file-image"></i>
                            <i class="fas fa-file-code"></i>
                            <i class="fas fa-file-pdf"></i>
                        </span>
                        <span class="supported-text">All file types supported</span>
                    </div>
                </div>
                <div class="drag-drop-progress-ring">
                    <svg viewBox="0 0 100 100">
                        <circle class="progress-bg" cx="50" cy="50" r="45"></circle>
                        <circle class="progress-fill" cx="50" cy="50" r="45"></circle>
                    </svg>
                </div>
            </div>
            <div class="drag-drop-success-burst">
                <div class="success-icon">
                    <i class="fas fa-check"></i>
                </div>
            </div>
        `;
        // Append to the chat container so it overlays the chat area
        const chatContainer = document.getElementById('chat-container') || document.body;
        chatContainer.appendChild(overlay);
        
        // Initialize particle system
        this.initParticleSystem(overlay);
        
        // Track mouse movement for magnetic effect
        this.setupMagneticTracking(overlay);
        
        return overlay;
    }

    showDragOverlay() {
        if (this.dragOverlay) {
            this.dragOverlay.classList.add('visible');
            this.dragOverlay.classList.remove('dropping');
            // Start particle animation
            if (this.particleAnimation) {
                this.particleAnimation.active = true;
            }
        }
    }

    hideDragOverlay() {
        if (this.dragOverlay) {
            this.dragOverlay.classList.remove('visible');
            // Stop particle animation
            if (this.particleAnimation) {
                this.particleAnimation.active = false;
            }
        }
    }
    
    initParticleSystem(overlay) {
        const canvas = overlay.querySelector('.drag-drop-particles');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const particles = [];
        const particleCount = 40;
        
        // Resize canvas to match overlay
        const resizeCanvas = () => {
            canvas.width = overlay.offsetWidth;
            canvas.height = overlay.offsetHeight;
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        
        // Create particles
        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                opacity: Math.random() * 0.5 + 0.2,
                pulsePhase: Math.random() * Math.PI * 2
            });
        }
        
        // Animation loop
        const animate = () => {
            if (!this.particleAnimation?.active) {
                requestAnimationFrame(animate);
                return;
            }
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            particles.forEach((p, i) => {
                // Update position
                p.x += p.vx;
                p.y += p.vy;
                
                // Wrap around edges
                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = 0;
                
                // Pulse effect
                p.pulsePhase += 0.02;
                const pulse = Math.sin(p.pulsePhase) * 0.3 + 0.7;
                
                // Draw particle
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius * pulse, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(40, 40, 40, ${p.opacity * pulse})`;
                ctx.fill();
                
                // Draw connections to nearby particles
                particles.slice(i + 1).forEach(p2 => {
                    const dx = p2.x - p.x;
                    const dy = p2.y - p.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.strokeStyle = `rgba(254, 249, 195, ${(1 - dist / 120) * 0.2})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                });
            });
            
            requestAnimationFrame(animate);
        };
        
        this.particleAnimation = { active: false };
        animate();
    }
    
    setupMagneticTracking(overlay) {
        const content = overlay.querySelector('.drag-drop-overlay-content');
        if (!content) return;
        
        overlay.addEventListener('dragover', (e) => {
            const rect = overlay.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // Calculate offset from center
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const offsetX = (x - centerX) / centerX;
            const offsetY = (y - centerY) / centerY;
            
            // Apply subtle magnetic pull effect
            const maxOffset = 15;
            content.style.transform = `translate(${offsetX * maxOffset}px, ${offsetY * maxOffset}px)`;
        });
        
        overlay.addEventListener('dragleave', () => {
            content.style.transform = 'translate(0, 0)';
        });
    }

    async handleDrop(fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;

        console.log(`[FileAttachment] Dropped ${files.length} file(s)`);

        // Create a fake event-like object compatible with handleFileSelection
        const fakeEvent = {
            target: {
                files: files
            }
        };

        await this.handleFileSelection(fakeEvent);
    }

    async uploadFileToSupabase(file) {
        const session = await window.electron.auth.getSession();
        if (!session || !session.access_token) {
            throw new Error("User not authenticated. Please log in again.");
        }

        // --- FIX #1: Use the correct, new backend URL ---
        const response = await fetch('https://api.pawsitivestrides.store/api/generate-upload-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ fileName: file.name })
        });
        // --- END FIX #1 ---

        if (!response.ok) {
            // It's possible the response is not JSON on failure, so handle that gracefully.
            let errorMsg = 'Could not get an upload URL from the server.';
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch (e) {
                errorMsg = `${errorMsg} (Status: ${response.status})`;
            }
            throw new Error(errorMsg);
        }

        const responseData = await response.json();
        const signedURL = responseData.signedURL;
        const path = responseData.path;

        if (!signedURL) {
            throw new Error('The server did not return a valid signed URL.');
        }

        const uploadResponse = await fetch(signedURL, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error("Supabase upload error:", errorText);
            throw new Error('File upload to cloud storage failed.');
        }

        return path;
    }

    async handleFileSelection(event) {
        const files = Array.from(event.target.files);
        if (files.length + this.attachedFiles.length > 50) {
            alert("You can attach a maximum of 50 files.");
            return;
        }

        for (const file of files) {
            if (file.size > this.maxFileSize) {
                alert(`File too large: ${file.name} (max size: ${Math.round(this.maxFileSize / 1024 / 1024)}MB)`);
                continue;
            }

            const extension = file.name.split('.').pop().toLowerCase();
            const isSupported = this.supportedFileTypes[extension] || file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/') || file.type === 'application/pdf';

            // For drag-and-drop, be more lenient — allow any file that looks like text
            const looksLikeText = !isSupported && file.type.startsWith('text/');
            if (!isSupported && !looksLikeText) {
                alert(`File type not supported: ${file.name}`);
                continue;
            }

            const fileIndex = this.attachedFiles.length;
            // Use mediaExtensions set for accurate categorization
            const isMedia = this.mediaExtensions.has(extension) || 
                (!this.supportedFileTypes[extension] && (
                    file.type.startsWith('image/') || file.type.startsWith('audio/') || 
                    file.type.startsWith('video/') || file.type === 'application/pdf' || 
                    file.type.includes('document')
                ));
            const normalizedType =
                (file.type && String(file.type).trim()) ||
                this.supportedFileTypes[extension] ||
                (isMedia ? 'application/octet-stream' : 'text/plain');

            // Generate unique file ID for tracking
            const fileId = crypto.randomUUID();

            // Create placeholder with 'archiving' status
            const placeholderFileObject = {
                file_id: fileId,
                name: file.name,
                type: normalizedType,
                size: file.size,
                previewUrl: URL.createObjectURL(file),
                status: 'archiving', // New status for dual-action
                isMedia: isMedia,
                isText: !isMedia,
                relativePath: null,
                path: null // Supabase path
            };

            this.attachedFiles.push(placeholderFileObject);
            this.renderFilePreview();

            try {
                // STEP 1: Save to local archive (always, for all files)
                console.log(`[FileArchive] Saving ${file.name} to local archive...`);
                const archiveResult = await window.electron.fileArchive.saveFile(file);
                this.attachedFiles[fileIndex].relativePath = archiveResult.relativePath;
                console.log(`[FileArchive] Saved to: ${archiveResult.relativePath}`);

                // STEP 2: Handle file-type specific processing
                if (isMedia) {
                    // Media files: Upload to Supabase
                    this.attachedFiles[fileIndex].status = 'uploading';
                    this.renderFilePreview();
                    
                    const filePathInBucket = await this.uploadFileToSupabase(file);
                    this.attachedFiles[fileIndex].path = filePathInBucket;
                    this.attachedFiles[fileIndex].status = 'completed';
                } else {
                    // Text files: Read content
                    this.attachedFiles[fileIndex].status = 'reading';
                    this.renderFilePreview();
                    
                    const fileContent = await this.readFileAsText(file);
                    this.attachedFiles[fileIndex].content = fileContent;
                    this.attachedFiles[fileIndex].status = 'completed';
                }

                console.log(`[FileArchive] File processing completed for ${file.name}`);
            } catch (error) {
                console.error(`[FileArchive] Error processing file ${file.name}:`, error);
                alert(`Failed to process ${file.name}: ${error.message}`);
                this.attachedFiles[fileIndex].status = 'failed';
            }

            this.renderFilePreview();
        }
        this.fileInput.value = '';
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = (error) => reject(error);
            reader.readAsText(file);
        });
    }

    getFileIcon(fileName) {
        const extension = fileName.split('.').pop().toLowerCase();
        const iconMap = {
            // JavaScript / TypeScript
            'js': 'fab fa-js', 'jsx': 'fab fa-react', 'ts': 'fas fa-code', 'tsx': 'fab fa-react',
            // Python
            'py': 'fab fa-python',
            // Web
            'html': 'fab fa-html5', 'htm': 'fab fa-html5',
            'css': 'fab fa-css3', 'scss': 'fab fa-sass', 'sass': 'fab fa-sass', 'less': 'fab fa-less',
            'vue': 'fab fa-vuejs', 'svelte': 'fas fa-fire',
            // Data / Config
            'json': 'fas fa-code', 'jsonl': 'fas fa-code',
            'xml': 'fas fa-code', 'yaml': 'fas fa-cog', 'yml': 'fas fa-cog',
            'toml': 'fas fa-cog', 'ini': 'fas fa-cog', 'cfg': 'fas fa-cog',
            'conf': 'fas fa-cog', 'env': 'fas fa-key', 'properties': 'fas fa-cog',
            'csv': 'fas fa-table', 'tsv': 'fas fa-table',
            // Programming languages
            'c': 'fas fa-file-code', 'cpp': 'fas fa-file-code', 'h': 'fas fa-file-code', 'hpp': 'fas fa-file-code',
            'java': 'fab fa-java', 'kt': 'fas fa-file-code', 'kts': 'fas fa-file-code',
            'swift': 'fab fa-swift', 'dart': 'fas fa-bullseye',
            'go': 'fas fa-file-code', 'rs': 'fas fa-file-code', 'rb': 'fas fa-gem',
            'php': 'fab fa-php', 'lua': 'fas fa-moon', 'pl': 'fas fa-file-code',
            'r': 'fas fa-chart-line', 'R': 'fas fa-chart-line', 'scala': 'fas fa-file-code',
            // Shell
            'sh': 'fas fa-terminal', 'bash': 'fas fa-terminal', 'zsh': 'fas fa-terminal',
            'bat': 'fas fa-terminal', 'ps1': 'fas fa-terminal', 'cmd': 'fas fa-terminal',
            // Documentation
            'txt': 'fas fa-file-alt', 'md': 'fab fa-markdown', 'mdx': 'fab fa-markdown', 'rst': 'fas fa-file-alt',
            'log': 'fas fa-file-alt', 'diff': 'fas fa-file-alt', 'patch': 'fas fa-file-alt',
            // Database / query
            'sql': 'fas fa-database', 'graphql': 'fas fa-project-diagram', 'gql': 'fas fa-project-diagram',
            // DevOps
            'dockerfile': 'fab fa-docker', 'makefile': 'fas fa-cogs',
            'tf': 'fas fa-cloud', 'hcl': 'fas fa-cloud',
            'proto': 'fas fa-file-code',
            // Documents (binary)
            'pdf': 'fas fa-file-pdf',
            'docx': 'fas fa-file-word', 'doc': 'fas fa-file-word',
            'xlsx': 'fas fa-file-excel', 'xls': 'fas fa-file-excel',
            'pptx': 'fas fa-file-powerpoint', 'ppt': 'fas fa-file-powerpoint',
            // Images
            'jpg': 'fas fa-file-image', 'jpeg': 'fas fa-file-image', 'png': 'fas fa-file-image',
            'gif': 'fas fa-file-image', 'svg': 'fas fa-file-image', 'webp': 'fas fa-file-image',
            'bmp': 'fas fa-file-image', 'ico': 'fas fa-file-image', 'tiff': 'fas fa-file-image', 'tif': 'fas fa-file-image',
            // Audio
            'mp3': 'fas fa-file-audio', 'wav': 'fas fa-file-audio', 'ogg': 'fas fa-file-audio',
            'm4a': 'fas fa-file-audio', 'flac': 'fas fa-file-audio', 'aac': 'fas fa-file-audio',
            // Video
            'mp4': 'fas fa-file-video', 'webm': 'fas fa-file-video', 'avi': 'fas fa-file-video',
            'mov': 'fas fa-file-video', 'mkv': 'fas fa-file-video',
            // Archives
            'zip': 'fas fa-file-archive', 'tar': 'fas fa-file-archive', 'gz': 'fas fa-file-archive',
            'rar': 'fas fa-file-archive', '7z': 'fas fa-file-archive'
        };
        return iconMap[extension] || 'fas fa-file';
    }

    createFileChip(file, index) {
        const chip = document.createElement('div');
        chip.className = `file-chip ${file.status}`;

        const icon = document.createElement('i');
        icon.className = `${this.getFileIcon(file.name)} file-chip-icon`;

        const name = document.createElement('span');
        name.className = 'file-chip-name';
        
        // For uploading/reading files, show status in the name
        if (file.status === 'reading' || file.status === 'uploading') {
            name.innerHTML = `<span class="upload-status-text">${file.status === 'uploading' ? 'Uploading' : 'Reading'} ${file.name}</span>`;
        } else {
            name.textContent = file.name;
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'file-chip-remove';
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.title = 'Remove file';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeFile(index);
        });

        chip.appendChild(icon);
        chip.appendChild(name);
        chip.appendChild(removeBtn);

        chip.addEventListener('click', () => {
            this.showFilePreview(file, index);
        });

        this.contextFilesContent.appendChild(chip);
    }

    updateContextFilesBar() {
        const hasFiles = this.attachedFiles.length > 0;
        const hasSessions = window.contextHandler && window.contextHandler.getSelectedSessions().length > 0;
        const hasContent = hasFiles || hasSessions;

        if (hasContent) {
            this.contextFilesBar.classList.remove('hidden');
            this.inputContainer.classList.add('has-files');
            this.sidebar.classList.add('hidden');
        } else {
            this.contextFilesBar.classList.add('hidden');
            this.inputContainer.classList.remove('has-files');
            this.sidebar.classList.add('hidden');
        }

        const fileChips = this.contextFilesContent.querySelectorAll('.file-chip');
        fileChips.forEach(chip => chip.remove());
    }

    onContextChange() {
        this.updateContextFilesBar();
    }

    renderFilePreview() {
        this.previewContent.innerHTML = '';
        this.fileCount.textContent = this.attachedFiles.length;

        this.updateContextFilesBar();

        this.attachedFiles.forEach((file, index) => {
            this.createFileChip(file, index);
        });

        this.attachedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = `file-preview-item ${file.status}`;

            const headerItem = document.createElement('div');
            headerItem.className = 'file-preview-header-item';

            const fileInfo = document.createElement('div');
            fileInfo.className = 'file-info';
            let fileName = '';
            let statusIcon = '';
            
            if (file.status === 'uploading' || file.status === 'reading') {
                const statusText = file.status === 'uploading' ? 'Uploading' : 'Reading';
                fileName = `<span class="upload-status-text">${statusText} ${file.name}</span>`;
            } else {
                fileName = file.name;
                if (file.status === 'failed') {
                    statusIcon = '<i class="fas fa-exclamation-circle status-icon-failed"></i>';
                }
            }
            
            fileInfo.innerHTML = `
                <i class="${this.getFileIcon(file.name)} file-icon"></i>
                <span class="file-name">${fileName}</span>
                ${statusIcon}
            `;

            const actions = document.createElement('div');
            actions.className = 'file-actions';
            actions.innerHTML = `
                <button class="preview-toggle" title="Toggle Preview"><i class="fas fa-eye"></i></button>
                <button class="remove-file" title="Remove File"><i class="fas fa-times"></i></button>
            `;

            headerItem.appendChild(fileInfo);
            headerItem.appendChild(actions);
            fileItem.appendChild(headerItem);

            const contentItem = document.createElement('div');
            contentItem.className = 'file-preview-content-item';

            if (file.isMedia && file.previewUrl) {
                if (file.type.startsWith('image/')) {
                    contentItem.innerHTML = `<img src="${file.previewUrl}" alt="${file.name}" class="media-preview">`;
                } else if (file.type.startsWith('audio/')) {
                    contentItem.innerHTML = `<audio controls class="media-preview"><source src="${file.previewUrl}" type="${file.type}"></audio>`;
                } else if (file.type.startsWith('video/')) {
                    contentItem.innerHTML = `<video controls class="media-preview"><source src="${file.previewUrl}" type="${file.type}"></video>`;
                } else if (file.type === 'application/pdf') {
                    contentItem.innerHTML = `<iframe src="${file.previewUrl}" class="pdf-preview"></iframe>`;
                } else {
                    contentItem.innerHTML = `<div class="doc-preview">Preview not available for this document type.</div>`;
                }
            } else if (file.content) {
                contentItem.innerHTML = `<pre>${file.content}</pre>`;
            } else {
                contentItem.innerHTML = `<p>Awaiting upload...</p>`;
            }

            fileItem.appendChild(contentItem);

            actions.querySelector('.preview-toggle').addEventListener('click', (e) => {
                e.stopPropagation();
                contentItem.classList.toggle('visible');
                const icon = e.target.closest('button').querySelector('i');
                icon.classList.toggle('fa-eye');
                icon.classList.toggle('fa-eye-slash');
            });
            actions.querySelector('.remove-file').addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeFile(index);
            });

            this.previewContent.appendChild(fileItem);
        });
    }

    toggleSidebar(show) {
        if (show === false || (show === undefined && !this.sidebar.classList.contains('hidden'))) {
            this.sidebar.classList.add('hidden');
        } else if (show === true || (show === undefined && this.sidebar.classList.contains('hidden'))) {
            if (this.attachedFiles.length > 0) {
                this.sidebar.classList.remove('hidden');
            }
        }
    }

    removeFile(index) {
        if (this.attachedFiles[index] && this.attachedFiles[index].previewUrl) {
            URL.revokeObjectURL(this.attachedFiles[index].previewUrl);
        }
        
        this.attachedFiles.splice(index, 1);
        this.renderFilePreview();
    }

    getAttachedFiles() {
        return this.attachedFiles.filter(file => file.status === 'completed');
    }

    clearAttachedFiles() {
        this.attachedFiles.forEach(file => {
            if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        });
        
        this.attachedFiles = [];
        this.renderFilePreview();
    }

    updateInputPositioning() {
        const hasMessages = hasRenderableMessages();

        if (hasMessages) {
            this.inputContainer.classList.remove('centered');
        } else {
            this.inputContainer.classList.add('centered');
        }
    }

    showFilePreview(file, index) {
        const existingModal = document.querySelector('.file-preview-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'file-preview-modal';
        
        const previewContent = this.generateFilePreview(file);
        
        modal.innerHTML = `
            <div class="file-preview-modal-backdrop"></div>
            <div class="file-preview-modal-content">
                <div class="file-preview-modal-header">
                    <div class="file-info">
                        <i class="${this.getFileIcon(file.name)} file-icon"></i>
                        <div class="file-details">
                            <h3 class="file-name">${file.name}</h3>
                            <span class="file-meta">${this.formatFileSize(file.size || 0)} • ${file.type || 'Unknown'}</span>
                        </div>
                    </div>
                    <button class="close-preview-modal">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="file-preview-modal-body">
                    <div class="file-content-preview">
                        ${previewContent}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('.close-preview-modal');
        const backdrop = modal.querySelector('.file-preview-modal-backdrop');
        
        const closeModal = () => {
            modal.classList.add('closing');
            setTimeout(() => modal.remove(), 200);
        };

        closeBtn.addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);
        
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        setTimeout(() => {
            modal.classList.add('visible');
        }, 10);
    }

    generateFilePreview(file) {
        if (file.isText && file.content) {
            return `<div class="text-file-preview"><pre class="file-text-content">${this.escapeHtml(file.content)}</pre></div>`;
        } else if (file.isText && !file.content) {
            const statusText = file.status === 'uploading' ? 'Uploading' : 'Reading';
            return `<div class="text-file-preview"><div class="loading-content"><i class="fas fa-file-alt"></i><span class="upload-status-text">${statusText} file content...</span></div></div>`;
        } else if (file.previewUrl && file.type.startsWith('image/')) {
            return `<div class="image-file-preview"><img src="${file.previewUrl}" alt="${file.name}" class="preview-image" /></div>`;
        } else if (file.isMedia) {
            const statusText = file.status === 'uploading' ? 'Uploading' : file.status === 'reading' ? 'Reading' : file.status;
            if (file.status === 'uploading' || file.status === 'reading') {
                return `<div class="media-file-preview"><div class="loading-content"><i class="fas fa-file-alt"></i><span class="upload-status-text">${statusText} media file...</span></div></div>`;
            } else {
                return `<div class="media-file-preview"><div class="media-placeholder"><i class="fas fa-file-alt"></i><p>Media file preview</p><p class="file-status">Status: ${file.status}</p></div></div>`;
            }
        } else {
            return `<div class="binary-file-preview"><div class="binary-placeholder"><i class="fas fa-file"></i><p>Binary file - preview not available</p><p class="file-info">Size: ${this.formatFileSize(file.size || 0)}</p><p class="debug-info">Type: ${file.type}, isText: ${file.isText}, hasContent: ${!!file.content}</p></div></div>`;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    onConversationStateChange() {
        this.updateInputPositioning();
    }
}

function getActiveConversationContainer() {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) {
        return null;
    }

    return (
        chatMessages.querySelector('.conversation-thread.active:not(.hidden)') ||
        chatMessages.querySelector('.conversation-thread:not(.hidden)') ||
        chatMessages
    );
}

function hasRenderableMessages() {
    const activeContainer = getActiveConversationContainer();
    return Boolean(activeContainer?.querySelector('.message'));
}

window.conversationStateManager = {
    hasMessages: false,
    fileHandler: null,

    setFileHandler(handler) { this.fileHandler = handler; },
    onMessageAdded() { this.hasMessages = true; this.updateInputPositioning(); },
    onConversationCleared() { this.hasMessages = false; this.updateInputPositioning(); },
    updateInputPositioning() {
        const inputContainer = document.getElementById('floating-input-container');
        if (!inputContainer) return;
        if (this.hasMessages) {
            inputContainer.classList.remove('centered');
        } else {
            inputContainer.classList.add('centered');
        }
        if (this.fileHandler) {
            this.fileHandler.updateInputPositioning();
        }
    },
    init() {
        const chatMessages = document.getElementById('chat-messages');
        this.hasMessages = hasRenderableMessages();
        this.updateInputPositioning();
        if (chatMessages) {
            const observer = new MutationObserver(() => {
                const hasMessages = hasRenderableMessages();
                if (hasMessages !== this.hasMessages) {
                    this.hasMessages = hasMessages;
                    this.updateInputPositioning();
                }
            });
            observer.observe(chatMessages, { childList: true });
        }
    }
};

export default FileAttachmentHandler;
