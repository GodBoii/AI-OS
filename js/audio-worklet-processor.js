// js/audio-worklet-processor.js - Modern Audio Capture Processor

class AudioCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.isRecording = false;
        
        // Listen for messages from main thread
        this.port.onmessage = (event) => {
            if (event.data.command === 'start') {
                this.isRecording = true;
                console.log('[AudioWorklet] Recording started');
            } else if (event.data.command === 'stop') {
                this.isRecording = false;
                console.log('[AudioWorklet] Recording stopped');
            }
        };
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input && input.length > 0) {
            const channelData = input[0]; // Get first channel (mono)
            
            if (channelData && channelData.length > 0) {
                // Clone the data because it will be reused
                const audioChunk = new Float32Array(channelData);
                
                // Send audio chunk to main thread
                this.port.postMessage({
                    type: 'audio',
                    data: audioChunk,
                    isRecording: this.isRecording
                });
            }
        }
        
        // Return true to keep processor alive
        return true;
    }
}

// Register the processor
registerProcessor('audio-capture-processor', AudioCaptureProcessor);
