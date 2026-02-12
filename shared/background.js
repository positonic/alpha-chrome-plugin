// Service worker for Chrome extension
// Manages side panel lifecycle and mic permission state

// Configure side panel — don't auto-open on action click (popup handles that)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

// Listen for messages from side panel or permissions page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'mic-permission-granted') {
        chrome.storage.local.set({ MIC_PERMISSION_GRANTED: true });
        sendResponse({ ok: true });
    }
    if (message.type === 'open-side-panel') {
        chrome.sidePanel.open({ windowId: sender.tab?.windowId }).then(() => {
            sendResponse({ ok: true });
        });
        return true; // Keep channel open for async response
    }
});
