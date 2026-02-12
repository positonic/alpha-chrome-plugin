// Google Speech Engine — wraps webkitSpeechRecognition
// Implements the same interface as the Whisper engine:
//   engine.onresult(text)  — called with transcript text
//   engine.onerror(error)  — called on error
//   engine.onstatuschange(status) — called with status updates
//   engine.start()
//   engine.stop()

class GoogleSpeechEngine {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.isStarting = false;
        this.consecutiveNetworkErrors = 0;
        this.MAX_NETWORK_ERRORS = 3;

        // Callbacks — set by the consumer
        this.onresult = null;
        this.onerror = null;
        this.onstatuschange = null;
        this.onstart = null;
        this.onstop = null;
    }

    async init() {
        if (!('webkitSpeechRecognition' in window)) {
            throw new Error('Speech recognition not supported in this browser');
        }

        this.recognition = new webkitSpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        this.recognition.onstart = () => {
            this.isStarting = false;
            this.consecutiveNetworkErrors = 0;
            this.isListening = true;
            if (this.onstart) this.onstart();
            if (this.onstatuschange) this.onstatuschange('Recording...');
        };

        this.recognition.onerror = (event) => {
            console.error('Google speech recognition error:', event.error);
            if (event.error === 'network') {
                this.consecutiveNetworkErrors++;
                if (this.consecutiveNetworkErrors >= this.MAX_NETWORK_ERRORS) {
                    this.isListening = false;
                    if (this.onerror) this.onerror('Network error - please check your internet connection');
                }
            } else {
                this.consecutiveNetworkErrors = 0;
                if (this.onerror) this.onerror('Error: ' + event.error);
            }
        };

        this.recognition.onend = () => {
            if (this.isListening) {
                // Auto-restart on timeout
                this.recognition.start();
            } else {
                if (this.onstop) this.onstop();
            }
        };

        this.recognition.onresult = (event) => {
            try {
                const transcript = Array.from(event.results)
                    .map(result => result[0].transcript)
                    .join(' ');

                if (this.onresult) this.onresult(transcript);
            } catch (error) {
                console.error('Error processing recognition result:', error);
                if (this.onerror) this.onerror('Error processing speech: ' + error.message);
            }
        };

        return true;
    }

    async start() {
        if (this.isStarting) return;
        this.isStarting = true;
        this.consecutiveNetworkErrors = 0;

        if (!this.recognition) {
            await this.init();
        }

        // Request mic access to ensure permission
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        stream.getTracks().forEach(track => track.stop());

        this.recognition.start();
    }

    stop() {
        this.isListening = false;
        this.isStarting = false;
        if (this.recognition) {
            this.recognition.stop();
        }
    }

    getModelStatus() {
        return { ready: true, progress: 100 };
    }
}
