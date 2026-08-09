#!/usr/bin/env node
/**
 * WM-1 / WM-2 / WM-3 / WM-4: Offline Walmart journey simulations (no browser required).
 *
 * WM-1: walmart-content.js page detection + product → cart → checkout dispatch.
 * WM-2: pre-drop disabled ATC is not sacred queue lock.
 * WM-3: walmart-main-world.js Queue-it WebSocket sniff → TCH_QUEUE_PASSED.
 * WM-4: sacred lock (WALMART_IN_QUEUE → inQueueUrls) only after queue confirmed.
 * WM-5: sacred lock blocks poll re-navigation; NAV_FAILED clears navigationLock only.
 * WM-6: queue error paths — PX page wait/timeout NAV_FAILED; NAV_FAILED while not in queue.
 * WM-7: product-page __NEXT_DATA__ offerId → WM_OFFER_ID_READY updates monitor.products[].oid.
 *
 * Run: node scripts/browser-smoke/walmart-flow-simulation.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_WORLD_PATH = path.resolve(__dirname, '../../target-checkout-helper/walmart-main-world.js');

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

/** Mirrors wmInit PX branch — wait for redirect; no retry or sacred lock. */
function wmPxInitDecision(page) {
  if (!wmIsPxPage(page)) return { action: 'not_px', messages: [] };
  return { action: 'px_wait', messages: [] };
}

/**
 * Mirrors wmInit PX setTimeout (2min) — NAV_FAILED only if still on PX page.
 * @param {ReturnType<typeof makePage>} page
 * @param {number} elapsedMs
 */
function wmPxTimeoutMessages(page, elapsedMs = 120000) {
  if (elapsedMs < 120000) return [];
  if (!wmIsPxPage(page)) return [];
  return [{ type: 'WALMART_NAV_FAILED', url: `https://www.walmart.com${page.pathname}` }];
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
    messages.push({
      type: 'WALMART_IN_QUEUE',
      url: `https://www.walmart.com${page.pathname}`,
    });
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
async function wmHandleCartSim(page, settings) {
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
    return { path: 'checkout_not_found', actions };
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

/**
 * WM-3: Load walmart-main-world.js in a VM sandbox and assert Queue-it WebSocket
 * frames dispatch TCH_QUEUE_PASSED on document.documentElement.
 */
function runWm3MainWorldQueueTests() {
  const code = fs.readFileSync(MAIN_WORLD_PATH, 'utf8');
  let capturedEvents = [];

  class FakeWS {
    constructor(url) {
      this.url = url;
      this._listeners = {};
    }
    addEventListener(type, fn) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(fn);
    }
    _emit(type, data) {
      for (const fn of this._listeners[type] || []) fn(data);
    }
  }
  FakeWS.CONNECTING = 0;
  FakeWS.OPEN = 1;
  FakeWS.CLOSING = 2;
  FakeWS.CLOSED = 3;
  FakeWS.prototype.CONNECTING = 0;
  FakeWS.prototype.OPEN = 1;

  const docEl = {
    dispatchEvent(e) {
      capturedEvents.push(e);
    },
  };

  const sandbox = {
    window: { WebSocket: FakeWS },
    document: { documentElement: docEl },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
        this.bubbles = init?.bubbles;
        this.composed = init?.composed;
      }
    },
    console,
    JSON,
    String,
    RegExp,
  };
  sandbox.window.WebSocket = FakeWS;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const PatchedWS = sandbox.window.WebSocket;

  capturedEvents = [];
  const ws1 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws1._emit('message', { data: JSON.stringify({ type: 'queuePassed' }) });
  assert.equal(capturedEvents.length, 1, 'WM-3: queuePassed fires TCH_QUEUE_PASSED');
  assert.equal(capturedEvents[0]?.type, 'TCH_QUEUE_PASSED', 'WM-3: correct event type');
  assert.equal(capturedEvents[0]?.bubbles, true, 'WM-3: event bubbles');
  assert.equal(capturedEvents[0]?.composed, true, 'WM-3: event composed');

  capturedEvents = [];
  const ws2 = new PatchedWS('wss://queueit.example.com/ws');
  ws2._emit('message', { data: JSON.stringify({ type: 'QueuePassed' }) });
  assert.equal(capturedEvents.length, 1, 'WM-3: QueuePassed (capitalized) fires event');

  capturedEvents = [];
  const ws3 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws3._emit('message', { data: JSON.stringify({ position: 0 }) });
  assert.equal(capturedEvents.length, 1, 'WM-3: position 0 fires event');

  capturedEvents = [];
  const ws4 = new PatchedWS('wss://queue.it-service.com/ws');
  ws4._emit('message', { data: JSON.stringify({ queueState: 'passed' }) });
  assert.equal(capturedEvents.length, 1, 'WM-3: queueState passed fires event');

  capturedEvents = [];
  const ws5 = new PatchedWS('wss://www.walmart.com/api/cart');
  ws5._emit('message', { data: JSON.stringify({ type: 'queuePassed' }) });
  assert.equal(capturedEvents.length, 0, 'WM-3: non-queue URL ignored');

  capturedEvents = [];
  const ws6 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws6._emit('message', { data: new ArrayBuffer(8) });
  assert.equal(capturedEvents.length, 0, 'WM-3: binary message silently ignored');

  capturedEvents = [];
  const ws7 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws7._emit('message', { data: 'not-json{{{' });
  assert.equal(capturedEvents.length, 0, 'WM-3: invalid JSON silently ignored');

  capturedEvents = [];
  const ws8 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws8._emit('message', { data: JSON.stringify({ position: 5 }) });
  assert.equal(capturedEvents.length, 0, 'WM-3: position > 0 does not fire');

  assert.equal(PatchedWS.CONNECTING, 0, 'WM-3: CONNECTING constant preserved');
  assert.equal(PatchedWS.OPEN, 1, 'WM-3: OPEN constant preserved');
  assert.equal(PatchedWS.CLOSING, 2, 'WM-3: CLOSING constant preserved');
  assert.equal(PatchedWS.CLOSED, 3, 'WM-3: CLOSED constant preserved');
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

/** Mirrors background.js normalizeProductUrl + WALMART_IN_QUEUE handler. */
function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function bgApplyWalmartInQueue(inQueueUrls, message) {
  const normQueueUrl = normalizeProductUrl(message.url || '');
  if (normQueueUrl) inQueueUrls.add(normQueueUrl);
  return normQueueUrl;
}

/** Mirrors background.js poll loop skip checks (inQueueUrls / navigationLock). */
function bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock) {
  if (inQueueUrls.has(normUrl)) return true;
  if (navigationLock.has(normUrl)) return true;
  return false;
}

/** Mirrors background.js WALMART_NAV_FAILED handler — releases navigationLock only. */
function bgApplyWalmartNavFailed(navigationLock, inQueueUrls, message) {
  const normFailUrl = normalizeProductUrl(message.url || '');
  if (normFailUrl) navigationLock.delete(normFailUrl);
  return normFailUrl;
}

/** Mirrors background.js handleATCSuccess lock release — clears sacred lock for endless re-entry. */
function bgApplyAtcSuccess(navigationLock, inQueueUrls, message) {
  const normUrl = normalizeProductUrl(message.url || '');
  if (normUrl) {
    navigationLock.delete(normUrl);
    inQueueUrls.delete(normUrl);
  }
  return normUrl;
}

/** Mirrors wmHandleQueueRoom lock message — uses settings.productUrl, not /qp href. */
function wmQueueRoomSacredLockMessages(settings) {
  const lockUrl = settings?.productUrl;
  if (!lockUrl) return [];
  return [{ type: 'WALMART_IN_QUEUE', url: lockUrl }];
}

/** Mirrors wmHandleQueue lock message — product URL for poll matching. */
function wmCheckoutQueueSacredLockMessages(settings, locationHref) {
  const lockUrl = settings?.productUrl || locationHref;
  return [{ type: 'WALMART_IN_QUEUE', url: lockUrl }];
}

function runWm4SacredLockTests() {
  const inQueueUrls = new Set();

  // Pre-drop disabled ATC must not arm inQueueUrls
  const predropPage = makePage({
    pathname: '/ip/predrop-wm4/111',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  const predropDecision = wmDecideProductPageEntry(predropPage);
  assert.equal(predropDecision.action, 'atc_unavailable', 'WM-4: pre-drop disabled ATC is not sacred lock');
  for (const msg of predropDecision.messages) bgApplyWalmartInQueue(inQueueUrls, msg);
  assert.equal(inQueueUrls.size, 0, 'WM-4: pre-drop path must not populate inQueueUrls');

  // Confirmed product-page queue → WALMART_IN_QUEUE → inQueueUrls
  const productUrl = 'https://www.walmart.com/ip/confirmed-queue/456';
  const queuePage = makePage({
    pathname: '/ip/confirmed-queue/456',
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
  const queueDecision = wmDecideProductPageEntry(queuePage);
  assert.equal(queueDecision.action, 'sacred_queue_wait', 'WM-4: queue indicators arm sacred wait');
  const queueMsg = queueDecision.messages.find((m) => m.type === 'WALMART_IN_QUEUE');
  assert.ok(queueMsg?.url, 'WM-4: WALMART_IN_QUEUE includes product URL');
  const normProduct = bgApplyWalmartInQueue(inQueueUrls, queueMsg);
  assert.equal(normProduct, normalizeProductUrl(productUrl), 'WM-4: normalized product URL');
  assert.ok(inQueueUrls.has(normProduct), 'WM-4: confirmed queue adds inQueueUrls');

  // /qp waiting room locks settings.productUrl — not /qp path (poll keys by product URL)
  inQueueUrls.clear();
  const monitoredProduct = 'https://www.walmart.com/ip/wm4-qp-test/789/';
  const qpMessages = wmQueueRoomSacredLockMessages({ productUrl: monitoredProduct });
  assert.equal(qpMessages.length, 1, 'WM-4: queue room sends one lock message');
  assert.ok(
    !qpMessages[0].url.includes('/qp'),
    'WM-4: queue room lock uses productUrl not /qp href'
  );
  const normQp = bgApplyWalmartInQueue(inQueueUrls, qpMessages[0]);
  assert.equal(
    normQp,
    normalizeProductUrl(monitoredProduct),
    'WM-4: queue room normalizes trailing slash on productUrl'
  );
  assert.ok(inQueueUrls.has(normQp), 'WM-4: queue room arms inQueueUrls');

  // Queue room without productUrl — no lock (matches wmHandleQueueRoom warning path)
  assert.deepEqual(
    wmQueueRoomSacredLockMessages({}),
    [],
    'WM-4: queue room without productUrl sends no WALMART_IN_QUEUE'
  );

  // Checkout queue uses settings.productUrl for poll matching
  inQueueUrls.clear();
  const checkoutHref = 'https://www.walmart.com/checkout';
  const checkoutMessages = wmCheckoutQueueSacredLockMessages(
    { productUrl: monitoredProduct },
    checkoutHref
  );
  assert.equal(checkoutMessages[0].url, monitoredProduct, 'WM-4: checkout queue prefers productUrl');
  bgApplyWalmartInQueue(inQueueUrls, checkoutMessages[0]);
  assert.ok(inQueueUrls.has(normalizeProductUrl(monitoredProduct)), 'WM-4: checkout queue arms inQueueUrls');

  // Price guard alone must not arm sacred lock
  const pricePage = makePage({
    pathname: '/ip/price-wm4/999',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
      },
    ],
  });
  const priceDecision = wmDecideProductPageEntry(pricePage, {
    walmartMaxPrice: 40,
    currentPrice: 79.99,
  });
  assert.equal(priceDecision.action, 'price_guard_wait', 'WM-4: price guard is separate path');
  assert.ok(
    !priceDecision.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'WM-4: price guard must not send WALMART_IN_QUEUE'
  );

  // NAV_FAILED on pre-drop releases navigationLock only — must not add inQueueUrls
  const navFailMsg = predropDecision.messages.find((m) => m.type === 'WALMART_NAV_FAILED');
  assert.ok(navFailMsg, 'WM-4: pre-drop sends WALMART_NAV_FAILED instead of sacred lock');
  inQueueUrls.clear();
  bgApplyWalmartInQueue(inQueueUrls, navFailMsg);
  assert.equal(inQueueUrls.size, 0, 'WM-4: NAV_FAILED does not populate inQueueUrls');
}

function runWm6QueueErrorPathTests() {
  const hangTightPage = makePage({
    pathname: '/ip/wm6-px-hang-tight/101',
    bodyText: 'Hang tight! We are loading your experience.',
  });
  assert.ok(wmIsPxPage(hangTightPage), 'WM-6: hang tight + loading text is PX page');
  const hangTightDecision = wmPxInitDecision(hangTightPage);
  assert.equal(hangTightDecision.action, 'px_wait', 'WM-6: PX page waits for redirect');
  assert.equal(hangTightDecision.messages.length, 0, 'WM-6: PX wait does not send messages immediately');
  assert.deepEqual(
    wmPxTimeoutMessages(hangTightPage, 119000),
    [],
    'WM-6: PX timeout does not fire before 2min'
  );

  const loadingPage = makePage({
    pathname: '/ip/wm6-px-loading/102',
    bodyText: "We're loading your experience — please wait.",
  });
  assert.ok(wmIsPxPage(loadingPage), 'WM-6: loading experience text is PX page');
  const pxCaptchaPage = makePage({
    pathname: '/ip/wm6-px-captcha/103',
    elements: [{ selectors: ['#px-captcha'], tag: 'div' }],
  });
  assert.ok(wmIsPxPage(pxCaptchaPage), 'WM-6: #px-captcha element is PX page');

  const normalProduct = makePage({
    pathname: '/ip/wm6-normal/104',
    bodyText: 'Add to cart',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
      },
    ],
  });
  assert.ok(!wmIsPxPage(normalProduct), 'WM-6: normal product page is not PX');
  assert.equal(wmPxInitDecision(normalProduct).action, 'not_px', 'WM-6: non-PX proceeds past PX guard');

  // PX timeout after 2min while still on PX → NAV_FAILED (not sacred lock).
  const timeoutMsgs = wmPxTimeoutMessages(pxCaptchaPage, 120000);
  assert.equal(timeoutMsgs.length, 1, 'WM-6: PX still showing after 2min sends NAV_FAILED');
  assert.equal(timeoutMsgs[0].type, 'WALMART_NAV_FAILED', 'WM-6: PX timeout message type');
  const inQueueUrls = new Set();
  const navigationLock = new Set();
  const normPx = normalizeProductUrl(timeoutMsgs[0].url);
  navigationLock.add(normPx);
  assert.equal(inQueueUrls.size, 0, 'WM-6: PX timeout NAV_FAILED does not arm sacred lock');
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, timeoutMsgs[0]);
  assert.ok(!navigationLock.has(normPx), 'WM-6: PX timeout NAV_FAILED releases navigationLock');
  assert.ok(
    !bgPollWouldSkipNavigation(normPx, inQueueUrls, navigationLock),
    'WM-6: poll may retry after PX timeout when not in queue'
  );

  // WM-6 + WM-5: PX timeout while sacred lock active — NAV_FAILED releases nav lock only.
  const queuePxUrl = 'https://www.walmart.com/ip/wm6-px-sacred-lock/107';
  const queuePxNorm = normalizeProductUrl(queuePxUrl);
  const queuePxPage = makePage({
    pathname: '/ip/wm6-px-sacred-lock/107',
    elements: [{ selectors: ['#px-captcha'], tag: 'div' }],
  });
  inQueueUrls.clear();
  navigationLock.clear();
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: queuePxUrl });
  navigationLock.add(queuePxNorm);
  const queuePxTimeoutMsgs = wmPxTimeoutMessages(queuePxPage, 120000);
  assert.equal(queuePxTimeoutMsgs.length, 1, 'WM-6: PX timeout fires while sacred lock active');
  assert.equal(queuePxTimeoutMsgs[0].type, 'WALMART_NAV_FAILED', 'WM-6: sacred-lock PX timeout is NAV_FAILED');
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, queuePxTimeoutMsgs[0]);
  assert.ok(inQueueUrls.has(queuePxNorm), 'WM-6: PX timeout must not clear sacred lock');
  assert.ok(!navigationLock.has(queuePxNorm), 'WM-6: PX timeout releases navigationLock during queue');
  assert.ok(
    bgPollWouldSkipNavigation(queuePxNorm, inQueueUrls, navigationLock),
    'WM-6: poll still blocked after PX timeout while sacred lock active'
  );

  // PX cleared before timeout — no NAV_FAILED (redirect succeeded).
  const clearedPxPage = makePage({
    pathname: '/ip/wm6-px-cleared/105',
    bodyText: 'Add to cart',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
      },
    ],
  });
  assert.deepEqual(
    wmPxTimeoutMessages(clearedPxPage, 120000),
    [],
    'WM-6: no NAV_FAILED when PX page cleared before timeout'
  );

  // NAV_FAILED on pre-drop (not in queue) — release lock, no sacred lock, poll may retry.
  const predropPage = makePage({
    pathname: '/ip/wm6-predrop/106',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  const predropDecision = wmDecideProductPageEntry(predropPage);
  assert.equal(predropDecision.action, 'atc_unavailable', 'WM-6: pre-drop is not queue');
  const navFail = predropDecision.messages.find((m) => m.type === 'WALMART_NAV_FAILED');
  assert.ok(navFail, 'WM-6: pre-drop sends NAV_FAILED');
  assert.ok(
    !predropDecision.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'WM-6: pre-drop NAV_FAILED is not sacred lock'
  );
  inQueueUrls.clear();
  navigationLock.clear();
  const normPredrop = normalizeProductUrl(`https://www.walmart.com${predropPage.pathname}`);
  navigationLock.add(normPredrop);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: `https://www.walmart.com${predropPage.pathname}`,
  });
  assert.equal(inQueueUrls.size, 0, 'WM-6: NAV_FAILED while not in queue keeps inQueueUrls empty');
  assert.ok(
    !bgPollWouldSkipNavigation(normPredrop, inQueueUrls, navigationLock),
    'WM-6: NAV_FAILED while not in queue allows poll retry'
  );
}

/** Mirrors walmart-content.js __NEXT_DATA__ OID extraction on product pages. */
function wmExtractPageOidFromNextData(nextData) {
  try {
    return (
      nextData?.props?.pageProps?.initialData?.data?.product?.primaryOffer?.offerId || null
    );
  } catch {
    return null;
  }
}

/**
 * Mirrors _wmInit product-page branch — send WM_OFFER_ID_READY when page OID differs.
 * @param {{ pageOid: string|null, storedOid: string|null, url: string }} opts
 */
function wmDecideOfferIdReadyMessage({ pageOid, storedOid, url }) {
  if (!pageOid || pageOid === storedOid) return null;
  return { type: 'WM_OFFER_ID_READY', offerId: pageOid, url };
}

/**
 * Mirrors background.js WM_OFFER_ID_READY handler.
 * @param {{ active?: boolean, products?: Array<{ url: string, oid?: string|null }> }} monitor
 * @param {{ offerId: string, url: string }} message
 */
function bgApplyWalmartOfferIdReady(monitor, message) {
  const mon = monitor || { products: [] };
  const normUrl = normalizeProductUrl(message.url || '');
  let updated = false;
  for (const p of mon.products || []) {
    if (normalizeProductUrl(p.url) === normUrl && p.oid !== message.offerId) {
      p.oid = message.offerId;
      updated = true;
    }
  }
  return { updated, monitor: mon };
}

function runWm7OfferIdReadyTests() {
  const nextData = {
    props: {
      pageProps: {
        initialData: {
          data: {
            product: {
              primaryOffer: { offerId: 'OFFER-WM7-ABC123' },
            },
          },
        },
      },
    },
  };
  const pageOid = wmExtractPageOidFromNextData(nextData);
  assert.equal(pageOid, 'OFFER-WM7-ABC123', 'WM-7: extracts offerId from __NEXT_DATA__');
  assert.equal(wmExtractPageOidFromNextData(null), null, 'WM-7: missing __NEXT_DATA__ returns null');
  assert.equal(
    wmExtractPageOidFromNextData({ props: { pageProps: {} } }),
    null,
    'WM-7: incomplete __NEXT_DATA__ returns null'
  );

  const productUrl = 'https://www.walmart.com/ip/wm7-product/999';
  const readyMsg = wmDecideOfferIdReadyMessage({
    pageOid,
    storedOid: null,
    url: productUrl,
  });
  assert.ok(readyMsg, 'WM-7: sends WM_OFFER_ID_READY when stored oid is missing');
  assert.equal(readyMsg.type, 'WM_OFFER_ID_READY');
  assert.equal(readyMsg.offerId, pageOid);

  assert.equal(
    wmDecideOfferIdReadyMessage({ pageOid, storedOid: pageOid, url: productUrl }),
    null,
    'WM-7: does not send when stored oid already matches'
  );
  assert.equal(
    wmDecideOfferIdReadyMessage({ pageOid: null, storedOid: null, url: productUrl }),
    null,
    'WM-7: does not send when page oid is missing'
  );

  const monitor = {
    active: true,
    products: [
      { url: productUrl, oid: null, qty: 1 },
      { url: 'https://www.walmart.com/ip/other/111', oid: 'OTHER-OID', qty: 1 },
    ],
  };
  const apply = bgApplyWalmartOfferIdReady(monitor, readyMsg);
  assert.ok(apply.updated, 'WM-7: background updates matching product oid');
  assert.equal(apply.monitor.products[0].oid, pageOid, 'WM-7: monitor.products[].oid set');
  assert.equal(apply.monitor.products[1].oid, 'OTHER-OID', 'WM-7: unrelated product oid unchanged');

  const noChange = bgApplyWalmartOfferIdReady(apply.monitor, readyMsg);
  assert.ok(!noChange.updated, 'WM-7: background skips when oid already matches');

  const trailingUrl = 'https://www.walmart.com/ip/wm7-product/999/';
  const trailingMsg = wmDecideOfferIdReadyMessage({
    pageOid: 'OFFER-TRAILING',
    storedOid: null,
    url: trailingUrl,
  });
  const trailingApply = bgApplyWalmartOfferIdReady(
    { products: [{ url: productUrl, oid: null }] },
    trailingMsg
  );
  assert.ok(trailingApply.updated, 'WM-7: URL normalization matches trailing slash');
  assert.equal(trailingApply.monitor.products[0].oid, 'OFFER-TRAILING');
}

function runWm5SacredLockNavTests() {
  const productUrl = 'https://www.walmart.com/ip/wm5-sacred-lock/555';
  const normUrl = normalizeProductUrl(productUrl);
  const inQueueUrls = new Set();
  const navigationLock = new Set();

  // Sacred lock alone blocks poll re-navigation (no navigationLock required).
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
  assert.ok(inQueueUrls.has(normUrl), 'WM-5: sacred lock arms inQueueUrls');
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: inQueueUrls blocks poll navigate without navigationLock'
  );

  // navigationLock alone also blocks poll (pre-sacred-lock loading state).
  inQueueUrls.clear();
  navigationLock.add(normUrl);
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: navigationLock blocks poll navigate'
  );
  assert.ok(!inQueueUrls.has(normUrl), 'WM-5: navigationLock alone is not sacred lock');

  // WALMART_NAV_FAILED clears navigationLock only — sacred lock survives.
  inQueueUrls.add(normUrl);
  navigationLock.add(normUrl);
  const navFailed = bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: productUrl,
  });
  assert.equal(navFailed, normUrl, 'WM-5: NAV_FAILED normalizes product URL');
  assert.ok(!navigationLock.has(normUrl), 'WM-5: NAV_FAILED releases navigationLock');
  assert.ok(inQueueUrls.has(normUrl), 'WM-5: NAV_FAILED must not clear inQueueUrls');
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll still skips after NAV_FAILED while sacred lock active'
  );

  // Simulated restock cycle: poll would navigate only when both locks are clear.
  inQueueUrls.clear();
  navigationLock.clear();
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll may navigate when no locks held'
  );
  navigationLock.add(normUrl);
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll sets navigationLock after navigate — blocks repeat'
  );
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: productUrl,
  });
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: after NAV_FAILED without sacred lock, poll may retry'
  );

  // PX timeout on queue page: NAV_FAILED must not destroy queue position lock.
  inQueueUrls.clear();
  navigationLock.clear();
  const queuePage = makePage({
    pathname: '/ip/wm5-queue/777',
    bodyText: "You're in line — estimated wait time 5 minutes",
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  const queueDecision = wmDecideProductPageEntry(queuePage);
  assert.equal(queueDecision.action, 'sacred_queue_wait', 'WM-5: queue page arms sacred wait');
  const queueMsg = queueDecision.messages.find((m) => m.type === 'WALMART_IN_QUEUE');
  const queueNorm = bgApplyWalmartInQueue(inQueueUrls, queueMsg);
  navigationLock.add(queueNorm);
  const pxFail = queueDecision.messages.find((m) => m.type === 'WALMART_NAV_FAILED');
  assert.ok(!pxFail, 'WM-5: sacred queue wait does not send NAV_FAILED on entry');
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: queueMsg.url,
  });
  assert.ok(inQueueUrls.has(queueNorm), 'WM-5: PX/NAV failure during queue keeps sacred lock');
  assert.ok(
    bgPollWouldSkipNavigation(queueNorm, inQueueUrls, navigationLock),
    'WM-5: poll cannot re-navigate tab while user holds queue position'
  );

  // WM-5: ATC_SUCCESS after queue clears sacred lock — endless mode may re-enter queue.
  inQueueUrls.clear();
  navigationLock.clear();
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
  navigationLock.add(normUrl);
  assert.ok(inQueueUrls.has(normUrl), 'WM-5: sacred lock armed before ATC_SUCCESS');
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll blocked while sacred lock active'
  );
  bgApplyAtcSuccess(navigationLock, inQueueUrls, { type: 'ATC_SUCCESS', url: productUrl });
  assert.ok(!inQueueUrls.has(normUrl), 'WM-5: ATC_SUCCESS clears inQueueUrls after queue');
  assert.ok(!navigationLock.has(normUrl), 'WM-5: ATC_SUCCESS clears navigationLock');
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll may navigate after ATC_SUCCESS releases sacred lock'
  );

  // WM-5: multiple NAV_FAILED while sacred lock active — inQueueUrls must survive.
  inQueueUrls.clear();
  navigationLock.clear();
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
  navigationLock.add(normUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: productUrl,
  });
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: productUrl,
  });
  assert.ok(inQueueUrls.has(normUrl), 'WM-5: repeated NAV_FAILED must not clear sacred lock');
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll still blocked after repeated NAV_FAILED during queue'
  );
}

async function main() {
  runPageTypeTests();
  runDispatchTests();
  await runFlowTests();
  runWm2PredropQueueTests();
  await runWm2FlowTests();
  runWm3MainWorldQueueTests();
  runWm4SacredLockTests();
  runWm5SacredLockNavTests();
  runWm6QueueErrorPathTests();
  runWm7OfferIdReadyTests();
  console.log(
    'walmart-flow-simulation PASS (WM-1 + WM-2 + WM-3 + WM-4 + WM-5 + WM-6 + WM-7): page type, flow, pre-drop queue, WebSocket sniff, sacred lock, nav guard, queue error paths, offerId ready'
  );
}

main().catch((e) => {
  console.error('walmart-flow-simulation FAIL:', e);
  process.exit(1);
});
