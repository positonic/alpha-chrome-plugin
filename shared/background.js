// Service worker for Chrome extension
// Manages side panel lifecycle, mic permission state, and the time-tracker
// toolbar-badge ambient indicator.

// Configure side panel — open directly when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ── Time-tracker badge ───────────────────────────────────────────────────
//
// Semantic token for the badge brand color. Chrome action badge APIs accept
// only literal color values (CSS variables are unreachable from the service
// worker), so this constant names the intent and stays in one place — matching
// `--color-primary` from the side panel design tokens.
const BADGE_COLOR_BRAND = '#2563eb';
const BADGE_TEXT_RUNNING = '●';

async function setBadgeRunning() {
    try {
        await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_BRAND });
        await chrome.action.setBadgeText({ text: BADGE_TEXT_RUNNING });
    } catch (_) {
        // setBadgeBackgroundColor on some Chrome versions wants a [r,g,b,a] array;
        // fall back gracefully.
    }
}

async function clearBadge() {
    try {
        await chrome.action.setBadgeText({ text: '' });
    } catch (_) {
        // ignore
    }
}

async function getStored(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (r) => resolve(r || {}));
    });
}

async function fetchActiveTimer() {
    const stored = await getStored(['API_BASE_URL', 'AUTH_JWT', 'TRANSCRIPTION_API_KEY']);
    if (!stored.API_BASE_URL) return null;
    const headers = { 'Content-Type': 'application/json' };
    if (stored.AUTH_JWT) {
        headers['Authorization'] = `Bearer ${stored.AUTH_JWT}`;
    } else if (stored.TRANSCRIPTION_API_KEY) {
        headers['x-api-key'] = stored.TRANSCRIPTION_API_KEY;
    } else {
        return null;
    }
    try {
        const response = await fetch(`${stored.API_BASE_URL}/api/trpc/timeEntry.getActive`, {
            method: 'GET',
            headers,
        });
        if (!response.ok) return null;
        const json = await response.json();
        return json && json.result && json.result.data && json.result.data.json;
    } catch (_) {
        return null;
    }
}

async function reconcileBadgeFromServer() {
    const entry = await fetchActiveTimer();
    if (entry && !entry.endedAt) {
        await setBadgeRunning();
    } else {
        await clearBadge();
    }
}

// Reconcile on service-worker startup (browser launch, extension reload).
chrome.runtime.onStartup.addListener(() => {
    reconcileBadgeFromServer().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
    reconcileBadgeFromServer().catch(() => {});
});

// Keyboard shortcut handler — forward toggle-annotation command to side panel / extension pages
chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-annotation') {
        chrome.runtime.sendMessage({ type: 'toggle-annotation-command' }).catch(() => {});
    }
});

// Listen for messages from side panel or permissions page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'mic-permission-granted') {
        chrome.storage.local.set({ MIC_PERMISSION_GRANTED: true });
        sendResponse({ ok: true });
        return;
    }
    if (message.type === 'open-side-panel') {
        chrome.sidePanel.open({ windowId: sender.tab?.windowId }).then(() => {
            sendResponse({ ok: true });
        });
        return true; // Keep channel open for async response
    }
    if (message.type === 'TIMER_STARTED') {
        setBadgeRunning().then(() => sendResponse({ ok: true }));
        return true;
    }
    if (message.type === 'TIMER_STOPPED') {
        clearBadge().then(() => sendResponse({ ok: true }));
        return true;
    }
});
