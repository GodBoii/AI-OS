class DesignModeController {
    constructor() {
        this.snapshot = null;
        this.previewFrame = null;
        this.previewDocument = null;
        this.previewWindow = null;
        this.rootPath = null;
        this.indexPath = null;
        this.currentHtml = '';
        this.selectedElement = null;
        this.hoveredElement = null;
        this.unsavedChanges = false;
        this.mode = 'edit';
        this.comments = [];
        this.commentCounter = 0;
        this.helperStyleId = 'aetheria-design-helper-style';
        this.helperBaseId = 'aetheria-design-helper-base';
        this.boundFrameLoad = () => this.handleFrameLoad();
        this.allowedTextTags = new Set(['P', 'SPAN', 'A', 'BUTTON', 'LABEL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
        this.isBound = false;
        this.domObserver = null;
        this.handleWorkspaceStateChange = (event) => {
            this.refreshAvailability(event?.detail || null);
        };
        this.handleGlobalKeydown = (event) => {
            if (event.key === 'Escape' && this.isOpen()) {
                event.preventDefault();
                this.close();
            }
        };
        this.init();
    }

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup(), { once: true });
            return;
        }
        this.setup();
    }

    setup() {
        this.cacheElements();
        if (!this.el.toggleBtn || !this.el.overlay || !this.el.frame) {
            this.watchForDesignUi();
            return;
        }
        this.stopWatchingForDesignUi();
        this.previewFrame = this.el.frame;
        this.bindEventsOnce();
        this.refreshAvailability(window.projectWorkspace?.getWorkspaceSnapshot?.() || null);
    }

    cacheElements() {
        this.el = {
            toggleBtn: document.getElementById('design-mode-toggle-btn'),
            overlay: document.getElementById('design-mode-overlay'),
            frame: document.getElementById('design-mode-preview-frame'),
            status: document.getElementById('design-mode-status'),
            subtitle: document.getElementById('design-mode-subtitle'),
            selectionLabel: document.getElementById('design-mode-selection-label'),
            editTab: document.getElementById('design-mode-edit-tab'),
            commentTab: document.getElementById('design-mode-comment-tab'),
            editControls: document.getElementById('design-mode-edit-controls'),
            commentPanel: document.getElementById('design-mode-comment-panel'),
            commentsEmpty: document.getElementById('design-mode-comments-empty'),
            commentsList: document.getElementById('design-mode-comments-list'),
            textInput: document.getElementById('design-mode-text-input'),
            textColor: document.getElementById('design-mode-text-color'),
            bgColor: document.getElementById('design-mode-bg-color'),
            radiusInput: document.getElementById('design-mode-radius-input'),
            paddingInput: document.getElementById('design-mode-padding-input'),
            fontSizeInput: document.getElementById('design-mode-font-size-input'),
            fontWeightInput: document.getElementById('design-mode-font-weight-input'),
            lineHeightInput: document.getElementById('design-mode-line-height-input'),
            textAlignInput: document.getElementById('design-mode-text-align-input'),
            displayInput: document.getElementById('design-mode-display-input'),
            flexDirInput: document.getElementById('design-mode-flex-dir-input'),
            marginInput: document.getElementById('design-mode-margin-input'),
            opacityInput: document.getElementById('design-mode-opacity-input'),
            opacityValue: document.getElementById('design-mode-opacity-value'),
            letterSpacingInput: document.getElementById('design-mode-letter-spacing-input'),
            widthInput: document.getElementById('design-mode-width-input'),
            heightInput: document.getElementById('design-mode-height-input'),
            gapInput: document.getElementById('design-mode-gap-input'),
            borderWidthInput: document.getElementById('design-mode-border-width-input'),
            borderStyleInput: document.getElementById('design-mode-border-style-input'),
            borderColorInput: document.getElementById('design-mode-border-color-input'),
            overflowInput: document.getElementById('design-mode-overflow-input'),
            refreshBtn: document.getElementById('design-mode-refresh-btn'),
            doneBtn: document.getElementById('design-mode-done-btn'),
            closeBtn: document.getElementById('design-mode-close-btn'),
        };
    }

    bindEventsOnce() {
        if (this.isBound) {
            return;
        }
        this.isBound = true;
        this.el.toggleBtn?.addEventListener('click', () => this.open());
        this.el.closeBtn?.addEventListener('click', () => this.close());
        this.el.refreshBtn?.addEventListener('click', () => this.reloadPreviewFromDisk());
        this.el.doneBtn?.addEventListener('click', () => this.saveChanges());
        this.el.editTab?.addEventListener('click', () => this.setMode('edit'));
        this.el.commentTab?.addEventListener('click', () => this.setMode('comment'));

        this.el.textInput?.addEventListener('input', () => {
            if (!this.selectedElement || !this.canEditText(this.selectedElement)) return;
            this.selectedElement.textContent = this.el.textInput.value;
            this.markDirty('Updated text content.');
        });

        this.el.textColor?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.color = this.el.textColor.value;
            this.markDirty('Updated text color.');
        });

        this.el.bgColor?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.backgroundColor = this.el.bgColor.value;
            this.markDirty('Updated background color.');
        });

        this.el.radiusInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            const value = this.applyUnitOrString(this.el.radiusInput.value, 'px');
            this.selectedElement.style.borderRadius = value;
            this.markDirty('Updated border radius.');
        });

        this.el.paddingInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            const value = this.applyUnitOrString(this.el.paddingInput.value, 'px');
            this.selectedElement.style.padding = value;
            this.markDirty('Updated padding.');
        });

        this.el.fontSizeInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            const value = this.applyUnitOrString(this.el.fontSizeInput.value, 'px');
            this.selectedElement.style.fontSize = value;
            this.markDirty('Updated font size.');
        });

        this.el.fontWeightInput?.addEventListener('change', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.fontWeight = this.el.fontWeightInput.value;
            this.markDirty('Updated font weight.');
        });

        this.el.lineHeightInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.lineHeight = this.el.lineHeightInput.value;
            this.markDirty('Updated line height.');
        });

        this.el.textAlignInput?.addEventListener('change', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.textAlign = this.el.textAlignInput.value;
            this.markDirty('Updated text align.');
        });

        this.el.displayInput?.addEventListener('change', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.display = this.el.displayInput.value;
            this.markDirty('Updated display.');
        });

        this.el.flexDirInput?.addEventListener('change', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.flexDirection = this.el.flexDirInput.value;
            this.markDirty('Updated flex direction.');
        });

        this.el.marginInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            const value = this.applyUnitOrString(this.el.marginInput.value, 'px');
            this.selectedElement.style.margin = value;
            this.markDirty('Updated margin.');
        });

        this.el.opacityInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.opacity = this.el.opacityInput.value;
            if (this.el.opacityValue) this.el.opacityValue.textContent = this.el.opacityInput.value;
            this.markDirty('Updated opacity.');
        });

        this.el.letterSpacingInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            const value = this.applyUnitOrString(this.el.letterSpacingInput.value, 'px');
            this.selectedElement.style.letterSpacing = value;
            this.markDirty('Updated letter spacing.');
        });

        this.el.widthInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            const value = this.applyUnitOrString(this.el.widthInput.value, 'px');
            this.selectedElement.style.width = value;
            this.markDirty('Updated width.');
        });

        this.el.heightInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            const value = this.applyUnitOrString(this.el.heightInput.value, 'px');
            this.selectedElement.style.height = value;
            this.markDirty('Updated height.');
        });

        this.el.gapInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            const value = this.applyUnitOrString(this.el.gapInput.value, 'px');
            this.selectedElement.style.gap = value;
            this.markDirty('Updated gap.');
        });

        this.el.borderWidthInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            const value = this.applyUnitOrString(this.el.borderWidthInput.value, 'px');
            this.selectedElement.style.borderWidth = value;
            this.markDirty('Updated border width.');
        });

        this.el.borderStyleInput?.addEventListener('change', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.borderStyle = this.el.borderStyleInput.value;
            this.markDirty('Updated border style.');
        });

        this.el.borderColorInput?.addEventListener('input', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.borderColor = this.el.borderColorInput.value;
            this.markDirty('Updated border color.');
        });

        this.el.overflowInput?.addEventListener('change', () => {
            if (!this.selectedElement) return;
            this.selectedElement.style.overflow = this.el.overflowInput.value;
            this.markDirty('Updated overflow.');
        });

        document.addEventListener('project-workspace:state-change', this.handleWorkspaceStateChange);
        document.addEventListener('keydown', this.handleGlobalKeydown);

        // Collapsible inspector sections
        document.querySelectorAll('.design-mode-section-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.closest('.design-mode-section');
                if (!section) return;
                const isExpanded = btn.getAttribute('aria-expanded') !== 'false';
                btn.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
                section.classList.toggle('collapsed', isExpanded);
            });
        });

        this.setupCustomSelects();
    }

    setupCustomSelects() {
        const selects = document.querySelectorAll('.design-mode-select');
        selects.forEach(select => {
            if (select.closest('.dm-custom-select-wrapper')) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'dm-custom-select-wrapper';
            select.parentNode.insertBefore(wrapper, select);
            wrapper.appendChild(select);

            const trigger = document.createElement('div');
            trigger.className = 'dm-custom-select-trigger';
            const selectedText = document.createElement('span');
            selectedText.textContent = select.options[select.selectedIndex]?.text || '';
            trigger.appendChild(selectedText);
            
            const icon = document.createElement('div');
            icon.className = 'dm-custom-select-icon';
            icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
            trigger.appendChild(icon);
            
            wrapper.appendChild(trigger);

            const optionsList = document.createElement('div');
            optionsList.className = 'dm-custom-select-options';
            
            Array.from(select.options).forEach((option, index) => {
                const item = document.createElement('div');
                item.className = 'dm-custom-select-item';
                if (index === select.selectedIndex) item.classList.add('selected');
                item.textContent = option.text;
                item.dataset.value = option.value;
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    select.selectedIndex = index;
                    selectedText.textContent = option.text;
                    wrapper.querySelectorAll('.dm-custom-select-item').forEach(el => el.classList.remove('selected'));
                    item.classList.add('selected');
                    wrapper.classList.remove('open');
                    const event = new Event('change', { bubbles: true });
                    select.dispatchEvent(event);
                });
                optionsList.appendChild(item);
            });
            wrapper.appendChild(optionsList);

            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.querySelectorAll('.dm-custom-select-wrapper.open').forEach(w => {
                    if (w !== wrapper) w.classList.remove('open');
                });
                wrapper.classList.toggle('open');
                
                if (wrapper.classList.contains('open')) {
                    const rect = optionsList.getBoundingClientRect();
                    if (rect.bottom > window.innerHeight) {
                        optionsList.style.top = 'auto';
                        optionsList.style.bottom = '100%';
                        optionsList.style.marginTop = '0';
                        optionsList.style.marginBottom = '4px';
                    } else {
                        optionsList.style.top = 'calc(100% + 4px)';
                        optionsList.style.bottom = 'auto';
                        optionsList.style.marginTop = '0';
                        optionsList.style.marginBottom = '0';
                    }
                }
            });
            
            select.addEventListener('change', () => {
                selectedText.textContent = select.options[select.selectedIndex]?.text || '';
                wrapper.querySelectorAll('.dm-custom-select-item').forEach((el, idx) => {
                    if (idx === select.selectedIndex) {
                        el.classList.add('selected');
                    } else {
                        el.classList.remove('selected');
                    }
                });
            });
        });

        document.addEventListener('click', () => {
            document.querySelectorAll('.dm-custom-select-wrapper.open').forEach(w => w.classList.remove('open'));
        });
    }

    setMode(nextMode = 'edit') {
        const mode = nextMode === 'comment' ? 'comment' : 'edit';
        this.mode = mode;
        const isEdit = mode === 'edit';
        if (this.selectedElement) {
            this.selectedElement.classList.remove('aetheria-design-selected');
        }
        if (this.hoveredElement) {
            this.hoveredElement.classList.remove('aetheria-design-hover');
        }
        this.selectedElement = null;
        this.hoveredElement = null;

        this.el.editTab?.classList.toggle('active', isEdit);
        this.el.commentTab?.classList.toggle('active', !isEdit);
        this.el.editTab?.setAttribute('aria-selected', isEdit ? 'true' : 'false');
        this.el.commentTab?.setAttribute('aria-selected', isEdit ? 'false' : 'true');
        this.el.editControls?.classList.toggle('hidden', !isEdit);
        this.el.commentPanel?.classList.toggle('hidden', isEdit);

        if (isEdit) {
            this.updateStatus('Edit mode active. Click any visible element to modify text, colors, spacing, or radius.');
        } else {
            this.updateStatus('Comment mode active. Click any element in preview to add comment feedback.');
        }

        this.resetInspector();
        this.renderComments();
    }

    watchForDesignUi() {
        if (this.domObserver) {
            return;
        }
        this.domObserver = new MutationObserver(() => {
            this.cacheElements();
            if (this.el.toggleBtn && this.el.overlay && this.el.frame) {
                this.setup();
            }
        });
        this.domObserver.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    stopWatchingForDesignUi() {
        if (!this.domObserver) {
            return;
        }
        this.domObserver.disconnect();
        this.domObserver = null;
    }

    isOpen() {
        return !this.el.overlay?.classList.contains('hidden');
    }

    refreshAvailability(snapshot = null) {
        this.snapshot = snapshot || window.projectWorkspace?.getWorkspaceSnapshot?.() || null;
        const visible = this.isDesignVisible(this.snapshot);
        const enabled = this.isDesignEnabled(this.snapshot);

        if (this.el.toggleBtn) {
            this.el.toggleBtn.classList.toggle('hidden', !visible);
            this.el.toggleBtn.classList.toggle('design-mode-toggle-btn-disabled', visible && !enabled);
            this.el.toggleBtn.disabled = visible && !enabled;
            this.el.toggleBtn.setAttribute('aria-disabled', visible && !enabled ? 'true' : 'false');
            this.el.toggleBtn.title = !visible
                ? 'Design'
                : enabled
                    ? 'Open Design Mode'
                    : 'Switch to Local mode to use Design Mode';
        }

        if (!visible && this.isOpen()) {
            this.close({ force: true });
        }
    }

    isDesignVisible(snapshot) {
        const detail = snapshot || {};
        return Boolean(
            detail?.isProjectWorkspaceOpen
            && (detail?.activeProject?.site_id || detail?.cloud_context?.site_id)
        );
    }

    isDesignEnabled(snapshot) {
        const detail = snapshot || {};
        const localContext = detail?.local_context || {};
        const localRoot = String(localContext?.root_path || '').trim();
        return Boolean(
            this.isDesignVisible(detail)
            && detail?.workspace_mode === 'local'
            && (localContext?.is_ready || localRoot)
            && localRoot
        );
    }

    async open() {
        if (!this.isDesignVisible(this.snapshot)) {
            this.updateStatus('Design mode is available only when a deployed project is open.');
            return;
        }

        if (!this.isDesignEnabled(this.snapshot)) {
            this.updateStatus('Design mode is only available for deployed projects in local mode.');
            window.projectWorkspace?.setStatus?.('Switch this deployed project to Local mode to use Design Mode.');
            return;
        }

        this.rootPath = String(this.snapshot?.local_context?.root_path || '').trim();
        this.indexPath = this.joinPath(this.rootPath, 'index.html');

        try {
            const html = await window.electron.fs.promises.readFile(this.indexPath, 'utf8');
            this.currentHtml = String(html || '');
            if (!this.currentHtml.trim()) {
                throw new Error('index.html is empty.');
            }

            this.unsavedChanges = false;
            this.selectedElement = null;
            this.hoveredElement = null;
            this.comments = [];
            this.commentCounter = 0;
            this.el.overlay.classList.remove('hidden');
            this.el.overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('design-mode-active');
            await this.loadPreviewDocument(this.currentHtml);
            this.setMode('edit');
            this.updateStatus('Preview ready. Click any visible element to edit it.');
        } catch (error) {
            this.updateStatus(`Design mode could not open: ${error.message}`);
            window.projectWorkspace?.setStatus?.(`Design mode failed: ${error.message}`);
        }
    }

    async close(options = {}) {
        const { force = false } = options;
        if (!force && this.unsavedChanges) {
            const proceed = window.confirm('Close Design Mode and discard unsaved visual edits?');
            if (!proceed) return;
        }

        this.teardownPreviewHelpers();
        this.previewFrame?.removeEventListener('load', this.boundFrameLoad);
        this.previewFrame?.setAttribute('srcdoc', '<!DOCTYPE html><html><body></body></html>');
        this.previewDocument = null;
        this.previewWindow = null;
        this.selectedElement = null;
        this.hoveredElement = null;
        this.unsavedChanges = false;
        this.comments = [];
        this.commentCounter = 0;
        this.el.overlay.classList.add('hidden');
        this.el.overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('design-mode-active');
        this.setMode('edit');
        this.resetInspector();
    }

    async reloadPreviewFromDisk() {
        if (!this.rootPath || !this.indexPath) return;
        try {
            const html = await window.electron.fs.promises.readFile(this.indexPath, 'utf8');
            this.currentHtml = String(html || '');
            this.unsavedChanges = false;
            this.selectedElement = null;
            this.hoveredElement = null;
            await this.loadPreviewDocument(this.currentHtml);
            this.updateStatus('Reloaded latest local files into Design Mode.');
        } catch (error) {
            this.updateStatus(`Refresh failed: ${error.message}`);
        }
    }

    async loadPreviewDocument(html) {
        return new Promise((resolve, reject) => {
            this.previewFrame.removeEventListener('load', this.boundFrameLoad);
            this.previewFrame.addEventListener('load', this.boundFrameLoad, { once: true });
            try {
                this.previewFrame.srcdoc = this.preparePreviewHtml(html);
                const done = () => resolve(true);
                const timeout = window.setTimeout(() => {
                    reject(new Error('Preview load timed out.'));
                }, 12000);
                this.boundResolve = () => {
                    window.clearTimeout(timeout);
                    done();
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    handleFrameLoad() {
        try {
            this.previewWindow = this.previewFrame.contentWindow;
            this.previewDocument = this.previewFrame.contentDocument || this.previewWindow?.document || null;
            if (!this.previewDocument) {
                throw new Error('Preview document is unavailable.');
            }
            this.installPreviewHelpers();
            this.resetInspector();
            if (typeof this.boundResolve === 'function') {
                const fn = this.boundResolve;
                this.boundResolve = null;
                fn();
            }
        } catch (error) {
            this.updateStatus(`Preview setup failed: ${error.message}`);
        }
    }

    preparePreviewHtml(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(String(html || ''), 'text/html');
        const base = doc.createElement('base');
        base.id = this.helperBaseId;
        base.href = this.toFileBaseHref(this.rootPath);
        doc.head.prepend(base);

        const style = doc.createElement('style');
        style.id = this.helperStyleId;
        style.textContent = `
            .aetheria-design-hover { outline: 2px solid rgba(59, 130, 246, 0.75) !important; cursor: pointer !important; }
            .aetheria-design-selected { outline: 2px solid rgba(236, 72, 153, 0.95) !important; box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.2) !important; }
            html, body { min-height: 100%; }
        `;
        doc.head.appendChild(style);

        return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    }

    installPreviewHelpers() {
        if (!this.previewDocument) return;

        if (this.handlePreviewMouseOver) {
            this.previewDocument.removeEventListener('mouseover', this.handlePreviewMouseOver, true);
        }
        if (this.handlePreviewMouseOut) {
            this.previewDocument.removeEventListener('mouseout', this.handlePreviewMouseOut, true);
        }
        if (this.handlePreviewClick) {
            this.previewDocument.removeEventListener('click', this.handlePreviewClick, true);
        }
        if (this.handlePreviewSubmit) {
            this.previewDocument.removeEventListener('submit', this.handlePreviewSubmit, true);
        }

        this.handlePreviewMouseOver = (event) => {
            const target = this.findEditableTarget(event.target);
            this.setHoveredElement(target);
        };
        this.handlePreviewMouseOut = (event) => {
            const next = this.findEditableTarget(event.relatedTarget);
            if (next !== this.hoveredElement) {
                this.setHoveredElement(null);
            }
        };
        this.handlePreviewClick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = this.findEditableTarget(event.target);
            if (!target) return;
            if (this.mode === 'comment') {
                this.addCommentForTarget(target);
                return;
            }
            this.selectElement(target);
        };
        this.handlePreviewSubmit = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        this.previewDocument.addEventListener('mouseover', this.handlePreviewMouseOver, true);
        this.previewDocument.addEventListener('mouseout', this.handlePreviewMouseOut, true);
        this.previewDocument.addEventListener('click', this.handlePreviewClick, true);
        this.previewDocument.addEventListener('submit', this.handlePreviewSubmit, true);
    }

    teardownPreviewHelpers() {
        if (!this.previewDocument) return;
        if (this.handlePreviewMouseOver) {
            this.previewDocument.removeEventListener('mouseover', this.handlePreviewMouseOver, true);
        }
        if (this.handlePreviewMouseOut) {
            this.previewDocument.removeEventListener('mouseout', this.handlePreviewMouseOut, true);
        }
        if (this.handlePreviewClick) {
            this.previewDocument.removeEventListener('click', this.handlePreviewClick, true);
        }
        if (this.handlePreviewSubmit) {
            this.previewDocument.removeEventListener('submit', this.handlePreviewSubmit, true);
        }
        if (this.hoveredElement) this.hoveredElement.classList.remove('aetheria-design-hover');
        if (this.selectedElement) this.selectedElement.classList.remove('aetheria-design-selected');
        this.hoveredElement = null;
        this.selectedElement = null;

        const helperStyle = this.previewDocument.getElementById(this.helperStyleId);
        helperStyle?.remove();
        const helperBase = this.previewDocument.getElementById(this.helperBaseId);
        helperBase?.remove();
    }

    findEditableTarget(node) {
        if (!node || !node.tagName) return null;
        let current = node;
        while (current && current !== this.previewDocument.body) {
            const tag = String(current.tagName || '').toUpperCase();
            if (this.isEditableTag(tag)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    isEditableTag(tagName) {
        return ![
            'HTML',
            'HEAD',
            'BODY',
            'SCRIPT',
            'STYLE',
            'META',
            'LINK',
            'TITLE',
            'NOSCRIPT',
            'BR'
        ].includes(String(tagName || '').toUpperCase());
    }

    setHoveredElement(element) {
        if (this.hoveredElement && this.hoveredElement !== this.selectedElement) {
            this.hoveredElement.classList.remove('aetheria-design-hover');
        }
        this.hoveredElement = element;
        if (this.hoveredElement && this.hoveredElement !== this.selectedElement) {
            this.hoveredElement.classList.add('aetheria-design-hover');
        }
    }

    selectElement(element) {
        if (this.selectedElement) {
            this.selectedElement.classList.remove('aetheria-design-selected');
        }
        if (this.hoveredElement && this.hoveredElement !== element) {
            this.hoveredElement.classList.remove('aetheria-design-hover');
        }
        this.selectedElement = element;
        this.selectedElement.classList.add('aetheria-design-selected');
        this.populateInspectorFromSelection();
        this.updateStatus(`Selected <${String(element.tagName || '').toLowerCase()}>. Adjust the controls on the right and click Done when you are happy.`);
    }

    addCommentForTarget(element) {
        const targetLabel = this.describeElement(element);
        const response = window.prompt('Add a comment for this element (for AI follow-up):', `Note for ${targetLabel}: `);
        if (response === null) return;
        const note = String(response || '').trim();
        if (!note) return;

        this.commentCounter += 1;
        this.comments.push({
            id: this.commentCounter,
            target: targetLabel,
            note,
        });
        this.renderComments();
        this.updateStatus(`Comment saved for ${targetLabel}.`);
    }

    renderComments() {
        if (!this.el.commentsList || !this.el.commentsEmpty) return;
        this.el.commentsList.innerHTML = '';

        if (!this.comments.length) {
            this.el.commentsEmpty.style.display = 'block';
            return;
        }

        this.el.commentsEmpty.style.display = 'none';
        this.comments.forEach((entry) => {
            const item = document.createElement('div');
            item.className = 'design-mode-comment-item';

            const target = document.createElement('div');
            target.className = 'design-mode-comment-target';
            target.textContent = entry.target;

            const text = document.createElement('div');
            text.className = 'design-mode-comment-text';
            text.textContent = entry.note;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'design-mode-comment-remove';
            removeBtn.type = 'button';
            removeBtn.textContent = 'Remove';
            removeBtn.addEventListener('click', () => {
                this.comments = this.comments.filter((itemEntry) => itemEntry.id !== entry.id);
                this.renderComments();
            });

            item.appendChild(target);
            item.appendChild(text);
            item.appendChild(removeBtn);
            this.el.commentsList.appendChild(item);
        });
    }

    populateInspectorFromSelection() {
        const el = this.selectedElement;
        if (!el) {
            this.resetInspector();
            return;
        }

        const computed = this.previewWindow.getComputedStyle(el);
        const label = this.describeElement(el);
        this.el.selectionLabel.textContent = label;
        this.el.textInput.disabled = !this.canEditText(el);
        this.el.textInput.value = this.canEditText(el) ? el.textContent.trim() : '';
        this.el.textColor.value = this.toHexColor(computed.color, '#111827');
        this.el.bgColor.value = this.toHexColor(computed.backgroundColor, '#ffffff');
        
        this.el.radiusInput.value = this.simplifyValue(computed.borderRadius);
        this.el.paddingInput.value = this.simplifyValue(computed.padding) || this.simplifyValue(computed.paddingTop);
        this.el.marginInput.value = this.simplifyValue(computed.margin) || this.simplifyValue(computed.marginTop);
        this.el.fontSizeInput.value = this.parsePixelValue(computed.fontSize);
        
        const fontWeight = String(computed.fontWeight || '');
        this.el.fontWeightInput.value = fontWeight && !isNaN(fontWeight) ? fontWeight : '';
        
        const lineHeight = String(computed.lineHeight || '');
        this.el.lineHeightInput.value = lineHeight === 'normal' ? '' : this.parsePixelValue(lineHeight) || lineHeight;
        
        this.el.textAlignInput.value = computed.textAlign !== 'start' ? (computed.textAlign || '') : 'left';
        this.el.displayInput.value = computed.display || '';
        this.el.flexDirInput.value = computed.flexDirection || '';

        const opacityVal = computed.opacity || '1';
        this.el.opacityInput.value = opacityVal;
        if (this.el.opacityValue) this.el.opacityValue.textContent = opacityVal;

        if (this.el.letterSpacingInput) this.el.letterSpacingInput.value = this.parsePixelValue(computed.letterSpacing) || '';
        if (this.el.widthInput) this.el.widthInput.value = this.simplifyValue(computed.width) || '';
        if (this.el.heightInput) this.el.heightInput.value = this.simplifyValue(computed.height) || '';
        if (this.el.gapInput) this.el.gapInput.value = this.simplifyValue(computed.gap) || '';
        if (this.el.borderWidthInput) this.el.borderWidthInput.value = this.simplifyValue(computed.borderTopWidth) || '';
        if (this.el.borderStyleInput) this.el.borderStyleInput.value = computed.borderTopStyle !== 'none' ? (computed.borderTopStyle || '') : '';
        if (this.el.borderColorInput) this.el.borderColorInput.value = this.toHexColor(computed.borderTopColor, '#333333');
        if (this.el.overflowInput) this.el.overflowInput.value = computed.overflow || '';
    }

    resetInspector() {
        this.el.selectionLabel.textContent = this.mode === 'comment' ? 'Comment mode: click an element' : 'No element selected';
        this.el.textInput.value = '';
        this.el.textInput.disabled = true;
        this.el.textColor.value = '#111827';
        this.el.bgColor.value = '#ffffff';
        this.el.radiusInput.value = '';
        this.el.paddingInput.value = '';
        this.el.fontSizeInput.value = '';
        this.el.fontWeightInput.value = '';
        this.el.lineHeightInput.value = '';
        this.el.textAlignInput.value = '';
        this.el.displayInput.value = '';
        this.el.flexDirInput.value = '';
        this.el.marginInput.value = '';
        this.el.opacityInput.value = '1';
        if (this.el.opacityValue) this.el.opacityValue.textContent = '1';
        if (this.el.letterSpacingInput) this.el.letterSpacingInput.value = '';
        if (this.el.widthInput) this.el.widthInput.value = '';
        if (this.el.heightInput) this.el.heightInput.value = '';
        if (this.el.gapInput) this.el.gapInput.value = '';
        if (this.el.borderWidthInput) this.el.borderWidthInput.value = '';
        if (this.el.borderStyleInput) this.el.borderStyleInput.value = '';
        if (this.el.borderColorInput) this.el.borderColorInput.value = '#333333';
        if (this.el.overflowInput) this.el.overflowInput.value = '';
    }

    describeElement(element) {
        if (!element) return 'unknown';
        const tag = String(element.tagName || '').toLowerCase();
        const idPart = element.id ? `#${element.id}` : '';
        const classTokens = String(element.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        const classPart = classTokens.length ? `.${classTokens.join('.')}` : '';
        return `${tag}${idPart}${classPart}`;
    }

    canEditText(element) {
        if (!element || !element.tagName) return false;
        if (!this.allowedTextTags.has(String(element.tagName).toUpperCase())) return false;
        return element.children.length === 0;
    }

    applyUnitOrString(value, defaultUnit = '') {
        const str = String(value || '').trim();
        if (!str) return '';
        if (!isNaN(str) && defaultUnit) {
            return `${str}${defaultUnit}`;
        }
        return str;
    }

    simplifyValue(value) {
        if (!value) return '';
        const v = String(value);
        if (v === '0px' || v === '0') return '0';
        return v.replace(/px([^A-Za-z]|$)/g, '$1').trim();
    }

    normalizePxInput(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0) {
            return '0px';
        }
        return `${numeric}px`;
    }

    parsePixelValue(value) {
        const numeric = Number.parseFloat(String(value || '').replace('px', ''));
        return Number.isFinite(numeric) ? String(Math.round(numeric)) : '';
    }

    toHexColor(value, fallback) {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw || raw === 'transparent' || raw === 'rgba(0, 0, 0, 0)') {
            return fallback;
        }
        const rgbMatch = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!rgbMatch) {
            return fallback;
        }
        const [, r, g, b] = rgbMatch;
        return `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
    }

    markDirty(message) {
        this.unsavedChanges = true;
        this.updateStatus(message);
    }

    updateStatus(message) {
        if (this.el.status) {
            this.el.status.textContent = message;
        }
        if (this.el.subtitle) {
            this.el.subtitle.textContent = message;
        }
    }

    serializeDocument() {
        if (!this.previewDocument) {
            throw new Error('Preview document is unavailable.');
        }
        if (this.hoveredElement) this.hoveredElement.classList.remove('aetheria-design-hover');
        if (this.selectedElement) this.selectedElement.classList.remove('aetheria-design-selected');

        this.previewDocument.getElementById(this.helperStyleId)?.remove();
        this.previewDocument.getElementById(this.helperBaseId)?.remove();

        return `<!DOCTYPE html>\n${this.previewDocument.documentElement.outerHTML}`;
    }

    async saveChanges() {
        if (!this.indexPath || !this.previewDocument) {
            this.updateStatus('Nothing to save yet.');
            return;
        }

        try {
            const output = this.serializeDocument();
            await window.electron.fs.promises.writeFile(this.indexPath, output, 'utf8');
            this.unsavedChanges = false;
            window.projectWorkspace?.setStatus?.('Design changes saved to local index.html.');
            if (typeof window.projectWorkspace?.syncWorkspaceTree === 'function') {
                await window.projectWorkspace.syncWorkspaceTree();
            }
            this.close({ force: true });
        } catch (error) {
            this.updateStatus(`Save failed: ${error.message}`);
        }
    }

    joinPath(root, child) {
        return window.electron?.path?.join ? window.electron.path.join(root, child) : `${String(root || '').replace(/[\\\/]+$/, '')}/${child}`;
    }

    toFileBaseHref(rootPath) {
        const normalized = String(rootPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
        if (!normalized) return 'file:///';
        return `file:///${normalized.replace(/^\/+/, '')}/`;
    }
}

const designModeController = new DesignModeController();
window.designModeController = designModeController;

export default designModeController;
