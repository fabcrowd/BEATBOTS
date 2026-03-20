// background.js — Service worker
// Relays messages between popup/content scripts + orchestrates product monitoring.
// Background TCIN polling runs here — no browser tab throttling.

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Tighter polling near user-provided drop time; relaxed when far away (fewer API calls). */
function computeBackgroundPollSleepMs(monitor) {
  const base = 500;
  const raw = monitor?.dropExpectedAt;
  if (!raw || typeof raw !== 'string') return base;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return base;
  const now = Date.now();
  const until = t - now;
  const afterDrop = now - t;
  const inPrewindow = until > 0 && until <= 10 * 60 * 1000;
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
  if (inPrewindow || inGrace) return 250;
  if (until > 45 * 60 * 1000) return 2000;
  return base;
}

function extractTcin(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/A-(\d{6,10})/i);
    if (m?.[1]) return m[1];
    const q = u.searchParams.get('tcin');
    if (q && /^\d{6,10}$/.test(q)) return q;
    return null;
  } catch { return null; }
}

// ─── STOCK STATUS PARSING ────────────────────────────────────────────────────

const SELLABLE_STATUSES = new Set([
  'IN_STOCK', 'LIMITED_STOCK', 'PRE_ORDER_SELLABLE',
  'BACKORDER_AVAILABLE', 'BACKORDERED', 'AVAILABLE',
]);
const BLOCKED_RE = /(OUT_OF_STOCK|UNSELLABLE|UNAVAILABLE|NOT_AVAILABLE|NO_INVENTORY|INVENTORY_UNAVAILABLE)/i;

function parseFulfillmentBlock(fulfillment) {
  if (!fulfillment || typeof fulfillment !== 'object') return null;
  const shipping = fulfillment.shipping_options || {};
  const status = String(shipping.availability_status || '').toUpperCase();
  const qty = Number(shipping.available_to_promise_quantity) || 0;
  const soldOut = fulfillment.sold_out === true;
  const oosAll  = fulfillment.is_out_of_stock_in_all_store_locations === true;
  const sellable = qty > 0 || SELLABLE_STATUSES.has(status);
  const blocked  = soldOut || BLOCKED_RE.test(status) || (oosAll && qty <= 0 && !sellable);
  if (sellable && !soldOut) return true;
  if (blocked) return false;
  return null;
}

// Parse the batch product_summary_with_fulfillment_v1 response.
// Returns a Map of tcin (string) → true | false | null.
function parseBatchFulfillmentResponse(payload) {
  const out = new Map();
  const products = payload?.data?.products ?? [];
  for (const p of products) {
    const tcin = String(p.tcin ?? '');
    if (tcin) out.set(tcin, parseFulfillmentBlock(p.fulfillment));
  }
  return out;
}

// ─── BACKGROUND POLLING STATE ────────────────────────────────────────────────

let bgPollActive     = false;
let cachedApiKey     = '';
let cachedRedskyBase = 'https://redsky.target.com';
// Tracks which tab is assigned to which normalised product URL so we can
// navigate exactly the right tab when a restock is detected.
let urlToTabId       = {};

// Load a previously-cached API key from storage (survives SW termination).
async function loadCachedApiKey() {
  const { bgApiKey, bgRedskyBase } = await chrome.storage.local.get(['bgApiKey', 'bgRedskyBase']).catch(() => ({}));
  if (bgApiKey && !cachedApiKey) {
    cachedApiKey = bgApiKey;
    if (bgRedskyBase) cachedRedskyBase = bgRedskyBase;
  }
}

// Ask all open Target tabs to re-send their API key (used after SW restart).
function requestApiKeyFromTabs() {
  chrome.tabs.query({ url: '*://*.target.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_API_KEY' }).catch(() => {});
    }
  });
}

// ─── TCIN STOCK CHECK ────────────────────────────────────────────────────────

// Single-TCIN check using product_fulfillment_v1 (known-good for preorders).
async function checkSingleTcin(tcin, apiKey, redskyBase) {
  const base = (redskyBase || 'https://redsky.target.com').replace(/\/$/, '');
  const url  = `${base}/redsky_aggregations/v1/web/product_fulfillment_v1`
    + `?key=${encodeURIComponent(apiKey)}&tcin=${encodeURIComponent(tcin)}`;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return parseFulfillmentBlock(json?.data?.product?.fulfillment);
  } catch {
    return null;
  }
}

// Batch check using product_summary_with_fulfillment_v1. For any TCIN that
// returns undefined (batch endpoint returned no data), falls back to the
// single-TCIN product_fulfillment_v1 endpoint which is authoritative for
// preorder items.
async function checkTcinsStock(tcins, apiKey, redskyBase) {
  if (!tcins.length || !apiKey) return new Map();
  const base = (redskyBase || 'https://redsky.target.com').replace(/\/$/, '');
  const url  = `${base}/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1`
    + `?key=${encodeURIComponent(apiKey)}&tcins=${tcins.join(',')}`;

  const out = new Map();
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const json = await res.json();
      const batchMap = parseBatchFulfillmentResponse(json);
      for (const [k, v] of batchMap) out.set(k, v);
    }
  } catch {}

  // For TCINs not covered by the batch endpoint, fall back to individual calls.
  const missing = tcins.filter(t => out.get(t) === undefined);
  if (missing.length) {
    await Promise.all(missing.map(async (tcin) => {
      const result = await checkSingleTcin(tcin, apiKey, redskyBase);
      if (result !== null) out.set(tcin, result);
    }));
  }
  return out;
}

// ─── BACKGROUND POLL LOOP ────────────────────────────────────────────────────

async function runBackgroundPoll() {
  bgPollActive = true;
  let pollCycles = 0;
  console.log('[TCH bg] background TCIN poll started — key:', cachedApiKey.slice(0, 12) + '...');

  // Restore urlToTabId from storage (lost when service worker was terminated).
  const { monitor: mon0 } = await chrome.storage.local.get('monitor').catch(() => ({}));
  if (mon0?.urlToTabId) {
    for (const [url, tabId] of Object.entries(mon0.urlToTabId)) {
      urlToTabId[url] = tabId;
    }
    console.log('[TCH bg] restored urlToTabId:', Object.keys(urlToTabId).length, 'entries');
  }

  while (bgPollActive) {
    const { monitor } = await chrome.storage.local.get('monitor').catch(() => ({}));
    if (!monitor?.active) { bgPollActive = false; break; }
    if (!cachedApiKey) { await sleep(1000); continue; }

    const pendingProducts = (monitor.products || []).filter(p => {
      const n = normalizeProductUrl(p.url);
      return (monitor.counts?.[n] || 0) < p.qty;
    });
    if (!pendingProducts.length) { await sleep(1000); continue; }

    const tcins = pendingProducts.map(p => extractTcin(p.url)).filter(Boolean);
    if (!tcins.length) { await sleep(1000); continue; }

    pollCycles++;
    if (pollCycles % 30 === 0) {
      console.log(`[TCH bg] poll cycle ${pollCycles} — watching ${tcins.length} TCINs: ${tcins.join(',')}`);
    }

    const stockMap = await checkTcinsStock(tcins, cachedApiKey, cachedRedskyBase);
    if (pollCycles % 60 === 0) {
      const statuses = tcins.map(t => `${t}:${stockMap.get(t)}`).join(' ');
      console.log(`[TCH bg] poll cycle ${pollCycles} results: ${statuses}`);
    }

    for (const product of pendingProducts) {
      if (!bgPollActive) break;
      const tcin = extractTcin(product.url);
      if (!tcin) continue;
      const inStock = stockMap.get(tcin);
      if (inStock !== true) continue;

      // Restock detected! Navigate the assigned monitor tab to the product page.
      const normUrl = normalizeProductUrl(product.url);
      const tabId = urlToTabId[normUrl];
      console.log(`[TCH bg] RESTOCK: tcin=${tcin} url=${product.url} tabId=${tabId}`);

      let navigated = false;
      if (tabId) {
        try {
          await chrome.tabs.update(tabId, { url: product.url, active: true });
          navigated = true;
        } catch { /* tab may have been closed */ }
      }
      if (!navigated) {
        const existing = await chrome.tabs.query({}).catch(() => []);
        const match = existing.find(t => t.url && normalizeProductUrl(t.url) === normUrl);
        if (match) {
          chrome.tabs.update(match.id, { url: product.url, active: true }).catch(() => {});
          navigated = true;
        }
      }
      if (!navigated) {
        chrome.tabs.create({ url: product.url, active: true }).catch(() => {});
      }
      // Avoid hammering the same product multiple times per cycle.
      break;
    }

    await sleep(computeBackgroundPollSleepMs(monitor));
  }
  console.log('[TCH bg] background TCIN poll stopped');
}

async function ensureBackgroundPollRunning() {
  if (!cachedApiKey) await loadCachedApiKey();
  if (!bgPollActive && cachedApiKey) {
    runBackgroundPoll();
  } else if (!cachedApiKey) {
    // Still no key — ask open tabs to resend it.
    requestApiKeyFromTabs();
  }
}

// ─── TELEMETRY ───────────────────────────────────────────────────────────────

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
    mode: String(event.mode || ''),
    reason: String(event.reason || ''),
    page: String(event.page || ''),
    url: String(event.url || ''),
    watchUrl: String(event.watchUrl || ''),
    delayMs: Number(event.delayMs) || 0,
    ts: Number(event.ts) || Date.now(),
  };

  if (compactEvent.status === 'scheduled' || compactEvent.status === 'watching') {
    telemetry.failedAttemptsCurrentRun = compactEvent.attempt;
    telemetry.totalFailures = (telemetry.totalFailures || 0) + 1;
  } else if (compactEvent.status === 'exhausted') {
    telemetry.failedAttemptsCurrentRun = compactEvent.maxAttempts || telemetry.failedAttemptsCurrentRun;
  } else if (compactEvent.status === 'cancelled') {
    telemetry.failedAttemptsCurrentRun = 0;
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
      startMonitor(message.products, message.refreshInterval, message.dropExpectedAt)
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

    // Content scripts send the Target API key so the service worker can poll
    // the fulfillment API directly, without relying on throttled tab timers.
    case 'CACHE_API_KEY': {
      const key  = String(message.apiKey  || '');
      const base = String(message.redskyBase || '');
      if (key && key !== cachedApiKey) {
        cachedApiKey = key;
        if (base) cachedRedskyBase = base;
        // Persist so we survive future SW termination/restart cycles.
        chrome.storage.local.set({ bgApiKey: key, bgRedskyBase: cachedRedskyBase }).catch(() => {});
        console.log('[TCH bg] API key cached; ensuring poll is running');
        chrome.storage.local.get('monitor').then(({ monitor }) => {
          if (monitor?.active) ensureBackgroundPollRunning();
        });
      }
      sendResponse({ ok: true });
      return true;
    }

    default:
      sendResponse({ ok: true });
      return true;
  }
});

// ─── ALARM: WATCHDOG ─────────────────────────────────────────────────────────
// Chrome may terminate the service worker after inactivity. The alarm wakes it
// back up and restarts the polling loop if monitoring is still active.

// Fire every 20 seconds (minimum Chrome allows is ~1 min without unlimitedStorage;
// 0.5 min = 30s is the practical minimum). Keep at 0.5 to wake the SW promptly.
chrome.alarms.create('bgPollWatchdog', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'bgPollWatchdog') return;
  const { monitor } = await chrome.storage.local.get('monitor').catch(() => ({}));
  if (!monitor?.active) return;
  if (!bgPollActive) {
    console.log('[TCH bg] watchdog: restarting poll (was inactive), cachedApiKey:', cachedApiKey ? 'present' : 'MISSING');
    await ensureBackgroundPollRunning();
  } else {
    console.log('[TCH bg] watchdog: poll running OK');
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

async function startMonitor(products, refreshInterval, dropExpectedAt) {
  await stopMonitor();

  const counts = {};
  for (const p of products) counts[normalizeProductUrl(p.url)] = 0;

  const monitor = {
    active: true,
    products,
    refreshInterval: refreshInterval || 1,
    counts,
    tabIds: [],
    urlToTabId: {},
  };
  if (dropExpectedAt && String(dropExpectedAt).trim()) {
    monitor.dropExpectedAt = String(dropExpectedAt).trim();
  }

  await chrome.storage.local.set({
    monitor,
    checkoutTelemetry: getDefaultCheckoutTelemetry(),
  });

  // Open one background tab per product for the content-script ATC click
  // after the background poll navigates it on restock detection.
  const tabResults = await Promise.allSettled(
    products.map(p => chrome.tabs.create({ url: p.url, active: false }))
  );
  monitor.tabIds = [];
  monitor.urlToTabId = {};
  urlToTabId = {};
  for (let i = 0; i < products.length; i++) {
    if (tabResults[i].status === 'fulfilled') {
      const tabId = tabResults[i].value.id;
      const norm  = normalizeProductUrl(products[i].url);
      monitor.tabIds.push(tabId);
      monitor.urlToTabId[norm] = tabId;
      urlToTabId[norm] = tabId;
    }
  }

  await chrome.storage.local.set({ monitor });

  // Start background TCIN polling immediately if we already have the API key.
  // Otherwise it will start as soon as CACHE_API_KEY is received.
  ensureBackgroundPollRunning();
}

async function stopMonitor() {
  bgPollActive = false;

  const { monitor } = await chrome.storage.local.get('monitor');
  if (!monitor) return;

  for (const tabId of monitor.tabIds || []) {
    try { await chrome.tabs.remove(tabId); } catch {}
  }

  urlToTabId = {};
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

  // Consider "done" if every product whose TCIN can be extracted is satisfied.
  // This prevents stale/unresolvable products from blocking checkout indefinitely.
  const allDone = monitor.products.every((p) => {
    const c = monitor.counts[normalizeProductUrl(p.url)] || 0;
    if (c >= p.qty) return true;
    // A product with no extractable TCIN can't be auto-ATC'd — skip it.
    return !extractTcin(p.url);
  });

  if (allDone) {
    bgPollActive = false;
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
