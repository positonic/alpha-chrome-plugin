// Side panel main script — engine-agnostic dictation UI
// Adapted from dictation.js, works with both Whisper and Google engines

const toggleButton = document.getElementById('toggleDictation');
const output = document.getElementById('output');
const statusEl = document.getElementById('status');
const sessionUrl = document.getElementById('session-url');
const engineWhisperBtn = document.getElementById('engineWhisper');
const engineGoogleBtn = document.getElementById('engineGoogle');
const modelStatusEl = document.getElementById('modelStatus');
const modelStatusText = document.getElementById('modelStatusText');
const modelProgressBar = document.getElementById('modelProgressBar');
const shutterSound = new Audio('shutter.mp3');

const apiBaseURL = EXTENSION_CONFIG.apiBaseURL;
const hasProjects = EXTENSION_CONFIG.hasProjects;

let currentEngine = null; // 'whisper' or 'google'
let engine = null; // The active speech engine instance
let whisperEngine = null; // Cached Whisper engine (persists model across toggles)
let googleEngine = null; // Cached Google engine

let isListening = false;
let currentSessionId = null;
let currentTranscription = '';
let lastScreenshotTime = 0;
const SCREENSHOT_COOLDOWN = 2000; // 2 seconds cooldown

// --- Utilities (from dictation.js) ---

async function getApiKey() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['TRANSCRIPTION_API_KEY'], function(result) {
            if (!result.TRANSCRIPTION_API_KEY) {
                statusEl.textContent = 'Please set your API key in the extension popup';
                reject(new Error('API key not set'));
                return;
            }
            resolve(result.TRANSCRIPTION_API_KEY);
        });
    });
}

async function getProjectId() {
    if (!hasProjects) return 'default';
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['SELECTED_PROJECT_ID'], function(result) {
            if (!result.SELECTED_PROJECT_ID) {
                statusEl.textContent = 'Please select a project in the extension popup';
                reject(new Error('Project not selected'));
                return;
            }
            resolve(result.SELECTED_PROJECT_ID);
        });
    });
}

function getNow() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = '00';
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}:${seconds}`;
}

// --- Server communication (unchanged from dictation.js) ---

async function startServerSession() {
    const apiKey = await getApiKey();
    const projectId = await getProjectId();

    const response = await fetch(`${apiBaseURL}/api/trpc/transcription.startSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ json: { projectId } })
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(`Server returned ${response.status}: ${data.error?.message || JSON.stringify(data)}`);
    }

    const data = await response.json();
    if (!data.result || !data.result.data || !data.result.data.json) {
        throw new Error('Unexpected response structure');
    }

    currentSessionId = data.result.data.json.id;
    const sessionLinkUrl = `${apiBaseURL}/session/${currentSessionId}`;
    sessionUrl.href = sessionLinkUrl;
}

async function saveTranscription(id, transcriptionText) {
    try {
        const apiKey = await getApiKey();
        const response = await fetch(`${apiBaseURL}/api/trpc/transcription.saveTranscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ json: { id, transcription: transcriptionText } })
        });
        const data = await response.json();
        if (response.ok && data.result && data.result.success) {
            statusEl.textContent = 'Recording... (Last save: ' + getNow() + ')';
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error saving transcription:', error);
        return false;
    }
}

async function saveScreenshot(dataUrl) {
    try {
        const apiKey = await getApiKey();
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        const response = await fetch(`${apiBaseURL}/api/trpc/transcription.saveScreenshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ json: { sessionId: currentSessionId, screenshot: base64Data, timestamp: getNow() } })
        });
        const data = await response.json();
        return response.ok && data.result && data.result.success;
    } catch (error) {
        console.error('Error saving screenshot:', error);
        return false;
    }
}

// --- Screenshot handling ---

function handleScreenshotCommand(transcript) {
    const transcriptLower = transcript.toLowerCase().replace(/\s+/g, ' ');
    if (!/take\s+a?\s*screenshot/.test(transcriptLower)) return false;

    // Cooldown to prevent duplicate screenshots
    const now = Date.now();
    if (now - lastScreenshotTime < SCREENSHOT_COOLDOWN) return false;
    lastScreenshotTime = now;

    chrome.tabs.query({ active: true, windowType: 'normal' }, function(tabs) {
        const tab = tabs[0];
        if (!tab) return;
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, async function(dataUrl) {
            if (chrome.runtime.lastError) {
                console.error('Screenshot error:', chrome.runtime.lastError);
                return;
            }
            shutterSound.play().catch(() => {});
            // Save locally
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `screenshot_${getNow().replace(/[/:]/g, '-')}.png`;
            link.click();
            // Save to server
            const saved = await saveScreenshot(dataUrl);

            // Replace screenshot command text with [SCREENSHOT] marker in transcript
            currentTranscription = currentTranscription.replace(/take\s+a?\s*screenshot/gi, '[SCREENSHOT]');
            output.textContent = currentTranscription;

            statusEl.textContent = saved ? 'Screenshot saved!' : 'Screenshot saved locally (server save failed)';
            setTimeout(() => { if (isListening) statusEl.textContent = 'Recording...'; }, 2000);
        });
    });

    return true;
}

// --- Engine management ---

function createEngine(type) {
    if (type === 'whisper') {
        if (!whisperEngine) {
            whisperEngine = new WhisperSpeechEngine();
            whisperEngine.init();
        }
        return whisperEngine;
    } else {
        if (!googleEngine) {
            googleEngine = new GoogleSpeechEngine();
            googleEngine.init();
        }
        return googleEngine;
    }
}

// Deduplicate overlapping text from Whisper chunks.
// Whisper may return text that overlaps with what we already have
// (due to audio chunk overlap or cumulative transcription behavior).
// Find the longest suffix of `existing` that matches a prefix of `newText`
// and return only the non-overlapping portion.
function deduplicateOverlap(existing, newText) {
    if (!existing || !newText) return newText;

    const existingWords = existing.trim().split(/\s+/);
    const newWords = newText.trim().split(/\s+/);

    // Try progressively smaller overlaps (minimum 3 words to avoid false matches)
    const maxOverlap = Math.min(existingWords.length, newWords.length);
    for (let len = maxOverlap; len >= 3; len--) {
        const suffix = existingWords.slice(-len).join(' ').toLowerCase();
        const prefix = newWords.slice(0, len).join(' ').toLowerCase();
        if (suffix === prefix) {
            // Found overlap — return only the new portion
            const remaining = newWords.slice(len).join(' ');
            return remaining;
        }
    }
    // No significant overlap found — return full text
    return newText;
}

function wireEngine(eng) {
    // Called when new transcript text arrives from either engine.
    // For Google, this is the full accumulated transcript per recognition session.
    // For Whisper, this is an incremental chunk (may overlap with previous).
    eng.onresult = (text) => {
        if (currentEngine === 'whisper') {
            // Whisper chunks may overlap with existing text — deduplicate before appending
            const newPortion = deduplicateOverlap(currentTranscription, text);
            if (newPortion) {
                currentTranscription += (currentTranscription ? ' ' : '') + newPortion;
            }
        } else {
            // Google returns full transcript per recognition session
            currentTranscription = text;
        }
        output.textContent = currentTranscription;

        // Check only the NEW text for screenshot command (not full transcript,
        // otherwise Whisper's incremental chunks re-trigger it every time)
        handleScreenshotCommand(text);

        // Auto-save
        if (currentSessionId && currentTranscription) {
            saveTranscription(currentSessionId, currentTranscription);
        }
    };

    eng.onerror = (error) => {
        console.error('Engine error:', error);
        statusEl.textContent = error;
        statusEl.className = '';
    };

    eng.onstatuschange = (status) => {
        statusEl.textContent = status;
    };

    eng.onstart = () => {
        statusEl.textContent = 'Recording...';
        statusEl.className = 'listening';
        toggleButton.textContent = 'Stop Recording';
        toggleButton.className = 'btn-recording';
        isListening = true;
    };

    eng.onstop = () => {
        if (!isListening) {
            toggleButton.textContent = 'Start Recording';
            toggleButton.className = 'btn-primary';
            statusEl.className = '';
            if (currentSessionId) sessionUrl.style.display = 'inline';
        }
    };

    // Whisper-specific: model progress
    if (eng.onmodelprogress !== undefined) {
        eng.onmodelprogress = (info) => {
            if (info.ready) {
                modelStatusEl.classList.remove('visible');
                toggleButton.disabled = false;
            } else {
                modelStatusEl.classList.add('visible');
                modelProgressBar.style.width = info.progress + '%';
                const detail = info.detail;
                if (detail && detail.file) {
                    modelStatusText.textContent = `Downloading ${detail.file}... ${info.progress}%`;
                } else if (detail && detail.status === 'loading') {
                    modelStatusText.textContent = detail.message || 'Loading model...';
                } else {
                    modelStatusText.textContent = `Loading model... ${info.progress}%`;
                }
            }
        };
    }
}

async function switchEngine(type) {
    // Stop current recording if active
    if (isListening) {
        await stopListening();
    }

    currentEngine = type;
    engine = createEngine(type);
    wireEngine(engine);

    // Update toggle UI
    engineWhisperBtn.classList.toggle('active', type === 'whisper');
    engineGoogleBtn.classList.toggle('active', type === 'google');

    // Show/hide model status for Whisper
    if (type === 'whisper') {
        const modelStatus = engine.getModelStatus();
        if (!modelStatus.ready) {
            modelStatusEl.classList.add('visible');
            toggleButton.disabled = true;
        } else {
            modelStatusEl.classList.remove('visible');
            toggleButton.disabled = false;
        }
    } else {
        modelStatusEl.classList.remove('visible');
        toggleButton.disabled = false;
    }

    // Save preference
    chrome.storage.local.set({ SPEECH_ENGINE: type });
}

// --- Start/Stop ---

async function startListening() {
    try {
        // Check mic permission first
        const permResult = await chrome.storage.local.get('MIC_PERMISSION_GRANTED');
        if (!permResult.MIC_PERMISSION_GRANTED) {
            // Try to get permission directly
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(t => t.stop());
                chrome.storage.local.set({ MIC_PERMISSION_GRANTED: true });
            } catch (e) {
                // Open permissions page
                chrome.tabs.create({ url: chrome.runtime.getURL('permissions.html') });
                statusEl.textContent = 'Please grant microphone permission in the new tab';
                return;
            }
        }

        // Clear output and hide session link
        output.textContent = '';
        sessionUrl.style.display = 'none';
        currentTranscription = '';

        // Start server session
        await startServerSession();

        // Start the engine
        await engine.start();

    } catch (error) {
        console.error('Error starting:', error);
        statusEl.textContent = 'Error: ' + error.message;
        statusEl.className = '';
    }
}

async function stopListening() {
    isListening = false;
    if (engine) engine.stop();

    // Save final transcription
    if (currentSessionId && currentTranscription) {
        await saveTranscription(currentSessionId, currentTranscription);
    }

    statusEl.textContent = 'Ready';
    statusEl.className = '';
    toggleButton.textContent = 'Start Recording';
    toggleButton.className = 'btn-primary';
    if (currentSessionId) sessionUrl.style.display = 'inline';
}

// --- Event handlers ---

toggleButton.onclick = () => {
    if (!isListening) {
        startListening();
    } else {
        stopListening();
    }
};

engineWhisperBtn.onclick = () => switchEngine('whisper');
engineGoogleBtn.onclick = () => switchEngine('google');

// --- Initialize ---

document.addEventListener('DOMContentLoaded', async () => {
    // Load saved engine preference (default to whisper)
    const result = await chrome.storage.local.get('SPEECH_ENGINE');
    const savedEngine = result.SPEECH_ENGINE || 'whisper';
    await switchEngine(savedEngine);
});
