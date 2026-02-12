// AudioWorklet processor for capturing microphone PCM data
// Buffers audio samples and emits chunks at configurable intervals

class AudioChunkProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.buffer = [];
        // Default: 5 seconds of audio per chunk, 1 second overlap
        this.chunkDurationSeconds = (options.processorOptions && options.processorOptions.chunkDuration) || 5;
        this.overlapSeconds = (options.processorOptions && options.processorOptions.overlap) || 1;
        this.targetSampleRate = sampleRate; // AudioWorklet's global sampleRate
        this.samplesPerChunk = this.targetSampleRate * this.chunkDurationSeconds;
        this.overlapSamples = this.targetSampleRate * this.overlapSeconds;
        this.active = true;

        this.port.onmessage = (event) => {
            if (event.data.type === 'stop') {
                this.active = false;
                // Flush remaining buffer
                if (this.buffer.length > 0) {
                    this.port.postMessage({
                        type: 'audio-chunk',
                        audio: new Float32Array(this.buffer),
                        sampleRate: this.targetSampleRate
                    });
                    this.buffer = [];
                }
            }
        };
    }

    process(inputs) {
        if (!this.active) return false;

        const input = inputs[0];
        if (input && input.length > 0) {
            const channelData = input[0]; // Mono — first channel only
            // Append samples to buffer
            for (let i = 0; i < channelData.length; i++) {
                this.buffer.push(channelData[i]);
            }

            if (this.buffer.length >= this.samplesPerChunk) {
                // Send the full chunk
                this.port.postMessage({
                    type: 'audio-chunk',
                    audio: new Float32Array(this.buffer),
                    sampleRate: this.targetSampleRate
                });
                // Keep overlap for continuity (prevents words being cut at boundaries)
                this.buffer = this.buffer.slice(-this.overlapSamples);
            }
        }
        return true; // Keep processor alive
    }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor);
