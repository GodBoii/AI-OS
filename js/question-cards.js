// Question forms stay outside the streamed markdown and collapsed tool logs.
export class QuestionCards {
    constructor({ submit, cancel, onTerminal = () => {} }) {
        this.submit = submit;
        this.cancel = cancel;
        this.onTerminal = onTerminal;
        this.cards = new Map();
        if (!document.querySelector('link[data-question-styles]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = new URL('../css/question-cards.css', import.meta.url).href;
            link.dataset.questionStyles = '';
            document.head.appendChild(link);
        }
    }

    mount(request, container) {
        if (!container || !request || typeof request.requestId !== 'string' || !Array.isArray(request.questions)) return;
        const existing = (this.cards.get(request.requestId) || []).find(entry => entry.element.parentElement === container);
        if (existing?.element.isConnected) {
            if (request.status !== existing.request.status) this.update(request);
            return;
        }
        const form = document.createElement('form');
        form.className = 'agent-question-card';
        form.dataset.requestId = request.requestId;
        const heading = document.createElement('h3');
        heading.textContent = request.status === 'pending' ? 'Your input is needed' : 'Your answers';
        form.appendChild(heading);
        const fields = [];
        for (const question of request.questions) {
            const fieldset = document.createElement('fieldset');
            const legend = document.createElement('legend');
            legend.textContent = question.question;
            fieldset.appendChild(legend);
            const choices = [];
            for (const option of question.options || []) {
                const label = document.createElement('label');
                label.className = 'agent-question-option';
                const input = document.createElement('input');
                input.type = question.multiSelect ? 'checkbox' : 'radio';
                input.name = question.id;
                input.value = option.label;
                const copy = document.createElement('span');
                const title = document.createElement('strong');
                title.textContent = option.label;
                copy.appendChild(title);
                if (option.description) {
                    const description = document.createElement('span');
                    description.textContent = option.description;
                    copy.appendChild(description);
                }
                label.append(input, copy);
                fieldset.appendChild(label);
                choices.push(input);
            }
            const replyLabel = document.createElement('label');
            replyLabel.className = 'agent-question-reply';
            replyLabel.textContent = question.kind === 'choice' ? 'Or write your own reply' : 'Your reply';
            const reply = document.createElement('textarea');
            reply.rows = 2;
            reply.maxLength = 8000;
            replyLabel.appendChild(reply);
            fieldset.appendChild(replyLabel);
            reply.addEventListener('input', () => {
                if (reply.value.trim()) choices.forEach(choice => { choice.checked = false; });
            });
            choices.forEach(choice => choice.addEventListener('change', () => { if (choice.checked) reply.value = ''; }));
            fields.push({ question, choices, reply, fieldset });
            form.appendChild(fieldset);
        }
        const status = document.createElement('p');
        status.className = 'agent-question-status';
        status.setAttribute('role', 'status');
        const actions = document.createElement('div');
        actions.className = 'agent-question-actions';
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.textContent = 'Stop';
        const send = document.createElement('button');
        send.type = 'submit';
        send.className = 'agent-question-submit';
        send.textContent = 'Submit answers';
        actions.append(stop, send);
        form.append(status, actions);
        const entry = { element: form, request, fields, status, actions, heading, submissionId: crypto.randomUUID() };
        this.cards.set(request.requestId, [...(this.cards.get(request.requestId) || []).filter(item => item.element.isConnected), entry]);
        if (request.status === 'pending' && Number.isFinite(request.expiresAt)) {
            entry.expiryTimer = setTimeout(() => this.update({ ...entry.request, status: 'expired' }), Math.max(0, request.expiresAt * 1000 - Date.now()));
        }
        const disable = value => form.querySelectorAll('button, textarea, input').forEach(input => { input.disabled = value; });
        stop.addEventListener('click', async () => {
            try { await this.cancel(request); }
            catch (error) { status.textContent = error.message; }
        });
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const answers = {};
            for (const { question, choices, reply } of fields) {
                const selected = choices.filter(choice => choice.checked).map(choice => choice.value);
                if (!selected.length && !reply.value.trim()) {
                    status.textContent = 'Answer every question before submitting.';
                    reply.focus();
                    return;
                }
                answers[question.id] = question.kind === 'choice'
                    ? { selected, text: reply.value.trim() } : reply.value.trim();
            }
            disable(true);
            status.textContent = 'Submitting answers…';
            try {
                await this.submit({ requestId: request.requestId, submissionId: entry.submissionId, answers });
            } catch (error) {
                disable(false);
                status.textContent = error.message;
            }
        });
        container.appendChild(form);
        if (request.status !== 'pending') this.update(request);
    }

    update(request) {
        for (const entry of this.cards.get(request.requestId) || []) this.updateEntry(entry, request);
        if (['cancelled', 'expired', 'failed'].includes(request.status)) this.onTerminal(request);
    }

    updateEntry(entry, request) {
        clearTimeout(entry.expiryTimer);
        entry.request = { ...entry.request, ...request };
        if (request.status === 'pending') return;
        for (const { question, choices, reply, fieldset } of entry.fields) {
            const answer = request.answers?.[question.id];
            if (answer !== undefined) {
                const selected = question.kind === 'choice' ? answer.selected || [] : [];
                choices.forEach(choice => { choice.checked = selected.includes(choice.value); });
                reply.value = question.kind === 'choice' ? answer.text || '' : String(answer);
            }
            fieldset.disabled = true;
        }
        entry.actions.hidden = true;
        entry.heading.textContent = 'Your input';
        entry.status.textContent = ({ resuming: 'Answers submitted. Continuing…', answered: 'Answered',
            cancelled: 'Stopped', expired: 'This request expired.', failed: 'Continuation failed. Start a new turn.' })[request.status] || request.status;
    }
}
