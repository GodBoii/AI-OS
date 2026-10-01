// native-icons.js - small icons drawn in code for the taskbar and Dock.
//
// The taskbar badge, overlay and thumbnail-toolbar buttons need icons whose
// content changes at runtime (an unread count), so they are rendered here
// instead of shipped as files. Output is a plain RGBA PNG buffer, which works
// with nativeImage.createFromBuffer() on every platform and can be tested in
// plain Node.

const zlib = require('zlib');

// --- PNG encoding ------------------------------------------------------------

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes straight (non-premultiplied) RGBA pixels as a PNG. */
function encodePng(width, height, rgba) {
    if (rgba.length !== width * height * 4) throw new Error('Pixel buffer size does not match dimensions');
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bit depth
    header[9] = 6; // colour type RGBA
    // compression, filter, interlace stay 0

    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter: none
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', zlib.deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

// --- Drawing -----------------------------------------------------------------
// Each shape is a coverage function f(x, y) -> boolean in pixel space. Pixels
// are 4x4 supersampled so edges are anti-aliased.

const SUPERSAMPLE = 4;

function createCanvas(size) {
    return { size, pixels: Buffer.alloc(size * size * 4) };
}

function fillShape(canvas, inside, [r, g, b, a = 255]) {
    const { size, pixels } = canvas;
    const samples = SUPERSAMPLE * SUPERSAMPLE;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let hits = 0;
            for (let sy = 0; sy < SUPERSAMPLE; sy++) {
                for (let sx = 0; sx < SUPERSAMPLE; sx++) {
                    if (inside(x + (sx + 0.5) / SUPERSAMPLE, y + (sy + 0.5) / SUPERSAMPLE)) hits++;
                }
            }
            if (!hits) continue;
            // Source-over blend in straight alpha.
            const srcA = (a / 255) * (hits / samples);
            const i = (y * size + x) * 4;
            const dstA = pixels[i + 3] / 255;
            const outA = srcA + dstA * (1 - srcA);
            const blend = (src, dst) => Math.round((src * srcA + dst * dstA * (1 - srcA)) / outA);
            pixels[i] = blend(r, pixels[i]);
            pixels[i + 1] = blend(g, pixels[i + 1]);
            pixels[i + 2] = blend(b, pixels[i + 2]);
            pixels[i + 3] = Math.round(outA * 255);
        }
    }
}

const circle = (cx, cy, radius) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;

function triangle([ax, ay], [bx, by], [cx, cy]) {
    const sign = (px, py, x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
    return (x, y) => {
        const d1 = sign(x, y, ax, ay, bx, by);
        const d2 = sign(x, y, bx, by, cx, cy);
        const d3 = sign(x, y, cx, cy, ax, ay);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
    };
}

// 3x5 digit glyphs, one string per row ('#' = on).
const GLYPHS = {
    0: ['###', '#.#', '#.#', '#.#', '###'],
    1: ['.#.', '##.', '.#.', '.#.', '###'],
    2: ['###', '..#', '###', '#..', '###'],
    3: ['###', '..#', '###', '..#', '###'],
    4: ['#.#', '#.#', '###', '..#', '..#'],
    5: ['###', '#..', '###', '..#', '###'],
    6: ['###', '#..', '###', '#.#', '###'],
    7: ['###', '..#', '..#', '..#', '..#'],
    8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '###'],
    '+': ['...', '.#.', '###', '.#.', '...'],
};

function textShape(text, centerX, centerY, cell) {
    const glyphWidth = 3;
    const spacing = 1;
    const totalWidth = text.length * glyphWidth + (text.length - 1) * spacing;
    const left = centerX - (totalWidth * cell) / 2;
    const top = centerY - (5 * cell) / 2;
    return (x, y) => {
        const col = Math.floor((x - left) / cell);
        const row = Math.floor((y - top) / cell);
        if (row < 0 || row >= 5 || col < 0) return false;
        const glyphIndex = Math.floor(col / (glyphWidth + spacing));
        const glyphCol = col % (glyphWidth + spacing);
        if (glyphIndex >= text.length || glyphCol >= glyphWidth) return false;
        const glyph = GLYPHS[text[glyphIndex]];
        return Boolean(glyph && glyph[row][glyphCol] === '#');
    };
}

// --- Icons -------------------------------------------------------------------

const ICON_SIZE = 32; // drawn at 2x; callers create the image with scaleFactor 2
const WHITE = [255, 255, 255];
const BADGE_RED = [229, 57, 53];

function badgeLabel(count) {
    const value = Math.floor(Number(count));
    if (!Number.isFinite(value) || value <= 0) return '';
    return value > 9 ? '9+' : String(value);
}

/** Red circle with the unread count, for the Windows taskbar overlay. */
function renderBadgePng(count) {
    const label = badgeLabel(count);
    if (!label) throw new Error('Badge count must be a positive number');
    const canvas = createCanvas(ICON_SIZE);
    const mid = ICON_SIZE / 2;
    fillShape(canvas, circle(mid, mid, mid - 0.5), BADGE_RED);
    const cell = label.length > 1 ? 3 : 4;
    fillShape(canvas, textShape(label, mid, mid, cell), WHITE);
    return encodePng(ICON_SIZE, ICON_SIZE, canvas.pixels);
}

/** White glyphs for the Windows thumbnail toolbar (dark button background). */
function renderGlyphPng(kind) {
    const canvas = createCanvas(ICON_SIZE);
    const s = ICON_SIZE;
    if (kind === 'stop') {
        fillShape(canvas, rect(s * 0.25, s * 0.25, s * 0.75, s * 0.75), WHITE);
    } else if (kind === 'pause') {
        fillShape(canvas, rect(s * 0.25, s * 0.2, s * 0.42, s * 0.8), WHITE);
        fillShape(canvas, rect(s * 0.58, s * 0.2, s * 0.75, s * 0.8), WHITE);
    } else if (kind === 'play') {
        fillShape(canvas, triangle([s * 0.3, s * 0.2], [s * 0.3, s * 0.8], [s * 0.78, s * 0.5]), WHITE);
    } else {
        throw new Error(`Unknown glyph: ${kind}`);
    }
    return encodePng(ICON_SIZE, ICON_SIZE, canvas.pixels);
}

module.exports = {
    ICON_SIZE,
    crc32,
    encodePng,
    badgeLabel,
    renderBadgePng,
    renderGlyphPng,
};
