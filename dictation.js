const toggleButton = document.getElementById('toggleDictation');
const output = document.getElementById('output');
const status = document.getElementById('status');
const minimizeButton = document.querySelector('.minimize');
const timeoutSound = new Audio('timeout.mp3'); // or 'timeout.wav'

let isListening = false;
let recognition;

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
        isListening = true;
    };

    recognition.onerror = (event) => {
        console.error('Recognition error:', event.error);
        status.textContent = 'Error: ' + event.error;
        status.className = '';
        stopListening();
    };

    recognition.onend = () => {
        console.log('Recognition ended');
        if (isListening) {
            // Play sound before restarting
            timeoutSound.play().catch(err => console.log('Could not play sound:', err));
            // Restart recognition if it was still supposed to be listening
            recognition.start();
        }
    };

    recognition.onresult = (event) => {
        console.log('Got recognition result');
        try {
            const transcript = Array.from(event.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join(' ');
            
            console.log('Transcript:', transcript);
            output.textContent = transcript;
            
            // Send transcript to active tab
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (tabs[0]) {
                    chrome.scripting.executeScript({
                        target: { tabId: tabs[0].id },
                        func: insertText,
                        args: [transcript + ' ']
                    }).catch(err => console.error('Failed to insert text:', err));
                }
            });
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
    try {
        // Request microphone access first
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Stop the stream immediately, we just needed permission
        stream.getTracks().forEach(track => track.stop());
        
        // Initialize recognition if needed
        if (!recognition && !initializeSpeechRecognition()) {
            return;
        }
        
        // Start recognition
        recognition.start();
        
    } catch (error) {
        console.error('Error starting recognition:', error);
        status.textContent = 'Error: Could not access microphone';
        status.className = '';
    }
}

// Stop listening
function stopListening() {
    if (recognition) {
        recognition.stop();
    }
    status.textContent = 'Ready';
    status.className = '';
    toggleButton.textContent = 'Start Listening';
    isListening = false;
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
}); 