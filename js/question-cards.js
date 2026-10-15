const questionIconPaths = {
    question: ['M8 9a4 4 0 1 1 6 3.5c-2 1-2 1.5-2 3', 'M12 19h.01'],
    next: ['M5 12h14', 'm12 5 7 7-7 7'],
    back: ['M19 12H5', 'm12 5-7 7 7 7'],
    send: ['m5 12 4 4L19 6'],
    stop: ['M7 7h10v10H7z'],
    edit: ['m15 5 4 4', 'M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z'],
    chevron: ['m6 9 6 6 6-6'],
    step: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8'],
};

function questionIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [attribute, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
        svg.setAttribute(attribute, value);
    }
    for (const d of questionIconPaths[name]) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    return svg;
}

function setQuestionButton(button, icon, label) {
    button.replaceChildren(questionIcon(icon));
    button.setAttribute('aria-label', label);
    button.title = label;
}

// Questions are tool disclosures inside reasoning, separate from response markdown.
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
        if (!container || !request || typeof request.requestId !== 'string' || !Array.isArray(request.questions) || !request.questions.length) return;
        const entries = (this.cards.get(request.requestId) || []).filter(entry => {
            if (entry.element.isConnected) return true;
            this.clearClock(entry);
            return false;
        });
        const existing = entries.find(entry => entry.container === container);
        if (existing) {
            if (request.status !== existing.request.status) this.update(request);
            return;
        }
        const form = document.createElement('form');
        form.className = 'agent-question-card';
        form.dataset.requestId = request.requestId;
        const header = document.createElement('header');
        header.className = 'agent-question-header';
        const heading = document.createElement('h3');
        heading.textContent = request.questions.length === 1 ? 'Ask question' : 'Ask questions';
        const timer = document.createElement('span');
        timer.className = 'agent-question-timer';
        timer.setAttribute('role', 'timer');
        timer.hidden = !Number.isFinite(request.expiresAt);
        const navigation = document.createElement('nav');
        navigation.className = 'agent-question-progress';
        navigation.setAttribute('aria-label', 'Questions');
        navigation.hidden = request.questions.length === 1;
        const body = document.createElement('div');
        body.className = 'agent-question-body t-page-slide';
        body.dataset.page = '1';
        const status = document.createElement('p');
        status.className = 'agent-question-status';
        status.id = `question-status-${crypto.randomUUID()}`;
        status.setAttribute('role', 'status');
        const fields = [];
        const entry = { element: form, request, fields, heading, timer, navigation, body, status,
            active: 0, busy: false, submissionId: crypto.randomUUID() };
        const progress = document.createElement('span');
        progress.className = 'agent-question-position';
        progress.hidden = request.questions.length === 1;
        entry.progress = progress;

        request.questions.forEach((question, index) => {
            const step = document.createElement('button');
            step.type = 'button';
            step.className = 'agent-question-step';
            setQuestionButton(step, 'step', question.question);
            step.addEventListener('click', () => this.showQuestion(entry, index));
            navigation.appendChild(step);
            const fieldset = document.createElement('fieldset');
            fieldset.className = 't-page';
            fieldset.dataset.pageId = String(index % 2 + 1);
            fieldset.hidden = index !== 0;
            const legend = document.createElement('legend');
            legend.textContent = question.question;
            legend.tabIndex = -1;
            fieldset.appendChild(legend);
            const choices = [];
            if (question.kind === 'choice') {
                const hint = document.createElement('p');
                hint.className = 'agent-question-hint';
                hint.textContent = question.multiSelect ? 'Choose any that apply' : 'Choose one';
                fieldset.appendChild(hint);
            }
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
            const replyCaption = document.createElement('span');
            replyCaption.className = 'agent-question-sr-only';
            replyCaption.textContent = 'Your reply';
            replyLabel.hidden = question.kind === 'choice';
            const reply = document.createElement('textarea');
            reply.id = `question-reply-${crypto.randomUUID()}`;
            reply.rows = 1;
            reply.maxLength = 8000;
            reply.placeholder = question.kind === 'choice' ? 'Something else…' : 'Your answer…';
            reply.setAttribute('aria-describedby', status.id);
            replyLabel.append(replyCaption, reply);
            const compose = document.createElement('div');
            compose.className = 'agent-question-compose';
            compose.appendChild(replyLabel);
            fieldset.appendChild(compose);
            const changed = () => {
                status.textContent = '';
                reply.removeAttribute('aria-invalid');
                this.refreshNavigation(entry);
            };
            reply.addEventListener('input', () => {
                if (reply.value.trim()) choices.forEach(choice => { choice.checked = false; });
                changed();
            });
            choices.forEach(choice => choice.addEventListener('change', () => {
                if (choice.checked) reply.value = '';
                changed();
            }));
            fields.push({ question, choices, reply, replyLabel, fieldset, legend, step });
            body.appendChild(fieldset);
        });
        const actions = document.createElement('footer');
        actions.className = 'agent-question-actions';
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'agent-question-stop';
        setQuestionButton(stop, 'stop', 'Stop this request');
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'agent-question-back';
        setQuestionButton(back, 'back', 'Previous question');
        back.addEventListener('click', () => this.showQuestion(entry, entry.active - 1));
        const send = document.createElement('button');
        send.type = 'submit';
        send.className = 'agent-question-submit';
        const custom = document.createElement('button');
        custom.type = 'button';
        custom.className = 'agent-question-custom';
        setQuestionButton(custom, 'edit', 'Write a custom reply');
        custom.addEventListener('click', () => {
            const field = fields[entry.active];
            field.replyLabel.hidden = !field.replyLabel.hidden;
            this.refreshNavigation(entry);
            if (!field.replyLabel.hidden) field.reply.focus();
        });
        actions.append(stop, custom, back, send);
        header.append(navigation, progress);
        form.append(header, body, status, actions);
        Object.assign(entry, { actions, back, send, custom });
        this.cards.set(request.requestId, [...entries, entry]);
        this.refreshNavigation(entry);
        stop.addEventListener('click', async () => {
            if (entry.busy || entry.request.status !== 'pending') return;
            this.setBusy(entry, true);
            status.textContent = 'Stopping…';
            try {
                await this.cancel(entry.request);
                if (entry.request.status === 'pending') this.update({ ...entry.request, status: 'cancelled' });
            } catch (error) {
                if (entry.request.status !== 'pending') return;
                this.setBusy(entry, false);
                status.textContent = error.message;
            }
        });
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (entry.busy || entry.request.status !== 'pending') return;
            if (this.isExpired(entry)) {
                this.update({ ...entry.request, status: 'expired' });
                return;
            }
            if (!this.validateField(entry, entry.active)) return;
            if (entry.active < fields.length - 1) {
                this.showQuestion(entry, entry.active + 1);
                return;
            }
            const answers = {};
            for (const [index, field] of fields.entries()) {
                if (!this.validateField(entry, index)) return;
                const selected = field.choices.filter(choice => choice.checked).map(choice => choice.value);
                answers[field.question.id] = field.question.kind === 'choice'
                    ? { selected, text: field.reply.value.trim() } : field.reply.value.trim();
            }
            this.setBusy(entry, true);
            status.textContent = 'Sending answers…';
            try {
                await this.submit({ requestId: request.requestId, submissionId: entry.submissionId, answers });
                if (entry.request.status === 'pending') this.update({ ...entry.request, status: 'resuming', answers });
            } catch (error) {
                if (entry.request.status !== 'pending') return;
                this.setBusy(entry, false);
                if (this.isExpired(entry)) this.update({ ...entry.request, status: 'expired' });
                else status.textContent = error.message;
            }
        });
        this.createDisclosure(entry);
        this.place(entry, container);
        this.setOpen(entry, request.status === 'pending');
        if (request.status === 'pending') this.startClock(entry);
        else this.updateEntry(entry, request);
    }

    hasAnswer(field) {
        return Boolean(field.reply.value.trim()) || field.choices.some(choice => choice.checked);
    }

    refreshNavigation(entry) {
        entry.fields.forEach((field, index) => {
            const answered = this.hasAnswer(field);
            field.step.dataset.answered = String(answered);
            field.step.replaceChildren(questionIcon(answered ? 'send' : 'step'));
            field.step.setAttribute('aria-label', `${index + 1} of ${entry.fields.length}: ${field.question.question}${answered ? ', answered' : ''}`);
            if (index === entry.active) field.step.setAttribute('aria-current', 'step');
            else field.step.removeAttribute('aria-current');
        });
        entry.back.hidden = entry.active === 0;
        const field = entry.fields[entry.active];
        entry.custom.hidden = field.question.kind !== 'choice';
        entry.custom.setAttribute('aria-expanded', String(!field.replyLabel.hidden));
        entry.custom.setAttribute('aria-controls', field.reply.id);
        entry.progress.textContent = `${entry.active + 1} / ${entry.fields.length}`;
        const last = entry.active === entry.fields.length - 1;
        setQuestionButton(entry.send, last ? 'send' : 'next', last ? 'Send answers' : 'Next question');
    }

    createDisclosure(entry) {
        const host = document.createElement('section');
        host.className = 'tool-log-entry agent-question-tool t-acc';
        const head = document.createElement('div');
        head.className = 'agent-question-tool-header';
        const state = document.createElement('span');
        state.className = 'tool-log-status in-progress';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'agent-question-toggle t-acc-chevron';
        setQuestionButton(toggle, 'chevron', 'Collapse questions');
        const panel = document.createElement('div');
        panel.className = 't-acc-panel';
        panel.id = `question-panel-${crypto.randomUUID()}`;
        toggle.setAttribute('aria-controls', panel.id);
        const inner = document.createElement('div');
        inner.className = 't-acc-panel-inner';
        inner.appendChild(entry.element);
        panel.appendChild(inner);
        head.append(questionIcon('question'), entry.heading, state, entry.timer, toggle);
        host.append(head, panel);
        Object.assign(entry, { host, toggle, panel, state });
        toggle.addEventListener('click', () => this.setOpen(entry, host.dataset.open !== 'true'));
    }

    place(entry, container, reveal = true) {
        let logs = container.querySelector('.detailed-logs');
        if (!logs) {
            logs = document.createElement('div');
            logs.className = 'detailed-logs';
            container.insertBefore(logs, container.querySelector('.message-content'));
        }
        const toolNames = new Set(entry.request.questions.map(question => question.kind === 'choice' ? 'ask_user' : 'get_user_input'));
        const candidates = [...logs.querySelectorAll('.tool-log-entry:not(.agent-question-tool)')]
            .filter(row => toolNames.has(row.dataset.toolName));
        const callId = entry.host.dataset.toolCallId;
        const invocationId = entry.host.dataset.invocationId;
        const placeholder = candidates.find(row => invocationId && row.dataset.invocationId === invocationId)
            || candidates.find(row => callId && row.dataset.toolCallId === callId) || candidates.at(-1);
        if (placeholder) {
            for (const attribute of placeholder.attributes) {
                if (attribute.name === 'id' || attribute.name.startsWith('data-')) entry.host.setAttribute(attribute.name, attribute.value);
            }
            placeholder.replaceWith(entry.host);
        } else logs.appendChild(entry.host);
        entry.host.dataset.toolName ||= [...toolNames][0];
        entry.host.dataset.toolCallId ||= entry.request.requestId;
        entry.host.dataset.owner ||= entry.request.questions[0].agent || 'Assistant';
        entry.host.dataset.questionRequestId = entry.request.requestId;
        entry.container = container;
        if (reveal && entry.request.status === 'pending') {
            container.classList.add('expanded');
            container.dataset.reasoningInitialized = 'true';
            const summary = container.querySelector('.reasoning-summary');
            summary?.classList.remove('hidden');
            summary?.setAttribute('aria-expanded', 'true');
        }
    }

    reattach(previous, replacement) {
        for (const entries of this.cards.values()) {
            for (const entry of entries) {
                if (previous.contains(entry.host)) this.place(entry, replacement, false);
            }
        }
    }

    setOpen(entry, open) {
        if (!open && entry.panel.contains(document.activeElement)) entry.toggle.focus({ preventScroll: true });
        entry.host.dataset.open = String(open);
        entry.toggle.setAttribute('aria-expanded', String(open));
        entry.toggle.setAttribute('aria-label', open ? 'Collapse questions' : 'Expand questions');
        entry.toggle.title = open ? 'Collapse questions' : 'Expand questions';
        entry.panel.inert = !open;
    }

    showQuestion(entry, index) {
        if (entry.busy || entry.request.status !== 'pending' || !entry.fields[index]) return;
        entry.fields.forEach((field, position) => { field.fieldset.hidden = position !== index; });
        // Establish the incoming page's resting state before switching its CSS hook.
        entry.body.dataset.page = String(index % 2 === 0 ? 2 : 1);
        void entry.body.offsetWidth;
        entry.body.dataset.page = String(index % 2 + 1);
        entry.active = index;
        entry.status.textContent = '';
        this.refreshNavigation(entry);
        entry.fields[index].legend.focus({ preventScroll: true });
    }

    validateField(entry, index) {
        const field = entry.fields[index];
        if (this.hasAnswer(field)) return true;
        if (entry.active !== index) this.showQuestion(entry, index);
        entry.status.textContent = 'Choose an option or write a reply to continue.';
        if (field.choices.length) field.choices[0].focus();
        else {
            field.reply.setAttribute('aria-invalid', 'true');
            field.reply.focus();
        }
        return false;
    }

    setBusy(entry, busy) {
        entry.busy = busy;
        entry.element.setAttribute('aria-busy', String(busy));
        entry.element.querySelectorAll('button, textarea, input').forEach(input => { input.disabled = busy; });
    }

    isExpired(entry) {
        return Number.isFinite(entry.request.expiresAt) && entry.request.expiresAt * 1000 <= Date.now();
    }

    startClock(entry) {
        if (!Number.isFinite(entry.request.expiresAt)) return;
        const tick = () => {
            if (!entry.element.isConnected) { this.clearClock(entry); return; }
            const seconds = Math.max(0, Math.ceil(entry.request.expiresAt - Date.now() / 1000));
            entry.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left`;
            entry.timer.title = 'Request expires without sending answers';
            entry.timer.dataset.urgent = String(seconds <= 60);
            if (!seconds && !entry.busy) this.update({ ...entry.request, status: 'expired' });
        };
        entry.expiryTimer = setInterval(tick, 1000);
        entry.visibilityHandler = tick;
        document.addEventListener('visibilitychange', tick);
        tick();
    }

    clearClock(entry) {
        clearInterval(entry.expiryTimer);
        if (entry.visibilityHandler) document.removeEventListener('visibilitychange', entry.visibilityHandler);
    }

    releaseContainer(container) {
        for (const [id, entries] of this.cards) {
            const retained = entries.filter(entry => {
                if (!container.contains(entry.element)) return true;
                this.clearClock(entry);
                return false;
            });
            if (retained.length) this.cards.set(id, retained);
            else this.cards.delete(id);
        }
    }

    update(request) {
        const entries = this.cards.get(request.requestId) || [];
        const changed = entries.some(entry => entry.request.status !== request.status);
        for (const entry of entries) this.updateEntry(entry, request);
        if (changed && ['cancelled', 'expired', 'failed'].includes(request.status)) this.onTerminal(request);
    }

    updateEntry(entry, request) {
        if (request.status === 'pending' && entry.request.status !== 'pending') return;
        entry.request = { ...entry.request, ...request };
        if (request.status === 'pending') return;
        this.clearClock(entry);
        entry.element.dataset.state = request.status;
        entry.element.setAttribute('aria-busy', 'false');
        entry.fields.forEach(field => { field.fieldset.disabled = true; });
        entry.actions.hidden = true;
        entry.body.hidden = true;
        entry.navigation.hidden = true;
        entry.timer.hidden = true;
        const completed = ['resuming', 'answered'].includes(request.status);
        entry.heading.textContent = completed ? 'Answers sent' : 'Question closed';
        entry.state.className = `tool-log-status ${completed ? 'completed' : 'failed'}`;
        entry.status.textContent = ({ resuming: 'Continuing…', answered: 'Answered', cancelled: 'Stopped',
            expired: 'Timed out. Send a message to continue.', failed: 'Continuation failed. Start a new turn.' })[request.status] || request.status;
        entry.summary?.remove();
        const summary = document.createElement('dl');
        summary.className = 'agent-question-summary';
        for (const field of entry.fields) {
            const answer = entry.request.answers?.[field.question.id];
            if (answer === undefined) continue;
            const term = document.createElement('dt');
            term.textContent = field.question.question;
            const value = document.createElement('dd');
            value.textContent = field.question.kind === 'choice'
                ? (answer.selected || []).join(', ') || answer.text || '' : String(answer);
            summary.append(term, value);
        }
        entry.element.insertBefore(summary, entry.status);
        entry.summary = summary;
        this.setOpen(entry, false);
    }
}
