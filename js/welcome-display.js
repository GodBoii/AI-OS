import UserProfileService from './user-profile-service.js';
import {
    PRESENTATION_TEMPLATES,
    clearSelectedPresentationTemplate,
    getSelectedPresentationTemplate,
    setSelectedPresentationTemplate
} from './presentation-templates.js';

/* ═══════════════════════════════════════════════════════════════════
   PILL CONFIGURATION
   ═══════════════════════════════════════════════════════════════════ */
const PILL_CONFIG = [
    { key: 'templates', icon: 'fa-regular fa-file-powerpoint', label: 'Create slides' },
    { key: 'website', icon: 'fa-solid fa-laptop-code', label: 'Build website' },
    { key: 'sessions', icon: 'fa-regular fa-clock', label: 'Past Chats' },
    { key: 'tasks', icon: 'fa-regular fa-circle-check', label: 'Tasks' },
    { key: 'design', icon: 'fa-solid fa-palette', label: 'Design' }
];

/* ═══════════════════════════════════════════════════════════════════
   CAROUSEL SLIDES — Auto-rotating feature showcase
   ═══════════════════════════════════════════════════════════════════ */
const CAROUSEL_SLIDES = [
    {
        title: 'Create Presentations',
        desc: 'Design stunning slide decks with 8 professional templates and AI-powered content generation.',
        icon: 'fa-regular fa-file-powerpoint'
    },
    {
        title: 'Build & Deploy',
        desc: 'Full-stack web development with live preview and one-click deployment to production.',
        icon: 'fa-solid fa-rocket'
    },
    {
        title: 'Computer Agent',
        desc: 'AI-powered desktop automation that sees and controls your screen natively.',
        icon: 'fa-solid fa-desktop'
    },
    {
        title: 'Coder Workspace',
        desc: 'Write, debug, and ship code with an integrated cloud and local development environment.',
        icon: 'fa-solid fa-code'
    }
];

/* ═══════════════════════════════════════════════════════════════════
   PROMPT STARTERS — Website & Design
   ═══════════════════════════════════════════════════════════════════ */
const WEBSITE_PROMPTS = [
    { icon: 'fa-solid fa-window-maximize', title: 'Landing Page', desc: 'Modern responsive landing page', prompt: 'Create a modern, responsive landing page with a hero section, feature highlights, testimonials, and a call-to-action footer.' },
    { icon: 'fa-solid fa-briefcase', title: 'Portfolio', desc: 'Personal portfolio website', prompt: 'Build a personal portfolio website with a project showcase grid, about section, skills display, and contact form.' },
    { icon: 'fa-solid fa-chart-line', title: 'Dashboard', desc: 'Admin analytics dashboard', prompt: 'Design an admin dashboard with interactive charts, data tables, sidebar navigation, and notification center.' },
    { icon: 'fa-solid fa-store', title: 'E-commerce', desc: 'Product catalog with cart', prompt: 'Build a product catalog page with category filters, search functionality, product cards with ratings, and a shopping cart drawer.' }
];

const DESIGN_PROMPTS = [
    { icon: 'fa-solid fa-mobile-screen', title: 'Mobile App UI', desc: 'App interface with navigation', prompt: 'Design a mobile app interface with bottom tab navigation, card-based content layout, and smooth transitions.' },
    { icon: 'fa-solid fa-right-to-bracket', title: 'Auth Flow', desc: 'Login and signup screens', prompt: 'Create a modern authentication flow with login, signup, and forgot password screens using glassmorphism design.' },
    { icon: 'fa-solid fa-sliders', title: 'Settings Page', desc: 'Clean settings with controls', prompt: 'Design a clean settings page with toggle switches, dropdown selectors, and organized preference sections.' },
    { icon: 'fa-solid fa-chart-pie', title: 'Data Visualization', desc: 'Analytics with charts', prompt: 'Create an analytics dashboard with interactive pie charts, line graphs, metric cards, and data filtering controls.' }
];

const CAROUSEL_INTERVAL_MS = 5000;

/* ═══════════════════════════════════════════════════════════════════
   WELCOME DISPLAY CLASS
   ═══════════════════════════════════════════════════════════════════ */
class WelcomeDisplay {
    constructor() {
        this.isVisible = false;
        this.username = null;
        this.welcomeElement = null;
        this.suggestionsWrapper = null;
        this.initialized = false;
        this.userProfileService = new UserProfileService();
        this.hiddenByFloatingWindow = false;
        this.recentSessions = [];
        this.recentTasks = [];
        this.handleInputChange = this.handleInputChange.bind(this);
        this.templateDrawer = null;

        /* New state for pills + carousel */
        this.activePill = null;
        this.carouselIndex = 0;
        this.carouselTimer = null;
        this.pillsRow = null;
        this.carouselContainer = null;
        this.pillContentContainer = null;
    }

    /* ───────────────────────────────────────────────────────────────
       INITIALIZATION
       ─────────────────────────────────────────────────────────────── */
    initialize() {
        if (this.initialized) return;

        this.createWelcomeElement();
        this.createCardRail();
        this.fetchUsername();
        this.bindEvents();
        this.loadDynamicData();
        this.initialized = true;

        setTimeout(() => {
            this.updateDisplay();
        }, 100);

        console.log('WelcomeDisplay initialized successfully');
    }

    /* ───────────────────────────────────────────────────────────────
       WELCOME HEADING (unchanged)
       ─────────────────────────────────────────────────────────────── */
    createWelcomeElement() {
        this.welcomeElement = document.createElement('div');
        this.welcomeElement.className = 'welcome-container hidden';
        this.welcomeElement.setAttribute('role', 'banner');
        this.welcomeElement.setAttribute('aria-live', 'polite');

        const welcomeContent = document.createElement('div');
        welcomeContent.className = 'welcome-content';

        const heading = document.createElement('h1');
        heading.className = 'welcome-heading';
        heading.id = 'welcome-heading';
        heading.textContent = 'Hello there';

        const secondaryHeading = document.createElement('h2');
        secondaryHeading.className = 'welcome-secondary-heading';
        secondaryHeading.id = 'welcome-secondary-heading';
        secondaryHeading.textContent = 'What can I do for you?';

        welcomeContent.appendChild(heading);
        welcomeContent.appendChild(secondaryHeading);
        this.welcomeElement.appendChild(welcomeContent);

        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.appendChild(this.welcomeElement);
        }
    }

    /* ───────────────────────────────────────────────────────────────
       CARD RAIL — Pills + Carousel + Pill Content
       ─────────────────────────────────────────────────────────────── */
    createCardRail() {
        this.suggestionsWrapper = document.createElement('div');
        this.suggestionsWrapper.className = 'home-suggestions-wrapper hidden';
        this.suggestionsWrapper.id = 'home-suggestions-wrapper';
        this.suggestionsWrapper.setAttribute('role', 'complementary');
        this.suggestionsWrapper.setAttribute('aria-label', 'Welcome overview');

        /* 1 ─ Pills row */
        this.pillsRow = document.createElement('div');
        this.pillsRow.className = 'home-pills-row';

        PILL_CONFIG.forEach((pill) => {
            const btn = document.createElement('button');
            btn.className = 'home-pill';
            btn.type = 'button';
            btn.dataset.pill = pill.key;
            btn.innerHTML = `<i class="${pill.icon}" aria-hidden="true"></i><span>${pill.label}</span>`;
            btn.addEventListener('click', () => this.onPillClick(pill.key));
            this.pillsRow.appendChild(btn);
        });

        this.suggestionsWrapper.appendChild(this.pillsRow);

        /* 2 ─ Carousel (visible in default state, appended independently for bottom positioning) */
        this.carouselContainer = document.createElement('div');
        this.carouselContainer.className = 'home-carousel hidden';
        this.buildCarousel();

        /* 3 ─ Pill content area (hidden by default) */
        this.pillContentContainer = document.createElement('div');
        this.pillContentContainer.className = 'home-pill-content hidden';
        this.suggestionsWrapper.appendChild(this.pillContentContainer);

        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.appendChild(this.suggestionsWrapper);
            appContainer.appendChild(this.carouselContainer);
        }
    }

    /* ═══════════════════════════════════════════════════════════════
       CAROUSEL — Auto-rotating feature showcase
       ═══════════════════════════════════════════════════════════════ */
    buildCarousel() {
        const slidesHtml = CAROUSEL_SLIDES.map((slide, i) => `
            <div class="carousel-slide ${i === 0 ? 'active' : ''}" data-slide="${i}">
                <div class="carousel-slide-copy">
                    <h4>${slide.title}</h4>
                    <p>${slide.desc}</p>
                </div>
                <div class="carousel-slide-icon">
                    <i class="${slide.icon}" aria-hidden="true"></i>
                </div>
            </div>
        `).join('');

        const dotsHtml = CAROUSEL_SLIDES.map((_, i) => `
            <button class="carousel-dot ${i === 0 ? 'active' : ''}" data-dot="${i}" type="button" aria-label="Go to slide ${i + 1}"></button>
        `).join('');

        this.carouselContainer.innerHTML = `
            <div class="carousel-track">${slidesHtml}</div>
            <div class="carousel-dots">${dotsHtml}</div>
        `;

        this.carouselContainer.querySelectorAll('.carousel-dot').forEach((dot) => {
            dot.addEventListener('click', () => {
                this.goToSlide(parseInt(dot.dataset.dot, 10));
            });
        });
    }

    goToSlide(index) {
        this.carouselIndex = index;
        const slides = this.carouselContainer.querySelectorAll('.carousel-slide');
        const dots = this.carouselContainer.querySelectorAll('.carousel-dot');
        slides.forEach((s, i) => s.classList.toggle('active', i === index));
        dots.forEach((d, i) => d.classList.toggle('active', i === index));
        this.resetCarouselTimer();
    }

    startCarousel() {
        if (this.carouselTimer) return;
        this.carouselTimer = setInterval(() => {
            const next = (this.carouselIndex + 1) % CAROUSEL_SLIDES.length;
            this.goToSlide(next);
        }, CAROUSEL_INTERVAL_MS);
    }

    stopCarousel() {
        if (this.carouselTimer) {
            clearInterval(this.carouselTimer);
            this.carouselTimer = null;
        }
    }

    resetCarouselTimer() {
        this.stopCarousel();
        this.startCarousel();
    }

    /* ═══════════════════════════════════════════════════════════════
       PILLS — Toggle logic
       ═══════════════════════════════════════════════════════════════ */
    onPillClick(key) {
        if (this.activePill === key) {
            /* Deselect → restore carousel */
            this.activePill = null;
            this.pillsRow.querySelectorAll('.home-pill').forEach((p) => p.classList.remove('active'));
            this.pillContentContainer.classList.add('hidden');
            this.pillContentContainer.innerHTML = '';
            this.carouselContainer.classList.remove('hidden');
            this.startCarousel();
        } else {
            /* Select new pill */
            this.activePill = key;
            this.pillsRow.querySelectorAll('.home-pill').forEach((p) => {
                p.classList.toggle('active', p.dataset.pill === key);
            });
            this.stopCarousel();
            this.carouselContainer.classList.add('hidden');
            this.renderPillContent(key);
            this.pillContentContainer.classList.remove('hidden');
        }
    }

    /* ═══════════════════════════════════════════════════════════════
       PILL CONTENT RENDERING — Context-specific UI per pill
       ═══════════════════════════════════════════════════════════════ */
    renderPillContent(key) {
        let html = '';
        switch (key) {
            case 'templates':
                html = this.getTemplatesScrollHtml();
                break;
            case 'website':
                html = this.getWebsiteStartersHtml();
                break;
            case 'design':
                html = this.getDesignStartersHtml();
                break;
            case 'sessions':
                html = this.getSessionsListHtml();
                break;
            case 'tasks':
                html = this.getTasksListHtml();
                break;
        }
        this.pillContentContainer.innerHTML = html;
        this.bindPillContentEvents(key);
    }

    bindPillContentEvents(key) {
        if (key === 'templates') {
            /* Template card body click → select template */
            this.pillContentContainer.querySelectorAll('.template-scroll-card').forEach((card) => {
                card.addEventListener('click', (e) => {
                    if (e.target.closest('.template-preview-btn')) return;
                    const id = card.dataset.templateId;
                    const selected = getSelectedPresentationTemplate();
                    if (selected?.id === id) {
                        clearSelectedPresentationTemplate();
                    } else {
                        this.selectTemplate(id);
                    }
                });
            });
            /* Preview eye-icon click → open focused preview for THIS template */
            this.pillContentContainer.querySelectorAll('.template-preview-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const templateId = btn.dataset.previewId;
                    this.openTemplatePreview(templateId);
                });
            });
            /* Scroll arrows */
            const scrollRow = this.pillContentContainer.querySelector('.templates-scroll-row');
            const leftArrow = this.pillContentContainer.querySelector('.scroll-arrow-left');
            const rightArrow = this.pillContentContainer.querySelector('.scroll-arrow-right');
            if (scrollRow && leftArrow && rightArrow) {
                const scrollAmount = 280;
                leftArrow.addEventListener('click', () => {
                    scrollRow.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
                });
                rightArrow.addEventListener('click', () => {
                    scrollRow.scrollBy({ left: scrollAmount, behavior: 'smooth' });
                });
                const updateArrows = () => {
                    leftArrow.classList.toggle('hidden', scrollRow.scrollLeft <= 4);
                    rightArrow.classList.toggle('hidden', scrollRow.scrollLeft + scrollRow.clientWidth >= scrollRow.scrollWidth - 4);
                };
                scrollRow.addEventListener('scroll', updateArrows);
                setTimeout(updateArrows, 60);
            }
        }

        if (key === 'website' || key === 'design') {
            this.pillContentContainer.querySelectorAll('.prompt-card').forEach((card) => {
                card.addEventListener('click', () => {
                    const prompt = card.dataset.prompt;
                    const input = document.getElementById('floating-input');
                    if (input && prompt) {
                        input.value = prompt;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        this.focusInput();
                    }
                });
            });
        }

        if (key === 'sessions') {
            this.pillContentContainer.querySelectorAll('[data-session-id]').forEach((btn) => {
                btn.addEventListener('click', () => this.openSessionHistory(btn.dataset.sessionId));
            });
        }

        if (key === 'tasks') {
            this.pillContentContainer.querySelectorAll('[data-action="open-tasks"]').forEach((btn) => {
                btn.addEventListener('click', () => this.openTasksPanel());
            });
        }
    }

    /* ═══════════════════════════════════════════════════════════════
       CONTENT GENERATORS
       ═══════════════════════════════════════════════════════════════ */

    /* ── Templates: Horizontal scroll row ── */
    getTemplatesScrollHtml() {
        const selected = getSelectedPresentationTemplate();
        const cardsHtml = PRESENTATION_TEMPLATES.map((t) => {
            const isSelected = selected?.id === t.id;
            const colors = t.colors || [];
            return `
                <div class="template-scroll-card ${isSelected ? 'selected' : ''}" data-template-id="${this.escapeHtml(t.id)}">
                    <div class="template-scroll-canvas-wrap">
                        <span class="ppt-template-canvas" style="--ppt-bg:${colors[0]};--ppt-a:${colors[1]};--ppt-b:${colors[2]};--ppt-c:${colors[3]};">
                            <span class="ppt-template-line title"></span>
                            <span class="ppt-template-line short"></span>
                            <span class="ppt-template-bars"><i></i><i></i><i></i></span>
                        </span>
                        <button class="template-preview-btn" data-preview-id="${this.escapeHtml(t.id)}" title="Preview slide layouts" type="button">
                            <i class="fa-regular fa-eye" aria-hidden="true"></i>
                        </button>
                        ${isSelected ? '<span class="template-selected-badge"><i class="fa-solid fa-check" aria-hidden="true"></i></span>' : ''}
                    </div>
                    <div class="template-scroll-info">
                        <strong>${this.escapeHtml(t.name)}</strong>
                        <small>${this.escapeHtml(t.description)}</small>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="templates-scroll-wrapper">
                <button class="scroll-arrow scroll-arrow-left hidden" type="button" aria-label="Scroll left"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                <div class="templates-scroll-row">${cardsHtml}</div>
                <button class="scroll-arrow scroll-arrow-right" type="button" aria-label="Scroll right"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
            </div>
            <div class="templates-scroll-hint">Select a template before asking for slides, or let AI choose automatically.</div>
        `;
    }

    /* ── Website prompt starters ── */
    getWebsiteStartersHtml() {
        return `<div class="prompt-grid">${WEBSITE_PROMPTS.map((p) => this.getPromptCardHtml(p)).join('')}</div>`;
    }

    /* ── Design prompt starters ── */
    getDesignStartersHtml() {
        return `<div class="prompt-grid">${DESIGN_PROMPTS.map((p) => this.getPromptCardHtml(p)).join('')}</div>`;
    }

    getPromptCardHtml(p) {
        return `
            <button class="prompt-card" data-prompt="${this.escapeHtml(p.prompt)}" type="button">
                <div class="prompt-card-icon"><i class="${p.icon}" aria-hidden="true"></i></div>
                <div class="prompt-card-copy">
                    <strong>${this.escapeHtml(p.title)}</strong>
                    <small>${this.escapeHtml(p.desc)}</small>
                </div>
            </button>
        `;
    }

    /* ── Sessions list ── */
    getSessionsListHtml() {
        if (!this.recentSessions.length) {
            return `<div class="welcome-card-empty">No recent conversations yet. Once you start chatting, your latest sessions will appear here automatically.</div>`;
        }
        return `
            <div class="welcome-list">
                ${this.recentSessions.map((session) => `
                    <button type="button" class="welcome-list-item" data-session-id="${this.escapeHtml(session.session_id)}">
                        <span class="welcome-list-copy">
                            <span class="welcome-list-title">${this.escapeHtml(session.session_title || `Session ${session.session_id.slice(0, 8)}`)}</span>
                            <span class="welcome-list-meta">${this.escapeHtml(this.getTimeAgo(session.created_at))}</span>
                        </span>
                        <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                    </button>
                `).join('')}
            </div>
        `;
    }

    /* ── Tasks list ── */
    getTasksListHtml() {
        const listHtml = !this.recentTasks.length
            ? `<div class="welcome-card-empty">No recent tasks yet. Tasks will appear here once you create them.</div>`
            : `<div class="welcome-list">
                ${this.recentTasks.map((task) => `
                    <button type="button" class="welcome-list-item" data-action="open-tasks">
                        <span class="welcome-list-copy">
                            <span class="welcome-list-title">${this.escapeHtml(task.text || 'Untitled task')}</span>
                            <span class="welcome-list-meta">${this.escapeHtml(this.getTaskMeta(task))}</span>
                        </span>
                        <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                    </button>
                `).join('')}
            </div>`;

        return `
            <div class="home-tasks-content">
                ${listHtml}
                <div class="home-tasks-footer">
                    <button type="button" class="welcome-card-action" data-action="open-tasks">Open Tasks Panel</button>
                </div>
            </div>
        `;
    }

    /* ═══════════════════════════════════════════════════════════════
       TEMPLATE PREVIEW HTML — Used by template drawer
       (preserved from original code)
       ═══════════════════════════════════════════════════════════════ */
    getTemplatePreviewHtml(template, selected = false, size = 'full') {
        const colors = template.colors || [];
        return `
            <button type="button" class="ppt-template-preview ${size === 'mini' ? 'mini' : ''} ${selected ? 'selected' : ''}" data-template-id="${this.escapeHtml(template.id)}">
                <span class="ppt-template-canvas" style="--ppt-bg:${colors[0]};--ppt-a:${colors[1]};--ppt-b:${colors[2]};--ppt-c:${colors[3]};">
                    <span class="ppt-template-line title"></span>
                    <span class="ppt-template-line short"></span>
                    <span class="ppt-template-bars"><i></i><i></i><i></i></span>
                </span>
                <span class="ppt-template-copy">
                    <strong>${this.escapeHtml(template.name)}</strong>
                    ${size === 'mini' ? '' : `<small>${this.escapeHtml(template.description)}</small>`}
                </span>
            </button>
        `;
    }

    /* ═══════════════════════════════════════════════════════════════
       SLIDE CANVAS HTML — Used by template drawer slide previews
       (preserved from original code)
       ═══════════════════════════════════════════════════════════════ */
    getSlideCanvasHtml(layout, colors) {
        const style = `--ppt-bg:${colors[0]};--ppt-a:${colors[1]};--ppt-b:${colors[2]};--ppt-c:${colors[3]};`;
        const layouts = {
            'title': `
                <span class="ppt-slide-canvas layout-title" style="${style}">
                    <span class="sc-kicker"></span>
                    <span class="sc-title-lg"></span>
                    <span class="sc-subtitle"></span>
                    <span class="sc-arc"></span>
                </span>`,
            'bullets': `
                <span class="ppt-slide-canvas layout-bullets" style="${style}">
                    <span class="sc-kicker"></span>
                    <span class="sc-title-sm"></span>
                    <span class="sc-bullet"></span>
                    <span class="sc-bullet short"></span>
                    <span class="sc-bullet"></span>
                    <span class="sc-bullet short"></span>
                    <span class="sc-callout"></span>
                </span>`,
            'two-col': `
                <span class="ppt-slide-canvas layout-twocol" style="${style}">
                    <span class="sc-kicker"></span>
                    <span class="sc-title-sm"></span>
                    <span class="sc-col left"></span>
                    <span class="sc-col right"></span>
                </span>`,
            'chart': `
                <span class="ppt-slide-canvas layout-chart" style="${style}">
                    <span class="sc-kicker"></span>
                    <span class="sc-title-sm"></span>
                    <span class="sc-bar b1"></span>
                    <span class="sc-bar b2"></span>
                    <span class="sc-bar b3"></span>
                    <span class="sc-bar b4"></span>
                </span>`,
            'table': `
                <span class="ppt-slide-canvas layout-table" style="${style}">
                    <span class="sc-kicker"></span>
                    <span class="sc-title-sm"></span>
                    <span class="sc-table-header"></span>
                    <span class="sc-table-row"></span>
                    <span class="sc-table-row alt"></span>
                    <span class="sc-table-row"></span>
                </span>`,
            'flow': `
                <span class="ppt-slide-canvas layout-flow" style="${style}">
                    <span class="sc-kicker"></span>
                    <span class="sc-title-sm"></span>
                    <span class="sc-flow-row">
                        <span class="sc-flow-box"></span>
                        <span class="sc-flow-arrow"></span>
                        <span class="sc-flow-box"></span>
                        <span class="sc-flow-arrow"></span>
                        <span class="sc-flow-box"></span>
                    </span>
                </span>`,
            'visual': `
                <span class="ppt-slide-canvas layout-visual" style="${style}">
                    <span class="sc-kicker"></span>
                    <span class="sc-title-sm"></span>
                    <span class="sc-image-placeholder"></span>
                    <span class="sc-caption"></span>
                </span>`
        };
        return layouts[layout] || layouts['bullets'];
    }

    /* ═══════════════════════════════════════════════════════════════
       EVENTS
       ═══════════════════════════════════════════════════════════════ */
    bindEvents() {
        document.addEventListener('messageAdded', () => {
            this.loadDynamicData();
            this.updateDisplay();
        });

        document.addEventListener('conversationCleared', () => {
            this.loadDynamicData();
            this.updateDisplay();
        });

        const input = document.getElementById('floating-input');
        input?.addEventListener('input', this.handleInputChange);

        window.addEventListener('presentation-template:selected', () => {
            /* Re-render templates scroll if that pill is active */
            if (this.activePill === 'templates') {
                this.renderPillContent('templates');
            }
            /* Always re-render the full template drawer if open */
            this.renderTemplateDrawer();
        });
    }

    handleInputChange() {
        this.syncPromptCard();
    }

    /* ═══════════════════════════════════════════════════════════════
       DATA LOADING (preserved)
       ═══════════════════════════════════════════════════════════════ */
    async fetchUsername() {
        try {
            const username = await this.userProfileService.getUserName();
            this.updateUsername(username);
        } catch (error) {
            console.warn('Could not fetch username:', error);
            this.updateUsername('there');
        }
    }

    updateUsername(username) {
        this.username = username;
        const heading = this.welcomeElement?.querySelector('.welcome-heading');
        if (heading) {
            heading.textContent = `Hello ${username}`;
        }
    }

    async loadDynamicData() {
        await Promise.allSettled([
            this.loadRecentSessions(),
            this.loadRecentTasks()
        ]);
        /* Re-render active pill content if sessions or tasks changed */
        if (this.activePill === 'sessions' || this.activePill === 'tasks') {
            this.renderPillContent(this.activePill);
        }
    }

    async loadRecentSessions() {
        try {
            if (!window.electron?.auth?.fetchSessionTitles) {
                this.recentSessions = [];
                return;
            }
            const session = await window.electron.auth.getSession();
            if (!session?.access_token) {
                this.recentSessions = [];
                return;
            }
            const sessions = await window.electron.auth.fetchSessionTitles(6, 0);
            this.recentSessions = Array.isArray(sessions) ? sessions.slice(0, 6) : [];
        } catch (error) {
            console.warn('WelcomeDisplay: Failed to load sessions', error);
            this.recentSessions = [];
        }
    }

    async loadRecentTasks() {
        try {
            if (!window.electron?.tasks?.list) {
                this.recentTasks = [];
                return;
            }
            const tasks = await window.electron.tasks.list();
            this.recentTasks = Array.isArray(tasks) ? tasks.slice(0, 3) : [];
        } catch (error) {
            console.warn('WelcomeDisplay: Failed to load tasks', error);
            this.recentTasks = [];
        }
    }

    syncPromptCard() {
        /* Re-render templates if that pill is currently active */
        if (this.activePill === 'templates') {
            this.renderPillContent('templates');
        }
    }

    getCurrentPromptText() {
        return document.getElementById('floating-input')?.value || '';
    }

    /* ═══════════════════════════════════════════════════════════════
       TEMPLATE SELECTION & DRAWER (preserved)
       ═══════════════════════════════════════════════════════════════ */
    focusInput() {
        const input = document.getElementById('floating-input');
        if (!input) return;
        input.focus();
        const length = input.value.length;
        input.setSelectionRange(length, length);
    }

    selectTemplate(templateId) {
        const template = setSelectedPresentationTemplate(templateId);
        if (!template) return;
        this.focusInput();
    }

    /* ── Focused preview for a single template's slide layouts ── */
    openTemplatePreview(templateId) {
        const template = PRESENTATION_TEMPLATES.find((t) => t.id === templateId);
        if (!template) return;

        const slides = Array.isArray(template.slides) ? template.slides : [];
        const colors = template.colors || [];
        const selected = getSelectedPresentationTemplate();
        const isSelected = selected?.id === template.id;

        /* Build or reuse the overlay */
        if (!this.templatePreviewOverlay) {
            this.templatePreviewOverlay = document.createElement('div');
            this.templatePreviewOverlay.className = 'template-preview-overlay';
            this.templatePreviewOverlay.addEventListener('click', (e) => {
                if (e.target === this.templatePreviewOverlay) this.closeTemplatePreview();
            });
            document.body.appendChild(this.templatePreviewOverlay);
        }

        const slidesGridHtml = slides.map((slide) => `
            <div class="ppt-slide-preview-item">
                ${this.getSlideCanvasHtml(slide.previewLayout, colors)}
                <div class="ppt-slide-preview-info">
                    <strong>${this.escapeHtml(slide.label)}</strong>
                    <small>${this.escapeHtml(slide.description)}</small>
                </div>
            </div>
        `).join('');

        this.templatePreviewOverlay.innerHTML = `
            <div class="template-preview-panel" role="dialog" aria-modal="true" aria-label="${this.escapeHtml(template.name)} slide layouts">
                <div class="template-preview-header">
                    <div class="template-preview-header-info">
                        <span class="ppt-template-canvas mini-canvas" style="--ppt-bg:${colors[0]};--ppt-a:${colors[1]};--ppt-b:${colors[2]};--ppt-c:${colors[3]};">
                            <span class="ppt-template-line title"></span>
                            <span class="ppt-template-line short"></span>
                            <span class="ppt-template-bars"><i></i><i></i><i></i></span>
                        </span>
                        <div>
                            <h3>${this.escapeHtml(template.name)}</h3>
                            <p>${this.escapeHtml(template.description)}</p>
                        </div>
                    </div>
                    <button type="button" class="template-preview-close-btn" aria-label="Close preview">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="template-preview-subtitle">${slides.length} slide layouts included</div>
                <div class="template-preview-grid">${slidesGridHtml}</div>
                <div class="template-preview-footer">
                    <button type="button" class="template-preview-select-btn ${isSelected ? 'selected' : ''}" data-select-id="${this.escapeHtml(template.id)}">
                        ${isSelected ? '<i class="fa-solid fa-check" aria-hidden="true"></i> Selected' : '<i class="fa-solid fa-check" aria-hidden="true"></i> Use this template'}
                    </button>
                </div>
            </div>
        `;

        /* Bind events inside the overlay */
        this.templatePreviewOverlay.querySelector('.template-preview-close-btn')?.addEventListener('click', () => this.closeTemplatePreview());
        this.templatePreviewOverlay.querySelector('.template-preview-select-btn')?.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.selectId;
            this.selectTemplate(id);
            this.closeTemplatePreview();
        });

        this.templatePreviewOverlay.classList.remove('hidden');
        this.templatePreviewOverlay.classList.add('visible');
    }

    closeTemplatePreview() {
        if (this.templatePreviewOverlay) {
            this.templatePreviewOverlay.classList.remove('visible');
            this.templatePreviewOverlay.classList.add('hidden');
        }
    }

    openTemplateDrawer() {
        if (!this.templateDrawer) {
            this.templateDrawer = document.createElement('div');
            this.templateDrawer.className = 'ppt-template-drawer hidden';
            this.templateDrawer.innerHTML = `
                <div class="ppt-template-drawer-panel" role="dialog" aria-modal="true" aria-label="Stock PPT templates">
                    <div class="ppt-template-drawer-header">
                        <div>
                            <h3>Stock PPT Templates</h3>
                            <p>Select a style, then ask Aetheria to create a deck.</p>
                        </div>
                        <button type="button" class="ppt-template-drawer-close" aria-label="Close template browser">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </div>
                    <div class="ppt-template-drawer-grid"></div>
                </div>
            `;
            document.body.appendChild(this.templateDrawer);
            this.templateDrawer.addEventListener('click', (event) => {
                if (event.target === this.templateDrawer) this.closeTemplateDrawer();
            });
            this.templateDrawer.querySelector('.ppt-template-drawer-close')?.addEventListener('click', () => this.closeTemplateDrawer());
        }
        this.renderTemplateDrawer();
        this.templateDrawer.classList.remove('hidden');
    }

    closeTemplateDrawer() {
        this.templateDrawer?.classList.add('hidden');
    }

    renderTemplateDrawer() {
        if (!this.templateDrawer) return;
        const selected = getSelectedPresentationTemplate();
        const grid = this.templateDrawer.querySelector('.ppt-template-drawer-grid');
        if (!grid) return;
        grid.innerHTML = PRESENTATION_TEMPLATES.map((template) => {
            const slides = Array.isArray(template.slides) ? template.slides : [];
            const isSelected = selected?.id === template.id;
            const colors = template.colors || [];
            return `
                <div class="ppt-template-drawer-item" data-drawer-template="${this.escapeHtml(template.id)}">
                    <div class="ppt-template-drawer-card">
                        ${this.getTemplatePreviewHtml(template, isSelected, 'full')}
                        <div class="ppt-template-best">${this.escapeHtml(template.bestFor)}</div>
                        ${slides.length ? `
                            <button type="button" class="ppt-slide-preview-toggle" data-toggle-slides="${this.escapeHtml(template.id)}">
                                <span>Preview ${slides.length} slide layouts</span>
                                <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                            </button>
                        ` : ''}
                    </div>
                    ${slides.length ? `
                        <div class="ppt-slide-preview-panel hidden" data-slide-panel="${this.escapeHtml(template.id)}">
                            <div class="ppt-slide-preview-grid">
                                ${slides.map((slide) => `
                                    <div class="ppt-slide-preview-item">
                                        ${this.getSlideCanvasHtml(slide.previewLayout, colors)}
                                        <div class="ppt-slide-preview-info">
                                            <strong>${this.escapeHtml(slide.label)}</strong>
                                            <small>${this.escapeHtml(slide.description)}</small>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        grid.querySelectorAll('.ppt-template-preview[data-template-id]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.selectTemplate(button.dataset.templateId);
                this.closeTemplateDrawer();
            });
        });
        grid.querySelectorAll('[data-toggle-slides]').forEach((toggle) => {
            toggle.addEventListener('click', (event) => {
                event.stopPropagation();
                const templateId = toggle.dataset.toggleSlides;
                const panel = grid.querySelector(`[data-slide-panel="${templateId}"]`);
                if (!panel) return;
                const isHidden = panel.classList.contains('hidden');
                grid.querySelectorAll('.ppt-slide-preview-panel').forEach((p) => p.classList.add('hidden'));
                grid.querySelectorAll('.ppt-slide-preview-toggle').forEach((t) => {
                    t.classList.remove('expanded');
                    t.querySelector('i')?.classList.remove('fa-chevron-up');
                    t.querySelector('i')?.classList.add('fa-chevron-down');
                });
                if (isHidden) {
                    panel.classList.remove('hidden');
                    toggle.classList.add('expanded');
                    toggle.querySelector('i')?.classList.remove('fa-chevron-down');
                    toggle.querySelector('i')?.classList.add('fa-chevron-up');
                }
            });
        });
    }

    /* ═══════════════════════════════════════════════════════════════
       NAVIGATION ACTIONS (preserved)
       ═══════════════════════════════════════════════════════════════ */
    openTasksPanel() {
        if (window.stateManager?.setState) {
            window.stateManager.setState({ isToDoListOpen: true });
        }
    }

    openSessionHistory(sessionId) {
        if (!sessionId || !window.contextHandler?.showSessionDetails) return;

        const contextWindow = document.getElementById('context-window');
        contextWindow?.classList.remove('hidden');
        window.contextHandler.isWindowOpen = true;
        window.contextHandler.openContextWindow?.();
        window.contextHandler.showSessionDetails(sessionId);

        if (window.floatingWindowManager) {
            window.floatingWindowManager.onWindowOpen('context');
        }
    }

    /* ═══════════════════════════════════════════════════════════════
       UTILITY (preserved)
       ═══════════════════════════════════════════════════════════════ */
    getTimeAgo(unixSeconds) {
        if (!unixSeconds) return 'Recently';

        const now = Date.now();
        const time = Number(unixSeconds) * 1000;
        const diffMs = Math.max(0, now - time);
        const diffMinutes = Math.floor(diffMs / 60000);

        if (diffMinutes < 1) return 'Just now';
        if (diffMinutes < 60) return `${diffMinutes}m ago`;

        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours}h ago`;

        const diffDays = Math.floor(diffHours / 24);
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;

        return new Date(time).toLocaleDateString();
    }

    getTaskMeta(task) {
        const parts = [];
        if (task.status) parts.push(task.status.replace(/_/g, ' '));
        if (task.priority) parts.push(`${task.priority} priority`);
        if (task.deadline) parts.push(`due ${new Date(task.deadline).toLocaleDateString()}`);
        return parts.join(' | ') || 'Open tasks to continue';
    }

    /* ═══════════════════════════════════════════════════════════════
       VISIBILITY — Show / Hide lifecycle
       ═══════════════════════════════════════════════════════════════ */
    show() {
        if (!this.welcomeElement || !this.suggestionsWrapper || this.isVisible) return;

        this.loadDynamicData();
        this.welcomeElement.classList.remove('hidden');
        this.welcomeElement.classList.add('visible');
        this.suggestionsWrapper.classList.remove('hidden');
        this.suggestionsWrapper.classList.add('visible');
        this.isVisible = true;

        /* Start carousel only if no pill is active */
        if (!this.activePill) {
            this.carouselContainer.classList.remove('hidden');
            this.startCarousel();
        }
    }

    hide() {
        if (!this.welcomeElement || !this.suggestionsWrapper || !this.isVisible) return;

        this.welcomeElement.classList.remove('visible');
        this.welcomeElement.classList.add('hidden');
        this.suggestionsWrapper.classList.remove('visible');
        this.suggestionsWrapper.classList.add('hidden');
        this.carouselContainer.classList.add('hidden');
        this.isVisible = false;
        this.stopCarousel();
    }

    shouldShow() {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return true;

        const activeThread =
            chatMessages.querySelector('.conversation-thread.active:not(.hidden)') ||
            chatMessages.querySelector('.conversation-thread:not(.hidden)');

        if (activeThread) {
            return activeThread.querySelectorAll('.message').length === 0;
        }

        return chatMessages.querySelectorAll('.message').length === 0;
    }

    updateDisplay() {
        if (this.shouldShow() && !this.hiddenByFloatingWindow) {
            this.show();
        } else {
            this.hide();
        }
    }

    hideForFloatingWindow() {
        this.hiddenByFloatingWindow = true;
        this.hide();
    }

    showAfterFloatingWindow() {
        this.hiddenByFloatingWindow = false;
        this.updateDisplay();
    }

    async refreshUsername() {
        console.log('WelcomeDisplay: Refreshing username due to auth state change.');
        this.userProfileService.clearCache();
        await this.fetchUsername();
        await this.loadDynamicData();
    }

    escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }
}

export default WelcomeDisplay;
