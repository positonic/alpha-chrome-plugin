// Whisper Speech Engine — local on-device speech recognition
// Implements the same interface as the Google engine:
//   engine.onresult(text)  — called with transcript text
//   engine.onerror(error)  — called on error
//   engine.onstatuschange(status) — called with status updates
//   engine.start()
//   engine.stop()

class WhisperSpeechEngine {
    constructor() {
        this.worker = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.processorNode = null;
        this.modelReady = false;
        this.modelProgress = 0;
        this.isListening = false;

        // Callbacks — set by the consumer
        this.onresult = null;
        this.onerror = null;
        this.onstatuschange = null;
        this.onstart = null;
        this.onstop = null;
        this.onmodelprogress = null;
    }

    async init() {
        // Create and set up the Web Worker
        this.worker = new Worker('whisper-worker.bundle.js', { type: 'module' });

        this.worker.onmessage = (event) => {
            const { type } = event.data;

            switch (type) {
                case 'model-progress':
                    this._handleModelProgress(event.data.progress);
                    break;
                case 'model-loaded':
                    this.modelReady = true;
                    this.modelProgress = 100;
                    if (this.onstatuschange) this.onstatuschange('Model ready');
                    if (this.onmodelprogress) this.onmodelprogress({ ready: true, progress: 100 });
                    break;
                case 'model-error':
                    if (this.onerror) this.onerror('Failed to load model: ' + event.data.error);
                    break;
                case 'transcription-result':
                    if (this.onresult && event.data.text && event.data.text.trim()) {
                        this.onresult(event.data.text.trim());
                    }
                    break;
                case 'transcription-error':
                    if (this.onerror) this.onerror('Transcription error: ' + event.data.error);
                    break;
            }
        };

        this.worker.onerror = (error) => {
            console.error('Whisper worker error:', error);
            if (this.onerror) this.onerror('Worker error: ' + error.message);
        };

        // Start loading the model immediately
        this.worker.postMessage({ type: 'load-model' });
        return true;
    }

    _handleModelProgress(progress) {
        // transformers.js progress callback format varies
        if (progress && progress.progress !== undefined) {
            this.modelProgress = Math.round(progress.progress);
        } else if (progress && progress.status) {
            // Status-only update
        }
        if (this.onmodelprogress) {
            this.onmodelprogress({ ready: this.modelReady, progress: this.modelProgress, detail: progress });
        }
    }

    async start() {
        if (!this.modelReady) {
            if (this.onstatuschange) this.onstatuschange('Model still loading, please wait...');
            return;
        }

        if (this.isListening) return;

        try {
            // Request mic access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });

            // Create AudioContext at 16kHz for Whisper
            this.audioContext = new AudioContext({ sampleRate: 16000 });

            // Register the audio worklet
            const workletUrl = new URL('audio-processor.js', self.location.href).href;
            await this.audioContext.audioWorklet.addModule(workletUrl);

            // Create source and processor
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.processorNode = new AudioWorkletNode(this.audioContext, 'audio-chunk-processor', {
                processorOptions: { chunkDuration: 5, overlap: 1 }
            });

            // Handle audio chunks from the worklet
            this.processorNode.port.onmessage = (event) => {
                if (event.data.type === 'audio-chunk' && this.isListening) {
                    const audioData = event.data.audio;
                    // Resample if needed (AudioContext may not honor 16kHz request)
                    const resampled = this._resampleIfNeeded(audioData, event.data.sampleRate, 16000);
                    // Transfer the buffer to the worker for inference
                    this.worker.postMessage(
                        { type: 'transcribe', audio: resampled },
                        [resampled.buffer]
                    );
                    if (this.onstatuschange) this.onstatuschange('Processing audio...');
                }
            };

            source.connect(this.processorNode);
            // Don't connect to destination — we don't want playback

            this.isListening = true;
            if (this.onstart) this.onstart();
            if (this.onstatuschange) this.onstatuschange('Recording...');

        } catch (error) {
            console.error('Error starting Whisper engine:', error);
            if (this.onerror) this.onerror('Could not start recording: ' + error.message);
        }
    }

    stop() {
        this.isListening = false;

        // Tell the worklet to flush remaining audio
        if (this.processorNode) {
            this.processorNode.port.postMessage({ type: 'stop' });
            this.processorNode.disconnect();
            this.processorNode = null;
        }

        // Stop the mic
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Close the AudioContext
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.onstop) this.onstop();
    }

    _resampleIfNeeded(audioData, fromRate, toRate) {
        if (fromRate === toRate) return audioData;

        // Linear interpolation resampling
        const ratio = fromRate / toRate;
        const newLength = Math.round(audioData.length / ratio);
        const result = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
            const frac = srcIndex - srcIndexFloor;
            result[i] = audioData[srcIndexFloor] * (1 - frac) + audioData[srcIndexCeil] * frac;
        }

        return result;
    }

    getModelStatus() {
        return { ready: this.modelReady, progress: this.modelProgress };
    }
}
