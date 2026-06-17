// js/audio-input-handler.js - Cloud-only intelligent mic input
import { flattenAudioChunks, normalizeAudio, nativeResample, trimSilence } from './audio-utils.js';
import AudioEngine from './audio-engine.js';

const CLOUD_MIC_ENDPOINT = 'https://api.aetheriaai.website/api/mic/transcribe';
const TARGET_SAMPLE_RATE = 16000;
const MIN_SPEECH_SAMPLES = 2000;
const MAX_AUDIO_SECONDS = 120;

class AudioInputHandler {
    constructor() {
        this.isRecording = false;
        this.isProcessing = false;
        this.modelReady = true;
        this.activeBackend = 'openrouter_mic_agent';

        this.audioEngine = new AudioEngine();
        this.audioEngine.setAutoStopConfig({
            enabled: true,
            minRecordingDurationMs: 1500,
            silenceDurationMs: 2600
        });
        this.audioEngine.setAutoStopCallback(() => {
            if (this.isRecording && !this.isProcessing) {
                this.stopRecording();
            }
        });

        this.micButton = null;
        this.targetTextarea = null;
        this.audioChunks = [];
        this.waveformBars = [];
        this.animationFrame = null;
        this.analyser = null;
        this.capturedSampleRate = TARGET_SAMPLE_RATE;
        this.boundToggleRecording = () => this.toggleRecording();
    }

    initialize(micButtonElement, textareaElement) {
        this.micButton = micButtonElement;
        this.targetTextarea = textareaElement;

        if (!this.micButton || !this.targetTextarea) {
            console.error('[AudioInput] Required elements not found');
            return false;
        }

        this.micButton.addEventListener('click', this.boundToggleRecording);
        console.log('[AudioInput] Cloud mic initialized');
        return true;
    }

    async checkModelAvailability() {
        const session = await this.getAuthSession();
        return Boolean(session?.access_token);
    }

    async downloadModel() {
        this.showNotification('Cloud voice input is ready after sign-in', 'info');
        return true;
    }

    async toggleRecording() {
        if (this.isProcessing) return;

        if (this.isRecording) {
            await this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        const session = await this.getAuthSession();
        if (!session?.access_token) {
            this.showNotification('Please sign in to use voice input', 'warning');
            return;
        }

        try {
            console.log('[AudioInput] Starting recording...');
            this.audioChunks = [];

            await this.audioEngine.startRecording();
            this.analyser = this.audioEngine.getAnalyserNode();
            this.isRecording = true;
            this.updateMicButtonUI(true);
            this.startWaveformAnimation();

            console.log('[AudioInput] Recording started');
        } catch (error) {
            console.error('[AudioInput] Error starting recording:', error);
            this.showNotification('Microphone access denied or failed.', 'error');
            this.cleanup();
        }
    }

    async stopRecording() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        if (!this.isRecording) {
            return;
        }

        this.isRecording = false;
        this.updateMicButtonUI(false);

        const { chunks, sampleRate } = await this.audioEngine.stopRecording();
        this.audioChunks = chunks;
        this.capturedSampleRate = sampleRate;

        await new Promise(resolve => setTimeout(resolve, 50));
        await this.processAudio();
    }

    async processAudio() {
        if (this.audioChunks.length === 0) {
            console.log('[AudioInput] No audio captured');
            this.updateMicButtonUI(false);
            return;
        }

        console.log(`[AudioInput] Processing ${this.audioChunks.length} audio chunks...`);
        this.isProcessing = true;
        this.updateMicButtonUI(false);
        this.micButton.classList.add('processing');

        try {
            const rawBuffer = flattenAudioChunks(this.audioChunks);
            const originalSampleRate = this.capturedSampleRate || this.audioEngine.getSampleRate();
            const audioBuffer = new AudioBuffer({
                length: rawBuffer.length,
                numberOfChannels: 1,
                sampleRate: originalSampleRate
            });
            audioBuffer.copyToChannel(rawBuffer, 0);

            const resampledData = await nativeResample(audioBuffer, TARGET_SAMPLE_RATE);
            let finalData = normalizeAudio(resampledData);
            finalData = trimSilence(finalData);

            if (finalData.length < MIN_SPEECH_SAMPLES) {
                console.log('[AudioInput] Audio too short after trimming silence');
                this.showNotification('No speech detected', 'warning');
                return;
            }

            const durationSeconds = finalData.length / TARGET_SAMPLE_RATE;
            if (durationSeconds > MAX_AUDIO_SECONDS) {
                this.showNotification('Voice input is too long. Please keep it under 2 minutes.', 'warning');
                return;
            }

            const wavBuffer = this.encodeWavPcm16(finalData, TARGET_SAMPLE_RATE);
            const audioBase64 = this.arrayBufferToBase64(wavBuffer);
            const result = await this.transcribeWithCloud(audioBase64);

            if (!result?.text) {
                this.showNotification("Could not hear you clearly. Try speaking closer.", "warning");
            } else {
                this.appendToTextarea(result.text);
            }
        } catch (error) {
            console.error('[AudioInput] Error processing audio:', error);
            this.showNotification(error.message || 'Failed to process audio', 'error');
        } finally {
            this.isProcessing = false;
            this.updateMicButtonUI(false);
            this.audioChunks = [];
        }
    }

    async transcribeWithCloud(audioBase64) {
        const session = await this.getAuthSession();
        if (!session?.access_token) {
            throw new Error('Please sign in to use voice input.');
        }

        const response = await fetch(CLOUD_MIC_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                audio: audioBase64,
                format: 'wav',
                language: 'en'
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || 'Cloud voice transcription failed.');
        }

        console.log('[AudioInput] Cloud transcription complete:', payload);
        return payload;
    }

    async getAuthSession() {
        if (!window.electron?.auth?.getSession) {
            return null;
        }
        try {
            return await window.electron.auth.getSession();
        } catch (error) {
            console.warn('[AudioInput] Failed to read auth session:', error);
            return null;
        }
    }

    encodeWavPcm16(float32, sampleRate) {
        const numChannels = 1;
        const bitsPerSample = 16;
        const blockAlign = numChannels * (bitsPerSample / 8);
        const byteRate = sampleRate * blockAlign;
        const dataSize = float32.length * 2;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        this.writeAscii(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this.writeAscii(view, 8, 'WAVE');
        this.writeAscii(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        this.writeAscii(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        let offset = 44;
        for (let i = 0; i < float32.length; i++) {
            const clamped = Math.max(-1, Math.min(1, float32[i]));
            const sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
            view.setInt16(offset, Math.round(sample), true);
            offset += 2;
        }

        return buffer;
    }

    writeAscii(view, offset, text) {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    startWaveformAnimation() {
        if (!this.analyser) return;
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const animate = () => {
            if (!this.isRecording) return;
            this.animationFrame = requestAnimationFrame(animate);
            this.analyser.getByteFrequencyData(dataArray);
            this.updateWaveformBars(dataArray);
        };
        animate();
    }

    updateWaveformBars(dataArray) {
        if (!this.waveformBars.length) return;
        const barCount = this.waveformBars.length;
        const segmentSize = Math.floor(dataArray.length / barCount);

        this.waveformBars.forEach((bar, index) => {
            let sum = 0;
            const start = index * segmentSize;
            const end = start + segmentSize;
            for (let i = start; i < end; i++) sum += dataArray[i];

            const average = sum / segmentSize;
            const heightPercent = 20 + (average / 255) * 100;
            bar.style.height = `${Math.min(heightPercent, 100)}%`;
        });
    }

    updateMicButtonUI(isRecording) {
        if (!this.micButton) return;
        this.micButton.classList.remove('processing');

        if (isRecording) {
            this.micButton.classList.add('recording');
            this.createWaveformBars();
        } else {
            this.micButton.classList.remove('recording');
            this.removeWaveformBars();
        }
    }

    createWaveformBars() {
        this.removeWaveformBars();
        const container = document.createElement('div');
        container.className = 'waveform-container';
        for (let i = 0; i < 5; i++) {
            const bar = document.createElement('div');
            bar.className = 'waveform-bar';
            bar.style.height = `${30 + (i % 3) * 20}%`;
            container.appendChild(bar);
            this.waveformBars.push(bar);
        }
        const icon = this.micButton.querySelector('i');
        if (icon) icon.style.display = 'none';
        this.micButton.appendChild(container);
    }

    removeWaveformBars() {
        const container = this.micButton?.querySelector('.waveform-container');
        if (container) container.remove();
        const icon = this.micButton?.querySelector('i');
        if (icon) icon.style.display = '';
        this.waveformBars = [];
    }

    appendToTextarea(text) {
        if (!this.targetTextarea || !text) return;
        const currentValue = this.targetTextarea.value;
        const newValue = currentValue ? `${currentValue} ${text}`.trim() : text.trim();
        this.targetTextarea.value = newValue;

        const event = new Event('input', { bubbles: true });
        this.targetTextarea.dispatchEvent(event);
        this.targetTextarea.focus();
    }

    showNotification(message, type = 'info', duration = 5000) {
        if (window.NotificationService) {
            window.NotificationService.show(message, type, duration);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    cleanup() {
        this.isRecording = false;
        this.isProcessing = false;

        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.audioEngine.setIdleState(true);

        this.updateMicButtonUI(false);
    }

    destroy() {
        this.cleanup();
        if (this.micButton) {
            this.micButton.removeEventListener('click', this.boundToggleRecording);
        }
        this.micButton = null;
        this.targetTextarea = null;
    }
}

window.AudioInputHandler = AudioInputHandler;
export default AudioInputHandler;
