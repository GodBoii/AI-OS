// artifact-handler.js (Final, Race-Condition-Proof Version)

import { mergePresentationMetadata } from './presentation-metadata.mjs';

class ArtifactHandler {
    constructor() {
        this.artifacts = new Map();
        this.pendingMedia = new Map();
        this.currentId = 0;
        this.browserArtifactId = 'browser_view_artifact';
        this.currentViewMode = 'preview';
        this.backendBaseUrl = 'https://api.aetheriaai.website';
        this.deployInProgress = false;
        this.deployTargetsByConversation = new Map();
        // Track workspace state before hiding for overlays
        this.workspaceStateBeforeOverlay = {
            projectWorkspaceWasOpen: false,
            computerWorkspaceWasOpen: false,
            hiddenBy: null // 'artifact' or 'aios'
        };
        this.init();
    }

    init() {
        const container = document.createElement('div');
        container.id = 'artifact-container';
        container.className = 'artifact-container hidden';
        container.inert = true;
        
        container.innerHTML = `
            <section class="artifact-window" role="region" aria-label="Artifact viewer">
                <div class="artifact-header">
                    <div class="artifact-heading"><span class="artifact-kind">Artifact</span><div class="artifact-title">Artifact viewer</div></div>
                    <div class="artifact-controls">
                        <div class="artifact-view-toggle t-tabs hidden" role="group" aria-label="View mode">
                            <span class="t-tabs-pill" aria-hidden="true"></span>
                            <button type="button" class="view-toggle-btn active" data-view="preview" aria-pressed="true" title="Preview mode">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button type="button" class="view-toggle-btn" data-view="source" aria-pressed="false" title="Source mode">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                            </button>
                        </div>
                        <button class="copy-artifact-btn" title="Copy to Clipboard">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button class="download-artifact-btn" title="Download">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        </button>
                        <button type="button" class="expand-artifact-btn" aria-label="Expand viewer" aria-pressed="false" title="Expand viewer">
                            <span class="artifact-icon"><span class="t-icon-swap" data-state="a" aria-hidden="true">
                                <span class="t-icon" data-icon="a"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></span>
                                <span class="t-icon" data-icon="b"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"/></svg></span>
                            </span></span><span class="artifact-expand-label">Expand</span>
                        </button>
                        <button class="close-artifact-btn" aria-label="Close viewer" title="Close viewer">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>
                <div class="artifact-content"></div>
            </section>
        `;
        
        document.body.appendChild(container);
        const backdrop = document.createElement('div');
        backdrop.className = 'artifact-focus-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.addEventListener('click', () => this.setExpanded(false));
        container.before(backdrop);
        this.artifactBackdrop = backdrop;
        this.setupDeployPreviewModal();
        
        container.querySelector('.close-artifact-btn').addEventListener('click', () => this.hideArtifact());
        container.querySelector('.copy-artifact-btn').addEventListener('click', () => this.copyArtifactContent());
        container.querySelector('.download-artifact-btn').addEventListener('click', () => this.downloadArtifact());
        container.querySelector('.copy-artifact-btn').setAttribute('aria-label', 'Copy source');
        container.querySelector('.download-artifact-btn').setAttribute('aria-label', 'Download artifact');
        container.querySelector('.expand-artifact-btn').addEventListener('click', () => this.setExpanded(!container.classList.contains('artifact-expanded')));
        container.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !document.querySelector('#deploy-preview-modal:not(.hidden)')) {
                event.preventDefault();
                if (container.classList.contains('artifact-expanded')) this.setExpanded(false);
                else this.hideArtifact();
            }
            if (event.key === 'Tab' && container.classList.contains('artifact-expanded')) {
                const focusable = Array.from(container.querySelectorAll('button, a[href], input, textarea, select, iframe, [tabindex="0"]'))
                    .filter(element => !element.disabled && !element.closest('[inert]') && element.getClientRects().length);
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        });

        this.viewToggleContainer = container.querySelector('.artifact-view-toggle');
        this.viewToggleButtons = Array.from(this.viewToggleContainer.querySelectorAll('.view-toggle-btn'));
        this.viewToggleButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.view;
                this.setViewMode(mode);
            });
        });
        this.setupArtifactToolbar(container);
    }

    setupArtifactToolbar(container) {
        container.querySelectorAll('.artifact-controls button').forEach((button, index) => {
            const label = button.getAttribute('aria-label') || button.title;
            button.setAttribute('aria-label', label);
            button.removeAttribute('title');
            if (!button.querySelector('.artifact-icon')) {
                const icon = document.createElement('span');
                icon.className = 'artifact-icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.appendChild(button.querySelector('svg'));
                button.prepend(icon);
            }
            const wrap = document.createElement('span');
            wrap.className = 't-tt-wrap artifact-tool';
            const tooltip = document.createElement('span');
            tooltip.className = 't-tt';
            tooltip.id = `artifact-tool-${index}`;
            tooltip.setAttribute('role', 'tooltip');
            tooltip.textContent = label;
            button.classList.add('t-tt-trigger');
            button.setAttribute('aria-describedby', tooltip.id);
            button.before(wrap);
            wrap.append(button, tooltip);
            button.addEventListener('click', () => {
                wrap.classList.add('tooltip-dismissed');
                if (container.classList.contains('hidden') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                button.classList.remove('is-activating');
                void button.offsetWidth;
                button.classList.add('is-activating');
            });
            button.addEventListener('animationend', (event) => {
                if (event.animationName === 'artifact-icon-tap') button.classList.remove('is-activating');
            });
            wrap.addEventListener('pointerleave', () => wrap.classList.remove('tooltip-dismissed'));
            button.addEventListener('blur', () => wrap.classList.remove('tooltip-dismissed'));
        });
        const copy = container.querySelector('.copy-artifact-btn .artifact-icon');
        const original = copy.firstElementChild;
        const swap = document.createElement('span');
        swap.className = 't-icon-swap';
        swap.dataset.state = 'a';
        const normal = document.createElement('span');
        normal.className = 't-icon';
        normal.dataset.icon = 'a';
        normal.append(original);
        swap.append(normal);
        swap.insertAdjacentHTML('beforeend', '<span class="t-icon" data-icon="b"><svg class="artifact-copy-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg></span>');
        copy.append(swap);
    }

    setExpanded(expanded, animate = true) {
        const container = document.getElementById('artifact-container');
        if (container.classList.contains('artifact-expanded') === expanded) return;
        const before = container.getBoundingClientRect();
        this.artifactResizeAnimation?.cancel();
        container.classList.toggle('artifact-expanded', expanded);
        this.artifactBackdrop.classList.toggle('is-open', expanded);
        const viewer = container.querySelector('.artifact-window');
        viewer.setAttribute('role', expanded ? 'dialog' : 'region');
        if (expanded) viewer.setAttribute('aria-modal', 'true');
        else viewer.removeAttribute('aria-modal');
        const button = container.querySelector('.expand-artifact-btn');
        button.setAttribute('aria-pressed', String(expanded));
        button.setAttribute('aria-label', expanded ? 'Restore viewer size' : 'Expand viewer');
        button.querySelector('.t-icon-swap').dataset.state = expanded ? 'b' : 'a';
        button.querySelector('.artifact-expand-label').textContent = expanded ? 'Restore' : 'Expand';
        button.parentElement.querySelector('.t-tt').textContent = expanded ? 'Restore viewer size · Esc' : 'Expand viewer';
        if (expanded) {
            this.artifactInertElements = Array.from(document.querySelectorAll('.chat-container, .floating-input-container, .sidebar, .active-workspace-pill'))
                .map(element => [element, element.inert]);
            this.artifactInertElements.forEach(([element]) => { element.inert = true; });
        } else {
            this.artifactInertElements?.forEach(([element, inert]) => { element.inert = inert; });
            this.artifactInertElements = null;
        }
        if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const after = container.getBoundingClientRect();
            const styles = getComputedStyle(container);
            this.artifactResizeAnimation = container.animate([
                { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width}, ${before.height / after.height})` },
                { transform: 'none' }
            ], { duration: parseFloat(styles.getPropertyValue('--artifact-resize-duration')) || 300, easing: styles.getPropertyValue('--artifact-motion-ease').trim() || 'ease-out' });
        }
        button.focus({ preventScroll: true });
    }

    setupDeployPreviewModal() {
        const existingModal = document.getElementById('deploy-preview-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'deploy-preview-modal';
        modal.className = 'deploy-preview-modal hidden';
        modal.innerHTML = `
            <div class="deploy-preview-dialog" role="dialog" aria-modal="true" aria-label="Deploy Preview">
                <div class="deploy-preview-header">
                    <div class="deploy-preview-header-content">
                        <div class="deploy-preview-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path></svg>
                        </div>
                        <div class="deploy-preview-title-group">
                            <div class="deploy-preview-title">Deployment Preview</div>
                            <div class="deploy-preview-subtitle">Review files before deploying to production</div>
                        </div>
                    </div>
                    <button type="button" class="deploy-preview-close" aria-label="Close">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="deploy-preview-meta"></div>
                <div class="deploy-preview-tree"></div>
                <div class="deploy-preview-actions">
                    <button type="button" class="deploy-preview-cancel">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                        <span>Cancel</span>
                    </button>
                    <button type="button" class="deploy-preview-confirm">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path></svg>
                        <span>Deploy Now</span>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    cachePendingMedia(artifactId, media) {
        if (!artifactId || !media || !media.url) {
            console.error(`[HANDLER] Received incomplete media payload for artifact ${artifactId}`);
            return;
        }

        if (this.artifacts.has(artifactId)) {
            const artifact = this.artifacts.get(artifactId);
            
            if (artifact && artifact.isPending) {
                artifact.content = media.url;
                artifact.mimeType = media.mimeType || artifact.mimeType || null;
                artifact.isPending = false;
                this.showArtifact(media.type || artifact.type, media.url, artifactId, {
                    title: artifact.title,
                    mimeType: media.mimeType || artifact.mimeType || null
                });
                return;
            } else if (artifact && !artifact.isPending) {
                return;
            }
        }
        
        this.pendingMedia.set(artifactId, media);
    }

    cachePendingImage(artifactId, base64Data) {
        if (!base64Data || base64Data.length === 0) {
            console.error(`[HANDLER] Received empty base64 data for artifact ${artifactId}`);
            return;
        }
        this.cachePendingMedia(artifactId, {
            type: 'image',
            url: typeof base64Data === 'string' && base64Data.startsWith('data:')
                ? base64Data
                : `data:image/png;base64,${base64Data}`,
            mimeType: 'image/png'
        });
    }

    createArtifact(content, type, artifactId = null, options = {}) {
        if (type === 'image' || type === 'video') {
            const mediaId = content.trim();
            
            if (this.artifacts.has(mediaId)) {
                return mediaId;
            }

            if (this.pendingMedia.has(mediaId)) {
                const mediaPayload = this.pendingMedia.get(mediaId);
                this.artifacts.set(mediaId, {
                    content: mediaPayload.url,
                    type: mediaPayload.type || type,
                    mimeType: mediaPayload.mimeType || null,
                    isPending: false
                });
                this.pendingMedia.delete(mediaId);
                return mediaId;
            }

            this.artifacts.set(mediaId, {
                content: null,
                type,
                mimeType: options.mimeType || null,
                isPending: true
            });
            return mediaId;
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
        this.disposeArtifactView?.();
        this.disposeArtifactView = null;
        const container = document.getElementById('artifact-container');
        if (container.classList.contains('hidden')) this.artifactReturnFocus = document.activeElement;
        container.inert = false;
        container.querySelector('.artifact-kind').textContent = type === 'presentation' ? 'PowerPoint' : type === 'mermaid' ? 'Diagram' : type === 'image' ? 'Image' : type === 'video' ? 'Video' : type === 'browser_view' ? 'Browser' : (options.language || this.inferLanguageFromType(type));
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
                if (deployBtn) deployBtn.style.display = 'none';
                this.renderBrowserView(data);
                currentArtifactId = this.browserArtifactId;
                this.artifacts.set(currentArtifactId, { content: data, type });
                break;

            case 'image':
                if (typeof data === 'string' && !/^(data:image\/|https?:\/\/)/i.test(data)) {
                    data = `data:${options.mimeType || 'image/png'};base64,${data}`;
                }
                currentArtifactId = currentArtifactId || `image-artifact-${++this.currentId}`;
                this.artifacts.set(currentArtifactId, {
                    content: data,
                    type: 'image',
                    title: options.title || 'Generated image',
                    mimeType: options.mimeType || 'image/png',
                    isPending: data === null
                });
                if (data !== null) this.pendingMedia.delete(currentArtifactId);
                titleEl.textContent = options.title || 'Image Viewer';
                copyBtn.style.display = 'none';
                downloadBtn.style.display = 'inline-flex';
                if (deployBtn) deployBtn.style.display = 'none';
                if (data === null) {
                    contentDiv.innerHTML = '<div class="artifact-loading"><span>Loading image...</span></div>';
                } else {
                    this.renderImage(data, contentDiv);
                }
                break;

            case 'video':
                titleEl.textContent = options.title || 'Video Viewer';
                copyBtn.style.display = 'none';
                downloadBtn.style.display = 'inline-flex';
                if (deployBtn) deployBtn.style.display = 'none';
                if (data === null) {
                    contentDiv.innerHTML = '<div class="artifact-loading"><span>Loading video...</span></div>';
                } else {
                    this.renderVideo(data, contentDiv, options.mimeType || null);
                }
                break;

            case 'presentation':
                currentArtifactId = currentArtifactId || data?.artifact_id || data?.output_id || `presentation-${Date.now()}`;
                data = mergePresentationMetadata(this.artifacts.get(currentArtifactId)?.content, data);
                titleEl.textContent = options.title || data?.title || data?.filename || 'PowerPoint Deck';
                copyBtn.style.display = 'none';
                downloadBtn.style.display = 'inline-flex';
                if (deployBtn) deployBtn.style.display = 'none';
                this.renderPresentation(data, contentDiv);
                this.artifacts.set(currentArtifactId, {
                    content: data,
                    type: 'presentation',
                    title: options.title || data?.title || data?.filename || 'PowerPoint Deck',
                    mimeType: options.mimeType || data?.mime_type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                });
                break;

            case 'mermaid':
                titleEl.textContent = options.title || 'Diagram Viewer';
                copyBtn.style.display = 'inline-flex';
                downloadBtn.style.display = 'inline-flex';
                if (deployBtn) deployBtn.style.display = 'none';
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
                    this.artifacts.set(currentArtifactId, {
                        ...this.artifacts.get(currentArtifactId), content: data, type: 'mermaid',
                        language: 'mermaid', title: options.title || null, viewMode
                    });
                }
                break;

            default: // Handles code blocks
                titleEl.textContent = options.title || 'Code Viewer';
                copyBtn.style.display = 'inline-flex';
                downloadBtn.style.display = 'inline-flex';
                const language = options.language || this.inferLanguageFromType(type);
                if (deployBtn) deployBtn.style.display = 'none';
                const viewModeForCode = this.resolveInitialCodeViewMode(language, options.defaultView);
                const shouldShowToggle = this.supportsPreviewMode(language);
                if (shouldShowToggle && viewToggle) {
                    viewToggle.classList.remove('hidden');
                }
                this.currentViewMode = viewModeForCode;
                this.updateViewToggleButtons(viewModeForCode);
                this.renderTextArtifactView(data, language, contentDiv, viewModeForCode);
                if (!currentArtifactId) {
                    currentArtifactId = this.createArtifact(data, 'code', null, {
                        viewMode: viewModeForCode,
                        title: options.title || null,
                        language
                    });
                } else {
                    this.artifacts.set(currentArtifactId, {
                        ...this.artifacts.get(currentArtifactId), content: data, type: 'code',
                        title: options.title || this.artifacts.get(currentArtifactId)?.title || null,
                        language, viewMode: viewModeForCode
                    });
                }
                break;
        }
        
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        container.classList.remove('hidden');
        this.updateViewToggleButtons(this.currentViewMode, false);
        chatContainer.classList.add('with-artifact');
        inputContainer.classList.add('with-artifact');

        // Auto-hide workspace sidebars when artifact opens
        this.hideWorkspaceSidebarsForOverlay('artifact');

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
        if (!['preview', 'source'].includes(mode) || this.currentViewMode === mode) {
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
        this.disposeArtifactView?.();
        this.disposeArtifactView = null;
        contentDiv.innerHTML = '';
        if (artifact.type === 'mermaid') {
            this.renderMermaidView(artifact.content, contentDiv, mode);
        } else {
            this.renderTextArtifactView(artifact.content, artifact.language || 'plaintext', contentDiv, mode);
        }
    }

    updateViewToggleButtons(mode, animate = true) {
        if (!Array.isArray(this.viewToggleButtons)) {
            return;
        }

        this.viewToggleButtons.forEach((button) => {
            const isActive = button.dataset.view === mode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
        const active = this.viewToggleButtons.find(button => button.dataset.view === mode);
        const pill = this.viewToggleContainer.querySelector('.t-tabs-pill');
        if (active && pill && active.offsetWidth) {
            const transition = pill.style.transition;
            if (!animate) pill.style.transition = 'none';
            pill.style.transform = `translateX(${active.parentElement.offsetLeft}px)`;
            pill.style.width = `${active.offsetWidth}px`;
            if (!animate) {
                void pill.offsetWidth;
                pill.style.transition = transition;
            }
        }
    }

    renderBrowserView(data) {
        const contentDiv = document.querySelector('#artifact-container .artifact-content');
        let browserViewContainer = document.getElementById('browser-view-content');

        if (!browserViewContainer) {
            browserViewContainer = document.createElement('div');
            browserViewContainer.id = 'browser-view-content';
            browserViewContainer.innerHTML = `
                <div class="browser-view-header">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
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
        img.src = typeof base64Data === 'string' && /^(data:image\/|https?:\/\/)/i.test(base64Data)
            ? base64Data
            : `data:image/png;base64,${base64Data}`;
        img.alt = document.querySelector('#artifact-container .artifact-title').textContent;
        const stage = document.createElement('div');
        stage.className = 'artifact-image-stage';
        stage.tabIndex = 0;
        stage.setAttribute('aria-label', 'Image preview. Use plus and minus to zoom, zero to fit.');
        const toolbar = document.createElement('div');
        toolbar.className = 'artifact-local-toolbar';
        toolbar.innerHTML = '<span class="image-dimensions" role="status">Loading image…</span><div><button type="button" data-zoom="out" aria-label="Zoom out">−</button><button type="button" data-zoom="fit">Fit</button><button type="button" data-zoom="actual">100%</button><button type="button" data-zoom="in" aria-label="Zoom in">+</button></div>';
        container.append(toolbar, stage);
        stage.appendChild(img);
        let scale = null;
        const update = (action) => {
            const fitted = Math.min((stage.clientWidth - 32) / (img.naturalWidth || 1), (stage.clientHeight - 32) / (img.naturalHeight || 1), 1);
            scale = action === 'fit' ? null : action === 'actual' ? 1 : Math.min(4, Math.max(0.1, (scale ?? fitted) * (action === 'in' ? 1.25 : 0.8)));
            stage.classList.toggle('actual-size', scale !== null);
            img.style.width = scale === null ? '' : `${img.naturalWidth * scale}px`;
            img.style.maxWidth = scale === null ? '' : 'none';
            img.style.maxHeight = scale === null ? '' : 'none';
            toolbar.querySelector('[data-zoom="fit"]').setAttribute('aria-pressed', String(scale === null));
        };
        toolbar.addEventListener('click', (event) => {
            const action = event.target.closest('[data-zoom]')?.dataset.zoom;
            if (action) update(action);
        });
        stage.addEventListener('keydown', (event) => {
            const action = { '+': 'in', '=': 'in', '-': 'out', '0': 'fit' }[event.key];
            if (action) { event.preventDefault(); update(action); }
        });
        img.addEventListener('load', () => {
            toolbar.querySelector('.image-dimensions').textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
            update('fit');
        });
        img.addEventListener('error', () => {
            toolbar.querySelector('.image-dimensions').textContent = 'Image could not be loaded. Try reopening it.';
            toolbar.querySelectorAll('button').forEach(button => { button.disabled = true; });
        });
    }

    renderVideo(videoUrl, container, mimeType = null) {
        container.innerHTML = '';
        const video = document.createElement('video');
        video.className = 'generated-video-artifact';
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';

        const source = document.createElement('source');
        source.src = videoUrl;
        if (mimeType) {
            source.type = mimeType;
        }
        video.appendChild(source);
        container.appendChild(video);
    }

    renderPresentation(metadata, container) {
        container.innerHTML = '';
        const inline = metadata?.inline || {};
        const slides = Array.isArray(inline.slides) ? inline.slides : [];
        const templateName = metadata?.template?.name || metadata?.template?.id || 'Native PowerPoint';
        const deck = document.createElement('div');
        deck.className = 'presentation-artifact';
        deck.innerHTML = `
            <div class="presentation-artifact-hero">
                <div>
                    <div class="presentation-artifact-kicker">Editable .pptx</div>
                    <h2>${this.escapeHtml(metadata?.title || inline.topic || 'PowerPoint deck')}</h2>
                    <p>${this.escapeHtml(metadata?.summary || `${slides.length || inline.slide_count || 0} slides generated with native PowerPoint elements.`)}</p>
                </div>
                <div class="presentation-artifact-meta">
                    <span>${this.escapeHtml(String(inline.slide_count || slides.length || 0))} slides</span>
                    <span>${this.escapeHtml(templateName)}</span>
                    <span>${this.escapeHtml(metadata?.filename || 'presentation.pptx')}</span>
                </div>
            </div>
            <div class="presentation-artifact-grid">
                ${slides.map((slide) => this.renderPresentationSlideCard(slide, metadata?.template)).join('') || '<div class="presentation-artifact-empty">No slide preview data available.</div>'}
            </div>
        `;
        container.appendChild(deck);
        if (!slides.length) return;
        const reader = document.createElement('section');
        reader.className = 'presentation-reader';
        reader.setAttribute('aria-label', 'Slide preview');
        reader.tabIndex = 0;
        reader.innerHTML = '<div class="artifact-local-toolbar"><button type="button" data-slide="previous" aria-label="Previous slide">← Previous</button><span class="slide-position" role="status"></span><button type="button" data-slide="next" aria-label="Next slide">Next →</button></div><div class="presentation-reader-content"></div>';
        deck.querySelector('.presentation-artifact-grid').before(reader);
        let selected = 0;
        const select = (index) => {
            selected = Math.max(0, Math.min(slides.length - 1, index));
            reader.querySelector('.presentation-reader-content').innerHTML = this.renderPresentationSlideCard(slides[selected], metadata?.template);
            reader.querySelector('.slide-position').textContent = `Slide ${selected + 1} of ${slides.length}${slides[selected].preview_data_uri ? '' : ' · Layout preview'}`;
            reader.querySelector('[data-slide="previous"]').disabled = selected === 0;
            reader.querySelector('[data-slide="next"]').disabled = selected === slides.length - 1;
            deck.querySelectorAll('.presentation-select-slide').forEach((button, i) => button.setAttribute('aria-pressed', String(i === selected)));
        };
        deck.querySelectorAll('.presentation-artifact-grid .presentation-slide-card').forEach((card, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'presentation-select-slide';
            button.textContent = `View slide ${index + 1}`;
            button.addEventListener('click', () => { select(index); reader.focus({ preventScroll: true }); reader.scrollIntoView({ block: 'nearest' }); });
            card.appendChild(button);
        });
        reader.addEventListener('click', (event) => {
            const direction = event.target.closest('[data-slide]')?.dataset.slide;
            if (direction) select(selected + (direction === 'next' ? 1 : -1));
        });
        reader.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault(); select(selected + (event.key === 'ArrowRight' ? 1 : -1));
            }
        });
        select(0);
    }

    renderPresentationSlideCard(slide = {}, template = {}) {
        const badges = [
            slide.has_chart ? 'Chart' : '',
            slide.has_table ? 'Table' : '',
            slide.has_diagram ? 'Diagram' : '',
            slide.has_visual ? 'Visual' : '',
            Array.isArray(slide.metrics) && slide.metrics.length ? 'Metrics' : '',
        ].filter(Boolean);
        const bullets = Array.isArray(slide.bullets) ? slide.bullets.slice(0, 3) : [];
        return `
            <article class="presentation-slide-card">
                <div class="presentation-slide-number">${this.escapeHtml(String(slide.index || ''))}</div>
                ${this.renderPresentationSlideThumbnail(slide, template)}
                <h3>${this.escapeHtml(slide.title || `Slide ${slide.index || ''}`)}</h3>
                ${slide.subtitle ? `<p>${this.escapeHtml(String(slide.subtitle))}</p>` : ''}
                ${badges.length ? `<div class="presentation-slide-badges">${badges.map((badge) => `<span>${this.escapeHtml(badge)}</span>`).join('')}</div>` : ''}
                ${bullets.length ? `<ul>${bullets.map((bullet) => `<li>${this.escapeHtml(String(bullet))}</li>`).join('')}</ul>` : ''}
            </article>
        `;
    }

    renderPresentationSlideThumbnail(slide = {}, template = {}) {
        if (slide.preview_data_uri) {
            return `
                <div class="presentation-slide-thumb presentation-slide-thumb-rendered">
                    <img src="${this.escapeHtml(String(slide.preview_data_uri))}" alt="" loading="lazy">
                </div>
            `;
        }
        const colors = template?.colors || {};
        const style = [
            `--ppt-bg:#${this.escapeHtml(colors.background || 'F5F6F0')}`,
            `--ppt-surface:#${this.escapeHtml(colors.surface || 'FFFFFF')}`,
            `--ppt-ink:#${this.escapeHtml(colors.ink || '17202A')}`,
            `--ppt-muted:#${this.escapeHtml(colors.muted || '5A6474')}`,
            `--ppt-a:#${this.escapeHtml(colors.accent || '1B5299')}`,
            `--ppt-b:#${this.escapeHtml(colors.accent2 || 'E8553D')}`,
            `--ppt-c:#${this.escapeHtml(colors.accent3 || '1A936F')}`
        ].join(';');
        const layout = String(slide.layout || slide.type || 'content').toLowerCase();
        const chartBars = '<i></i><i></i><i></i><i></i>';
        const cards = '<i></i><i></i><i></i>';
        return `
            <div class="presentation-slide-thumb presentation-slide-thumb-${this.escapeHtml(layout)}" style="${style}">
                <span class="thumb-kicker"></span>
                <span class="thumb-title"></span>
                ${layout === 'title'
                    ? '<span class="thumb-hero"></span><span class="thumb-metrics"><i></i><i></i><i></i></span>'
                    : layout === 'two_column'
                        ? '<span class="thumb-column one"></span><span class="thumb-column two"></span>'
                        : slide.has_chart
                            ? `<span class="thumb-chart">${chartBars}</span>`
                            : slide.has_table
                                ? '<span class="thumb-table"><i></i><i></i><i></i></span>'
                                : slide.has_diagram
                                    ? '<span class="thumb-flow"><i></i><i></i><i></i></span>'
                                    : `<span class="thumb-cards">${cards}</span><span class="thumb-visual"></span>`
                }
            </div>
        `;
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

        const renderPromise = Promise.resolve().then(() => mermaid.init(undefined, [mermaidDiv]));

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

        renderPromise.then(() => {
            if (interactiveWrapper.isConnected) prepareDiagram();
        }).catch(() => {
            if (!interactiveWrapper.isConnected) return;
            interactiveWrapper.textContent = 'Unable to render this diagram. Switch to source to inspect the Mermaid syntax.';
            zoomControls.remove();
        });

        let resizeObserver = null;
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
                if (hasInteracted) return;
                this.normalizeMermaidSvg(panContainer, interactiveWrapper, padding);
                centerDiagram();
            });
            resizeObserver.observe(interactiveWrapper);
        }
        this.disposeArtifactView = () => resizeObserver?.disconnect();

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
            <button class="zoom-in-btn" title="Zoom In"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
            <button class="zoom-out-btn" title="Zoom Out"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
            <button class="zoom-reset-btn" title="Reset View"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></button>
        `;
        container.appendChild(zoomControls);
        zoomControls.querySelectorAll('button').forEach(button => button.setAttribute('aria-label', button.title));

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

        panContainer.style.width = `${viewBoxWidth}px`;
        panContainer.style.height = `${viewBoxHeight}px`;
        panContainer.style.minWidth = '0';
        panContainer.style.minHeight = '0';
        panContainer.style.padding = '0';
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
        const toolbar = document.createElement('div');
        toolbar.className = 'artifact-local-toolbar';
        const info = document.createElement('span');
        info.textContent = `${language} · ${String(content).split('\n').length} lines`;
        const wrap = document.createElement('button');
        wrap.type = 'button';
        wrap.textContent = 'Wrap lines';
        wrap.setAttribute('aria-pressed', 'false');
        toolbar.append(info, wrap);
        container.appendChild(toolbar);
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
        const gutter = document.createElement('span');
        gutter.className = 'artifact-line-numbers';
        gutter.setAttribute('aria-hidden', 'true');
        gutter.textContent = String(content).split('\n').map((_, index) => index + 1).join('\n');
        pre.prepend(gutter);
        wrap.addEventListener('click', () => {
            const wrapped = pre.classList.toggle('artifact-code-wrapped');
            gutter.hidden = wrapped;
            wrap.setAttribute('aria-pressed', String(wrapped));
        });
    }

    hideArtifact() {
        const container = document.getElementById('artifact-container');
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        
        this.artifactResizeAnimation?.cancel();
        this.setExpanded(false, false);
        clearTimeout(this.artifactCopyTimer);
        container.querySelector('.copy-artifact-btn .t-icon-swap').dataset.state = 'a';
        container.querySelector('.copy-artifact-btn').classList.remove('is-copied');
        container.querySelector('.copy-artifact-btn').parentElement.querySelector('.t-tt').textContent = 'Copy source';
        container.classList.add('hidden');
        container.inert = true;
        this.disposeArtifactView?.();
        this.disposeArtifactView = null;
        if (container.contains(document.activeElement) && this.artifactReturnFocus?.isConnected) this.artifactReturnFocus.focus({ preventScroll: true });
        chatContainer.classList.remove('with-artifact');
        inputContainer.classList.remove('with-artifact');

        // Restore workspace sidebars when artifact closes
        this.restoreWorkspaceSidebarsFromOverlay('artifact');
    }

    reopenArtifact(artifactId) {
        const artifact = this.artifacts.get(artifactId);
        if (artifact && typeof artifact === 'object') {
            // If the artifact is pending, check if data arrived in pendingImages cache
            if (artifact.isPending && this.pendingMedia.has(artifactId)) {
                const mediaData = this.pendingMedia.get(artifactId);
                artifact.content = mediaData.url;
                artifact.mimeType = mediaData.mimeType || artifact.mimeType || null;
                artifact.isPending = false;
                this.pendingMedia.delete(artifactId);
                this.showArtifact(artifact.type, mediaData.url, artifactId, {
                    title: artifact.title,
                    language: artifact.language,
                    defaultView: artifact.viewMode,
                    mimeType: artifact.mimeType
                });
                return;
            }
            
            // If the artifact is pending and no data available, show loading state
            // Otherwise, pass the actual content
            this.showArtifact(artifact.type, artifact.isPending ? null : artifact.content, artifactId, {
                title: artifact.title,
                language: artifact.language,
                defaultView: artifact.viewMode,
                mimeType: artifact.mimeType
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
                const button = container.querySelector('.copy-artifact-btn');
                button.querySelector('.t-icon-swap').dataset.state = 'b';
                button.classList.add('is-copied');
                button.parentElement.querySelector('.t-tt').textContent = 'Copied';
                clearTimeout(this.artifactCopyTimer);
                this.artifactCopyTimer = setTimeout(() => {
                    button.querySelector('.t-icon-swap').dataset.state = 'a';
                    button.classList.remove('is-copied');
                    button.parentElement.querySelector('.t-tt').textContent = 'Copy source';
                }, 1800);
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
            } else if (artifact.type === 'image' || artifact.type === 'video') {
                const url = artifact.content;
                if (!url) return;
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const bytes = new Uint8Array(await response.arrayBuffer());
                content = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
                encoding = 'binary';
                const safeTitle = (artifact.title || '').trim();
                suggestedName = safeTitle
                    ? safeTitle.replace(/[\\/:*?"<>|]+/g, '_')
                    : `generated-${artifact.type}`;
                extension = artifact.type === 'video'
                    ? '.mp4'
                    : this.extensionFromMimeType(artifact.mimeType || 'image/png');
            } else if (artifact.type === 'presentation') {
                const metadata = artifact.content || {};
                const url = await this.resolvePresentationDownloadUrl(metadata);
                if (!url) {
                    this.showNotification('Presentation file is not available for download yet', 'error');
                    return;
                }
                let response = await fetch(url);
                if (!response.ok && metadata.artifact_id) {
                    delete metadata.download_url;
                    const refreshedUrl = await this.resolvePresentationDownloadUrl(metadata);
                    if (refreshedUrl && refreshedUrl !== url) {
                        response = await fetch(refreshedUrl);
                    }
                }
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const bytes = new Uint8Array(await response.arrayBuffer());
                content = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
                encoding = 'binary';
                const safeTitle = (metadata.filename || artifact.title || 'presentation').replace(/[\\/:*?"<>|]+/g, '_');
                suggestedName = safeTitle.replace(/\.pptx$/i, '');
                extension = '.pptx';
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
        const videoEl = contentDiv.querySelector('.generated-video-artifact');

        if (imageEl) {
            const dataUri = imageEl.src;
            if (dataUri.startsWith('data:')) {
                content = dataUri.split(',')[1];
                suggestedName = 'generated-image';
                extension = this.extensionFromMimeType(dataUri.slice(5, dataUri.indexOf(';')));
                encoding = 'base64';
            }
        } else if (videoEl && videoEl.currentSrc) {
            const response = await fetch(videoEl.currentSrc);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            content = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
            suggestedName = 'generated-video';
            extension = '.mp4';
            encoding = 'binary';
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
                filters: [
                    { name: 'PowerPoint', extensions: ['pptx'] },
                    { name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
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

    async resolvePresentationDownloadUrl(metadata) {
        if (metadata?.download_url) {
            return metadata.download_url;
        }

        const artifactId = metadata?.artifact_id;
        if (!artifactId) {
            return null;
        }

        try {
            const session = await window.electron?.auth?.getSession?.();
            const token = session?.access_token;
            if (!token) {
                return null;
            }

            const response = await fetch(
                `${this.backendBaseUrl}/api/sandbox/artifacts/${encodeURIComponent(artifactId)}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const payload = await response.json();
            const downloadUrl = payload?.artifact?.download_url;
            if (downloadUrl) {
                metadata.download_url = downloadUrl;
            }
            return downloadUrl || null;
        } catch (error) {
            console.error('Failed to resolve presentation download URL:', error);
            return null;
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

    extensionFromMimeType(mimeType) {
        const map = {
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/webp': '.webp',
            'video/mp4': '.mp4'
        };
        return map[mimeType] || '.bin';
    }

    getExistingDeployTarget() {
        const conversationId = this.getCurrentConversationId();
        const rememberedTarget = conversationId ? this.deployTargetsByConversation.get(conversationId) : null;
        const projectContext =
            (window.projectWorkspace && window.projectWorkspace.activeProject)
            || window.projectContext
            || window.activeProjectContext
            || rememberedTarget
            || null;

        if (!projectContext || typeof projectContext !== 'object') {
            return null;
        }

        const siteId = String(projectContext.site_id || '').trim();
        if (!siteId) {
            return null;
        }

        return {
            site_id: siteId,
            project_name: String(projectContext.project_name || '').trim() || null,
            slug: String(projectContext.slug || '').trim() || null,
            hostname: String(projectContext.hostname || '').trim() || null,
            deployment_id: String(projectContext.deployment_id || '').trim() || null,
        };
    }

    rememberDeployTarget(target = {}) {
        const conversationId = this.getCurrentConversationId();
        if (!conversationId) return;

        const siteId = String(target.site_id || '').trim();
        if (!siteId) return;

        this.deployTargetsByConversation.set(conversationId, {
            site_id: siteId,
            project_name: String(target.project_name || '').trim() || null,
            slug: String(target.slug || '').trim() || null,
            hostname: String(target.hostname || '').trim() || null,
            deployment_id: String(target.deployment_id || '').trim() || null,
        });
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
        const root = (base || 'site').slice(0, 56);
        return root || 'site';
    }

    normalizeSlugInput(input) {
        return String(input || '')
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 63);
    }

    validateDeploySlug(slug) {
        const candidate = String(slug || '').trim().toLowerCase();
        const reserved = new Set([
            'www',
            'api',
            'app',
            'admin',
            'mail',
            'smtp',
            'imap',
            'pop',
            'ftp',
            'cdn',
            'status',
            'ns1',
            'ns2'
        ]);

        if (!candidate) {
            return { ok: false, error: 'Slug is required.' };
        }
        if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(candidate)) {
            return {
                ok: false,
                error: 'Use 3-63 chars: lowercase letters, numbers, dashes; no leading/trailing dash.'
            };
        }
        if (reserved.has(candidate)) {
            return { ok: false, error: 'This slug is reserved. Choose another one.' };
        }
        return { ok: true, slug: candidate };
    }

    getFallbackSlug(baseSlug, siteId) {
        const normalizedBase = this.normalizeSlugInput(baseSlug || 'site') || 'site';
        const suffix = String(siteId || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || 'site';
        return `${normalizedBase}-${suffix}`.slice(0, 63);
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

        for (const [path, item] of latestByPath) {
            const metadata = item?.metadata || {};
            const contentType = metadata.mime_type || this.inferContentTypeFromPath(path);

            deployFiles.push({
                path,
                content_type: contentType,
                download_url: item.download_url
            });
        }

        return deployFiles;
    }

    parseLocalAssetRefs(html) {
        const text = String(html || '');
        const refs = new Set();
        const patterns = [
            /<link[^>]+href=["']([^"']+)["']/gi,
            /<script[^>]+src=["']([^"']+)["']/gi,
            /<img[^>]+src=["']([^"']+)["']/gi,
            /url\(\s*["']?([^)"'\s]+)["']?\s*\)/gi,
            /@import\s+(?:url\()?\s*["']([^"']+)["']/gi,
            /\bimport\s+[^"'`]*["']([^"']+)["']/gi,
            /\bimport\(\s*["']([^"']+)["']\s*\)/gi
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
                    return `<li class="deploy-tree-file"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 1 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><span>${safeName}</span></li>`;
                }
                return `<li class="deploy-tree-dir"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-1.2-1.8A2 2 0 0 0 7.55 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg><span>${safeName}</span>${renderNode(entry.__children)}</li>`;
            }).join('')}</ul>`;
        };

        return renderNode(root);
    }

    async confirmDeployPreview({ files, rootPrefix, candidateCount, proposedSlug }) {
        const modal = document.getElementById('deploy-preview-modal');
        if (!modal) return { files, slug: proposedSlug };

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
            <div style="margin-top: 12px; display: grid; gap: 6px;">
                <label for="deploy-slug-input" style="font-weight: 600;">Subdomain Slug</label>
                <input id="deploy-slug-input" type="text" value="${this.escapeHtml(proposedSlug || 'site')}" placeholder="your-site-name" style="height: 36px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.18); background: rgba(0,0,0,0.18); color: inherit; padding: 0 10px;" />
                <div id="deploy-slug-helper" style="font-size: 12px; opacity: 0.85;">Edit this to choose your public site name.</div>
                <div id="deploy-slug-error" style="font-size: 12px; color: #f87171; min-height: 16px;"></div>
            </div>
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

        const slugInput = modal.querySelector('#deploy-slug-input');
        const slugHelper = modal.querySelector('#deploy-slug-helper');
        const slugError = modal.querySelector('#deploy-slug-error');
        const syncSlugState = () => {
            const normalized = this.normalizeSlugInput(slugInput?.value || '');
            if (slugInput && slugInput.value !== normalized) {
                slugInput.value = normalized;
            }
            const verdict = this.validateDeploySlug(normalized);
            if (slugHelper) {
                slugHelper.textContent = normalized
                    ? `Final slug: ${normalized}`
                    : 'Enter a slug to continue.';
            }
            if (slugError) {
                slugError.textContent = verdict.ok ? '' : verdict.error;
            }
            if (confirmBtn) {
                confirmBtn.disabled = !verdict.ok;
                confirmBtn.style.opacity = verdict.ok ? '1' : '0.6';
                confirmBtn.style.cursor = verdict.ok ? 'pointer' : 'not-allowed';
            }
            return verdict;
        };
        slugInput?.addEventListener('input', syncSlugState);
        slugInput?.addEventListener('change', syncSlugState);

        rebuildTree();
        syncSlugState();
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
                const slugVerdict = syncSlugState();
                if (!slugVerdict.ok) {
                    return;
                }
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
                resolve({
                    files: selected,
                    slug: slugVerdict.slug
                });
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

        const existingTarget = this.getExistingDeployTarget();
        const siteId = existingTarget?.site_id
            || ((window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `site-${Date.now()}`);
        const projectName = artifact.title || existingTarget?.project_name || 'Generated Site';
        const slugSource = existingTarget?.slug || artifact.title || 'generated-site';
        const generatedSlug = existingTarget?.slug || this.slugify(slugSource);

        this.deployInProgress = true;
        this.showNotification(
            existingTarget?.site_id ? 'Creating a new deployment version...' : 'Deploy started...',
            'info'
        );

        try {
            const sessionFiles = await this.collectSessionDeployFiles(session.access_token);
            const draft = this.buildDeploymentDraft(sessionFiles, html);
            let filesToDeploy = draft.files;

            if (!filesToDeploy.length) {
                throw new Error('No deployable files found in this session');
            }

            const deploySelection = await this.confirmDeployPreview({
                files: filesToDeploy,
                rootPrefix: draft.rootPrefix,
                candidateCount: draft.candidateCount,
                proposedSlug: generatedSlug
            });
            if (!deploySelection) {
                this.showNotification('Deploy canceled', 'info');
                return;
            }

            filesToDeploy = deploySelection.files;
            const slug = deploySelection.slug;
            const hasIndexHtml = filesToDeploy.some((file) => String(file.path || '').toLowerCase() === 'index.html');
            if (!hasIndexHtml) {
                throw new Error('Deployment must include index.html');
            }

            const uploadPayload = await this.materializeDeployFiles(filesToDeploy);

            if (uploadPayload.length > 1) {
                this.showNotification(`Deploying ${uploadPayload.length} files...`, 'info');
            }

            let finalSlug = slug;
            try {
                await this.deployApi('/api/deploy/site/init', session.access_token, {
                    site_id: siteId,
                    project_name: projectName,
                    slug: finalSlug
                });
            } catch (initError) {
                const message = String(initError?.message || '');
                const isSlugConflict =
                    message.toLowerCase().includes('already assigned')
                    || message.toLowerCase().includes('already exists')
                    || message.toLowerCase().includes('duplicate');

                if (!existingTarget?.site_id && isSlugConflict) {
                    finalSlug = this.getFallbackSlug(slug, siteId);
                    await this.deployApi('/api/deploy/site/init', session.access_token, {
                        site_id: siteId,
                        project_name: projectName,
                        slug: finalSlug
                    });
                    this.showNotification(`Slug '${slug}' was unavailable, using '${finalSlug}' instead.`, 'info');
                } else {
                    throw initError;
                }
            }

            await this.deployApi('/api/deploy/assign-subdomain', session.access_token, { site_id: siteId });

            const upload = await this.deployApi('/api/deploy/upload-site', session.access_token, {
                site_id: siteId,
                files: uploadPayload
            });

            const activated = await this.deployApi('/api/deploy/activate', session.access_token, {
                site_id: siteId,
                deployment_id: upload.deployment_id
            });

            const liveUrl = activated?.url || `https://${finalSlug}.aetheriaai.website`;
            const resolvedHostname = activated?.url
                ? new URL(activated.url).hostname
                : (existingTarget?.hostname || `${finalSlug}.aetheriaai.website`);

            this.rememberDeployTarget({
                site_id: siteId,
                project_name: projectName,
                slug: finalSlug,
                hostname: resolvedHostname,
                deployment_id: upload.deployment_id,
            });

            if (existingTarget?.site_id && window.projectWorkspace?.ensureContext) {
                window.projectWorkspace.ensureContext({
                    site_id: siteId,
                    deployment_id: upload.deployment_id,
                    project_name: projectName,
                    slug: finalSlug,
                    hostname: resolvedHostname,
                    version: upload.version,
                    r2_prefix: upload.r2_prefix,
                }, { syncUi: true });
            }
            this.showNotification(`Deployed: ${liveUrl}`, 'success');

            if (window.AIOS?.loadDeployments) {
                window.AIOS.loadDeployments(false, { force: true });
            }

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
        const deployBtn = container.querySelector('.deploy-artifact-btn');
        if (deployBtn) deployBtn.style.display = 'none';

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

    /**
     * Hide workspace sidebars when overlays (artifact/AIOS) open
     * @param {string} source - 'artifact' or 'aios'
     */
    hideWorkspaceSidebarsForOverlay(source) {
        if (!window.stateManager) {
            console.warn('[ArtifactHandler] StateManager not available, cannot hide workspaces');
            return;
        }

        const state = window.stateManager.getState();
        
        // Save current workspace state before hiding
        this.workspaceStateBeforeOverlay = {
            projectWorkspaceWasOpen: state.isProjectWorkspaceOpen,
            computerWorkspaceWasOpen: state.isComputerWorkspaceOpen,
            hiddenBy: source
        };

        console.log(`[ArtifactHandler] Hiding workspaces for ${source}:`, {
            projectWorkspaceWasOpen: state.isProjectWorkspaceOpen,
            computerWorkspaceWasOpen: state.isComputerWorkspaceOpen
        });

        // Hide both workspace sidebars if they're open
        const updates = {};
        if (state.isProjectWorkspaceOpen) {
            updates.isProjectWorkspaceOpen = false;
        }
        if (state.isComputerWorkspaceOpen) {
            updates.isComputerWorkspaceOpen = false;
        }

        if (Object.keys(updates).length > 0) {
            console.log('[ArtifactHandler] Applying state updates:', updates);
            window.stateManager.setState(updates);
        } else {
            console.log('[ArtifactHandler] No workspaces to hide');
        }
    }

    /**
     * Restore workspace sidebars when overlays close
     * @param {string} source - 'artifact' or 'aios'
     */
    restoreWorkspaceSidebarsFromOverlay(source) {
        if (!window.stateManager) {
            console.warn('[ArtifactHandler] StateManager not available, cannot restore workspaces');
            return;
        }

        // Only restore if this source was the one that hid them
        if (this.workspaceStateBeforeOverlay.hiddenBy !== source) {
            console.log(`[ArtifactHandler] Not restoring workspaces - hidden by '${this.workspaceStateBeforeOverlay.hiddenBy}', not '${source}'`);
            return;
        }

        console.log(`[ArtifactHandler] Restoring workspaces for ${source}:`, {
            projectWorkspaceWasOpen: this.workspaceStateBeforeOverlay.projectWorkspaceWasOpen,
            computerWorkspaceWasOpen: this.workspaceStateBeforeOverlay.computerWorkspaceWasOpen
        });

        const updates = {};
        
        // Restore project workspace if it was open before
        if (this.workspaceStateBeforeOverlay.projectWorkspaceWasOpen) {
            updates.isProjectWorkspaceOpen = true;
        }
        
        // Restore computer workspace if it was open before
        if (this.workspaceStateBeforeOverlay.computerWorkspaceWasOpen) {
            updates.isComputerWorkspaceOpen = true;
        }

        if (Object.keys(updates).length > 0) {
            console.log('[ArtifactHandler] Applying restore updates:', updates);
            window.stateManager.setState(updates);
        } else {
            console.log('[ArtifactHandler] No workspaces to restore');
        }

        // Reset the tracking state
        this.workspaceStateBeforeOverlay = {
            projectWorkspaceWasOpen: false,
            computerWorkspaceWasOpen: false,
            hiddenBy: null
        };
    }
}

export const artifactHandler = new ArtifactHandler();

// Make artifactHandler available globally for cross-module access
if (typeof window !== 'undefined') {
    window.artifactHandler = artifactHandler;
}
