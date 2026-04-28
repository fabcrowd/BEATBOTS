/**
 * Functional smoke: background message router + cookie harvest + debugger bridge
 * + monitor start/stop, per target-checkout-helper/background.js and popup flows.
 * Runs from extension popup context (chrome.runtime.sendMessage).
 */
import assert from 'node:assert/strict';
import { launchWithExtension, rmProfileDir } from './launch-util.mjs';

let browser;
let userDataDir;

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
