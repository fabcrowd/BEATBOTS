#!/usr/bin/env node
/**
 * WM-1 / WM-2 / WM-3 / WM-4: Offline Walmart journey simulations (no browser required).
 *
 * WM-1: walmart-content.js page detection + product → cart → checkout dispatch.
 * WM-2: pre-drop disabled ATC is not sacred queue lock.
 * WM-3: walmart-main-world.js Queue-it WebSocket sniff → TCH_QUEUE_PASSED.
 * WM-4: sacred lock (WALMART_IN_QUEUE → inQueueUrls) only after queue confirmed.
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

async function main() {
  runPageTypeTests();
  runDispatchTests();
  await runFlowTests();
  runWm2PredropQueueTests();
  await runWm2FlowTests();
  runWm3MainWorldQueueTests();
  runWm4SacredLockTests();
  console.log(
    'walmart-flow-simulation PASS (WM-1 + WM-2 + WM-3 + WM-4): page type, flow, pre-drop queue, WebSocket sniff, sacred lock'
  );
}

main().catch((e) => {
  console.error('walmart-flow-simulation FAIL:', e);
  process.exit(1);
});
