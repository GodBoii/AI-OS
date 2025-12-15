// js/audio-engine.js - Persistent audio capture and conditioning

const PRE_ROLL_MS = 400; // milliseconds of history to prepend
const DEFAULT_AUTO_STOP = {
    enabled: true,
    minRecordingDurationMs: 1500,
    silenceDurationMs: 1300
};

const SPEECH_THRESHOLDS = {
    baseEnergy: 0.004,
    consonantFactor: 0.6,
    zcr: 0.12
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.mediaStream = null;
        this.mediaTrack = null;
        this.sourceNode = null;
        this.highpassNode = null;
        this.compressorNode = null;
        this.monitorGainNode = null;
        this.analyserNode = null;
        this.workletNode = null;

        this.sampleRate = 16000;
        this.isInitialized = false;
        this.isRecording = false;
        this.isMonitoring = false;
        this.recordingDurationMs = 0;
        this.recordingStartTimestamp = 0;
        this.lastSpeechTimestamp = 0;
        this.autoStopTriggered = false;
        this.onAutoStop = null;
        this.autoStopConfig = { ...DEFAULT_AUTO_STOP };

        this.preRollBuffer = [];
        this.preRollSampleCount = 0;
        this.maxPreRollSamples = 0;
        this.activeChunks = [];

        this.handleWorkletMessage = this.handleWorkletMessage.bind(this);
    }

    async ensureInitialized() {
        if (this.isInitialized) {
            return;
        }

        await this.createAudioContext();
        await this.acquireMediaStream();
        await this.buildAudioGraph();
        this.isInitialized = true;
    }

    async createAudioContext() {
        if (this.audioContext) return;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sampleRate = this.audioContext.sampleRate;
        this.maxPreRollSamples = Math.round((PRE_ROLL_MS / 1000) * this.sampleRate);
    }

    async acquireMediaStream() {
        if (this.mediaStream) return;
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false
            }
        });
        this.mediaTrack = this.mediaStream.getAudioTracks()[0] || null;
        if (this.mediaTrack) {
            this.mediaTrack.enabled = true;
        }
    }

    async buildAudioGraph() {
        if (!this.audioContext || !this.mediaStream) return;

        const ctx = this.audioContext;

        this.sourceNode = ctx.createMediaStreamSource(this.mediaStream);

        this.highpassNode = ctx.createBiquadFilter();
        this.highpassNode.type = 'highpass';
        this.highpassNode.frequency.value = 80;

        this.compressorNode = ctx.createDynamicsCompressor();
        this.compressorNode.threshold.value = -24;
        this.compressorNode.knee.value = 30;
        this.compressorNode.ratio.value = 4;
        this.compressorNode.attack.value = 0.005;
        this.compressorNode.release.value = 0.25;

        this.analyserNode = ctx.createAnalyser();
        this.analyserNode.fftSize = 512;
        this.analyserNode.smoothingTimeConstant = 0.7;

        await ctx.audioWorklet.addModule('js/audio-worklet-processor.js');
        this.workletNode = new AudioWorkletNode(ctx, 'audio-capture-processor');
        this.workletNode.port.onmessage = this.handleWorkletMessage;

        // Keep context active without routing audio to speakers
        this.monitorGainNode = ctx.createGain();
        this.monitorGainNode.gain.value = 0;

        this.sourceNode.connect(this.highpassNode);
        this.highpassNode.connect(this.compressorNode);
        this.compressorNode.connect(this.analyserNode);
        this.analyserNode.connect(this.workletNode);
        this.workletNode.connect(this.monitorGainNode);
        this.monitorGainNode.connect(ctx.destination);

        if (ctx.state === 'suspended') {
            await ctx.resume();
        }

        this.isMonitoring = true;
    }

    async startRecording() {
        await this.ensureInitialized();
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        if (this.mediaTrack) {
            this.mediaTrack.enabled = true;
        }
        this.isMonitoring = true;
        if (this.isRecording) {
            return;
        }
        this.isRecording = true;
        this.recordingDurationMs = 0;
        this.recordingStartTimestamp = now();
        this.lastSpeechTimestamp = this.recordingStartTimestamp;
        this.autoStopTriggered = false;
        const preRollCopy = this.preRollBuffer.map(chunk => chunk.slice());
        this.activeChunks = preRollCopy.length ? [...preRollCopy] : [];
        if (this.workletNode) {
            this.workletNode.port.postMessage({ command: 'start' });
        }
    }

    async stopRecording() {
        if (!this.isRecording) {
            return { chunks: [], sampleRate: this.sampleRate };
        }
        this.isRecording = false;
        this.autoStopTriggered = true;
        this.recordingDurationMs = 0;
        if (this.workletNode) {
            this.workletNode.port.postMessage({ command: 'stop' });
        }
        const chunks = this.activeChunks;
        this.activeChunks = [];
        this.preRollBuffer = [];
        this.preRollSampleCount = 0;
        return { chunks, sampleRate: this.sampleRate };
    }

    handleWorkletMessage(event) {
        if (!event?.data || event.data.type !== 'audio' || !event.data.data) return;
        const chunk = new Float32Array(event.data.data);

        if (event.data.isRecording) {
            this.activeChunks.push(chunk);
            this.trackSpeechActivity(chunk);
            return;
        }

        if (!this.isMonitoring) return;

        this.preRollBuffer.push(chunk);
        this.preRollSampleCount += chunk.length;
        while (this.preRollSampleCount > this.maxPreRollSamples && this.preRollBuffer.length > 1) {
            const removed = this.preRollBuffer.shift();
            this.preRollSampleCount -= removed.length;
        }
    }

    getAnalyserNode() {
        return this.analyserNode;
    }

    getSampleRate() {
        return this.sampleRate;
    }

    setIdleState(isIdle) {
        if (this.mediaTrack) {
            this.mediaTrack.enabled = !isIdle;
        }
        this.isMonitoring = !isIdle;
    }

    setAutoStopCallback(callback) {
        this.onAutoStop = callback;
    }

    setAutoStopConfig(config = {}) {
        this.autoStopConfig = { ...this.autoStopConfig, ...config };
    }

    trackSpeechActivity(chunk) {
        if (!this.autoStopConfig.enabled || !this.isRecording) {
            return;
        }

        const metrics = this.analyzeChunk(chunk);
        const chunkDurationMs = (chunk.length / this.sampleRate) * 1000;
        this.recordingDurationMs += chunkDurationMs;

        if (metrics.isSpeech) {
            this.lastSpeechTimestamp = now();
        }

        if (this.shouldAutoStop()) {
            this.triggerAutoStop();
        }
    }

    analyzeChunk(chunk) {
        let sumSquares = 0;
        let zeroCrossings = 0;
        let prev = chunk[0] || 0;
        for (let i = 0; i < chunk.length; i++) {
            const sample = chunk[i];
            sumSquares += sample * sample;
            if ((prev >= 0 && sample < 0) || (prev < 0 && sample >= 0)) {
                zeroCrossings++;
            }
            prev = sample;
        }

        const rms = Math.sqrt(sumSquares / Math.max(1, chunk.length));
        const zcr = zeroCrossings / Math.max(1, chunk.length);
        const energyThreshold = Math.max(SPEECH_THRESHOLDS.baseEnergy, rms * 0.3);
        const consonantThreshold = energyThreshold * SPEECH_THRESHOLDS.consonantFactor;
        const isSpeech = rms >= energyThreshold || (rms >= consonantThreshold && zcr >= SPEECH_THRESHOLDS.zcr);
        return { rms, zcr, isSpeech };
    }

    shouldAutoStop() {
        if (this.autoStopTriggered) return false;
        if (!this.isRecording) return false;
        if (this.recordingDurationMs < this.autoStopConfig.minRecordingDurationMs) return false;
        if (!this.lastSpeechTimestamp) return false;

        const silenceDuration = now() - this.lastSpeechTimestamp;
        return silenceDuration >= this.autoStopConfig.silenceDurationMs;
    }

    triggerAutoStop() {
        if (this.autoStopTriggered) return;
        this.autoStopTriggered = true;
        if (typeof this.onAutoStop === 'function') {
            this.onAutoStop();
        }
    }

    async destroy() {
        this.isRecording = false;
        this.isMonitoring = false;
        this.preRollBuffer = [];
        this.activeChunks = [];

        if (this.workletNode) {
            this.workletNode.port.onmessage = null;
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.monitorGainNode) {
            this.monitorGainNode.disconnect();
            this.monitorGainNode = null;
        }

        if (this.analyserNode) {
            this.analyserNode.disconnect();
            this.analyserNode = null;
        }

        if (this.compressorNode) {
            this.compressorNode.disconnect();
            this.compressorNode = null;
        }

        if (this.highpassNode) {
            this.highpassNode.disconnect();
            this.highpassNode = null;
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
            this.mediaTrack = null;
        }

        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }
        this.isInitialized = false;
    }
}

export default AudioEngine;
