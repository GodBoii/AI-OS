// Windows-native, literal speech-to-text input for the standard microphone.
class WindowsSpeechInputHandler {
    constructor() {
        this.button = null;
        this.targetTextarea = null;
        this.isStarting = false;
        this.isRecording = false;
        this.isStopping = false;
        this.baseText = '';
        this.finalSegments = [];
        this.interimText = '';
        this.lastInterimText = '';
        this.waveformBars = [];
        this.waveformFrame = null;
        this.targetAudioLevel = 0;
        this.displayBandLevels = [0, 0, 0, 0, 0];
        this.visualizerStream = null;
        this.visualizerContext = null;
        this.visualizerSource = null;
        this.visualizerAnalyser = null;
        this.visualizerMute = null;
        this.visualizerFrequencyData = null;
        this.visualizerStartPromise = null;
        this.visualizerGeneration = 0;
        this.removeNativeListener = null;
        this.canStart = () => true;
        this.onStateChange = () => {};
        this.language = 'en-US';
        this.discardCurrentSession = false;
        this.boundToggle = () => this.toggle();
    }

    initialize(buttonElement, textareaElement, options = {}) {
        this.button = buttonElement;
        this.targetTextarea = textareaElement;
        this.canStart = typeof options.canStart === 'function' ? options.canStart : () => true;
        this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};
        this.language = typeof options.language === 'string' ? options.language : 'en-US';

        if (!this.button || !this.targetTextarea || !window.electron?.nativeSpeech) {
            this.markUnsupported();
            return false;
        }

        this.button.addEventListener('click', this.boundToggle);
        this.removeNativeListener = window.electron.nativeSpeech.onEvent((event) => this.handleNativeEvent(event));
        this.setVisualState('idle');
        this.checkAvailability();
        return true;
    }

    async checkAvailability() {
        try {
            const status = await window.electron.nativeSpeech.getStatus();
            if (!status?.supported) {
                this.markUnsupported();
            }
        } catch (error) {
            console.warn('[WindowsSpeechInput] Availability check failed:', error);
            this.markUnsupported();
        }
    }

    isActive() {
        return this.isStarting || this.isRecording || this.isStopping;
    }

    async toggle() {
        if (this.isStarting || this.isStopping) return;
        if (this.isRecording) {
            await this.stop();
            return;
        }
        await this.start();
    }

    async start() {
        if (!this.canStart()) {
            this.showNotification('Finish the current voice input first.', 'warning');
            return;
        }

        this.baseText = this.targetTextarea.value.trim();
        this.finalSegments = [];
        this.interimText = '';
        this.lastInterimText = '';
        this.discardCurrentSession = false;
        this.isStarting = true;
        this.setVisualState('starting');

        try {
            const result = await window.electron.nativeSpeech.start({ language: this.language });
            if (!result?.ok) {
                throw new Error(result?.error || 'Windows speech input could not start.');
            }
        } catch (error) {
            this.resetState();
            this.showNotification(error.message || 'Windows speech input could not start.', 'error');
        }
    }

    async stop() {
        if (!this.isActive()) return;
        this.isStarting = false;
        this.isRecording = false;
        this.isStopping = true;
        this.setVisualState('processing');

        try {
            const result = await window.electron.nativeSpeech.stop();
            if (!result?.ok) {
                throw new Error(result?.error || 'Windows speech input could not stop cleanly.');
            }
        } catch (error) {
            this.commitLastInterimIfNeeded();
            this.resetState();
            this.showNotification(error.message || 'Windows speech input could not stop cleanly.', 'error');
        }
    }

    handleNativeEvent(event = {}) {
        if (this.discardCurrentSession) {
            if (event.type === 'end' || event.type === 'closed' || event.type === 'error') {
                this.discardCurrentSession = false;
                this.resetState();
            }
            return;
        }

        switch (event.type) {
            case 'ready':
            case 'listening':
                this.isStarting = false;
                this.isRecording = true;
                this.isStopping = false;
                this.setVisualState('recording');
                break;
            case 'interim':
                this.interimText = String(event.text || '').trim();
                if (this.interimText) this.lastInterimText = this.interimText;
                this.renderTranscript();
                break;
            case 'result': {
                const text = String(event.text || '').trim();
                if (text) this.finalSegments.push(text);
                this.interimText = '';
                this.lastInterimText = '';
                this.renderTranscript();
                break;
            }
            case 'audio-level':
                this.updateAudioLevel(event.level);
                break;
            case 'error':
                this.commitLastInterimIfNeeded();
                this.resetState();
                this.showNotification(this.getErrorMessage(event), 'error');
                break;
            case 'end':
            case 'closed':
                this.commitLastInterimIfNeeded();
                this.resetState();
                break;
            default:
                break;
        }
    }

    renderTranscript() {
        if (!this.targetTextarea) return;
        const pieces = [this.baseText, ...this.finalSegments, this.interimText]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        this.targetTextarea.value = pieces.join(' ');
        this.targetTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        this.targetTextarea.focus();
    }

    commitLastInterimIfNeeded() {
        const lastFinal = this.finalSegments[this.finalSegments.length - 1] || '';
        if (this.lastInterimText && this.lastInterimText !== lastFinal) {
            this.finalSegments.push(this.lastInterimText);
        }
        this.interimText = '';
        this.lastInterimText = '';
        this.renderTranscript();
    }

    resetState() {
        this.isStarting = false;
        this.isRecording = false;
        this.isStopping = false;
        this.setVisualState('idle');
    }

    createWaveform() {
        if (!this.button || this.button.querySelector('.native-waveform')) return;

        const waveform = document.createElement('span');
        waveform.className = 'native-waveform';
        waveform.setAttribute('aria-hidden', 'true');
        this.waveformBars = [];

        for (let index = 0; index < 5; index += 1) {
            const bar = document.createElement('span');
            bar.className = 'native-waveform-bar';
            waveform.appendChild(bar);
            this.waveformBars.push(bar);
        }

        this.button.appendChild(waveform);
        this.startWaveformAnimation();
    }

    removeWaveform() {
        if (this.waveformFrame !== null) {
            cancelAnimationFrame(this.waveformFrame);
            this.waveformFrame = null;
        }
        this.button?.querySelector('.native-waveform')?.remove();
        this.waveformBars = [];
        this.targetAudioLevel = 0;
        this.displayBandLevels = [0, 0, 0, 0, 0];
        this.stopVisualizerCapture();
    }

    updateAudioLevel(level) {
        if (!this.isRecording) return;
        const normalized = Math.max(0, Math.min(100, Number(level) || 0)) / 100;
        const perceptualLevel = Math.pow(normalized, 0.62);
        this.targetAudioLevel = Math.max(this.targetAudioLevel, perceptualLevel);
    }

    async startVisualizerCapture() {
        if (this.visualizerStream || this.visualizerStartPromise) {
            return this.visualizerStartPromise;
        }
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            return null;
        }

        const generation = ++this.visualizerGeneration;
        const startup = (async () => {
            let stream = null;
            let context = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: true,
                    },
                    video: false,
                });

                if (!this.isRecording || generation !== this.visualizerGeneration) {
                    stream.getTracks().forEach((track) => track.stop());
                    return null;
                }

                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) {
                    stream.getTracks().forEach((track) => track.stop());
                    return null;
                }

                context = new AudioContextClass();
                const source = context.createMediaStreamSource(stream);
                const analyser = context.createAnalyser();
                const mute = context.createGain();
                analyser.fftSize = 256;
                analyser.minDecibels = -92;
                analyser.maxDecibels = -24;
                analyser.smoothingTimeConstant = 0.68;
                mute.gain.value = 0;
                source.connect(analyser);
                analyser.connect(mute);
                mute.connect(context.destination);

                if (context.state === 'suspended') {
                    await context.resume();
                }
                if (!this.isRecording || generation !== this.visualizerGeneration) {
                    source.disconnect();
                    analyser.disconnect();
                    mute.disconnect();
                    stream.getTracks().forEach((track) => track.stop());
                    await context.close();
                    return null;
                }

                this.visualizerStream = stream;
                this.visualizerContext = context;
                this.visualizerSource = source;
                this.visualizerAnalyser = analyser;
                this.visualizerMute = mute;
                this.visualizerFrequencyData = new Uint8Array(analyser.frequencyBinCount);
                return analyser;
            } catch (error) {
                stream?.getTracks?.().forEach((track) => track.stop());
                if (context && context.state !== 'closed') {
                    await context.close().catch(() => {});
                }
                console.warn('[WindowsSpeechInput] Live level visualizer unavailable:', error);
                return null;
            }
        })();

        this.visualizerStartPromise = startup;
        try {
            return await startup;
        } finally {
            if (this.visualizerStartPromise === startup) {
                this.visualizerStartPromise = null;
            }
        }
    }

    stopVisualizerCapture() {
        this.visualizerGeneration += 1;
        this.visualizerFrequencyData = null;
        this.visualizerAnalyser = null;
        this.visualizerSource?.disconnect?.();
        this.visualizerMute?.disconnect?.();
        this.visualizerSource = null;
        this.visualizerMute = null;
        this.visualizerStream?.getTracks?.().forEach((track) => track.stop());
        this.visualizerStream = null;

        const context = this.visualizerContext;
        this.visualizerContext = null;
        if (context && context.state !== 'closed') {
            context.close().catch(() => {});
        }
    }

    readFrequencyBands() {
        const analyser = this.visualizerAnalyser;
        const data = this.visualizerFrequencyData;
        const context = this.visualizerContext;
        if (!analyser || !data || !context) return null;

        analyser.getByteFrequencyData(data);
        const edgesHz = [80, 220, 440, 800, 1450, 2600, 4200];
        const hzPerBin = context.sampleRate / analyser.fftSize;

        return edgesHz.slice(0, -1).map((startHz, index) => {
            const start = Math.max(1, Math.floor(startHz / hzPerBin));
            const end = Math.min(data.length, Math.max(start + 1, Math.ceil(edgesHz[index + 1] / hzPerBin)));
            let energy = 0;
            for (let bin = start; bin < end; bin += 1) {
                const magnitude = data[bin] / 255;
                energy += magnitude * magnitude;
            }
            const rms = Math.sqrt(energy / Math.max(1, end - start));
            return Math.max(0, Math.min(1, (rms - 0.035) * 1.9));
        });
    }

    startWaveformAnimation() {
        if (this.waveformFrame !== null) return;
        const fallbackProfile = [0.58, 0.82, 1, 0.78, 0.54];
        const bandMap = [0, 1, 2, 3, 5];

        const render = () => {
            if (!this.isRecording || !this.waveformBars.length) {
                this.waveformFrame = null;
                return;
            }

            const frequencyBands = this.readFrequencyBands();
            this.targetAudioLevel *= 0.82;

            this.waveformBars.forEach((bar, index) => {
                const liveLevel = frequencyBands
                    ? frequencyBands[bandMap[index]]
                    : this.targetAudioLevel * fallbackProfile[index];
                this.displayBandLevels[index] += (liveLevel - this.displayBandLevels[index]) * 0.46;
                const scale = Math.min(1, 0.14 + (Math.pow(this.displayBandLevels[index], 0.72) * 0.96));
                bar.style.transform = `scaleY(${scale.toFixed(3)})`;
            });

            this.waveformFrame = requestAnimationFrame(render);
        };

        this.waveformFrame = requestAnimationFrame(render);
    }

    async cancel() {
        if (!this.isActive()) return;
        this.discardCurrentSession = true;
        this.interimText = '';
        this.lastInterimText = '';
        try {
            await window.electron.nativeSpeech.stop();
        } finally {
            this.resetState();
        }
    }

    setVisualState(state) {
        if (!this.button) return;
        const isStarting = state === 'starting';
        const isRecording = state === 'recording';
        const isProcessing = state === 'processing';

        this.button.classList.toggle('native-starting', isStarting);
        this.button.classList.toggle('native-recording', isRecording);
        this.button.classList.toggle('native-processing', isProcessing);
        this.button.setAttribute('aria-pressed', String(isRecording));
        this.button.setAttribute('aria-busy', String(isStarting || isProcessing));

        if (isRecording) {
            this.createWaveform();
            void this.startVisualizerCapture();
            this.button.setAttribute('aria-label', 'Windows dictation active. Click to stop.');
            this.button.setAttribute('title', 'Stop Windows dictation');
            this.button.dataset.tooltip = 'Listening with Windows… Click to stop';
        } else if (isStarting || isProcessing) {
            this.removeWaveform();
            this.button.setAttribute('aria-label', isStarting ? 'Starting Windows dictation' : 'Finishing Windows dictation');
            this.button.setAttribute('title', isStarting ? 'Starting Windows dictation' : 'Finishing Windows dictation');
            this.button.dataset.tooltip = isStarting ? 'Starting Windows dictation…' : 'Finishing dictation…';
        } else {
            this.removeWaveform();
            this.button.setAttribute('aria-label', 'Normal voice dictation');
            this.button.setAttribute('title', 'Normal voice dictation');
            this.button.dataset.tooltip = 'Normal Voice Dictation';
        }

        this.onStateChange(state);
    }

    markUnsupported() {
        if (!this.button) return;
        this.button.disabled = true;
        this.button.classList.add('not-supported');
        this.button.setAttribute('aria-label', 'Windows dictation unavailable');
        this.button.setAttribute('title', 'Windows dictation is unavailable on this device');
        this.button.dataset.tooltip = 'Windows Dictation Unavailable';
    }

    getErrorMessage(event) {
        const messages = {
            platform_unsupported: 'Normal voice dictation is currently available only on Windows.',
            speech_runtime_unavailable: 'Windows Speech Recognition is not installed or enabled.',
            language_unavailable: 'The selected Windows speech language is not installed.',
            microphone_unavailable: 'Windows could not access the default microphone.',
            startup_timeout: 'Windows Speech Recognition took too long to start.',
        };
        return messages[event.code] || event.message || 'Windows speech recognition failed.';
    }

    showNotification(message, type = 'info', duration = 5000) {
        if (window.NotificationService) {
            window.NotificationService.show(message, type, duration);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    async destroy() {
        if (this.isActive()) {
            await this.stop();
        }
        this.removeNativeListener?.();
        this.removeNativeListener = null;
        this.removeWaveform();
        this.button?.removeEventListener('click', this.boundToggle);
        this.button = null;
        this.targetTextarea = null;
    }
}

window.WindowsSpeechInputHandler = WindowsSpeechInputHandler;
export default WindowsSpeechInputHandler;
