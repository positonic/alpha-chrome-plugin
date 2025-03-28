const toggleButton = document.getElementById('toggleDictation');
const output = document.getElementById('output');
const status = document.getElementById('status');
const minimizeButton = document.querySelector('.minimize');
const shutterSound = new Audio('shutter.mp3');

let isListening = false;
let recognition;
let currentSessionId = null;  // Store the current session ID
let currentTranscription = ''; // Keep track of accumulated transcription
let lastScreenshotTime = 0;
const SCREENSHOT_COOLDOWN = 2000; // 2 seconds cooldown

// Add this near the top with other utility functions
async function getApiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['TRANSCRIPTION_API_KEY'], function(result) {
            if (!result.TRANSCRIPTION_API_KEY) {
                status.textContent = 'Please set your API key in the extension popup';
                throw new Error('API key not set');
            }
            resolve(result.TRANSCRIPTION_API_KEY);
        });
    });
}

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

// Handle minimize button
minimizeButton.onclick = () => {
    window.innerWidth = 100;
    window.innerHeight = 100;
};

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
        status.textContent = 'Listening...';
        status.className = 'listening';
        toggleButton.textContent = 'Stop Listening';
        toggleButton.style.backgroundColor = '#ff4444';  // Red when listening
        isListening = true;
    };

    recognition.onerror = async (event) => {
        console.error('Recognition error:', event.error, getNow());
        status.textContent = 'Error: ' + event.error;
        status.className = '';

        if (event.error === 'network') {
            console.log('onerror: Network error');
            // For network errors, try to restart after a short delay
            // status.textContent = 'Network error - attempting to reconnect...';
            // if (isListening) {
            //     setTimeout(() => {
            //         console.log('onerror: isListening:', isListening);
                        
            //         if (isListening && recognition.state === 'inactive') {  // Only restart if inactive
            //             console.log('onerror: Recognition state:', recognition.state);
            //             console.log('onerror: Restarting recognition');
            //             recognition.start();
            //         } else {
            //             console.log('onerror: Cannot restart recognition - current state:', recognition.state);
            //             // If we can't restart, we should probably stop listening
            //             //stopListening();
            //             console.log('onerror: not doing anything.... CAN THIS HAPPEN?');
            //         }
            //     }, 500);  // Wait before retrying
            // }
        } else {
            console.log('onerror: Other error!!!');
                        
            // // For other errors, save and stop as before
            // if (currentSessionId && currentTranscription) {
            //     await saveTranscription(currentSessionId, currentTranscription);
            // }
            // stopListening();
        }
    };

    // Called when the recognition service has timed out
    recognition.onend = async () => {
        console.log('onend: Recognition ended', getNow());
        console.log('onend: Current session ID:', currentSessionId);
        console.log('onend: Current transcription:', currentTranscription);
        // Always save current transcription
        if (currentSessionId && currentTranscription) {
            await saveTranscription(currentSessionId, currentTranscription);
        }
        console.log('onend: isListening:', isListening);
        if (isListening) {
            console.log('onend: Restarting recognition');
            // Only restart if this was a timeout
            recognition.start();
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
                chrome.tabs.query({active: true, lastFocusedWindow: true}, function(tabs) {
                    if (tabs[0]) {
                        chrome.windows.get(tabs[0].windowId, function(parentWindow) {
                            chrome.tabs.captureVisibleTab(parentWindow.id, {format: 'png'}, async function(dataUrl) {
                                // Play shutter sound
                                shutterSound.play().catch(err => console.log('Could not play shutter sound:', err));
                                
                                // Save locally
                                const link = document.createElement('a');
                                link.href = dataUrl;
                                link.download = `screenshot_${getNow().replace(/[/:]/g, '-')}.png`;
                                link.click();
                                
                                // Save to server
                                const saved = await saveScreenshot(dataUrl);
                                
                                // Replace both possible commands with marker in the transcript
                                transcript = transcriptLower
                                    .replace('take screenshot', '[SCREENSHOT]')
                                    .replace('take a screenshot', '[SCREENSHOT]');
                                currentTranscription = transcript;
                                output.textContent = currentTranscription;
                                
                                // Stop recognition - onend will handle saving and restarting
                                recognition.stop();
                                
                                // Update status
                                status.textContent = saved ? 'Screenshot saved locally and to server!' : 'Screenshot saved locally (server save failed)';
                                setTimeout(() => {
                                    status.textContent = 'Listening...';
                                }, 2000);
                            });
                        });
                    }
                });
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
    console.log('startListening: Starting listening');
    try {
        // Get API key first
        const apiKey = await getApiKey();
        
        // Clear the output display immediately
        output.textContent = '';
        
        // Start a new session first with API key in header
        const response = await fetch('https://thehaven-hq.vercel.app/api/trpc/transcription.startSession', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({})
        });
        const data = await response.json();
        console.log('startListening: Response:', data);
        currentSessionId = data.result.data.json.id;  // Make sure this matches the API response structure
        console.log('startListening: Current session ID:', currentSessionId);

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
        recognition.start();
        
    } catch (error) {
        console.error('Error starting recognition:', error);
        status.textContent = 'Error: Could not start session or access microphone';
        status.className = '';
    }
}

// Save transcription to server
async function saveTranscription(id, transcriptionText) {
    console.log('Saving transcription:', id, transcriptionText);
    try {
        const apiKey = await getApiKey();
        
        const response = await fetch('https://thehaven-hq.vercel.app/api/trpc/transcription.saveTranscription', {
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
            status.textContent = 'Please set your API key in the extension popup';
        }
        return false;
    }
}

// Add this function near other utility functions
async function saveScreenshot(dataUrl) {
    console.log('Saving screenshot');
    try {
        const apiKey = await getApiKey();
        
        // Convert base64 data URL to binary data
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        
        const response = await fetch('https://thehaven-hq.vercel.app/api/trpc/transcription.saveScreenshot', {
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
    if (recognition) {
        recognition.stop();  // This will trigger onend which will save
    }
    status.textContent = 'Ready';
    status.className = '';
    toggleButton.textContent = 'Start Listening';
    toggleButton.style.backgroundColor = '#44ff44';  // Green when not listening
}

// Toggle listening state
toggleButton.onclick = () => {
    if (!isListening) {
        startListening();
    } else {
        stopListening();
    }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    status.textContent = 'Ready';
    toggleButton.style.backgroundColor = '#44ff44';  // Set initial green color
}); 