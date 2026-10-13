// Self-contained print document. No app stylesheet or network font dependencies.
export const conversationPdfPrintOptions = {
    printBackground: true,
    preferCSSPageSize: true,
    pageSize: 'A4',
    landscape: false,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;margin:0 18mm;padding-top:8px;border-top:1px solid #d5ded5;font:9px Arial,sans-serif;color:#59635d;display:flex;justify-content:space-between;align-items:center;">
        <span>Aetheria ai / Conversation</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`,
    generateTaggedPDF: true,
    generateDocumentOutline: true,
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

// Print-native version of assets/icon.png's four-point star and circular ring.
const brandLogo = `<svg class="brand-logo" viewBox="0 0 180 180" role="img" aria-label="Aetheria ai logo">
    <circle cx="90" cy="90" r="47" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <path d="M90 10 C90 78 78 90 10 90 C78 90 90 102 90 170 C90 102 102 90 170 90 C102 90 90 78 90 10Z" fill="currentColor"/>
</svg>`;

function renderAttachments(files = []) {
    if (!files.length) return '';
    const attachments = files.map(file => `<li class="attachment">
            <span class="attachment-name">${escapeHtml(file.name)}</span>
            ${file.type ? `<span class="attachment-type">${escapeHtml(file.type)}</span>` : ''}
            ${file.url ? `<a class="attachment-link" href="${escapeHtml(file.url)}">Open original</a>` : ''}
        </li>`).join('');
    const previews = files.filter(file => file.image || file.previewUnavailable).map(file => `<figure class="attachment-preview">
        ${file.image ? `<img src="${escapeHtml(file.image)}" alt="${escapeHtml(file.name)}">` : '<div class="pdf-image-placeholder">Image preview unavailable</div>'}
        <figcaption>${escapeHtml(file.name)}</figcaption>
    </figure>`).join('');
    return `<aside class="pdf-attachments" aria-label="Attachments"><div class="attachments-label">Attachments</div><ul class="turn-attachments">${attachments}</ul>${previews}</aside>`;
}

function renderTurn(turn) {
    if (turn.role === 'user') {
        return `<article class="turn turn-user" aria-label="Your message">
            <header class="turn-header"><span class="speaker">You</span></header>
            <div class="user-body">${escapeHtml(turn.text)}</div>
            ${renderAttachments(turn.attachments)}
        </article>`;
    }
    return `<article class="turn turn-assistant" aria-label="Aetheria ai response">
        <header class="turn-header"><span class="assistant-mark" aria-hidden="true">a</span><span class="speaker">Aetheria ai</span><span class="speaker-detail">Response</span></header>
        <div class="assistant-rich">${turn.html || ''}</div>
        ${renderAttachments(turn.attachments)}
    </article>`;
}

export function buildConversationPdfHtml(turns, { title = 'Untitled Conversation', timestamp = new Date(), scope = 'entire', sessionAttachments = [] } = {}) {
    const date = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(timestamp);
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(timestamp);
    const count = turns.length;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; font-src 'none';">
    <title>${escapeHtml(title)} - Aetheria ai</title>
    <style>
        :root {
            --ink: #17211d;
            --muted: #59635d;
            --accent: #dafa68;
            --accent-ink: #38512b;
            --line: #d5ded5;
            --wash: #f1f5ed;
            --body-font: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
            --display-font: Georgia, 'Times New Roman', serif;
            --mono-font: Consolas, 'Liberation Mono', Menlo, monospace;
        }
        @page { size: A4; margin: 16mm 18mm 22mm; }
        * { box-sizing: border-box; }
        html { color-scheme: light; }
        body { margin: 0; background: white; color: var(--ink); font: 10.5pt/1.55 var(--body-font); }
        .document-header { margin-bottom: 6mm; break-inside: avoid; }
        .masthead { display: flex; justify-content: space-between; align-items: center; padding: 0 0 4mm; border-bottom: 1px solid var(--ink); }
        .brand-name { font-size: 15pt; font-weight: 650; letter-spacing: -.6pt; }
        .document-kind { font-size: 8pt; color: var(--muted); }
        .title-block { position: relative; margin: 5mm 0 0; padding: 5mm 0 6mm; border-bottom: 5px solid var(--accent); }
        .brand-logo { position: absolute; right: 1mm; top: 1mm; width: 28mm; height: 28mm; color: var(--accent-ink); }
        .conversation-title { position: relative; max-width: calc(100% - 38mm); margin: 0 0 5mm; font: 34pt/1.08 var(--display-font); letter-spacing: -1.2pt; overflow-wrap: anywhere; text-wrap: balance; }
        .conversation-meta { position: relative; display: flex; flex-wrap: wrap; gap: 2mm 5mm; color: var(--muted); font-size: 8pt; font-variant-numeric: tabular-nums; }
        .conversation-meta span + span { border-left: 1px solid var(--line); padding-left: 5mm; }
        .turn { margin: 0 0 5mm; }
        .turn:last-child { margin-bottom: 0; }
        .turn-header { display: flex; align-items: center; gap: 2.5mm; margin-bottom: 3mm; break-after: avoid; }
        .speaker { font-size: 9pt; font-weight: 650; }
        .speaker-detail { margin-left: auto; color: var(--muted); font-size: 8pt; }
        .assistant-mark { display: inline-flex; justify-content: center; align-items: center; width: 6mm; height: 6mm; background: var(--accent); border-radius: 50%; font: italic bold 14pt/1 var(--display-font); }
        .turn-user { padding: 4mm 5mm; border-left: 3px solid var(--accent-ink); background: var(--wash); border-radius: 0 3mm 3mm 0; box-decoration-break: clone; }
        .turn-user .turn-header { margin-bottom: 1.5mm; }
        .user-body { white-space: pre-wrap; overflow-wrap: anywhere; }
        .turn-attachments { list-style: none; display: flex; flex-wrap: wrap; gap: 2mm; margin: 3mm 0 0; padding: 0; }
        .attachment { max-width: 100%; padding: 1.5mm 2.5mm; border: 1px solid var(--line); border-radius: 1.5mm; font-size: 8pt; break-inside: avoid; overflow-wrap: anywhere; }
        .attachment-name { font-weight: 600; }
        .attachment-type { display: block; font: 7pt/1.4 var(--mono-font); color: var(--muted); }
        .pdf-attachments { margin-top: 3mm; }
        .attachments-label { font-size: 8pt; font-weight: 600; color: var(--muted); break-after: avoid; }
        .attachment-link { display: inline-block; margin-top: 1mm; color: var(--accent-ink); text-decoration: underline; }
        .attachment-preview { margin: 4mm 0; break-inside: avoid; }
        .attachment-preview img { display: block; max-width: 100%; max-height: 100mm; width: auto; height: auto; object-fit: contain; border-radius: 2mm; }
        .attachment-preview figcaption { margin-top: 1.5mm; font-size: 8pt; color: var(--muted); overflow-wrap: anywhere; }
        .assistant-rich { overflow-wrap: anywhere; }
        .assistant-rich p { margin: 0 0 3mm; orphans: 3; widows: 3; }
        .assistant-rich h1, .assistant-rich h2, .assistant-rich h3,
        .assistant-rich h4, .assistant-rich h5, .assistant-rich h6 {
            margin: 5mm 0 2.5mm; color: var(--ink); line-height: 1.25; break-after: avoid; text-wrap: pretty;
        }
        .assistant-rich h1 { font: 24pt/1.2 var(--display-font); letter-spacing: -.5pt; }
        .assistant-rich h2 { font: 19pt/1.25 var(--display-font); letter-spacing: -.35pt; padding-bottom: 2mm; border-bottom: 1px solid var(--line); }
        .assistant-rich h3 { font-size: 12pt; font-weight: 650; }
        .assistant-rich h4, .assistant-rich h5, .assistant-rich h6 { font-size: 10.5pt; }
        .assistant-rich .inner-content > :first-child { margin-top: 0; }
        .assistant-rich strong { color: var(--ink); font-weight: 650; }
        .assistant-rich ul, .assistant-rich ol { margin: 2mm 0 4mm; padding-left: 5.5mm; }
        .assistant-rich li { margin: 1.5mm 0; padding-left: .5mm; orphans: 2; widows: 2; }
        .assistant-rich li::marker { color: var(--accent-ink); font-weight: 650; }
        .assistant-rich li > p { margin-bottom: 1.5mm; }
        .assistant-rich a { color: var(--accent-ink); text-decoration: underline; text-decoration-thickness: .5pt; text-underline-offset: 2pt; }
        .assistant-rich blockquote { margin: 4mm 0; padding: 3mm 4mm; background: var(--wash); border-left: 3px solid var(--accent-ink); box-decoration-break: clone; }
        .assistant-rich blockquote p:last-child { margin-bottom: 0; }
        .assistant-rich hr { margin: 5mm 0; border: 0; border-top: 1px solid var(--line); }
        .assistant-rich code { font: 9pt/1.5 var(--mono-font); background: var(--wash); padding: .3mm 1mm; border-radius: 1mm; overflow-wrap: anywhere; }
        .assistant-rich pre { margin: 4mm 0; padding: 4mm; border: 1px solid var(--line); border-top: 3px solid var(--accent-ink); border-radius: 1.5mm; background: var(--wash); white-space: pre-wrap; overflow-wrap: anywhere; box-decoration-break: clone; }
        .assistant-rich pre code { padding: 0; background: none; border-radius: 0; color: var(--ink); white-space: inherit; }
        .assistant-rich .hljs-keyword, .assistant-rich .hljs-selector-tag { color: #704131; }
        .assistant-rich .hljs-string, .assistant-rich .hljs-attr { color: #38512b; }
        .assistant-rich .hljs-number, .assistant-rich .hljs-literal { color: #375777; }
        .assistant-rich .hljs-comment { color: var(--muted); }
        .assistant-rich .table-container { overflow: visible; }
        .assistant-rich table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 4mm 0; font-size: 9pt; }
        .assistant-rich th, .assistant-rich td { border-bottom: 1px solid var(--line); padding: 2.5mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
        .assistant-rich th { background: var(--wash); color: var(--ink); font-weight: 650; border-bottom: 2px solid var(--accent-ink); }
        .assistant-rich tbody tr:nth-child(even) { background: #f8faf6; }
        .assistant-rich thead { display: table-header-group; }
        .assistant-rich tr { break-inside: avoid; }
        .assistant-rich img { display: block; max-width: 100%; max-height: 210mm; width: auto; height: auto; object-fit: contain; margin: 4mm 0; border-radius: 2mm; break-inside: avoid; }
        .assistant-rich svg { max-width: 100%; height: auto; }
        .assistant-rich .inline-artifact-mermaid { break-inside: avoid; }
        .assistant-rich .inline-mermaid-source { display: none; }
        .assistant-rich .inline-mermaid-content { overflow: visible; }
        .pdf-image-placeholder, .inline-artifact-placeholder { padding: 4mm; margin: 4mm 0; border: 1px dashed var(--line); color: var(--muted); font-size: 9pt; }
        @media screen {
            body { max-width: 210mm; margin: 0 auto; padding: 16mm 18mm 22mm; }
        }
        @media screen and (max-width: 600px) {
            body { padding: 24px 20px; }
            .conversation-title { max-width: calc(100% - 20mm); font-size: 28pt; }
            .brand-logo { width: 16mm; height: 16mm; }
            .conversation-meta { gap: 2mm 3mm; }
            .conversation-meta span + span { padding-left: 3mm; }
        }
        @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
    </style>
</head>
<body>
    <header class="document-header">
        <div class="masthead"><span class="brand-name">aetheria ai</span><span class="document-kind">${scope === 'latest' ? 'Latest response' : 'Conversation archive'}</span></div>
        <div class="title-block">
            ${brandLogo}
            <h1 class="conversation-title">${escapeHtml(title)}</h1>
            <div class="conversation-meta"><span>Exported ${escapeHtml(date)}</span><span>${escapeHtml(time)}</span><span>${count} ${count === 1 ? 'message' : 'messages'}</span></div>
        </div>
    </header>
    <main>${turns.map(renderTurn).join('\n')}${renderAttachments(sessionAttachments)}</main>
</body>
</html>`;
}
