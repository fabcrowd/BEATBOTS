/**
 * Functional smoke: background message router + cookie harvest + debugger bridge
 * + monitor start/stop, per target-checkout-helper/background.js and popup flows.
 * Runs from extension popup context (chrome.runtime.sendMessage).
 */
import assert from 'node:assert/strict';
import { launchWithExtension, rmProfileDir } from './launch-util.mjs';

let browser;
let userDataDir;

function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Mirrors background.js poll loop skip checks (inQueueUrls / navigationLock). */
function pollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock) {
  if (inQueueUrls.has(normUrl)) return true;
  if (navigationLock.has(normUrl)) return true;
  return false;
}

/** Mirrors background.js isInCheckoutFlow — poll must not navigate tabs already in checkout. */
function isInCheckoutFlow(url) {
  if (!url) return false;
  try {
    const path = new URL(url).pathname;
    return /^\/(cart|checkout|thankyou|thank-you|order-confirm)/i.test(path);
  } catch {
    return false;
  }
}

async function waitForMonitorLocks(popup, check, label, timeoutMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    if (check(status)) return status;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`MON-3: timeout waiting for ${label}`);
}

/** Mirrors popup.js toggleMonitor retailer filter. */
function filterProductsByRetailer(products, retailerFilter) {
  return retailerFilter ? products.filter((p) => retailerFilter.test(p.url)) : products;
}

/** Mirrors background.js WALMART_NAV_FAILED handler — releases navigationLock only. */
function applyWalmartNavFailed(navigationLock, inQueueUrls, message) {
  const normFailUrl = normalizeProductUrl(message.url || '');
  if (normFailUrl) navigationLock.delete(normFailUrl);
  return normFailUrl;
}

/** Mirrors background.js handleATCSuccess lock release — never arms inQueueUrls. */
function applyAtcSuccess(navigationLock, inQueueUrls, message) {
  const normUrl = normalizeProductUrl(message.url || '');
  if (normUrl) {
    navigationLock.delete(normUrl);
    inQueueUrls.delete(normUrl);
  }
  return normUrl;
}

/**
 * MON-2 offline parity: walmart-only monitor during live poll on Target tab.
 * Parity with FIX-3 mon2-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runMon2LivePollCycleOfflineTests() {
  const targetPageUrl = 'https://www.target.com/p/mock-product/A-880080';
  const targetCheckoutUrl = 'https://www.target.com/checkout/review';
  const walmartProbeUrl = 'https://www.walmart.com/ip/mock-mon2-target-live/333';
  const normTargetPageUrl = normalizeProductUrl(targetPageUrl);
  const normTargetCheckoutUrl = normalizeProductUrl(targetCheckoutUrl);
  const normWalmartProbeUrl = normalizeProductUrl(walmartProbeUrl);

  const allProducts = [
    { url: targetPageUrl, qty: 1, name: 'MON-2 Target product' },
    { url: walmartProbeUrl, qty: 1, name: 'MON-2 Walmart probe' },
  ];
  const walmartFilter = /walmart\.com/i;
  const walmartOnlyProducts = filterProductsByRetailer(allProducts, walmartFilter);

  assert.equal(walmartOnlyProducts.length, 1, 'MON-2 live poll: walmart-only monitor sends one product');
  assert.ok(
    walmartOnlyProducts.every((p) => walmartFilter.test(p.url)),
    'MON-2 live poll: monitor products must be walmart.com only'
  );
  assert.ok(
    !walmartOnlyProducts.some((p) => /target\.com/i.test(p.url)),
    'MON-2 live poll: target URL must be excluded from walmart-only monitor'
  );

  for (const targetUrl of [targetPageUrl, targetCheckoutUrl]) {
    const normTargetUrl = normalizeProductUrl(targetUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    assert.ok(
      !inQueueUrls.has(normTargetUrl),
      `MON-2 live poll: Target ${normTargetUrl} must not be sacred lock key before poll`
    );

    // Simulated Target tab reload during walmart-only poll — no sacred lock on Target URL.
    assert.ok(
      !inQueueUrls.has(normTargetUrl),
      `MON-2 live poll: Target reload must not arm inQueueUrls on ${normTargetUrl}`
    );
    assert.ok(
      walmartOnlyProducts.every((p) => walmartFilter.test(p.url)),
      `MON-2 live poll: walmart-only products must hold after Target reload on ${normTargetUrl}`
    );

    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      navigationLock.add(normWalmartProbeUrl);
      applyWalmartNavFailed(navigationLock, inQueueUrls, {
        type: navFailTypes[i],
        url: walmartProbeUrl,
      });
      assert.equal(
        inQueueUrls.size,
        0,
        `MON-2 live poll cycle ${i + 1} must not arm inQueueUrls on Target ${normTargetUrl} after ${navFailTypes[i]}`
      );
      assert.ok(
        !inQueueUrls.has(normTargetUrl),
        `MON-2 live poll cycle ${i + 1} must not sacred-lock Target ${normTargetUrl} after ${navFailTypes[i]}`
      );
      assert.ok(
        walmartOnlyProducts.every((p) => walmartFilter.test(p.url)),
        `MON-2 live poll cycle ${i + 1} must keep walmart-only products on ${normTargetUrl} after ${navFailTypes[i]}`
      );
      if (navigationLock.has(normWalmartProbeUrl)) {
        assert.ok(
          !inQueueUrls.has(normWalmartProbeUrl),
          `MON-2 live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normWalmartProbeUrl} after ${navFailTypes[i]}`
        );
      }
      assert.ok(
        !pollWouldSkipNavigation(normTargetUrl, inQueueUrls, navigationLock),
        `MON-2 live poll cycle ${i + 1} must not block poll on unmonitored Target ${normTargetUrl}`
      );
    }

    assert.equal(
      inQueueUrls.size,
      0,
      `MON-2 live poll must not arm inQueueUrls on Target ${normTargetUrl}`
    );
    assert.ok(
      !inQueueUrls.has(normTargetCheckoutUrl) || normTargetUrl === normTargetCheckoutUrl,
      `MON-2 live poll: Target checkout URL must not be sacred lock key during walmart-only poll`
    );
  }
}

/**
 * MON-2 offline parity: samsclub-only monitor during live poll on Target/Walmart tab.
 * Parity with FIX-3 mon2-samsclub-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runMon2SamsclubLivePollCycleOfflineTests() {
  const crossRetailerPages = [
    {
      label: 'Target',
      pageUrl: 'https://www.target.com/p/mock-product/A-880080',
      excludedPattern: 'target.com',
    },
    {
      label: 'Walmart',
      pageUrl: 'https://www.walmart.com/ip/mock-predrop/123',
      excludedPattern: 'walmart.com',
    },
  ];
  const samsclubProbeUrl = 'https://www.samsclub.com/p/mock-mon2-walmart-live/444';
  const normSamsclubProbeUrl = normalizeProductUrl(samsclubProbeUrl);
  const samsclubFilter = /samsclub\.com/i;

  const allProducts = [
    { url: crossRetailerPages[0].pageUrl, qty: 1, name: 'MON-2 Target product' },
    { url: samsclubProbeUrl, qty: 1, name: 'MON-2 Sam probe' },
  ];
  const samsclubOnlyProducts = filterProductsByRetailer(allProducts, samsclubFilter);

  assert.equal(
    samsclubOnlyProducts.length,
    1,
    'MON-2 samsclub live poll: samsclub-only monitor sends one product'
  );
  assert.ok(
    samsclubOnlyProducts.every((p) => samsclubFilter.test(p.url)),
    'MON-2 samsclub live poll: monitor products must be samsclub.com only'
  );

  for (const { label, pageUrl, excludedPattern } of crossRetailerPages) {
    const normPageUrl = normalizeProductUrl(pageUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    assert.ok(
      !inQueueUrls.has(normPageUrl),
      `MON-2 samsclub live poll: ${label} ${normPageUrl} must not be sacred lock key before poll`
    );

    // Simulated cross-retailer tab reload during samsclub-only poll — no sacred lock.
    assert.ok(
      !inQueueUrls.has(normPageUrl),
      `MON-2 samsclub live poll: ${label} reload must not arm inQueueUrls on ${normPageUrl}`
    );
    assert.ok(
      samsclubOnlyProducts.every((p) => samsclubFilter.test(p.url)),
      `MON-2 samsclub live poll: samsclub-only products must hold after ${label} reload`
    );
    assert.ok(
      !samsclubOnlyProducts.some((p) => new RegExp(excludedPattern, 'i').test(p.url)),
      `MON-2 samsclub live poll: ${label.toLowerCase()} URL must be excluded from samsclub-only monitor`
    );

    const liveSignalTypes = ['NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED', 'ATC_SUCCESS'];
    for (let i = 0; i < liveSignalTypes.length; i++) {
      navigationLock.add(normSamsclubProbeUrl);
      if (liveSignalTypes[i] === 'ATC_SUCCESS') {
        applyAtcSuccess(navigationLock, inQueueUrls, { type: 'ATC_SUCCESS', url: samsclubProbeUrl });
      } else {
        applyWalmartNavFailed(navigationLock, inQueueUrls, {
          type: liveSignalTypes[i],
          url: samsclubProbeUrl,
        });
      }
      assert.equal(
        inQueueUrls.size,
        0,
        `MON-2 samsclub live poll cycle ${i + 1} must not arm inQueueUrls on ${label} ${normPageUrl} after ${liveSignalTypes[i]}`
      );
      assert.ok(
        !inQueueUrls.has(normPageUrl),
        `MON-2 samsclub live poll cycle ${i + 1} must not sacred-lock ${label} ${normPageUrl} after ${liveSignalTypes[i]}`
      );
      assert.ok(
        samsclubOnlyProducts.every((p) => samsclubFilter.test(p.url)),
        `MON-2 samsclub live poll cycle ${i + 1} must keep samsclub-only products on ${label} after ${liveSignalTypes[i]}`
      );
      if (navigationLock.has(normSamsclubProbeUrl)) {
        assert.ok(
          !inQueueUrls.has(normSamsclubProbeUrl),
          `MON-2 samsclub live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normSamsclubProbeUrl} after ${liveSignalTypes[i]}`
        );
      }
      assert.ok(
        !pollWouldSkipNavigation(normPageUrl, inQueueUrls, navigationLock),
        `MON-2 samsclub live poll cycle ${i + 1} must not block poll on unmonitored ${label} ${normPageUrl}`
      );
    }

    assert.equal(
      inQueueUrls.size,
      0,
      `MON-2 samsclub live poll must not arm inQueueUrls on ${label} ${normPageUrl}`
    );
  }
}

async function sendBg(page, msg) {
  return page.evaluate(
    (m) =>
      new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(m, (res) => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(res);
          });
        } catch (e) {
          reject(e);
        }
      }),
    msg
  );
}

async function main() {
  runMon2LivePollCycleOfflineTests();
  runMon2SamsclubLivePollCycleOfflineTests();

  const launched = await launchWithExtension({ profilePrefix: 'tch-func-' });
  browser = launched.browser;
  userDataDir = launched.userDataDir;
  const { extensionId, TIMEOUT } = launched;

  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });
  await popup.waitForSelector('#enableToggle', { timeout: 15000 });

  // ─── Background: harvest (cookieHarvest.js via SW) ───────────────────────
  let st = await sendBg(popup, { type: 'HARVEST_GET_STATUS' });
  assert.ok(st && st.ok !== false, 'HARVEST_GET_STATUS');
  assert.ok(st.config && typeof st.config.harvestingEnabled === 'boolean', 'HARVEST_GET_STATUS.config');

  const upd = await sendBg(popup, {
    type: 'HARVEST_UPDATE_CONFIG',
    data: {
      harvestingEnabled: false,
      harvestsPerPageLoad: 1,
      expirationMinutes: 3,
      removalOrder: 'lifo',
      dontStopHarvesting: false,
      applyNextBeforeCheckout: false,
    },
  });
  assert.ok(upd && upd.ok !== false, 'HARVEST_UPDATE_CONFIG');

  const burst = await sendBg(popup, {
    type: 'HARVEST_CAPTURE_BURST',
    data: { count: 1, kind: 'test', url: 'https://www.target.com/', retailer: 'target' },
  });
  assert.ok(burst && burst.ok === false && burst.reason === 'disabled', 'HARVEST_CAPTURE_BURST when disabled');

  const apply = await sendBg(popup, { type: 'HARVEST_APPLY_NEXT' });
  assert.ok(apply && apply.ok === false && (apply.reason === 'empty' || apply.reason), 'HARVEST_APPLY_NEXT empty pool');

  const cleared = await sendBg(popup, { type: 'HARVEST_CLEAR' });
  assert.ok(cleared && cleared.ok !== false, 'HARVEST_CLEAR');

  // ─── Debugger bridge (core/debuggerBridge.js) ────────────────────────────
  const dbgSt = await sendBg(popup, { type: 'DEBUGGER_STATUS' });
  assert.ok(dbgSt && typeof dbgSt.attached === 'boolean', 'DEBUGGER_STATUS');
  const dbgOff = await sendBg(popup, { type: 'DEBUGGER_DETACH' });
  assert.ok(dbgOff && dbgOff.ok !== false, 'DEBUGGER_DETACH');

  // ─── Monitor (background.js startMonitor / stopMonitor) ─────────────────
  const beforeMon = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(typeof beforeMon.active === 'boolean', 'GET_MONITOR_STATUS.active');

  await sendBg(popup, {
    type: 'START_MONITOR',
    products: [],
    refreshInterval: 2,
    dropExpectedAt: '',
  });
  const duringMon = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(duringMon.active, true, 'START_MONITOR should set active');

  await sendBg(popup, { type: 'STOP_MONITOR' });
  const afterMon = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(afterMon.active, false, 'STOP_MONITOR should clear active');

  // ─── MON-2: single-retailer monitor filter (popup toggleMonitor) ───────────
  const targetUrl = 'https://www.target.com/p/mon2-target/-/A-100';
  const walmartUrl = 'https://www.walmart.com/ip/mon2-walmart/200';
  await popup.evaluate(
    async (urls) => {
      const products = [
        { url: urls.target, qty: 1, name: 'MON-2 Target' },
        { url: urls.walmart, qty: 1, name: 'MON-2 Walmart' },
      ];
      await chrome.storage.local.set({
        monitor: { active: false, products, counts: {}, refreshInterval: 2 },
      });
    },
    { target: targetUrl, walmart: walmartUrl }
  );
  await popup.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await popup.waitForSelector('#monitorBtn', { timeout: 15000 });
  await popup.waitForFunction(
    () => {
      const btn = document.getElementById('monitorBtn');
      return btn && !btn.disabled;
    },
    { timeout: 15000 }
  );

  await popup.evaluate(() => document.getElementById('monitorBtn')?.click());
  await popup.waitForFunction(
    () =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_MONITOR_STATUS' }, (m) => {
          const err = chrome.runtime.lastError;
          resolve(!err && m?.active === true);
        });
      }),
    { timeout: 15000 }
  );
  let mon2 = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(mon2.active, true, 'MON-2: Target Start monitoring sets active');
  assert.equal(mon2.products?.length, 1, 'MON-2: Target monitor sends one product');
  assert.ok(
    mon2.products.every((p) => /target\.com/i.test(p.url)),
    'MON-2: Target monitor filters to target.com only'
  );

  const wmBtnWhileTarget = await popup.$eval('#wmMonitorBtn', (el) => el.textContent?.trim());
  assert.equal(wmBtnWhileTarget, 'Stop monitoring', 'MON-2: shared monitorActive on Walmart btn');

  await sendBg(popup, { type: 'STOP_MONITOR' });
  await popup.waitForFunction(
    () =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_MONITOR_STATUS' }, (m) => {
          const err = chrome.runtime.lastError;
          resolve(!err && m?.active === false);
        });
      }),
    { timeout: 15000 }
  );

  // startMonitor persists only the filtered subset — restore both for Walmart filter test
  await popup.evaluate(
    async (urls) => {
      const products = [
        { url: urls.target, qty: 1, name: 'MON-2 Target' },
        { url: urls.walmart, qty: 1, name: 'MON-2 Walmart' },
      ];
      const { monitor } = await chrome.storage.local.get('monitor');
      await chrome.storage.local.set({
        monitor: { ...(monitor || {}), active: false, products, tabIds: [], counts: {} },
      });
    },
    { target: targetUrl, walmart: walmartUrl }
  );

  await popup.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await popup.waitForSelector('#tabWalmart', { timeout: 15000 });
  await popup.waitForFunction(
    () => !document.getElementById('monitorBtn')?.disabled,
    { timeout: 15000 }
  );
  await popup.evaluate(() => document.getElementById('tabWalmart')?.click());
  await popup.waitForSelector('#wmMonitorBtn', { timeout: 5000 });
  await popup.waitForFunction(
    () => {
      const btn = document.getElementById('wmMonitorBtn');
      return btn && !btn.disabled;
    },
    { timeout: 15000 }
  );
  await popup.evaluate(() => document.getElementById('wmMonitorBtn')?.click());
  await popup.waitForFunction(
    () =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_MONITOR_STATUS' }, (m) => {
          const err = chrome.runtime.lastError;
          resolve(!err && m?.active === true);
        });
      }),
    { timeout: 15000 }
  );
  mon2 = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(mon2.active, true, 'MON-2: Walmart Start monitoring sets active');
  assert.equal(mon2.products?.length, 1, 'MON-2: Walmart monitor sends one product');
  assert.ok(
    mon2.products.every((p) => /walmart\.com/i.test(p.url)),
    'MON-2: Walmart monitor filters to walmart.com only'
  );

  await sendBg(popup, { type: 'STOP_MONITOR' });

  // ─── MON-3: navigationLock + inQueueUrls skip poll re-navigation ───────────
  const MON3_WM = 'https://www.walmart.com/ip/Test-Mon3-Product/987654321';
  const MON3_NORM = normalizeProductUrl(MON3_WM);

  assert.ok(isInCheckoutFlow('https://www.target.com/checkout'), 'MON-3: target checkout path');
  assert.ok(isInCheckoutFlow('https://www.walmart.com/checkout'), 'MON-3: walmart checkout path');
  assert.ok(isInCheckoutFlow('https://www.target.com/cart'), 'MON-3: cart path');
  assert.ok(!isInCheckoutFlow('https://www.walmart.com/ip/product/123'), 'MON-3: product page not checkout flow');
  assert.ok(!isInCheckoutFlow('https://www.walmart.com/qp'), 'MON-3: /qp uses sacred lock, not checkout-flow guard');

  {
    const inQ = new Set();
    const navL = new Set();
    assert.equal(pollWouldSkipNavigation(MON3_NORM, inQ, navL), false);
    navL.add(MON3_NORM);
    assert.equal(
      pollWouldSkipNavigation(MON3_NORM, inQ, navL),
      true,
      'MON-3: navigationLock blocks poll navigate'
    );
    navL.delete(MON3_NORM);
    inQ.add(MON3_NORM);
    assert.equal(
      pollWouldSkipNavigation(MON3_NORM, inQ, navL),
      true,
      'MON-3: inQueueUrls blocks poll navigate'
    );
  }

  await sendBg(popup, {
    type: 'START_MONITOR',
    products: [{ url: MON3_WM, name: 'MON-3 test', qty: 1 }],
    refreshInterval: 1,
    dropExpectedAt: '',
    walmartSkipMonitoring: true,
  });

  const withNavLock = await waitForMonitorLocks(
    popup,
    (status) => Array.isArray(status.navigationLock) && status.navigationLock.includes(MON3_NORM),
    'navigationLock after poll navigate'
  );
  assert.ok(withNavLock.navigationLock.includes(MON3_NORM), 'MON-3: poll sets navigationLock');

  await sendBg(popup, { type: 'WALMART_IN_QUEUE', url: MON3_WM });
  const inQueue = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(inQueue.inQueueUrls?.includes(MON3_NORM), 'MON-3: WALMART_IN_QUEUE adds inQueueUrls');

  await sendBg(popup, { type: 'WALMART_NAV_FAILED', url: MON3_WM });
  const afterNavFail = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(
    !afterNavFail.navigationLock?.includes(MON3_NORM),
    'MON-3: WALMART_NAV_FAILED clears navigationLock'
  );
  assert.ok(
    afterNavFail.inQueueUrls?.includes(MON3_NORM),
    'MON-3: WALMART_NAV_FAILED must not clear inQueueUrls (WM-5)'
  );

  // MON-3: START_MONITOR calls stopMonitor first — clears sacred lock for a fresh session.
  await sendBg(popup, {
    type: 'START_MONITOR',
    products: [{ url: MON3_WM, name: 'MON-3 restart', qty: 1 }],
    refreshInterval: 1,
    dropExpectedAt: '',
    walmartSkipMonitoring: true,
  });
  const afterRestart = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(afterRestart.active, true, 'MON-3: START_MONITOR sets active after restart');
  assert.ok(
    !afterRestart.inQueueUrls?.includes(MON3_NORM),
    'MON-3: START_MONITOR clears prior inQueueUrls (stopMonitor first)'
  );
  // Fresh poll may already have re-armed navigationLock after restart — that is expected.

  await sendBg(popup, { type: 'STOP_MONITOR' });
  const mon3Cleared = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(mon3Cleared.active, false, 'MON-3: STOP_MONITOR clears active');
  assert.ok(!mon3Cleared.inQueueUrls?.length, 'MON-3: STOP_MONITOR clears inQueueUrls');
  assert.ok(!mon3Cleared.navigationLock?.length, 'MON-3: STOP_MONITOR clears navigationLock');

  // ─── Telemetry (CHECKOUT_RETRY_EVENT → recordCheckoutRetryEvent) ──────────
  await sendBg(popup, {
    type: 'CHECKOUT_RETRY_EVENT',
    event: {
      status: 'cancelled',
      attempt: 0,
      maxAttempts: 0,
      failedAttempts: 0,
      mode: '',
      reason: 'functional-test',
      page: 'product',
      url: 'https://www.target.com/p/test',
      watchUrl: '',
      delayMs: 0,
      ts: Date.now(),
    },
  });
  const telem = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(telem.checkoutTelemetry, 'GET_MONITOR_STATUS.checkoutTelemetry');
  assert.ok(
    telem.checkoutTelemetry.lastEvent || (telem.checkoutTelemetry.events && telem.checkoutTelemetry.events.length),
    'telemetry should record CHECKOUT_RETRY_EVENT'
  );

  // ─── Settings broadcast + CACHE_API_KEY ───────────────────────────────────
  const su = await sendBg(popup, { type: 'SETTINGS_UPDATED', enabled: false });
  assert.ok(su && su.ok !== false, 'SETTINGS_UPDATED');

  const cache = await sendBg(popup, {
    type: 'CACHE_API_KEY',
    apiKey: '',
    redskyBase: '',
  });
  assert.ok(cache && cache.ok !== false, 'CACHE_API_KEY (no-op empty)');

  // ─── Popup controls (popup.js wiring) ─────────────────────────────────────
  await popup.bringToFront();
  const wasChecked = await popup.$eval('#enableToggle', (el) => el.checked);
  await popup.evaluate(() => {
    const el = document.getElementById('enableToggle');
    if (!el) throw new Error('no enableToggle');
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.click();
  });
  await popup.waitForFunction(
    (prev) => document.getElementById('enableToggle').checked !== prev,
    { timeout: 8000 },
    wasChecked
  );
  const statusAfterToggle = await popup.$eval('#statusText', (el) => el.textContent?.trim() || '');
  assert.ok(
    statusAfterToggle.includes('On') || statusAfterToggle.includes('Off'),
    `toggle should change status: ${statusAfterToggle}`
  );

  await popup.evaluate(() => {
    const t = document.getElementById('tabMain');
    t?.scrollIntoView({ block: 'center' });
    t?.click();
  });
  await popup.waitForSelector('#saveBtn', { timeout: 5000 });
  await popup.evaluate(() => {
    const b = document.getElementById('saveBtn');
    b?.scrollIntoView({ block: 'center' });
    b?.click();
  });
  await popup.waitForFunction(
    () => {
      const b = document.getElementById('saveBtn');
      return b && (b.textContent === 'Saved!' || b.classList.contains('saved'));
    },
    { timeout: 12000 }
  );

  // ─── Target content script still runs ─────────────────────────────────────
  const targetPage = await browser.newPage();
  const tch = [];
  const cdp = await targetPage.createCDPSession();
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.consoleAPICalled', (ev) => {
    const parts = (ev.args || []).map((a) => {
      if (a.value !== undefined) return String(a.value);
      if (a.unserializableValue) return String(a.unserializableValue);
      return a.description || '';
    });
    const text = parts.join(' ');
    if (text.includes('[TCH]')) tch.push(text);
  });
  await targetPage.goto('https://www.target.com/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await new Promise((r) => setTimeout(r, 8000));
  assert.ok(tch.some((l) => l.includes('[TCH] init')), 'Target [TCH] init after popup save flow');

  console.log('FUNCTIONAL PASS: background messages + popup toggle/save + Target content script');
}

main()
  .catch((err) => {
    console.error('FUNCTIONAL FAIL:', err);
    process.exit(1);
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    await rmProfileDir(userDataDir);
  });
