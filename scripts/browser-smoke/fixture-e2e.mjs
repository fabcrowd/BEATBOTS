#!/usr/bin/env node
/**
 * FIX-2: Extension content scripts initialize on offline fixture pages served at
 * retailer hostnames (local HTTP + Chrome host-resolver-rules).
 * FIX-3: Per-route journey invariant assertions (sacred lock, manual review).
 *
 * Run: node scripts/browser-smoke/fixture-e2e.mjs
 */
import assert from 'node:assert/strict';
import { launchWithExtension, rmProfileDir } from './launch-util.mjs';
import {
  FIXTURE_E2E_ROUTES,
  hostResolverRules,
  startFixtureServer,
} from './fixture-server.mjs';

let browser;
let userDataDir;
let fixtureServer;

function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Mirrors background.js poll loop skip checks (inQueueUrls before navigationLock). */
function pollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock) {
  if (inQueueUrls.has(normUrl)) return true;
  if (navigationLock.has(normUrl)) return true;
  return false;
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

/** Fire-and-forget bg message (e.g. ATC_SUCCESS from popup — async handler, no tab id). */
async function sendBgFireAndForget(page, msg) {
  await page.evaluate((m) => {
    try {
      chrome.runtime.sendMessage(m);
    } catch (_) {}
  }, msg);
  await new Promise((r) => setTimeout(r, 150));
}

async function setStorage(popup, data) {
  await popup.evaluate(
    (d) =>
      new Promise((resolve, reject) => {
        try {
          chrome.storage.local.set(d, () => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve();
          });
        } catch (e) {
          reject(e);
        }
      }),
    data
  );
}

async function resetQueueState(popup) {
  await sendBg(popup, { type: 'STOP_MONITOR' }).catch(() => {});
  await setStorage(popup, {
    monitor: { active: false, products: [], tabIds: [], counts: {} },
  });
}

const FIXTURE_STORAGE_BASE = {
  enabled: true,
  walmartUseSavedSession: true,
  checkoutSound: false,
  autoPlaceOrder: false,
  shipping: {
    firstName: 'Fixture',
    lastName: 'Test',
    address1: '1 Test St',
    city: 'City',
    state: 'CA',
    zip: '90210',
  },
};

async function applyRouteStorage(popup, route, port) {
  await resetQueueState(popup);

  if (!route.invariants?.length) {
    await setStorage(popup, { enabled: true, walmartUseSavedSession: true });
    return `http://${route.host}:${port}${route.path}`;
  }

  const pageUrl = `http://${route.host}:${port}${route.path}`;
  const data = { ...FIXTURE_STORAGE_BASE };

  const productPath = route.monitorProductPath || route.sacredLockProductPath;
  if (productPath) {
    const productUrl = `http://${route.host}:${port}${productPath}`;
    data.monitor = {
      active: true,
      products: [
        {
          url: productUrl,
          qty: route.monitorQty || 1,
          name: `Fixture ${route.journey}`,
          oid: null,
        },
      ],
    };
  }

  if (route.walmartMaxPrice > 0) {
    data.walmartMaxPrice = route.walmartMaxPrice;
  }

  await setStorage(popup, data);
  return pageUrl;
}

async function attachCdpConsoleCapture(page) {
  const logs = [];
  const cdp = await page.createCDPSession();
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.consoleAPICalled', (ev) => {
    const parts = (ev.args || []).map((a) => {
      if (a.value !== undefined) return String(a.value);
      if (a.unserializableValue) return String(a.unserializableValue);
      return a.description || '';
    });
    const text = parts.join(' ');
    if (text.includes('[TCH]') || text.includes('[WMT]') || text.includes('[SC]')) {
      logs.push(text);
    }
  });
  return logs;
}

async function assertRouteInvariants(popup, route, logs, page, port) {
  const invariants = route.invariants || [];
  if (!invariants.length) return;

  const status = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  const inQueue = status?.inQueueUrls || [];
  const pageUrl = `http://${route.host}:${port}${route.path}`;
  const normPageUrl = normalizeProductUrl(pageUrl);

  if (invariants.includes('no-sacred-lock')) {
    assert.equal(
      inQueue.length,
      0,
      `FIX-3 ${route.journey}: pre-drop/FCFS must not arm sacred lock on ${pageUrl}, got inQueueUrls=${JSON.stringify(inQueue)}`
    );
    assert.ok(
      !logs.some((l) => l.includes('Product-page queue detected')),
      `FIX-3 ${route.journey}: must not enter product-page queue wait on ${pageUrl}`
    );
  }

  if (invariants.includes('sacred-lock')) {
    assert.ok(
      inQueue.some((u) => normalizeProductUrl(u) === normPageUrl),
      `FIX-3 ${route.journey}: expected sacred lock for ${normPageUrl}, got inQueueUrls=${JSON.stringify(inQueue)}`
    );
    assert.ok(
      logs.some((l) => l.includes('Product-page queue detected')),
      `FIX-3 ${route.journey}: expected product-page queue log on ${pageUrl}`
    );
  }

  if (invariants.includes('sacred-lock-qp')) {
    const productUrl = `http://${route.host}:${port}${route.sacredLockProductPath}`;
    const normProductUrl = normalizeProductUrl(productUrl);
    assert.ok(
      inQueue.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 ${route.journey}: /qp must sacred-lock product ${normProductUrl}, got inQueueUrls=${JSON.stringify(inQueue)}`
    );
    assert.ok(
      !inQueue.some((u) => normalizeProductUrl(u) === normPageUrl),
      `FIX-3 ${route.journey}: /qp page URL must not be the sacred lock key`
    );
    assert.ok(
      logs.some((l) => l.includes('/qp waiting room detected')),
      `FIX-3 ${route.journey}: expected /qp waiting room log on ${pageUrl}`
    );
    assert.ok(
      !logs.some((l) => l.includes('no productUrl in settings')),
      `FIX-3 ${route.journey}: monitored /qp must not warn about missing productUrl`
    );
  }

  if (invariants.includes('wm4-qp-no-producturl')) {
    assert.ok(
      logs.some((l) => l.includes('no productUrl in settings')),
      `FIX-3 WM-4: /qp without monitor must warn about missing productUrl on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    assert.ok(
      logs.some((l) => l.includes('/qp waiting room detected')),
      `FIX-3 WM-4: expected /qp waiting room log on ${pageUrl}`
    );
  }

  if (invariants.includes('wm4-checkout-no-producturl')) {
    assert.ok(
      logs.some((l) => l.includes('no productUrl in settings')),
      `FIX-3 WM-4: /checkout without monitor must warn about missing productUrl on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    assert.ok(
      logs.some((l) => l.includes('Queue detected')),
      `FIX-3 WM-4: expected checkout queue log on ${pageUrl}`
    );
  }

  if (invariants.includes('wm4-qp-timeout-no-producturl')) {
    assert.ok(
      logs.some((l) => l.includes('no productUrl in settings')),
      `FIX-3 WM-6: /qp timeout without monitor must warn missing productUrl on ${pageUrl}`
    );
    assert.ok(
      logs.some((l) => l.includes('/qp waiting room timeout') && l.includes('no productUrl')),
      `FIX-3 WM-6: /qp timeout must log no-productUrl NAV_FAILED path on ${pageUrl}, got: ${logs.slice(-10).join(' | ') || '(none)'}`
    );
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    assert.equal(
      (after?.inQueueUrls || []).length,
      0,
      `FIX-3 WM-6: /qp timeout without productUrl must not arm inQueueUrls on ${pageUrl}`
    );
  }

  if (invariants.includes('wm4-checkout-timeout-no-producturl')) {
    assert.ok(
      logs.some((l) => l.includes('no productUrl in settings')),
      `FIX-3 WM-6: checkout queue timeout without monitor must warn missing productUrl on ${pageUrl}`
    );
    assert.ok(
      logs.some((l) => l.includes('Queue timeout') && l.includes('no productUrl')),
      `FIX-3 WM-6: checkout queue timeout must log no-productUrl NAV_FAILED path on ${pageUrl}, got: ${logs.slice(-10).join(' | ') || '(none)'}`
    );
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    assert.equal(
      (after?.inQueueUrls || []).length,
      0,
      `FIX-3 WM-6: checkout queue timeout without productUrl must not arm inQueueUrls on ${pageUrl}`
    );
  }

  if (invariants.includes('wm4-qp-timeout-with-producturl')) {
    const productUrl = `http://${route.host}:${port}${route.sacredLockProductPath}`;
    const normProductUrl = normalizeProductUrl(productUrl);
    assert.ok(
      logs.some((l) => l.includes('/qp waiting room detected')),
      `FIX-3 WM-5: monitored /qp timeout must enter waiting room on ${pageUrl}`
    );
    assert.ok(
      !logs.some((l) => l.includes('no productUrl in settings')),
      `FIX-3 WM-5: monitored /qp timeout must not warn missing productUrl on ${pageUrl}`
    );
    assert.ok(
      logs.some((l) => l.includes('/qp waiting room timeout')),
      `FIX-3 WM-5: monitored /qp timeout must log timeout on ${pageUrl}, got: ${logs.slice(-10).join(' | ') || '(none)'}`
    );
    assert.ok(
      !logs.some((l) => l.includes('/qp waiting room timeout') && l.includes('no productUrl')),
      `FIX-3 WM-5: monitored /qp timeout must use QUEUE_TIMEOUT path (not NAV_FAILED) on ${pageUrl}`
    );
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = after?.inQueueUrls || [];
    const afterNavLock = after?.navigationLock || [];
    assert.equal(
      afterInQueue.length,
      0,
      `FIX-3 WM-5: monitored /qp timeout must clear inQueueUrls on ${pageUrl}, got ${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 WM-5: monitored /qp timeout must clear navigationLock for ${normProductUrl}, got ${JSON.stringify(afterNavLock)}`
    );
  }

  if (invariants.includes('wm5-product-queue-timeout')) {
    const productUrl = `http://${route.host}:${port}${route.monitorProductPath || route.path}`;
    const normProductUrl = normalizeProductUrl(productUrl);
    assert.ok(
      logs.some((l) => l.includes('Product-page queue detected')),
      `FIX-3 WM-5: product-page queue timeout must enter queue wait on ${pageUrl}`
    );
    assert.ok(
      logs.some((l) => l.includes('Product-page queue wait timed out')),
      `FIX-3 WM-5: product-page queue timeout must log timeout on ${pageUrl}, got: ${logs.slice(-10).join(' | ') || '(none)'}`
    );
    assert.ok(
      !logs.some((l) => l.includes('Queue timeout') && l.includes('no productUrl')),
      `FIX-3 WM-5: product-page queue timeout must use QUEUE_TIMEOUT path (not NAV_FAILED) on ${pageUrl}`
    );
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = after?.inQueueUrls || [];
    const afterNavLock = after?.navigationLock || [];
    assert.equal(
      afterInQueue.length,
      0,
      `FIX-3 WM-5: product-page queue timeout must clear inQueueUrls on ${pageUrl}, got ${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 WM-5: product-page queue timeout must clear navigationLock for ${normProductUrl}, got ${JSON.stringify(afterNavLock)}`
    );
  }

  if (invariants.includes('wm4-checkout-timeout-with-producturl')) {
    const productUrl = `http://${route.host}:${port}${route.sacredLockProductPath}`;
    const normProductUrl = normalizeProductUrl(productUrl);
    assert.ok(
      logs.some((l) => l.includes('Queue detected')),
      `FIX-3 WM-5: monitored checkout timeout must enter queue wait on ${pageUrl}`
    );
    assert.ok(
      !logs.some((l) => l.includes('no productUrl in settings')),
      `FIX-3 WM-5: monitored checkout timeout must not warn missing productUrl on ${pageUrl}`
    );
    assert.ok(
      logs.some((l) => l.includes('Queue wait timed out')),
      `FIX-3 WM-5: monitored checkout timeout must log timeout on ${pageUrl}, got: ${logs.slice(-10).join(' | ') || '(none)'}`
    );
    assert.ok(
      !logs.some((l) => l.includes('Queue timeout') && l.includes('no productUrl')),
      `FIX-3 WM-5: monitored checkout timeout must use QUEUE_TIMEOUT path (not NAV_FAILED) on ${pageUrl}`
    );
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = after?.inQueueUrls || [];
    const afterNavLock = after?.navigationLock || [];
    assert.equal(
      afterInQueue.length,
      0,
      `FIX-3 WM-5: monitored checkout timeout must clear inQueueUrls on ${pageUrl}, got ${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 WM-5: monitored checkout timeout must clear navigationLock for ${normProductUrl}, got ${JSON.stringify(afterNavLock)}`
    );
  }

  if (invariants.includes('wm5-queue-timeout-clears-sacred-lock')) {
    const lockPath =
      route.monitorProductPath && route.path === route.monitorProductPath
        ? route.monitorProductPath
        : route.sacredLockProductPath;
    const productUrl = `http://${route.host}:${port}${lockPath}`;
    const normProductUrl = normalizeProductUrl(productUrl);
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = after?.inQueueUrls || [];
    const afterNavLock = after?.navigationLock || [];
    assert.equal(
      afterInQueue.length,
      0,
      `FIX-3 WM-5: QUEUE_TIMEOUT must release sacred lock on ${pageUrl}, got inQueueUrls=${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 WM-5: QUEUE_TIMEOUT must clear navigationLock for ${normProductUrl}, got ${JSON.stringify(afterNavLock)}`
    );
    const pollAfter = pollWouldSkipNavigation(
      normProductUrl,
      new Set(afterInQueue.map(normalizeProductUrl)),
      new Set(afterNavLock.map(normalizeProductUrl))
    );
    assert.equal(
      pollAfter,
      false,
      `FIX-3 WM-5: background poll must be able to re-navigate after QUEUE_TIMEOUT on ${normProductUrl}`
    );
  }

  if (invariants.includes('wm6-price-guard-timeout')) {
    assert.ok(
      logs.some((l) => l.includes('Price guard') && l.includes('no sacred lock')),
      `FIX-3 WM-6: price-guard must log no-sacred-lock wait on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    assert.ok(
      logs.some((l) => l.includes('Price guard wait timed out')),
      `FIX-3 WM-6: price-guard timeout must log timed out on ${pageUrl}, got: ${logs.slice(-10).join(' | ') || '(none)'}`
    );
    assert.ok(
      !logs.some((l) => l.includes('Product-page queue detected')),
      `FIX-3 WM-6: price-guard timeout must not enter product-page queue wait on ${pageUrl}`
    );
    const productUrl = route.monitorProductPath
      ? `http://${route.host}:${port}${route.monitorProductPath}`
      : pageUrl;
    const normProductUrl = normalizeProductUrl(productUrl);
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = after?.inQueueUrls || [];
    const afterNavLock = after?.navigationLock || [];
    assert.equal(
      afterInQueue.length,
      0,
      `FIX-3 WM-6: price-guard timeout must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 WM-6: price-guard timeout must clear navigationLock for ${normProductUrl}, got ${JSON.stringify(afterNavLock)}`
    );
  }

  if (invariants.includes('wm6-checkout-spa-timeout')) {
    assert.ok(
      logs.some((l) => l.includes('wmHandleCheckout timed out')),
      `FIX-3 WM-6: checkout SPA timeout must log timed out on ${pageUrl}, got: ${logs.slice(-10).join(' | ') || '(none)'}`
    );
    assert.ok(
      logs.some((l) => l.includes('releasing navigation lock')),
      `FIX-3 WM-6: checkout SPA timeout must log NAV_FAILED release on ${pageUrl}, got: ${logs.slice(-10).join(' | ') || '(none)'}`
    );
    const productUrl = route.monitorProductPath
      ? `http://${route.host}:${port}${route.monitorProductPath}`
      : pageUrl;
    const normProductUrl = normalizeProductUrl(productUrl);
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = after?.inQueueUrls || [];
    const afterNavLock = after?.navigationLock || [];
    assert.equal(
      afterInQueue.length,
      0,
      `FIX-3 WM-6: checkout SPA timeout must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 WM-6: checkout SPA timeout must clear navigationLock for ${normProductUrl}, got ${JSON.stringify(afterNavLock)}`
    );
  }

  if (invariants.includes('sacred-lock-checkout')) {
    const productUrl = `http://${route.host}:${port}${route.sacredLockProductPath}`;
    const normProductUrl = normalizeProductUrl(productUrl);
    assert.ok(
      inQueue.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 ${route.journey}: expected sacred lock on product ${normProductUrl}, got inQueueUrls=${JSON.stringify(inQueue)}`
    );
    assert.ok(
      !inQueue.some((u) => normalizeProductUrl(u) === normPageUrl),
      `FIX-3 ${route.journey}: checkout URL must not be the sacred lock key`
    );
    assert.ok(
      logs.some((l) => l.includes('Queue detected')),
      `FIX-3 ${route.journey}: expected checkout queue log on ${pageUrl}`
    );
  }

  if (invariants.includes('tgt4-manual-review')) {
    assert.ok(
      logs.some((l) => l.includes('[TCH] review reached')),
      `FIX-3 TGT-4: expected review reached on ${pageUrl}, got: ${logs.slice(0, 8).join(' | ') || '(none)'}`
    );
    assert.ok(
      !logs.some((l) => l.includes('autoPlaceOrder: clicking Place Order')),
      `FIX-3 TGT-4: must not auto-click Place Order when autoPlaceOrder is off`
    );
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('[data-test="placeOrderButton"]');
      return btn?.dataset?.tchFixtureClicked === '1';
    });
    assert.equal(clicked, false, 'FIX-3 TGT-4: Place Order button must remain unclicked');
  }

  if (invariants.includes('wm6-cart-checkout-missing')) {
    assert.ok(
      logs.some((l) => l.includes('Checkout button not found')),
      `FIX-3 WM-6: expected cart checkout-missing log on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    assert.ok(
      logs.some((l) => l.includes('releasing navigation lock')),
      `FIX-3 WM-6: expected NAV_FAILED release log on cart ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    const productUrl = route.monitorProductPath
      ? `http://${route.host}:${port}${route.monitorProductPath}`
      : pageUrl;
    const normProductUrl = normalizeProductUrl(productUrl);
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = after?.inQueueUrls || [];
    const afterNavLock = after?.navigationLock || [];
    assert.equal(
      afterInQueue.length,
      0,
      `FIX-3 WM-6: cart checkout-missing must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 WM-6: cart checkout-missing must clear navigationLock for ${normProductUrl}, got ${JSON.stringify(afterNavLock)}`
    );
  }

  if (invariants.includes('wm6-cart-live-poll-cycle')) {
    const monitorUrl = route.monitorProductPath
      ? `http://${route.host}:${port}${route.monitorProductPath}`
      : pageUrl;
    const normMonitorUrl = normalizeProductUrl(monitorUrl);

    // Live background poll: cart checkout-missing NAV_FAILED must never arm sacred lock.
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: monitorUrl, name: `Fixture WM-6 cart ${route.journey}`, qty: 1 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });
    await new Promise((r) => setTimeout(r, 800));
    // Reload cart tab during live poll — re-init must re-detect missing checkout without sacred lock.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 9500));
    const afterReload = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const reloadInQueue = afterReload?.inQueueUrls || [];
    assert.equal(
      reloadInQueue.length,
      0,
      `FIX-3 WM-6: cart reload during live poll must not arm inQueueUrls on ${normMonitorUrl}, got ${JSON.stringify(reloadInQueue)}`
    );
    assert.ok(
      logs.filter((l) => l.includes('Checkout button not found')).length >= 2,
      `FIX-3 WM-6: cart reload must re-trigger checkout-missing on ${pageUrl}, got: ${logs.slice(-10).join(' | ') || '(none)'}`
    );
    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      await sendBg(popup, { type: navFailTypes[i], url: monitorUrl });
      await new Promise((r) => setTimeout(r, 650));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 WM-6: cart live poll cycle ${i + 1} must not arm inQueueUrls on ${normMonitorUrl} after ${navFailTypes[i]}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      if (cycleNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
        assert.ok(
          !cycleInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
          `FIX-3 WM-6: cart live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normMonitorUrl} after ${navFailTypes[i]}`
        );
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
    const afterPollWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const liveInQueue = afterPollWait?.inQueueUrls || [];
    const liveNavLock = afterPollWait?.navigationLock || [];
    assert.equal(
      liveInQueue.length,
      0,
      `FIX-3 WM-6: cart live poll must not arm inQueueUrls on ${normMonitorUrl}, got inQueueUrls=${JSON.stringify(liveInQueue)}`
    );
    if (liveNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
      assert.ok(
        !liveInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
        `FIX-3 WM-6: cart navigationLock alone must not imply sacred lock on ${normMonitorUrl}`
      );
    }
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  if (invariants.includes('nav-failed-releases-lock')) {
    const releasingLog = route.host.includes('samsclub')
      ? logs.some((l) => l.includes('releasing nav lock'))
      : logs.some((l) => l.includes('releasing navigation lock'));
    assert.ok(
      releasingLog,
      `FIX-3 ${route.journey}: expected NAV_FAILED release log on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = after?.inQueueUrls || [];
    const afterNavLock = after?.navigationLock || [];
    assert.equal(
      afterInQueue.length,
      0,
      `FIX-3 ${route.journey}: NAV_FAILED must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normPageUrl),
      `FIX-3 ${route.journey}: NAV_FAILED must clear navigationLock for ${normPageUrl}, got ${JSON.stringify(afterNavLock)}`
    );

    // SC-6 / WM-2: repeated NAV_FAILED cycles must never arm sacred lock.
    if (invariants.includes('sc6-repeated-nav-failed') || invariants.includes('wm2-repeated-nav-failed')) {
      for (let i = 0; i < 2; i++) {
        await sendBg(popup, { type: 'NAV_FAILED', url: pageUrl });
        const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
        const cycleInQueue = cycle?.inQueueUrls || [];
        const cycleNavLock = cycle?.navigationLock || [];
        assert.equal(
          cycleInQueue.length,
          0,
          `FIX-3 ${route.journey}: repeated NAV_FAILED cycle ${i + 2} must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(cycleInQueue)}`
        );
        assert.ok(
          !cycleNavLock.some((u) => normalizeProductUrl(u) === normPageUrl),
          `FIX-3 ${route.journey}: repeated NAV_FAILED cycle ${i + 2} must clear navigationLock for ${normPageUrl}, got ${JSON.stringify(cycleNavLock)}`
        );
      }
    }
  }

  // WM-6: product page with no ATC element must emit NAV_FAILED (not sacred lock).
  if (invariants.includes('wm6-missing-atc-element')) {
    assert.ok(
      logs.some((l) => l.includes('ATC button not found or disabled')),
      `FIX-3 WM-6: missing ATC element must time out to NAV_FAILED on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    assert.ok(
      !logs.some((l) => l.includes('Clicking ATC button')),
      `FIX-3 WM-6: missing ATC element must not click on ${pageUrl}`
    );
    assert.ok(
      !logs.some((l) => l.includes('Product-page queue detected')),
      `FIX-3 WM-6: missing ATC element must not enter product-page queue wait on ${pageUrl}`
    );
  }

  // SC-6: invisible enabled ATC must emit NAV_FAILED (not sacred lock).
  if (invariants.includes('sc6-invisible-atc')) {
    assert.ok(
      logs.some((l) => l.includes('ATC button not found or disabled')),
      `FIX-3 SC-6: invisible ATC must time out to NAV_FAILED on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    assert.ok(
      !logs.some((l) => l.includes('Clicking ATC button')),
      `FIX-3 SC-6: invisible ATC must not click on ${pageUrl}`
    );
  }

  // SC-5: repeated ATC_SUCCESS cycles must never arm sacred lock (FCFS race).
  if (invariants.includes('sc5-repeated-atc-success')) {
    if (!invariants.includes('sc6-repeated-nav-failed')) {
      assert.ok(
        logs.some((l) => l.includes('Clicking ATC button')),
        `FIX-3 SC-5: expected FCFS ATC click on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
      );
    }
    for (let i = 0; i < 3; i++) {
      await sendBgFireAndForget(popup, { type: 'ATC_SUCCESS', url: pageUrl });
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 SC-5: repeated ATC_SUCCESS cycle ${i + 1} must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(cycleInQueue)}`
      );
      assert.ok(
        !cycleNavLock.some((u) => normalizeProductUrl(u) === normPageUrl),
        `FIX-3 SC-5: ATC_SUCCESS cycle ${i + 1} must clear navigationLock for ${normPageUrl}, got ${JSON.stringify(cycleNavLock)}`
      );
    }
  }

  if (invariants.includes('wm5-sacred-survives-nav-failed')) {
    const lockUrl = route.sacredLockProductPath
      ? `http://${route.host}:${port}${route.sacredLockProductPath}`
      : pageUrl;
    const normLockUrl = normalizeProductUrl(lockUrl);
    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      await sendBg(popup, { type: navFailTypes[i], url: pageUrl });
      const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const afterInQueue = after?.inQueueUrls || [];
      const afterNavLock = after?.navigationLock || [];
      assert.ok(
        afterInQueue.some((u) => normalizeProductUrl(u) === normLockUrl),
        `FIX-3 WM-5: sacred lock must survive ${navFailTypes[i]} cycle ${i + 1} on ${normLockUrl}, got inQueueUrls=${JSON.stringify(afterInQueue)}`
      );
      assert.ok(
        !afterNavLock.some((u) => normalizeProductUrl(u) === normLockUrl),
        `FIX-3 WM-5: ${navFailTypes[i]} cycle ${i + 1} must clear navigationLock on ${normLockUrl}, got ${JSON.stringify(afterNavLock)}`
      );
    }

    const pollSkipStatus = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const pollInQ = new Set(pollSkipStatus?.inQueueUrls || []);
    const pollNavL = new Set(pollSkipStatus?.navigationLock || []);
    assert.equal(
      pollWouldSkipNavigation(normLockUrl, pollInQ, pollNavL),
      true,
      `FIX-3 WM-5: poll must skip navigate while sacred lock holds on ${normLockUrl}`
    );
  }

  if (invariants.includes('wm5-live-poll-cycle')) {
    const lockUrl = route.sacredLockProductPath
      ? `http://${route.host}:${port}${route.sacredLockProductPath}`
      : pageUrl;
    const normLockUrl = normalizeProductUrl(lockUrl);

    // Live background poll: sacred lock must survive real poll cycles without re-arming navigationLock.
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: lockUrl, name: `Fixture WM-5 ${route.journey}`, qty: 1 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });
    await sendBg(popup, { type: 'WALMART_IN_QUEUE', url: lockUrl });
    const shouldReloadDuringPoll =
      !route.sacredLockProductPath ||
      route.path.includes('/qp/') ||
      route.path === '/checkout' ||
      route.path.startsWith('/checkout/');
    if (shouldReloadDuringPoll) {
      await new Promise((r) => setTimeout(r, 800));
      // Reload sacred-lock tab during live poll — content script must re-arm lock (WM-5).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 2000));
      const afterReload = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const reloadInQueue = afterReload?.inQueueUrls || [];
      assert.ok(
        reloadInQueue.some((u) => normalizeProductUrl(u) === normLockUrl),
        `FIX-3 WM-5: sacred lock must survive page reload during live poll on ${normLockUrl}, got inQueueUrls=${JSON.stringify(reloadInQueue)}`
      );
      assert.equal(
        pollWouldSkipNavigation(normLockUrl, new Set(reloadInQueue), new Set(afterReload?.navigationLock || [])),
        true,
        `FIX-3 WM-5: poll must skip navigate after reload while sacred lock holds on ${normLockUrl}`
      );
      if (route.path.includes('/qp/')) {
        assert.ok(
          logs.filter((l) => l.includes('/qp waiting room detected')).length >= 2,
          `FIX-3 WM-5: /qp reload must re-detect waiting room on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
        );
      } else if (route.path.includes('checkout')) {
        assert.ok(
          logs.filter((l) => l.includes('Queue detected')).length >= 2,
          `FIX-3 WM-5: checkout reload must re-detect queue on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
        );
      } else {
        assert.ok(
          logs.filter((l) => l.includes('Product-page queue detected')).length >= 2,
          `FIX-3 WM-5: product-page reload must re-detect queue on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
        );
      }
    }
    // Repeated NAV_FAILED during live poll — sacred lock must survive (WM-5 error path).
    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      await sendBg(popup, { type: navFailTypes[i], url: lockUrl });
      await new Promise((r) => setTimeout(r, 650));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.ok(
        cycleInQueue.some((u) => normalizeProductUrl(u) === normLockUrl),
        `FIX-3 WM-5: live poll cycle ${i + 1} must preserve sacred lock on ${normLockUrl} after ${navFailTypes[i]}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      assert.ok(
        !cycleNavLock.some((u) => normalizeProductUrl(u) === normLockUrl),
        `FIX-3 WM-5: live poll cycle ${i + 1} must not re-arm navigationLock on ${normLockUrl} after ${navFailTypes[i]}, got ${JSON.stringify(cycleNavLock)}`
      );
    }
    await new Promise((r) => setTimeout(r, 2500));
    const afterPollWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const liveInQueue = afterPollWait?.inQueueUrls || [];
    const liveNavLock = afterPollWait?.navigationLock || [];
    assert.ok(
      liveInQueue.some((u) => normalizeProductUrl(u) === normLockUrl),
      `FIX-3 WM-5: live poll must preserve sacred lock on ${normLockUrl}, got inQueueUrls=${JSON.stringify(liveInQueue)}`
    );
    assert.ok(
      !liveNavLock.some((u) => normalizeProductUrl(u) === normLockUrl),
      `FIX-3 WM-5: live poll must not re-arm navigationLock while sacred lock holds on ${normLockUrl}, got ${JSON.stringify(liveNavLock)}`
    );
    assert.equal(
      pollWouldSkipNavigation(normLockUrl, new Set(liveInQueue), new Set(liveNavLock)),
      true,
      `FIX-3 WM-5: live poll cycle must skip navigate while sacred lock holds on ${normLockUrl}`
    );
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  if (invariants.includes('wm6-live-poll-cycle')) {
    const monitorUrl = route.monitorProductPath
      ? `http://${route.host}:${port}${route.monitorProductPath}`
      : route.sacredLockProductPath
        ? `http://${route.host}:${port}${route.sacredLockProductPath}`
        : pageUrl;
    const normMonitorUrl = normalizeProductUrl(monitorUrl);
    const pxMs = route.pxTimeoutMs > 0 ? route.pxTimeoutMs : 2000;

    // Live background poll: PX NAV_FAILED must never arm sacred lock during real poll cycles.
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: monitorUrl, name: `Fixture WM-6 ${route.journey}`, qty: 1 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });
    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      await sendBg(popup, { type: navFailTypes[i], url: monitorUrl });
      await new Promise((r) => setTimeout(r, 650));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 WM-6: live poll cycle ${i + 1} must not arm inQueueUrls on PX ${normMonitorUrl} after ${navFailTypes[i]}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      if (cycleNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
        assert.ok(
          !cycleInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
          `FIX-3 WM-6: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on PX ${normMonitorUrl} after ${navFailTypes[i]}`
        );
      }
    }
    await new Promise((r) => setTimeout(r, pxMs + 2500));
    const afterPollWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const liveInQueue = afterPollWait?.inQueueUrls || [];
    const liveNavLock = afterPollWait?.navigationLock || [];
    assert.equal(
      liveInQueue.length,
      0,
      `FIX-3 WM-6: live poll must not arm inQueueUrls on PX ${normMonitorUrl}, got inQueueUrls=${JSON.stringify(liveInQueue)}`
    );
    if (liveNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
      assert.ok(
        !liveInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
        `FIX-3 WM-6: navigationLock alone must not imply sacred lock on PX ${normMonitorUrl}`
      );
    }
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  if (invariants.includes('wm4-live-poll-cycle')) {
    const walmartProbePath =
      route.path.includes('/qp/') ? '/ip/mock-wm4-qp-live/111' : '/ip/mock-wm4-checkout-live/222';
    const walmartProbeUrl = `http://${route.host}:${port}${walmartProbePath}`;
    const normWalmartProbeUrl = normalizeProductUrl(walmartProbeUrl);
    const targetMonitorUrl = `http://www.target.com:${port}/p/mock-product`;

    // Target-only monitor keeps the /qp or /checkout tab unmonitored (no walmart productUrl).
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: targetMonitorUrl, name: `Fixture WM-4 ${route.journey}`, qty: 1 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });
    await new Promise((r) => setTimeout(r, 800));
    // Reload queue tab during live poll — re-detect must warn and must not arm sacred lock (WM-4).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));
    const afterReload = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const reloadInQueue = afterReload?.inQueueUrls || [];
    assert.equal(
      reloadInQueue.length,
      0,
      `FIX-3 WM-4: queue page reload during live poll must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(reloadInQueue)}`
    );
    assert.ok(
      !reloadInQueue.some((u) => normalizeProductUrl(u) === normPageUrl),
      `FIX-3 WM-4: queue page URL must not be sacred lock key after reload on ${pageUrl}, got ${JSON.stringify(reloadInQueue)}`
    );
    const queueRedetectLog = route.path.includes('/qp/')
      ? logs.some((l) => l.includes('/qp waiting room detected'))
      : logs.some((l) => l.includes('Queue detected'));
    assert.ok(
      queueRedetectLog,
      `FIX-3 WM-4: queue page reload must re-detect queue on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
    );
    assert.ok(
      logs.filter((l) => l.includes('no productUrl in settings')).length >= 2,
      `FIX-3 WM-4: queue page reload must warn missing productUrl again on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
    );
    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      await sendBg(popup, { type: navFailTypes[i], url: walmartProbeUrl });
      await new Promise((r) => setTimeout(r, 650));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 WM-4: live poll cycle ${i + 1} must not arm inQueueUrls on unmonitored ${pageUrl} after ${navFailTypes[i]}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      if (cycleNavLock.some((u) => normalizeProductUrl(u) === normWalmartProbeUrl)) {
        assert.ok(
          !cycleInQueue.some((u) => normalizeProductUrl(u) === normWalmartProbeUrl),
          `FIX-3 WM-4: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normWalmartProbeUrl} after ${navFailTypes[i]}`
        );
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
    const afterPollWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const liveInQueue = afterPollWait?.inQueueUrls || [];
    const liveNavLock = afterPollWait?.navigationLock || [];
    assert.equal(
      liveInQueue.length,
      0,
      `FIX-3 WM-4: live poll must not arm inQueueUrls on unmonitored ${pageUrl}, got inQueueUrls=${JSON.stringify(liveInQueue)}`
    );
    if (liveNavLock.some((u) => normalizeProductUrl(u) === normWalmartProbeUrl)) {
      assert.ok(
        !liveInQueue.some((u) => normalizeProductUrl(u) === normWalmartProbeUrl),
        `FIX-3 WM-4: navigationLock alone must not imply sacred lock on unmonitored ${normWalmartProbeUrl}`
      );
    }
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  if (invariants.includes('wm2-live-poll-cycle')) {
    const monitorUrl = route.livePollMonitorPath
      ? `http://${route.host}:${port}${route.livePollMonitorPath}`
      : pageUrl;
    const normMonitorUrl = normalizeProductUrl(monitorUrl);

    // Live background poll: pre-drop NAV_FAILED must never arm sacred lock during real poll cycles.
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: monitorUrl, name: `Fixture WM-2 ${route.journey}`, qty: 1 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });
    await sendBg(popup, { type: 'WALMART_NAV_FAILED', url: monitorUrl });
    await sendBg(popup, { type: 'NAV_FAILED', url: monitorUrl });
    await sendBg(popup, { type: 'WALMART_NAV_FAILED', url: monitorUrl });
    await new Promise((r) => setTimeout(r, 2500));
    const afterPollWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const liveInQueue = afterPollWait?.inQueueUrls || [];
    const liveNavLock = afterPollWait?.navigationLock || [];
    assert.equal(
      liveInQueue.length,
      0,
      `FIX-3 WM-2: live poll must not arm inQueueUrls on pre-drop ${normMonitorUrl}, got inQueueUrls=${JSON.stringify(liveInQueue)}`
    );
    if (liveNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
      assert.ok(
        !liveInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
        `FIX-3 WM-2: navigationLock alone must not imply sacred lock on pre-drop ${normMonitorUrl}`
      );
    }
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  if (invariants.includes('tgt-live-poll-cycle')) {
    const monitorUrl = route.monitorProductPath
      ? `http://${route.host}:${port}${route.monitorProductPath}`
      : pageUrl;
    const normMonitorUrl = normalizeProductUrl(monitorUrl);

    // Live background poll: Target product reload must re-init without arming sacred lock (TGT-1).
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: monitorUrl, name: `Fixture TGT ${route.journey}`, qty: 5 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });
    await new Promise((r) => setTimeout(r, 800));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));
    const afterReload = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const reloadInQueue = afterReload?.inQueueUrls || [];
    assert.equal(
      reloadInQueue.length,
      0,
      `FIX-3 ${route.journey}: Target product reload during live poll must not arm inQueueUrls on ${normMonitorUrl}, got ${JSON.stringify(reloadInQueue)}`
    );
    assert.ok(
      logs.filter((l) => l.includes('[TCH] init')).length >= 2,
      `FIX-3 ${route.journey}: Target product reload must re-init content script on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
    );
    const liveSignalTypes = ['ATC_SUCCESS', 'NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED'];
    for (let i = 0; i < liveSignalTypes.length; i++) {
      if (liveSignalTypes[i] === 'ATC_SUCCESS') {
        await sendBgFireAndForget(popup, { type: 'ATC_SUCCESS', url: monitorUrl });
      } else {
        await sendBg(popup, { type: liveSignalTypes[i], url: monitorUrl });
      }
      await new Promise((r) => setTimeout(r, 650));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 ${route.journey}: live poll cycle ${i + 1} must not arm inQueueUrls on ${normMonitorUrl} after ${liveSignalTypes[i]}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      if (cycleNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
        assert.ok(
          !cycleInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
          `FIX-3 ${route.journey}: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normMonitorUrl} after ${liveSignalTypes[i]}`
        );
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
    const afterPollWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const liveInQueue = afterPollWait?.inQueueUrls || [];
    const liveNavLock = afterPollWait?.navigationLock || [];
    assert.equal(
      liveInQueue.length,
      0,
      `FIX-3 ${route.journey}: live poll must not arm inQueueUrls on ${normMonitorUrl}, got inQueueUrls=${JSON.stringify(liveInQueue)}`
    );
    if (liveNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
      assert.ok(
        !liveInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
        `FIX-3 ${route.journey}: navigationLock alone must not imply sacred lock on ${normMonitorUrl}`
      );
    }
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  if (invariants.includes('tgt4-live-poll-cycle')) {
    const monitorUrl = route.monitorProductPath
      ? `http://${route.host}:${port}${route.monitorProductPath}`
      : pageUrl;
    const normMonitorUrl = normalizeProductUrl(monitorUrl);

    // Live background poll: checkout review reload must preserve TGT-4 manual stop (no sacred lock).
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: monitorUrl, name: `Fixture TGT-4 ${route.journey}`, qty: 5 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });
    await new Promise((r) => setTimeout(r, 800));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));
    const afterReload = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const reloadInQueue = afterReload?.inQueueUrls || [];
    assert.equal(
      reloadInQueue.length,
      0,
      `FIX-3 TGT-4: checkout reload during live poll must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(reloadInQueue)}`
    );
    assert.ok(
      logs.filter((l) => l.includes('[TCH] review reached')).length >= 2,
      `FIX-3 TGT-4: checkout reload must re-detect review on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
    );
    assert.ok(
      !logs.some((l) => l.includes('autoPlaceOrder: clicking Place Order')),
      `FIX-3 TGT-4: checkout reload during live poll must not auto-click Place Order on ${pageUrl}`
    );
    const clickedAfterReload = await page.evaluate(() => {
      const btn = document.querySelector('[data-test="placeOrderButton"]');
      return btn?.dataset?.tchFixtureClicked === '1';
    });
    assert.equal(
      clickedAfterReload,
      false,
      'FIX-3 TGT-4: Place Order button must remain unclicked after checkout reload during live poll'
    );
    const liveSignalTypes = ['NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED'];
    for (let i = 0; i < liveSignalTypes.length; i++) {
      if (liveSignalTypes[i] === 'ATC_SUCCESS') {
        await sendBgFireAndForget(popup, { type: 'ATC_SUCCESS', url: monitorUrl });
      } else {
        await sendBg(popup, { type: liveSignalTypes[i], url: pageUrl });
      }
      await new Promise((r) => setTimeout(r, 650));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 TGT-4: live poll cycle ${i + 1} must not arm inQueueUrls on checkout ${pageUrl} after ${liveSignalTypes[i]}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      if (cycle?.navigationLock?.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
        assert.ok(
          !cycleInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
          `FIX-3 TGT-4: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normMonitorUrl} after ${liveSignalTypes[i]}`
        );
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
    const afterPollWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    assert.equal(
      afterPollWait?.inQueueUrls?.length || 0,
      0,
      `FIX-3 TGT-4: live poll must not arm inQueueUrls on checkout ${pageUrl}, got inQueueUrls=${JSON.stringify(afterPollWait?.inQueueUrls || [])}`
    );
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  // WM-5: after QUEUE_TIMEOUT, background poll must re-arm navigationLock (no sacred lock).
  if (invariants.includes('wm5-poll-recovery-rearm')) {
    const recoveryPath =
      route.pollRecoveryProductPath || route.sacredLockProductPath || route.monitorProductPath;
    const monitorUrl = recoveryPath
      ? `http://${route.host}:${port}${recoveryPath}`
      : pageUrl;
    const normMonitorUrl = normalizeProductUrl(monitorUrl);

    const postTimeout = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    assert.equal(
      postTimeout?.inQueueUrls?.length || 0,
      0,
      `FIX-3 WM-5: QUEUE_TIMEOUT must clear inQueueUrls before poll recovery on ${normMonitorUrl}`
    );
    assert.ok(
      !(postTimeout?.navigationLock || []).some((u) => normalizeProductUrl(u) === normMonitorUrl),
      `FIX-3 WM-5: QUEUE_TIMEOUT must clear navigationLock before poll recovery on ${normMonitorUrl}, got ${JSON.stringify(postTimeout?.navigationLock || [])}`
    );

    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: monitorUrl, name: 'Fixture WM-5 poll recovery', qty: 1 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });

    let sawLockCleared = false;
    let sawLockRearmed = false;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 WM-5: poll recovery after QUEUE_TIMEOUT must not arm inQueueUrls on ${normMonitorUrl}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      const hasLock = cycleNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl);
      if (!hasLock) sawLockCleared = true;
      if (hasLock && sawLockCleared) {
        sawLockRearmed = true;
        break;
      }
    }
    assert.ok(
      sawLockCleared,
      `FIX-3 WM-5: poll must clear navigationLock via NAV_FAILED before re-arm on ${normMonitorUrl}`
    );
    assert.ok(
      sawLockRearmed,
      `FIX-3 WM-5: background poll must re-arm navigationLock after QUEUE_TIMEOUT on ${normMonitorUrl}`
    );
    const afterRecovery = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const recoveryInQueue = afterRecovery?.inQueueUrls || [];
    const recoveryNavLock = afterRecovery?.navigationLock || [];
    assert.equal(
      recoveryInQueue.length,
      0,
      `FIX-3 WM-5: poll recovery must not arm inQueueUrls on ${normMonitorUrl}, got inQueueUrls=${JSON.stringify(recoveryInQueue)}`
    );
    assert.ok(
      recoveryNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl),
      `FIX-3 WM-5: poll recovery must hold navigationLock on ${normMonitorUrl}, got ${JSON.stringify(recoveryNavLock)}`
    );
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  // SC-6: after restock NAV_FAILED, background poll must re-arm navigationLock (no sacred lock).
  if (invariants.includes('sc6-poll-recovery-rearm')) {
    const monitorUrl = route.monitorProductPath
      ? `http://${route.host}:${port}${route.monitorProductPath}`
      : pageUrl;
    const normMonitorUrl = normalizeProductUrl(monitorUrl);

    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: monitorUrl, name: `Fixture SC ${route.journey} poll recovery`, qty: route.monitorQty || 5 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });

    let sawLockCleared = false;
    let sawLockRearmed = false;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 SC-6: poll recovery must never arm inQueueUrls on ${normMonitorUrl}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      const hasLock = cycleNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl);
      if (!hasLock) sawLockCleared = true;
      if (hasLock && sawLockCleared) {
        sawLockRearmed = true;
        break;
      }
    }
    assert.ok(
      sawLockCleared,
      `FIX-3 SC-6: restock NAV_FAILED must clear navigationLock for poll retry on ${normMonitorUrl}`
    );
    assert.ok(
      sawLockRearmed,
      `FIX-3 SC-6: background poll must re-arm navigationLock after error-path NAV_FAILED on ${normMonitorUrl}`
    );
    const afterRecovery = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const recoveryInQueue = afterRecovery?.inQueueUrls || [];
    const recoveryNavLock = afterRecovery?.navigationLock || [];
    assert.equal(
      recoveryInQueue.length,
      0,
      `FIX-3 SC-6: poll recovery must not arm inQueueUrls on ${normMonitorUrl}, got inQueueUrls=${JSON.stringify(recoveryInQueue)}`
    );
    assert.ok(
      recoveryNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl),
      `FIX-3 SC-6: poll recovery must hold navigationLock on ${normMonitorUrl}, got ${JSON.stringify(recoveryNavLock)}`
    );
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  if (invariants.includes('sc5-sc6-live-poll-cycle')) {
    const monitorUrl = route.monitorProductPath
      ? `http://${route.host}:${port}${route.monitorProductPath}`
      : pageUrl;
    const normMonitorUrl = normalizeProductUrl(monitorUrl);

    // Live background poll: FCFS signals must never arm sacred lock during real poll cycles.
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: monitorUrl, name: `Fixture SC ${route.journey}`, qty: route.monitorQty || 5 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });
    await new Promise((r) => setTimeout(r, 800));
    // Reload FCFS tab during live poll — must re-init without arming sacred lock (SC-5/SC-6).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));
    const afterReload = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const reloadInQueue = afterReload?.inQueueUrls || [];
    assert.equal(
      reloadInQueue.length,
      0,
      `FIX-3 ${route.journey}: FCFS page reload during live poll must not arm inQueueUrls on ${normMonitorUrl}, got ${JSON.stringify(reloadInQueue)}`
    );
    assert.ok(
      logs.filter((l) => l.includes('[TCH] init')).length >= 2,
      `FIX-3 ${route.journey}: FCFS reload must re-init content script on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
    );
    if (route.journey === 'SC-6') {
      assert.ok(
        logs.filter((l) => l.includes('handleProductPage — FCFS ATC')).length >= 2,
        `FIX-3 SC-6: restock reload must re-run FCFS product handler on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
      );
    } else {
      // SC-5: first ATC may navigate to cart; reload re-inits there without sacred lock.
      assert.ok(
        logs.filter((l) => l.includes('[TCH] init: cart')).length >= 1 ||
          logs.filter((l) => l.includes('Clicking ATC button')).length >= 2,
        `FIX-3 SC-5: FCFS reload must re-init after ATC flow on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
      );
    }
    // Repeated NAV_FAILED / ATC_SUCCESS during live poll — FCFS must never arm sacred lock (SC-5/SC-6).
    const liveSignalTypes = ['NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED', 'ATC_SUCCESS'];
    for (let i = 0; i < liveSignalTypes.length; i++) {
      if (liveSignalTypes[i] === 'ATC_SUCCESS') {
        await sendBgFireAndForget(popup, { type: 'ATC_SUCCESS', url: monitorUrl });
      } else {
        await sendBg(popup, { type: liveSignalTypes[i], url: monitorUrl });
      }
      await new Promise((r) => setTimeout(r, 650));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 ${route.journey}: live poll cycle ${i + 1} must not arm inQueueUrls on ${normMonitorUrl} after ${liveSignalTypes[i]}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      if (cycleNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
        assert.ok(
          !cycleInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
          `FIX-3 ${route.journey}: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normMonitorUrl} after ${liveSignalTypes[i]}`
        );
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
    const afterPollWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const liveInQueue = afterPollWait?.inQueueUrls || [];
    const liveNavLock = afterPollWait?.navigationLock || [];
    assert.equal(
      liveInQueue.length,
      0,
      `FIX-3 ${route.journey}: live poll must not arm inQueueUrls on ${normMonitorUrl}, got inQueueUrls=${JSON.stringify(liveInQueue)}`
    );
    // FCFS: navigationLock may be held during poll navigate, but must never pair with sacred lock.
    if (liveNavLock.some((u) => normalizeProductUrl(u) === normMonitorUrl)) {
      assert.ok(
        !liveInQueue.some((u) => normalizeProductUrl(u) === normMonitorUrl),
        `FIX-3 ${route.journey}: navigationLock alone must not imply sacred lock on ${normMonitorUrl}`
      );
    }
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }

  if (invariants.includes('wm7-offer-id-ready')) {
    const productUrl = `http://${route.host}:${port}${route.monitorProductPath}`;
    const normProductUrl = normalizeProductUrl(productUrl);
    const expectedOid = route.expectedOfferId || 'FIXTURE-OID-WM7-777';
    const wm7Status = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const wm7Product = (wm7Status?.products || []).find(
      (p) => normalizeProductUrl(p.url) === normProductUrl
    );
    assert.equal(
      wm7Product?.oid,
      expectedOid,
      `FIX-3 WM-7: __NEXT_DATA__ must store oid ${expectedOid} on ${normProductUrl}, got ${JSON.stringify(wm7Product)}`
    );
  }

  if (invariants.includes('px-timeout-nav-failed')) {
    assert.ok(
      logs.some((l) => l.includes('PX/loading page detected')),
      `FIX-3 WM-6: expected PX guard log on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    if (invariants.includes('px-timeout-ms-override')) {
      assert.ok(
        route.pxTimeoutMs > 0,
        `FIX-3 WM-6: px-timeout-ms-override route must declare pxTimeoutMs on ${pageUrl}`
      );
    }
    assert.ok(
      logs.some((l) => l.includes('PX page still showing') && l.includes('releasing nav lock')),
      `FIX-3 WM-6: expected PX timeout NAV_FAILED log on ${pageUrl}, got: ${logs.slice(0, 10).join(' | ') || '(none)'}`
    );
    assert.ok(
      !logs.some((l) => l.includes('Product-page queue detected')),
      `FIX-3 WM-6: PX page must not enter product-page queue wait on ${pageUrl}`
    );
    const after = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = after?.inQueueUrls || [];
    const afterNavLock = after?.navigationLock || [];
    assert.equal(
      afterInQueue.length,
      0,
      `FIX-3 WM-6: PX timeout must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normPageUrl),
      `FIX-3 WM-6: PX timeout must clear navigationLock for ${normPageUrl}, got ${JSON.stringify(afterNavLock)}`
    );
  }
}

function routeWaitMs(route) {
  if (route.queueTimeoutMs > 0) return route.queueTimeoutMs + 900;
  if (route.priceGuardTimeoutMs > 0) return route.priceGuardTimeoutMs + 900;
  if (route.pxTimeoutMs > 0) return route.pxTimeoutMs + 900;
  if (route.atcWaitMs > 0) return route.atcWaitMs + 900;
  if (route.invariants?.includes('wm7-offer-id-ready')) return 2500;
  if (route.invariants?.includes('px-timeout-nav-failed')) return 3500;
  if (route.invariants?.includes('nav-failed-releases-lock')) return 9500;
  if (route.checkoutTimeoutMs > 0) return route.checkoutTimeoutMs + 900;
  if (route.invariants?.includes('wm6-cart-checkout-missing')) return 9500;
  if (route.invariants?.includes('no-sacred-lock') && route.host.includes('samsclub')) return 2000;
  if (route.invariants?.includes('tgt4-manual-review')) return 5000;
  return 6000;
}

async function enableExtension(popup, extensionId, timeout) {
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout,
  });
  await popup.waitForSelector('#enableToggle', { timeout: 15000 });
  await popup.evaluate(() => {
    const toggle = document.getElementById('enableToggle');
    if (toggle && !toggle.checked) toggle.click();
  });
  await setStorage(popup, { enabled: true, walmartUseSavedSession: true });
}

async function main() {
  fixtureServer = await startFixtureServer();
  const { port } = fixtureServer;

  const launched = await launchWithExtension({
    profilePrefix: 'tch-fixture-e2e-',
    extraArgs: [`--host-resolver-rules=${hostResolverRules()}`],
  });
  browser = launched.browser;
  userDataDir = launched.userDataDir;
  const { extensionId, TIMEOUT } = launched;

  const popup = await browser.newPage();
  await enableExtension(popup, extensionId, TIMEOUT);

  let invariantRoutes = 0;

  for (const route of FIXTURE_E2E_ROUTES) {
    await applyRouteStorage(popup, route, port);

    const page = await browser.newPage();
    const logs = await attachCdpConsoleCapture(page);
    const url = `http://${route.host}:${port}${route.path}`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    const fixtureAttr = await page.evaluate(() =>
      document.documentElement.getAttribute('data-tch-fixture')
    );
    assert.ok(fixtureAttr, `FIX-2 ${route.journey}: missing data-tch-fixture on ${url}`);

    await new Promise((r) => setTimeout(r, routeWaitMs(route)));

    assert.ok(
      logs.some((l) => l.includes(route.initLog)),
      `FIX-2 ${route.journey}: expected ${route.initLog} on ${url}, got: ${logs.slice(0, 5).join(' | ') || '(none)'}`
    );

    if (route.host.includes('samsclub')) {
      assert.ok(
        logs.some((l) => l.includes('samsclub')),
        `FIX-2 ${route.journey}: expected samsclub retailer in init log`
      );
    }

    if (route.invariants?.length) {
      invariantRoutes += 1;
      await assertRouteInvariants(popup, route, logs, page, port);
    }

    await page.close();
  }

  console.log(
    `fixture-e2e PASS (FIX-2 + FIX-3): ${FIXTURE_E2E_ROUTES.length} retailer fixture pages — init + ${invariantRoutes} invariant routes`
  );
}

main()
  .catch((err) => {
    console.error('fixture-e2e FAIL:', err);
    process.exit(1);
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (fixtureServer) await fixtureServer.close().catch(() => {});
    await rmProfileDir(userDataDir);
  });
