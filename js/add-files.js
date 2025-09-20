// add-files.js (Final, Definitive Version with Path-based Logic)

class FileAttachmentHandler {
    constructor(socket, supportedFileTypes, maxFileSize) {
        this.supportedFileTypes = supportedFileTypes || {
            // Text files
            'txt': 'text/plain', 'js': 'text/javascript', 'py': 'text/x-python', 'html': 'text/html',
            'css': 'text/css', 'json': 'application/json', 'c': 'text/x-c',
            // Media and Document files
            'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif',
            'svg': 'image/svg+xml', 'webp': 'image/webp', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
            'ogg': 'audio/ogg', 'm4a': 'audio/mp4', 'mp4': 'video/mp4', 'webm': 'video/webm',
            'avi': 'video/x-msvideo', 'mov': 'video/quicktime', 'mkv': 'video/x-matroska'
        };
        this.maxFileSize = maxFileSize || 50 * 1024 * 1024; // 10MB default
        this.attachedFiles = [];
        this.initialize();
    }

    initialize() {
        this.attachButton = document.getElementById('attach-file-btn');
        this.fileInput = document.getElementById('file-input');
        this.inputContainer = document.getElementById('floating-input-container');
        this.filesBar = document.getElementById('attached-files-bar');
        this.filesContent = this.filesBar.querySelector('.attached-files-content');

        // Legacy sidebar elements (keep for compatibility)
        this.sidebar = document.getElementById('file-preview-sidebar');
        this.previewContent = this.sidebar.querySelector('.file-preview-content');
        this.fileCount = this.sidebar.querySelector('.file-count');

        // Ensure sidebar starts hidden and files bar starts hidden
        this.sidebar.classList.add('hidden');
        this.filesBar.classList.add('hidden');

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

        // Initialize conversation state manager
        if (window.conversationStateManager) {
            window.conversationStateManager.setFileHandler(this);
            window.conversationStateManager.init();
        }

        // Initial positioning update
        this.updateInputPositioning();
    }

    async uploadFileToSupabase(file) {
        const session = await window.electron.auth.getSession();
        if (!session || !session.access_token) {
            throw new Error("User not authenticated. Please log in again.");
        }

        const response = await fetch('https://ai-os-yjbb.onrender.com/api/generate-upload-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ fileName: file.name })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Could not get an upload URL from the server.');
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

        // --- FIX ---
        // Return the path, not a public URL. The backend will use this path to securely download the content.
        return path;
        // --- END FIX ---
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

            if (!isSupported) {
                alert(`File type not supported: ${file.name}`);
                continue;
            }

            const fileIndex = this.attachedFiles.length;
            const isMedia = file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/') || file.type === 'application/pdf' || file.type.includes('document');

            const placeholderFileObject = {
                name: file.name,
                type: file.type,
                previewUrl: URL.createObjectURL(file),
                status: isMedia ? 'uploading' : 'completed',
                isMedia: isMedia,
                isText: !isMedia,
            };

            this.attachedFiles.push(placeholderFileObject);
            this.renderFilePreview();

            if (isMedia) {
                try {
                    // This now returns the path of the file in the bucket.
                    const filePathInBucket = await this.uploadFileToSupabase(file);

                    // --- FIX ---
                    // Store the path in the file object. This is what the backend needs.
                    this.attachedFiles[fileIndex].path = filePathInBucket;
                    // --- END FIX ---

                    this.attachedFiles[fileIndex].status = 'completed';

                } catch (error) {
                    console.error('Upload failed:', error);
                    alert(`Upload failed for ${file.name}: ${error.message}`);
                    this.attachedFiles[fileIndex].status = 'failed';
                }
            } else {
                try {
                    this.attachedFiles[fileIndex].content = await this.readFileAsText(file);
                } catch (error) {
                    console.error('Error reading text file:', error);
                    this.attachedFiles[fileIndex].status = 'failed';
                }
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
            'js': 'fab fa-js', 'py': 'fab fa-python', 'html': 'fab fa-html5', 'css': 'fab fa-css3',
            'json': 'fas fa-code', 'txt': 'fas fa-file-alt', 'pdf': 'fas fa-file-pdf',
            'docx': 'fas fa-file-word', 'c': 'fas fa-file-code', 'jpg': 'fas fa-file-image',
            'jpeg': 'fas fa-file-image', 'png': 'fas fa-file-image', 'gif': 'fas fa-file-image',
            'svg': 'fas fa-file-image', 'webp': 'fas fa-file-image', 'mp3': 'fas fa-file-audio',
            'wav': 'fas fa-file-audio', 'ogg': 'fas fa-file-audio', 'm4a': 'fas fa-file-audio',
            'mp4': 'fas fa-file-video', 'webm': 'fas fa-file-video', 'avi': 'fas fa-file-video',
            'mov': 'fas fa-file-video', 'mkv': 'fas fa-file-video'
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
        name.textContent = file.name;

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

        // Add click handler for file preview (optional)
        chip.addEventListener('click', () => {
            // Could open a preview modal or show file details
            console.log('File clicked:', file.name);
        });

        this.filesContent.appendChild(chip);
    }

    renderFilePreview() {
        // Clear both old sidebar and new horizontal bar
        this.previewContent.innerHTML = '';
        this.filesContent.innerHTML = '';
        this.fileCount.textContent = this.attachedFiles.length;

        // Show/hide elements based on file count
        if (this.attachedFiles.length > 0) {
            this.filesBar.classList.remove('hidden');
            this.inputContainer.classList.add('has-files');
            this.sidebar.classList.add('hidden'); // Keep sidebar hidden, use horizontal bar
        } else {
            this.filesBar.classList.add('hidden');
            this.inputContainer.classList.remove('has-files');
            this.sidebar.classList.add('hidden');
        }

        // Render file chips in horizontal bar
        this.attachedFiles.forEach((file, index) => {
            this.createFileChip(file, index);
        });

        // Also render in sidebar for legacy compatibility
        this.attachedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-preview-item';

            const headerItem = document.createElement('div');
            headerItem.className = 'file-preview-header-item';

            const fileInfo = document.createElement('div');
            fileInfo.className = 'file-info';
            let statusIcon = '';
            if (file.status === 'uploading') {
                statusIcon = '<i class="fas fa-spinner fa-spin status-icon"></i>';
            } else if (file.status === 'failed') {
                statusIcon = '<i class="fas fa-exclamation-circle status-icon-failed"></i>';
            }
            fileInfo.innerHTML = `
                <i class="${this.getFileIcon(file.name)} file-icon"></i>
                <span class="file-name">${file.name}</span>
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

    // Method to update input positioning based on conversation state
    updateInputPositioning() {
        const chatMessages = document.getElementById('chat-messages');
        const hasMessages = chatMessages && chatMessages.children.length > 0;

        if (hasMessages) {
            this.inputContainer.classList.remove('centered');
        } else {
            this.inputContainer.classList.add('centered');
        }
    }

    // Call this method when messages are added/removed
    onConversationStateChange() {
        this.updateInputPositioning();
    }
}

// Global conversation state manager
window.conversationStateManager = {
    hasMessages: false,
    fileHandler: null,

    setFileHandler(handler) {
        this.fileHandler = handler;
    },

    onMessageAdded() {
        this.hasMessages = true;
        this.updateInputPositioning();
    },

    onConversationCleared() {
        this.hasMessages = false;
        this.updateInputPositioning();
    },

    updateInputPositioning() {
        const inputContainer = document.getElementById('floating-input-container');
        if (!inputContainer) return;

        if (this.hasMessages) {
            inputContainer.classList.remove('centered');
        } else {
            inputContainer.classList.add('centered');
        }

        // Also update file handler if available
        if (this.fileHandler) {
            this.fileHandler.updateInputPositioning();
        }
    },

    // Initialize on page load
    init() {
        // Check if there are existing messages
        const chatMessages = document.getElementById('chat-messages');
        this.hasMessages = chatMessages && chatMessages.children.length > 0;
        this.updateInputPositioning();

        // Set up mutation observer to watch for message changes
        if (chatMessages) {
            const observer = new MutationObserver(() => {
                const hasMessages = chatMessages.children.length > 0;
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