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

  const pageUrl = `http://${route.host}:${port}${route.path}`;
  const mon2Only =
    route.invariants?.length === 1 && route.invariants[0] === 'mon2-live-poll-cycle';

  if (!route.invariants?.length || mon2Only) {
    await setStorage(popup, { enabled: true, walmartUseSavedSession: true });
    return pageUrl;
  }

  const data = { ...FIXTURE_STORAGE_BASE };

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

  if (invariants.includes('mon2-live-poll-cycle')) {
    const walmartProbePath = '/ip/mock-mon2-target-live/333';
    const walmartProbeUrl = `http://www.walmart.com:${port}${walmartProbePath}`;
    const normWalmartProbeUrl = normalizeProductUrl(walmartProbeUrl);
    const normTargetPageUrl = normalizeProductUrl(pageUrl);

    // Walmart-only monitor — Target tab must stay unmonitored (MON-2 retailer filter).
    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: walmartProbeUrl, name: `Fixture MON-2 ${route.journey}`, qty: 1 }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });
    await new Promise((r) => setTimeout(r, 800));
    const urlBeforeReload = page.url();
    assert.ok(
      urlBeforeReload.includes('target.com'),
      `FIX-3 MON-2: Target tab must stay on target.com before reload during walmart-only poll on ${pageUrl}, got ${urlBeforeReload}`
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2000));
    const urlAfterReload = page.url();
    assert.ok(
      urlAfterReload.includes('target.com'),
      `FIX-3 MON-2: Target tab must stay on target.com after reload during walmart-only poll on ${pageUrl}, got ${urlAfterReload}`
    );
    assert.ok(
      normalizeProductUrl(urlAfterReload) === normTargetPageUrl,
      `FIX-3 MON-2: Target tab URL must not change during walmart-only poll on ${pageUrl}, got ${urlAfterReload}`
    );
    const afterReload = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const reloadProducts = afterReload?.products || [];
    const reloadInQueue = afterReload?.inQueueUrls || [];
    assert.ok(
      reloadProducts.length && reloadProducts.every((p) => /walmart\.com/i.test(p.url)),
      `FIX-3 MON-2: walmart-only monitor must send only walmart.com products on ${pageUrl}, got ${JSON.stringify(reloadProducts)}`
    );
    assert.ok(
      !reloadProducts.some((p) => /target\.com/i.test(p.url)),
      `FIX-3 MON-2: target URL must be excluded from walmart-only monitor on ${pageUrl}, got ${JSON.stringify(reloadProducts)}`
    );
    assert.equal(
      reloadInQueue.length,
      0,
      `FIX-3 MON-2: Target page reload during walmart-only poll must not arm inQueueUrls on ${pageUrl}, got ${JSON.stringify(reloadInQueue)}`
    );
    assert.ok(
      !reloadInQueue.some((u) => normalizeProductUrl(u) === normTargetPageUrl),
      `FIX-3 MON-2: Target page URL must not be sacred lock key during walmart-only poll on ${pageUrl}, got ${JSON.stringify(reloadInQueue)}`
    );
    assert.ok(
      logs.filter((l) => l.includes('[TCH] init')).length >= 2,
      `FIX-3 MON-2: Target page reload must re-init content script on ${pageUrl}, got: ${logs.slice(-8).join(' | ') || '(none)'}`
    );
    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      await sendBg(popup, { type: navFailTypes[i], url: walmartProbeUrl });
      await new Promise((r) => setTimeout(r, 650));
      const cycle = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
      const cycleProducts = cycle?.products || [];
      const cycleInQueue = cycle?.inQueueUrls || [];
      const cycleNavLock = cycle?.navigationLock || [];
      assert.ok(
        cycleProducts.every((p) => /walmart\.com/i.test(p.url)),
        `FIX-3 MON-2: live poll cycle ${i + 1} must keep walmart-only products on ${pageUrl} after ${navFailTypes[i]}, got ${JSON.stringify(cycleProducts)}`
      );
      assert.equal(
        cycleInQueue.length,
        0,
        `FIX-3 MON-2: live poll cycle ${i + 1} must not arm inQueueUrls on Target ${pageUrl} after ${navFailTypes[i]}, got inQueueUrls=${JSON.stringify(cycleInQueue)}`
      );
      assert.ok(
        !cycleInQueue.some((u) => normalizeProductUrl(u) === normTargetPageUrl),
        `FIX-3 MON-2: live poll cycle ${i + 1} must not sacred-lock Target ${normTargetPageUrl} after ${navFailTypes[i]}`
      );
      if (cycleNavLock.some((u) => normalizeProductUrl(u) === normWalmartProbeUrl)) {
        assert.ok(
          !cycleInQueue.some((u) => normalizeProductUrl(u) === normWalmartProbeUrl),
          `FIX-3 MON-2: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normWalmartProbeUrl} after ${navFailTypes[i]}`
        );
      }
      const urlDuringCycle = page.url();
      assert.ok(
        urlDuringCycle.includes('target.com'),
        `FIX-3 MON-2: Target tab must stay on target.com during live poll cycle ${i + 1} on ${pageUrl}, got ${urlDuringCycle}`
      );
    }
    await new Promise((r) => setTimeout(r, 2500));
    const afterPollWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const liveProducts = afterPollWait?.products || [];
    const liveInQueue = afterPollWait?.inQueueUrls || [];
    const liveNavLock = afterPollWait?.navigationLock || [];
    assert.ok(
      liveProducts.every((p) => /walmart\.com/i.test(p.url)),
      `FIX-3 MON-2: live poll must keep walmart-only products on ${pageUrl}, got ${JSON.stringify(liveProducts)}`
    );
    assert.equal(
      liveInQueue.length,
      0,
      `FIX-3 MON-2: live poll must not arm inQueueUrls on Target ${pageUrl}, got inQueueUrls=${JSON.stringify(liveInQueue)}`
    );
    assert.ok(
      page.url().includes('target.com'),
      `FIX-3 MON-2: Target tab must remain on target.com after live poll on ${pageUrl}, got ${page.url()}`
    );
    if (liveNavLock.some((u) => normalizeProductUrl(u) === normWalmartProbeUrl)) {
      assert.ok(
        !liveInQueue.some((u) => normalizeProductUrl(u) === normWalmartProbeUrl),
        `FIX-3 MON-2: navigationLock alone must not imply sacred lock on ${normWalmartProbeUrl}`
      );
    }
    await sendBg(popup, { type: 'STOP_MONITOR' });
    await new Promise((r) => setTimeout(r, 300));
  }
}

function routeWaitMs(route) {
  if (route.invariants?.includes('no-sacred-lock') && route.host.includes('samsclub')) return 2000;
  if (route.invariants?.includes('tgt4-manual-review')) return 5000;
  if (
    route.invariants?.includes('mon2-live-poll-cycle') &&
    !route.invariants?.includes('tgt4-manual-review')
  ) {
    return 1500;
  }
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
