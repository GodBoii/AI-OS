// Renderer script for quick-prompt.html.
(function initQuickPrompt() {
    'use strict';

    const form = document.getElementById('quick-prompt-form');
    const input = document.getElementById('quick-prompt-input');
    const api = window.quickPrompt;
    if (!form || !input || !api) return;

    const submit = () => {
        const text = input.value.trim();
        if (!text) return;
        api.submit(text);
        input.value = '';
    };

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submit();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            submit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            api.close();
        }
    });

    api.onOpened(() => {
        input.focus();
        input.select();
    });
})();
