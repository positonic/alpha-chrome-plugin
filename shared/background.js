// Service worker for Chrome extension
// Manages side panel lifecycle and mic permission state

// Configure side panel — don't auto-open on action click (popup handles that)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

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
    }
    if (message.type === 'open-side-panel') {
        chrome.sidePanel.open({ windowId: sender.tab?.windowId }).then(() => {
            sendResponse({ ok: true });
        });
        return true; // Keep channel open for async response
    }
});
