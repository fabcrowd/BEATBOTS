// cookieHarvest.js — Target-only cookie snapshots (Refract-style workflow, minimal permissions).
// Loaded by background.js via importScripts. Snapshot **entries** live in chrome.storage.session
// (cleared when the browser session ends). User preferences live in chrome.storage.local.

const HARVEST_ENTRIES_SESSION_KEY = 'tchHarvestEntries';
const HARVEST_CONFIG_LOCAL_KEY = 'harvestConfig';

/** If chrome.storage.session is missing (old Chrome), hold pool in SW RAM until worker dies. */
let memoryHarvestFallback = [];

const DEFAULT_HARVEST_CONFIG = {
  harvestingEnabled: false,
  harvestsPerPageLoad: 1,
  expirationMinutes: 3,
  removalOrder: 'lifo',
  dontStopHarvesting: false,
  applyNextBeforeCheckout: false,
};

async function tchGetHarvestConfig() {
  const data = await chrome.storage.local.get(HARVEST_CONFIG_LOCAL_KEY).catch(() => ({}));
  return { ...DEFAULT_HARVEST_CONFIG, ...(data[HARVEST_CONFIG_LOCAL_KEY] || {}) };
}

async function tchSetHarvestConfig(partial) {
  const cur = await tchGetHarvestConfig();
  await chrome.storage.local.set({ [HARVEST_CONFIG_LOCAL_KEY]: { ...cur, ...partial } });
}

async function tchSessionStorageAvailable() {
  return !!(chrome.storage && chrome.storage.session);
}

async function tchGetHarvestEntries() {
  if (!(await tchSessionStorageAvailable())) return [...memoryHarvestFallback];
  const data = await chrome.storage.session.get(HARVEST_ENTRIES_SESSION_KEY).catch(() => ({}));
  return Array.isArray(data[HARVEST_ENTRIES_SESSION_KEY]) ? data[HARVEST_ENTRIES_SESSION_KEY] : [];
}

async function tchSetHarvestEntries(entries) {
  if (!(await tchSessionStorageAvailable())) {
    memoryHarvestFallback = entries;
    return;
  }
  await chrome.storage.session.set({ [HARVEST_ENTRIES_SESSION_KEY]: entries }).catch(() => {});
}

function tchPruneExpired(entries, expirationMinutes) {
  const maxAge = Math.max(1, Number(expirationMinutes) || 3) * 60 * 1000;
  const now = Date.now();
  return entries.filter((e) => now - (e.ts || 0) <= maxAge);
}

function tchSerializeCookie(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: c.expirationDate,
    storeId: c.storeId,
    partitionKey: c.partitionKey,
  };
}

/** Cookies for a supported retailer (uses TCH_HOSTS from core/hosts.js in SW). */
async function tchReadCookiesForRetailer(retailerId) {
  const byKey = new Map();
  const merge = (arr) => {
    for (const c of arr || []) {
      const k = `${c.domain}\0${c.name}\0${c.path}\0${JSON.stringify(c.partitionKey || null)}`;
      byKey.set(k, c);
    }
  };
  const domains = (typeof TCH_HOSTS !== 'undefined' && TCH_HOSTS.cookieDomainsFor)
    ? TCH_HOSTS.cookieDomainsFor(retailerId)
    : ['target.com'];
  for (const domain of domains) {
    try {
      merge(await chrome.cookies.getAll({ domain }));
    } catch {}
  }
  if (retailerId === 'target') {
    try {
      merge(await chrome.cookies.getAll({ url: 'https://www.target.com/' }));
    } catch {}
  }
  return [...byKey.values()].map(tchSerializeCookie);
}

async function tchCaptureOneSnapshot(kind, tabUrl, retailerId) {
  const rid = retailerId || 'target';
  if (rid === 'walmart') {
    return { ok: false, reason: 'walmart_not_implemented', total: 0 };
  }
  if (rid !== 'target') {
    return { ok: false, reason: 'unknown_retailer', total: 0 };
  }
  const cfg = await tchGetHarvestConfig();
  if (!cfg.harvestingEnabled) return { ok: false, reason: 'disabled', total: 0 };
  const cookies = await tchReadCookiesForRetailer(rid);
  let entries = tchPruneExpired(await tchGetHarvestEntries(), cfg.expirationMinutes);
  entries.push({
    ts: Date.now(),
    kind: kind || 'unknown',
    tabUrl: tabUrl || '',
    retailer: rid,
    cookies,
  });
  while (entries.length > 48) {
    if (cfg.removalOrder === 'fifo') entries.pop();
    else entries.shift();
  }
  await tchSetHarvestEntries(entries);
  return { ok: true, total: entries.length };
}

async function tchCaptureBurst(count, kind, tabUrl, retailerId) {
  const cfg = await tchGetHarvestConfig();
  if (!cfg.harvestingEnabled) return { ok: false, reason: 'disabled', total: 0 };
  const n = Math.max(1, Math.min(5, Number(count) || cfg.harvestsPerPageLoad || 1));
  let last = { ok: true, total: 0 };
  for (let i = 0; i < n; i++) {
    last = await tchCaptureOneSnapshot(kind, tabUrl, retailerId);
    if (!last.ok) return last;
  }
  return last;
}

async function tchClearHarvestEntries() {
  memoryHarvestFallback = [];
  if (!(await tchSessionStorageAvailable())) return;
  await chrome.storage.session.remove(HARVEST_ENTRIES_SESSION_KEY).catch(() => {});
}

async function tchHarvestStatus() {
  const cfg = await tchGetHarvestConfig();
  const entries = tchPruneExpired(await tchGetHarvestEntries(), cfg.expirationMinutes);
  if (entries.length !== (await tchGetHarvestEntries()).length) {
    await tchSetHarvestEntries(entries);
  }
  return {
    ok: true,
    config: cfg,
    count: entries.length,
    sessionStorage: await tchSessionStorageAvailable(),
  };
}

function tchSameSiteForSet(ss) {
  const s = String(ss || '').toLowerCase();
  if (s === 'lax' || s === 'strict' || s === 'no_restriction') return s;
  return 'unspecified';
}

async function tchApplyNextSnapshot() {
  const cfg = await tchGetHarvestConfig();
  let entries = tchPruneExpired(await tchGetHarvestEntries(), cfg.expirationMinutes);
  if (!entries.length) return { ok: false, reason: 'empty', remaining: 0 };
  const idx = cfg.removalOrder === 'fifo' ? 0 : entries.length - 1;
  const snap = entries[idx];
  const setUrl = 'https://www.target.com';
  for (const c of snap.cookies || []) {
    try {
      const details = {
        url: setUrl,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
      };
      const ss = tchSameSiteForSet(c.sameSite);
      if (ss !== 'unspecified') details.sameSite = ss;
      if (c.expirationDate) details.expirationDate = c.expirationDate;
      if (c.storeId) details.storeId = c.storeId;
      if (c.partitionKey) details.partitionKey = c.partitionKey;
      await chrome.cookies.set(details);
    } catch (e) {
      /* skip individual cookie set failures */
    }
  }
  entries.splice(idx, 1);
  await tchSetHarvestEntries(entries);
  return { ok: true, remaining: entries.length };
}
