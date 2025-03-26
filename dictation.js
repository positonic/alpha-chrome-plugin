const toggleButton = document.getElementById('toggleDictation');
const output = document.getElementById('output');
const status = document.getElementById('status');
const minimizeButton = document.querySelector('.minimize');
const timeoutSound = new Audio('timeout.mp3'); // or 'timeout.wav'

let isListening = false;
let recognition;
let currentSessionId = null;  // Store the current session ID
let currentTranscription = ''; // Keep track of accumulated transcription

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
            status.textContent = 'Network error - attempting to reconnect...';
            if (isListening) {
                setTimeout(() => {
                    if (isListening) {  // Check if we're still supposed to be listening
                        console.log('onerror: Restarting recognition');
                        recognition.start();
                    }
                }, 1000);  // Wait 1 second before retrying
            }
        } else {
            // For other errors, save and stop as before
            if (currentSessionId && currentTranscription) {
                await saveTranscription(currentSessionId, currentTranscription);
            }
            stopListening();
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
            timeoutSound.play().catch(err => console.log('onend: Could not play sound:', err));
            recognition.start();
        }
    };

    recognition.onresult = (event) => {
        console.log('recognition.onresult: Got recognition result', getNow());
        try {
            const transcript = Array.from(event.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join(' ');
            
            console.log('Transcript:', transcript);
            currentTranscription = transcript; // Update current transcription
            output.textContent = transcript;
            
            
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
        // Clear the output display immediately
        output.textContent = '';
        
        // Start a new session first
        const response = await fetch('http://localhost:3000/api/trpc/transcription.startSession', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({})
        });
        const data = await response.json();
        console.log('startListening: Response:', data);
        currentSessionId = data.result.data.id;  // Changed from sessionId to id
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
async function saveTranscription(id, transcriptionText) {  // Changed parameter name to match
    console.log('Saving transcription:', id, transcriptionText);
    try {
        const response = await fetch('http://localhost:3000/api/trpc/transcription.saveTranscription', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                json: {
                    id,  // Changed from sessionId to id
                    transcription: transcriptionText
                }
            })
        });
        const data = await response.json();
        return data.result.success;
    } catch (error) {
        console.error('Error saving transcription:', error);
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