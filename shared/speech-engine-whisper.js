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

        // Silence detection — skip chunks quieter than this RMS threshold
        this.SILENCE_RMS_THRESHOLD = 0.01;

        // Repetition / hallucination detection
        this.recentResults = [];
        this.MAX_HISTORY = 5;
        this.REPEAT_THRESHOLD = 3;
        this.HALLUCINATION_PATTERNS = [
            /^\[BLANK_AUDIO\]$/i,
            /^\(blank audio\)$/i,
            /^\.+$/,
            /^,+$/,
            /^\s*$/,
        ];
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
                        const text = event.data.text.trim();

                        if (this._isHallucinationOrRepetition(text)) {
                            this.recentResults.push(text);
                            if (this.recentResults.length > this.MAX_HISTORY) this.recentResults.shift();
                            break;
                        }

                        this.recentResults.push(text);
                        if (this.recentResults.length > this.MAX_HISTORY) this.recentResults.shift();
                        this.onresult(text);
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
                processorOptions: { chunkDuration: 5 }
            });

            // Handle audio chunks from the worklet
            this.processorNode.port.onmessage = (event) => {
                if (event.data.type === 'audio-chunk' && this.isListening) {
                    const audioData = event.data.audio;
                    const resampled = this._resampleIfNeeded(audioData, event.data.sampleRate, 16000);

                    // Layer 1: Silence detection — skip chunks too quiet for real speech
                    const rms = this._computeRMS(resampled);
                    if (rms < this.SILENCE_RMS_THRESHOLD) {
                        console.log('[whisper] skipping silent chunk (RMS:', rms.toFixed(6), ')');
                        if (this.onstatuschange) this.onstatuschange('Listening...');
                        return;
                    }

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
            this.recentResults = [];
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

    _computeRMS(audioData) {
        let sumSquares = 0;
        for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i];
        }
        return Math.sqrt(sumSquares / audioData.length);
    }

    _isHallucinationOrRepetition(text) {
        for (const pattern of this.HALLUCINATION_PATTERNS) {
            if (pattern.test(text)) {
                console.log('[whisper] filtered hallucination marker:', text);
                return true;
            }
        }

        if (this._hasInternalRepetition(text)) {
            console.log('[whisper] filtered internal repetition:', text.slice(0, 80));
            return true;
        }

        if (this.recentResults.length >= this.REPEAT_THRESHOLD) {
            const lastN = this.recentResults.slice(-this.REPEAT_THRESHOLD);
            const allSame = lastN.every(prev => this._textsAreSimilar(prev, text));
            if (allSame) {
                console.log('[whisper] filtered cross-chunk repetition:', text.slice(0, 80));
                return true;
            }
        }

        return false;
    }

    _hasInternalRepetition(text) {
        const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        if (words.length < 6) return false;

        for (let phraseLen = 2; phraseLen <= Math.min(5, Math.floor(words.length / 3)); phraseLen++) {
            const phrase = words.slice(0, phraseLen).join(' ');
            let count = 0;
            for (let i = 0; i <= words.length - phraseLen; i += phraseLen) {
                if (words.slice(i, i + phraseLen).join(' ') === phrase) {
                    count++;
                } else {
                    break;
                }
            }
            if (count >= 3) return true;
        }
        return false;
    }

    _textsAreSimilar(a, b) {
        const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        return normalize(a) === normalize(b);
    }
}
