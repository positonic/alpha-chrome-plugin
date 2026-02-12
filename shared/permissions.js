// One-time microphone permission grant page
// Side panels can't prompt for getUserMedia directly, so we use this full tab

const grantBtn = document.getElementById('grantBtn');
const statusEl = document.getElementById('status');

grantBtn.onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());

        // Notify background script
        chrome.runtime.sendMessage({ type: 'mic-permission-granted' });
        chrome.storage.local.set({ MIC_PERMISSION_GRANTED: true });

        statusEl.textContent = 'Permission granted! You can close this tab.';
        statusEl.className = 'status success';
        grantBtn.textContent = 'Done';
        grantBtn.disabled = true;

        // Auto-close after a moment
        setTimeout(() => window.close(), 1500);
    } catch (error) {
        statusEl.textContent = 'Permission denied. Please allow microphone access and try again.';
        statusEl.className = 'status error';
    }
};
