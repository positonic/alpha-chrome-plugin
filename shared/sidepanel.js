// Side panel main script — Whisper dictation UI

const toggleButton = document.getElementById('toggleDictation');
const output = document.getElementById('output');
const statusEl = document.getElementById('status');
const sessionUrl = document.getElementById('session-url');
const recordingNameInput = document.getElementById('recordingName');
const modelStatusEl = document.getElementById('modelStatus');
const modelStatusText = document.getElementById('modelStatusText');
const modelProgressBar = document.getElementById('modelProgressBar');
const newRecordingBtn = document.getElementById('newRecordingBtn');
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
const setupWorkspaceDropdown = document.getElementById('setupWorkspaceDropdown');

// Shared project selector (above tabs)
const sharedProjectSelector = document.getElementById('sharedProjectSelector');
const sharedWorkspace = document.getElementById('sharedWorkspace');
const sharedProject = document.getElementById('sharedProject');

// Tab elements
const panelTabs = document.getElementById('panelTabs');
const tabSavePageBtn = document.getElementById('tabSavePage');
const tabRecordingBtn = document.getElementById('tabRecording');
const panelSavePage = document.getElementById('panelSavePage');
const panelRecording = document.getElementById('panelRecording');
const savePageBtn = document.getElementById('savePageBtn');
const savePageContext = document.getElementById('savePageContext');
const savePageStatus = document.getElementById('savePageStatus');

// Create Action tab elements
const tabCreateActionBtn = document.getElementById('tabCreateAction');
const panelCreateAction = document.getElementById('panelCreateAction');
const createActionName = document.getElementById('createActionName');
const createActionDesc = document.getElementById('createActionDesc');
const createActionPriority = document.getElementById('createActionPriority');
const createActionBtn = document.getElementById('createActionBtn');
const createActionStatus = document.getElementById('createActionStatus');

const autoAuthCard = document.getElementById('autoAuthCard');

const apiBaseURL = EXTENSION_CONFIG.apiBaseURL;
const hasProjects = EXTENSION_CONFIG.hasProjects;
const hasSavePage = EXTENSION_CONFIG.hasSavePage || false;
const cookieDomain = EXTENSION_CONFIG.cookieDomain || null;
const sessionCookieNames = EXTENSION_CONFIG.sessionCookieNames || null;

// Recording history elements
const recordingListEl = document.getElementById('recordingList');
const recordingHistoryEl = document.getElementById('recordingHistory');

// Generate Actions modal elements
const generateActionsBtn = document.getElementById('generateActionsBtn');
const actionsModal = document.getElementById('actionsModal');
const actionsModalBody = document.getElementById('actionsModalBody');
const actionsModalClose = document.getElementById('actionsModalClose');
const actionsModalCancel = document.getElementById('actionsModalCancel');
const actionsModalPublish = document.getElementById('actionsModalPublish');
const actionsSelectAll = document.getElementById('actionsSelectAll');
let selectedActionIds = new Set();

let engine = null; // The Whisper speech engine instance

let isListening = false;
let currentSessionId = null;
let currentTranscription = '';
let lastSavedTranscription = ''; // Track what's already been saved to server (for delta saves)
let lastScreenshotTime = 0;
const SCREENSHOT_COOLDOWN = 2000; // 2 seconds cooldown

// Recording history state
let recordingHistory = []; // Array of { sessionId, title, transcription, timestamp, sessionUrl }
let selectedRecordingId = null; // Currently selected recording's sessionId
const MAX_HISTORY = 20;
let titleUpdateTimer = null;
let cachedWorkspaces = []; // Cached workspace list for slug lookups
let expandedRecordingId = null; // Currently expanded recording's sessionId
const recordingActionsCache = {}; // Cache of fetched actions per sessionId

// --- Output helpers (contentEditable-safe) ---

/** Append transcribed text without disrupting cursor position */
function appendToOutput(newText) {
    const separator = output.textContent ? ' ' : '';
    output.appendChild(document.createTextNode(separator + newText));
    // Auto-scroll only if user is near the bottom
    if ((output.scrollHeight - output.scrollTop - output.clientHeight) < 50) {
        output.scrollTop = output.scrollHeight;
    }
}

/** Full replacement (used for clear / screenshot command rewrites) */
function setOutputContent(text) {
    output.textContent = text;
}

// Sync user edits back to in-memory transcript
output.addEventListener('input', () => {
    currentTranscription = output.textContent;
    // Clamp saved marker if user deleted already-saved text
    if (currentTranscription.length < lastSavedTranscription.length) {
        lastSavedTranscription = currentTranscription;
    }
});

// Force plain-text paste (no HTML formatting)
output.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
});

// Block formatting shortcuts (Ctrl/Cmd + B/I/U)
output.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
    }
});

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

function formatLink(url, title) {
    const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const displayText = title ? escapeHtml(title) : safeUrl;
    return `<a href="${safeUrl}">${displayText}</a>`;
}

function formatActionName(url, title, context) {
    const link = formatLink(url, title);
    if (context && context.trim()) {
        return {
            plain: context.trim(),
            html: `${escapeHtml(context.trim())}: ${link}`,
        };
    }
    return {
        plain: title || url,
        html: link,
    };
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
        const workspaces = data.result.data.json.workspaces; // expected: [{id, name, slug}, ...]
        cachedWorkspaces = workspaces;
        return workspaces;
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

async function populateProjectsForSelect(projSelect, workspaceId, explicitApiKey) {
    projSelect.innerHTML = '<option value="">Loading projects...</option>';
    const projects = workspaceId
        ? await fetchProjectsForWorkspace(workspaceId)
        : (explicitApiKey ? await fetchProjects(explicitApiKey) : await fetchProjects());
    projSelect.innerHTML = '<option value="">Select a project...</option>';
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projSelect.appendChild(option);
    });
}

async function populateWorkspaceAndProjectDropdowns(wsSelect, projSelect, preselectWsId, explicitApiKey) {
    const workspaces = await fetchWorkspaces();

    wsSelect.innerHTML = '<option value="">Select a workspace...</option>';
    workspaces.forEach(ws => {
        const option = document.createElement('option');
        option.value = ws.id;
        option.textContent = ws.name;
        wsSelect.appendChild(option);
    });

    // Auto-select if only one workspace, or pre-select stored
    if (workspaces.length === 1) {
        wsSelect.value = workspaces[0].id;
    } else if (preselectWsId) {
        wsSelect.value = preselectWsId;
    }

    // Populate projects based on selected workspace
    const selectedWsId = wsSelect.value;
    if (selectedWsId) {
        await populateProjectsForSelect(projSelect, selectedWsId, explicitApiKey);
    } else {
        const projects = explicitApiKey ? await fetchProjects(explicitApiKey) : await fetchProjects();
        projSelect.innerHTML = '<option value="">Select a project...</option>';
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.name;
            projSelect.appendChild(option);
        });
    }

    // Hide workspace dropdown if no workspaces (backwards compat)
    wsSelect.style.display = workspaces.length === 0 ? 'none' : '';

    return workspaces;
}

async function populateSharedDropdowns() {
    if (!sharedWorkspace || !sharedProject) return;

    const stored = await chrome.storage.local.get(['SELECTED_WORKSPACE_ID', 'SELECTED_PROJECT_ID']);
    const workspaces = await fetchWorkspaces();

    sharedWorkspace.innerHTML = '<option value="">Select workspace...</option>';
    workspaces.forEach(ws => {
        const option = document.createElement('option');
        option.value = ws.id;
        option.textContent = ws.name;
        sharedWorkspace.appendChild(option);
    });

    // Pre-select stored workspace or auto-select if only one
    if (stored.SELECTED_WORKSPACE_ID) {
        sharedWorkspace.value = stored.SELECTED_WORKSPACE_ID;
    } else if (workspaces.length === 1) {
        sharedWorkspace.value = workspaces[0].id;
    }

    // Populate projects based on selected workspace
    const wsId = sharedWorkspace.value;
    if (wsId) {
        await populateProjectsForSelect(sharedProject, wsId);
    } else {
        const projects = await fetchProjects();
        sharedProject.innerHTML = '<option value="">Select project...</option>';
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.name;
            sharedProject.appendChild(option);
        });
    }

    // Pre-select stored project
    if (stored.SELECTED_PROJECT_ID) {
        sharedProject.value = stored.SELECTED_PROJECT_ID;
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
        if (hasProjects) {
            keys.push('SELECTED_PROJECT_ID');
            keys.push('SELECTED_WORKSPACE_ID');
        }

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

                // Auto-auth succeeded — go straight to dictation UI
                updateSettingsDisplay(result.AUTH_METHOD || 'auto', null);
                if (hasProjects && sharedProjectSelector) {
                    sharedProjectSelector.classList.add('visible');
                }
                showDictation();
                resolve(true);
                return;
            }

            // Have auth — go straight to dictation UI
            updateSettingsDisplay(result.AUTH_METHOD, result.TRANSCRIPTION_API_KEY);
            if (hasProjects && sharedProjectSelector) {
                sharedProjectSelector.classList.add('visible');
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

    apiKeyStatusEl.textContent = 'Validating key...';
    apiKeyStatusEl.classList.remove('error');
    const projects = await fetchProjects(apiKey);
    if (projects.length === 0) {
        apiKeyStatusEl.textContent = 'Invalid API key or no projects found';
        apiKeyStatusEl.classList.add('error');
        return;
    }
    chrome.storage.local.set({ 'TRANSCRIPTION_API_KEY': apiKey, 'AUTH_METHOD': 'manual' }, async () => {
        apiKeyStatusEl.textContent = '';
        const ready = await checkSetupState();
        if (ready) await initEngine();
    });
};

projectDropdown.onchange = () => {
    const selectedId = projectDropdown.value;
    if (selectedId) {
        const workspaceId = setupWorkspaceDropdown ? setupWorkspaceDropdown.value : '';
        const storageUpdate = { 'SELECTED_PROJECT_ID': selectedId };
        if (workspaceId) storageUpdate['SELECTED_WORKSPACE_ID'] = workspaceId;
        chrome.storage.local.set(storageUpdate, async () => {
            projectStatusEl.textContent = '';
            const ready = await checkSetupState();
            if (ready) await initEngine();
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
        if (hasProjects) {
            keysToRemove.push('SELECTED_PROJECT_ID');
            keysToRemove.push('SELECTED_WORKSPACE_ID');
        }
        chrome.storage.local.remove(keysToRemove, () => {
            apiKeyInput.value = '';
            projectDropdown.innerHTML = '<option value="">Select a project...</option>';
            apiKeyStatusEl.textContent = '';
            projectStatusEl.textContent = '';
            checkSetupState();
        });
    }
};

// Setup flow: workspace change cascades to project dropdown
if (setupWorkspaceDropdown) {
    setupWorkspaceDropdown.addEventListener('change', async () => {
        await populateProjectsForSelect(projectDropdown, setupWorkspaceDropdown.value);
    });
}

// Shared workspace change: re-populate projects and persist to storage
if (sharedWorkspace) {
    sharedWorkspace.addEventListener('change', async () => {
        const workspaceId = sharedWorkspace.value;
        if (workspaceId) {
            chrome.storage.local.set({ SELECTED_WORKSPACE_ID: workspaceId });
        }
        await populateProjectsForSelect(sharedProject, workspaceId);
    });
}

// Shared project change: persist to storage
if (sharedProject) {
    sharedProject.addEventListener('change', () => {
        const projectId = sharedProject.value;
        if (projectId) {
            if (isListening) stopListening();
            chrome.storage.local.set({ SELECTED_PROJECT_ID: projectId });
        }
    });
}

async function initEngine() {
    if (!engine) {
        engine = new WhisperSpeechEngine();
        engine.init();
    }
    wireEngine(engine);

    // Show model progress if not ready yet
    const modelStatus = engine.getModelStatus();
    if (!modelStatus.ready) {
        modelStatusEl.classList.add('visible');
        toggleButton.disabled = true;
    } else {
        modelStatusEl.classList.remove('visible');
        toggleButton.disabled = false;
    }
}

// --- Server communication (unchanged from dictation.js) ---

async function startServerSession() {
    const headers = await buildAuthHeaders();
    const projectId = (sharedProject && sharedProject.value) || await getProjectId().catch(() => null);
    if (hasProjects && !projectId) {
        if (sharedProject) sharedProject.focus();
        throw new Error('Please select a project first');
    }
    const title = recordingNameInput ? recordingNameInput.value.trim() || null : null;

    const response = await fetch(`${apiBaseURL}/api/trpc/transcription.startSession`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ json: { projectId, title } })
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
    const sessionUrlPath = EXTENSION_CONFIG.sessionUrlPath || '/redirect-recording-to-workspace/';
    const sessionLinkUrl = `${apiBaseURL}${sessionUrlPath}${currentSessionId}`;
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

// --- Generate Actions API calls ---

async function apiGenerateDraftActions(transcriptionId) {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${apiBaseURL}/api/trpc/transcription.generateDraftActions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ json: { transcriptionId } })
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.json?.message || `Server returned ${response.status}`);
    }
    const data = await response.json();
    return data.result?.data?.json;
}

async function apiGetDraftActions(transcriptionId) {
    const headers = await buildAuthHeaders();
    const input = encodeURIComponent(JSON.stringify({ json: { transcriptionId } }));
    const response = await fetch(`${apiBaseURL}/api/trpc/action.getDraftByTranscription?input=${input}`, {
        method: 'GET',
        headers
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.json?.message || `Server returned ${response.status}`);
    }
    const data = await response.json();
    return data.result?.data?.json || [];
}

async function apiPublishSelectedDraftActions(transcriptionId, actionIds) {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${apiBaseURL}/api/trpc/transcription.publishSelectedDraftActions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ json: { transcriptionId, actionIds } })
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.json?.message || `Server returned ${response.status}`);
    }
    const data = await response.json();
    return data.result?.data?.json;
}

async function apiUpdateAction(id, fields) {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${apiBaseURL}/api/trpc/action.update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ json: { id, ...fields } })
    });
    if (!response.ok) {
        console.error('Failed to update action:', id, response.status);
    }
}

async function apiGetActionsByTranscription(transcriptionId) {
    const headers = await buildAuthHeaders();
    const input = encodeURIComponent(JSON.stringify({ json: { transcriptionId } }));
    const response = await fetch(`${apiBaseURL}/api/trpc/action.getByTranscription?input=${input}`, {
        method: 'GET',
        headers
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.json?.message || `Server returned ${response.status}`);
    }
    const data = await response.json();
    return data.result?.data?.json || [];
}

// --- Update session title on server ---

async function updateSessionTitle(sessionId, title) {
    try {
        const headers = await buildAuthHeaders();
        const response = await fetch(`${apiBaseURL}/api/trpc/transcription.updateTitle`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ json: { id: sessionId, title } })
        });
        return response.ok;
    } catch (error) {
        console.error('Error updating title:', error);
        return false;
    }
}

// --- Update full transcription text on server ---

async function updateTranscriptionText(sessionId, transcription) {
    try {
        const headers = await buildAuthHeaders();
        const response = await fetch(`${apiBaseURL}/api/trpc/transcription.updateTranscription`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ json: { id: sessionId, transcription } })
        });
        return response.ok;
    } catch (error) {
        console.error('Error updating transcription:', error);
        return false;
    }
}

// --- Recording history management ---

async function loadRecordingHistory() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['RECORDING_HISTORY'], (result) => {
            recordingHistory = result.RECORDING_HISTORY || [];
            resolve();
        });
    });
}

async function saveRecordingHistory() {
    await chrome.storage.local.set({ RECORDING_HISTORY: recordingHistory });
}

function addRecordingToHistory(sessionId, title, transcription, sessionLinkUrl) {
    // Remove existing entry with same sessionId (in case of duplicates)
    recordingHistory = recordingHistory.filter(r => r.sessionId !== sessionId);
    // Add to front
    recordingHistory.unshift({
        sessionId,
        title: title || '',
        transcription: transcription || '',
        timestamp: new Date().toISOString(),
        sessionUrl: sessionLinkUrl || ''
    });
    // Cap at MAX_HISTORY
    if (recordingHistory.length > MAX_HISTORY) {
        recordingHistory = recordingHistory.slice(0, MAX_HISTORY);
    }
    saveRecordingHistory();
}

function updateRecordingInHistory(sessionId, updates) {
    const recording = recordingHistory.find(r => r.sessionId === sessionId);
    if (recording) {
        Object.assign(recording, updates);
        saveRecordingHistory();
    }
}

function renderRecordingList() {
    if (!recordingListEl) return;
    recordingListEl.innerHTML = '';

    if (recordingHistory.length === 0) {
        recordingHistoryEl.style.display = 'none';
        return;
    }
    recordingHistoryEl.style.display = '';

    recordingHistory.forEach((rec) => {
        const isExpanded = rec.sessionId === expandedRecordingId;

        const item = document.createElement('div');
        item.className = 'recording-item'
            + (rec.sessionId === selectedRecordingId ? ' selected' : '')
            + (isExpanded ? ' expanded' : '');
        item.dataset.sessionId = rec.sessionId;

        // Header row with arrow + content
        const header = document.createElement('div');
        header.className = 'recording-item-header';

        const arrow = document.createElement('span');
        arrow.className = 'recording-item-arrow';
        arrow.textContent = '\u25B6'; // right-pointing triangle

        const headerContent = document.createElement('div');
        headerContent.className = 'recording-item-header-content';

        const title = document.createElement('div');
        title.className = 'recording-item-title';
        title.textContent = rec.title || 'Untitled Recording';

        const preview = document.createElement('div');
        preview.className = 'recording-item-preview';
        preview.textContent = rec.transcription
            ? (rec.transcription.length > 80 ? rec.transcription.slice(0, 80) + '...' : rec.transcription)
            : 'No transcription';

        const time = document.createElement('div');
        time.className = 'recording-item-time';
        const d = new Date(rec.timestamp);
        time.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
            d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

        headerContent.appendChild(title);
        headerContent.appendChild(preview);
        headerContent.appendChild(time);

        header.appendChild(arrow);
        header.appendChild(headerContent);
        item.appendChild(header);

        // Actions drawer
        const drawer = document.createElement('div');
        drawer.className = 'recording-actions-drawer' + (isExpanded ? ' open' : '');
        drawer.id = 'actions-drawer-' + rec.sessionId;
        item.appendChild(drawer);

        // Click on header selects the recording AND toggles drawer
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            // Toggle drawer state before selectRecording (which calls renderRecordingList)
            expandedRecordingId = expandedRecordingId === rec.sessionId ? null : rec.sessionId;
            selectRecording(rec.sessionId);
        });

        recordingListEl.appendChild(item);

        // If expanded, load actions into drawer
        if (isExpanded) {
            loadRecordingActions(rec.sessionId);
        }
    });
}

function toggleRecordingDrawer(sessionId) {
    if (expandedRecordingId === sessionId) {
        expandedRecordingId = null;
    } else {
        expandedRecordingId = sessionId;
    }
    renderRecordingList();
}

async function loadRecordingActions(sessionId) {
    const drawer = document.getElementById('actions-drawer-' + sessionId);
    if (!drawer) return;

    // Use cache if available
    if (recordingActionsCache[sessionId]) {
        renderRecordingActions(drawer, recordingActionsCache[sessionId]);
        return;
    }

    drawer.innerHTML = '<div class="recording-actions-loading">Loading actions...</div>';

    try {
        await refreshAuthIfNeeded();
        const actions = await apiGetActionsByTranscription(sessionId);
        recordingActionsCache[sessionId] = actions;
        renderRecordingActions(drawer, actions);
    } catch (error) {
        console.error('Error loading actions for recording:', sessionId, error);
        drawer.innerHTML = '<div class="recording-actions-empty">Could not load actions</div>';
    }
}

function getActionUrl(actionId) {
    // Find the selected workspace slug
    const wsId = sharedWorkspace ? sharedWorkspace.value : null;
    let wsSlug = null;
    if (wsId && cachedWorkspaces.length > 0) {
        const ws = cachedWorkspaces.find(w => w.id === wsId);
        if (ws && ws.slug) wsSlug = ws.slug;
    }

    if (wsSlug) {
        return `${apiBaseURL}/w/${wsSlug}/actions?actionId=${actionId}`;
    }
    return `${apiBaseURL}/actions?actionId=${actionId}`;
}

function renderRecordingActions(drawer, actions) {
    if (!actions || actions.length === 0) {
        drawer.innerHTML = '<div class="recording-actions-empty">No actions for this recording</div>';
        return;
    }

    const list = document.createElement('div');
    list.className = 'recording-actions-list';

    actions.forEach((action) => {
        const link = document.createElement('a');
        link.className = 'recording-action-link';
        link.href = getActionUrl(action.id);
        link.target = '_blank';
        link.title = action.description || action.name || '';

        // Checkbox icon SVG
        link.innerHTML = `<svg class="recording-action-link-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="1" y="1" width="14" height="14" rx="3"/>
            <path d="M4.5 8.5L7 11L11.5 5.5"/>
        </svg>`;

        const name = document.createElement('span');
        name.className = 'recording-action-link-name';
        name.textContent = action.name || 'Untitled Action';
        link.appendChild(name);

        if (action.priority) {
            const priority = document.createElement('span');
            priority.className = 'recording-action-link-priority ' + getPriorityClass(action.priority);
            priority.textContent = action.priority;
            link.appendChild(priority);
        }

        list.appendChild(link);
    });

    drawer.innerHTML = '';
    drawer.appendChild(list);
}

function selectRecording(sessionId) {
    if (isListening) return; // Don't switch while recording

    selectedRecordingId = sessionId;
    const rec = recordingHistory.find(r => r.sessionId === sessionId);
    if (!rec) return;

    // Update UI with selected recording's data
    recordingNameInput.value = rec.title || '';
    setOutputContent(rec.transcription || '');
    currentTranscription = rec.transcription || '';
    lastSavedTranscription = rec.transcription || '';
    currentSessionId = rec.sessionId;

    // Show session URL link
    if (rec.sessionUrl) {
        sessionUrl.href = rec.sessionUrl;
        sessionUrl.style.display = 'inline';
    } else {
        sessionUrl.style.display = 'none';
    }

    showGenerateActionsButton();
    toggleButton.textContent = 'Continue Recording';
    toggleButton.className = 'btn-continue';
    if (newRecordingBtn) newRecordingBtn.style.display = '';
    renderRecordingList();
}

// --- Deselect recording (start fresh) ---

function deselectRecording() {
    if (isListening) return;
    selectedRecordingId = null;
    currentSessionId = null;
    currentTranscription = '';
    lastSavedTranscription = '';
    setOutputContent('');
    if (recordingNameInput) recordingNameInput.value = '';
    sessionUrl.style.display = 'none';
    hideGenerateActionsButton();
    toggleButton.textContent = 'Start Recording';
    toggleButton.className = 'btn-primary';
    if (newRecordingBtn) newRecordingBtn.style.display = 'none';
    renderRecordingList();
}

// --- Debounced title update ---

function onRecordingNameInput() {
    if (!selectedRecordingId) return;
    clearTimeout(titleUpdateTimer);
    titleUpdateTimer = setTimeout(() => {
        const newTitle = recordingNameInput.value.trim();
        updateRecordingInHistory(selectedRecordingId, { title: newTitle });
        renderRecordingList();
        // Update on server
        updateSessionTitle(selectedRecordingId, newTitle);
    }, 500);
}

if (recordingNameInput) {
    recordingNameInput.addEventListener('input', onRecordingNameInput);
}

// --- Output blur handler for text editing ---

output.addEventListener('blur', () => {
    if (isListening) return; // Don't save edits while recording is active
    if (!selectedRecordingId) return;

    const editedText = output.textContent || '';
    const rec = recordingHistory.find(r => r.sessionId === selectedRecordingId);
    if (!rec || rec.transcription === editedText) return;

    // Update local history
    updateRecordingInHistory(selectedRecordingId, { transcription: editedText });
    currentTranscription = editedText;
    lastSavedTranscription = editedText;
    renderRecordingList();

    // Update on server (full text replacement)
    updateTranscriptionText(selectedRecordingId, editedText);
});

// --- Generate Actions modal logic ---

function getPriorityClass(priority) {
    if (!priority) return 'priority-quick';
    const slug = priority.toLowerCase().replace(/\s+/g, '-');
    return `priority-${slug}`;
}

const PRIORITY_OPTIONS = ['Quick', 'Scheduled', '1st Priority', '2nd Priority', '3rd Priority', '4th Priority', '5th Priority', 'Errand', 'Remember', 'Watch', 'Someday Maybe'];

function buildPrioritySelect(actionId, currentPriority) {
    const select = document.createElement('select');
    select.className = `action-edit-priority ${getPriorityClass(currentPriority)}`;
    select.dataset.actionId = actionId;
    PRIORITY_OPTIONS.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        if (p === currentPriority) opt.selected = true;
        select.appendChild(opt);
    });
    select.addEventListener('change', () => {
        select.className = `action-edit-priority ${getPriorityClass(select.value)}`;
        apiUpdateAction(actionId, { priority: select.value });
    });
    select.addEventListener('click', (e) => e.stopPropagation());
    return select;
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

function renderActionsModal(actions) {
    if (!actionsModalBody) return;
    actionsModalBody.innerHTML = '';

    if (!actions || actions.length === 0) {
        actionsModalBody.innerHTML = '<div class="actions-modal-empty">No actions were generated from this recording.</div>';
        actionsModalPublish.disabled = true;
        return;
    }

    selectedActionIds = new Set(actions.map(a => a.id));

    actions.forEach((action) => {
        const row = document.createElement('div');
        row.className = 'action-row';

        // Checkbox
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.dataset.actionId = action.id;

        // Content container
        const content = document.createElement('div');
        content.className = 'action-row-content';

        // Editable name
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'action-edit-name';
        nameInput.value = action.name || '';
        nameInput.dataset.actionId = action.id;
        nameInput.dataset.original = action.name || '';
        nameInput.addEventListener('blur', () => {
            const val = nameInput.value.trim();
            if (val && val !== nameInput.dataset.original) {
                nameInput.dataset.original = val;
                apiUpdateAction(action.id, { name: val });
            }
        });
        nameInput.addEventListener('click', (e) => e.stopPropagation());

        // Editable description
        const descInput = document.createElement('textarea');
        descInput.className = 'action-edit-desc';
        descInput.value = action.description || '';
        descInput.placeholder = 'Add description...';
        descInput.rows = 1;
        descInput.dataset.actionId = action.id;
        descInput.dataset.original = action.description || '';
        descInput.addEventListener('blur', () => {
            const val = descInput.value.trim();
            if (val !== descInput.dataset.original) {
                descInput.dataset.original = val;
                apiUpdateAction(action.id, { description: val || undefined });
            }
        });
        descInput.addEventListener('input', () => autoResizeTextarea(descInput));
        descInput.addEventListener('click', (e) => e.stopPropagation());

        content.appendChild(nameInput);
        content.appendChild(descInput);

        // Priority select
        const prioritySelect = buildPrioritySelect(action.id, action.priority || 'Quick');

        row.appendChild(cb);
        row.appendChild(content);
        row.appendChild(prioritySelect);

        // Row click toggles checkbox (but not when clicking editable fields)
        row.addEventListener('click', (e) => {
            if (e.target === cb || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            cb.checked = !cb.checked;
            if (cb.checked) {
                selectedActionIds.add(cb.dataset.actionId);
            } else {
                selectedActionIds.delete(cb.dataset.actionId);
            }
            updateActionsModalState();
        });

        cb.addEventListener('change', () => {
            if (cb.checked) {
                selectedActionIds.add(cb.dataset.actionId);
            } else {
                selectedActionIds.delete(cb.dataset.actionId);
            }
            updateActionsModalState();
        });

        actionsModalBody.appendChild(row);

        // Auto-size description after appending to DOM
        requestAnimationFrame(() => autoResizeTextarea(descInput));
    });

    updateActionsModalState();
}

function updateActionsModalState() {
    const checkboxes = actionsModalBody.querySelectorAll('input[type="checkbox"]');
    const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
    if (actionsSelectAll) actionsSelectAll.checked = allChecked;

    const count = selectedActionIds.size;
    actionsModalPublish.disabled = count === 0;
    actionsModalPublish.textContent = count === 0
        ? 'Create Actions'
        : `Create ${count} Action${count === 1 ? '' : 's'}`;
}

function openActionsModal() {
    if (actionsModal) actionsModal.classList.remove('hidden');
}

function closeActionsModal() {
    if (actionsModal) actionsModal.classList.add('hidden');
    if (actionsModalBody) actionsModalBody.innerHTML = '';
    selectedActionIds = new Set();
    // Reset button states
    if (actionsModalPublish) {
        actionsModalPublish.style.display = '';
        actionsModalPublish.disabled = false;
        actionsModalPublish.textContent = 'Create Actions';
    }
    if (actionsModalCancel) {
        actionsModalCancel.textContent = 'Cancel';
        actionsModalCancel.disabled = false;
    }
}

function showGenerateActionsButton() {
    if (!generateActionsBtn || !currentSessionId) return;
    chrome.storage.local.get(['AUTH_JWT'], (result) => {
        if (result.AUTH_JWT) {
            generateActionsBtn.classList.remove('hidden');
        }
    });
}

function hideGenerateActionsButton() {
    if (generateActionsBtn) generateActionsBtn.classList.add('hidden');
}

async function handleGenerateActions() {
    if (!currentSessionId) return;

    openActionsModal();
    actionsModalBody.innerHTML = '<div class="actions-modal-loading">Generating actions...</div>';
    actionsModalPublish.disabled = true;
    generateActionsBtn.disabled = true;
    generateActionsBtn.textContent = 'Generating...';
    generateActionsBtn.classList.add('loading');

    try {
        await refreshAuthIfNeeded();
        const result = await apiGenerateDraftActions(currentSessionId);

        if (!result || !result.success) {
            throw new Error(result?.errors?.join(', ') || 'Generation failed');
        }

        if (result.alreadyPublished) {
            actionsModalBody.innerHTML = '<div class="actions-modal-empty">Actions have already been published for this recording.</div>';
            actionsModalPublish.disabled = true;
            return;
        }

        // Fetch the full draft action objects
        const drafts = await apiGetDraftActions(currentSessionId);
        renderActionsModal(drafts);

    } catch (error) {
        console.error('Error generating actions:', error);
        actionsModalBody.innerHTML = `<div class="actions-modal-error">Failed to generate actions: ${escapeHtml(error.message)}</div>`;
        actionsModalPublish.disabled = true;
    } finally {
        generateActionsBtn.disabled = false;
        generateActionsBtn.textContent = 'Generate Actions';
        generateActionsBtn.classList.remove('loading');
    }
}

async function handlePublishActions() {
    const actionIds = Array.from(selectedActionIds);
    if (actionIds.length === 0 || !currentSessionId) return;

    actionsModalPublish.disabled = true;
    actionsModalPublish.textContent = 'Creating...';
    actionsModalCancel.disabled = true;

    try {
        await refreshAuthIfNeeded();
        const result = await apiPublishSelectedDraftActions(currentSessionId, actionIds);

        actionsModalBody.innerHTML = `<div class="actions-modal-empty" style="color: #059669;">
            ${result.publishedCount} action${result.publishedCount === 1 ? '' : 's'} created successfully!
        </div>`;
        actionsModalPublish.style.display = 'none';
        actionsModalCancel.textContent = 'Done';
        actionsModalCancel.disabled = false;

        // Invalidate actions cache so drawer shows fresh data
        delete recordingActionsCache[currentSessionId];

        setTimeout(closeActionsModal, 2000);
    } catch (error) {
        console.error('Error publishing actions:', error);
        actionsModalBody.innerHTML = `<div class="actions-modal-error">Failed to create actions: ${escapeHtml(error.message)}</div>`;
        actionsModalCancel.disabled = false;
    }
}

// Generate Actions event handlers
if (generateActionsBtn) generateActionsBtn.addEventListener('click', handleGenerateActions);
if (actionsModalClose) actionsModalClose.addEventListener('click', closeActionsModal);
if (actionsModalCancel) actionsModalCancel.addEventListener('click', closeActionsModal);
if (actionsModalPublish) actionsModalPublish.addEventListener('click', handlePublishActions);
if (actionsSelectAll) {
    actionsSelectAll.addEventListener('change', () => {
        const checkboxes = actionsModalBody.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = actionsSelectAll.checked;
            if (actionsSelectAll.checked) {
                selectedActionIds.add(cb.dataset.actionId);
            } else {
                selectedActionIds.delete(cb.dataset.actionId);
            }
        });
        updateActionsModalState();
    });
}
if (actionsModal) {
    actionsModal.addEventListener('click', (e) => {
        if (e.target === actionsModal) closeActionsModal();
    });
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
            setOutputContent(currentTranscription);
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
            appendToOutput('[SCREENSHOT]');
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

function wireEngine(eng) {
    // Whisper returns independent 5-second chunks — append each one.
    eng.onresult = (text) => {
        currentTranscription += (currentTranscription ? ' ' : '') + text;
        appendToOutput(text);

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
            toggleButton.textContent = selectedRecordingId ? 'Continue Recording' : 'Start Recording';
            toggleButton.className = selectedRecordingId ? 'btn-continue' : 'btn-primary';
            statusEl.className = '';
            if (currentSessionId) sessionUrl.style.display = 'inline';
            showGenerateActionsButton();
            if (selectedRecordingId && newRecordingBtn) newRecordingBtn.style.display = '';
        }
    };

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

        if (selectedRecordingId) {
            // CONTINUE mode — reuse existing session, keep state
            sessionUrl.style.display = 'none';
            hideGenerateActionsButton();
            if (newRecordingBtn) newRecordingBtn.style.display = 'none';
        } else {
            // FRESH mode — clear state and create new session
            setOutputContent('');
            sessionUrl.style.display = 'none';
            hideGenerateActionsButton();
            currentTranscription = '';
            lastSavedTranscription = '';
            if (recordingNameInput) {
                recordingNameInput.value = '';
                recordingNameInput.focus();
            }
            if (newRecordingBtn) newRecordingBtn.style.display = 'none';
            renderRecordingList();

            await startServerSession();
            selectedRecordingId = currentSessionId;
        }

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
    toggleButton.textContent = selectedRecordingId ? 'Continue Recording' : 'Start Recording';
    toggleButton.className = selectedRecordingId ? 'btn-continue' : 'btn-primary';
    if (currentSessionId) sessionUrl.style.display = 'inline';
    showGenerateActionsButton();
    if (selectedRecordingId && newRecordingBtn) newRecordingBtn.style.display = '';

    // Save to recording history
    if (currentSessionId) {
        const title = recordingNameInput ? recordingNameInput.value.trim() : '';
        const sessionUrlPath = EXTENSION_CONFIG.sessionUrlPath || '/redirect-recording-to-workspace/';
        const sessionLinkUrl = `${apiBaseURL}${sessionUrlPath}${currentSessionId}`;
        addRecordingToHistory(currentSessionId, title, currentTranscription, sessionLinkUrl);
        selectedRecordingId = currentSessionId;
        renderRecordingList();
    }
}

// --- Event handlers ---

toggleButton.onclick = () => {
    if (!isListening) {
        startListening();
    } else {
        stopListening();
    }
};

if (newRecordingBtn) {
    newRecordingBtn.onclick = deselectRecording;
}

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
    const allTabs = [tabSavePageBtn, tabCreateActionBtn, tabRecordingBtn].filter(Boolean);
    const allPanels = [panelSavePage, panelCreateAction, panelRecording].filter(Boolean);

    function switchTab(activeTab, activePanel) {
        allTabs.forEach(t => t.classList.remove('active'));
        allPanels.forEach(p => p.classList.remove('active'));
        if (activeTab) activeTab.classList.add('active');
        if (activePanel) activePanel.classList.add('active');
    }

    if (hasSavePage) {
        panelTabs.classList.add('visible');
        switchTab(tabSavePageBtn, panelSavePage);
    } else {
        panelTabs.classList.remove('visible');
        switchTab(tabRecordingBtn, panelRecording);
    }

    // Tab switching
    if (tabSavePageBtn) {
        tabSavePageBtn.addEventListener('click', () => switchTab(tabSavePageBtn, panelSavePage));
    }
    if (tabCreateActionBtn) {
        tabCreateActionBtn.addEventListener('click', () => switchTab(tabCreateActionBtn, panelCreateAction));
    }
    if (tabRecordingBtn) {
        tabRecordingBtn.addEventListener('click', () => switchTab(tabRecordingBtn, panelRecording));
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
                const projectId = (sharedProject && sharedProject.value) || await getProjectId().catch(() => null);
                if (hasProjects && !projectId) {
                    if (sharedProject) sharedProject.focus();
                    throw new Error('Please select a project first');
                }
                const context = savePageContext ? savePageContext.value : '';
                const { plain } = formatActionName(tab.url, tab.title, context);
                const body = {
                    json: {
                        name: plain,
                        priority: 'Quick',
                        source: 'chrome-extension',
                        parseNaturalLanguage: true,
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
                    const result = await response.json();
                    const actionId = result?.result?.data?.json?.action?.id;
                    if (actionId) {
                        const cleanedName = result?.result?.data?.json?.action?.name || plain;
                        const link = formatLink(tab.url, tab.title);
                        const finalName = context && context.trim()
                            ? `${escapeHtml(cleanedName)}: ${link}`
                            : link;
                        apiUpdateAction(actionId, { name: finalName });
                    }
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

    // Create Action button
    if (createActionBtn) {
        createActionBtn.addEventListener('click', async () => {
            if (createActionStatus) {
                createActionStatus.textContent = '';
                createActionStatus.className = 'save-page-status';
            }
            const name = createActionName ? createActionName.value.trim() : '';
            if (!name) {
                if (createActionStatus) {
                    createActionStatus.textContent = 'Please enter an action name';
                    createActionStatus.className = 'save-page-status error';
                }
                return;
            }
            createActionBtn.disabled = true;
            createActionBtn.textContent = 'Creating...';
            try {
                await refreshAuthIfNeeded();
                const headers = await buildAuthHeaders();
                const projectId = (sharedProject && sharedProject.value) || await getProjectId().catch(() => null);
                if (hasProjects && !projectId) {
                    if (sharedProject) sharedProject.focus();
                    throw new Error('Please select a project first');
                }
                const description = createActionDesc ? createActionDesc.value.trim() : '';
                const priority = createActionPriority ? createActionPriority.value : 'Quick';
                const body = {
                    json: {
                        name,
                        priority,
                        source: 'chrome-extension',
                        parseNaturalLanguage: true,
                    }
                };
                if (description) body.json.description = description;
                if (projectId && projectId !== 'default') {
                    body.json.projectId = projectId;
                }
                const response = await fetch(`${apiBaseURL}/api/trpc/action.quickCreate`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body)
                });
                if (response.ok) {
                    createActionBtn.textContent = 'Created!';
                    if (createActionStatus) {
                        createActionStatus.textContent = 'Action created';
                        createActionStatus.className = 'save-page-status success';
                    }
                    if (createActionName) createActionName.value = '';
                    if (createActionDesc) createActionDesc.value = '';
                    if (createActionPriority) createActionPriority.value = 'Quick';
                } else {
                    createActionBtn.textContent = 'Failed';
                    if (createActionStatus) {
                        createActionStatus.textContent = 'Failed to create action';
                        createActionStatus.className = 'save-page-status error';
                    }
                }
            } catch (error) {
                console.error('Error creating action:', error);
                createActionBtn.textContent = 'Failed';
                if (createActionStatus) {
                    createActionStatus.textContent = error.message || 'Network error';
                    createActionStatus.className = 'save-page-status error';
                }
            }
            setTimeout(() => {
                createActionBtn.disabled = false;
                createActionBtn.textContent = 'Create Action';
            }, 2000);
        });
    }

    // Load recording history
    await loadRecordingHistory();
    renderRecordingList();

    // Check setup state — only initialize engine if fully configured
    const isConfigured = await checkSetupState();
    if (isConfigured) {
        await initEngine();
        if (hasProjects) populateSharedDropdowns();
    }
});
