// js/audio-input-handler.js - Offline Whisper-based Voice Input
import { flattenAudioChunks, normalizeAudio, nativeResample, trimSilence } from './audio-utils.js';
import AudioEngine from './audio-engine.js';

/**
 * AudioInputHandler - Offline voice-to-text using Whisper
 * 
 * Features:
 * - Local Whisper model (base.en)
 * - AudioWorklet for efficient audio capture
 * - 3x Gain Amplification for better sensitivity
 * - DC Offset removal and Native Resampling
 * - Silence Trimming (VAD)
 */
class AudioInputHandler {
    constructor() {
        this.isRecording = false;
        this.isProcessing = false;
        this.audioEngine = new AudioEngine();
        this.audioEngine.setAutoStopCallback(() => {
            if (this.isRecording && !this.isProcessing) {
                this.stopRecording();
            }
        });

        this.analyser = null;
        this.worker = null;
        this.modelReady = false;
        
        this.micButton = null;
        this.targetTextarea = null;
        this.audioChunks = [];
        this.waveformBars = [];
        this.animationFrame = null;
        
        // Initialize worker
        this.initWorker();
    }

    initWorker() {
        try {
            this.worker = new Worker('js/whisper-worker.js', { type: 'module' });
            
            this.worker.onmessage = (e) => {
                const { type, data } = e.data;
                
                switch (type) {
                    case 'ready':
                        console.log('[AudioInput] Whisper model ready');
                        this.modelReady = true;
                        this.showNotification('Voice input ready', 'success');
                        break;
                        
                    case 'download':
                        this.updateDownloadProgress(data);
                        break;
                        
                    case 'result':
                        console.log('[AudioInput] Transcription complete:', data);
                        if (!data || data.length === 0) {
                            this.showNotification("Could not hear you clearly. Try speaking closer.", "warning");
                        } else {
                            this.appendToTextarea(data);
                        }
                        this.isProcessing = false;
                        this.updateMicButtonUI(false);
                        break;
                        
                    case 'error':
                        console.error('[AudioInput] Worker error:', data);
                        this.showNotification(data, 'error');
                        this.isProcessing = false;
                        this.updateMicButtonUI(false);
                        break;
                        
                    case 'status':
                        this.modelReady = data.loaded;
                        break;
                }
            };
            
            this.worker.onerror = (error) => {
                console.error('[AudioInput] Worker error:', error);
                this.showNotification('Voice input initialization failed', 'error');
            };
            
            console.log('[AudioInput] Worker initialized');
        } catch (error) {
            console.error('[AudioInput] Failed to create worker:', error);
        }
    }

    async checkModelAvailability() {
        return new Promise((resolve) => {
            if (!this.worker) {
                resolve(false);
                return;
            }
            this.worker.postMessage({ type: 'check' });
            const timeout = setTimeout(() => { resolve(false); }, 1000);
            const handler = (e) => {
                if (e.data.type === 'status') {
                    clearTimeout(timeout);
                    this.worker.removeEventListener('message', handler);
                    resolve(e.data.data.loaded);
                }
            };
            this.worker.addEventListener('message', handler);
        });
    }

    async downloadModel() {
        if (!this.worker) return;
        console.log('[AudioInput] Starting model download...');
        this.showNotification('Downloading voice model (~140MB)...', 'info', 0);
        this.worker.postMessage({ type: 'load' });
    }

    updateDownloadProgress(data) {
        const progress = Math.round(data.progress || 0);
        if (window.NotificationService) {
            window.NotificationService.show(`Downloading model: ${progress}%`, 'info', 0);
        }
    }

    initialize(micButtonElement, textareaElement) {
        this.micButton = micButtonElement;
        this.targetTextarea = textareaElement;
        
        if (!this.micButton || !this.targetTextarea) {
            console.error('[AudioInput] Required elements not found');
            return false;
        }
        
        this.micButton.addEventListener('click', () => this.toggleRecording());
        console.log('[AudioInput] Initialized successfully');
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
        if (!this.modelReady) {
            this.showNotification('Voice model is still loading. Please wait...', 'warning');
            return;
        }
        
        try {
            console.log('[AudioInput] Starting recording...');
            this.audioChunks = [];
            
            await this.audioEngine.startRecording(() => {
                if (this.isRecording && !this.isProcessing) {
                    this.stopRecording();
                }
            });
            this.analyser = this.audioEngine.getAnalyserNode();
            this.isRecording = true;
            this.updateMicButtonUI(true);
            this.startWaveformAnimation();
            
            console.log('[AudioInput] Recording started via AudioEngine');
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
        
        await new Promise(r => setTimeout(r, 50));
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
            // 1. Flatten into one Float32Array
            const rawBuffer = flattenAudioChunks(this.audioChunks);
            
            // 2. Convert to AudioBuffer for native processing
            const originalSampleRate = this.capturedSampleRate || this.audioEngine.getSampleRate();
            
            const audioBuffer = new AudioBuffer({
                length: rawBuffer.length,
                numberOfChannels: 1,
                sampleRate: originalSampleRate
            });
            audioBuffer.copyToChannel(rawBuffer, 0);
            
            // 3. Native Resample to 16kHz (High quality interpolation)
            const resampledData = await nativeResample(audioBuffer, 16000);
            
            // 4. Normalize (Remove DC Offset) & Trim Silence
            let finalData = normalizeAudio(resampledData);
            finalData = trimSilence(finalData);
            
            console.log(`[AudioInput] Final audio samples: ${finalData.length}`);
            
            // 5. Validation: If audio is too short after trimming silence, don't send
            // 2000 samples @ 16kHz = 0.125 seconds
            if (finalData.length < 2000) {
                console.log('Audio too short after trimming silence');
                this.showNotification('No speech detected', 'warning');
                this.isProcessing = false;
                this.updateMicButtonUI(false);
                return;
            }
            
            // 6. Send to Worker
            this.worker.postMessage({
                type: 'transcribe',
                audio: finalData
            });
            
        } catch (error) {
            console.error('[AudioInput] Error processing audio:', error);
            this.showNotification('Failed to process audio', 'error');
            this.isProcessing = false;
            this.updateMicButtonUI(false);
        }
        
        this.audioChunks = [];
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
            // Boost visual height slightly for better feedback
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
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        if (this.micButton) {
            this.micButton.removeEventListener('click', this.toggleRecording);
        }
        this.micButton = null;
        this.targetTextarea = null;
    }
}

window.AudioInputHandler = AudioInputHandler;
export default AudioInputHandler;