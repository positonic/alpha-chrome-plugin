const toggleButton = document.getElementById('toggleDictation');
const output = document.getElementById('output');
const status = document.getElementById('status');
const sessionUrl = document.getElementById('session-url');
// Minimize button removed
const shutterSound = new Audio('shutter.mp3');

// Load config - this will be loaded from config.js
const apiBaseURL = EXTENSION_CONFIG.apiBaseURL;

let isListening = false;
let isStarting = false; // Guard against multiple concurrent startListening calls
let recognition;
let currentSessionId = null;  // Store the current session ID
let currentTranscription = ''; // Keep track of accumulated transcription
let lastSavedTranscription = ''; // Track what's already been saved to server (for delta saves)
let lastScreenshotTime = 0;
const SCREENSHOT_COOLDOWN = 2000; // 2 seconds cooldown
let consecutiveNetworkErrors = 0;
const MAX_NETWORK_ERRORS = 3; // Stop retrying after this many consecutive network errors

// Add this near the top with other utility functions
async function getApiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['TRANSCRIPTION_API_KEY'], function(result) {
            if (!result.TRANSCRIPTION_API_KEY) {
                status.textContent = 'API key not set. Please configure in settings.';
                throw new Error('API key not set');
            }
            resolve(result.TRANSCRIPTION_API_KEY);
        });
    });
}

// Project ID not needed for Tradescape

// Add this function near the top of the file with other utility functions
function getNow() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');  // +1 because months are 0-based
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = '00';  // Always use 00 for minutes as requested
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${month}/${day} ${hours}:${minutes}:${seconds}`;
}

// Minimize button removed

// Initialize speech recognition
function initializeSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window)) {
        console.error('Speech recognition not supported');
        status.textContent = 'Speech recognition not supported in this browser';
        toggleButton.disabled = true;
        return false;
    }

    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        console.log('Recognition started');
        isStarting = false; // Clear guard now that recognition is running
        consecutiveNetworkErrors = 0; // Reset error counter on successful start
        status.textContent = 'Recording...';
        status.className = 'listening';
        toggleButton.textContent = 'Stop Recording';
        toggleButton.style.background = 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)';
        toggleButton.style.boxShadow = '0 4px 12px rgba(220, 53, 69, 0.3)';
        isListening = true;
    };

    recognition.onerror = async (event) => {
        console.error('Recognition error:', event.error, getNow());
        status.textContent = 'Error: ' + event.error;
        status.className = '';

        if (event.error === 'network') {
            consecutiveNetworkErrors++;
            console.log('onerror: Network error #' + consecutiveNetworkErrors);

            if (consecutiveNetworkErrors >= MAX_NETWORK_ERRORS) {
                console.log('onerror: Too many network errors, stopping');
                status.textContent = 'Network error - please check your internet connection and try again';
                isListening = false; // Prevent onend from restarting
            }
        } else {
            console.log('onerror: Other error:', event.error);
            consecutiveNetworkErrors = 0; // Reset on non-network errors
        }
    };

    // Called when the recognition service has timed out
    recognition.onend = async () => {
        console.log('onend: Recognition ended', getNow());
        console.log('onend: Current session ID:', currentSessionId);
        console.log('onend: Current transcription:', currentTranscription);
        // Save only the new text (delta) since last save
        if (currentSessionId && currentTranscription && currentTranscription !== lastSavedTranscription) {
            const delta = currentTranscription.slice(lastSavedTranscription.length).trim();
            if (delta) {
                await saveTranscription(currentSessionId, delta);
                lastSavedTranscription = currentTranscription;
            }
        }
        console.log('onend: isListening:', isListening);
        if (isListening) {
            console.log('onend: Restarting recognition');
            // Only restart if this was a timeout
            recognition.start();
        } else {
            // Reset UI when not restarting (e.g., after network errors)
            toggleButton.textContent = 'Start Recording';
            toggleButton.style.background = 'linear-gradient(135deg, #15F27C 0%, #12D46A 100%)';
            toggleButton.style.boxShadow = '0 4px 12px rgba(21, 242, 124, 0.3)';
            if (currentSessionId) {
                sessionUrl.style.display = 'inline';
            }
        }
    };

    recognition.onresult = (event) => {
        console.log('recognition.onresult: Got recognition result', getNow());
        try {
            let transcript = Array.from(event.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join(' ');
            
            console.log('recognition.onresult: Original transcript:', transcript);
            
            // Check for screenshot commands
            const transcriptLower = transcript.toLowerCase();
            if (transcriptLower.includes('take screenshot') || transcriptLower.includes('take a screenshot')) {
                // Replace screenshot commands with marker in the transcript
                transcript = transcriptLower
                    .replace('take screenshot', '[SCREENSHOT]')
                    .replace('take a screenshot', '[SCREENSHOT]');
                currentTranscription = transcript;
                output.textContent = currentTranscription;

                // Take screenshot, then stop/restart recognition
                takeScreenshot();
                recognition.stop();
            } else {
                currentTranscription = transcript;
                output.textContent = currentTranscription;
            }
            
            console.log('recognition.onresult: Final transcript:', transcript);
            
        } catch (error) {
            console.error('Error processing recognition result:', error);
            output.textContent = 'Error processing speech: ' + error.message;
        }
    };

    return true;
}

// Function to insert text into the active element
function insertText(text) {
    const activeElement = document.activeElement;
    if (activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' || 
        activeElement.isContentEditable) {
        if (activeElement.isContentEditable) {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
        } else {
            const startPos = activeElement.selectionStart;
            const endPos = activeElement.selectionEnd;
            activeElement.value = activeElement.value.substring(0, startPos) + 
                                text + 
                                activeElement.value.substring(endPos, activeElement.value.length);
            activeElement.selectionStart = activeElement.selectionEnd = startPos + text.length;
        }
    }
}

// Start listening
async function startListening() {
    if (isStarting) {
        console.log('startListening: Already starting, ignoring duplicate call');
        return;
    }
    isStarting = true;
    console.log('startListening: Starting listening');
    consecutiveNetworkErrors = 0; // Reset error counter on new start attempt
    try {
        // Get API key first
        const apiKey = await getApiKey();
        
        // Clear the output display immediately and hide session link
        output.textContent = '';
        sessionUrl.style.display = 'none';

        console.log('url is: ', `${apiBaseURL}/api/trpc/transcription.startSession`)
        
        const requestBody = {
            json: {
                projectId: "default" // Tradescape uses a default project
            }
        };
        console.log('startListening: Request body:', JSON.stringify(requestBody));
        
        // Start a new session first with API key in header and project ID in body
        const response = await fetch(`${apiBaseURL}/api/trpc/transcription.startSession`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('startListening: Response status:', response.status);
        const data = await response.json();
        console.log('startListening: Response:', data);
        console.log('startListening: Full response structure:', JSON.stringify(data, null, 2));
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${data.error?.message || JSON.stringify(data)}`);
        }
        
        if (!data.result || !data.result.data || !data.result.data.json) {
            throw new Error(`Unexpected response structure: ${JSON.stringify(data)}`);
        }
        
        currentSessionId = data.result.data.json.id;
        console.log('startListening: Current session ID:', currentSessionId);
        
        // Store session URL but don't show yet
        const sessionLinkUrl = `${apiBaseURL}/session/${currentSessionId}`;
        sessionUrl.href = sessionLinkUrl;

        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        stream.getTracks().forEach(track => track.stop());
        
        if (!recognition && !initializeSpeechRecognition()) {
            return;
        }
        
        // Clear previous transcription
        currentTranscription = '';
        lastSavedTranscription = '';
        recognition.start();

    } catch (error) {
        console.error('Error starting recognition:', error);
        status.textContent = 'Error: Could not start session or access microphone';
        status.className = '';
        isStarting = false;
    }
}

// Save transcription to server
async function saveTranscription(id, transcriptionText) {
    console.log('Saving transcription:', id, transcriptionText);
    try {
        const apiKey = await getApiKey();
        
        const response = await fetch(`${apiBaseURL}/api/trpc/transcription.saveTranscription`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({
                json: {
                    id,
                    transcription: transcriptionText
                }
            })
        });
        const data = await response.json();
        console.log('saveTranscription: Response:', data);
        
        // Update status to show save was successful
        if (data.result.success) {
            status.textContent = 'Listening... (Last save: ' + getNow() + ')';
        }
        
        return data.result.success;
    } catch (error) {
        console.error('Error saving transcription:', error);
        if (error.message === 'API key not set') {
            status.textContent = 'API key not set. Please configure in settings.';
        }
        return false;
    }
}

// Take a screenshot of the active normal window tab
async function takeScreenshot() {
    const tab = await getActiveNormalTab();
    if (!tab) {
        status.textContent = 'No active tab found for screenshot';
        return;
    }
    chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'}, async function(dataUrl) {
        if (chrome.runtime.lastError || !dataUrl) {
            status.textContent = 'Screenshot failed';
            return;
        }
        // Play shutter sound
        shutterSound.play().catch(err => console.log('Could not play shutter sound:', err));

        // Save locally
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `screenshot_${getNow().replace(/[/:]/g, '-')}.png`;
        link.click();

        // Save to server
        const saved = await saveScreenshot(dataUrl);

        // Insert [SCREENSHOT] marker into transcript
        if (isListening && currentSessionId) {
            currentTranscription += (currentTranscription ? ' ' : '') + '[SCREENSHOT]';
            output.textContent = currentTranscription;
            const delta = currentTranscription.slice(lastSavedTranscription.length).trim();
            if (delta) {
                saveTranscription(currentSessionId, delta);
                lastSavedTranscription = currentTranscription;
            }
        }

        // Auto-clear annotations after screenshot
        chrome.tabs.sendMessage(tab.id, { type: 'annotation-clear' }).catch(() => {});

        // Update status
        status.textContent = saved ? 'Screenshot saved!' : 'Screenshot saved locally (server save failed)';
        setTimeout(() => {
            if (isListening) status.textContent = 'Recording...';
            else status.textContent = 'Ready';
        }, 2000);
    });
}

// Add this function near other utility functions
async function saveScreenshot(dataUrl) {
    console.log('Saving screenshot');
    try {
        const apiKey = await getApiKey();
        
        // Convert base64 data URL to binary data
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        
        const response = await fetch(`${apiBaseURL}/api/trpc/transcription.saveScreenshot`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({
                json: {
                    sessionId: currentSessionId,
                    screenshot: base64Data,
                    timestamp: getNow()
                }
            })
        });
        const data = await response.json();
        console.log('saveScreenshot: Response:', data);
        return data.result.success;
    } catch (error) {
        console.error('Error saving screenshot:', error);
        return false;
    }
}

// Stop listening
async function stopListening() {
    isListening = false;  // Set this first to prevent onend from restarting
    isStarting = false;   // Reset guard flag
    if (recognition) {
        recognition.stop();  // This will trigger onend which will save
    }
    status.textContent = 'Ready';
    status.className = '';
    toggleButton.textContent = 'Start Recording';
    toggleButton.style.background = 'linear-gradient(135deg, #15F27C 0%, #12D46A 100%)';
    toggleButton.style.boxShadow = '0 4px 12px rgba(21, 242, 124, 0.3)';
    // Show session link now that recording is finished
    if (currentSessionId) {
        sessionUrl.style.display = 'inline';
    }
}

// Toggle listening state
toggleButton.onclick = () => {
    if (!isListening) {
        startListening();
    } else {
        stopListening();
    }
};

// --- Annotation overlay control ---

let annotationActive = false;
let annotationTool = 'arrow';

const drawBtn = document.getElementById('toggleDraw');
const toolToggle = document.getElementById('toolToggle');
const toolArrowBtn = document.getElementById('toolArrow');
const toolFreehandBtn = document.getElementById('toolFreehand');
const clearBtn = document.getElementById('clearAnnotations');

async function getActiveNormalTab() {
    const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
    return tabs[0] || null;
}

async function ensureAnnotationInjected(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'annotation-ping' });
        if (response && response.injected) return true;
    } catch (e) {
        // Not injected yet — inject now
    }
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['annotation-overlay.js']
    });
    return true;
}

async function toggleAnnotation() {
    const tab = await getActiveNormalTab();
    if (!tab) return;
    await ensureAnnotationInjected(tab.id);
    annotationActive = !annotationActive;
    await chrome.tabs.sendMessage(tab.id, {
        type: 'annotation-toggle',
        enabled: annotationActive
    });
    updateAnnotationUI();
}

async function clearAnnotations() {
    const tab = await getActiveNormalTab();
    if (!tab) return;
    try {
        await chrome.tabs.sendMessage(tab.id, { type: 'annotation-clear' });
    } catch (e) {
        // Content script not present
    }
}

async function setAnnotationTool(tool) {
    annotationTool = tool;
    const tab = await getActiveNormalTab();
    if (tab) {
        try {
            await chrome.tabs.sendMessage(tab.id, { type: 'annotation-set-tool', tool });
        } catch (e) {
            // Content script not present
        }
    }
    updateAnnotationUI();
}

function updateAnnotationUI() {
    if (drawBtn) {
        drawBtn.textContent = annotationActive ? 'Drawing' : 'Draw';
        drawBtn.classList.toggle('active', annotationActive);
    }
    if (toolToggle) {
        toolToggle.classList.toggle('visible', annotationActive);
    }
    if (toolArrowBtn) toolArrowBtn.classList.toggle('active', annotationTool === 'arrow');
    if (toolFreehandBtn) toolFreehandBtn.classList.toggle('active', annotationTool === 'freehand');
    if (clearBtn) clearBtn.style.display = annotationActive ? 'inline-block' : 'none';
}

// Listen for keyboard shortcut toggle from background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'toggle-annotation-command') {
        toggleAnnotation();
        sendResponse({ ok: true });
    }
});

const screenshotBtn = document.getElementById('screenshotBtn');
if (screenshotBtn) screenshotBtn.addEventListener('click', takeScreenshot);
if (drawBtn) drawBtn.addEventListener('click', toggleAnnotation);
if (toolArrowBtn) toolArrowBtn.addEventListener('click', () => setAnnotationTool('arrow'));
if (toolFreehandBtn) toolFreehandBtn.addEventListener('click', () => setAnnotationTool('freehand'));
if (clearBtn) clearBtn.addEventListener('click', clearAnnotations);

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    status.textContent = 'Ready';
    toggleButton.style.background = 'linear-gradient(135deg, #15F27C 0%, #12D46A 100%)';
    toggleButton.style.boxShadow = '0 4px 12px rgba(21, 242, 124, 0.3)';
}); 