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

  if (!route.invariants?.length) {
    await setStorage(popup, { enabled: true, walmartUseSavedSession: true });
    return `http://${route.host}:${port}${route.path}`;
  }

  const pageUrl = `http://${route.host}:${port}${route.path}`;
  const data = { ...FIXTURE_STORAGE_BASE };

  if (route.sacredLockProductPath) {
    const productUrl = `http://${route.host}:${port}${route.sacredLockProductPath}`;
    data.monitor = {
      active: true,
      products: [{ url: productUrl, qty: 1, name: 'Fixture WM-6', oid: null }],
    };
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
  }

  if (invariants.includes('wm5-pre-timeout-live-poll-cycle')) {
    const productUrl = `http://${route.host}:${port}${route.sacredLockProductPath}`;
    const normProductUrl = normalizeProductUrl(productUrl);
    const urlBeforePoll = page.url();

    await sendBg(popup, {
      type: 'START_MONITOR',
      products: [{ url: productUrl, qty: 1, name: 'Fixture WM-5 poll' }],
      refreshInterval: 1,
      dropExpectedAt: '',
      walmartSkipMonitoring: true,
    });

    await new Promise((r) => setTimeout(r, 3000));

    const afterPoll = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
    const afterInQueue = afterPoll?.inQueueUrls || [];
    const afterNavLock = afterPoll?.navigationLock || [];
    assert.ok(
      afterInQueue.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 WM-5: sacred lock must persist across live poll cycles pre-timeout on ${normProductUrl}, got inQueueUrls=${JSON.stringify(afterInQueue)}`
    );
    assert.ok(
      !afterNavLock.some((u) => normalizeProductUrl(u) === normProductUrl),
      `FIX-3 WM-5: live poll must not re-arm navigationLock while sacred lock holds on ${normProductUrl}, got ${JSON.stringify(afterNavLock)}`
    );
    assert.equal(
      page.url(),
      urlBeforePoll,
      `FIX-3 WM-5: live poll must not re-navigate checkout queue tab pre-timeout`
    );
  }
}

function routeWaitMs(route) {
  if (route.invariants?.includes('no-sacred-lock') && route.host.includes('samsclub')) return 2000;
  if (route.invariants?.includes('tgt4-manual-review')) return 5000;
  if (route.invariants?.includes('wm5-pre-timeout-live-poll-cycle')) return 8000;
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
