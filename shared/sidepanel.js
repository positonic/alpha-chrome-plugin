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

// Setup UI elements
const setupSection = document.getElementById('setupSection');
const apiKeyCard = document.getElementById('apiKeyCard');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const apiKeyStatusEl = document.getElementById('apiKeyStatus');
const projectCard = document.getElementById('projectCard');
const projectDropdown = document.getElementById('projectDropdown');
const projectStatusEl = document.getElementById('projectStatus');
const dictationUI = document.getElementById('dictationUI');
const settingsBar = document.getElementById('settingsBar');
const settingsBtn = document.getElementById('settingsBtn');
const settingsDropdown = document.getElementById('settingsDropdown');
const clearApiKeyBtn = document.getElementById('clearApiKeyBtn');
const appNameEl = document.getElementById('appName');
const testModeBadge = document.getElementById('testModeBadge');
const currentKeyDisplay = document.getElementById('currentKeyDisplay');
const currentProjectDisplay = document.getElementById('currentProjectDisplay');
const changeProjectBtn = document.getElementById('changeProjectBtn');
const changeProjectSection = document.getElementById('changeProjectSection');
const changeProjectDropdown = document.getElementById('changeProjectDropdown');

// Tab elements
const panelTabs = document.getElementById('panelTabs');
const tabSavePageBtn = document.getElementById('tabSavePage');
const tabRecordingBtn = document.getElementById('tabRecording');
const panelSavePage = document.getElementById('panelSavePage');
const panelRecording = document.getElementById('panelRecording');
const savePageBtn = document.getElementById('savePageBtn');
const savePageContext = document.getElementById('savePageContext');
const savePageStatus = document.getElementById('savePageStatus');
const savePageWorkspace = document.getElementById('savePageWorkspace');
const savePageProject = document.getElementById('savePageProject');

const autoAuthCard = document.getElementById('autoAuthCard');

const apiBaseURL = EXTENSION_CONFIG.apiBaseURL;
const hasProjects = EXTENSION_CONFIG.hasProjects;
const hasSavePage = EXTENSION_CONFIG.hasSavePage || false;
const cookieDomain = EXTENSION_CONFIG.cookieDomain || null;
const sessionCookieNames = EXTENSION_CONFIG.sessionCookieNames || null;

let currentEngine = null; // 'whisper' or 'google'
let engine = null; // The active speech engine instance
let whisperEngine = null; // Cached Whisper engine (persists model across toggles)
let googleEngine = null; // Cached Google engine

let isListening = false;
let currentSessionId = null;
let currentTranscription = '';
let lastSavedTranscription = ''; // Track what's already been saved to server (for delta saves)
let lastScreenshotTime = 0;
const SCREENSHOT_COOLDOWN = 2000; // 2 seconds cooldown

// --- Utilities (from dictation.js) ---

async function getApiKey() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['TRANSCRIPTION_API_KEY'], function(result) {
            if (!result.TRANSCRIPTION_API_KEY) {
                statusEl.textContent = 'API key not set. Please configure in settings.';
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
                statusEl.textContent = 'No project selected. Please configure in settings.';
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

// --- Auth helpers ---

async function buildAuthHeaders() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['AUTH_JWT', 'TRANSCRIPTION_API_KEY'], (result) => {
            if (result.AUTH_JWT) {
                resolve({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${result.AUTH_JWT}` });
            } else if (result.TRANSCRIPTION_API_KEY) {
                resolve({ 'Content-Type': 'application/json', 'x-api-key': result.TRANSCRIPTION_API_KEY });
            } else {
                reject(new Error('Not authenticated'));
            }
        });
    });
}

async function tryAutoAuth() {
    if (!cookieDomain || !sessionCookieNames || typeof chrome.cookies === 'undefined') return false;

    for (const name of sessionCookieNames) {
        try {
            const cookie = await chrome.cookies.get({ url: cookieDomain, name });
            if (!cookie) continue;

            const response = await fetch(`${apiBaseURL}/api/auth/extension-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-session-token': cookie.value }
            });
            if (!response.ok) continue;

            const data = await response.json();
            if (data.jwt) {
                await chrome.storage.local.set({
                    AUTH_JWT: data.jwt,
                    AUTH_JWT_EXPIRES: data.expiresAt || 0,
                    AUTH_METHOD: 'auto'
                });
                return true;
            }
        } catch (e) {
            console.error('Auto-auth failed for cookie', name, e);
        }
    }
    return false;
}

async function refreshAuthIfNeeded() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['AUTH_METHOD', 'AUTH_JWT_EXPIRES'], async (result) => {
            if (result.AUTH_METHOD !== 'auto') { resolve(false); return; }
            const expires = result.AUTH_JWT_EXPIRES || 0;
            // Refresh if expiring within 5 minutes
            if (expires && Date.now() < expires - 5 * 60 * 1000) { resolve(false); return; }
            resolve(await tryAutoAuth());
        });
    });
}

// --- Save Page helpers ---

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatActionName(url, title, context) {
    const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const displayText = title ? escapeHtml(title) : safeUrl;
    const link = `<a href="${safeUrl}">${displayText}</a>`;
    if (context && context.trim()) {
        return `${escapeHtml(context.trim())}: ${link}`;
    }
    return link;
}

// TODO: Replace with real API call once backend endpoint exists.
// See the spec comment below this function for what we need.
async function fetchWorkspaces() {
    try {
        const headers = await buildAuthHeaders();
        const response = await fetch(`${apiBaseURL}/api/trpc/workspace.getUserWorkspaces`, {
            method: 'GET',
            headers
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();
        return data.result.data.json.workspaces; // expected: [{id, name}, ...]
    } catch (error) {
        console.error('Error fetching workspaces:', error);
        return [];
    }
}

async function fetchProjectsForWorkspace(workspaceId) {
    try {
        const headers = await buildAuthHeaders();
        const url = workspaceId
            ? `${apiBaseURL}/api/trpc/project.getUserProjects?input=${encodeURIComponent(JSON.stringify({ json: { workspaceId } }))}`
            : `${apiBaseURL}/api/trpc/project.getUserProjects`;
        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();
        return data.result.data.json.projects;
    } catch (error) {
        console.error('Error fetching projects for workspace:', error);
        return [];
    }
}

async function populateSavePageDropdowns() {
    // Populate workspaces
    if (savePageWorkspace) {
        const workspaces = await fetchWorkspaces();
        savePageWorkspace.innerHTML = '<option value="">Select workspace...</option>';
        workspaces.forEach(ws => {
            const option = document.createElement('option');
            option.value = ws.id;
            option.textContent = ws.name;
            savePageWorkspace.appendChild(option);
        });
    }
    // Populate projects (all projects initially)
    if (savePageProject) {
        const projects = await fetchProjects();
        savePageProject.innerHTML = '<option value="">Select project...</option>';
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.name;
            savePageProject.appendChild(option);
        });
    }
}

// --- Setup / configuration ---

async function fetchProjects(explicitApiKey) {
    try {
        let headers;
        if (explicitApiKey) {
            headers = { 'Content-Type': 'application/json', 'x-api-key': explicitApiKey };
        } else {
            headers = await buildAuthHeaders();
        }
        const response = await fetch(`${apiBaseURL}/api/trpc/project.getUserProjects`, {
            method: 'GET',
            headers
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();
        return data.result.data.json.projects;
    } catch (error) {
        console.error('Error fetching projects:', error);
        return [];
    }
}

function populateProjectDropdown(projects) {
    projectDropdown.innerHTML = '<option value="">Select a project...</option>';
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projectDropdown.appendChild(option);
    });
}

function showSetup() {
    setupSection.classList.remove('hidden');
    dictationUI.classList.add('hidden');
    settingsBar.classList.add('hidden');
    settingsDropdown.classList.add('hidden');
}

function showDictation() {
    setupSection.classList.add('hidden');
    dictationUI.classList.remove('hidden');
    settingsBar.classList.remove('hidden');
    settingsDropdown.classList.add('hidden');
}

async function checkSetupState() {
    return new Promise((resolve) => {
        const keys = ['TRANSCRIPTION_API_KEY', 'AUTH_JWT', 'AUTH_METHOD'];
        if (hasProjects) keys.push('SELECTED_PROJECT_ID');

        chrome.storage.local.get(keys, async (result) => {
            const hasAuth = !!(result.AUTH_JWT || result.TRANSCRIPTION_API_KEY);

            if (!hasAuth) {
                // Try auto-auth via browser session cookie
                if (autoAuthCard) autoAuthCard.classList.remove('hidden');
                apiKeyCard.classList.add('hidden');
                projectCard.classList.add('hidden');
                showSetup();

                const autoAuthSuccess = await tryAutoAuth();

                if (autoAuthCard) autoAuthCard.classList.add('hidden');

                if (!autoAuthSuccess) {
                    // Fall back to manual API key input
                    apiKeyCard.classList.remove('hidden');
                    resolve(false);
                    return;
                }

                // Auto-auth succeeded — need project selection?
                if (hasProjects) {
                    projectCard.classList.remove('hidden');
                    const projects = await fetchProjects();
                    populateProjectDropdown(projects);
                    resolve(false);
                    return;
                }

                // No projects needed — fully configured
                updateSettingsDisplay(result.AUTH_METHOD || 'auto', null);
                showDictation();
                resolve(true);
                return;
            }

            // Already have stored auth
            if (hasProjects && !result.SELECTED_PROJECT_ID) {
                apiKeyCard.classList.add('hidden');
                projectCard.classList.remove('hidden');
                const projects = result.TRANSCRIPTION_API_KEY
                    ? await fetchProjects(result.TRANSCRIPTION_API_KEY)
                    : await fetchProjects();
                populateProjectDropdown(projects);
                showSetup();
                resolve(false);
                return;
            }

            // Fully configured
            updateSettingsDisplay(result.AUTH_METHOD, result.TRANSCRIPTION_API_KEY);
            if (hasProjects && result.SELECTED_PROJECT_ID) {
                currentProjectDisplay.textContent = 'Project: ' + result.SELECTED_PROJECT_ID;
                currentProjectDisplay.style.display = 'block';
                changeProjectBtn.style.display = '';
            } else {
                currentProjectDisplay.style.display = 'none';
                changeProjectBtn.style.display = 'none';
            }

            showDictation();
            resolve(true);
        });
    });
}

function updateSettingsDisplay(authMethod, apiKey) {
    if (authMethod === 'auto') {
        currentKeyDisplay.textContent = 'Connected via browser session';
    } else if (apiKey) {
        currentKeyDisplay.textContent = 'API Key: ' + apiKey.slice(0, 4) + '...' + apiKey.slice(-4);
    }
}

// Setup event handlers
saveApiKeyBtn.onclick = async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        apiKeyStatusEl.textContent = 'Please enter an API key';
        apiKeyStatusEl.classList.add('error');
        return;
    }

    if (hasProjects) {
        apiKeyStatusEl.textContent = 'Validating key...';
        apiKeyStatusEl.classList.remove('error');
        const projects = await fetchProjects(apiKey);
        if (projects.length === 0) {
            apiKeyStatusEl.textContent = 'Invalid API key or no projects found';
            apiKeyStatusEl.classList.add('error');
            return;
        }
        chrome.storage.local.set({ 'TRANSCRIPTION_API_KEY': apiKey, 'AUTH_METHOD': 'manual' }, () => {
            apiKeyStatusEl.textContent = '';
            populateProjectDropdown(projects);
            apiKeyCard.classList.add('hidden');
            projectCard.classList.remove('hidden');
        });
    } else {
        chrome.storage.local.set({ 'TRANSCRIPTION_API_KEY': apiKey, 'AUTH_METHOD': 'manual' }, async () => {
            apiKeyStatusEl.textContent = '';
            const ready = await checkSetupState();
            if (ready) await initEngines();
        });
    }
};

projectDropdown.onchange = () => {
    const selectedId = projectDropdown.value;
    if (selectedId) {
        chrome.storage.local.set({ 'SELECTED_PROJECT_ID': selectedId }, async () => {
            projectStatusEl.textContent = '';
            const ready = await checkSetupState();
            if (ready) await initEngines();
        });
    }
};

settingsBtn.onclick = () => {
    settingsDropdown.classList.toggle('hidden');
};

clearApiKeyBtn.onclick = () => {
    if (confirm('Are you sure you want to disconnect?')) {
        if (isListening) stopListening();
        const keysToRemove = ['TRANSCRIPTION_API_KEY', 'AUTH_JWT', 'AUTH_JWT_EXPIRES', 'AUTH_METHOD'];
        if (hasProjects) keysToRemove.push('SELECTED_PROJECT_ID');
        chrome.storage.local.remove(keysToRemove, () => {
            apiKeyInput.value = '';
            projectDropdown.innerHTML = '<option value="">Select a project...</option>';
            apiKeyStatusEl.textContent = '';
            projectStatusEl.textContent = '';
            checkSetupState();
        });
    }
};

changeProjectBtn.onclick = async () => {
    const isOpen = !changeProjectSection.classList.contains('hidden');
    if (isOpen) {
        changeProjectSection.classList.add('hidden');
        return;
    }
    const projects = await fetchProjects();
    changeProjectDropdown.innerHTML = '<option value="">Select a project...</option>';
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        changeProjectDropdown.appendChild(option);
    });
    changeProjectSection.classList.remove('hidden');
};

changeProjectDropdown.onchange = async () => {
    const selectedId = changeProjectDropdown.value;
    if (!selectedId) return;
    if (isListening) stopListening();
    chrome.storage.local.set({ 'SELECTED_PROJECT_ID': selectedId }, async () => {
        changeProjectSection.classList.add('hidden');
        settingsDropdown.classList.add('hidden');
        await checkSetupState();
    });
};

async function initEngines() {
    const result = await chrome.storage.local.get('SPEECH_ENGINE');
    const savedEngine = result.SPEECH_ENGINE || 'whisper';
    await switchEngine(savedEngine);
}

// --- Server communication (unchanged from dictation.js) ---

async function startServerSession() {
    const headers = await buildAuthHeaders();
    const projectId = await getProjectId();

    const response = await fetch(`${apiBaseURL}/api/trpc/transcription.startSession`, {
        method: 'POST',
        headers,
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
    const sessionLinkUrl = `${apiBaseURL}/redirect-recording-to-workspace/${currentSessionId}`;
    sessionUrl.href = sessionLinkUrl;
}

async function saveTranscription(id, transcriptionText) {
    try {
        const headers = await buildAuthHeaders();
        const response = await fetch(`${apiBaseURL}/api/trpc/transcription.saveTranscription`, {
            method: 'POST',
            headers,
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
        const headers = await buildAuthHeaders();
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        const response = await fetch(`${apiBaseURL}/api/trpc/transcription.saveScreenshot`, {
            method: 'POST',
            headers,
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
            // Save the updated transcript with [SCREENSHOT] marker as a delta
            const delta = currentTranscription.slice(lastSavedTranscription.length).trim();
            if (delta) {
                saveTranscription(currentSessionId, delta);
                lastSavedTranscription = currentTranscription;
            }

            // Auto-clear annotations after screenshot
            chrome.tabs.sendMessage(tab.id, { type: 'annotation-clear' }).catch(() => {});

            statusEl.textContent = saved ? 'Screenshot saved!' : 'Screenshot saved locally (server save failed)';
            setTimeout(() => { if (isListening) statusEl.textContent = 'Recording...'; }, 2000);
        });
    });

    return true;
}

// --- Take screenshot (button-triggered, no voice command processing) ---

async function takeScreenshot() {
    const tab = await getActiveNormalTab();
    if (!tab) {
        statusEl.textContent = 'No active tab found for screenshot';
        return;
    }
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, async function(dataUrl) {
        if (chrome.runtime.lastError || !dataUrl) {
            statusEl.textContent = 'Screenshot failed';
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
        statusEl.textContent = saved ? 'Screenshot saved!' : 'Screenshot saved locally (server save failed)';
        setTimeout(() => {
            if (isListening) statusEl.textContent = 'Recording...';
            else statusEl.textContent = 'Ready';
        }, 2000);
    });
}

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
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['annotation-overlay.js']
        });
        return true;
    } catch (e) {
        console.warn('Cannot inject annotation script:', e.message);
        return false;
    }
}

async function toggleAnnotation() {
    const tab = await getActiveNormalTab();
    if (!tab) return;
    const injected = await ensureAnnotationInjected(tab.id);
    if (!injected) {
        statusEl.textContent = 'Cannot draw on this page';
        setTimeout(() => { statusEl.textContent = 'Ready'; }, 2000);
        return;
    }
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
        // Content script not present — nothing to clear
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

function wireEngine(eng) {
    // Called when new transcript text arrives from either engine.
    // For Google, this is the full accumulated transcript per recognition session.
    // For Whisper, each chunk is an independent 5-second transcription.
    eng.onresult = (text) => {
        if (currentEngine === 'whisper') {
            // Whisper returns independent chunks — append
            currentTranscription += (currentTranscription ? ' ' : '') + text;
        } else {
            // Google returns full transcript per recognition session
            currentTranscription = text;
        }
        output.textContent = currentTranscription;

        // Check only the NEW text for screenshot command (not full transcript,
        // otherwise Whisper's incremental chunks re-trigger it every time)
        handleScreenshotCommand(text);

        // Auto-save only the new text (delta) to avoid snowball duplication
        if (currentSessionId && currentTranscription && currentTranscription !== lastSavedTranscription) {
            const delta = currentTranscription.slice(lastSavedTranscription.length).trim();
            if (delta) {
                const saved = saveTranscription(currentSessionId, delta);
                if (saved !== false) {
                    lastSavedTranscription = currentTranscription;
                }
            }
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
        lastSavedTranscription = '';

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

    // Save final transcription (only the delta since last save)
    if (currentSessionId && currentTranscription && currentTranscription !== lastSavedTranscription) {
        const delta = currentTranscription.slice(lastSavedTranscription.length).trim();
        if (delta) {
            await saveTranscription(currentSessionId, delta);
            lastSavedTranscription = currentTranscription;
        }
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
    // Set app name and test mode badge
    appNameEl.textContent = EXTENSION_CONFIG.name;
    if (apiBaseURL.includes('localhost')) {
        const url = new URL(apiBaseURL);
        testModeBadge.textContent = 'TEST - Port ' + url.port;
        testModeBadge.classList.remove('hidden');
    }

    // Initialize panel tabs based on config
    if (hasSavePage) {
        panelTabs.classList.add('visible');
        panelSavePage.classList.add('active');
        panelRecording.classList.remove('active');
    } else {
        panelTabs.classList.remove('visible');
        panelSavePage.classList.remove('active');
        panelRecording.classList.add('active');
    }

    // Tab switching
    if (tabSavePageBtn) {
        tabSavePageBtn.addEventListener('click', () => {
            tabSavePageBtn.classList.add('active');
            tabRecordingBtn.classList.remove('active');
            panelSavePage.classList.add('active');
            panelRecording.classList.remove('active');
        });
    }
    if (tabRecordingBtn) {
        tabRecordingBtn.addEventListener('click', () => {
            tabRecordingBtn.classList.add('active');
            tabSavePageBtn.classList.remove('active');
            panelRecording.classList.add('active');
            panelSavePage.classList.remove('active');
        });
    }

    // Save Page dropdowns: workspace change re-populates projects
    if (savePageWorkspace) {
        savePageWorkspace.addEventListener('change', async () => {
            const workspaceId = savePageWorkspace.value;
            if (savePageProject) {
                savePageProject.innerHTML = '<option value="">Loading projects...</option>';
                const projects = workspaceId
                    ? await fetchProjectsForWorkspace(workspaceId)
                    : await fetchProjects();
                savePageProject.innerHTML = '<option value="">Select project...</option>';
                projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.id;
                    option.textContent = project.name;
                    savePageProject.appendChild(option);
                });
            }
        });
    }

    // Save Page button
    if (savePageBtn) {
        savePageBtn.addEventListener('click', async () => {
            if (savePageStatus) {
                savePageStatus.textContent = '';
                savePageStatus.className = 'save-page-status';
            }
            const tab = await getActiveNormalTab();
            if (!tab) {
                if (savePageStatus) {
                    savePageStatus.textContent = 'No active tab found';
                    savePageStatus.className = 'save-page-status error';
                }
                return;
            }
            savePageBtn.disabled = true;
            savePageBtn.textContent = 'Saving...';
            try {
                const headers = await buildAuthHeaders();
                // Dropdown overrides settings-level project
                const dropdownProjectId = savePageProject ? savePageProject.value : '';
                const projectId = dropdownProjectId || await getProjectId();
                const context = savePageContext ? savePageContext.value : '';
                const name = formatActionName(tab.url, tab.title, context);
                const body = {
                    json: {
                        name,
                        priority: 'Quick',
                        source: 'chrome-extension',
                        parseNaturalLanguage: false,
                    }
                };
                if (projectId && projectId !== 'default') {
                    body.json.projectId = projectId;
                }
                const response = await fetch(`${apiBaseURL}/api/trpc/action.quickCreate`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body)
                });
                if (response.ok) {
                    savePageBtn.textContent = 'Saved!';
                    if (savePageStatus) {
                        savePageStatus.textContent = 'Action created';
                        savePageStatus.className = 'save-page-status success';
                    }
                    if (savePageContext) savePageContext.value = '';
                } else {
                    savePageBtn.textContent = 'Save Failed';
                    if (savePageStatus) {
                        savePageStatus.textContent = 'Failed to save';
                        savePageStatus.className = 'save-page-status error';
                    }
                }
            } catch (error) {
                console.error('Error saving page:', error);
                savePageBtn.textContent = 'Save Failed';
                if (savePageStatus) {
                    savePageStatus.textContent = 'Network error';
                    savePageStatus.className = 'save-page-status error';
                }
            }
            setTimeout(() => {
                savePageBtn.disabled = false;
                savePageBtn.textContent = 'Save Page';
            }, 2000);
        });
    }

    // Check setup state — only initialize engines if fully configured
    const isConfigured = await checkSetupState();
    if (isConfigured) {
        await initEngines();
        if (hasSavePage) populateSavePageDropdowns();
    }
});
