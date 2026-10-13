let stylesheetReady;

function loadStylesheet() {
    if (stylesheetReady) return stylesheetReady;
    stylesheetReady = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL('../css/conversation-pdf-export.css', import.meta.url).href;
        link.onload = resolve;
        link.onerror = () => { link.remove(); stylesheetReady = null; reject(new Error('Could not load PDF export options. Try again.')); };
        document.head.appendChild(link);
    });
    return stylesheetReady;
}

export function selectConversationPdfTurns(turns, { scope, includeAttachments }) {
    let selected = turns;
    if (scope === 'latest') {
        const index = turns.findLastIndex(turn => turn.role === 'assistant');
        if (index < 0) return [];
        const prompt = turns.slice(0, index).findLast(turn => turn.role === 'user');
        selected = [{ ...turns[index], attachments: prompt?.attachments || [] }];
    }
    return selected.map(turn => ({ ...turn, attachments: includeAttachments ? [...(turn.attachments || [])] : [] }))
        .filter(turn => turn.role !== 'user' || turn.text || turn.attachments.length);
}

export async function showConversationPdfExportDialog({ turns, sessionAttachments = [], onExport, returnFocus }) {
    await loadStylesheet();
    const dialog = document.createElement('dialog');
    dialog.className = 'pdf-export-dialog';
    dialog.tabIndex = -1;
    dialog.setAttribute('aria-labelledby', 'pdf-export-title');
    dialog.setAttribute('aria-describedby', 'pdf-export-description');
    dialog.innerHTML = `<form class="pdf-export-form">
        <header class="pdf-export-header">
            <div><h2 id="pdf-export-title">Export as PDF</h2><p id="pdf-export-description">Choose what goes into your document.</p></div>
            <button type="button" class="pdf-export-close" aria-label="Close PDF export">&times;</button>
        </header>
        <fieldset class="pdf-export-scope"><legend>Content</legend>
            <label class="pdf-export-choice"><input type="radio" name="scope" value="entire" checked autofocus><span><strong>Entire conversation</strong><small>Every prompt and response in this chat.</small></span></label>
            <label class="pdf-export-choice"><input type="radio" name="scope" value="latest"><span><strong>Latest response</strong><small>Only the most recent answer.</small></span></label>
        </fieldset>
        <label class="pdf-export-attachments"><input type="checkbox" name="attachments" checked><span><strong>Include attachments</strong><small>Image previews and document filenames. Original document pages are not included.</small></span></label>
        <p class="pdf-export-summary" role="status" aria-live="polite"></p>
        <p class="pdf-export-error" role="alert" hidden></p>
        <footer class="pdf-export-actions"><button type="button" class="pdf-export-cancel">Cancel</button><button type="submit" class="pdf-export-submit">Export PDF</button></footer>
    </form>`;
    const form = dialog.querySelector('form');
    const summary = dialog.querySelector('.pdf-export-summary');
    const errorText = dialog.querySelector('.pdf-export-error');
    const exportButton = dialog.querySelector('.pdf-export-submit');
    const latest = form.querySelector('[value="latest"]');
    latest.disabled = !turns.some(turn => turn.role === 'assistant');
    if (latest.disabled) latest.closest('label').querySelector('small').textContent = 'No response to export yet.';
    let busy = false;
    const getOptions = () => ({ scope: form.elements.scope.value, includeAttachments: form.elements.attachments.checked });
    const updateSummary = () => {
        const options = getOptions();
        const selected = selectConversationPdfTurns(turns, options);
        const sessionFileCount = options.scope === 'entire' && options.includeAttachments ? sessionAttachments.length : 0;
        const attachments = selected.reduce((count, turn) => count + (turn.attachments?.length || 0), sessionFileCount);
        summary.textContent = `${selected.length} ${selected.length === 1 ? 'message' : 'messages'} · ${attachments} ${attachments === 1 ? 'attachment' : 'attachments'}`;
        exportButton.disabled = selected.length === 0;
        errorText.hidden = true;
    };
    form.addEventListener('change', updateSummary);
    updateSummary();
    document.body.appendChild(dialog);
    const closed = new Promise(resolve => dialog.addEventListener('close', () => {
        dialog.remove();
        if (returnFocus?.isConnected) returnFocus.focus();
        resolve();
    }, { once: true }));
    const dismiss = () => { if (!busy) dialog.close(); };
    dialog.querySelector('.pdf-export-close').addEventListener('click', dismiss);
    dialog.querySelector('.pdf-export-cancel').addEventListener('click', dismiss);
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button, input')].filter(control => !control.disabled);
        if (!controls.length) { event.preventDefault(); return; }
        const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1)
            : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
        if (target) { event.preventDefault(); target.focus(); }
    });
    dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        const options = getOptions();
        busy = true;
        form.setAttribute('aria-busy', 'true');
        form.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
        dialog.focus();
        errorText.hidden = true;
        exportButton.textContent = 'Preparing PDF…';
        try {
            const result = await onExport(options);
            if (result?.success) dialog.close();
            else if (!result?.canceled) throw new Error(result?.error || 'PDF export failed. Try again.');
        } catch (error) {
            errorText.textContent = error.message || 'PDF export failed. Try again.';
            errorText.hidden = false;
        } finally {
            busy = false;
            form.removeAttribute('aria-busy');
            form.querySelectorAll('input, button').forEach(control => { control.disabled = false; });
            latest.disabled = !turns.some(turn => turn.role === 'assistant');
            exportButton.disabled = selectConversationPdfTurns(turns, getOptions()).length === 0;
            exportButton.textContent = 'Export PDF';
            if (dialog.open) exportButton.focus();
        }
    });
    dialog.showModal();
    dialog.classList.add('is-open');
    return closed;
}

function safeWebUrl(value) {
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
}

async function imageDataUri(blob) {
    if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error('Image exceeds the 20 MB preview limit.');
    const source = URL.createObjectURL(blob);
    try { return await imageFromUrl(source, blob.type); }
    finally { URL.revokeObjectURL(source); }
}

async function imageFromUrl(value, mimeType = 'image/png') {
    const source = String(value || '');
    if (!/^(blob:|data:image\/)/i.test(source) && !safeWebUrl(source)) throw new Error('Image source is unavailable.');
    const image = new Image();
    if (safeWebUrl(source)) image.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
        const finish = error => {
            clearTimeout(timer);
            image.onload = image.onerror = null;
            if (error) { image.src = ''; reject(error); }
            else resolve();
        };
        const timer = setTimeout(() => finish(new Error('Image preview timed out.')), 5000);
        image.onload = () => finish();
        image.onerror = () => finish(new Error('Image could not be loaded.'));
        image.src = source;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png', .9);
}

async function prepareAttachment(file, readArchivedFile) {
    const attachment = { name: file.name, type: file.type, url: safeWebUrl(file.url || file.download_url) };
    if (!String(file.type).startsWith('image/')) return attachment;
    // Only attachment archive paths are accepted from persisted message context.
    const relativePath = String(file.relativePath || '').replace(/\\/g, '/');
    const segments = relativePath.split('/');
    if (readArchivedFile && segments.length === 3 && segments[0] === 'attachments' && segments.slice(1).every(part => part && part !== '.' && part !== '..')) {
        try {
            const data = await readArchivedFile(relativePath);
            attachment.image = await imageDataUri(new Blob([data], { type: file.type }));
            return attachment;
        } catch { /* A preview URL may still be usable after the archive is unavailable. */ }
    }
    try { attachment.image = await imageFromUrl(file.previewUrl || attachment.url, file.type); }
    catch { attachment.previewUnavailable = true; }
    return attachment;
}

export async function prepareConversationPdfAttachments(files, { readArchivedFile } = {}) {
    const attachments = [];
    for (const file of files) attachments.push(await prepareAttachment(file, readArchivedFile));
    return attachments;
}

export async function prepareConversationPdfTurns(turns, options = {}) {
    const prepared = [];
    // Process one image at a time so large conversations do not decode every attachment at once.
    for (const turn of turns) {
        const attachments = await prepareConversationPdfAttachments(turn.attachments || [], options);
        let html = turn.html;
        if (turn.role === 'assistant') {
            const container = document.createElement('div');
            container.innerHTML = html || '';
            for (const img of container.querySelectorAll('img')) {
                try { img.src = await imageFromUrl(img.getAttribute('src')); }
                catch {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'pdf-image-placeholder';
                    placeholder.textContent = img.alt ? `Image unavailable: ${img.alt}` : 'Image preview unavailable';
                    img.replaceWith(placeholder);
                }
            }
            html = container.innerHTML;
        }
        prepared.push({ ...turn, html, attachments });
    }
    return prepared;
}
