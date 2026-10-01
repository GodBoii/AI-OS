// file-open.js - files handed to the app by the OS.
//
// "Open with Aetheria ai", dragging files onto the app or its shortcut, and
// picking a recent document all end up here:
//   Windows / Linux: file paths in argv (first launch or `second-instance`)
//   macOS:           the app `open-file` event
// The files are read in the main process and sent to the renderer, which
// attaches them to the composer exactly like a drag-and-drop.

const path = require('path');

const MAX_FILES = 10;
// Matches the renderer's attachment limit (chat.js maxFileSize).
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Types registered for "Open with" in package.json / installer.nsh. Anything
// else is still accepted when passed explicitly; this map only supplies MIME.
const MIME_TYPES = Object.freeze({
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});

const OPEN_WITH_EXTENSIONS = Object.freeze(Object.keys(MIME_TYPES));

function mimeTypeFor(filePath) {
    const extension = path.extname(filePath).slice(1).toLowerCase();
    return MIME_TYPES[extension] || 'application/octet-stream';
}

/**
 * File paths in a command line. Flags, URLs, the executable itself and (in
 * development) the app directory are skipped; only existing regular files
 * are kept.
 */
function extractFilePaths(argv, { isFile, ignore = [], cwd = process.cwd() }) {
    if (!Array.isArray(argv)) return [];
    const ignored = new Set(ignore.filter(Boolean).map((entry) => path.resolve(entry)));
    const found = [];
    for (const arg of argv.slice(1)) {
        if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) continue;
        // A second instance's relative paths belong to its own directory.
        const resolved = path.resolve(cwd, arg);
        if (ignored.has(resolved) || found.includes(resolved)) continue;
        if (isFile(resolved)) found.push(resolved);
    }
    return found;
}

/**
 * Reads files for the renderer. Oversized and unreadable files are reported
 * in `skipped` instead of failing the whole batch.
 */
async function readFilesForRenderer(filePaths, { fsPromises }) {
    const files = [];
    const skipped = [];
    for (const filePath of filePaths.slice(0, MAX_FILES)) {
        const name = path.basename(filePath);
        try {
            const stat = await fsPromises.stat(filePath);
            if (!stat.isFile()) {
                skipped.push({ name, reason: 'not a file' });
                continue;
            }
            if (stat.size > MAX_FILE_BYTES) {
                skipped.push({ name, reason: 'larger than 50 MB' });
                continue;
            }
            const data = await fsPromises.readFile(filePath);
            files.push({ name, path: filePath, type: mimeTypeFor(filePath), size: stat.size, data });
        } catch (error) {
            skipped.push({ name, reason: error.code || error.message });
        }
    }
    for (const filePath of filePaths.slice(MAX_FILES)) {
        skipped.push({ name: path.basename(filePath), reason: `more than ${MAX_FILES} files` });
    }
    return { files, skipped };
}

module.exports = {
    MAX_FILES,
    MAX_FILE_BYTES,
    OPEN_WITH_EXTENSIONS,
    mimeTypeFor,
    extractFilePaths,
    readFilesForRenderer,
};
