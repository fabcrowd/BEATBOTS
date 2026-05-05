// background.js — Service worker
// Relays messages between popup/content scripts + orchestrates product monitoring.
// Background TCIN polling runs here — no browser tab throttling.

importScripts('dropPollingTiming.js', 'core/hosts.js', 'core/debuggerBridge.js', 'cookieHarvest.js');

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

const DISCORD_COLOR = { success: 0x2ecc71, error: 0xe74c3c, info: 0x3498db, warn: 0xf39c12 };

/** POST JSON to Discord webhook URL from settings (fire-and-forget). */
async function postDiscordWebhook({ title, description, color, fields }) {
  try {
    const { discordWebhook } = await chrome.storage.local.get(['discordWebhook']);
    const url = String(discordWebhook || '').trim();
    if (!url.startsWith('https://discord.com/api/webhooks/') &&
        !url.startsWith('https://discordapp.com/api/webhooks/')) {
      return { ok: false, skipped: true };
    }
    const embed = {
      title: String(title || 'TCH').slice(0, 256),
      description: description ? String(description).slice(0, 2048) : undefined,
      color: typeof color === 'number' ? color : DISCORD_COLOR.info,
      fields: Array.isArray(fields)
        ? fields.map((f) => ({
          name: String(f.name || '').slice(0, 256),
          value: String(f.value || '—').slice(0, 1024),
          inline: !!f.inline,
        }))
        : [],
      timestamp: new Date().toISOString(),
    };
    const body = JSON.stringify({
      embeds: [embed],
      username: 'Target Checkout Helper',
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      console.warn('[TCH bg] Discord webhook HTTP', res.status);
      return { ok: false, httpStatus: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[TCH bg] postDiscordWebhook failed', e);
    return { ok: false };
  }
}

/** Origins whose storage/cookies we clear on RedSky 401/403 (same idea as Chrome “clear site data”). */
const TARGET_SESSION_RECOVERY_ORIGINS = [
  'https://www.target.com',
  'https://target.com',
  'https://m.target.com',
  'https://api.target.com',
  'http://www.target.com',
  'http://target.com',
];

let lastTargetSessionRecoveryMs = 0;
const TARGET_SESSION_RECOVERY_COOLDOWN_MS = 12 * 60 * 1000;

function notifyTargetTabsSessionHint() {
  chrome.tabs.query({ url: '*://*.target.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'TCH_SESSION_HINT' }).catch(() => {});
    }
  });
}

/**
 * RedSky inventory calls returned 401/403 — stale or rejected session.
 * Clears Target site data for common origins, reloads Target tabs, drops cached API key.
 * Cooldown prevents loops while the user still needs to sign in manually.
 */
async function maybeAutoRecoverTargetSession() {
  const now = Date.now();
  if (now - lastTargetSessionRecoveryMs < TARGET_SESSION_RECOVERY_COOLDOWN_MS) {
    return { ok: false, skipped: true };
  }

  // Guard 1: require 3+ consecutive 401/403s before wiping site data.
  // A single PX rejection or transient error must not nuke the session.
  // On the first two occurrences, show a toast hint only.
  if (redskyErrorStreak < 3) {
    console.warn(`[TCH bg] session recovery suppressed — streak ${redskyErrorStreak}/3 (toast only)`);
    notifyTargetTabsSessionHint();
    return { ok: false, reason: 'streak_below_threshold', streak: redskyErrorStreak };
  }

  // Guard 2: never wipe site data while the user is in an active checkout flow.
  // Clearing cookies mid-checkout is worse than a stale session — the user would
  // be logged out at the payment or review step.
  const checkoutTabs = await chrome.tabs.query({ url: '*://*.target.com/checkout*' }).catch(() => []);
  if (checkoutTabs.length > 0) {
    console.warn('[TCH bg] session recovery suppressed — checkout in progress on', checkoutTabs.length, 'tab(s)');
    notifyTargetTabsSessionHint();
    return { ok: false, reason: 'checkout_in_progress' };
  }

  if (typeof chrome.browsingData?.removeDataFromOrigins !== 'function') {
    console.warn('[TCH bg] browsingData.removeDataFromOrigins not available; falling back to toast hint');
    notifyTargetTabsSessionHint();
    return { ok: false, reason: 'no_browsing_data_api' };
  }

  try {
    await chrome.browsingData.removeDataFromOrigins(
      { origins: TARGET_SESSION_RECOVERY_ORIGINS },
      {
        cookies: true,
        localStorage: true,
        indexedDB: true,
        cacheStorage: true,
        serviceWorkers: false,
      }
    );
    console.log('[TCH bg] Target session recovery: site data cleared for', TARGET_SESSION_RECOVERY_ORIGINS.length, 'origins');
  } catch (e) {
    console.warn('[TCH bg] Target session recovery (browsingData) failed:', e);
    notifyTargetTabsSessionHint();
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }

  redskyErrorStreak = 0;
  lastTargetSessionRecoveryMs = Date.now();

  cachedApiKey = '';
  cachedRedskyBase = '';
  await chrome.storage.local.remove(['bgApiKey', 'bgRedskyBase']).catch(() => {});

  const tabs = await chrome.tabs.query({ url: '*://*.target.com/*' }).catch(() => []);
  broadcastToTarget({
    type: 'TCH_SESSION_RECOVERED',
    text: 'Target site data was cleared; tabs will reload. Sign in again if Target asks.',
  });
  await sleep(400);
  for (const t of tabs) {
    if (t.id != null) chrome.tabs.reload(t.id).catch(() => {});
  }
  void postDiscordWebhook({
    title: 'Target session recovered',
    color: DISCORD_COLOR.warn,
    description: 'Site data was cleared after repeated RedSky 401/403 responses; tabs reloaded. Sign in again if prompted.',
  });
  return { ok: true };
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

function extractWalmartItemId(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/ip\/[^/]+\/(\d+)/);
    return m?.[1] || null;
  } catch { return null; }
}

/**
 * Returns true if the URL is already past the product page —
 * i.e. the user/bot is in cart, checkout, or queue.
 * We must NOT navigate a tab that is already in this flow.
 */
function isInCheckoutFlow(url) {
  if (!url) return false;
  try {
    const path = new URL(url).pathname;
    return /^\/(cart|checkout|thankyou|thank-you|order-confirm)/i.test(path);
  } catch { return false; }
}

async function checkWalmartItemStock(itemId) {
  const url = `https://www.walmart.com/item/json/${itemId}`;
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const status = json?.product?.productAvailability?.availabilityStatus;
    if (!status) return null;
    const qRaw = json?.product?.productAvailability?.inventoryAvailableQuantity
      ?? json?.product?.productAvailability?.quantity;
    const qty = Number(qRaw);
    const stock = status === 'IN_STOCK';
    return {
      stock,
      qty: Number.isFinite(qty) && qty >= 0 ? qty : (stock ? 999 : 0),
    };
  } catch { return null; }
}

// ─── STOCK STATUS PARSING ────────────────────────────────────────────────────

const SELLABLE_STATUSES = new Set([
  'IN_STOCK', 'LIMITED_STOCK', 'PRE_ORDER_SELLABLE',
  'BACKORDER_AVAILABLE', 'BACKORDERED', 'AVAILABLE',
]);
const BLOCKED_RE = /(OUT_OF_STOCK|UNSELLABLE|UNAVAILABLE|NOT_AVAILABLE|NO_INVENTORY|INVENTORY_UNAVAILABLE)/i;

/** @returns {{ stock: boolean | null, qty: number }} */
function parseFulfillmentBlock(fulfillment) {
  if (!fulfillment || typeof fulfillment !== 'object') return { stock: null, qty: 0 };
  const shipping = fulfillment.shipping_options || {};
  const status = String(shipping.availability_status || '').toUpperCase();
  const qty = Number(shipping.available_to_promise_quantity) || 0;
  const soldOut = fulfillment.sold_out === true;
  const oosAll  = fulfillment.is_out_of_stock_in_all_store_locations === true;
  const sellable = qty > 0 || SELLABLE_STATUSES.has(status);
  const blocked  = soldOut || BLOCKED_RE.test(status) || (oosAll && qty <= 0 && !sellable);
  if (sellable && !soldOut) return { stock: true, qty };
  if (blocked) return { stock: false, qty };
  return { stock: null, qty };
}

// Parse the batch product_summary_with_fulfillment_v1 response.
// Returns a Map of tcin (string) → { stock, qty }.
function parseBatchFulfillmentResponse(payload) {
  const out = new Map();
  const products = payload?.data?.products ?? [];
  for (const p of products) {
    const tcin = String(p.tcin ?? '');
    if (tcin) out.set(tcin, parseFulfillmentBlock(p.fulfillment));
  }
  return out;
}

/** Resolves an entry from the stock map (object or legacy boolean) to in-stock for navigation. */
function stockEntryMeansAvailable(entry) {
  if (entry == null) return false;
  if (typeof entry === 'boolean') return entry === true;
  if (typeof entry === 'object' && 'stock' in entry) return entry.stock === true;
  return false;
}

// ─── BACKGROUND POLLING STATE ────────────────────────────────────────────────

let bgPollActive     = false;
let cachedApiKey     = '';
let cachedRedskyBase = 'https://redsky.target.com';
// Consecutive 401/403 responses from RedSky. Resets on any successful response
// or after a successful session recovery. Guards against nuking the session on
// transient PX rejections.
let redskyErrorStreak = 0;
// Pool health: timestamp of last TCH_HARVEST_NOW broadcast. Throttled to once
// per 60s so the content script is not spammed on every fast poll cycle.
let lastPoolLowBroadcastMs = 0;
const LOW_POOL_THRESHOLD   = 5;
const POOL_LOW_REBROADCAST_MS = 60 * 1000;
// Tracks which tab is assigned to which normalised product URL so we can
// navigate exactly the right tab when a restock is detected.
let urlToTabId       = {};
// URLs where the content script has confirmed queue entry — poll must not
// navigate these tabs or it will destroy the queue position.
const inQueueUrls    = new Set();
// URLs where the background has already navigated the tab to the product page.
// The content script is now in control — don't reload until it reports back.
const navigationLock = new Set();
// Tab IDs that have reported document hidden — used to warn popup that keepalives may throttle.
const harvestHiddenTabs = new Set();

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
    if (res.status === 401 || res.status === 403) {
      redskyErrorStreak++;
      await maybeAutoRecoverTargetSession();
      return null;
    }
    if (!res.ok) return null;
    const json = await res.json();
    redskyErrorStreak = 0;
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
    if (res.status === 401 || res.status === 403) {
      redskyErrorStreak++;
      await maybeAutoRecoverTargetSession();
    } else if (res.ok) {
      redskyErrorStreak = 0;
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
  console.log('[TCH bg] background poll started');

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

    const pendingProducts = (monitor.products || []).filter(p => {
      const n = normalizeProductUrl(p.url);
      return (monitor.counts?.[n] || 0) < p.qty;
    });
    if (!pendingProducts.length) { await sleep(1000); continue; }

    // Split by retailer — Walmart doesn't need the Target API key.
    const targetProducts  = pendingProducts.filter(p => !extractWalmartItemId(p.url));
    const walmartProducts = pendingProducts.filter(p =>  extractWalmartItemId(p.url));

    const hasTargetWork  = targetProducts.length > 0 && !!cachedApiKey;
    const hasWalmartWork = walmartProducts.length > 0;
    if (!hasTargetWork && !hasWalmartWork) {
      // No Target API key yet and no Walmart products — wait and try to get key.
      if (targetProducts.length > 0 && !cachedApiKey) requestApiKeyFromTabs();
      await sleep(1000);
      continue;
    }

    pollCycles++;
    if (pollCycles % 30 === 0) {
      console.log(`[TCH bg] poll cycle ${pollCycles} — Target: ${targetProducts.length}, Walmart: ${walmartProducts.length}`);
    }

    // Combined stock map — Target keyed by TCIN, Walmart keyed by normalized URL.
    const stockMap = new Map();

    if (hasTargetWork) {
      const tcins = targetProducts.map(p => extractTcin(p.url)).filter(Boolean);
      if (tcins.length) {
        const targetMap = await checkTcinsStock(tcins, cachedApiKey, cachedRedskyBase);
        for (const [k, v] of targetMap) stockMap.set(k, v);
      }
    }

    for (const wp of walmartProducts) {
      const itemId = extractWalmartItemId(wp.url);
      if (!itemId) continue;
      if (monitor.skipMonitoring) {
        stockMap.set(normalizeProductUrl(wp.url), { stock: true, qty: 999 });
      } else {
        const res = await checkWalmartItemStock(itemId);
        if (res != null) stockMap.set(normalizeProductUrl(wp.url), res);
      }
    }

    if (pollCycles % 60 === 0) {
      const entries = [...stockMap.entries()].map(([k, v]) => {
        const s = typeof v === 'object' && v && 'stock' in v ? v.stock : v;
        return `${k.slice(-12)}:${s}`;
      }).join(' ');
      console.log(`[TCH bg] poll cycle ${pollCycles} results: ${entries}`);
    }

    for (const product of pendingProducts) {
      if (!bgPollActive) break;
      const normUrl = normalizeProductUrl(product.url);

      // Skip products where the content script has confirmed queue entry —
      // navigating these tabs would destroy the user's queue position.
      if (inQueueUrls.has(normUrl)) {
        if (pollCycles % 30 === 0) console.log(`[TCH bg] Skipping ${normUrl} — in queue`);
        continue;
      }

      // Skip products where we already navigated the tab this cycle —
      // the content script is loading; reloading again would restart the
      // Walmart traffic queue ("hang tight" loop).
      if (navigationLock.has(normUrl)) {
        if (pollCycles % 30 === 0) console.log(`[TCH bg] Skipping ${normUrl} — navigation in progress`);
        continue;
      }

      const tcin = extractTcin(product.url);
      // Prefer TCIN key (Target) then fall back to URL key (Walmart).
      const entry = (tcin && stockMap.has(tcin)) ? stockMap.get(tcin) : stockMap.get(normUrl);
      if (!stockEntryMeansAvailable(entry)) continue;

      // Gate only when API reports a positive quantity below threshold. qty===0 often means
      // "unknown" while status still shows sellable — do not block those restocks.
      if (monitor.highStockOnly) {
        const th = Number(monitor.highStockThreshold) || 10;
        const qty = entry && typeof entry === 'object' ? (Number(entry.qty) || 0) : 0;
        if (qty > 0 && qty < th) {
          if (pollCycles % 60 === 0) {
            console.log(`[TCH bg] high-stock gate: qty ${qty} < ${th} — skipping ${normUrl.slice(-40)}`);
          }
          continue;
        }
      }

      // Restock detected — navigate the assigned monitor tab.
      const tabId = urlToTabId[normUrl];
      console.log(`[TCH bg] RESTOCK: url=${product.url} tabId=${tabId}`);

      void postDiscordWebhook({
        title: 'Stock detected',
        color: DISCORD_COLOR.info,
        fields: [
          { name: 'Product', value: (product.name || normUrl).slice(0, 200), inline: false },
          { name: 'URL', value: product.url.slice(0, 500), inline: false },
          {
            name: 'Qty (API)',
            value: entry && typeof entry === 'object'
              ? String(entry.qty ?? '—')
              : '—',
            inline: true,
          },
        ],
      });

      // Never navigate a tab that is already in cart/checkout/queue.
      // That would kick the user out of their queue position.
      if (tabId) {
        try {
          const currentTab = await chrome.tabs.get(tabId);
          if (isInCheckoutFlow(currentTab?.url)) {
            console.log(`[TCH bg] Tab ${tabId} already in checkout flow (${currentTab.url}) — not navigating`);
            break;
          }
        } catch { /* tab closed — fall through to create new one */ }
      }

      let navigated = false;
      if (tabId) {
        try {
          await chrome.tabs.update(tabId, { url: product.url, active: true });
          navigated = true;
        } catch { /* tab may have been closed */ }
      }
      if (!navigated) {
        const existing = await chrome.tabs.query({}).catch(() => []);
        // Skip any tab already in checkout flow
        const match = existing.find(t => t.url && normalizeProductUrl(t.url) === normUrl && !isInCheckoutFlow(t.url));
        if (match) {
          chrome.tabs.update(match.id, { url: product.url, active: true }).catch(() => {});
          navigated = true;
        }
      }
      if (!navigated) {
        chrome.tabs.create({ url: product.url, active: true }).catch(() => {});
      }
      // Lock this URL — content script is now loading on the product page.
      // Don't navigate again until it reports back (ATC_SUCCESS or NAV_FAILED).
      navigationLock.add(normUrl);
      console.log(`[TCH bg] Navigation lock set for ${normUrl}`);
      // Avoid hammering the same product multiple times per cycle.
      break;
    }

    // ── Pool health check ────────────────────────────────────────────────────
    // If the harvest pool is critically low, tell content scripts to top it up
    // immediately — overriding the "Don't stop harvesting" toggle. Throttled to
    // once per minute so fast poll cycles don't spam the message.
    try {
      const nowMs = Date.now();
      if (nowMs - lastPoolLowBroadcastMs >= POOL_LOW_REBROADCAST_MS) {
        const poolCfg = await tchGetHarvestConfig();
        if (poolCfg.harvestingEnabled) {
          const entries = await tchGetHarvestEntries();
          const alive   = tchPruneExpired(entries, poolCfg.expirationMinutes);
          if (alive.length < LOW_POOL_THRESHOLD) {
            console.log(`[TCH bg] pool low (${alive.length} snapshots) — broadcasting TCH_HARVEST_NOW`);
            broadcastToTarget({ type: 'TCH_HARVEST_NOW' });
            lastPoolLowBroadcastMs = nowMs;
          }
        }
      }
    } catch {}

    await sleep(computeBackgroundPollSleepMs(monitor));
  }
  console.log('[TCH bg] background poll stopped');
}

async function ensureBackgroundPollRunning() {
  if (!cachedApiKey) await loadCachedApiKey();
  if (!bgPollActive) {
    // Start the poll regardless of whether the API key is present — the loop
    // handles "no key + no Walmart products" gracefully with a 1s sleep.
    // Previously gated on cachedApiKey, which silently killed Walmart-only sessions.
    runBackgroundPoll();
  }
  if (!cachedApiKey) requestApiKeyFromTabs();
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

/** Dedupe checkout-success Discord pings (review + confirmation fire ~seconds apart). */
let lastDiscordCheckoutSuccessWebhookMs = 0;

async function notifyDiscordForRetryEvent(ev) {
  if (ev.status === 'success') {
    const now = Date.now();
    if (now - lastDiscordCheckoutSuccessWebhookMs < 12000) {
      return { ok: false, skipped: true };
    }
    lastDiscordCheckoutSuccessWebhookMs = now;
    return postDiscordWebhook({
      title: 'Checkout success',
      color: DISCORD_COLOR.success,
      fields: [
        { name: 'Mode', value: (ev.mode || '—').slice(0, 200), inline: true },
        { name: 'Recovered failures', value: String(ev.failedAttempts || 0), inline: true },
        { name: 'Page', value: (ev.page || '—').slice(0, 100), inline: true },
        { name: 'URL', value: (ev.url || '—').slice(0, 500), inline: false },
      ],
    });
  }
  if (ev.status === 'exhausted') {
    const { webhookSendFailures } = await chrome.storage.local.get('webhookSendFailures');
    if (!webhookSendFailures) return { ok: false, skipped: true };
    return postDiscordWebhook({
      title: 'Checkout retries exhausted',
      color: DISCORD_COLOR.error,
      fields: [
        { name: 'Reason', value: (ev.reason || '—').slice(0, 500), inline: false },
        { name: 'URL', value: (ev.url || '—').slice(0, 500), inline: false },
      ],
    });
  }
  return { ok: false, skipped: true };
}

/** Debounce — Target fires success at review and sometimes again at confirmation. */
let lastEndlessSuccessHandledMs = 0;

/** After a successful checkout, optionally restart monitoring (endless mode). */
async function maybeRestartEndlessMonitor() {
  const { endlessMode, endlessLimit } = await chrome.storage.local.get([
    'endlessMode',
    'endlessLimit',
  ]);
  if (!endlessMode) return;

  const now = Date.now();
  if (now - lastEndlessSuccessHandledMs < 12000) {
    console.log('[TCH bg] endless: duplicate success event ignored (within 12s)');
    return;
  }
  lastEndlessSuccessHandledMs = now;

  let { monitor } = await chrome.storage.local.get('monitor');
  if (!monitor?.products?.length) return;

  const lim = Number(endlessLimit) || 0;
  const prev = await chrome.storage.local.get('endlessSuccessCount');
  const next = (Number(prev.endlessSuccessCount) || 0) + 1;
  await chrome.storage.local.set({ endlessSuccessCount: next });

  if (lim > 0 && next >= lim) {
    console.log('[TCH bg] endless mode: hit max successes (' + lim + '), not restarting monitor');
    return;
  }

  console.log('[TCH bg] endless mode: restarting monitor after checkout success (success #' + next + ')');

  await stopMonitor();
  await startMonitor(
    monitor.products,
    monitor.refreshInterval || 1,
    monitor.dropExpectedAt,
    monitor.skipMonitoring,
    {
      highStockOnly: !!monitor.highStockOnly,
      highStockThreshold: Number(monitor.highStockThreshold) || 10,
      resetEndlessSuccessCount: false,
    }
  );
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

  void notifyDiscordForRetryEvent(compactEvent);
  if (compactEvent.status === 'success') {
    void maybeRestartEndlessMonitor().catch((e) =>
      console.warn('[TCH bg] maybeRestartEndlessMonitor', e)
    );
  }
}

// ─── MESSAGE ROUTER ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SETTINGS_UPDATED':
      broadcastToTarget(message);
      sendResponse({ ok: true });
      return true;

    case 'TARGET_API_SESSION_STALE':
      maybeAutoRecoverTargetSession()
        .then((r) => sendResponse(r))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'WEBHOOK_TEST':
      postDiscordWebhook({
        title: 'Test — Target Checkout Helper',
        color: DISCORD_COLOR.info,
        description: 'If you see this embed, your webhook URL is configured correctly.',
      })
        .then((r) => sendResponse(r))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'START_MONITOR':
      startMonitor(
        message.products,
        message.refreshInterval,
        message.dropExpectedAt,
        message.walmartSkipMonitoring,
        {
          highStockOnly: !!message.highStockOnly,
          highStockThreshold: Number(message.highStockThreshold) || 10,
          resetEndlessSuccessCount: true,
        }
      )
        .then(() => sendResponse({ ok: true }));
      return true;

    case 'STOP_MONITOR':
      stopMonitor().then(() => sendResponse({ ok: true }));
      return true;

    case 'WALMART_NAV_FAILED': {
      // Content script signals it couldn't proceed (PX timeout, ATC unavailable, etc.)
      // Release the navigation lock so the poll can try again on next cycle.
      const normFailUrl = normalizeProductUrl(message.url || '');
      if (normFailUrl) {
        navigationLock.delete(normFailUrl);
        console.log('[TCH bg] Navigation lock released (failed):', normFailUrl);
      }
      sendResponse({ ok: true });
      return true;
    }

    case 'WALMART_IN_QUEUE': {
      // Content script confirmed queue entry — lock this URL so the poll
      // never navigates the tab again and destroys the queue position.
      const normQueueUrl = normalizeProductUrl(message.url || '');
      if (normQueueUrl) {
        inQueueUrls.add(normQueueUrl);
        console.log('[TCH bg] WALMART_IN_QUEUE locked:', normQueueUrl);
      }
      sendResponse({ ok: true });
      return true;
    }

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

    case 'HARVEST_CAPTURE_BURST':
      tchCaptureBurst(
        message.data?.count,
        message.data?.kind,
        message.data?.url || '',
        message.data?.retailer || 'target'
      )
        .then((r) => sendResponse(r))
        .catch(() => sendResponse({ ok: false, total: 0 }));
      return true;

    case 'DEBUGGER_CLICK': {
      const tabId = Number(sender?.tab?.id);
      const x = Number(message.x);
      const y = Number(message.y);
      if (!tabId || isNaN(x) || isNaN(y)) { sendResponse({ ok: false }); return true; }
      tchDebuggerAutoAttach(tabId)
        .then(() => tchDebuggerClick(tabId, x, y))
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true;
    }

    case 'DEBUGGER_ATTACH': {
      const tabId = Number(message.tabId);
      const tabUrl = String(message.tabUrl || '');
      tchDebuggerAttach(tabId, tabUrl)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
      return true;
    }

    case 'DEBUGGER_DETACH':
      tchDebuggerDetach()
        .then((r) => sendResponse(r))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'DEBUGGER_STATUS':
      tchDebuggerStatus()
        .then((r) => sendResponse(r))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'HARVEST_CLEAR':
      tchClearHarvestEntries()
        .then(() => tchHarvestStatus())
        .then((s) => sendResponse(s))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'HARVEST_APPLY_NEXT':
      tchApplyNextSnapshot()
        .then((r) => sendResponse(r))
        .catch(() => sendResponse({ ok: false, reason: 'error' }));
      return true;

    case 'HARVEST_GET_STATUS':
      tchHarvestStatus()
        .then((s) => sendResponse({ ...s, harvestHidden: harvestHiddenTabs.size > 0 }))
        .catch(() => sendResponse({ ok: false }));
      return true;

    case 'HARVEST_VISIBILITY_CHANGE': {
      const visTabId = sender?.tab?.id;
      if (visTabId) {
        if (message.hidden) harvestHiddenTabs.add(visTabId);
        else harvestHiddenTabs.delete(visTabId);
      }
      sendResponse({ ok: true });
      return true;
    }

    case 'HARVEST_UPDATE_CONFIG': {
      (async () => {
        try {
          const cur = await tchGetHarvestConfig();
          const next = { ...cur, ...(message.data || {}) };
          if (message.data && message.data.harvestingEnabled === false) {
            await tchClearHarvestEntries();
          }
          await tchSetHarvestConfig(next);
          sendResponse({ ok: true, ...(await tchHarvestStatus()) });
        } catch {
          sendResponse({ ok: false });
        }
      })();
      return true;
    }

    case 'CHECK_ACCOUNT_STATUS': {
      (async () => {
        try {
          const tabs = await new Promise(r => chrome.tabs.query({ url: '*://*.target.com/*' }, r));
          if (!tabs.length) {
            sendResponse({ loggedIn: null, hasAddress: null, hasPayment: null, noTab: true });
            return;
          }
          const result = await chrome.tabs.sendMessage(tabs[0].id, { type: 'TCH_CHECK_ACCOUNT' })
            .catch(() => ({ loggedIn: null, hasAddress: null, hasPayment: null }));
          sendResponse(result);
        } catch (e) {
          sendResponse({ loggedIn: null, hasAddress: null, hasPayment: null });
        }
      })();
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

/** Throttles drop-aware harvest keep-alive (see maybeRunDropAwareHarvestKeepalive). */
let lastHarvestKeepaliveRunMs = 0;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'bgPollWatchdog') {
    const { monitor } = await chrome.storage.local.get('monitor').catch(() => ({}));
    if (!monitor?.active) return;
    if (!bgPollActive) {
      console.log('[TCH bg] watchdog: restarting poll (was inactive), cachedApiKey:', cachedApiKey ? 'present' : 'MISSING');
      await ensureBackgroundPollRunning();
    } else {
      console.log('[TCH bg] watchdog: poll running OK');
    }
    await maybeRunDropAwareHarvestKeepalive();
    return;
  }
});

// ─── SESSION KEEP-ALIVE (drop-aware, piggybacks on bgPollWatchdog ~30s) ───────
// Fetches www.target.com with credentials + snapshots cookies. Interval tightens
// near monitor.dropExpectedAt (same windows as stock polling — dropPollingTiming.js).

async function maybeRunDropAwareHarvestKeepalive() {
  const { monitor } = await chrome.storage.local.get('monitor').catch(() => ({}));
  if (!monitor?.active) return;
  const cfg = await tchGetHarvestConfig().catch(() => ({}));
  if (!cfg.harvestingEnabled) return;

  const minMs = typeof getHarvestKeepaliveMinIntervalMs === 'function'
    ? getHarvestKeepaliveMinIntervalMs(monitor)
    : 25 * 60 * 1000;
  const now = Date.now();
  if (now - lastHarvestKeepaliveRunMs < minMs) return;
  lastHarvestKeepaliveRunMs = now;

  try {
    await fetch('https://www.target.com/', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    console.log('[TCH bg] session keep-alive ping sent');
  } catch (e) {
    console.warn('[TCH bg] session keep-alive fetch failed:', e);
  }

  await tchCaptureOneSnapshot('keepalive', 'https://www.target.com/', 'target');
  console.log('[TCH bg] session keep-alive: snapshot captured');
}

// ─── BROADCAST ──────────────────────────────────────────────────────────────

function broadcastToTarget(message) {
  chrome.tabs.query({ url: '*://*.target.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

/** Monitor state is not part of SETTINGS_UPDATED; ping tabs so content.js drops stale cache. */
function notifyTargetTabsMonitorChanged() {
  broadcastToTarget({ type: 'MONITOR_UPDATED' });
}

// ─── MONITOR ORCHESTRATION ──────────────────────────────────────────────────

async function startMonitor(products, refreshInterval, dropExpectedAt, skipMonitoring, opts = {}) {
  const {
    highStockOnly = false,
    highStockThreshold = 10,
    resetEndlessSuccessCount = true,
  } = opts;

  await stopMonitor();

  if (resetEndlessSuccessCount) {
    await chrome.storage.local.set({ endlessSuccessCount: 0 });
  }

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
  if (skipMonitoring) monitor.skipMonitoring = true;
  monitor.highStockOnly = !!highStockOnly;
  monitor.highStockThreshold = Math.max(1, Math.min(999, Number(highStockThreshold) || 10));

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

  notifyTargetTabsMonitorChanged();
}

async function stopMonitor() {
  bgPollActive = false;
  lastHarvestKeepaliveRunMs = 0;
  inQueueUrls.clear();
  navigationLock.clear();

  const { monitor } = await chrome.storage.local.get('monitor');
  if (!monitor) return;

  for (const tabId of monitor.tabIds || []) {
    try { await chrome.tabs.remove(tabId); } catch {}
  }

  urlToTabId = {};
  monitor.active = false;
  monitor.tabIds = [];
  await chrome.storage.local.set({ monitor });

  notifyTargetTabsMonitorChanged();
}

async function handleATCSuccess(url, tabId) {
  const { monitor } = await chrome.storage.local.get('monitor');
  if (!monitor?.active) return;

  const normUrl = normalizeProductUrl(url);
  navigationLock.delete(normUrl); // release — ATC succeeded
  monitor.counts[normUrl] = (monitor.counts[normUrl] || 0) + 1;
  await chrome.storage.local.set({ monitor });

  const product = monitor.products.find(
    (p) => normalizeProductUrl(p.url) === normUrl
  );
  const currentCount = monitor.counts[normUrl];

  if (product && currentCount < product.qty) {
    // Detach debugger before reload — next DEBUGGER_CLICK will re-attach on demand.
    tchDebuggerDetach().catch(() => {});
    setTimeout(() => {
      chrome.tabs.reload(tabId).catch(() => {});
    }, (monitor.refreshInterval || 1) * 1000);
    return;
  }

  // Consider "done" if every product whose ID can be resolved is satisfied.
  // Products with no extractable TCIN *and* no Walmart item ID can't be auto-ATC'd — skip them.
  const allDone = monitor.products.every((p) => {
    const c = monitor.counts[normalizeProductUrl(p.url)] || 0;
    if (c >= p.qty) return true;
    return !extractTcin(p.url) && !extractWalmartItemId(p.url);
  });

  if (allDone) {
    bgPollActive = false;
    const isWalmart = !!extractWalmartItemId(url);
    if (!isWalmart) {
      // Target: navigate the ATC tab directly to Target checkout.
      chrome.tabs.update(tabId, { url: 'https://www.target.com/checkout' });
      // Detach debugger — no click simulation needed during checkout form-fill.
      tchDebuggerDetach().catch(() => {});
    }
    // Walmart: walmart-content.js already navigates cart → checkout — don't clobber it.

    for (const tid of monitor.tabIds || []) {
      if (tid !== tabId) {
        try { chrome.tabs.remove(tid); } catch {}
      }
    }

    monitor.active = false;
    await chrome.storage.local.set({ monitor });
  }
}
