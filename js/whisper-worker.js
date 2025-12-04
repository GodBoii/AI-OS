// js/whisper-worker.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Configure to use HuggingFace Hub
env.allowLocalModels = false;
env.allowRemoteModels = true;

class WhisperPipeline {
    static task = 'automatic-speech-recognition';
    // CHANGED: Using 'base.en' (~140MB) for significantly better accuracy than 'tiny.en'
    static model = 'Xenova/whisper-base.en'; 
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            console.log('[Whisper Worker] Loading model...');
            this.instance = await pipeline(this.task, this.model, { 
                progress_callback,
                quantized: true 
            });
            console.log('[Whisper Worker] Model loaded successfully');
        }
        return this.instance;
    }
}

// Handle messages from main thread
self.addEventListener('message', async (event) => {
    const { type, audio } = event.data;

    if (type === 'load') {
        try {
            // Load model with progress updates
            await WhisperPipeline.getInstance((progress) => {
                self.postMessage({ 
                    type: 'download', 
                    data: {
                        status: progress.status,
                        progress: progress.progress || 0,
                        file: progress.file || '',
                        loaded: progress.loaded || 0,
                        total: progress.total || 0
                    }
                });
            });
            
            self.postMessage({ type: 'ready' });
        } catch (err) {
            console.error('[Whisper Worker] Load error:', err);
            self.postMessage({ 
                type: 'error', 
                data: `Failed to load model: ${err.message}` 
            });
        }
    } 
    
    else if (type === 'transcribe') {
        try {
            const transcriber = await WhisperPipeline.getInstance();
            
            console.log('[Whisper Worker] Starting transcription...');
            
            // Run inference
            const output = await transcriber(audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                language: 'english',
                task: 'transcribe',
                return_timestamps: false,
            });

            console.log('[Whisper Worker] Transcription complete');
            
            // Send final result
            self.postMessage({ 
                type: 'result', 
                data: output.text.trim() 
            });
        } catch (err) {
            console.error('[Whisper Worker] Transcription error:', err);
            self.postMessage({ 
                type: 'error', 
                data: `Transcription failed: ${err.message}` 
            });
        }
    }
    
    else if (type === 'check') {
        // Check if model is already loaded
        const isLoaded = WhisperPipeline.instance !== null;
        self.postMessage({ 
            type: 'status', 
            data: { loaded: isLoaded } 
        });
    }
});

console.log('[Whisper Worker] Worker initialized');