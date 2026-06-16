export function getSessionFileItems(content = []) {
    const files = content.filter((item) => item?.content_type === 'artifact' || item?.content_type === 'upload');
    return dedupeSessionFiles(files);
}

export function getSessionExecutions(content = []) {
    return content.filter((item) => item?.content_type === 'execution');
}

export function dedupeSessionFiles(files = []) {
    const byKey = new Map();

    files.forEach((file) => {
        const key = getSessionFileKey(file);
        const existing = byKey.get(key);
        if (!existing || scoreSessionFile(file) > scoreSessionFile(existing)) {
            byKey.set(key, file);
        }
    });

    return Array.from(byKey.values());
}

export function getSessionFileKey(file = {}) {
    const metadata = normalizeMetadata(file.metadata);
    const fileId = normalizeValue(metadata.file_id);
    if (fileId) return `file-id:${fileId}`;

    const storagePath = normalizePath(metadata.path || metadata.supabasePath);
    if (storagePath) return `path:${storagePath}`;

    const relativePath = normalizePath(metadata.relativePath || metadata.relative_path);
    if (relativePath) return `relative:${relativePath}`;

    if (file.content_type === 'artifact' && file.reference_id) {
        return `artifact:${normalizeValue(file.reference_id)}`;
    }

    const filename = normalizeValue(metadata.filename || metadata.name || 'unknown');
    const size = normalizeValue(metadata.size || 0);
    const mimeType = normalizeValue(metadata.mime_type || metadata.type || '');
    return `fallback:${filename}:${size}:${mimeType}`;
}

function scoreSessionFile(file = {}) {
    const metadata = normalizeMetadata(file.metadata);
    let score = 0;
    if (file.download_url || file.signed_url) score += 10;
    if (metadata.relativePath || metadata.relative_path) score += 6;
    if (metadata.path || metadata.supabasePath) score += 5;
    if (metadata.size) score += 2;
    if (metadata.mime_type || metadata.type) score += 2;
    if (file.source === 'session_content') score += 1;
    return score;
}

function normalizeMetadata(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            return {};
        }
    }
    return {};
}

function normalizePath(value) {
    return normalizeValue(value).replace(/\\/g, '/').replace(/\/+/g, '/');
}

function normalizeValue(value) {
    return String(value ?? '').trim().toLowerCase();
}
