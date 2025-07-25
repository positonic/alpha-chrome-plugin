const output = document.getElementById('output');
const startButton = document.getElementById('start');
const resetPermissionsButton = document.getElementById('reset-permissions');
const openChromeSettingsButton = document.getElementById('open-chrome-settings');
const openSettingsLink = document.getElementById('open-settings');
const permissionStatus = document.getElementById('permission-status');
const testArea = document.getElementById('test-area');

let isListening = false;
let recognition;

console.log('Extension initialized');

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded');
    
    // Get all required elements
    const apiKeySection = document.getElementById('api-key-section');
    const projectSection = document.getElementById('project-section');
    const dictationSection = document.getElementById('dictation-section');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveApiKeyButton = document.getElementById('save-api-key');
    const apiKeyStatus = document.getElementById('api-key-status');
    const projectDropdown = document.getElementById('project-dropdown');
    const projectStatus = document.getElementById('project-status');
    const startDictationButton = document.getElementById('start-dictation');
    const clearTokenButton = document.getElementById('clear-token-project');
    const clearApiKeyButton = document.getElementById('clear-api-key');
    const apiKeyContainer = document.getElementById('api-key-container');
    const testModeIndicator = document.getElementById('test-mode-indicator');

    // Check if we're in test mode and show indicator
    if (EXTENSION_CONFIG.apiBaseURL.includes('localhost')) {
        const url = new URL(EXTENSION_CONFIG.apiBaseURL);
        testModeIndicator.textContent = `TEST MODE - Port ${url.port}`;
        testModeIndicator.style.display = 'block';
    }

    // First verify all elements exist
    if (!apiKeySection || !projectSection || !dictationSection || !apiKeyInput || 
        !saveApiKeyButton || !apiKeyStatus || !projectDropdown || !projectStatus || !startDictationButton || !clearTokenButton || !clearApiKeyButton || !apiKeyContainer) {
        console.error('Required elements not found in DOM');
        return;
    }

    // Handle API key input changes to show/hide clear button
    apiKeyInput.addEventListener('input', () => {
        if (apiKeyInput.value.trim()) {
            apiKeyContainer.classList.add('has-value');
        } else {
            apiKeyContainer.classList.remove('has-value');
        }
    });

    // Check if API key and project are configured
    chrome.storage.local.get(['TRANSCRIPTION_API_KEY', 'SELECTED_PROJECT_ID'], (result) => {
        if (result.TRANSCRIPTION_API_KEY) {
            // Hide API key section and show project section
            apiKeySection.classList.add('hidden');
            projectSection.classList.remove('hidden');
            // Show clear button when API key exists
            clearApiKeyButton.style.display = 'inline-block';
            
            // If project is already selected, show dictation section
            if (result.SELECTED_PROJECT_ID) {
                projectDropdown.value = result.SELECTED_PROJECT_ID;
                dictationSection.classList.remove('hidden');
                startDictationButton.disabled = false;
            }
        } else {
            // Show API key section and hide other sections
            apiKeySection.classList.remove('hidden');
            projectSection.classList.add('hidden');
            dictationSection.classList.add('hidden');
            // Hide clear button when no API key
            clearApiKeyButton.style.display = 'none';
        }
    });

    // Handle saving API key
    saveApiKeyButton.onclick = () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            apiKeyStatus.textContent = 'Please enter an API key';
            return;
        }

        chrome.storage.local.set({ 'TRANSCRIPTION_API_KEY': apiKey }, () => {
            apiKeyStatus.textContent = 'API key saved successfully!';
            // Hide API key section and show project section
            apiKeySection.classList.add('hidden');
            projectSection.classList.remove('hidden');
            // Show clear button when API key is saved
            clearApiKeyButton.style.display = 'inline-block';
        });
    };

    // Handle project selection
    projectDropdown.onchange = () => {
        const selectedProjectId = projectDropdown.value;
        if (selectedProjectId) {
            chrome.storage.local.set({ 'SELECTED_PROJECT_ID': selectedProjectId }, () => {
                projectStatus.textContent = 'Project selected!';
                // Show dictation section but keep project section visible
                dictationSection.classList.remove('hidden');
                startDictationButton.disabled = false;
            });
        } else {
            projectStatus.textContent = 'Please select a project';
            dictationSection.classList.add('hidden');
            startDictationButton.disabled = true;
        }
    };

    // Handle start dictation button
    startDictationButton.onclick = () => {
        chrome.windows.create({
            url: 'dictation.html',
            type: 'popup',
            width: 400,
            height: 400
        }, () => {
            window.close();
        });
    };

    // Handle clear API key button (X button in input field)
    clearApiKeyButton.onclick = () => {
        if (confirm('Are you sure you want to clear the API key?')) {
            chrome.storage.local.remove(['TRANSCRIPTION_API_KEY', 'SELECTED_PROJECT_ID'], () => {
                // Reset UI to initial state
                apiKeySection.classList.remove('hidden');
                projectSection.classList.add('hidden');
                dictationSection.classList.add('hidden');
                apiKeyInput.value = '';
                apiKeyContainer.classList.remove('has-value');
                apiKeyStatus.textContent = 'API key cleared';
                projectDropdown.value = '';
                projectStatus.textContent = '';
                // Hide clear button when API key is cleared
                clearApiKeyButton.style.display = 'none';
            });
        }
    };

    // Handle clear token button
    clearTokenButton.onclick = () => {
        if (confirm('Are you sure you want to clear the API token? You will need to re-enter it.')) {
            chrome.storage.local.remove(['TRANSCRIPTION_API_KEY', 'SELECTED_PROJECT_ID'], () => {
                // Reset UI to initial state
                apiKeySection.classList.remove('hidden');
                projectSection.classList.add('hidden');
                dictationSection.classList.add('hidden');
                apiKeyInput.value = '';
                apiKeyContainer.classList.remove('has-value');
                projectDropdown.value = '';
                apiKeyStatus.textContent = '';
                projectStatus.textContent = '';
            });
        }
    };
});

// Open Chrome microphone settings
function openChromeSettings() {
    chrome.tabs.create({url: 'chrome://settings/content/microphone'});
}

// Reset microphone permissions
async function resetMicrophonePermissions() {
    console.log('Attempting to reset microphone access...');
    output.innerText = 'Attempting to reset microphone access...\n\nPlease wait...';
    resetPermissionsButton.disabled = true;
    
    try {
        // Create an iframe for permission isolation
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.allow = 'microphone *;';
        document.body.appendChild(iframe);
        
        // Try in iframe first
        try {
            const iframeStream = await iframe.contentWindow.navigator.mediaDevices.getUserMedia({ audio: true });
            if (iframeStream) {
                iframeStream.getTracks().forEach(track => track.stop());
            }
        } catch (iframeError) {
            console.log('Expected iframe error:', iframeError);
        }
        
        document.body.removeChild(iframe);
        
        // Now try direct access
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            
            output.innerText = 'Microphone access successful! Try clicking "Start Listening" now.';
            permissionStatus.innerHTML = '✅ Microphone permission granted';
        } catch (streamError) {
            console.error('Microphone access error:', streamError);
            output.innerHTML = 'Unable to get microphone access.<br><br>' +
                'If Chrome doesn\'t show a permission prompt, you may need to reset Chrome\'s permissions:<br><br>' +
                '1. Click the lock icon in the address bar<br>' +
                '2. Go to Site Settings<br>' +
                '3. Look for and reset microphone permissions<br><br>' +
                'Or try using the extension on a different website.';
        }
    } catch (error) {
        console.error('Error in reset attempt:', error);
    } finally {
        resetPermissionsButton.disabled = false;
    }
}

// Toggle speech recognition on/off
function toggleSpeechRecognition() {
    console.log('Toggle speech recognition, current state:', isListening);
    
    if (!isListening) {
        startSpeechRecognition();
    } else {
        stopSpeechRecognition();
    }
}

// Start speech recognition
async function startSpeechRecognition() {
    try {
        // Attempt direct microphone access
        try {
            console.log('Requesting microphone access directly...');
            output.innerText = 'Requesting microphone access...\n\nPlease click "Allow" if you see a permission prompt.';
            startButton.disabled = true;
            
            // We need to access the microphone directly
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            // Stop the stream immediately after getting permission
            stream.getTracks().forEach(track => {
                console.log('Stopping microphone track after permission check');
                track.stop();
            });
            
            console.log('Microphone access granted successfully');
            output.innerText = 'Microphone access granted. Starting speech recognition...';
            permissionStatus.innerHTML = '✅ Microphone permission granted';
        } catch (micError) {
            console.error('Microphone access error:', micError);
            handleMicrophoneError(micError);
            startButton.disabled = false;
            return;
        }
        
        // Now that we have permission, proceed with speech recognition
        if (!('webkitSpeechRecognition' in window)) {
            console.error('Speech recognition not supported');
            output.innerText = 'Speech recognition not supported in this browser';
            startButton.disabled = false;
            return;
        }

        recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            console.log('Recognition started');
            output.innerText = 'Listening...';
            startButton.innerText = 'Stop Listening';
            startButton.disabled = false;
            isListening = true;
        };

        recognition.onerror = (event) => {
            console.error('Recognition error:', event.error);
            
            if (event.error === 'not-allowed') {
                handleMicrophoneError({ name: 'NotAllowedError' });
            } else {
                output.innerText = 'Error: ' + event.error;
            }
            
            stopSpeechRecognition();
        };

        recognition.onend = () => {
            console.log('Recognition ended');
            // Don't auto-restart, this can cause issues in extensions
            if (isListening) {
                stopSpeechRecognition();
            }
        };

        recognition.onresult = (event) => {
            console.log('Got recognition result:', event);
            try {
                const transcript = Array.from(event.results)
                    .map(result => result[0])
                    .map(result => result.transcript)
                    .join(' ');
                
                console.log('Processed transcript:', transcript);
                output.innerText = transcript;
                
                if (document.activeElement === testArea) {
                    console.log('Inserting into test area');
                    insertAtCursor(testArea, transcript + ' ');
                } else {
                    console.log('Attempting to insert into webpage');
                    insertIntoWebpage(transcript + ' ');
                }
            } catch (error) {
                console.error('Error processing recognition result:', error);
                output.innerText = 'Error processing speech: ' + error.message;
            }
        };

        // This line will trigger the permission popup in Chrome
        recognition.start();
        console.log('Recognition started successfully');
        
    } catch (error) {
        console.error('Error setting up recognition:', error);
        output.innerText = 'Error setting up speech recognition: ' + error.message;
        stopSpeechRecognition();
    }
}

// Stop speech recognition
function stopSpeechRecognition() {
    console.log('Stopping recognition');
    if (recognition) {
        try {
            recognition.stop();
        } catch (e) {
            console.error('Error stopping recognition:', e);
        }
    }
    startButton.innerText = 'Start Listening';
    isListening = false;
}

// Function to insert text at cursor position
function insertAtCursor(element, text) {
    console.log('Inserting into element:', text);
    try {
        if (element.isContentEditable) {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
        } else {
            const startPos = element.selectionStart;
            const endPos = element.selectionEnd;
            element.value = element.value.substring(0, startPos) + 
                           text + 
                           element.value.substring(endPos, element.value.length);
            element.selectionStart = element.selectionEnd = startPos + text.length;
        }
    } catch (error) {
        console.error('Error inserting text:', error);
    }
}

// Function to insert text into the active element on the webpage
function insertIntoWebpage(text) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || !tabs[0]) {
            console.error('No active tab found');
            return;
        }
        
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (text) => {
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
            },
            args: [text]
        }).catch(error => {
            console.error('Error executing script:', error);
        });
    });
}

// Helper function to handle microphone permission errors
function handleMicrophoneError(error) {
    console.error('Microphone error details:', error);
    
    // Clear any previous content
    output.innerHTML = '';
    
    // Check for the specific "Permission dismissed" message
    if (error.message && error.message.includes('dismissed')) {
        output.innerHTML = `<strong>Chrome has blocked the microphone request.</strong><br><br>
            To fix this:
            <ol>
                <li>Go to Chrome's microphone settings</li>
                <li>Find this extension (chrome-extension://...)</li>
                <li>Change the setting from "Block" to "Allow"</li>
            </ol>`;
        
        let settingsButton = document.createElement('button');
        settingsButton.className = 'secondary-button';
        settingsButton.textContent = 'Open Chrome Microphone Settings';
        settingsButton.style.marginTop = '10px';
        settingsButton.style.marginBottom = '10px';
        settingsButton.onclick = openChromeSettings;
        
        output.appendChild(settingsButton);
        
        permissionStatus.innerHTML = '❌ Microphone access blocked';
    }
    else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        output.innerHTML = `<strong>Microphone access was denied.</strong><br><br>
            To fix this:
            <ol>
                <li>Go to Chrome's microphone settings</li>
                <li>Find this extension (chrome-extension://...)</li>
                <li>Change the setting from "Block" to "Allow"</li>
            </ol>`;
        
        let settingsButton = document.createElement('button');
        settingsButton.className = 'secondary-button';
        settingsButton.textContent = 'Open Chrome Microphone Settings';
        settingsButton.style.marginTop = '10px';
        settingsButton.style.marginBottom = '10px';
        settingsButton.onclick = openChromeSettings;
        
        output.appendChild(settingsButton);
        
        permissionStatus.innerHTML = '❌ Microphone access denied';
    } else if (error.name === 'NotFoundError') {
        output.innerText = 'No microphone found. Please connect a microphone and try again.';
        permissionStatus.innerHTML = '❌ No microphone detected';
    } else if (error.name === 'NotReadableError' || error.name === 'AbortError') {
        output.innerText = 'Cannot access microphone. It might be in use by another application.';
        permissionStatus.innerHTML = '❌ Microphone in use by another app';
    } else {
        output.innerText = `Microphone error: ${error.name} - ${error.message || 'Unknown error'}`;
        permissionStatus.innerHTML = '❌ Microphone error occurred';
    }
}


