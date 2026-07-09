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

  // ─── MON-2: shared monitorActive + retailer-filtered START_MONITOR ───────
  const MON2_TARGET = 'https://www.target.com/p/overnight-mon2-target';
  const MON2_WALMART = 'https://www.walmart.com/ip/overnight-mon2-walmart/999';

  await popup.evaluate((url) => {
    const input = document.getElementById('productUrl');
    if (!input) throw new Error('no productUrl');
    input.value = url;
    document.getElementById('addProductBtn')?.click();
  }, MON2_TARGET);

  await popup.evaluate(() => {
    document.getElementById('tabWalmart')?.click();
  });
  await popup.waitForSelector('#wmAddProductBtn', { timeout: 5000 });
  await popup.evaluate((url) => {
    const input = document.getElementById('wmProductUrl');
    if (!input) throw new Error('no wmProductUrl');
    input.value = url;
    document.getElementById('wmAddProductBtn')?.click();
  }, MON2_WALMART);

  await popup.evaluate(() => {
    document.getElementById('wmMonitorBtn')?.click();
  });
  await popup.waitForFunction(
    () => document.getElementById('wmMonitorBtn')?.textContent?.match(/stop/i),
    { timeout: 8000 }
  );

  const wmMon = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(wmMon.active, true, 'MON-2: walmart start sets monitor active');
  assert.ok(
    wmMon.products?.length && wmMon.products.every((p) => /walmart\.com/i.test(p.url)),
    'MON-2: walmart start sends only walmart.com products'
  );
  assert.ok(
    !wmMon.products.some((p) => /target\.com/i.test(p.url)),
    'MON-2: target URL excluded when starting from Walmart tab'
  );

  const sharedStopUi = await popup.evaluate(() => ({
    target: document.getElementById('monitorBtn')?.textContent || '',
    walmart: document.getElementById('wmMonitorBtn')?.textContent || '',
  }));
  assert.match(sharedStopUi.target, /stop/i, 'MON-2: Target button shows Stop while monitor active');
  assert.match(sharedStopUi.walmart, /stop/i, 'MON-2: Walmart button shows Stop while monitor active');

  await popup.evaluate(() => {
    document.getElementById('tabMain')?.click();
    document.getElementById('monitorBtn')?.click();
  });
  await popup.waitForFunction(
    () => !document.getElementById('monitorBtn')?.textContent?.match(/stop/i),
    { timeout: 8000 }
  );
  const stopped = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(stopped.active, false, 'MON-2: stop from Target tab clears shared monitor');

  await popup.evaluate(() => {
    document.getElementById('monitorBtn')?.click();
  });
  await popup.waitForFunction(
    () => document.getElementById('monitorBtn')?.textContent?.match(/stop/i),
    { timeout: 8000 }
  );

  const tgtMon = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(tgtMon.active, true, 'MON-2: target start sets monitor active');
  assert.ok(
    tgtMon.products?.length && tgtMon.products.every((p) => /target\.com/i.test(p.url)),
    'MON-2: target start sends only target.com products'
  );
  assert.ok(
    !tgtMon.products.some((p) => /walmart\.com/i.test(p.url)),
    'MON-2: walmart URL excluded when starting from Target tab'
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
  assert.ok(
    !withNavLock.inQueueUrls?.includes(MON3_NORM),
    'WM-4: navigationLock alone must not populate inQueueUrls (sacred lock only via WALMART_IN_QUEUE)'
  );

  // ─── WM-6: NAV_FAILED while not in queue — poll can retry ────────────────
  const wm6BeforeFail = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(
    !wm6BeforeFail.inQueueUrls?.includes(MON3_NORM),
    'WM-6 setup: not in queue before NAV_FAILED'
  );

  await sendBg(popup, { type: 'WALMART_NAV_FAILED', url: MON3_WM });
  const wm6AfterFail = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(
    !wm6AfterFail.inQueueUrls?.includes(MON3_NORM),
    'WM-6: NAV_FAILED must not arm inQueueUrls when not in queue'
  );
  assert.ok(
    !wm6AfterFail.navigationLock?.includes(MON3_NORM),
    'WM-6: NAV_FAILED clears navigationLock for poll retry'
  );

  await new Promise((r) => setTimeout(r, 2500));
  const wm6AfterPoll = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(
    wm6AfterPoll.navigationLock?.includes(MON3_NORM),
    'WM-6: poll re-arms navigationLock after error-path NAV_FAILED'
  );
  assert.ok(
    !wm6AfterPoll.inQueueUrls?.includes(MON3_NORM),
    'WM-6: poll retry must not arm inQueueUrls without WALMART_IN_QUEUE'
  );

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
    'WM-5: WALMART_NAV_FAILED must not clear inQueueUrls'
  );

  {
    const inQ = new Set(afterNavFail.inQueueUrls || []);
    const navL = new Set(afterNavFail.navigationLock || []);
    assert.equal(
      pollWouldSkipNavigation(MON3_NORM, inQ, navL),
      true,
      'WM-5: poll skips when inQueueUrls holds after NAV_FAILED'
    );
  }
  await new Promise((r) => setTimeout(r, 2500));
  const afterSacredWait = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(
    afterSacredWait.inQueueUrls?.includes(MON3_NORM),
    'WM-5: inQueueUrls persists across poll cycles after NAV_FAILED'
  );
  assert.ok(
    !afterSacredWait.navigationLock?.includes(MON3_NORM),
    'WM-5: poll must not re-arm navigationLock while sacred lock holds'
  );

  // WM-5: retailer-neutral NAV_FAILED while sacred lock holds — same as WALMART_NAV_FAILED.
  await sendBg(popup, { type: 'NAV_FAILED', url: MON3_WM });
  const afterNeutralFail = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(
    !afterNeutralFail.navigationLock?.includes(MON3_NORM),
    'WM-5: retailer-neutral NAV_FAILED clears navigationLock'
  );
  assert.ok(
    afterNeutralFail.inQueueUrls?.includes(MON3_NORM),
    'WM-5: retailer-neutral NAV_FAILED must not clear inQueueUrls'
  );
  {
    const inQ = new Set(afterNeutralFail.inQueueUrls || []);
    const navL = new Set(afterNeutralFail.navigationLock || []);
    assert.equal(
      pollWouldSkipNavigation(MON3_NORM, inQ, navL),
      true,
      'WM-5: poll skips when inQueueUrls holds after retailer-neutral NAV_FAILED'
    );
  }

  // WM-5: queue wait timeout releases sacred lock (contrast with NAV_FAILED above).
  await sendBg(popup, { type: 'WALMART_QUEUE_TIMEOUT', url: MON3_WM });
  const afterQueueTimeout = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(
    !afterQueueTimeout.inQueueUrls?.includes(MON3_NORM),
    'WM-5: WALMART_QUEUE_TIMEOUT clears inQueueUrls'
  );
  assert.ok(
    !afterQueueTimeout.navigationLock?.includes(MON3_NORM),
    'WM-5: WALMART_QUEUE_TIMEOUT clears navigationLock'
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

  // ─── WM-7: WM_OFFER_ID_READY stores OID on monitored Walmart product ─────
  const WM7_URL = 'https://www.walmart.com/ip/WM7-Offer-Id-Product/111222333';
  const WM7_OID = 'OFFER-ID-WM7-TEST';

  await sendBg(popup, {
    type: 'START_MONITOR',
    products: [{ url: WM7_URL, name: 'WM-7 OID test', qty: 1 }],
    refreshInterval: 60,
    dropExpectedAt: '',
    walmartSkipMonitoring: true,
  });

  const wm7Before = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.ok(!wm7Before.products?.[0]?.oid, 'WM-7: product starts without oid');

  const wm7Ready = await sendBg(popup, {
    type: 'WM_OFFER_ID_READY',
    offerId: WM7_OID,
    url: WM7_URL,
  });
  assert.ok(wm7Ready?.ok !== false, 'WM-7: WM_OFFER_ID_READY responds ok');

  const wm7After = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(wm7After.products?.[0]?.oid, WM7_OID, 'WM-7: WM_OFFER_ID_READY stores oid on matching product');

  const wm7WrongUrl = await sendBg(popup, {
    type: 'WM_OFFER_ID_READY',
    offerId: 'WRONG-OID',
    url: 'https://www.walmart.com/ip/other-product/999',
  });
  assert.ok(wm7WrongUrl?.ok !== false, 'WM-7: non-monitored URL still responds ok');
  const wm7Unchanged = await sendBg(popup, { type: 'GET_MONITOR_STATUS' });
  assert.equal(
    wm7Unchanged.products?.[0]?.oid,
    WM7_OID,
    'WM-7: non-matching URL must not change stored oid'
  );

  const wm7Same = await sendBg(popup, {
    type: 'WM_OFFER_ID_READY',
    offerId: WM7_OID,
    url: WM7_URL,
  });
  assert.ok(wm7Same?.ok !== false, 'WM-7: idempotent same oid responds ok');
  assert.equal(
    (await sendBg(popup, { type: 'GET_MONITOR_STATUS' })).products?.[0]?.oid,
    WM7_OID,
    'WM-7: idempotent same oid leaves storage unchanged'
  );

  await sendBg(popup, { type: 'STOP_MONITOR' });

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

  // ─── SC-1: Sam's Club content script initializes on samsclub.com ─────────
  const scPage = await browser.newPage();
  const scLogs = [];
  const scCdp = await scPage.createCDPSession();
  await scCdp.send('Runtime.enable');
  scCdp.on('Runtime.consoleAPICalled', (ev) => {
    const parts = (ev.args || []).map((a) => {
      if (a.value !== undefined) return String(a.value);
      if (a.unserializableValue) return String(a.unserializableValue);
      return a.description || '';
    });
    const text = parts.join(' ');
    if (text.includes('[TCH]')) scLogs.push(text);
  });
  await scPage.goto('https://www.samsclub.com/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await new Promise((r) => setTimeout(r, 8000));
  assert.ok(
    scLogs.some((l) => l.includes('[TCH] init') && l.includes('samsclub')),
    `SC-1: expected [TCH] init with samsclub retailer, got: ${scLogs.slice(0, 5).join(' | ') || '(none)'}`
  );

  console.log('FUNCTIONAL PASS: background messages + popup toggle/save + Target + Sam\'s Club content scripts');
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
