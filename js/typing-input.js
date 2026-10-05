const TYPING_SPEEDS = Object.freeze(['instant', 'fast', 'slow']);
const DEFAULT_TYPING_SPEED = 'instant';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function getTypingSpeed(settings) {
    const speed = settings?.get?.().typingSpeed;
    return TYPING_SPEEDS.includes(speed) ? speed : DEFAULT_TYPING_SPEED;
}

async function typeWithSpeed(text, speed, { insertText, typeCharacter, sleep = pause, random = Math.random }) {
    if (typeof text !== 'string') throw new Error('Text must be a string');
    if (!TYPING_SPEEDS.includes(speed)) throw new Error('Invalid typing speed');
    if (!text) return;
    if (speed === 'instant') {
        await insertText(text);
        return;
    }
    const [min, max] = speed === 'fast' ? [25, 55] : [80, 180];
    const characters = [...text];
    for (let index = 0; index < characters.length; index++) {
        await typeCharacter(characters[index]);
        if (index < characters.length - 1) await sleep(Math.round(min + random() * (max - min)));
    }
}

// Preserve the text and rich formats Electron supports. Do not overwrite a
// clipboard change made by the user while the target processes the paste.
async function pasteWithClipboard(text, { clipboard, pressPaste, sleep = pause }) {
    const previous = { text: clipboard.readText() };
    const html = clipboard.readHTML();
    const rtf = clipboard.readRTF();
    const image = clipboard.readImage();
    if (html) previous.html = html;
    if (rtf) previous.rtf = rtf;
    if (!image.isEmpty()) previous.image = image;
    if (process.platform === 'darwin') {
        const bookmark = clipboard.readBookmark();
        if (bookmark.title) previous.bookmark = bookmark.title;
    }
    clipboard.writeText(text);
    try {
        await pressPaste();
        // Applications may handle the injected paste asynchronously.
        await sleep(200);
    } finally {
        if (clipboard.readText() === text) clipboard.write(previous);
    }
}

module.exports = { TYPING_SPEEDS, DEFAULT_TYPING_SPEED, getTypingSpeed, typeWithSpeed, pasteWithClipboard };
