import WindowsSpeechInputHandler from './windows-speech-input-handler.js';

const ENDPOINT = 'https://api.aetheriaai.website/api/mic/dictate';
const MAX_RECORDING_MS = 120000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

// Reuse the existing dictation waveform and composer contract. No native STT calls.
export default class GroqSpeechInputHandler extends WindowsSpeechInputHandler {
    constructor() {
        super();
        this.generation = 0;
        this.recordingStream = null;
        this.recorder = null;
        this.chunks = [];
        this.recordingBytes = 0;
        this.recordingTimer = null;
        this.requestController = null;
        this.destroyed = false;
    }

    initialize(button, textarea, options = {}) {
        this.button = button;
        this.targetTextarea = textarea;
        this.canStart = options.canStart || (() => true);
        this.onStateChange = options.onStateChange || (() => {});
        if (!button || !textarea) return false;
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            button.disabled = true;
            button.setAttribute('title', 'Audio recording is unavailable on this device');
            return false;
        }
        button.addEventListener('click', this.boundToggle);
        this.setVisualState('idle');
        return true;
    }

    async start() {
        if (this.destroyed || this.isActive()) return;
        if (!this.canStart()) {
            this.showNotification('Finish the current voice input first.', 'warning');
            return;
        }
        const generation = ++this.generation;
        this.isStarting = true;
        this.setVisualState('starting');
        try {
            const session = await window.electron?.auth?.getSession?.();
            if (generation !== this.generation) return;
            if (!session?.access_token) throw new Error('Please sign in to use voice input.');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            if (generation !== this.generation) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            this.recordingStream = stream;
            const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
                .find(type => MediaRecorder.isTypeSupported(type));
            if (!mimeType) throw new Error('No supported audio recording format is available.');
            const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
            this.recorder = recorder;
            this.chunks = [];
            this.recordingBytes = 0;
            recorder.ondataavailable = event => {
                if (generation !== this.generation || !event.data.size) return;
                this.chunks.push(event.data);
                this.recordingBytes += event.data.size;
                if (this.recordingBytes > MAX_AUDIO_BYTES) {
                    void this.cancel();
                    this.showNotification('Recording is too large. Please use a shorter recording.', 'warning');
                }
            };
            recorder.onerror = () => {
                if (generation !== this.generation) return;
                void this.cancel();
                this.showNotification('Audio recording failed. Please try again.', 'error');
            };
            recorder.onstop = () => {
                if (generation !== this.generation) return;
                this.isRecording = false;
                this.isStopping = true;
                this.setVisualState('processing');
                this.releaseRecording();
                void this.transcribe(generation);
            };
            recorder.start(1000);
            this.isStarting = false;
            this.isRecording = true;
            this.setVisualState('recording');
            this.recordingTimer = setTimeout(() => { void this.stop(); }, MAX_RECORDING_MS);
        } catch (error) {
            if (generation !== this.generation) return;
            await this.cancel();
            this.showNotification(error.name === 'NotAllowedError'
                ? 'Microphone access was denied. Enable it to use voice input.'
                : error.message || 'Could not start dictation.', 'error');
        }
    }

    async stop() {
        if (!this.isRecording || this.recorder?.state !== 'recording') return;
        this.isRecording = false;
        this.isStopping = true;
        this.setVisualState('processing');
        try {
            this.recorder.stop();
        } catch (error) {
            await this.cancel();
            this.showNotification('Could not finish the recording. Please try again.', 'error');
        }
    }

    async transcribe(generation) {
        const controller = new AbortController();
        this.requestController = controller;
        const timeout = setTimeout(() => controller.abort(), 90000);
        try {
            const mimeType = this.recorder.mimeType;
            const blob = new Blob(this.chunks, { type: mimeType });
            this.chunks = [];
            if (!blob.size) throw new Error('No audio was captured. Please try again.');
            if (blob.size > MAX_AUDIO_BYTES) throw new Error('Recording is too large. Please use a shorter recording.');
            const audio = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1]);
                reader.onerror = () => reject(new Error('Could not read the recording.'));
                reader.readAsDataURL(blob);
            });
            const session = await window.electron?.auth?.getSession?.();
            if (generation !== this.generation) return;
            if (!session?.access_token) throw new Error('Please sign in to use voice input.');
            const format = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
            const response = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio, format }),
                signal: controller.signal,
            });
            const payload = await response.json();
            if (generation !== this.generation) return;
            if (!response.ok || payload?.ok !== true) {
                throw new Error(typeof payload?.error === 'string' ? payload.error : 'Normal dictation failed. Please try again.');
            }
            if (typeof payload.text !== 'string') throw new Error('Invalid dictation response.');
            const text = payload.text.trim();
            if (text) {
                const current = this.targetTextarea.value;
                this.targetTextarea.value = `${current}${current && !/\s$/.test(current) ? ' ' : ''}${text}`;
                this.targetTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                this.targetTextarea.focus();
            } else {
                this.showNotification('No speech detected. Please try again.', 'warning');
            }
        } catch (error) {
            if (generation === this.generation) {
                this.showNotification(error.name === 'AbortError'
                    ? 'Dictation timed out. Please try again.' : error.message || 'Normal dictation failed.', 'error');
            }
        } finally {
            clearTimeout(timeout);
            if (generation === this.generation) {
                this.requestController = null;
                this.recorder = null;
                this.chunks = [];
                this.resetState();
            }
        }
    }

    releaseRecording() {
        clearTimeout(this.recordingTimer);
        this.recordingTimer = null;
        this.recordingStream?.getTracks().forEach(track => track.stop());
        this.recordingStream = null;
    }

    async cancel() {
        this.generation += 1;
        this.requestController?.abort();
        this.requestController = null;
        if (this.recorder) {
            this.recorder.ondataavailable = null;
            this.recorder.onstop = null;
            this.recorder.onerror = null;
            if (this.recorder.state !== 'inactive') this.recorder.stop();
        }
        this.releaseRecording();
        this.recorder = null;
        this.chunks = [];
        this.resetState();
    }

    setVisualState(state) {
        super.setVisualState(state);
        if (!this.button) return;
        const label = state === 'recording' ? 'Dictation active. Click to stop.'
            : state === 'starting' ? 'Starting dictation'
                : state === 'processing' ? 'Transcribing speech' : 'Normal voice dictation';
        this.button.setAttribute('aria-label', label);
        this.button.setAttribute('title', label);
        this.button.dataset.tooltip = label;
    }

    destroy() {
        this.destroyed = true;
        void this.cancel();
        this.button?.removeEventListener('click', this.boundToggle);
        this.button = null;
        this.targetTextarea = null;
    }
}
