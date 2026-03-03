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

const RETRY_EVENT_LIMIT = 30;

function getDefaultCheckoutTelemetry() {
  return {
    failedAttemptsCurrentRun: 0,
    lastRunFailedAttempts: 0,
    totalFailures: 0,
    lastEvent: null,
    events: [],
  };
}

async function recordCheckoutRetryEvent(event) {
  if (!event || typeof event !== 'object') return;

  const { checkoutTelemetry } = await chrome.storage.local.get('checkoutTelemetry');
  const telemetry = { ...getDefaultCheckoutTelemetry(), ...(checkoutTelemetry || {}) };

  const compactEvent = {
    status: String(event.status || 'unknown'),
    attempt: Number(event.attempt) || 0,
    maxAttempts: Number(event.maxAttempts) || 0,
    failedAttempts: Number(event.failedAttempts) || 0,
    reason: String(event.reason || ''),
    page: String(event.page || ''),
    url: String(event.url || ''),
    delayMs: Number(event.delayMs) || 0,
    ts: Number(event.ts) || Date.now(),
  };

  if (compactEvent.status === 'scheduled') {
    telemetry.failedAttemptsCurrentRun = compactEvent.attempt;
    telemetry.totalFailures = (telemetry.totalFailures || 0) + 1;
  } else if (compactEvent.status === 'exhausted') {
    telemetry.failedAttemptsCurrentRun = compactEvent.maxAttempts || telemetry.failedAttemptsCurrentRun;
  } else if (compactEvent.status === 'success') {
    telemetry.lastRunFailedAttempts = compactEvent.failedAttempts;
    telemetry.failedAttemptsCurrentRun = 0;
  }

  telemetry.lastEvent = compactEvent;
  telemetry.events = [...(telemetry.events || []), compactEvent].slice(-RETRY_EVENT_LIMIT);
  await chrome.storage.local.set({ checkoutTelemetry: telemetry });
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

    case 'CHECKOUT_RETRY_EVENT':
      recordCheckoutRetryEvent(message.event)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'GET_MONITOR_STATUS':
      chrome.storage.local.get(['monitor', 'checkoutTelemetry'], ({ monitor, checkoutTelemetry }) => {
        const baseMonitor = monitor || { active: false, products: [], counts: {} };
        sendResponse({
          ...baseMonitor,
          checkoutTelemetry: checkoutTelemetry || getDefaultCheckoutTelemetry(),
        });
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
  // Clean up any previous monitoring session first
  await stopMonitor();

  const counts = {};
  for (const p of products) {
    counts[normalizeProductUrl(p.url)] = 0;
  }

  const monitor = {
    active: true,
    products,
    refreshInterval: refreshInterval || 1,
    counts,
    tabIds: [],
  };

  await chrome.storage.local.set({
    monitor,
    checkoutTelemetry: getDefaultCheckoutTelemetry(),
  });

  const tabResults = await Promise.allSettled(
    products.map(p => chrome.tabs.create({ url: p.url, active: false }))
  );
  monitor.tabIds = tabResults
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value.id);

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
    }, (monitor.refreshInterval || 1) * 1000);
    return;
  }

  const allDone = monitor.products.every((p) => {
    const c = monitor.counts[normalizeProductUrl(p.url)] || 0;
    return c >= p.qty;
  });

  if (allDone) {
    chrome.tabs.update(tabId, { url: 'https://www.target.com/checkout' });

    for (const tid of monitor.tabIds || []) {
      if (tid !== tabId) {
        try { chrome.tabs.remove(tid); } catch {}
      }
    }

    monitor.active = false;
    await chrome.storage.local.set({ monitor });
  }
}
