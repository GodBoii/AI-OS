// Coalesce first-use work and allow a failed load to be retried.
(() => {
    const base = document.currentScript.src;
    const loads = new Map();
    const moduleLoads = new Map();
    const moduleAttempts = new Map();
    const scripts = {
        mermaid: ['./vendor/mermaid-10.2.4.min.js', 'mermaid'],
        chart: ['../node_modules/chart.js/dist/chart.umd.js', 'Chart'],
        terminal: ['../node_modules/xterm/lib/xterm.js', 'Terminal'],
        terminalFit: ['../node_modules/@xterm/addon-fit/lib/addon-fit.js', 'FitAddon'],
        checkout: ['https://checkout.razorpay.com/v1/checkout.js', 'Razorpay'],
    };
    const modules = {
        project: ['./project-workspace.js', './github-panel.js', './design-mode.js'],
        computer: ['./computer-workspace.js'],
    };
    let mermaidConfig = {};
    const mermaidFacade = {
        initialize(config) { mermaidConfig = { ...mermaidConfig, ...config }; },
        async init(...args) {
            const library = await load('mermaid');
            return library.init(...args);
        },
    };
    function loadModule(source) {
        if (moduleLoads.has(source)) return moduleLoads.get(source);
        const url = new URL(source, base);
        const attempt = moduleAttempts.get(source) || 0;
        if (attempt) url.searchParams.set('load-retry', String(attempt));
        const promise = import(url.href).then(async module => {
            await module.default?.ready;
            return module;
        });
        moduleLoads.set(source, promise);
        promise.catch(() => {
            moduleLoads.delete(source);
            moduleAttempts.set(source, attempt + 1);
        });
        return promise;
    }
    function load(name) {
        if (loads.has(name)) return loads.get(name);
        const promise = (async () => {
            if (modules[name]) {
                const imported = await Promise.all(modules[name].map(loadModule));
                return imported[0].default;
            }
            const entry = scripts[name];
            if (!entry) throw new Error(`Unknown renderer feature: ${name}`);
            const [source, globalName] = entry;
            if (window[globalName] && window[globalName] !== mermaidFacade) return window[globalName];
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = new URL(source, base).href;
                const timer = setTimeout(() => finish(new Error(`${name} loading timed out`)), 30_000);
                const finish = error => {
                    clearTimeout(timer);
                    script.onload = script.onerror = null;
                    if (error) { script.remove(); reject(error); }
                    else resolve();
                };
                script.onload = () => finish();
                script.onerror = () => finish(new Error(`Unable to load ${name}`));
                document.head.appendChild(script);
            });
            const library = window[globalName];
            if (!library || library === mermaidFacade) throw new Error(`${name} did not initialize`);
            if (name === 'mermaid') library.initialize(mermaidConfig);
            return library;
        })();
        loads.set(name, promise);
        promise.catch(() => loads.delete(name));
        return promise;
    }
    window.loadRendererFeature = load;
    if (!window.mermaid) window.mermaid = mermaidFacade;
    // Generated project links can open a workspace before its sidebar is used.
    document.addEventListener('project-workspace:open', event => {
        if (window.projectWorkspace) return;
        const detail = event.detail;
        event.stopImmediatePropagation();
        load('project').then(() => document.dispatchEvent(new CustomEvent('project-workspace:open', { detail })))
            .catch(error => window.uiManager?.showFeatureLoadError(error));
    });
})();
