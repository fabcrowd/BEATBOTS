// samsclub-content.js — Sam's Club Checkout Helper (SC-1 module stub)
// Injected into *.samsclub.com pages. FCFS retailer — no Walmart queue lock (SC-5).

let scRuntimeEnabled = false;
let scSettingsCache = null;

async function scGetSettings() {
  if (!scSettingsCache) {
    scSettingsCache = await chrome.storage.local.get([
      'enabled',
      'monitor',
      'autoPlaceOrder',
    ]).catch(() => ({}));
  }
  return scSettingsCache;
}

function scInvalidateCache() {
  scSettingsCache = null;
}

function scGetPageType() {
  const path = location.pathname;
  if (/\/p\//.test(path) || /\/ip\//.test(path) || /\/prod\//.test(path)) return 'product';
  if (path.includes('/cart')) return 'cart';
  if (path.includes('/checkout')) return 'checkout';
  return 'other';
}

async function scInit() {
  if (typeof TCH_HOSTS !== 'undefined' && TCH_HOSTS.detectRetailer) {
    if (TCH_HOSTS.detectRetailer(location.href) !== 'samsclub') return;
  }
  const data = await scGetSettings();
  scRuntimeEnabled = !!data.enabled;
  const page = scGetPageType();
  console.log(
    '[TCH] init:',
    page,
    'enabled:',
    data.enabled,
    'monitor:',
    !!data.monitor?.active,
    'retailer: samsclub'
  );
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_UPDATED') {
    scInvalidateCache();
    scRuntimeEnabled = !!message.enabled;
    if (!scRuntimeEnabled) return;
    scInit();
  }
  if (message.type === 'MONITOR_UPDATED') {
    scInvalidateCache();
    void scInit();
  }
});

if (document.body) {
  scInit();
} else {
  document.addEventListener('DOMContentLoaded', scInit, { once: true });
}
