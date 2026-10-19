const languages = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', rs: 'rust',
    cs: 'csharp', sh: 'bash', zsh: 'bash', ps1: 'powershell', psm1: 'powershell', psd1: 'powershell', yml: 'yaml',
    htm: 'xml', html: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', xml: 'xml',
    md: 'markdown', markdown: 'markdown', mdx: 'markdown', h: 'cpp', cc: 'cpp',
    hpp: 'cpp', c: 'c', dockerfile: 'dockerfile', toml: 'ini', env: 'ini', proto: 'protobuf', tex: 'latex',
    ex: 'elixir', exs: 'elixir', hs: 'haskell', jsonc: 'json', json5: 'json',
};
const extraLanguages = new Set(['powershell', 'dockerfile', 'protobuf', 'nix', 'dart', 'elixir', 'haskell', 'scala', 'groovy', 'cmake', 'latex']);
const previewTypes = { md: 'markdown', markdown: 'markdown', mmd: 'mermaid', mermaid: 'mermaid', html: 'html', htm: 'html', svg: 'html' };
let diagramId = 0;

export class ProjectFileViewer {
    constructor(container, closeButton) {
        this.container = container;
        this.revision = 0;
        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'project-file-view-toggle project-main-file-preview-close t-icon-swap';
        this.button.hidden = true;
        this.button.innerHTML = '<svg class="t-icon" data-icon="a" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="t-icon" data-icon="b" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/></svg>';
        closeButton.before(this.button);
        this.button.addEventListener('click', () => {
            this.mode = this.mode === 'preview' ? 'source' : 'preview';
            void this.render();
        });
    }

    clear(message = '') {
        this.revision += 1;
        this.button.hidden = true;
        this.container.classList.remove('is-formatted', 'project-file-diagram');
        this.container.textContent = message;
    }

    show(path, content, truncated = false) {
        const name = path.split('/').pop().toLowerCase();
        const extension = name.includes('.') ? name.split('.').pop() : name;
        this.language = languages[extension] || extension;
        if (/^dockerfile(?:\.|$)/.test(name)) this.language = 'dockerfile';
        if (name === 'cmakelists.txt') this.language = 'cmake';
        this.type = previewTypes[extension];
        this.content = content;
        this.truncated = truncated;
        this.mode = 'source';
        this.button.hidden = !this.type || truncated;
        return this.render();
    }

    async highlight(code, language) {
        code.classList.add('hljs');
        if (code.textContent.length <= 100000 && !window.hljs?.getLanguage(language) && extraLanguages.has(language)) {
            try {
                const grammar = await import(`../node_modules/highlight.js/es/languages/${language}.js`);
                window.hljs.registerLanguage(language, grammar.default);
            } catch (error) {
                console.warn(`[ProjectFileViewer] Unable to load ${language} highlighting:`, error.message);
            }
        }
        if (code.textContent.length > 100000 || !window.hljs?.getLanguage(language)) return;
        code.innerHTML = window.hljs.highlight(code.textContent, { language, ignoreIllegals: true }).value;
    }

    async render() {
        const revision = ++this.revision;
        const preview = this.mode === 'preview';
        this.button.dataset.state = preview ? 'b' : 'a';
        this.button.setAttribute('aria-pressed', String(preview));
        this.button.setAttribute('aria-label', preview ? 'Show source' : 'Show formatted preview');
        this.button.title = preview ? 'Show source' : 'Show formatted preview';
        this.container.classList.toggle('is-formatted', preview);
        this.container.classList.remove('project-file-diagram');
        this.container.replaceChildren();
        if (!preview) {
            const code = document.createElement('code');
            code.textContent = this.content;
            const pre = document.createElement('pre');
            pre.append(code);
            this.container.append(pre);
            await this.highlight(code, this.language);
            if (revision !== this.revision) return;
            if (this.truncated) this.notice('Preview truncated for large file.');
            else if (this.content.length > 100000) this.notice('Large file shown without syntax highlighting.');
            return;
        }
        try {
            if (this.type === 'html') {
                const frame = document.createElement('iframe');
                frame.title = 'Formatted file preview';
                frame.setAttribute('sandbox', '');
                frame.referrerPolicy = 'no-referrer';
                // No scripts, network requests, forms, or parent access in project HTML.
                const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'";
                const sanitized = window.DOMPurify.sanitize(this.content, { WHOLE_DOCUMENT: true, FORBID_TAGS: ['meta', 'base', 'iframe', 'object', 'embed', 'a', 'form'] });
                frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html{color-scheme:${document.body.classList.contains('dark-mode') ? 'dark' : 'light'}}body{margin:16px}img,svg{max-width:100%}</style>${sanitized}`;
                this.container.append(frame);
            } else if (this.type === 'mermaid') {
                await this.diagram(this.content, this.container, revision);
            } else {
                // A private parser avoids the chat formatter's global artifact renderer.
                const parser = new window.marked.Marked({ gfm: true, breaks: false });
                const article = document.createElement('article');
                article.className = 'project-file-markdown';
                article.innerHTML = window.DOMPurify.sanitize(parser.parse(this.content), {
                    FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'input', 'style'],
                    FORBID_ATTR: ['src', 'srcset', 'href', 'xlink:href'],
                });
                this.container.append(article);
                for (const code of article.querySelectorAll('pre code')) {
                    const language = code.className.match(/language-([\w-]+)/)?.[1];
                    if (language === 'mermaid') await this.diagram(code.textContent, code.parentElement, revision);
                    else await this.highlight(code, languages[language] || language);
                    if (revision !== this.revision) return;
                }
            }
        } catch (error) {
            if (revision !== this.revision) return;
            this.container.replaceChildren();
            this.notice(`Preview unavailable: ${error.message}. Use Show source to view the file.`);
        }
    }

    notice(text) {
        const message = document.createElement('p');
        message.className = 'project-file-view-notice';
        message.setAttribute('role', 'status');
        message.textContent = text;
        this.container.append(message);
    }

    async diagram(source, target, revision) {
        if (source.length > 50000) throw new Error('Diagram exceeds the preview size limit');
        const mermaid = window.loadRendererFeature ? await window.loadRendererFeature('mermaid') : window.mermaid;
        if (revision !== this.revision) return;
        const previousConfig = mermaid.mermaidAPI.getSiteConfig();
        const scratch = document.createElement('div');
        scratch.className = 'project-file-diagram-scratch';
        document.body.append(scratch);
        try {
            mermaid.initialize({ startOnLoad: false, securityLevel: 'strict',
                secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'theme', 'themeVariables', 'themeCSS', 'fontFamily', 'flowchart'],
                theme: document.body.classList.contains('dark-mode') ? 'dark' : 'default',
                flowchart: { htmlLabels: false }, maxTextSize: 50000 });
            const { svg } = await mermaid.render(`project-diagram-${++diagramId}`, source, scratch);
            if (revision !== this.revision) return;
            target.innerHTML = window.DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'a'] });
            target.classList.add('project-file-diagram');
        } finally {
            scratch.remove();
            mermaid.initialize(previousConfig);
        }
    }
}
