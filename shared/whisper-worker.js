// Web Worker for running Whisper speech recognition via transformers.js
// Runs inference off the main thread to keep UI responsive

import { pipeline, env } from '@huggingface/transformers';

// Configure transformers.js for browser/extension usage
env.allowRemoteModels = true;
env.useBrowserCache = true;

// CRITICAL: Set WASM paths to local extension files BEFORE pipeline init.
// Without this, transformers.js defaults to CDN URLs which are blocked by CSP.
// The worker's self.location gives us the extension base URL.
const workerDir = self.location.href.replace(/\/[^/]*$/, '/');
env.backends.onnx.wasm.wasmPaths = workerDir;

let transcriber = null;
let isLoading = false;

self.onmessage = async (event) => {
    const { type } = event.data;

    switch (type) {
        case 'load-model':
            await loadModel();
            break;
        case 'transcribe':
            await transcribe(event.data.audio);
            break;
    }
};

async function loadModel() {
    if (transcriber || isLoading) return;
    isLoading = true;

    try {
        self.postMessage({ type: 'model-progress', progress: { status: 'loading', message: 'Downloading model...' } });

        transcriber = await pipeline(
            'automatic-speech-recognition',
            'onnx-community/whisper-tiny.en',
            {
                dtype: 'q8',
                device: 'wasm',
                progress_callback: (progress) => {
                    self.postMessage({ type: 'model-progress', progress });
                }
            }
        );

        self.postMessage({ type: 'model-loaded' });
    } catch (error) {
        self.postMessage({ type: 'model-error', error: error.message });
    } finally {
        isLoading = false;
    }
}

async function transcribe(audioData) {
    if (!transcriber) {
        self.postMessage({ type: 'transcription-error', error: 'Model not loaded' });
        return;
    }

    try {
        console.log('[whisper-worker] transcribe: audioData.length =', audioData.length,
            '(expected ~' + (16000 * 5) + ' at 16kHz or ~' + (48000 * 5) + ' at 48kHz)');

        const result = await transcriber(audioData, {
            chunk_length_s: 30,
            stride_length_s: 5
        });

        self.postMessage({
            type: 'transcription-result',
            text: result.text
        });
    } catch (error) {
        self.postMessage({ type: 'transcription-error', error: error.message });
    }
}
