// js/audio-utils.js - Audio Processing Utilities

/**
 * Uses the browser's native OfflineAudioContext to resample audio.
 * This provides high-quality anti-aliasing that manual JS loops cannot match.
 * @param {AudioBuffer} audioBuffer - The source audio buffer
 * @param {number} targetSampleRate - The target rate (e.g., 16000)
 * @returns {Promise<Float32Array>} The resampled raw data
 */
export async function nativeResample(audioBuffer, targetSampleRate) {
    if (audioBuffer.sampleRate === targetSampleRate) {
        return audioBuffer.getChannelData(0);
    }

    // Calculate new length based on ratio
    const ratio = audioBuffer.sampleRate / targetSampleRate;
    const newLength = Math.round(audioBuffer.length / ratio);
    
    // Create offline context at target rate
    const offlineCtx = new OfflineAudioContext(1, newLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    
    // Render the resampled audio
    const renderedBuffer = await offlineCtx.startRendering();
    return renderedBuffer.getChannelData(0);
}

/**
 * Adaptive silence trimming using frame-based RMS + Zero Crossing Rate.
 * Keeps low-energy consonants by considering ZCR spikes and always pads
 * around detected speech regions.
 * @param {Float32Array} buffer - Input buffer (mono PCM)
 * @param {number} sampleRate - Buffer sample rate (defaults to 16kHz)
 * @returns {Float32Array} Trimmed buffer
 */
export function trimSilence(buffer, sampleRate = 16000) {
    if (!buffer || buffer.length === 0) {
        return buffer;
    }

    const frameDurationMs = 15;
    const frameSize = Math.max(1, Math.floor(sampleRate * (frameDurationMs / 1000)));
    const hopSize = frameSize;
    const totalFrames = Math.ceil(buffer.length / hopSize);

    const noiseWindowSamples = Math.min(buffer.length, Math.floor(sampleRate * 0.25));
    let noiseSumSquares = 0;
    for (let i = 0; i < noiseWindowSamples; i++) {
        const sample = buffer[i];
        noiseSumSquares += sample * sample;
    }
    const noiseRms = noiseWindowSamples > 0 ? Math.sqrt(noiseSumSquares / noiseWindowSamples) : 0;
    const minThreshold = 0.0035;
    const maxThreshold = 0.08;
    const energyThreshold = Math.min(maxThreshold, Math.max(noiseRms * 2.5, minThreshold));
    const consonantThreshold = energyThreshold * 0.6;
    const zcrSpeechThreshold = 0.12;

    let firstSpeechFrame = -1;
    let lastSpeechFrame = -1;

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        const start = frameIndex * hopSize;
        const end = Math.min(buffer.length, start + frameSize);
        if (start >= buffer.length) break;

        let sumSquares = 0;
        let zeroCrossings = 0;
        let prevSample = buffer[start];
        for (let i = start; i < end; i++) {
            const sample = buffer[i];
            sumSquares += sample * sample;
            if ((prevSample >= 0 && sample < 0) || (prevSample < 0 && sample >= 0)) {
                zeroCrossings++;
            }
            prevSample = sample;
        }

        const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
        const zcr = zeroCrossings / Math.max(1, end - start);
        const isSpeech = (rms >= energyThreshold) || (rms >= consonantThreshold && zcr >= zcrSpeechThreshold);

        if (isSpeech) {
            if (firstSpeechFrame === -1) {
                firstSpeechFrame = frameIndex;
            }
            lastSpeechFrame = frameIndex;
        }
    }

    if (firstSpeechFrame === -1) {
        return new Float32Array(0);
    }

    const prePadSamples = Math.floor(sampleRate * 0.3);
    const postPadSamples = Math.floor(sampleRate * 0.5);

    const startSample = Math.max(0, firstSpeechFrame * hopSize - prePadSamples);
    const lastFrameEnd = Math.min(buffer.length, (lastSpeechFrame + 1) * hopSize);
    const endSample = Math.min(buffer.length, lastFrameEnd + postPadSamples);

    if (endSample <= startSample) {
        return buffer.slice();
    }

    return buffer.slice(startSample, endSample);
}

/**
 * Flatten array of Float32Array chunks into single buffer
 * @param {Array<Float32Array>} chunks - Array of audio chunks
 * @returns {Float32Array} Flattened audio buffer
 */
export function flattenAudioChunks(chunks) {
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Float32Array(totalLength);
    
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    
    return result;
}

/**
 * Normalize audio levels to prevent clipping and remove DC offset
 * @param {Float32Array} buffer - Audio buffer
 * @returns {Float32Array} Normalized buffer
 */
export function normalizeAudio(buffer) {
    if (buffer.length === 0) return buffer;

    // 1. Calculate DC Offset (mean value)
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i];
    }
    const mean = sum / buffer.length;

    // 2. Remove DC Offset and find Max Amplitude
    let max = 0;
    for (let i = 0; i < buffer.length; i++) {
        buffer[i] -= mean; // Center the signal at 0
        const abs = Math.abs(buffer[i]);
        if (abs > max) max = abs;
    }
    
    // 3. Normalize to 0.95 (leave a tiny bit of headroom)
    // If max is 0 (silent), avoid divide by zero
    if (max === 0) return buffer;
    
    const scale = 0.95 / max;
    
    for (let i = 0; i < buffer.length; i++) {
        buffer[i] *= scale;
    }
    
    return buffer;
}