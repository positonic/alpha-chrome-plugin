// AudioWorklet processor for capturing microphone PCM data
// Buffers audio samples and emits fixed-size chunks at configurable intervals
// Uses a pre-allocated Float32Array buffer with write index for robust behavior

class AudioChunkProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.chunkDurationSeconds = (options.processorOptions && options.processorOptions.chunkDuration) || 5;
        this.targetSampleRate = sampleRate; // AudioWorklet's global sampleRate
        this.samplesPerChunk = this.targetSampleRate * this.chunkDurationSeconds;

        // Pre-allocated buffer — avoids growing Array + slice pattern
        this.buffer = new Float32Array(this.samplesPerChunk);
        this.writeIndex = 0;
        this.active = true;

        this.port.onmessage = (event) => {
            if (event.data.type === 'stop') {
                this.active = false;
                // Flush remaining audio
                if (this.writeIndex > 0) {
                    const remaining = this.buffer.slice(0, this.writeIndex);
                    this.port.postMessage({
                        type: 'audio-chunk',
                        audio: remaining,
                        sampleRate: this.targetSampleRate
                    });
                    this.writeIndex = 0;
                }
            }
        };
    }

    process(inputs) {
        if (!this.active) return false;

        const input = inputs[0];
        if (input && input.length > 0) {
            const channelData = input[0]; // Mono — first channel only

            for (let i = 0; i < channelData.length; i++) {
                this.buffer[this.writeIndex++] = channelData[i];

                if (this.writeIndex >= this.samplesPerChunk) {
                    // Send a copy of the full chunk
                    const chunk = new Float32Array(this.buffer);
                    this.port.postMessage({
                        type: 'audio-chunk',
                        audio: chunk,
                        sampleRate: this.targetSampleRate
                    });
                    // Reset — clean start for next chunk
                    this.writeIndex = 0;
                }
            }
        }
        return true; // Keep processor alive
    }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor);
