#!/usr/bin/env node
/**
 * WM-1: Mirrors walmart-content.js page detection + product → cart → checkout dispatch.
 * Offline simulation — no browser required.
 *
 * Run: node scripts/browser-smoke/walmart-flow-simulation.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WM_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../target-checkout-helper/walmart-content.js'),
  'utf8'
);

/** Mirrors WM_SEL in walmart-content.js (subset used by WM-1 flow). */
const WM_SEL = {
  atc:
    '[data-automation-id="add-to-cart-btn"], button[data-automation-id="atc-button"], button[data-tl-id="ProductPrimaryCTA-cta_add_to_cart_button"]',
  atcAlt: 'button[class*="AddToCartButton"], button[class*="add-to-cart"]',
  atcFallback: '#add-on-atc-container button',
  queueHoldSpot: 'button[data-automation-id="queue-hold-spot-btn"]',
  viewCart: 'a[href="/cart"][data-automation-id], button[data-automation-id="go-to-cart-btn"]',
  checkout: '[data-automation-id="checkout-btn"], a[href^="/checkout"]',
  placeOrder: '[data-automation-id="place-order-btn"]',
};

/** Minimal DOM stub for offline wmGetPageType / handler simulations. */
function makePage({ pathname, bodyText = '', elements = [] }) {
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
    ariaDisabled: el.ariaDisabled,
    visible: el.visible !== false,
    href: el.href,
    clicked: false,
    click() {
      this.clicked = true;
    },
  }));

  return {
    pathname,
    bodyText,
    navigatedTo: null,
    querySelector(sel) {
      const hit = bySelector.get(sel);
      if (hit) {
        const idx = elements.indexOf(hit);
        return all[idx] || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      const hits = [];
      for (const [s, el] of bySelector) {
        if (s === sel || sel === 'a, button') {
          const idx = elements.indexOf(el);
          if (all[idx]) hits.push(all[idx]);
        }
      }
      if (sel === 'button') return all.filter((e) => e.tag === 'button');
      if (sel === 'a, button') return all;
      return hits;
    },
    get body() {
      return { innerText: bodyText };
    },
    elements: all,
    navigate(href) {
      this.navigatedTo = href;
    },
  };
}

function wmFindByText(page, text) {
  const lower = text.toLowerCase();
  return (
    page.elements.find((el) => el.text.trim().toLowerCase().includes(lower)) || null
  );
}

function wmFindAtcLikeButton(page) {
  const selectors = [
    ...WM_SEL.atc.split(', '),
    WM_SEL.atcAlt,
    WM_SEL.queueHoldSpot,
    WM_SEL.atcFallback,
  ];
  for (const sel of selectors) {
    const el = page.querySelector(sel);
    if (el) return el;
  }
  return wmFindByText(page, 'add to cart');
}

function wmIsVisible(el) {
  return !!(el && el.visible);
}

/** WM-6: price-guard timeout releases navigationLock only — never arms sacred lock (WM-2). */
function wmSimulatePriceGuardTimeout(productUrl) {
  return { messages: [{ type: 'WALMART_NAV_FAILED', url: productUrl }] };
}

/** Mirrors wmPxTimeoutMs() — walmart-content.js */
function wmResolvePxTimeoutMs(attrs = {}) {
  const override = attrs['data-tch-px-timeout-ms'];
  if (override != null && override !== '') {
    const ms = parseInt(override, 10);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (attrs['data-tch-fixture'] != null) return 2000;
  return 2 * 60 * 1000;
}

/** Mirrors wmIsPxPage() — walmart-content.js */
function wmIsPxPage(page) {
  const text = (page.bodyText || '').toLowerCase();
  return (
    (text.includes('hang tight') && text.includes('loading')) ||
    text.includes("we're loading your experience") ||
    !!page.querySelector('#px-captcha') ||
    !!page.querySelector('[class*="px-block"]') ||
    !!page.querySelector('[id*="px-captcha"]')
  );
}

/**
 * Mirrors wmInit PX guard — early return, 2min timeout → WALMART_NAV_FAILED if still PX.
 * Returns scheduled messages (timeout path simulated synchronously for WM-6).
 */
function wmSimulatePxInitGuard(page, productUrl, { simulateTimeout = false } = {}) {
  const messages = [];
  if (!wmIsPxPage(page)) return { earlyReturn: false, messages };
  messages.push({ phase: 'px_wait' });
  if (simulateTimeout && wmIsPxPage(page)) {
    messages.push({ type: 'WALMART_NAV_FAILED', url: productUrl });
  }
  return { earlyReturn: true, messages };
}

/** Mirrors wmHasQueueIndicators() — walmart-content.js */
function wmHasQueueIndicators(page) {
  if (page.pathname.startsWith('/qp')) return true;
  const text = (page.bodyText || '').toLowerCase();
  return (
    text.includes('estimated wait time') ||
    text.includes("you're in line") ||
    text.includes("you are in line") ||
    text.includes('your position in line') ||
    text.includes('admission likelihood') ||
    text.includes('queue position') ||
    text.includes('you are in the queue') ||
    text.includes("you're in the queue") ||
    text.includes('in queue - ') ||
    !!page.querySelector('[class*="QueuePage"]') ||
    !!page.querySelector('[data-automation-id*="queue-room"]')
  );
}

/** Mirrors wmIsProductQueued() */
function wmIsProductQueued(page) {
  const atc = wmFindAtcLikeButton(page);
  if (!atc) return false;
  return atc.disabled || atc.ariaDisabled === 'true';
}

/** WM-2/WM-4: sacred lock only when queue indicators present — not disabled ATC alone. */
function wmShouldEnterSacredQueueWait(page) {
  return wmHasQueueIndicators(page);
}

/**
 * Mirrors wmHandleProductPage entry decision (queue lock vs price guard vs ATC).
 * Returns action trace for WM-2 assertions without async wait loops.
 */
function wmDecideProductPageEntry(page, settings = {}) {
  const messages = [];
  const maxPrice = parseFloat(settings.walmartMaxPrice) || 0;
  if (maxPrice > 0 && settings.currentPrice != null && settings.currentPrice > maxPrice) {
    messages.push({ type: 'PRICE_GUARD_WAIT' });
    return { action: 'price_guard_wait', messages };
  }
  if (wmShouldEnterSacredQueueWait(page)) {
    messages.push({ type: 'WALMART_IN_QUEUE' });
    return { action: 'sacred_queue_wait', messages };
  }
  const atc = wmFindAtcLikeButton(page);
  if (!atc || atc.disabled || !wmIsVisible(atc)) {
    messages.push({ type: 'WALMART_NAV_FAILED' });
    return { action: 'atc_unavailable', messages };
  }
  return { action: 'proceed_atc', messages: [] };
}

/** Mirrors wmGetPageType() — walmart-content.js */
function wmGetPageType(page) {
  const path = page.pathname;
  if (/^\/ip\//.test(path)) return 'product';
  if (/^\/cart/.test(path)) return 'cart';
  if (/^\/qp/.test(path)) return 'queue-room';
  if (/^\/checkout/.test(path)) {
    if (wmHasQueueIndicators(page) || wmIsQueuePage(page)) return 'queue';
    if (page.querySelector(WM_SEL.placeOrder) || wmFindByText(page, 'place order')) {
      return 'review';
    }
    return 'checkout';
  }
  if (/\/(thankyou|thank-you|order-confirm)/i.test(path)) return 'confirmation';
  return 'unknown';
}

function wmIsQueuePage(page) {
  return wmHasQueueIndicators(page);
}

/** Mirrors wmInit handler dispatch — walmart-content.js lines ~1130–1137 */
function wmInitDispatch(pageType) {
  if (pageType === 'product') return 'wmHandleProductPage';
  if (pageType === 'cart') return 'wmHandleCart';
  if (pageType === 'queue-room') return 'wmHandleQueueRoom';
  if (pageType === 'queue') return 'wmHandleQueue';
  if (pageType === 'checkout') return 'wmHandleCheckout';
  if (pageType === 'review') return 'wmHandleReview';
  if (pageType === 'confirmation') return 'confirmation';
  return 'unknown';
}

/**
 * Mirrors wmHandleProductPage happy path (DOM ATC → cart) — simplified, no OID/API.
 * Returns action trace for assertions.
 */
async function wmHandleProductPageSim(page, settings) {
  const actions = [];
  const entry = wmDecideProductPageEntry(page, settings);
  if (entry.action === 'price_guard_wait') {
    actions.push('price_guard_wait');
    return { path: 'price_guard', actions, messages: entry.messages };
  }
  if (entry.action === 'sacred_queue_wait') {
    actions.push('wait_in_queue');
    return { path: 'queue_wait', actions, messages: entry.messages };
  }
  if (entry.action === 'atc_unavailable') {
    actions.push('nav_failed');
    return { path: 'atc_unavailable', actions, messages: entry.messages };
  }

  const atcBtn = wmFindAtcLikeButton(page);
  if (!atcBtn || atcBtn.disabled || !wmIsVisible(atcBtn)) {
    actions.push('nav_failed');
    return { path: 'atc_unavailable', actions };
  }

  actions.push('click_atc');
  atcBtn.click();
  actions.push('signal_atc_success');

  const cartLink =
    page.querySelector(WM_SEL.viewCart) ||
    wmFindByText(page, 'view cart') ||
    wmFindByText(page, 'go to cart') ||
    wmFindByText(page, 'cart');

  if (cartLink && wmIsVisible(cartLink)) {
    actions.push('click_cart_link');
    cartLink.click();
    page.navigate('/cart');
  } else {
    actions.push('navigate_cart');
    page.navigate('https://www.walmart.com/cart');
  }
  return { path: 'product_to_cart', actions };
}

/**
 * Mirrors wmHandleCart happy path — walmart-content.js lines ~640–666.
 */
function wmHandleCartSim(page, settings) {
  const actions = [];
  if (settings.walmartAtcOnly) {
    actions.push('atc_only_stop');
    return { path: 'atc_only', actions };
  }

  const primary = page.querySelector(WM_SEL.checkout);
  let checkoutBtn = primary && wmIsVisible(primary) ? primary : null;
  if (!checkoutBtn) {
    checkoutBtn =
      page.querySelectorAll('button').find((el) => {
        const text = el.text.trim().toLowerCase();
        return (text === 'checkout' || text === 'proceed to checkout') && wmIsVisible(el);
      }) || null;
  }

  if (!checkoutBtn) {
    actions.push('checkout_missing');
    return {
      path: 'checkout_not_found',
      actions,
      messages: [{ type: 'WALMART_NAV_FAILED' }],
    };
  }

  actions.push('click_checkout');
  checkoutBtn.click();
  return { path: 'cart_to_checkout', actions };
}

function runPageTypeTests() {
  const product = makePage({ pathname: '/ip/test-item/123456789' });
  assert.equal(wmGetPageType(product), 'product', 'WM-1: /ip/ → product');

  const cart = makePage({ pathname: '/cart' });
  assert.equal(wmGetPageType(cart), 'cart', 'WM-1: /cart → cart');

  const qp = makePage({ pathname: '/qp/waiting-room' });
  assert.equal(wmGetPageType(qp), 'queue-room', 'WM-1: /qp → queue-room');

  const checkoutShip = makePage({ pathname: '/checkout', bodyText: 'Shipping address' });
  assert.equal(wmGetPageType(checkoutShip), 'checkout', 'WM-1: /checkout shipping → checkout');

  const checkoutQueue = makePage({
    pathname: '/checkout',
    bodyText: "You're in line — estimated wait time 5 minutes",
  });
  assert.equal(wmGetPageType(checkoutQueue), 'queue', 'WM-1: /checkout queue text → queue');

  const checkoutReview = makePage({
    pathname: '/checkout',
    elements: [{ selectors: [WM_SEL.placeOrder], text: 'Place order', tag: 'button' }],
  });
  assert.equal(wmGetPageType(checkoutReview), 'review', 'WM-1: place-order btn → review');

  const confirm = makePage({ pathname: '/thankyou' });
  assert.equal(wmGetPageType(confirm), 'confirmation', 'WM-1: thankyou → confirmation');

  const other = makePage({ pathname: '/browse/electronics' });
  assert.equal(wmGetPageType(other), 'unknown', 'WM-1: browse → unknown');
}

function runDispatchTests() {
  assert.equal(wmInitDispatch('product'), 'wmHandleProductPage');
  assert.equal(wmInitDispatch('cart'), 'wmHandleCart');
  assert.equal(wmInitDispatch('queue-room'), 'wmHandleQueueRoom');
  assert.equal(wmInitDispatch('queue'), 'wmHandleQueue');
  assert.equal(wmInitDispatch('checkout'), 'wmHandleCheckout');
  assert.equal(wmInitDispatch('review'), 'wmHandleReview');
  assert.equal(wmInitDispatch('confirmation'), 'confirmation');
  assert.equal(wmInitDispatch('unknown'), 'unknown');

  // End-to-end dispatch chain: product URL → cart URL → checkout URL
  const productUrl = '/ip/overnight-wm1-test/987654321';
  const productPage = makePage({
    pathname: productUrl,
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
      },
      {
        selectors: [WM_SEL.viewCart],
        text: 'View cart',
        tag: 'a',
        href: '/cart',
      },
    ],
  });
  const pageType = wmGetPageType(productPage);
  assert.equal(wmInitDispatch(pageType), 'wmHandleProductPage', 'WM-1: product page dispatches to product handler');
}

async function runFlowTests() {
  const settings = { walmartAtcOnly: false };

  const productPage = makePage({
    pathname: '/ip/flow-test/111',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
      },
      {
        selectors: [WM_SEL.viewCart],
        text: 'View cart',
        tag: 'a',
      },
    ],
  });

  const productResult = await wmHandleProductPageSim(productPage, settings);
  assert.equal(productResult.path, 'product_to_cart', 'WM-1: product happy path');
  assert.deepEqual(productResult.actions, [
    'click_atc',
    'signal_atc_success',
    'click_cart_link',
  ]);
  assert.equal(productPage.navigatedTo, '/cart');

  const cartPage = makePage({
    pathname: '/cart',
    elements: [
      {
        selectors: ['[data-automation-id="checkout-btn"]'],
        text: 'Checkout',
        tag: 'button',
      },
    ],
  });
  assert.equal(wmGetPageType(cartPage), 'cart');
  assert.equal(wmInitDispatch(wmGetPageType(cartPage)), 'wmHandleCart');

  const cartResult = await wmHandleCartSim(cartPage, settings);
  assert.equal(cartResult.path, 'cart_to_checkout', 'WM-1: cart happy path');
  assert.deepEqual(cartResult.actions, ['click_checkout']);
  assert.ok(cartPage.elements[0].clicked, 'WM-1: checkout button clicked');

  const atcOnly = await wmHandleCartSim(cartPage, { walmartAtcOnly: true });
  assert.equal(atcOnly.path, 'atc_only', 'WM-1: walmartAtcOnly stops at cart');
}

function runWm2PredropQueueTests() {
  const disabledAtcOnly = makePage({
    pathname: '/ip/predrop-disabled-atc/123',
    bodyText: 'Add to cart soon',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  assert.ok(wmIsProductQueued(disabledAtcOnly), 'WM-2 setup: disabled ATC detected');
  assert.equal(
    wmShouldEnterSacredQueueWait(disabledAtcOnly),
    false,
    'WM-2: disabled ATC alone is not sacred queue'
  );
  const predropDecision = wmDecideProductPageEntry(disabledAtcOnly);
  assert.notEqual(predropDecision.action, 'sacred_queue_wait', 'WM-2: pre-drop disabled ATC must not enter sacred wait');
  assert.ok(
    !predropDecision.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'WM-2: pre-drop disabled ATC must not send WALMART_IN_QUEUE'
  );
  assert.equal(predropDecision.action, 'atc_unavailable', 'WM-2: pre-drop disabled ATC releases via NAV_FAILED path');

  const queueConfirmed = makePage({
    pathname: '/ip/drop-queue/456',
    bodyText: "You're in line — estimated wait time 3 minutes",
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  assert.equal(
    wmShouldEnterSacredQueueWait(queueConfirmed),
    true,
    'WM-2: queue indicators confirm sacred wait'
  );
  const queueDecision = wmDecideProductPageEntry(queueConfirmed);
  assert.equal(queueDecision.action, 'sacred_queue_wait', 'WM-2: queue indicators arm sacred wait');
  assert.ok(
    queueDecision.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'WM-2: confirmed queue sends WALMART_IN_QUEUE'
  );

  const priceGuardOnly = makePage({
    pathname: '/ip/price-guard/789',
    bodyText: 'List price before drop',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
      },
    ],
  });
  const priceDecision = wmDecideProductPageEntry(priceGuardOnly, {
    walmartMaxPrice: 50,
    currentPrice: 99.99,
  });
  assert.equal(priceDecision.action, 'price_guard_wait', 'WM-2: price guard uses separate wait');
  assert.ok(
    !priceDecision.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'WM-2: price-guard-only must not arm sacred lock'
  );
}

async function runWm2FlowTests() {
  const predropPage = makePage({
    pathname: '/ip/predrop-flow/111',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  const predropResult = await wmHandleProductPageSim(predropPage, {});
  assert.equal(predropResult.path, 'atc_unavailable', 'WM-2: sim does not sacred-lock pre-drop disabled ATC');
  assert.ok(
    !predropResult.messages?.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'WM-2: sim pre-drop path has no WALMART_IN_QUEUE'
  );
}

/** Mirrors background.js normalizeProductUrl */
function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * Mirrors background.js WALMART_IN_QUEUE / NAV_FAILED / WALMART_NAV_FAILED handlers (WM-4).
 * Returns updated { inQueueUrls, navigationLock } sets.
 */
function bgApplyWalmartMessage(inQueueUrls, navigationLock, message) {
  const norm = normalizeProductUrl(message.url || '');
  if (!norm) return { inQueueUrls, navigationLock };
  if (message.type === 'WALMART_IN_QUEUE') {
    inQueueUrls.add(norm);
  }
  if (message.type === 'NAV_FAILED' || message.type === 'WALMART_NAV_FAILED') {
    navigationLock.delete(norm);
  }
  if (message.type === 'WALMART_QUEUE_TIMEOUT') {
    inQueueUrls.delete(norm);
    navigationLock.delete(norm);
  }
  return { inQueueUrls, navigationLock };
}

/**
 * Mirrors wmHandleQueueRoom lock emission — productUrl required for sacred lock (WM-4).
 */
function wmSimulateQueueRoomLock(settings = {}) {
  const messages = [];
  const lockUrl = settings?.productUrl;
  if (lockUrl) {
    messages.push({ type: 'WALMART_IN_QUEUE', url: lockUrl });
  }
  return { messages, armed: !!lockUrl };
}

/**
 * Mirrors wmHandleQueue (checkout-queue) lock emission — productUrl required (WM-4/WM-6).
 * Must not fall back to /checkout href; poll keys inQueueUrls by /ip/ product URL.
 */
function wmSimulateCheckoutQueueLock(settings = {}, locationHref = 'https://www.walmart.com/checkout') {
  const messages = [];
  const lockUrl = settings?.productUrl;
  if (lockUrl) {
    messages.push({ type: 'WALMART_IN_QUEUE', url: lockUrl });
  }
  return { messages, armed: !!lockUrl, locationHref };
}

/** Mirrors poll navigate side-effect — sets navigationLock only, not inQueueUrls. */
function bgPollNavigate(navigationLock, productUrl) {
  const norm = normalizeProductUrl(productUrl);
  if (norm) navigationLock.add(norm);
  return navigationLock;
}

/** Mirrors background.js poll loop skip checks (inQueueUrls before navigationLock). */
function pollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock) {
  if (inQueueUrls.has(normUrl)) return true;
  if (navigationLock.has(normUrl)) return true;
  return false;
}

/** Simulated poll cycle — skip navigate when locked; else arm navigationLock. */
function bgPollCycle(inQueueUrls, navigationLock, productUrl) {
  const norm = normalizeProductUrl(productUrl);
  if (!norm || pollWouldSkipNavigation(norm, inQueueUrls, navigationLock)) {
    return { skipped: true, inQueueUrls, navigationLock };
  }
  navigationLock.add(norm);
  return { skipped: false, inQueueUrls, navigationLock };
}

function runWm4SacredLockTests() {
  const productUrl = 'https://www.walmart.com/ip/wm4-sacred-lock/555666777';
  const norm = normalizeProductUrl(productUrl);

  // Poll navigate arms navigationLock only — not sacred lock (WM-4).
  const inQ = new Set();
  const navL = new Set();
  bgPollNavigate(navL, productUrl);
  assert.ok(navL.has(norm), 'WM-4 setup: poll sets navigationLock');
  assert.ok(!inQ.has(norm), 'WM-4: navigationLock alone must not populate inQueueUrls');

  // Pre-drop disabled ATC → NAV_FAILED, never WALMART_IN_QUEUE → no sacred lock.
  const predrop = makePage({
    pathname: '/ip/wm4-predrop/111',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  const predropEntry = wmDecideProductPageEntry(predrop);
  assert.equal(predropEntry.action, 'atc_unavailable', 'WM-4: pre-drop sends NAV_FAILED path');
  for (const m of predropEntry.messages) {
    bgApplyWalmartMessage(inQ, navL, { type: m.type, url: productUrl });
  }
  assert.ok(!inQ.has(norm), 'WM-4: NAV_FAILED path must not arm inQueueUrls');

  // Queue confirmed → WALMART_IN_QUEUE → sacred lock (WM-4).
  const queuePage = makePage({
    pathname: '/ip/wm4-queue/222',
    bodyText: "You're in line — estimated wait time 2 minutes",
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  const queueEntry = wmDecideProductPageEntry(queuePage);
  assert.equal(queueEntry.action, 'sacred_queue_wait', 'WM-4: confirmed queue arms sacred wait');
  const queueMsg = queueEntry.messages.find((m) => m.type === 'WALMART_IN_QUEUE');
  assert.ok(queueMsg, 'WM-4: confirmed queue emits WALMART_IN_QUEUE');
  bgApplyWalmartMessage(inQ, navL, { type: queueMsg.type, url: productUrl });
  assert.ok(inQ.has(norm), 'WM-4: WALMART_IN_QUEUE populates inQueueUrls after queue confirmed');

  // /qp waiting room uses productUrl for lock — not /qp href (WM-4).
  const qpInQ = new Set();
  const qpNav = new Set();
  const monitoredProduct = 'https://www.walmart.com/ip/wm4-qp-product/888999000';
  const qpNorm = normalizeProductUrl(monitoredProduct);
  bgApplyWalmartMessage(qpInQ, qpNav, {
    type: 'WALMART_IN_QUEUE',
    url: monitoredProduct,
  });
  assert.ok(qpInQ.has(qpNorm), 'WM-4: /qp handler locks monitored productUrl in inQueueUrls');
  assert.ok(
    !qpInQ.has(normalizeProductUrl('https://www.walmart.com/qp/waiting-room')),
    'WM-4: /qp page URL must not be the sacred lock key'
  );

  // /qp without productUrl must not arm sacred lock (WM-4 error path).
  const noProductLock = wmSimulateQueueRoomLock({});
  assert.equal(noProductLock.messages.length, 0, 'WM-4: /qp without productUrl emits no WALMART_IN_QUEUE');
  assert.equal(noProductLock.armed, false, 'WM-4: /qp without productUrl leaves tab unprotected');

  const withProductLock = wmSimulateQueueRoomLock({ productUrl: monitoredProduct });
  assert.equal(withProductLock.messages.length, 1, 'WM-4: /qp with productUrl emits WALMART_IN_QUEUE');
  const qpLockInQ = new Set();
  const qpLockNav = new Set();
  for (const m of withProductLock.messages) {
    bgApplyWalmartMessage(qpLockInQ, qpLockNav, { ...m, url: monitoredProduct });
  }
  assert.ok(qpLockInQ.has(qpNorm), 'WM-4: /qp with productUrl arms inQueueUrls on product key');
}

function runWm6CheckoutQueueLockTests() {
  const monitoredProduct = 'https://www.walmart.com/ip/wm6-checkout-queue/777888999';
  const norm = normalizeProductUrl(monitoredProduct);
  const checkoutHref = 'https://www.walmart.com/checkout';

  const noProductLock = wmSimulateCheckoutQueueLock({}, checkoutHref);
  assert.equal(noProductLock.messages.length, 0, 'WM-6: checkout queue without productUrl emits no WALMART_IN_QUEUE');
  assert.equal(noProductLock.armed, false, 'WM-6: checkout queue without productUrl leaves tab unprotected');
  assert.ok(
    WM_SRC.includes('wmHandleQueue: no productUrl in settings'),
    'WM-4: checkout queue must warn when productUrl missing'
  );

  const withProductLock = wmSimulateCheckoutQueueLock({ productUrl: monitoredProduct }, checkoutHref);
  assert.equal(withProductLock.messages.length, 1, 'WM-6: checkout queue with productUrl emits WALMART_IN_QUEUE');
  const lockMsg = withProductLock.messages[0];
  assert.equal(lockMsg.type, 'WALMART_IN_QUEUE');
  assert.equal(lockMsg.url, monitoredProduct, 'WM-6: lock uses productUrl not /checkout href');

  const inQ = new Set();
  const navL = new Set();
  bgApplyWalmartMessage(inQ, navL, lockMsg);
  assert.ok(inQ.has(norm), 'WM-6: checkout-queue lock populates inQueueUrls on product key');
  assert.ok(
    !inQ.has(normalizeProductUrl(checkoutHref)),
    'WM-6: /checkout URL must not be the sacred lock key'
  );
}

function runWm6ErrorPathTests() {
  const productUrl = 'https://www.walmart.com/ip/wm6-error-path/444555666';
  const norm = normalizeProductUrl(productUrl);

  assert.ok(WM_SRC.includes('function wmAtcWaitTimeoutMs'), 'WM-6: wmAtcWaitTimeoutMs must exist in walmart-content.js');
  assert.ok(WM_SRC.includes('function wmPxTimeoutMs'), 'WM-6: wmPxTimeoutMs must exist in walmart-content.js');
  assert.ok(
    WM_SRC.includes('2 * 60 * 1000'),
    'WM-6: prod PX timeout must remain 2 minutes in walmart-content.js'
  );
  assert.equal(wmResolvePxTimeoutMs({}), 120000, 'WM-6: prod PX timeout is 2 minutes');
  assert.equal(
    wmResolvePxTimeoutMs({ 'data-tch-fixture': 'walmart-product-px' }),
    2000,
    'WM-6: fixture PX timeout is 2s'
  );
  assert.equal(
    wmResolvePxTimeoutMs({ 'data-tch-px-timeout-ms': '750' }),
    750,
    'WM-6: data-tch-px-timeout-ms override for virtual-time regression'
  );
  assert.equal(
    wmResolvePxTimeoutMs({
      'data-tch-fixture': 'walmart-product-px',
      'data-tch-px-timeout-ms': '750',
    }),
    750,
    'WM-6: px-timeout override takes precedence over fixture default'
  );
  assert.equal(
    wmResolvePxTimeoutMs({ 'data-tch-px-timeout-ms': '0' }),
    120000,
    'WM-6: invalid px-timeout override falls back to prod default'
  );

  const pxPage = makePage({
    pathname: '/ip/wm6-px/111',
    bodyText: "Hang tight! We're loading your experience.",
  });
  assert.equal(wmIsPxPage(pxPage), true, 'WM-6: PX hang-tight page detected');
  assert.equal(
    wmHasQueueIndicators(pxPage),
    false,
    'WM-6: PX page must not match queue indicators'
  );
  assert.equal(
    wmShouldEnterSacredQueueWait(pxPage),
    false,
    'WM-6: PX page must not arm sacred queue wait'
  );

  const pxGuard = wmSimulatePxInitGuard(pxPage, productUrl, { simulateTimeout: true });
  assert.equal(pxGuard.earlyReturn, true, 'WM-6: PX guard early-returns from wmInit');
  assert.ok(
    !pxGuard.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'WM-6: PX guard must not emit WALMART_IN_QUEUE'
  );
  assert.ok(
    pxGuard.messages.some((m) => m.type === 'WALMART_NAV_FAILED'),
    'WM-6: PX timeout emits WALMART_NAV_FAILED'
  );

  const pxCaptchaPage = makePage({
    pathname: '/ip/wm6-px-captcha/222',
    bodyText: 'Verify you are human',
    elements: [{ selectors: ['#px-captcha'], tag: 'div' }],
  });
  assert.equal(wmIsPxPage(pxCaptchaPage), true, 'WM-6: #px-captcha element detected');

  const inQ = new Set();
  const navL = new Set([norm]);
  for (const m of pxGuard.messages.filter((x) => x.type)) {
    bgApplyWalmartMessage(inQ, navL, m);
  }
  assert.ok(!inQ.has(norm), 'WM-6: PX NAV_FAILED must not arm inQueueUrls');
  assert.ok(!navL.has(norm), 'WM-6: PX NAV_FAILED clears navigationLock');

  const atcFailPage = makePage({
    pathname: '/ip/wm6-atc-fail/333',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  const atcEntry = wmDecideProductPageEntry(atcFailPage);
  assert.equal(atcEntry.action, 'atc_unavailable', 'WM-6: ATC unavailable → NAV_FAILED path');
  const atcInQ = new Set();
  const atcNav = new Set([norm]);
  for (const m of atcEntry.messages) {
    bgApplyWalmartMessage(atcInQ, atcNav, { ...m, url: productUrl });
  }
  assert.ok(!atcInQ.has(norm), 'WM-6: ATC NAV_FAILED while not in queue must not arm inQueueUrls');
  assert.ok(!atcNav.has(norm), 'WM-6: ATC NAV_FAILED releases navigationLock for poll retry');

  const afterFailPoll = bgPollCycle(atcInQ, atcNav, productUrl);
  assert.equal(afterFailPoll.skipped, false, 'WM-6: poll can re-navigate after NAV_FAILED when not in queue');
  assert.ok(atcNav.has(norm), 'WM-6: poll re-arms navigationLock after error-path NAV_FAILED');

  // WM-6: price-guard timeout — no sacred lock, releases nav lock for poll retry (WM-2).
  assert.ok(WM_SRC.includes('wmSignalNavFailed'), 'WM-6: wmSignalNavFailed helper defined');
  assert.ok(
    WM_SRC.includes('Price guard wait timed out') && WM_SRC.includes('wmSignalNavFailed'),
    'WM-6: price-guard timeout emits WALMART_NAV_FAILED'
  );
  const priceTimeout = wmSimulatePriceGuardTimeout(productUrl);
  const priceInQ = new Set();
  const priceNav = new Set([norm]);
  for (const m of priceTimeout.messages) {
    bgApplyWalmartMessage(priceInQ, priceNav, m);
  }
  assert.ok(!priceInQ.has(norm), 'WM-6: price-guard timeout must not arm inQueueUrls');
  assert.ok(!priceNav.has(norm), 'WM-6: price-guard timeout releases navigationLock');

  // WM-6: cart checkout button missing — same error-path semantics as ATC unavailable.
  assert.ok(
    WM_SRC.includes('Checkout button not found') && WM_SRC.includes('wmSignalNavFailed'),
    'WM-6: cart checkout-missing emits WALMART_NAV_FAILED'
  );
  const emptyCart = makePage({ pathname: '/cart', bodyText: 'Your cart is empty' });
  const cartMissing = wmHandleCartSim(emptyCart, {});
  assert.equal(cartMissing.path, 'checkout_not_found', 'WM-6: cart without checkout btn → error path');
  assert.ok(
    cartMissing.messages?.some((m) => m.type === 'WALMART_NAV_FAILED'),
    'WM-6: cart checkout-missing must emit WALMART_NAV_FAILED'
  );
  const cartInQ = new Set();
  const cartNav = new Set([norm]);
  for (const m of cartMissing.messages) {
    bgApplyWalmartMessage(cartInQ, cartNav, { ...m, url: productUrl });
  }
  assert.ok(!cartInQ.has(norm), 'WM-6: cart checkout-missing must not arm inQueueUrls');
  assert.ok(!cartNav.has(norm), 'WM-6: cart checkout-missing releases navigationLock');

  // WM-6: checkout SPA timeout — release poll lock after 10 min stall (no sacred lock).
  assert.ok(
    WM_SRC.includes('wmHandleCheckout timed out') && WM_SRC.includes('wmSignalNavFailed'),
    'WM-6: checkout timeout emits WALMART_NAV_FAILED'
  );
  const checkoutTimeout = { messages: [{ type: 'WALMART_NAV_FAILED', url: productUrl }] };
  const checkoutInQ = new Set();
  const checkoutNav = new Set([norm]);
  for (const m of checkoutTimeout.messages) {
    bgApplyWalmartMessage(checkoutInQ, checkoutNav, m);
  }
  assert.ok(!checkoutInQ.has(norm), 'WM-6: checkout timeout must not arm inQueueUrls');
  assert.ok(!checkoutNav.has(norm), 'WM-6: checkout timeout releases navigationLock');

  // WM-6: /qp + checkout queue timeout without productUrl — NAV_FAILED fallback (not QUEUE_TIMEOUT).
  assert.ok(
    WM_SRC.includes('/qp waiting room timeout — no productUrl — releasing navigation lock'),
    'WM-6: /qp timeout without productUrl must log NAV_FAILED fallback'
  );
  assert.ok(
    WM_SRC.includes('Queue timeout — no productUrl — releasing navigation lock'),
    'WM-6: checkout queue timeout without productUrl must log NAV_FAILED fallback'
  );
  for (const href of [
    'https://www.walmart.com/qp/waiting-room-timeout',
    'https://www.walmart.com/checkout/unmonitored-timeout',
  ]) {
    const normHref = normalizeProductUrl(href);
    const timeoutMsgs = [{ type: 'WALMART_NAV_FAILED', url: href }];
    const noProductInQ = new Set();
    const noProductNav = new Set([normHref]);
    for (const m of timeoutMsgs) {
      bgApplyWalmartMessage(noProductInQ, noProductNav, m);
    }
    assert.ok(
      !noProductInQ.has(normHref),
      `WM-6: queue timeout without productUrl must not arm inQueueUrls (${href})`
    );
    assert.ok(
      !noProductNav.has(normHref),
      `WM-6: queue timeout without productUrl releases navigationLock (${href})`
    );
  }
}

function runWm5SacredLockBlockTests() {
  const productUrl = 'https://www.walmart.com/ip/wm5-sacred-block/111222333';
  const norm = normalizeProductUrl(productUrl);
  const inQ = new Set();
  const navL = new Set();

  bgApplyWalmartMessage(inQ, navL, { type: 'WALMART_IN_QUEUE', url: productUrl });
  bgPollNavigate(navL, productUrl);
  assert.ok(inQ.has(norm), 'WM-5 setup: inQueueUrls armed');
  assert.ok(navL.has(norm), 'WM-5 setup: navigationLock armed');
  assert.equal(
    pollWouldSkipNavigation(norm, inQ, navL),
    true,
    'WM-5: inQueueUrls blocks poll navigate'
  );

  bgApplyWalmartMessage(inQ, navL, { type: 'WALMART_NAV_FAILED', url: productUrl });
  assert.ok(!navL.has(norm), 'WM-5: NAV_FAILED clears navigationLock');
  assert.ok(inQ.has(norm), 'WM-5: NAV_FAILED must not clear inQueueUrls');
  assert.equal(
    pollWouldSkipNavigation(norm, inQ, navL),
    true,
    'WM-5: sacred lock still blocks poll after NAV_FAILED'
  );

  const afterPoll = bgPollCycle(inQ, navL, productUrl);
  assert.equal(afterPoll.skipped, true, 'WM-5: poll cycle skips navigate while sacred lock holds');
  assert.ok(!navL.has(norm), 'WM-5: poll must not re-arm navigationLock while inQueueUrls holds');
  assert.ok(inQ.has(norm), 'WM-5: inQueueUrls unchanged after skipped poll cycle');

  // Retailer-neutral NAV_FAILED must behave like WALMART_NAV_FAILED while sacred lock holds (WM-5).
  navL.add(norm);
  bgApplyWalmartMessage(inQ, navL, { type: 'NAV_FAILED', url: productUrl });
  assert.ok(!navL.has(norm), 'WM-5: retailer-neutral NAV_FAILED clears navigationLock');
  assert.ok(inQ.has(norm), 'WM-5: retailer-neutral NAV_FAILED must not clear inQueueUrls');
  assert.equal(
    pollWouldSkipNavigation(norm, inQ, navL),
    true,
    'WM-5: sacred lock still blocks poll after retailer-neutral NAV_FAILED'
  );

  // Repeated NAV_FAILED while in queue must never clear sacred lock or re-arm navigationLock (WM-5).
  for (let i = 0; i < 3; i++) {
    navL.add(norm);
    bgApplyWalmartMessage(inQ, navL, {
      type: i % 2 === 0 ? 'WALMART_NAV_FAILED' : 'NAV_FAILED',
      url: productUrl,
    });
    assert.ok(!navL.has(norm), `WM-5: NAV_FAILED cycle ${i + 1} clears navigationLock`);
    assert.ok(inQ.has(norm), `WM-5: NAV_FAILED cycle ${i + 1} must not clear inQueueUrls`);
    const cyclePoll = bgPollCycle(inQ, navL, productUrl);
    assert.equal(cyclePoll.skipped, true, `WM-5: poll cycle ${i + 1} skips while sacred lock holds`);
    assert.ok(!navL.has(norm), `WM-5: poll cycle ${i + 1} must not re-arm navigationLock`);
  }
}

/** WM-5: queue wait timeout releases sacred lock so poll can recover. */
function runWm5QueueTimeoutTests() {
  const productUrl = 'https://www.walmart.com/ip/wm5-queue-timeout/444555666';
  const norm = normalizeProductUrl(productUrl);
  const inQ = new Set();
  const navL = new Set();

  assert.ok(
    WM_SRC.includes("type: 'WALMART_QUEUE_TIMEOUT'"),
    'WM-5: walmart-content.js must emit WALMART_QUEUE_TIMEOUT on queue timeout'
  );
  assert.ok(WM_SRC.includes('wmSignalQueueTimeout'), 'WM-5: wmSignalQueueTimeout helper defined');
  assert.ok(
    /async function wmWaitInProductQueue[\s\S]*?const maxWaitMs = wmQueueWaitTimeoutMs\(\)/.test(WM_SRC),
    'WM-5: wmWaitInProductQueue must use wmQueueWaitTimeoutMs (not hardcoded 45min)'
  );

  bgApplyWalmartMessage(inQ, navL, { type: 'WALMART_IN_QUEUE', url: productUrl });
  navL.add(norm);
  assert.ok(inQ.has(norm), 'WM-5 timeout setup: inQueueUrls armed');
  assert.ok(navL.has(norm), 'WM-5 timeout setup: navigationLock armed');

  bgApplyWalmartMessage(inQ, navL, { type: 'WALMART_QUEUE_TIMEOUT', url: productUrl });
  assert.ok(!inQ.has(norm), 'WM-5: WALMART_QUEUE_TIMEOUT clears inQueueUrls');
  assert.ok(!navL.has(norm), 'WM-5: WALMART_QUEUE_TIMEOUT clears navigationLock');

  const afterTimeoutPoll = bgPollCycle(inQ, navL, productUrl);
  assert.equal(afterTimeoutPoll.skipped, false, 'WM-5: poll can re-navigate after queue timeout');
  assert.ok(navL.has(norm), 'WM-5: poll re-arms navigationLock after queue timeout');

  // Contrast: transient NAV_FAILED must not clear sacred lock (WM-5 invariant).
  inQ.add(norm);
  navL.add(norm);
  bgApplyWalmartMessage(inQ, navL, { type: 'WALMART_NAV_FAILED', url: productUrl });
  assert.ok(inQ.has(norm), 'WM-5 contrast: NAV_FAILED must not clear inQueueUrls');
  assert.ok(!navL.has(norm), 'WM-5 contrast: NAV_FAILED clears navigationLock only');
}

async function main() {
  runPageTypeTests();
  runDispatchTests();
  await runFlowTests();
  runWm2PredropQueueTests();
  await runWm2FlowTests();
  runWm4SacredLockTests();
  runWm5SacredLockBlockTests();
  runWm5QueueTimeoutTests();
  runWm6CheckoutQueueLockTests();
  runWm6ErrorPathTests();
  console.log(
    'walmart-flow-simulation PASS (WM-1 + WM-2 + WM-4 + WM-5 + WM-6): page type, flow, queue, error paths'
  );
}

main().catch((e) => {
  console.error('walmart-flow-simulation FAIL:', e);
  process.exit(1);
});
