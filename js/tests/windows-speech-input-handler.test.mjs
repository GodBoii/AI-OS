import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
    }

    add(name) {
        this.values.add(name);
    }

    contains(name) {
        return this.values.has(name);
    }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.classList = new FakeClassList();
        this.attributes = new Map();
        this.dataset = {};
        this.style = {};
    }

    set className(value) {
        this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    querySelector(selector) {
        const matcher = selector.startsWith('.')
            ? (element) => element.classList.contains(selector.slice(1))
            : (element) => element.tagName.toLowerCase() === selector.toLowerCase();

        for (const child of this.children) {
            if (matcher(child)) return child;
            const descendant = child.querySelector(selector);
            if (descendant) return descendant;
        }
        return null;
    }

    remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        this.parentElement = null;
    }
}

const animationFrames = new Map();
let nextAnimationFrame = 0;
globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextAnimationFrame;
    animationFrames.set(id, callback);
    return id;
};
globalThis.cancelAnimationFrame = (id) => animationFrames.delete(id);
globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
globalThis.window = {};

const handlerSource = await readFile(
    new URL('../windows-speech-input-handler.js', import.meta.url),
    'utf8',
);
const handlerModuleUrl = `data:text/javascript;base64,${Buffer.from(handlerSource).toString('base64')}`;
const { default: WindowsSpeechInputHandler } = await import(handlerModuleUrl);

test('native recording renders five responsive level bars and cleans them up', () => {
    const button = new FakeElement('button');
    button.appendChild(new FakeElement('i'));

    const handler = new WindowsSpeechInputHandler();
    handler.button = button;
    handler.isRecording = true;
    handler.setVisualState('recording');

    const waveform = button.querySelector('.native-waveform');
    assert.ok(waveform);
    assert.equal(waveform.children.length, 5);
    assert.ok(button.classList.contains('native-recording'));

    handler.handleNativeEvent({ type: 'audio-level', level: 80 });
    assert.ok(handler.targetAudioLevel > 0.8);

    const frame = animationFrames.get(handler.waveformFrame);
    assert.equal(typeof frame, 'function');
    frame();
    assert.match(waveform.children[2].style.transform, /^scaleY\(0\.[5-9]/);

    handler.isRecording = false;
    handler.setVisualState('idle');
    assert.equal(button.querySelector('.native-waveform'), null);
    assert.equal(handler.waveformBars.length, 0);
    assert.equal(handler.waveformFrame, null);
});

test('native recording uses live frequency data and releases its monitor stream', async () => {
    let trackStopped = false;
    let contextClosed = false;
    const stream = {
        getTracks: () => [{ stop: () => { trackStopped = true; } }],
    };
    const analyser = {
        fftSize: 256,
        frequencyBinCount: 128,
        minDecibels: 0,
        maxDecibels: 0,
        smoothingTimeConstant: 0,
        connect() {},
        disconnect() {},
        getByteFrequencyData(data) {
            data.fill(190);
        },
    };
    const source = { connect() {}, disconnect() {} };
    const mute = { gain: { value: 1 }, connect() {}, disconnect() {} };

    class FakeAudioContext {
        constructor() {
            this.sampleRate = 48000;
            this.state = 'running';
            this.destination = {};
        }

        createMediaStreamSource() { return source; }
        createAnalyser() { return analyser; }
        createGain() { return mute; }
        async resume() {}
        async close() {
            this.state = 'closed';
            contextClosed = true;
        }
    }

    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { mediaDevices: { getUserMedia: async () => stream } },
    });
    window.AudioContext = FakeAudioContext;

    const button = new FakeElement('button');
    button.appendChild(new FakeElement('i'));
    const handler = new WindowsSpeechInputHandler();
    handler.button = button;
    handler.isRecording = true;
    handler.setVisualState('recording');

    await handler.visualizerStartPromise;
    assert.equal(handler.visualizerAnalyser, analyser);

    const frame = animationFrames.get(handler.waveformFrame);
    frame();
    const waveform = button.querySelector('.native-waveform');
    assert.match(waveform.children[0].style.transform, /^scaleY\(0\.[4-9]/);
    assert.notEqual(waveform.children[0].style.transform, 'scaleY(0.140)');

    handler.isRecording = false;
    handler.setVisualState('idle');
    assert.equal(trackStopped, true);
    assert.equal(contextClosed, true);
    assert.equal(handler.visualizerStream, null);
});
