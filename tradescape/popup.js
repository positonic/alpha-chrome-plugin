console.log('Extension initialized');

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded');
    
    // Get all required elements
    const apiKeySection = document.getElementById('api-key-section');
    const dictationSection = document.getElementById('dictation-section');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveApiKeyButton = document.getElementById('save-api-key');
    const apiKeyStatus = document.getElementById('api-key-status');
    const startDictationButton = document.getElementById('start-dictation');
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
    if (!apiKeySection || !dictationSection || !apiKeyInput || 
        !saveApiKeyButton || !apiKeyStatus || !startDictationButton || !clearApiKeyButton || !apiKeyContainer) {
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

    // Check if API key is configured
    chrome.storage.local.get(['TRANSCRIPTION_API_KEY'], (result) => {
        if (result.TRANSCRIPTION_API_KEY) {
            // Hide API key section and show dictation section
            apiKeySection.classList.add('hidden');
            dictationSection.classList.remove('hidden');
            startDictationButton.disabled = false;
            // Show clear button when API key exists
            clearApiKeyButton.style.display = 'inline-block';
        } else {
            // Show API key section and hide dictation section
            apiKeySection.classList.remove('hidden');
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
            // Hide API key section and show dictation section
            apiKeySection.classList.add('hidden');
            dictationSection.classList.remove('hidden');
            startDictationButton.disabled = false;
            // Show clear button when API key is saved
            clearApiKeyButton.style.display = 'inline-block';
        });
    };

    // Handle start dictation button — open side panel
    startDictationButton.onclick = async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                await chrome.sidePanel.open({ windowId: tab.windowId });
            }
        } catch (error) {
            console.error('Error opening side panel:', error);
            // Fallback to separate window if side panel fails
            chrome.windows.create({
                url: 'dictation.html',
                type: 'popup',
                width: 400,
                height: 400
            });
        }
        window.close();
    };

    // Handle clear API key button (X button in input field)
    clearApiKeyButton.onclick = () => {
        if (confirm('Are you sure you want to clear the API key?')) {
            chrome.storage.local.remove(['TRANSCRIPTION_API_KEY'], () => {
                // Reset UI to initial state
                apiKeySection.classList.remove('hidden');
                dictationSection.classList.add('hidden');
                apiKeyInput.value = '';
                apiKeyContainer.classList.remove('has-value');
                apiKeyStatus.textContent = 'API key cleared';
                // Hide clear button when API key is cleared
                clearApiKeyButton.style.display = 'none';
            });
        }
    };

});