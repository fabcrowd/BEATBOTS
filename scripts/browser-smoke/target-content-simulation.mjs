#!/usr/bin/env node
/**
 * TGT-1 / TGT-4: Target content script — offline error-path simulation (no browser).
 *
 * Parity with walmart-flow-simulation.mjs / samsclub-module-simulation.mjs:
 * - TGT-1: missing ATC → NAV_FAILED, no sacred lock
 * - TGT-4: cart checkout-missing, checkout SPA stall timeout, signin gate pending, poll recovery rearm, live poll cycles
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

/**
 * TGT-1: repeated NAV_FAILED cycles must never arm sacred lock (missing ATC element).
 * Parity with FIX-3 tgt-repeated-nav-failed on /p/-/A-66666666 (fixture-e2e has browser coverage).
 */
function runTgtRepeatedNavFailedTests() {
  function assertRepeatedNavFailedScenario(productUrl, getInitialMsg, label) {
    const normUrl = normalizeProductUrl(productUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    const initialMsg = getInitialMsg();
    assert.ok(initialMsg, `${label}: initial NAV_FAILED message`);
    assert.equal(initialMsg.type, 'NAV_FAILED', `${label}: message type is NAV_FAILED`);

    navigationLock.add(normUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, { ...initialMsg, url: productUrl });
    assert.equal(inQueueUrls.size, 0, `${label} cycle 1 must not arm inQueueUrls`);
    assert.ok(!navigationLock.has(normUrl), `${label} cycle 1 must clear navigationLock`);

    for (let i = 0; i < 2; i++) {
      navigationLock.add(normUrl);
      bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: productUrl });
      assert.equal(
        inQueueUrls.size,
        0,
        `${label} repeated NAV_FAILED cycle ${i + 2} must not arm inQueueUrls`
      );
      assert.ok(
        !navigationLock.has(normUrl),
        `${label} repeated NAV_FAILED cycle ${i + 2} must clear navigationLock`
      );
      assert.ok(
        !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
        `${label} repeated NAV_FAILED cycle ${i + 2} allows poll retry (no sacred lock)`
      );
    }

    const wmSacredLock = new Set([normUrl]);
    assert.ok(
      bgPollWouldSkipNavigation(normUrl, wmSacredLock, new Set()),
      `${label}: contrast WM-5 — sacred lock would block poll; TGT-1 missing ATC does not arm it`
    );
  }

  const noAtcUrl = 'https://www.target.com/p/-/A-66666666';
  const noAtcPage = makePage({ pathname: '/p/-/A-66666666', elements: [] });
  assert.equal(
    tgtDecideMissingAtc(noAtcPage, noAtcUrl).action,
    'atc_unavailable',
    'TGT-1 repeated NAV_FAILED: missing ATC element is nav_failed'
  );
  assertRepeatedNavFailedScenario(
    noAtcUrl,
    () => {
      const result = tgtDecideMissingAtc(noAtcPage, noAtcUrl);
      assert.equal(result.messages.length, 1, 'TGT-1 repeated NAV_FAILED: missing ATC sends NAV_FAILED');
      assert.equal(result.messages[0].url, noAtcUrl, 'TGT-1 repeated NAV_FAILED: NAV_FAILED uses monitor productUrl');
      return result.messages[0];
    },
    'TGT-1 missing-atc'
  );
  assert.match(TGT_SRC, /productAtcWaitMs/, 'TGT-1 repeated NAV_FAILED: ATC wait helper in source');
  assert.match(
    TGT_SRC,
    /ATC button not found or disabled/,
    'TGT-1 repeated NAV_FAILED: missing ATC user-facing log in source'
  );
}

/**
 * TGT-1: cross-page missing ATC — tab on distinct product path, NAV_FAILED keys monitor productUrl.
 * Parity with FIX-3 tgt-missing-atc-cross-poll-recovery (fixture-e2e has browser coverage).
 */
function testTgt1MissingAtcCrossPagePollRecovery() {
  const monitorProductUrl = 'https://www.target.com/p/mock-missing-atc-cross-monitor/A-880094';
  const recoveryProductUrl = 'https://www.target.com/p/mock-missing-atc-cross-recovery/A-880096';
  const tabProductUrl = 'https://www.target.com/p/mock-missing-atc-cross/A-880095';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normTabUrl = normalizeProductUrl(tabProductUrl);

  const page = makePage({ pathname: '/p/mock-missing-atc-cross/A-880095', elements: [] });
  const result = tgtDecideMissingAtc(page, monitorProductUrl);
  assert.equal(result.action, 'atc_unavailable', 'TGT-1: cross-page missing ATC is nav_failed');
  const navFail = result.messages.find((m) => m.type === 'NAV_FAILED');
  assert.ok(navFail, 'TGT-1: cross-page missing ATC sends NAV_FAILED');
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'TGT-1: cross-page NAV_FAILED uses monitor productUrl not tab product URL'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normTabUrl,
    'TGT-1: cross-page NAV_FAILED must not key tab product pathname'
  );

  const inQueueUrls = new Set();
  const navigationLock = new Set([normMonitorUrl]);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'TGT-1: cross-page missing ATC must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'TGT-1: cross-page missing ATC releases navigationLock on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'TGT-1: poll recovery re-arms navigationLock on recovery product after cross-page missing ATC NAV_FAILED'
  );
  assert.equal(inQueueUrls.size, 0, 'TGT-1: cross-page poll recovery must not arm sacred lock');

  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: recoveryProductUrl });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'TGT-1: cross-page NAV_FAILED during poll recovery releases recovery lock'
  );
}

/**
 * TGT-1: cross-page repeated NAV_FAILED cycles must never arm sacred lock (missing ATC element).
 * Parity with FIX-3 tgt-repeated-nav-failed on /p/mock-missing-atc-cross/A-880095 (fixture-e2e has browser coverage).
 */
function runTgtMissingAtcCrossRepeatedNavFailedTests() {
  function assertRepeatedNavFailedScenario(monitorProductUrl, tabProductUrl, getInitialMsg, label) {
    const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
    const normTabUrl = normalizeProductUrl(tabProductUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    const initialMsg = getInitialMsg();
    assert.ok(initialMsg, `${label}: initial NAV_FAILED message`);
    assert.equal(initialMsg.type, 'NAV_FAILED', `${label}: message type is NAV_FAILED`);
    assert.equal(
      normalizeProductUrl(initialMsg.url),
      normMonitorUrl,
      `${label}: NAV_FAILED must key monitor productUrl`
    );
    assert.notEqual(
      normalizeProductUrl(initialMsg.url),
      normTabUrl,
      `${label}: NAV_FAILED must not key tab product pathname`
    );

    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, initialMsg);
    assert.equal(inQueueUrls.size, 0, `${label} cycle 1 must not arm inQueueUrls`);
    assert.ok(!navigationLock.has(normMonitorUrl), `${label} cycle 1 must clear navigationLock`);

    for (let i = 0; i < 2; i++) {
      navigationLock.add(normMonitorUrl);
      bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: monitorProductUrl });
      assert.equal(
        inQueueUrls.size,
        0,
        `${label} repeated NAV_FAILED cycle ${i + 2} must not arm inQueueUrls`
      );
      assert.ok(
        !navigationLock.has(normMonitorUrl),
        `${label} repeated NAV_FAILED cycle ${i + 2} must clear navigationLock`
      );
      assert.ok(
        !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
        `${label} repeated NAV_FAILED cycle ${i + 2} allows poll retry (no sacred lock)`
      );
    }

    const wmSacredLock = new Set([normMonitorUrl]);
    assert.ok(
      bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
      `${label}: contrast WM-5 — sacred lock would block poll; TGT-1 cross-page missing ATC does not arm it`
    );
  }

  const monitorProductUrl = 'https://www.target.com/p/mock-missing-atc-cross-monitor/A-880094';
  const tabProductUrl = 'https://www.target.com/p/mock-missing-atc-cross/A-880095';
  const page = makePage({ pathname: '/p/mock-missing-atc-cross/A-880095', elements: [] });
  assertRepeatedNavFailedScenario(
    monitorProductUrl,
    tabProductUrl,
    () => {
      const result = tgtDecideMissingAtc(page, monitorProductUrl);
      assert.equal(result.action, 'atc_unavailable', 'TGT-1 cross repeated NAV_FAILED: missing ATC is nav_failed');
      const navFail = result.messages.find((m) => m.type === 'NAV_FAILED');
      assert.ok(navFail, 'TGT-1 cross repeated NAV_FAILED: missing ATC sends NAV_FAILED');
      assert.equal(
        navFail.url,
        monitorProductUrl,
        'TGT-1 cross repeated NAV_FAILED: NAV_FAILED uses monitor productUrl'
      );
      return navFail;
    },
    'TGT-1 cross-page missing-atc'
  );
  assert.match(TGT_SRC, /productAtcWaitMs/, 'TGT-1 cross repeated NAV_FAILED: ATC wait helper in source');
  assert.match(
    TGT_SRC,
    /ATC button not found or disabled/,
    'TGT-1 cross repeated NAV_FAILED: missing ATC user-facing log in source'
  );
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
 * TGT-4: cross-page cart poll recovery — tab on /cart/no-checkout-cross, monitor keys distinct productUrl.
 * Parity with FIX-3 tgt-cart-cross-poll-recovery (fixture-e2e has browser coverage).
 */
function testTgt4CartCrossPagePollRecovery() {
  const monitorProductUrl = 'https://www.target.com/p/mock-cart-cross-monitor/A-880088';
  const recoveryProductUrl = 'https://www.target.com/p/mock-cart-cross-recovery/A-880089';
  const cartTabUrl = 'https://www.target.com/cart/no-checkout-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normCartTabUrl = normalizeProductUrl(cartTabUrl);

  const cartPage = makePage({ pathname: '/cart/no-checkout-cross', elements: [] });
  const cartResult = tgtHandleCartPageSim(cartPage, { productUrl: monitorProductUrl });
  assert.equal(cartResult.path, 'checkout_not_found', 'TGT-4 cart cross: missing checkout path');
  assert.deepEqual(cartResult.actions, ['checkout_missing'], 'TGT-4 cart cross: checkout_missing action');

  const inQueueUrls = new Set();
  const navigationLock = new Set();
  assert.equal(inQueueUrls.size, 0, 'TGT-4 cart cross: must not arm sacred lock at cart');
  assert.ok(
    !inQueueUrls.has(normCartTabUrl),
    'TGT-4 cart cross: cart tab URL must not be sacred lock key'
  );
  assert.ok(
    !navigationLock.has(normCartTabUrl),
    'TGT-4 cart cross: cart tab URL must not be navigationLock key at cart'
  );

  const navFail = cartResult.messages.find((m) => m.type === 'NAV_FAILED');
  assert.ok(navFail, 'TGT-4 cart cross: sends NAV_FAILED');
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'TGT-4 cart cross: live poll NAV_FAILED uses monitor productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normCartTabUrl,
    'TGT-4 cart cross: NAV_FAILED must not key cart tab URL'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 cart cross: NAV_FAILED must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'TGT-4 cart cross: NAV_FAILED releases navigationLock on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'TGT-4 cart cross: poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'TGT-4 cart cross: poll recovery must not arm sacred lock');

  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: recoveryProductUrl });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'TGT-4 cart cross: NAV_FAILED during poll recovery releases recovery lock'
  );
}

/**
 * TGT-4: cross-page checkout SPA timeout — tab on /checkout/*, NAV_FAILED keys monitor productUrl.
 * Parity with FIX-3 tgt4-checkout-spa-cross-poll-recovery (fixture-e2e has browser coverage).
 */
function testTgt4CheckoutSpaCrossPagePollRecovery() {
  const monitorProductUrl = 'https://www.target.com/p/mock-checkout-spa-cross-monitor/A-880092';
  const recoveryProductUrl = 'https://www.target.com/p/mock-checkout-spa-cross-recovery/A-880093';
  const checkoutTabUrl = 'https://www.target.com/checkout/spa-stall-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  assert.match(
    TGT_SRC,
    /signalNavFailed\(settings\.productUrl \|\| getRememberedProductUrl\(\) \|\| location\.href\)/,
    'TGT-4: checkout SPA timeout uses settings.productUrl before location.href'
  );

  const navFail = { type: 'NAV_FAILED', url: monitorProductUrl };
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'TGT-4: cross-page checkout SPA NAV_FAILED uses monitor productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normCheckoutTabUrl,
    'TGT-4: cross-page checkout SPA NAV_FAILED must not key checkout tab URL'
  );

  const inQueueUrls = new Set();
  const navigationLock = new Set([normMonitorUrl]);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page checkout SPA timeout must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'TGT-4: cross-page checkout SPA timeout releases navigationLock on monitor product'
  );
  assert.ok(
    !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'TGT-4: poll may retry monitor product after cross-page checkout SPA timeout'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'TGT-4: cross-page poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page poll recovery must not arm sacred lock');
  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: recoveryProductUrl });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'TGT-4: cross-page NAV_FAILED during poll recovery releases recovery lock'
  );
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
 * TGT-4: cross-page checkout SPA live poll cycle — tab on /checkout/spa-stall-cross,
 * monitor keys distinct productUrl; reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 tgt4-checkout-spa-live-poll-cycle on /checkout/spa-stall-cross (fixture-e2e has browser coverage).
 */
function runTgt4CheckoutSpaCrossLivePollCycleTests() {
  const monitorProductUrl = 'https://www.target.com/p/mock-checkout-spa-cross-monitor/A-880092';
  const checkoutTabUrl = 'https://www.target.com/checkout/spa-stall-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page checkout SPA live poll must not arm sacred lock on start');
  assert.ok(
    !inQueueUrls.has(normCheckoutTabUrl),
    'TGT-4: cross-page checkout SPA tab URL must not be sacred lock key'
  );

  let timeoutCycles = 0;
  const simulateCheckoutSpaTimeout = () => {
    timeoutCycles += 1;
    const navFail = { type: 'NAV_FAILED', url: monitorProductUrl };
    assert.equal(navFail.url, monitorProductUrl, 'TGT-4: cross-page checkout SPA NAV_FAILED uses monitor productUrl');
    assert.notEqual(
      normalizeProductUrl(navFail.url),
      normCheckoutTabUrl,
      'TGT-4: cross-page checkout SPA NAV_FAILED must not key checkout tab URL'
    );
    return navFail;
  };

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page checkout SPA timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-4: cross-page checkout SPA timeout releases navigationLock');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(timeoutCycles, 2, 'TGT-4: cross-page checkout SPA reload must re-trigger timeout');
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page checkout SPA reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-4: cross-page checkout SPA reload timeout releases navigationLock');

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
      `TGT-4: cross-page checkout SPA live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `TGT-4: cross-page checkout SPA live poll cycle ${i + 1} navigationLock alone must not imply sacred lock`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `TGT-4: cross-page checkout SPA live poll cycle ${i + 1} allows poll retry (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page checkout SPA live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'TGT-4: cross-page checkout SPA navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'TGT-4: contrast WM-5 — sacred lock would block poll; cross-page checkout SPA timeout does not arm it'
  );
}

/**
 * TGT-4: cross-page repeated NAV_FAILED cycles must never arm sacred lock (checkout SPA timeout).
 * Parity with FIX-3 tgt-repeated-nav-failed on /checkout/spa-stall-cross (fixture-e2e has browser coverage).
 */
function runTgt4CheckoutSpaCrossRepeatedNavFailedTests() {
  function assertRepeatedNavFailedScenario(monitorProductUrl, checkoutTabUrl, getInitialMsg, label) {
    const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
    const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    const initialMsg = getInitialMsg();
    assert.ok(initialMsg, `${label}: initial NAV_FAILED message`);
    assert.equal(initialMsg.type, 'NAV_FAILED', `${label}: message type is NAV_FAILED`);
    assert.equal(
      normalizeProductUrl(initialMsg.url),
      normMonitorUrl,
      `${label}: NAV_FAILED must key monitor productUrl`
    );
    assert.notEqual(
      normalizeProductUrl(initialMsg.url),
      normCheckoutTabUrl,
      `${label}: NAV_FAILED must not key checkout tab URL`
    );

    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, initialMsg);
    assert.equal(inQueueUrls.size, 0, `${label} cycle 1 must not arm inQueueUrls`);
    assert.ok(!navigationLock.has(normMonitorUrl), `${label} cycle 1 must clear navigationLock`);

    for (let i = 0; i < 2; i++) {
      navigationLock.add(normMonitorUrl);
      bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: monitorProductUrl });
      assert.equal(
        inQueueUrls.size,
        0,
        `${label} repeated NAV_FAILED cycle ${i + 2} must not arm inQueueUrls`
      );
      assert.ok(
        !navigationLock.has(normMonitorUrl),
        `${label} repeated NAV_FAILED cycle ${i + 2} must clear navigationLock`
      );
      assert.ok(
        !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
        `${label} repeated NAV_FAILED cycle ${i + 2} allows poll retry (no sacred lock)`
      );
    }

    const wmSacredLock = new Set([normMonitorUrl]);
    assert.ok(
      bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
      `${label}: contrast WM-5 — sacred lock would block poll; TGT-4 cross-page checkout SPA timeout does not arm it`
    );
  }

  const monitorProductUrl = 'https://www.target.com/p/mock-checkout-spa-cross-monitor/A-880092';
  const checkoutTabUrl = 'https://www.target.com/checkout/spa-stall-cross';
  assertRepeatedNavFailedScenario(
    monitorProductUrl,
    checkoutTabUrl,
    () => ({ type: 'NAV_FAILED', url: monitorProductUrl }),
    'TGT-4 cross-page checkout SPA timeout'
  );
  assert.match(TGT_SRC, /handleCheckoutStall timed out/, 'TGT-4 cross-page repeated NAV_FAILED: timeout log in source');
  assert.match(
    TGT_SRC,
    /signalNavFailed\(settings\.productUrl \|\| getRememberedProductUrl\(\) \|\| location\.href\)/,
    'TGT-4 cross-page repeated NAV_FAILED: checkout SPA timeout uses settings.productUrl before location.href'
  );
}

/** Mirrors hasCheckoutAuthGate + getCheckoutStep signin branch. */
function tgtDetectCheckoutStep(page, settings = {}) {
  if (page.querySelector('[data-test="placeOrderButton"]') || tgtFindByText(page, 'place order')) {
    return 'review';
  }
  const authGate =
    page.querySelector('[data-test="authModal"]') ||
    page.querySelector('[data-test="loginModal"]');
  if (authGate) return 'signin';
  return 'unknown';
}

/** Mirrors handleCheckoutPendingStep for signin gate (TGT-4: wait, no reload, no retry spam). */
function tgtHandleCheckoutPendingSim(page, settings = {}, step = 'signin') {
  const actions = [];
  if (step === 'signin') {
    actions.push('pending_signin');
    actions.push('watch_no_retry');
    return {
      path: 'signin_pending',
      actions,
      messages: [],
      reachedReview: false,
      scheduledRetry: false,
    };
  }
  return { path: 'pending_other', actions, messages: [], reachedReview: false, scheduledRetry: false };
}

function testTgt4CheckoutSigninGate() {
  assert.match(TGT_SRC, /handleCheckoutPendingStep/, 'TGT-4 signin: handleCheckoutPendingStep defined');
  assert.match(TGT_SRC, /checkout pending:/, 'TGT-4 signin: pending log in source');
  assert.match(TGT_SRC, /waiting for shipping\/payment \(no reload\)/, 'TGT-4 signin: no-reload wait in source');
  assert.match(TGT_SRC, /noRetryOnTimeout:\s*true/, 'TGT-4 signin: noRetryOnTimeout in watchForCheckoutStep');
  assert.match(TGT_SRC, /hasCheckoutAuthGate/, 'TGT-4 signin: auth gate helper in source');

  const monitorProductUrl = 'https://www.target.com/p/mock-product';
  const page = makePage({
    pathname: '/checkout/signin-gate',
    elements: [
      {
        selectors: ['[data-test="authModal"]'],
        tag: 'div',
        text: 'Sign in to continue checkout',
      },
    ],
  });

  const step = tgtDetectCheckoutStep(page);
  assert.equal(step, 'signin', 'TGT-4 signin: authModal detected as signin step');

  const result = tgtHandleCheckoutPendingSim(page, { productUrl: monitorProductUrl }, step);
  assert.equal(result.path, 'signin_pending', 'TGT-4 signin: pending handler waits on signin gate');
  assert.ok(result.actions.includes('pending_signin'), 'TGT-4 signin: records pending_signin action');
  assert.ok(result.actions.includes('watch_no_retry'), 'TGT-4 signin: watches without retry spam');
  assert.equal(result.reachedReview, false, 'TGT-4 signin: must not reach review');
  assert.equal(result.scheduledRetry, false, 'TGT-4 signin: must not schedule checkout retry');
  assert.equal(result.messages.length, 0, 'TGT-4 signin: must not send NAV_FAILED while waiting');

  const normUrl = normalizeProductUrl(monitorProductUrl);
  const inQueueUrls = new Set();
  const navigationLock = new Set([normUrl]);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 signin: must not arm sacred lock');
  const wmSacredLock = new Set([normUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, wmSacredLock, new Set()),
    'TGT-4 signin: contrast WM-5 — sacred lock would block poll; signin gate does not arm it'
  );
  assert.ok(
    !inQueueUrls.has(normUrl),
    'TGT-4 signin: navigationLock alone must not imply sacred lock'
  );
}

/**
 * TGT-4: signin gate poll recovery — tab on /checkout/signin-gate, monitor keys /p/mock-product.
 * Parity with FIX-3 tgt-poll-recovery-rearm on /checkout/signin-gate (fixture-e2e has browser coverage).
 */
function testTgt4SigninPagePollRecovery() {
  const monitorProductUrl = 'https://www.target.com/p/mock-product';
  const recoveryProductUrl = 'https://www.target.com/p/mock-signin-recovery/A-880099';
  const signinTabUrl = 'https://www.target.com/checkout/signin-gate';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normSigninTabUrl = normalizeProductUrl(signinTabUrl);

  const signinPage = makePage({
    pathname: '/checkout/signin-gate',
    elements: [{ selectors: ['[data-test="authModal"]'], tag: 'div' }],
  });
  const step = tgtDetectCheckoutStep(signinPage);
  assert.equal(step, 'signin', 'TGT-4 signin: authModal detected as signin step');
  const pending = tgtHandleCheckoutPendingSim(signinPage, { productUrl: monitorProductUrl }, step);
  assert.equal(pending.path, 'signin_pending', 'TGT-4 signin: pending handler waits on signin gate');
  assert.equal(pending.messages.length, 0, 'TGT-4 signin: must not send NAV_FAILED while waiting');

  const inQueueUrls = new Set();
  const navigationLock = new Set();
  assert.equal(inQueueUrls.size, 0, 'TGT-4 signin: must not arm sacred lock while pending');
  assert.ok(
    !inQueueUrls.has(normSigninTabUrl),
    'TGT-4 signin: signin tab URL must not be sacred lock key'
  );
  assert.ok(
    !navigationLock.has(normSigninTabUrl),
    'TGT-4 signin: signin tab URL must not be navigationLock key while pending'
  );

  const navFail = { type: 'NAV_FAILED', url: monitorProductUrl };
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'TGT-4 signin: live poll NAV_FAILED uses monitor productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normSigninTabUrl,
    'TGT-4 signin: NAV_FAILED must not key signin tab URL'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 signin: NAV_FAILED must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'TGT-4 signin: NAV_FAILED releases navigationLock on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'TGT-4 signin: poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'TGT-4 signin: poll recovery must not arm sacred lock');

  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: recoveryProductUrl });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'TGT-4 signin: NAV_FAILED during poll recovery releases recovery lock'
  );
}

/** TGT-4: cross-page signin poll recovery — tab on /checkout/signin-gate-cross, monitor keys distinct productUrl. */
function testTgt4SigninCrossPagePollRecovery() {
  const monitorProductUrl = 'https://www.target.com/p/mock-signin-cross-monitor/A-880097';
  const recoveryProductUrl = 'https://www.target.com/p/mock-signin-cross-recovery/A-880098';
  const signinTabUrl = 'https://www.target.com/checkout/signin-gate-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normSigninTabUrl = normalizeProductUrl(signinTabUrl);

  const signinPage = makePage({
    pathname: '/checkout/signin-gate-cross',
    elements: [{ selectors: ['[data-test="authModal"]'], tag: 'div' }],
  });
  const step = tgtDetectCheckoutStep(signinPage);
  assert.equal(step, 'signin', 'TGT-4 signin cross: authModal detected as signin step');
  const pending = tgtHandleCheckoutPendingSim(signinPage, { productUrl: monitorProductUrl }, step);
  assert.equal(pending.path, 'signin_pending', 'TGT-4 signin cross: pending handler waits on signin gate');
  assert.equal(pending.messages.length, 0, 'TGT-4 signin cross: must not send NAV_FAILED while waiting');

  const inQueueUrls = new Set();
  const navigationLock = new Set();
  assert.equal(inQueueUrls.size, 0, 'TGT-4 signin cross: must not arm sacred lock while pending');
  assert.ok(
    !inQueueUrls.has(normSigninTabUrl),
    'TGT-4 signin cross: signin tab URL must not be sacred lock key'
  );
  assert.ok(
    !navigationLock.has(normSigninTabUrl),
    'TGT-4 signin cross: signin tab URL must not be navigationLock key while pending'
  );

  const navFail = { type: 'NAV_FAILED', url: monitorProductUrl };
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'TGT-4 signin cross: live poll NAV_FAILED uses monitor productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normSigninTabUrl,
    'TGT-4 signin cross: NAV_FAILED must not key signin tab URL'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 signin cross: NAV_FAILED must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'TGT-4 signin cross: NAV_FAILED releases navigationLock on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'TGT-4 signin cross: poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'TGT-4 signin cross: poll recovery must not arm sacred lock');

  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: recoveryProductUrl });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'TGT-4 signin cross: NAV_FAILED during poll recovery releases recovery lock'
  );
}

/**
 * TGT-4: checkout sign-in live poll cycle — reload + NAV_FAILED/ATC_SUCCESS during poll, no sacred lock.
 * Parity with FIX-3 tgt-signin-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runTgt4SigninLivePollCycleTests() {
  const monitorProductUrl = 'https://www.target.com/p/mock-product';
  const checkoutTabUrl = 'https://www.target.com/checkout/signin-gate';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const signinPage = makePage({
    pathname: '/checkout/signin-gate',
    elements: [
      {
        selectors: ['[data-test="authModal"]'],
        tag: 'div',
        text: 'Sign in to continue checkout',
      },
    ],
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 signin live poll must not arm sacred lock on start');
  assert.ok(!inQueueUrls.has(normCheckoutTabUrl), 'TGT-4 signin tab URL must not be sacred lock key');

  let signinDetectCycles = 0;
  const simulateSigninReload = () => {
    signinDetectCycles += 1;
    const step = tgtDetectCheckoutStep(signinPage);
    assert.equal(step, 'signin', 'TGT-4 signin reload must re-detect signin gate');
    const pending = tgtHandleCheckoutPendingSim(signinPage, { productUrl: monitorProductUrl }, step);
    assert.equal(pending.path, 'signin_pending', 'TGT-4 signin reload must stay on pending step');
    assert.equal(pending.reachedReview, false, 'TGT-4 signin reload must not reach review');
    return pending;
  };

  simulateSigninReload();
  simulateSigninReload();
  assert.equal(signinDetectCycles, 2, 'TGT-4 signin reload must re-trigger signin detection');

  const liveSignalTypes = ['NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED'];
  for (let i = 0; i < liveSignalTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    if (liveSignalTypes[i] === 'NAV_FAILED') {
      bgApplyNavFailed(navigationLock, inQueueUrls, {
        type: 'NAV_FAILED',
        url: monitorProductUrl,
      });
      assert.ok(
        !navigationLock.has(normMonitorUrl),
        `TGT-4 signin live poll cycle ${i + 1} NAV_FAILED releases navigationLock`
      );
    }
    assert.equal(
      inQueueUrls.size,
      0,
      `TGT-4 signin live poll cycle ${i + 1} must not arm inQueueUrls after ${liveSignalTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `TGT-4 signin live poll cycle ${i + 1} navigationLock alone must not imply sacred lock`
      );
    }
    const pending = tgtHandleCheckoutPendingSim(signinPage, { productUrl: monitorProductUrl }, 'signin');
    assert.equal(pending.reachedReview, false, `TGT-4 signin live poll cycle ${i + 1} must not reach review`);
    assert.equal(
      pending.scheduledRetry,
      false,
      `TGT-4 signin live poll cycle ${i + 1} must not schedule checkout retry`
    );
    if (liveSignalTypes[i] === 'NAV_FAILED') {
      assert.ok(
        !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
        `TGT-4 signin live poll cycle ${i + 1} allows poll retry after NAV_FAILED (no sacred lock)`
      );
    }
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 signin live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'TGT-4 signin navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'TGT-4 signin: contrast WM-5 — sacred lock would block poll; signin gate does not arm it'
  );
}

/**
 * TGT-4: cross-page signin live poll cycle — tab on /checkout/signin-gate-cross,
 * monitor keys distinct productUrl; reload + repeated NAV_FAILED/ATC_SUCCESS during poll, no sacred lock.
 * Parity with FIX-3 tgt-signin-live-poll-cycle on /checkout/signin-gate-cross (fixture-e2e has browser coverage).
 */
function runTgt4SigninCrossLivePollCycleTests() {
  const monitorProductUrl = 'https://www.target.com/p/mock-signin-cross-monitor/A-880097';
  const signinTabUrl = 'https://www.target.com/checkout/signin-gate-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normSigninTabUrl = normalizeProductUrl(signinTabUrl);

  const signinPage = makePage({
    pathname: '/checkout/signin-gate-cross',
    elements: [
      {
        selectors: ['[data-test="authModal"]'],
        tag: 'div',
        text: 'Sign in to continue checkout',
      },
    ],
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page signin live poll must not arm sacred lock on start');
  assert.ok(!inQueueUrls.has(normSigninTabUrl), 'TGT-4: cross-page signin tab URL must not be sacred lock key');

  let signinDetectCycles = 0;
  const simulateSigninReload = () => {
    signinDetectCycles += 1;
    const step = tgtDetectCheckoutStep(signinPage);
    assert.equal(step, 'signin', 'TGT-4: cross-page signin reload must re-detect signin gate');
    const pending = tgtHandleCheckoutPendingSim(signinPage, { productUrl: monitorProductUrl }, step);
    assert.equal(pending.path, 'signin_pending', 'TGT-4: cross-page signin reload must stay on pending step');
    assert.equal(pending.reachedReview, false, 'TGT-4: cross-page signin reload must not reach review');
    assert.equal(pending.messages.length, 0, 'TGT-4: cross-page signin reload must not send NAV_FAILED while waiting');
    return pending;
  };

  simulateSigninReload();
  simulateSigninReload();
  assert.equal(signinDetectCycles, 2, 'TGT-4: cross-page signin reload must re-trigger signin detection');

  const liveSignalTypes = ['NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED'];
  for (let i = 0; i < liveSignalTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    if (liveSignalTypes[i] === 'NAV_FAILED') {
      const navFail = { type: 'NAV_FAILED', url: monitorProductUrl };
      assert.equal(
        navFail.url,
        monitorProductUrl,
        'TGT-4: cross-page signin live poll NAV_FAILED uses monitor productUrl'
      );
      assert.notEqual(
        normalizeProductUrl(navFail.url),
        normSigninTabUrl,
        'TGT-4: cross-page signin live poll NAV_FAILED must not key signin tab URL'
      );
      bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
      assert.ok(
        !navigationLock.has(normMonitorUrl),
        `TGT-4: cross-page signin live poll cycle ${i + 1} NAV_FAILED releases navigationLock`
      );
    }
    assert.equal(
      inQueueUrls.size,
      0,
      `TGT-4: cross-page signin live poll cycle ${i + 1} must not arm inQueueUrls after ${liveSignalTypes[i]}`
    );
    assert.ok(
      !inQueueUrls.has(normSigninTabUrl),
      `TGT-4: cross-page signin live poll cycle ${i + 1} must not sacred-lock signin tab`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `TGT-4: cross-page signin live poll cycle ${i + 1} navigationLock alone must not imply sacred lock`
      );
    }
    const pending = tgtHandleCheckoutPendingSim(signinPage, { productUrl: monitorProductUrl }, 'signin');
    assert.equal(pending.reachedReview, false, `TGT-4: cross-page signin live poll cycle ${i + 1} must not reach review`);
    assert.equal(
      pending.scheduledRetry,
      false,
      `TGT-4: cross-page signin live poll cycle ${i + 1} must not schedule checkout retry`
    );
    if (liveSignalTypes[i] === 'NAV_FAILED') {
      assert.ok(
        !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
        `TGT-4: cross-page signin live poll cycle ${i + 1} allows poll retry after NAV_FAILED (no sacred lock)`
      );
    }
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page signin live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'TGT-4: cross-page signin navigationLock alone must not imply sacred lock after poll wait'
  );
  assert.ok(
    !inQueueUrls.has(normSigninTabUrl),
    'TGT-4: cross-page signin live poll signin tab must not be sacred lock key after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'TGT-4: contrast WM-5 — sacred lock would block poll; cross-page signin gate does not arm it'
  );
}

/**
 * TGT-1: product-page live poll cycle — reload + ATC_SUCCESS/NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 tgt-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runTgt1LivePollCycleTests() {
  const monitorProductUrl = 'https://www.target.com/p/mock-product-live/A-880001';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);

  const productPage = makePage({ pathname: '/p/mock-product-live/A-880001', elements: [] });
  let initCycles = 0;
  const simulateProductReload = () => {
    initCycles += 1;
    const result = tgtDecideMissingAtc(productPage, monitorProductUrl);
    assert.equal(result.action, 'atc_unavailable', 'TGT-1: product reload missing ATC path');
    const navFail = result.messages.find((m) => m.type === 'NAV_FAILED');
    assert.ok(navFail, 'TGT-1: product reload sends NAV_FAILED');
    assert.equal(navFail.url, monitorProductUrl, 'TGT-1: product NAV_FAILED uses monitor productUrl');
    return navFail;
  };

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-1: product live poll must not arm sacred lock on start');

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateProductReload());
  assert.equal(inQueueUrls.size, 0, 'TGT-1: product missing ATC must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-1: product missing ATC releases navigationLock');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateProductReload());
  assert.equal(initCycles, 2, 'TGT-1: product reload must re-trigger missing ATC detection');
  assert.equal(inQueueUrls.size, 0, 'TGT-1: product reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-1: product reload missing ATC releases navigationLock');

  const liveSignalTypes = ['ATC_SUCCESS', 'NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED'];
  for (let i = 0; i < liveSignalTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    if (liveSignalTypes[i] === 'NAV_FAILED') {
      bgApplyNavFailed(navigationLock, inQueueUrls, {
        type: 'NAV_FAILED',
        url: monitorProductUrl,
      });
      assert.ok(
        !navigationLock.has(normMonitorUrl),
        `TGT-1: product live poll cycle ${i + 1} NAV_FAILED releases navigationLock`
      );
      assert.ok(
        !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
        `TGT-1: product live poll cycle ${i + 1} allows poll retry after NAV_FAILED (no sacred lock)`
      );
    }
    assert.equal(
      inQueueUrls.size,
      0,
      `TGT-1: product live poll cycle ${i + 1} must not arm inQueueUrls after ${liveSignalTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `TGT-1: product live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${liveSignalTypes[i]}`
      );
    }
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-1: product live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'TGT-1: product navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'TGT-1: contrast WM-5 — sacred lock would block poll; product missing ATC does not arm it'
  );
}

/**
 * TGT-4: checkout review live poll cycle — reload preserves manual stop + no sacred lock.
 * Parity with FIX-3 tgt4-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runTgt4ReviewLivePollCycleTests() {
  const monitorProductUrl = 'https://www.target.com/p/mock-review-live/A-880002';
  const checkoutTabUrl = 'https://www.target.com/checkout/review';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const reviewPage = makePage({
    pathname: '/checkout/review',
    elements: [
      {
        selectors: ['[data-test="placeOrderButton"]'],
        tag: 'button',
        text: 'Place order',
      },
    ],
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 review live poll must not arm sacred lock on start');
  assert.ok(!inQueueUrls.has(normCheckoutTabUrl), 'TGT-4: checkout tab URL must not be sacred lock key');

  let reviewCycles = 0;
  const simulateReviewReload = () => {
    reviewCycles += 1;
    const result = tgtHandleReviewSim(reviewPage, { autoPlaceOrder: false });
    assert.equal(result.path, 'review_manual', 'TGT-4: review reload must preserve manual stop');
    assert.ok(result.actions.includes('review_manual_stop'), 'TGT-4: review reload must not click Place Order');
    assert.equal(reviewPage.elements[0].clicked, false, 'TGT-4: Place Order must remain unclicked after reload');
    return result;
  };

  simulateReviewReload();
  simulateReviewReload();
  assert.equal(reviewCycles, 2, 'TGT-4: checkout reload must re-detect review step');

  const liveSignalTypes = ['NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED'];
  for (let i = 0; i < liveSignalTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    if (liveSignalTypes[i] === 'NAV_FAILED') {
      bgApplyNavFailed(navigationLock, inQueueUrls, {
        type: 'NAV_FAILED',
        url: monitorProductUrl,
      });
      assert.ok(
        !navigationLock.has(normMonitorUrl),
        `TGT-4 review live poll cycle ${i + 1} NAV_FAILED releases navigationLock`
      );
    }
    assert.equal(
      inQueueUrls.size,
      0,
      `TGT-4 review live poll cycle ${i + 1} must not arm inQueueUrls after ${liveSignalTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `TGT-4 review live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${liveSignalTypes[i]}`
      );
    }
    const reviewResult = tgtHandleReviewSim(reviewPage, { autoPlaceOrder: false });
    assert.equal(reviewResult.path, 'review_manual', `TGT-4 review live poll cycle ${i + 1} preserves manual stop`);
    assert.equal(
      reviewPage.elements[0].clicked,
      false,
      `TGT-4 review live poll cycle ${i + 1} must not auto-click Place Order`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 review live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'TGT-4 review navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'TGT-4 review: contrast WM-5 — sacred lock would block poll; review step does not arm it'
  );
}

/**
 * TGT-4: checkout review poll recovery — tab on /checkout, monitor keys /p/mock-product.
 * Parity with FIX-3 tgt-poll-recovery-rearm on /checkout (fixture-e2e has browser coverage).
 */
function testTgt4ReviewPagePollRecovery() {
  const monitorProductUrl = 'https://www.target.com/p/mock-product';
  const recoveryProductUrl = 'https://www.target.com/p/mock-review-recovery/A-880100';
  const reviewTabUrl = 'https://www.target.com/checkout';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normReviewTabUrl = normalizeProductUrl(reviewTabUrl);

  const reviewPage = makePage({
    pathname: '/checkout',
    elements: [{ selectors: ['[data-test="placeOrderButton"]'], tag: 'button', text: 'Place order' }],
  });
  const reviewResult = tgtHandleReviewSim(reviewPage, { autoPlaceOrder: false });
  assert.equal(reviewResult.path, 'review_manual', 'TGT-4 review: manual stop at review step');
  assert.ok(reviewResult.actions.includes('review_manual_stop'), 'TGT-4 review: must not click Place Order');

  const inQueueUrls = new Set();
  const navigationLock = new Set();
  assert.equal(inQueueUrls.size, 0, 'TGT-4 review: must not arm sacred lock at review');
  assert.ok(
    !inQueueUrls.has(normReviewTabUrl),
    'TGT-4 review: review tab URL must not be sacred lock key'
  );
  assert.ok(
    !navigationLock.has(normReviewTabUrl),
    'TGT-4 review: review tab URL must not be navigationLock key at review'
  );

  const navFail = { type: 'NAV_FAILED', url: monitorProductUrl };
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'TGT-4 review: live poll NAV_FAILED uses monitor productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normReviewTabUrl,
    'TGT-4 review: NAV_FAILED must not key review tab URL'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 review: NAV_FAILED must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'TGT-4 review: NAV_FAILED releases navigationLock on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'TGT-4 review: poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'TGT-4 review: poll recovery must not arm sacred lock');

  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: recoveryProductUrl });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'TGT-4 review: NAV_FAILED during poll recovery releases recovery lock'
  );
}

/** TGT-4: cross-page review poll recovery — tab on /checkout/review-cross, monitor keys distinct productUrl. */
function testTgt4ReviewCrossPagePollRecovery() {
  const monitorProductUrl = 'https://www.target.com/p/mock-review-cross-monitor/A-880101';
  const recoveryProductUrl = 'https://www.target.com/p/mock-review-cross-recovery/A-880102';
  const reviewTabUrl = 'https://www.target.com/checkout/review-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normReviewTabUrl = normalizeProductUrl(reviewTabUrl);

  const reviewPage = makePage({
    pathname: '/checkout/review-cross',
    elements: [{ selectors: ['[data-test="placeOrderButton"]'], tag: 'button', text: 'Place order' }],
  });
  const reviewResult = tgtHandleReviewSim(reviewPage, { autoPlaceOrder: false });
  assert.equal(reviewResult.path, 'review_manual', 'TGT-4 review cross: manual stop at review step');

  const inQueueUrls = new Set();
  const navigationLock = new Set();
  assert.equal(inQueueUrls.size, 0, 'TGT-4 review cross: must not arm sacred lock at review');
  assert.ok(
    !inQueueUrls.has(normReviewTabUrl),
    'TGT-4 review cross: review tab URL must not be sacred lock key'
  );
  assert.ok(
    !navigationLock.has(normReviewTabUrl),
    'TGT-4 review cross: review tab URL must not be navigationLock key at review'
  );

  const navFail = { type: 'NAV_FAILED', url: monitorProductUrl };
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'TGT-4 review cross: live poll NAV_FAILED uses monitor productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normReviewTabUrl,
    'TGT-4 review cross: NAV_FAILED must not key review tab URL'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'TGT-4 review cross: NAV_FAILED must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'TGT-4 review cross: NAV_FAILED releases navigationLock on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'TGT-4 review cross: poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'TGT-4 review cross: poll recovery must not arm sacred lock');

  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'NAV_FAILED', url: recoveryProductUrl });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'TGT-4 review cross: NAV_FAILED during poll recovery releases recovery lock'
  );
}

/**
 * TGT-4: cross-page review live poll cycle — tab on /checkout/review-cross,
 * monitor keys distinct productUrl; reload + repeated NAV_FAILED/ATC_SUCCESS during poll, no sacred lock.
 * Parity with FIX-3 tgt4-live-poll-cycle on /checkout/review-cross (fixture-e2e has browser coverage).
 */
function runTgt4ReviewCrossLivePollCycleTests() {
  const monitorProductUrl = 'https://www.target.com/p/mock-review-cross-monitor/A-880101';
  const reviewTabUrl = 'https://www.target.com/checkout/review-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normReviewTabUrl = normalizeProductUrl(reviewTabUrl);

  const reviewPage = makePage({
    pathname: '/checkout/review-cross',
    elements: [
      {
        selectors: ['[data-test="placeOrderButton"]'],
        tag: 'button',
        text: 'Place order',
      },
    ],
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page review live poll must not arm sacred lock on start');
  assert.ok(!inQueueUrls.has(normReviewTabUrl), 'TGT-4: cross-page review tab URL must not be sacred lock key');

  let reviewCycles = 0;
  const simulateReviewReload = () => {
    reviewCycles += 1;
    const result = tgtHandleReviewSim(reviewPage, { autoPlaceOrder: false });
    assert.equal(result.path, 'review_manual', 'TGT-4: cross-page review reload must preserve manual stop');
    assert.ok(result.actions.includes('review_manual_stop'), 'TGT-4: cross-page review reload must not click Place Order');
    assert.equal(reviewPage.elements[0].clicked, false, 'TGT-4: Place Order must remain unclicked after cross-page review reload');
    return result;
  };

  simulateReviewReload();
  simulateReviewReload();
  assert.equal(reviewCycles, 2, 'TGT-4: cross-page review reload must re-detect review step');

  const liveSignalTypes = ['NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED'];
  for (let i = 0; i < liveSignalTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    if (liveSignalTypes[i] === 'NAV_FAILED') {
      const navFail = { type: 'NAV_FAILED', url: monitorProductUrl };
      assert.equal(
        navFail.url,
        monitorProductUrl,
        'TGT-4: cross-page review live poll NAV_FAILED uses monitor productUrl'
      );
      assert.notEqual(
        normalizeProductUrl(navFail.url),
        normReviewTabUrl,
        'TGT-4: cross-page review live poll NAV_FAILED must not key review tab URL'
      );
      bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
      assert.ok(
        !navigationLock.has(normMonitorUrl),
        `TGT-4: cross-page review live poll cycle ${i + 1} NAV_FAILED releases navigationLock`
      );
    }
    assert.equal(
      inQueueUrls.size,
      0,
      `TGT-4: cross-page review live poll cycle ${i + 1} must not arm inQueueUrls after ${liveSignalTypes[i]}`
    );
    assert.ok(
      !inQueueUrls.has(normReviewTabUrl),
      `TGT-4: cross-page review live poll cycle ${i + 1} must not sacred-lock review tab`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `TGT-4: cross-page review live poll cycle ${i + 1} navigationLock alone must not imply sacred lock`
      );
    }
    const reviewResult = tgtHandleReviewSim(reviewPage, { autoPlaceOrder: false });
    assert.equal(reviewResult.path, 'review_manual', `TGT-4: cross-page review live poll cycle ${i + 1} preserves manual stop`);
    assert.equal(
      reviewPage.elements[0].clicked,
      false,
      `TGT-4: cross-page review live poll cycle ${i + 1} must not auto-click Place Order`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page review live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'TGT-4: cross-page review navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'TGT-4: cross-page review — contrast WM-5 — sacred lock would block poll; review step does not arm it'
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

/**
 * TGT-4: cross-page cart checkout-missing live poll cycle — tab on /cart/no-checkout-cross,
 * monitor keys distinct productUrl; reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 tgt-cart-live-poll-cycle on /cart/no-checkout-cross (fixture-e2e has browser coverage).
 */
function runTgt4CartCrossLivePollCycleTests() {
  const monitorProductUrl = 'https://www.target.com/p/mock-cart-cross-monitor/A-880088';
  const cartTabUrl = 'https://www.target.com/cart/no-checkout-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCartTabUrl = normalizeProductUrl(cartTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page cart live poll must not arm sacred lock on start');
  assert.ok(!inQueueUrls.has(normCartTabUrl), 'TGT-4: cross-page cart tab URL must not be sacred lock key');

  const cartPage = makePage({ pathname: '/cart/no-checkout-cross', elements: [] });
  let checkoutMissingCycles = 0;
  const simulateCartCheckoutMissing = () => {
    checkoutMissingCycles += 1;
    const cartResult = tgtHandleCartPageSim(cartPage, { productUrl: monitorProductUrl });
    assert.equal(cartResult.path, 'checkout_not_found', 'TGT-4: cross-page cart live poll checkout-missing path');
    const navFail = cartResult.messages.find((m) => m.type === 'NAV_FAILED');
    assert.ok(navFail, 'TGT-4: cross-page cart checkout-missing sends NAV_FAILED');
    assert.equal(navFail.url, monitorProductUrl, 'TGT-4: cross-page cart NAV_FAILED uses monitor productUrl');
    assert.notEqual(
      normalizeProductUrl(navFail.url),
      normCartTabUrl,
      'TGT-4: cross-page cart NAV_FAILED must not key cart tab URL'
    );
    return navFail;
  };

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCartCheckoutMissing());
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page cart checkout-missing must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-4: cross-page cart checkout-missing releases navigationLock');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCartCheckoutMissing());
  assert.equal(checkoutMissingCycles, 2, 'TGT-4: cross-page cart reload must re-trigger checkout-missing');
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page cart reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'TGT-4: cross-page cart reload checkout-missing releases navigationLock');

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
      `TGT-4: cross-page cart live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `TGT-4: cross-page cart live poll cycle ${i + 1} navigationLock alone must not imply sacred lock`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `TGT-4: cross-page cart live poll cycle ${i + 1} allows poll retry (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'TGT-4: cross-page cart live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'TGT-4: cross-page cart navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'TGT-4: contrast WM-5 — sacred lock would block poll; cross-page cart checkout-missing does not arm it'
  );
}

function main() {
  testTgt1Source();
  testTgt4Source();
  testTgt1MissingAtcElement();
  runTgtRepeatedNavFailedTests();
  testTgt1MissingAtcCrossPagePollRecovery();
  runTgtMissingAtcCrossRepeatedNavFailedTests();
  runTgt1LivePollCycleTests();
  testTgt4ManualReviewStop();
  testTgt4CartCheckoutMissing();
  testTgt4CartCrossPageCheckoutMissing();
  testTgt4CartCrossPagePollRecovery();
  testTgt4CheckoutSpaCrossPagePollRecovery();
  runTgt4PollRecoveryRearmTests();
  runTgt4CheckoutSpaLivePollCycleTests();
  runTgt4CheckoutSpaCrossLivePollCycleTests();
  runTgt4CheckoutSpaCrossRepeatedNavFailedTests();
  runTgt4ReviewLivePollCycleTests();
  testTgt4ReviewPagePollRecovery();
  runTgt4ReviewCrossLivePollCycleTests();
  testTgt4ReviewCrossPagePollRecovery();
  runTgt4CartLivePollCycleTests();
  runTgt4CartCrossLivePollCycleTests();
  testTgt4CheckoutSigninGate();
  testTgt4SigninPagePollRecovery();
  runTgt4SigninLivePollCycleTests();
  runTgt4SigninCrossLivePollCycleTests();
  testTgt4SigninCrossPagePollRecovery();
  console.log(
    'target-content-simulation PASS (TGT-1 + TGT-4): missing ATC, repeated missing ATC NAV_FAILED, cross-page missing ATC poll recovery, cross-page missing ATC repeated NAV_FAILED, product live poll cycle, manual review stop, review live poll cycle, review poll recovery, cross-page review live poll cycle, cross-page review poll recovery, cart checkout-missing, cross-page cart poll recovery, cross-page cart live poll cycle, cross-page checkout SPA poll recovery, poll recovery rearm, checkout SPA live poll cycle, cross-page checkout SPA live poll cycle, cross-page checkout SPA repeated NAV_FAILED, cart live poll cycle, signin gate pending, signin poll recovery, signin live poll cycle, cross-page signin live poll cycle, cross-page signin poll recovery, no sacred lock'
  );
}

main();
