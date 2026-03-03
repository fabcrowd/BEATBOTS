// background.js — Service worker
// Relays messages between popup and content scripts (required in MV3)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETTINGS_UPDATED') {
    // Broadcast to all Target tabs so content script reacts immediately
    chrome.tabs.query({ url: '*://*.target.com/*' }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab may not have content script ready — ignore
        });
      }
    });
  }
  sendResponse({ ok: true });
  return true;
});
