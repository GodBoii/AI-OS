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
        if (!container || !request || typeof request.requestId !== 'string' || !Array.isArray(request.questions) || !request.questions.length) return;
        const entries = (this.cards.get(request.requestId) || []).filter(entry => {
            if (entry.element.isConnected) return true;
            this.clearClock(entry);
            return false;
        });
        const existing = entries.find(entry => entry.element.parentElement === container);
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
        heading.textContent = request.questions.length === 1 ? 'Quick question' : 'A few quick questions';
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

        request.questions.forEach((question, index) => {
            const step = document.createElement('button');
            step.type = 'button';
            step.className = 'agent-question-step';
            step.textContent = String(index + 1);
            step.title = question.question;
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
            const custom = document.createElement('button');
            custom.type = 'button';
            custom.className = 'agent-question-custom';
            custom.textContent = 'Write a reply instead';
            custom.hidden = question.kind !== 'choice';
            custom.setAttribute('aria-expanded', 'false');
            const replyLabel = document.createElement('label');
            replyLabel.className = 'agent-question-reply';
            replyLabel.textContent = 'Your reply';
            replyLabel.hidden = question.kind === 'choice';
            const reply = document.createElement('textarea');
            reply.id = `question-reply-${crypto.randomUUID()}`;
            reply.rows = 2;
            reply.maxLength = 8000;
            reply.placeholder = 'Type your answer…';
            reply.setAttribute('aria-describedby', status.id);
            custom.setAttribute('aria-controls', reply.id);
            replyLabel.appendChild(reply);
            fieldset.append(custom, replyLabel);
            custom.addEventListener('click', () => {
                replyLabel.hidden = !replyLabel.hidden;
                custom.setAttribute('aria-expanded', String(!replyLabel.hidden));
                if (!replyLabel.hidden) reply.focus();
            });
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
            fields.push({ question, choices, reply, fieldset, legend, step });
            body.appendChild(fieldset);
        });
        const actions = document.createElement('footer');
        actions.className = 'agent-question-actions';
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'agent-question-stop';
        stop.textContent = 'Stop';
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'agent-question-back';
        back.textContent = 'Back';
        back.addEventListener('click', () => this.showQuestion(entry, entry.active - 1));
        const send = document.createElement('button');
        send.type = 'submit';
        send.className = 'agent-question-submit';
        actions.append(stop, back, send);
        header.append(heading, navigation, timer);
        form.append(header, body, status, actions);
        Object.assign(entry, { actions, back, send });
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
        container.appendChild(form);
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
            field.step.setAttribute('aria-label', `${index + 1} of ${entry.fields.length}: ${field.question.question}${answered ? ', answered' : ''}`);
            if (index === entry.active) field.step.setAttribute('aria-current', 'step');
            else field.step.removeAttribute('aria-current');
        });
        entry.back.hidden = entry.active === 0;
        entry.send.textContent = entry.active === entry.fields.length - 1 ? 'Send answers' : 'Next';
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
    }
}
