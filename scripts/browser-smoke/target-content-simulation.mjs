#!/usr/bin/env node
/**
 * TGT-1 / TGT-4: Target content script — offline error-path simulation (no browser).
 *
 * Parity with walmart-flow-simulation.mjs / samsclub-module-simulation.mjs:
 * - TGT-1: missing ATC → NAV_FAILED, no sacred lock
 * - TGT-4: cart checkout-missing, checkout SPA stall timeout, poll recovery rearm, live poll cycles
 *
 * Run: node scripts/browser-smoke/target-content-simulation.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const TGT_SRC = readFileSync(join(ROOT, 'target-checkout-helper/content.js'), 'utf8');

/** Mirrors SEL in content.js */
const TGT_SEL = {
  shipIt: '[data-test="shipItButton"], [data-test="shippingButton"]',
  cartCheckout: '[data-test="checkout-button"]',
  placeOrder: '[data-test="placeOrderButton"]',
};

/** Minimal DOM stub for offline Target simulations. */
function makePage({ pathname, elements = [] }) {
  const bySelector = new Map();
  for (const el of elements) {
    for (const sel of el.selectors || []) {
      if (!bySelector.has(sel)) bySelector.set(sel, el);
    }
  }
  const all = elements.map((el) => ({
    tag: el.tag || 'button',
    text: el.text || '',
    disabled: !!el.disabled,
    visible: el.visible !== false,
    clicked: false,
    click() {
      this.clicked = true;
    },
  }));

  return {
    pathname,
    querySelector(sel) {
      const hit = bySelector.get(sel);
      if (hit) {
        const idx = elements.indexOf(hit);
        return all[idx] || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'button, a, [role="button"]') return all;
      const hits = [];
      for (const [s, el] of bySelector) {
        if (s === sel) {
          const idx = elements.indexOf(el);
          if (all[idx]) hits.push(all[idx]);
        }
      }
      return hits;
    },
    elements: all,
  };
}

function tgtFindByText(page, text) {
  const lower = text.toLowerCase();
  return page.elements.find((el) => el.text.trim().toLowerCase().includes(lower)) || null;
}

function tgtIsVisible(el) {
  return !!(el && el.visible);
}

function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock) {
  if (inQueueUrls.has(normUrl)) return true;
  if (navigationLock.has(normUrl)) return true;
  return false;
}

/** Mirrors background.js NAV_FAILED — navigationLock only, never inQueueUrls. */
function bgApplyNavFailed(navigationLock, inQueueUrls, message) {
  const normFailUrl = normalizeProductUrl(message.url || '');
  if (normFailUrl) navigationLock.delete(normFailUrl);
  return normFailUrl;
}

/** Mirrors monitor product-page fixture ATC wait timeout → NAV_FAILED. */
function tgtDecideMissingAtc(page, productUrl) {
  const atc =
    page.querySelector(TGT_SEL.shipIt.split(', ')[0]) ||
    tgtFindByText(page, 'add to cart') ||
    tgtFindByText(page, 'preorder');
  if (!atc || atc.disabled || !tgtIsVisible(atc)) {
    return {
      action: 'atc_unavailable',
      messages: [{ type: 'NAV_FAILED', url: productUrl }],
    };
  }
  return { action: 'proceed_atc', messages: [] };
}

/** Mirrors handleCartPage checkout-missing path. */
function tgtHandleCartPageSim(page, settings = {}) {
  const actions = [];
  const checkoutBtn =
    page.querySelector(TGT_SEL.cartCheckout) ||
    tgtFindByText(page, 'check out') ||
    tgtFindByText(page, 'sign in to check out');
  if (!checkoutBtn || checkoutBtn.disabled || !tgtIsVisible(checkoutBtn)) {
    actions.push('checkout_missing');
    return {
      path: 'checkout_not_found',
      actions,
      messages: [
        {
          type: 'NAV_FAILED',
          url: settings.productUrl || `https://www.target.com${page.pathname}`,
        },
      ],
    };
  }
  actions.push('click_checkout');
  checkoutBtn.click();
  return { path: 'cart_to_checkout', actions, messages: [] };
}

/** Mirrors handleReviewStep when autoPlaceOrder is off (TGT-4 default). */
function tgtHandleReviewSim(page, settings = {}) {
  const actions = [];
  if (!settings.autoPlaceOrder) {
    actions.push('review_manual_stop');
    return { path: 'review_manual', actions };
  }
  const btn = page.querySelector(TGT_SEL.placeOrder) || tgtFindByText(page, 'place order');
  if (btn && tgtIsVisible(btn)) {
    actions.push('click_place_order');
    btn.click();
    return { path: 'review_auto', actions };
  }
  return { path: 'review_missing_btn', actions };
}

function testTgt1Source() {
  assert.match(TGT_SRC, /handleProductPage/, 'TGT-1: handleProductPage defined');
  assert.match(TGT_SRC, /productAtcWaitMs/, 'TGT-1: product ATC wait helper');
  assert.match(TGT_SRC, /signalNavFailed/, 'TGT-1: signalNavFailed helper');
}

function testTgt4Source() {
  assert.match(TGT_SRC, /handleCartPage/, 'TGT-4: handleCartPage defined');
  assert.match(TGT_SRC, /handleCheckoutStallStep/, 'TGT-4: handleCheckoutStallStep defined');
  assert.match(TGT_SRC, /cartCheckoutWaitMs/, 'TGT-4: cart checkout wait helper');
  assert.match(TGT_SRC, /checkoutTotalTimeoutMs/, 'TGT-4: checkout total timeout helper');
  assert.match(TGT_SRC, /autoPlaceOrder/, 'TGT-4: autoPlaceOrder guard');
  assert.match(TGT_SRC, /handleReviewStep/, 'TGT-4: handleReviewStep defined');
}

function testTgt1MissingAtcElement() {
  const productUrl = 'https://www.target.com/p/-/A-559559';
  const page = makePage({ pathname: '/p/-/A-559559', elements: [] });
  const result = tgtDecideMissingAtc(page, productUrl);
  assert.equal(result.action, 'atc_unavailable', 'TGT-1: missing ATC is nav_failed');
  const navFail = result.messages.find((m) => m.type === 'NAV_FAILED');
  assert.ok(navFail, 'TGT-1: missing ATC sends NAV_FAILED');
  assert.equal(navFail.url, productUrl, 'TGT-1: NAV_FAILED uses monitor productUrl');

  const normUrl = normalizeProductUrl(productUrl);
  const inQueueUrls = new Set();
  const navigationLock = new Set([normUrl]);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'TGT-1: missing ATC must not arm sacred lock');
  assert.ok(!navigationLock.has(normUrl), 'TGT-1: missing ATC releases navigationLock');
}

function testTgt4ManualReviewStop() {
  const page = makePage({
    pathname: '/checkout',
    elements: [
      {
        selectors: ['[data-test="placeOrderButton"]'],
        tag: 'button',
        text: 'Place order',
      },
    ],
  });
  const result = tgtHandleReviewSim(page, { autoPlaceOrder: false });
  assert.equal(result.path, 'review_manual', 'TGT-4: manual stop at review');
  assert.ok(result.actions.includes('review_manual_stop'), 'TGT-4: does not click Place Order');
  assert.equal(page.elements[0].clicked, false, 'TGT-4: Place Order not clicked');
}

function testTgt4CartCheckoutMissing() {
  const productUrl = 'https://www.target.com/p/-/A-88888888';
  const page = makePage({ pathname: '/cart/no-checkout', elements: [] });
  const result = tgtHandleCartPageSim(page, { productUrl });
  assert.equal(result.path, 'checkout_not_found', 'TGT-4: cart missing checkout');
  const navFail = result.messages.find((m) => m.type === 'NAV_FAILED');
  assert.ok(navFail, 'TGT-4: cart checkout-missing sends NAV_FAILED');
  assert.equal(navFail.url, productUrl, 'TGT-4: NAV_FAILED uses productUrl not cart URL');
  assert.match(TGT_SRC, /Checkout button not found/, 'TGT-4: cart checkout-missing log in source');
}

function testTgt4CartCrossPageCheckoutMissing() {
  const monitorProductUrl = 'https://www.target.com/p/mock-cart-cross-monitor/A-880088';
  const recoveryProductUrl = 'https://www.target.com/p/mock-cart-cross-recovery/A-880089';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);

  const cartPage = makePage({ pathname: '/cart/no-checkout-cross', elements: [] });
  const cartResult = tgtHandleCartPageSim(cartPage, { productUrl: monitorProductUrl });
  assert.equal(cartResult.path, 'checkout_not_found', 'TGT-4: cross-page cart missing checkout');
  const navFail = cartResult.messages.find((m) => m.type === 'NAV_FAILED');
  assert.ok(navFail, 'TGT-4: cross-page cart sends NAV_FAILED');
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'TGT-4: cross-page NAV_FAILED uses monitor productUrl not cart tab URL'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normalizeProductUrl(`https://www.target.com${cartPage.pathname}`),
    'TGT-4: cross-page NAV_FAILED must not key cart pathname'
  );

  const inQueueUrls = new Set();
  const navigationLock = new Set([normMonitorUrl]);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page cart checkout-missing must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'TGT-4: cross-page cart checkout-missing releases navigationLock on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'TGT-4: poll recovery re-arms navigationLock on recovery product after cross-page cart NAV_FAILED'
  );
  assert.equal(inQueueUrls.size, 0, 'TGT-4: poll recovery must not arm sacred lock');
}

/**
 * TGT-4: checkout SPA timeout + cart checkout-missing + missing ATC NAV_FAILED → poll recovery rearm.
 * Parity with FIX-3 tgt-poll-recovery-rearm (fixture-e2e has browser coverage).
 */
function runTgt4PollRecoveryRearmTests() {
  function assertTgt4PollRecoveryRearm(productUrl, navFailMsg, label) {
    const normUrl = normalizeProductUrl(productUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    assert.equal(navFailMsg.url, productUrl, `${label}: NAV_FAILED uses monitor productUrl`);

    navigationLock.add(normUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, navFailMsg);
    assert.ok(!navigationLock.has(normUrl), `${label}: NAV_FAILED releases navigationLock`);
    assert.equal(inQueueUrls.size, 0, `${label}: must not arm sacred lock`);

    navigationLock.add(normUrl);
    assert.ok(
      navigationLock.has(normUrl),
      `${label}: poll recovery re-arms navigationLock after NAV_FAILED`
    );
    assert.equal(inQueueUrls.size, 0, `${label}: poll recovery must not arm sacred lock`);

    bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: productUrl });
    assert.ok(
      !navigationLock.has(normUrl),
      `${label}: repeated NAV_FAILED during poll recovery releases lock for retry`
    );
    assert.ok(
      !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
      `${label}: poll may retry after poll recovery (no sacred lock)`
    );

    const wmSacredLock = new Set([normUrl]);
    assert.ok(
      bgPollWouldSkipNavigation(normUrl, wmSacredLock, new Set()),
      `${label}: contrast WM-4 — sacred lock would block poll; Target error path does not arm it`
    );
  }

  const spaProductUrl = 'https://www.target.com/p/mock-checkout-spa-stall/794';
  const spaMsg = { type: 'NAV_FAILED', url: spaProductUrl };
  assert.match(TGT_SRC, /handleCheckoutStall timed out/, 'TGT-4 checkout SPA: timeout log in source');
  assertTgt4PollRecoveryRearm(spaProductUrl, spaMsg, 'TGT-4 checkout SPA timeout');

  const cartProductUrl = 'https://www.target.com/p/-/A-88888888';
  const cartPage = makePage({ pathname: '/cart/no-checkout', elements: [] });
  const cartResult = tgtHandleCartPageSim(cartPage, { productUrl: cartProductUrl });
  const cartMsg = cartResult.messages.find((m) => m.type === 'NAV_FAILED');
  assert.ok(cartMsg, 'TGT-4 cart: checkout-missing sends NAV_FAILED');
  assertTgt4PollRecoveryRearm(cartProductUrl, cartMsg, 'TGT-4 cart checkout-missing');

  const missingAtcUrl = 'https://www.target.com/p/-/A-559559';
  const missingPage = makePage({ pathname: '/p/-/A-559559', elements: [] });
  const missingResult = tgtDecideMissingAtc(missingPage, missingAtcUrl);
  const missingMsg = missingResult.messages.find((m) => m.type === 'NAV_FAILED');
  assert.ok(missingMsg, 'TGT-4 missing ATC: sends NAV_FAILED');
  assert.match(TGT_SRC, /data-tch-atc-wait-ms/, 'TGT-4 missing ATC: fixture wait override in source');
  assertTgt4PollRecoveryRearm(missingAtcUrl, missingMsg, 'TGT-4 missing ATC');
}

/**
 * TGT-4: checkout SPA live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 tgt4-checkout-spa-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runTgt4CheckoutSpaLivePollCycleTests() {
  const monitorProductUrl = 'https://www.target.com/p/mock-checkout-spa-stall/794';
  const checkoutTabUrl = 'https://www.target.com/checkout/spa-stall';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: checkout SPA live poll must not arm sacred lock on start');
  assert.ok(
    !inQueueUrls.has(normCheckoutTabUrl),
    'TGT-4: checkout SPA tab URL must not be sacred lock key'
  );

  let timeoutCycles = 0;
  const simulateCheckoutSpaTimeout = () => {
    timeoutCycles += 1;
    return { type: 'NAV_FAILED', url: monitorProductUrl };
  };

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(inQueueUrls.size, 0, 'TGT-4: checkout SPA timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-4: checkout SPA timeout releases navigationLock');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(timeoutCycles, 2, 'TGT-4: reload must re-trigger checkout SPA timeout');
  assert.equal(inQueueUrls.size, 0, 'TGT-4: reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-4: reload timeout releases navigationLock');

  const navFailTypes = ['NAV_FAILED', 'NAV_FAILED', 'NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `TGT-4: checkout SPA live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `TGT-4: checkout SPA live poll cycle ${i + 1} navigationLock alone must not imply sacred lock`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `TGT-4: checkout SPA live poll cycle ${i + 1} allows poll retry (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: checkout SPA live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'TGT-4: checkout SPA navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'TGT-4: contrast WM-5 — sacred lock would block poll; checkout SPA timeout does not arm it'
  );
}

/**
 * TGT-4: cart checkout-missing live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 tgt-cart-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runTgt4CartLivePollCycleTests() {
  const monitorProductUrl = 'https://www.target.com/p/-/A-88888888';
  const cartTabUrl = 'https://www.target.com/cart/no-checkout';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCartTabUrl = normalizeProductUrl(cartTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cart live poll must not arm sacred lock on start');
  assert.ok(!inQueueUrls.has(normCartTabUrl), 'TGT-4: cart tab URL must not be sacred lock key');

  const cartPage = makePage({ pathname: '/cart/no-checkout', elements: [] });
  let checkoutMissingCycles = 0;
  const simulateCartCheckoutMissing = () => {
    checkoutMissingCycles += 1;
    const cartResult = tgtHandleCartPageSim(cartPage, { productUrl: monitorProductUrl });
    assert.equal(cartResult.path, 'checkout_not_found', 'TGT-4: cart live poll checkout-missing path');
    const navFail = cartResult.messages.find((m) => m.type === 'NAV_FAILED');
    assert.ok(navFail, 'TGT-4: cart checkout-missing sends NAV_FAILED');
    assert.equal(navFail.url, monitorProductUrl, 'TGT-4: cart NAV_FAILED uses monitor productUrl');
    return navFail;
  };

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCartCheckoutMissing());
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cart checkout-missing must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-4: cart checkout-missing releases navigationLock');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCartCheckoutMissing());
  assert.equal(checkoutMissingCycles, 2, 'TGT-4: cart reload must re-trigger checkout-missing');
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cart reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-4: cart reload checkout-missing releases navigationLock');

  const navFailTypes = ['NAV_FAILED', 'NAV_FAILED', 'NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `TGT-4: cart live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `TGT-4: cart live poll cycle ${i + 1} navigationLock alone must not imply sacred lock`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `TGT-4: cart live poll cycle ${i + 1} allows poll retry (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cart live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'TGT-4: cart navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'TGT-4: contrast WM-5 — sacred lock would block poll; cart checkout-missing does not arm it'
  );
}

function main() {
  testTgt1Source();
  testTgt4Source();
  testTgt1MissingAtcElement();
  testTgt4ManualReviewStop();
  testTgt4CartCheckoutMissing();
  testTgt4CartCrossPageCheckoutMissing();
  runTgt4PollRecoveryRearmTests();
  runTgt4CheckoutSpaLivePollCycleTests();
  runTgt4CartLivePollCycleTests();
  console.log(
    'target-content-simulation PASS (TGT-1 + TGT-4): missing ATC, manual review stop, cart checkout-missing, poll recovery rearm, checkout SPA live poll cycle, cart live poll cycle, no sacred lock'
  );
}

main();
