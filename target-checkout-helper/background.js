// background.js — Service worker
// Relays messages between popup/content scripts + orchestrates product monitoring

function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

// ─── MESSAGE ROUTER ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SETTINGS_UPDATED':
      broadcastToTarget(message);
      sendResponse({ ok: true });
      return true;

    case 'START_MONITOR':
      startMonitor(message.products, message.refreshInterval)
        .then(() => sendResponse({ ok: true }));
      return true;

    case 'STOP_MONITOR':
      stopMonitor().then(() => sendResponse({ ok: true }));
      return true;

    case 'ATC_SUCCESS':
      handleATCSuccess(message.url, sender.tab.id)
        .then(() => sendResponse({ ok: true }));
      return true;

    case 'GET_MONITOR_STATUS':
      chrome.storage.local.get('monitor', ({ monitor }) => {
        sendResponse(monitor || { active: false, products: [], counts: {} });
      });
      return true;

    default:
      sendResponse({ ok: true });
      return true;
  }
});

// ─── BROADCAST ──────────────────────────────────────────────────────────────

function broadcastToTarget(message) {
  chrome.tabs.query({ url: '*://*.target.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

// ─── MONITOR ORCHESTRATION ──────────────────────────────────────────────────

async function startMonitor(products, refreshInterval) {
  const counts = {};
  for (const p of products) {
    counts[normalizeProductUrl(p.url)] = 0;
  }

  const monitor = {
    active: true,
    products,
    refreshInterval: refreshInterval || 5,
    counts,
    tabIds: [],
  };

  await chrome.storage.local.set({ monitor });

  for (const p of products) {
    try {
      const tab = await chrome.tabs.create({ url: p.url, active: false });
      monitor.tabIds.push(tab.id);
    } catch {}
  }

  await chrome.storage.local.set({ monitor });
}

async function stopMonitor() {
  const { monitor } = await chrome.storage.local.get('monitor');
  if (!monitor) return;

  for (const tabId of monitor.tabIds || []) {
    try { await chrome.tabs.remove(tabId); } catch {}
  }

  monitor.active = false;
  monitor.tabIds = [];
  await chrome.storage.local.set({ monitor });
}

async function handleATCSuccess(url, tabId) {
  const { monitor } = await chrome.storage.local.get('monitor');
  if (!monitor?.active) return;

  const normUrl = normalizeProductUrl(url);
  monitor.counts[normUrl] = (monitor.counts[normUrl] || 0) + 1;
  await chrome.storage.local.set({ monitor });

  const product = monitor.products.find(
    (p) => normalizeProductUrl(p.url) === normUrl
  );
  const currentCount = monitor.counts[normUrl];

  if (product && currentCount < product.qty) {
    setTimeout(() => {
      chrome.tabs.reload(tabId).catch(() => {});
    }, (monitor.refreshInterval || 5) * 1000);
    return;
  }

  const allDone = monitor.products.every((p) => {
    const c = monitor.counts[normalizeProductUrl(p.url)] || 0;
    return c >= p.qty;
  });

  if (allDone) {
    chrome.tabs.update(tabId, { url: 'https://www.target.com/cart' });

    for (const tid of monitor.tabIds || []) {
      if (tid !== tabId) {
        try { chrome.tabs.remove(tid); } catch {}
      }
    }

    monitor.active = false;
    await chrome.storage.local.set({ monitor });
  }
}
