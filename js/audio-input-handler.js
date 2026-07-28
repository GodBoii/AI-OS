// js/audio-input-handler.js - Cloud-only intelligent mic input
import { flattenAudioChunks, normalizeAudio, nativeResample, trimSilence } from './audio-utils.js';
import AudioEngine from './audio-engine.js';
import { mountThinkingOrb } from './thinking-orb.js';

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
        this.micOrb = null;
        this.micVisualState = 'idle';
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
        this.setMicVisualState('idle');
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
            this.isRecording = true;
            this.setMicVisualState('recording');

            console.log('[AudioInput] Recording started');
        } catch (error) {
            console.error('[AudioInput] Error starting recording:', error);
            this.showNotification('Microphone access denied or failed.', 'error');
            this.cleanup();
        }
    }

    async stopRecording() {
        if (!this.isRecording) {
            return;
        }

        this.isRecording = false;
        this.isProcessing = true;
        this.setMicVisualState('processing');

        try {
            const { chunks, sampleRate } = await this.audioEngine.stopRecording();
            this.audioChunks = chunks;
            this.capturedSampleRate = sampleRate;

            await new Promise(resolve => setTimeout(resolve, 50));
            await this.processAudio();
        } catch (error) {
            console.error('[AudioInput] Error stopping recording:', error);
            this.isProcessing = false;
            this.setMicVisualState('idle');
            this.showNotification('Could not finish the voice recording.', 'error');
        }
    }

    async processAudio() {
        if (this.audioChunks.length === 0) {
            console.log('[AudioInput] No audio captured');
            this.isProcessing = false;
            this.setMicVisualState('idle');
            return;
        }

        console.log(`[AudioInput] Processing ${this.audioChunks.length} audio chunks...`);
        this.isProcessing = true;
        this.setMicVisualState('processing');

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
            this.setMicVisualState('idle');
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

    setMicVisualState(state) {
        if (!this.micButton) return;
        const nextState = ['recording', 'processing'].includes(state) ? state : 'idle';
        const isRecording = nextState === 'recording';
        const isProcessing = nextState === 'processing';
        const isOrbVisible = isRecording || isProcessing;
        const icon = this.micButton.querySelector('i');

        this.micVisualState = nextState;
        this.micButton.classList.toggle('recording', isRecording);
        this.micButton.classList.toggle('processing', isProcessing);
        this.micButton.setAttribute('aria-pressed', String(isRecording));
        this.micButton.setAttribute('aria-busy', String(isProcessing));
        this.micButton.setAttribute('aria-disabled', String(isProcessing));

        if (!isOrbVisible) {
            this.micOrb?.destroy();
            this.micOrb = null;
            this.micButton.querySelector('.mic-orb-mount')?.remove();
            if (icon) {
                icon.hidden = false;
                icon.style.display = '';
            }
            this.micButton.setAttribute('aria-label', 'Voice input');
            this.micButton.setAttribute('title', 'Voice input');
            this.micButton.dataset.tooltip = 'Voice Input (Click to start)';
            return;
        }

        let mount = this.micButton.querySelector('.mic-orb-mount');
        if (!mount) {
            mount = document.createElement('span');
            mount.className = 'mic-orb-mount';
            mount.setAttribute('aria-hidden', 'true');
            this.micButton.appendChild(mount);
        }
        if (icon) {
            icon.hidden = true;
            icon.style.display = 'none';
        }

        const accessibleLabel = isRecording
            ? 'Voice recording active. Click to stop.'
            : 'Transcribing voice input…';
        if (!this.micOrb) {
            this.micOrb = mountThinkingOrb(mount, {
                state: 'composing',
                size: 64,
                speed: 1,
                ariaLabel: accessibleLabel,
            });
        } else {
            this.micOrb.setState('composing');
            this.micOrb.setAriaLabel(accessibleLabel);
            this.micOrb.setPaused(false);
        }

        this.micButton.setAttribute('aria-label', accessibleLabel);
        this.micButton.setAttribute(
            'title',
            isRecording ? 'Stop voice recording' : 'Transcribing voice input',
        );
        this.micButton.dataset.tooltip = isRecording
            ? 'Listening… Click to stop'
            : 'Transcribing voice input…';
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

        this.audioEngine.setIdleState(true);

        this.setMicVisualState('idle');
    }

    destroy() {
        this.cleanup();
        if (this.micButton) {
            this.micButton.removeEventListener('click', this.boundToggleRecording);
        }
        this.audioEngine.destroy().catch(error => {
            console.warn('[AudioInput] Failed to destroy audio engine cleanly:', error);
        });
        this.micButton = null;
        this.targetTextarea = null;
    }
}

window.AudioInputHandler = AudioInputHandler;
export default AudioInputHandler;
