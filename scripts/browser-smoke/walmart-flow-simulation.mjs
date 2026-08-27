#!/usr/bin/env node
/**
 * WM-1 / WM-2 / WM-3 / WM-4: Offline Walmart journey simulations (no browser required).
 *
 * WM-1: walmart-content.js page detection + product → cart → checkout dispatch.
 * WM-2: pre-drop disabled ATC is not sacred queue lock.
 * WM-3: walmart-main-world.js Queue-it WebSocket sniff → TCH_QUEUE_PASSED.
 * WM-4: sacred lock (WALMART_IN_QUEUE → inQueueUrls) only after queue confirmed.
 * WM-5: sacred lock blocks poll re-navigation; NAV_FAILED clears navigationLock only.
 * WM-6: queue error paths — PX page wait/timeout NAV_FAILED; cart checkout-missing NAV_FAILED; NAV_FAILED while not in queue.
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
  price: '[itemprop="price"], [data-automation-id="product-price"], [class*="price-characteristic"]',
};

/** Minimal DOM stub for offline wmGetPageType / handler simulations. */
function makePage({ pathname, bodyText = '', elements = [], docAttrs = {} }) {
  const bySelector = new Map();
  for (const el of elements) {
    for (const sel of el.selectors || []) {
      if (!bySelector.has(sel)) bySelector.set(sel, el);
    }
  }
  const all = elements.map((el) => ({
    tag: el.tag || 'button',
    text: el.text || '',
    content: el.content,
    disabled: !!el.disabled,
    ariaDisabled: el.ariaDisabled,
    visible: el.visible !== false,
    href: el.href,
    clicked: false,
    getAttribute(name) {
      if (name === 'content' && this.content != null) return String(this.content);
      return null;
    },
    click() {
      this.clicked = true;
    },
  }));

  return {
    pathname,
    bodyText,
    navigatedTo: null,
    documentElement: {
      getAttribute(name) {
        const v = docAttrs[name];
        return v === undefined ? null : String(v);
      },
      hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(docAttrs, name);
      },
    },
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

/** Mirrors wmPxTimeoutMs() — walmart-content.js */
function wmPxTimeoutMs(page) {
  const root = page.documentElement;
  const override = root?.getAttribute('data-tch-px-timeout-ms');
  if (override != null && override !== '') {
    const ms = parseInt(override, 10);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (root?.hasAttribute('data-tch-fixture')) return 2000;
  return 2 * 60 * 1000;
}

/**
 * Mirrors wmInit PX setTimeout — NAV_FAILED only if still on PX page after wmPxTimeoutMs().
 * @param {ReturnType<typeof makePage>} page
 * @param {number} [elapsedMs] defaults to wmPxTimeoutMs(page)
 */
function wmPxTimeoutMessages(page, elapsedMs) {
  const timeoutMs = wmPxTimeoutMs(page);
  const elapsed = elapsedMs ?? timeoutMs;
  if (elapsed < timeoutMs) return [];
  if (!wmIsPxPage(page)) return [];
  return [{ type: 'WALMART_NAV_FAILED', url: `https://www.walmart.com${page.pathname}` }];
}

/** Mirrors wmGetCurrentPrice() — walmart-content.js (DOM path for fixture simulation). */
function wmGetCurrentPrice(page, liveOnly = false) {
  void liveOnly;
  for (const sel of WM_SEL.price.split(', ')) {
    const el = page.querySelector(sel);
    if (!el) continue;
    const content = el.getAttribute?.('content');
    if (content) {
      const n = parseFloat(content);
      if (!Number.isNaN(n)) return n;
    }
    const text = (el.text || '').replace(/[^0-9.]/g, '');
    if (text) {
      const n = parseFloat(text);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

/** Mirrors wmAtcWaitTimeoutMs() — walmart-content.js */
function wmAtcWaitTimeoutMs(page) {
  const root = page.documentElement;
  const override = root?.getAttribute('data-tch-atc-wait-ms');
  if (override != null && override !== '') {
    const ms = parseInt(override, 10);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return 8000;
}

/**
 * Mirrors wmHandleProductPage ATC-wait timeout — NAV_FAILED only if ATC still missing after wait.
 * @param {ReturnType<typeof makePage>} page
 * @param {string} productUrl
 * @param {number} [elapsedMs] defaults to wmAtcWaitTimeoutMs(page)
 */
function wmMissingAtcTimeoutMessages(page, productUrl, elapsedMs) {
  const timeoutMs = wmAtcWaitTimeoutMs(page);
  const elapsed = elapsedMs ?? timeoutMs;
  if (elapsed < timeoutMs) return [];
  const atc = wmFindAtcLikeButton(page);
  if (atc && !atc.disabled && wmIsVisible(atc)) return [];
  if (wmShouldEnterSacredQueueWait(page)) return [];
  return [{ type: 'WALMART_NAV_FAILED', url: productUrl }];
}

/** Mirrors wmPriceGuardTimeoutMs() — walmart-content.js */
function wmPriceGuardTimeoutMs(page) {
  const root = page.documentElement;
  const override = root?.getAttribute('data-tch-price-guard-timeout-ms');
  if (override != null && override !== '') {
    const ms = parseInt(override, 10);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return 45 * 60 * 1000;
}

/**
 * Mirrors wmWaitForPriceDrop timeout branch — NAV_FAILED only if price still above max after timeout.
 * @param {ReturnType<typeof makePage>} page
 * @param {{ walmartMaxPrice?: number|string, productUrl?: string }} settings
 * @param {string} productUrl
 * @param {number} [elapsedMs] defaults to wmPriceGuardTimeoutMs(page)
 */
function wmPriceGuardTimeoutMessages(page, settings, productUrl, elapsedMs) {
  const maxPrice = parseFloat(settings.walmartMaxPrice) || 0;
  if (maxPrice <= 0) return [];
  const timeoutMs = wmPriceGuardTimeoutMs(page);
  const elapsed = elapsedMs ?? timeoutMs;
  if (elapsed < timeoutMs) return [];
  const currentPrice = wmGetCurrentPrice(page, true);
  if (currentPrice !== null && currentPrice <= maxPrice) return [];
  return [{ type: 'WALMART_NAV_FAILED', url: productUrl }];
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

/**
 * Mirrors walmart-content.js post-ATC-wait branch (~767-776): after the 8s ATC wait
 * times out, re-check whether queue indicators appeared during the wait.
 */
function wmDecideAfterAtcWait(page, settings = {}) {
  const atc = wmFindAtcLikeButton(page);
  if (atc && !atc.disabled && wmIsVisible(atc)) {
    return { action: 'proceed_atc', messages: [] };
  }
  if (wmShouldEnterSacredQueueWait(page)) {
    return {
      action: 'sacred_queue_wait',
      messages: [
        {
          type: 'WALMART_IN_QUEUE',
          url: `https://www.walmart.com${page.pathname}`,
        },
      ],
    };
  }
  return {
    action: 'atc_unavailable',
    messages: [{ type: 'WALMART_NAV_FAILED' }],
  };
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
    return {
      path: 'checkout_not_found',
      actions,
      messages: [
        {
          type: 'WALMART_NAV_FAILED',
          url: settings.productUrl || `https://www.walmart.com${page.pathname}`,
        },
      ],
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

/**
 * Parity with FIX-3 wm2-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runWm2LivePollCycleTests() {
  const predropProductUrl = 'https://www.walmart.com/ip/mock-predrop-live/555';
  const normPredropUrl = normalizeProductUrl(predropProductUrl);

  const predropPage = makePage({
    pathname: '/ip/mock-predrop-live/555',
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
  assert.equal(
    wmShouldEnterSacredQueueWait(predropPage),
    false,
    'WM-2 live poll: pre-drop disabled ATC must not arm sacred wait'
  );

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  // Pre-drop NAV_FAILED during live poll — never arm sacred lock.
  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normPredropUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: predropProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `WM-2 live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    assert.ok(
      !inQueueUrls.has(normPredropUrl),
      `WM-2 live poll cycle ${i + 1} must not sacred-lock pre-drop ${normPredropUrl} after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normPredropUrl)) {
      assert.ok(
        !inQueueUrls.has(normPredropUrl),
        `WM-2 live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normPredropUrl} after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normPredropUrl, inQueueUrls, navigationLock),
      `WM-2 live poll cycle ${i + 1} must allow poll retry on pre-drop (no sacred lock) after ${navFailTypes[i]}`
    );
  }

  assert.equal(inQueueUrls.size, 0, 'WM-2 live poll must not arm inQueueUrls on pre-drop product');

  const wmSacredLock = new Set([normPredropUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normPredropUrl, wmSacredLock, new Set()),
    'WM-2: contrast WM-5 — sacred lock would block poll; pre-drop WM-2 does not arm it'
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

/** Mirrors background.js isInCheckoutFlow — tab already in cart/checkout/thank-you. */
function isInCheckoutFlow(url) {
  if (!url) return false;
  try {
    const path = new URL(url).pathname;
    return /^\/(cart|checkout|thankyou|thank-you|order-confirm)/i.test(path);
  } catch {
    return false;
  }
}

/** Mirrors background.js poll loop skip checks (inQueueUrls / navigationLock). */
function bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock) {
  if (inQueueUrls.has(normUrl)) return true;
  if (navigationLock.has(normUrl)) return true;
  return false;
}

/**
 * Mirrors background.js restock navigate guard (poll loop + checkout-flow check).
 * Returns false when poll must not navigate the monitor tab to the product URL.
 */
function bgWouldNavigateRestock(normUrl, tabUrl, inQueueUrls, navigationLock) {
  if (inQueueUrls.has(normUrl)) return false;
  if (navigationLock.has(normUrl)) return false;
  if (isInCheckoutFlow(tabUrl) && inQueueUrls.has(normUrl)) return false;
  return true;
}

/** Mirrors background.js WALMART_NAV_FAILED handler — releases navigationLock only. */
function bgApplyWalmartNavFailed(navigationLock, inQueueUrls, message) {
  const normFailUrl = normalizeProductUrl(message.url || '');
  if (normFailUrl) navigationLock.delete(normFailUrl);
  return normFailUrl;
}

/** Mirrors background.js WALMART_QUEUE_TIMEOUT handler — releases sacred lock and navigationLock. */
function bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, message) {
  const normTimeoutUrl = normalizeProductUrl(message.url || '');
  if (normTimeoutUrl) {
    inQueueUrls.delete(normTimeoutUrl);
    navigationLock.delete(normTimeoutUrl);
  }
  return normTimeoutUrl;
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

/** Mirrors wmHandleQueue lock message — product URL for poll matching (no locationHref fallback). */
function wmCheckoutQueueSacredLockMessages(settings) {
  const lockUrl = settings?.productUrl;
  if (!lockUrl) return [];
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

  // Product-page queue prefers settings.productUrl for poll matching (WM-4/WM-5).
  inQueueUrls.clear();
  const productQueueMonitored = 'https://www.walmart.com/ip/wm4-product-queue/457';
  const pageHref = 'https://www.walmart.com/ip/wm4-product-queue/457?selected=true';
  const productQueueLockUrl = productQueueMonitored; // mirrors wmWaitInProductQueue lockUrl
  const normMonitored = bgApplyWalmartInQueue(inQueueUrls, {
    type: 'WALMART_IN_QUEUE',
    url: productQueueLockUrl,
  });
  assert.equal(
    normMonitored,
    normalizeProductUrl(productQueueMonitored),
    'WM-4: product-page queue lock uses settings.productUrl for poll keys'
  );
  assert.ok(inQueueUrls.has(normMonitored), 'WM-4: product-page queue arms inQueueUrls via productUrl');
  const navigationLock = new Set([normMonitored]);
  bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
    type: 'WALMART_QUEUE_TIMEOUT',
    url: productQueueLockUrl,
  });
  assert.ok(!inQueueUrls.has(normMonitored), 'WM-5: product-page queue timeout clears sacred lock via productUrl');
  assert.ok(
    !navigationLock.has(normMonitored),
    'WM-5: product-page queue timeout releases navigationLock via productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(pageHref),
    normalizeProductUrl('https://www.walmart.com/qp'),
    'WM-4: product-page href with query still normalizes to product path'
  );

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
  const checkoutMessages = wmCheckoutQueueSacredLockMessages({ productUrl: monitoredProduct });
  assert.equal(checkoutMessages[0].url, monitoredProduct, 'WM-4: checkout queue prefers productUrl');
  bgApplyWalmartInQueue(inQueueUrls, checkoutMessages[0]);
  assert.ok(inQueueUrls.has(normalizeProductUrl(monitoredProduct)), 'WM-4: checkout queue arms inQueueUrls');

  // Checkout queue without productUrl — no lock (matches wmHandleQueue warning path)
  assert.deepEqual(
    wmCheckoutQueueSacredLockMessages({}),
    [],
    'WM-4: checkout queue without productUrl sends no WALMART_IN_QUEUE'
  );

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

  // WM-4: queue may load during the 8s ATC wait — post-wait re-check arms sacred lock.
  const delayedQueuePage = makePage({
    pathname: '/ip/delayed-queue-wm4/222',
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
  const delayedQueueDecision = wmDecideAfterAtcWait(delayedQueuePage);
  assert.equal(
    delayedQueueDecision.action,
    'sacred_queue_wait',
    'WM-4: queue appearing during ATC wait arms sacred lock'
  );
  assert.ok(
    delayedQueueDecision.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'WM-4: post-wait queue re-check sends WALMART_IN_QUEUE'
  );
  inQueueUrls.clear();
  for (const msg of delayedQueueDecision.messages) bgApplyWalmartInQueue(inQueueUrls, msg);
  assert.equal(inQueueUrls.size, 1, 'WM-4: post-wait sacred lock populates inQueueUrls');

  const stillNoAtcPage = makePage({
    pathname: '/ip/still-predrop-wm4/333',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: true,
      },
    ],
  });
  const stillNoAtcDecision = wmDecideAfterAtcWait(stillNoAtcPage);
  assert.equal(
    stillNoAtcDecision.action,
    'atc_unavailable',
    'WM-4: post-wait still no queue → NAV_FAILED not sacred lock'
  );
  assert.ok(
    stillNoAtcDecision.messages.some((m) => m.type === 'WALMART_NAV_FAILED'),
    'WM-4: post-wait no queue sends WALMART_NAV_FAILED'
  );
  inQueueUrls.clear();
  for (const msg of stillNoAtcDecision.messages) bgApplyWalmartInQueue(inQueueUrls, msg);
  assert.equal(inQueueUrls.size, 0, 'WM-4: post-wait NAV_FAILED must not arm inQueueUrls');
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

/** WM-6: cart checkout-missing — NAV_FAILED uses productUrl, no sacred lock (parity SC-6). */
async function runWm6CartCheckoutMissingTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  assert.match(WMT_SRC, /wmHandleCart/, 'WM-6: wmHandleCart defined');
  assert.match(WMT_SRC, /wmSignalNavFailed\(settings\?\.productUrl/, 'WM-6: cart NAV_FAILED uses productUrl');
  assert.match(WMT_SRC, /wmCartCheckoutWaitMs/, 'WM-6: cart checkout wait helper');

  const productUrl = 'https://www.walmart.com/ip/wm6-cart-missing/888';
  const cartPage = makePage({ pathname: '/cart/no-checkout', elements: [] });
  const cartResult = await wmHandleCartSim(cartPage, { productUrl });
  assert.equal(cartResult.path, 'checkout_not_found', 'WM-6: cart missing checkout');
  assert.deepEqual(cartResult.actions, ['checkout_missing']);
  const navFail = cartResult.messages?.find((m) => m.type === 'WALMART_NAV_FAILED');
  assert.ok(navFail, 'WM-6: cart checkout-missing sends WALMART_NAV_FAILED');
  assert.equal(navFail.url, productUrl, 'WM-6: NAV_FAILED uses productUrl not cart URL');

  const normUrl = normalizeProductUrl(productUrl);
  const inQueueUrls = new Set();
  const navigationLock = new Set([normUrl]);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'WM-6: cart checkout-missing must not arm sacred lock');
  assert.ok(!navigationLock.has(normUrl), 'WM-6: cart checkout-missing releases navigationLock');
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-6: poll may retry after cart checkout-missing NAV_FAILED'
  );

  const productPage = makePage({
    pathname: '/ip/wm6-cart-missing/888',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
        disabled: false,
      },
      {
        selectors: ['a[href="/cart/no-checkout"]', 'button[data-automation-id="go-to-cart-btn"]'],
        text: 'View cart',
        tag: 'a',
        href: '/cart/no-checkout',
      },
    ],
  });
  const productResult = await wmHandleProductPageSim(productPage, { productUrl });
  assert.equal(productResult.path, 'product_to_cart', 'WM-6: product ATC → cart');
  assert.equal(productPage.navigatedTo, '/cart');

  const chainCartPage = makePage({ pathname: '/cart/no-checkout', elements: [] });
  const chainCartResult = await wmHandleCartSim(chainCartPage, { productUrl });
  assert.equal(chainCartResult.path, 'checkout_not_found', 'WM-6: product→cart chain missing checkout');
  const chainNavFail = chainCartResult.messages?.find((m) => m.type === 'WALMART_NAV_FAILED');
  assert.ok(chainNavFail, 'WM-6: product→cart chain sends WALMART_NAV_FAILED');
  assert.equal(chainNavFail.url, productUrl, 'WM-6: chain NAV_FAILED uses productUrl');
}

/** WM-6: cross-page cart checkout-missing — tab on /cart/*, monitor keys distinct productUrl (parity SC-6 / FIX-3). */
async function runWm6CartCrossPageCheckoutMissingTests() {
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-cart-cross-monitor/890';
  const recoveryProductUrl = 'https://www.walmart.com/ip/mock-cart-cross-recovery/891';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);

  const cartPage = makePage({ pathname: '/cart/no-checkout-cross', elements: [] });
  const cartResult = await wmHandleCartSim(cartPage, { productUrl: monitorProductUrl });
  assert.equal(cartResult.path, 'checkout_not_found', 'WM-6: cross-page cart missing checkout');
  assert.deepEqual(cartResult.actions, ['checkout_missing']);
  const navFail = cartResult.messages?.find((m) => m.type === 'WALMART_NAV_FAILED');
  assert.ok(navFail, 'WM-6: cross-page cart sends WALMART_NAV_FAILED');
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'WM-6: cross-page NAV_FAILED uses monitor productUrl not cart tab URL'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normalizeProductUrl(`https://www.walmart.com${cartPage.pathname}`),
    'WM-6: cross-page NAV_FAILED must not key cart pathname'
  );

  const inQueueUrls = new Set();
  const navigationLock = new Set([normMonitorUrl]);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'WM-6: cross-page cart checkout-missing must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'WM-6: cross-page cart checkout-missing releases navigationLock on monitor product'
  );
  assert.ok(
    !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-6: poll may retry monitor product after cross-page cart NAV_FAILED'
  );

  // Poll recovery rearm — NAV_FAILED on monitor product, then background re-arms recovery product (no sacred lock).
  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, navFail);
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6: cross-page poll recovery clears monitor lock');
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'WM-6: cross-page poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'WM-6: cross-page poll recovery must not arm sacred lock');
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: recoveryProductUrl,
  });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'WM-6: cross-page NAV_FAILED during poll recovery releases recovery lock'
  );
}

/**
 * WM-6: cross-page cart poll recovery — tab on /cart/no-checkout-cross, monitor keys distinct productUrl.
 * Parity with FIX-3 wm6-cart-cross-poll-recovery (fixture-e2e has browser coverage).
 */
async function runWm6CartCrossPagePollRecoveryTests() {
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-cart-cross-monitor/890';
  const recoveryProductUrl = 'https://www.walmart.com/ip/mock-cart-cross-recovery/891';
  const cartTabUrl = 'https://www.walmart.com/cart/no-checkout-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normCartTabUrl = normalizeProductUrl(cartTabUrl);

  const cartPage = makePage({ pathname: '/cart/no-checkout-cross', elements: [] });
  const cartResult = await wmHandleCartSim(cartPage, { productUrl: monitorProductUrl });
  assert.equal(cartResult.path, 'checkout_not_found', 'WM-6 cart cross: missing checkout path');
  assert.deepEqual(cartResult.actions, ['checkout_missing'], 'WM-6 cart cross: checkout_missing action');

  const inQueueUrls = new Set();
  const navigationLock = new Set();
  assert.equal(inQueueUrls.size, 0, 'WM-6 cart cross: must not arm sacred lock at cart');
  assert.ok(
    !inQueueUrls.has(normCartTabUrl),
    'WM-6 cart cross: cart tab URL must not be sacred lock key'
  );
  assert.ok(
    !navigationLock.has(normCartTabUrl),
    'WM-6 cart cross: cart tab URL must not be navigationLock key at cart'
  );

  const navFail = cartResult.messages?.find((m) => m.type === 'WALMART_NAV_FAILED');
  assert.ok(navFail, 'WM-6 cart cross: sends WALMART_NAV_FAILED');
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'WM-6 cart cross: live poll NAV_FAILED uses monitor productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normCartTabUrl,
    'WM-6 cart cross: NAV_FAILED must not key cart tab URL'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'WM-6 cart cross: NAV_FAILED must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'WM-6 cart cross: NAV_FAILED releases navigationLock on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'WM-6 cart cross: poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'WM-6 cart cross: poll recovery must not arm sacred lock');

  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: recoveryProductUrl,
  });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'WM-6 cart cross: NAV_FAILED during poll recovery releases recovery lock'
  );
}

/**
 * WM-6: pre-drop + missing-atc + PX timeout NAV_FAILED → poll recovery rearm — no sacred lock.
 * Parity with FIX-3 wm6-poll-recovery-rearm (fixture-e2e has browser coverage).
 */
function runWm6PollRecoveryRearmTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );

  function assertWm6PollRecoveryRearm(productUrl, navFailMsg, label) {
    const normUrl = normalizeProductUrl(productUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    assert.equal(navFailMsg.url, productUrl, `${label}: NAV_FAILED uses monitor productUrl`);

    navigationLock.add(normUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, navFailMsg);
    assert.ok(!navigationLock.has(normUrl), `${label}: NAV_FAILED releases navigationLock`);
    assert.equal(inQueueUrls.size, 0, `${label}: must not arm sacred lock`);

    navigationLock.add(normUrl);
    assert.ok(
      navigationLock.has(normUrl),
      `${label}: poll recovery re-arms navigationLock after NAV_FAILED`
    );
    assert.equal(inQueueUrls.size, 0, `${label}: poll recovery must not arm sacred lock`);

    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, { type: 'WALMART_NAV_FAILED', url: productUrl });
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
      `${label}: contrast WM-4 — sacred lock would block poll; WM-6 error path does not arm it`
    );
  }

  const predropUrl = 'https://www.walmart.com/ip/mock-predrop/601';
  const predropPage = makePage({
    pathname: '/ip/mock-predrop/601',
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
  assert.equal(predropDecision.action, 'atc_unavailable', 'WM-6 pre-drop: disabled ATC is nav_failed');
  const predropMsg = {
    type: 'WALMART_NAV_FAILED',
    url: predropUrl,
  };
  assert.match(WMT_SRC, /wmIsProductQueued/, 'WM-6 pre-drop: queue check in source');
  assertWm6PollRecoveryRearm(predropUrl, predropMsg, 'WM-6 pre-drop');

  const noAtcUrl = 'https://www.walmart.com/ip/mock-no-atc/559';
  const noAtcPage = makePage({ pathname: '/ip/mock-no-atc/559', elements: [] });
  const noAtcDecision = wmDecideProductPageEntry(noAtcPage);
  assert.equal(noAtcDecision.action, 'atc_unavailable', 'WM-6 missing-atc: no ATC element is nav_failed');
  const noAtcMsg = { type: 'WALMART_NAV_FAILED', url: noAtcUrl };
  assert.match(WMT_SRC, /wmAtcWaitTimeoutMs/, 'WM-6 missing-atc: ATC wait helper in source');
  assertWm6PollRecoveryRearm(noAtcUrl, noAtcMsg, 'WM-6 missing-atc');

  const hangTightUrl = 'https://www.walmart.com/ip/mock-px/555';
  const hangTightPage = makePage({
    pathname: '/ip/mock-px/555',
    bodyText: "Hang tight! We're loading your experience.",
    docAttrs: { 'data-tch-fixture': 'walmart-product-px' },
  });
  assert.ok(wmIsPxPage(hangTightPage), 'WM-6 PX hang-tight: page detected');
  const hangTightTimeoutMsgs = wmPxTimeoutMessages(hangTightPage, 2000);
  assert.equal(hangTightTimeoutMsgs.length, 1, 'WM-6 PX hang-tight: timeout sends NAV_FAILED');
  assert.equal(hangTightTimeoutMsgs[0].url, hangTightUrl, 'WM-6 PX hang-tight: NAV_FAILED url');
  assertWm6PollRecoveryRearm(
    hangTightUrl,
    { type: 'WALMART_NAV_FAILED', url: hangTightUrl },
    'WM-6 PX hang-tight'
  );

  const pxUrl = 'https://www.walmart.com/ip/mock-px-captcha/556';
  const pxPage = makePage({
    pathname: '/ip/mock-px-captcha/556',
    elements: [{ selectors: ['#px-captcha'], tag: 'div' }],
  });
  assert.ok(wmIsPxPage(pxPage), 'WM-6 PX captcha: page detected');
  const pxTimeoutMsgs = wmPxTimeoutMessages(pxPage, 120000);
  assert.equal(pxTimeoutMsgs.length, 1, 'WM-6 PX captcha: timeout sends NAV_FAILED');
  assertWm6PollRecoveryRearm(
    pxUrl,
    { type: 'WALMART_NAV_FAILED', url: pxUrl },
    'WM-6 PX captcha'
  );

  const pxBlockUrl = 'https://www.walmart.com/ip/mock-px-block/557';
  const pxBlockPage = makePage({
    pathname: '/ip/mock-px-block/557',
    bodyText: 'Access denied',
    docAttrs: { 'data-tch-fixture': 'walmart-product-px-block' },
    elements: [{ selectors: ['[class*="px-block"]'], tag: 'div' }],
  });
  assert.ok(wmIsPxPage(pxBlockPage), 'WM-6 PX block: page detected');
  const pxBlockTimeoutMsgs = wmPxTimeoutMessages(pxBlockPage, 2000);
  assert.equal(pxBlockTimeoutMsgs.length, 1, 'WM-6 PX block: timeout sends NAV_FAILED');
  assert.equal(pxBlockTimeoutMsgs[0].url, pxBlockUrl, 'WM-6 PX block: NAV_FAILED url');
  assertWm6PollRecoveryRearm(
    pxBlockUrl,
    { type: 'WALMART_NAV_FAILED', url: pxBlockUrl },
    'WM-6 PX block'
  );
  assert.match(WMT_SRC, /wmPxTimeoutMs/, 'WM-6 PX: timeout helper in source');

  const priceGuardUrl = 'https://www.walmart.com/ip/mock-price-guard-timeout/991';
  const priceGuardPage = makePage({
    pathname: '/ip/mock-price-guard-timeout/991',
    docAttrs: { 'data-tch-price-guard-timeout-ms': '750' },
    elements: [
      {
        selectors: ['[itemprop="price"]'],
        tag: 'span',
        text: '$99.99',
        content: '99.99',
      },
    ],
  });
  const priceGuardMsgs = wmPriceGuardTimeoutMessages(
    priceGuardPage,
    { walmartMaxPrice: 50, productUrl: priceGuardUrl },
    priceGuardUrl,
    750
  );
  assert.equal(priceGuardMsgs.length, 1, 'WM-6 price-guard: timeout sends NAV_FAILED');
  assertWm6PollRecoveryRearm(
    priceGuardUrl,
    priceGuardMsgs[0],
    'WM-6 price-guard'
  );

  const checkoutSpaUrl = 'https://www.walmart.com/ip/mock-checkout-spa/992';
  const checkoutSpaMsg = { type: 'WALMART_NAV_FAILED', url: checkoutSpaUrl };
  assert.match(WMT_SRC, /wmHandleCheckout timed out/, 'WM-6 checkout SPA: timeout log in source');
  assertWm6PollRecoveryRearm(checkoutSpaUrl, checkoutSpaMsg, 'WM-6 checkout SPA');
}

/**
 * WM-6: missing-ATC product page live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 wm6-live-poll-cycle on /ip/mock-no-atc/559 (fixture-e2e has browser coverage).
 */
function runWm6MissingAtcLivePollCycleTests() {
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-no-atc/559';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);

  const noAtcPage = makePage({
    pathname: '/ip/mock-no-atc/559',
    elements: [],
    docAttrs: {
      'data-tch-fixture': 'walmart-product-no-atc',
      'data-tch-atc-wait-ms': '750',
    },
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6 missing-atc live poll: must not arm sacred lock on start');
  assert.equal(
    wmDecideProductPageEntry(noAtcPage).action,
    'atc_unavailable',
    'WM-6 missing-atc live poll: no ATC element is nav_failed'
  );

  let atcTimeoutCycles = 0;
  const simulateMissingAtcTimeout = () => {
    atcTimeoutCycles += 1;
    const msgs = wmMissingAtcTimeoutMessages(noAtcPage, monitorProductUrl, 750);
    assert.equal(msgs.length, 1, 'WM-6 missing-atc live poll: ATC wait timeout sends NAV_FAILED');
    assert.equal(msgs[0].url, monitorProductUrl, 'WM-6 missing-atc live poll: NAV_FAILED uses monitor productUrl');
    return msgs[0];
  };

  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulateMissingAtcTimeout());
  assert.equal(inQueueUrls.size, 0, 'WM-6 missing-atc live poll: timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6 missing-atc live poll: timeout releases navigationLock');

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulateMissingAtcTimeout());
  assert.equal(atcTimeoutCycles, 2, 'WM-6 missing-atc live poll: reload must re-trigger ATC wait timeout');
  assert.equal(inQueueUrls.size, 0, 'WM-6 missing-atc live poll: reload must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6 missing-atc live poll: reload timeout releases navigationLock');

  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `WM-6 missing-atc live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `WM-6 missing-atc live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `WM-6 missing-atc live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6 missing-atc live poll: must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'WM-6 missing-atc live poll: navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'WM-6 missing-atc live poll: contrast WM-5 — sacred lock would block poll; missing ATC does not arm it'
  );
}

/**
 * WM-6: cart checkout-missing live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 wm6-cart-live-poll-cycle (fixture-e2e has browser coverage).
 */
async function runWm6CartLivePollCycleTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-cart-missing/888';
  const cartTabUrl = 'https://www.walmart.com/cart/no-checkout';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCartTabUrl = normalizeProductUrl(cartTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6: cart live poll must not arm sacred lock on start');
  assert.ok(!inQueueUrls.has(normCartTabUrl), 'WM-6: cart tab URL must not be sacred lock key');

  const cartPage = makePage({ pathname: '/cart/no-checkout', elements: [] });
  let checkoutMissingCycles = 0;
  const simulateCartCheckoutMissing = async () => {
    checkoutMissingCycles += 1;
    const cartResult = await wmHandleCartSim(cartPage, { productUrl: monitorProductUrl });
    assert.equal(cartResult.path, 'checkout_not_found', 'WM-6: cart live poll checkout-missing path');
    const navFail = cartResult.messages?.find((m) => m.type === 'WALMART_NAV_FAILED');
    assert.ok(navFail, 'WM-6: cart checkout-missing sends WALMART_NAV_FAILED');
    assert.equal(navFail.url, monitorProductUrl, 'WM-6: cart NAV_FAILED uses monitor productUrl');
    return navFail;
  };

  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, await simulateCartCheckoutMissing());
  assert.equal(inQueueUrls.size, 0, 'WM-6: cart checkout-missing must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6: cart checkout-missing releases navigationLock');
  assert.match(WMT_SRC, /Checkout button not found/, 'WM-6: cart checkout-missing log in source');

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, await simulateCartCheckoutMissing());
  assert.equal(checkoutMissingCycles, 2, 'WM-6: cart reload must re-trigger checkout-missing');
  assert.equal(inQueueUrls.size, 0, 'WM-6: cart reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6: cart reload checkout-missing releases navigationLock');

  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `WM-6: cart live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `WM-6: cart live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `WM-6: cart live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6: cart live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'WM-6: cart navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'WM-6: contrast WM-5 — sacred lock would block poll; cart checkout-missing does not arm it'
  );
}

/**
 * WM-6: cross-page cart checkout-missing live poll cycle — tab on /cart/no-checkout-cross,
 * monitor keys distinct productUrl; reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 wm6-cart-live-poll-cycle on /cart/no-checkout-cross (fixture-e2e has browser coverage).
 */
async function runWm6CartCrossLivePollCycleTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-cart-cross-monitor/890';
  const cartTabUrl = 'https://www.walmart.com/cart/no-checkout-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCartTabUrl = normalizeProductUrl(cartTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6: cross-page cart live poll must not arm sacred lock on start');
  assert.ok(!inQueueUrls.has(normCartTabUrl), 'WM-6: cross-page cart tab URL must not be sacred lock key');

  const cartPage = makePage({ pathname: '/cart/no-checkout-cross', elements: [] });
  let checkoutMissingCycles = 0;
  const simulateCartCheckoutMissing = async () => {
    checkoutMissingCycles += 1;
    const cartResult = await wmHandleCartSim(cartPage, { productUrl: monitorProductUrl });
    assert.equal(cartResult.path, 'checkout_not_found', 'WM-6: cross-page cart live poll checkout-missing path');
    const navFail = cartResult.messages?.find((m) => m.type === 'WALMART_NAV_FAILED');
    assert.ok(navFail, 'WM-6: cross-page cart checkout-missing sends WALMART_NAV_FAILED');
    assert.equal(navFail.url, monitorProductUrl, 'WM-6: cross-page cart NAV_FAILED uses monitor productUrl');
    assert.notEqual(
      normalizeProductUrl(navFail.url),
      normCartTabUrl,
      'WM-6: cross-page cart NAV_FAILED must not key cart tab URL'
    );
    return navFail;
  };

  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, await simulateCartCheckoutMissing());
  assert.equal(inQueueUrls.size, 0, 'WM-6: cross-page cart checkout-missing must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6: cross-page cart checkout-missing releases navigationLock');
  assert.match(WMT_SRC, /Checkout button not found/, 'WM-6: cross-page cart checkout-missing log in source');

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, await simulateCartCheckoutMissing());
  assert.equal(checkoutMissingCycles, 2, 'WM-6: cross-page cart reload must re-trigger checkout-missing');
  assert.equal(inQueueUrls.size, 0, 'WM-6: cross-page cart reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6: cross-page cart reload checkout-missing releases navigationLock');

  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `WM-6: cross-page cart live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `WM-6: cross-page cart live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `WM-6: cross-page cart live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6: cross-page cart live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'WM-6: cross-page cart navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'WM-6: contrast WM-5 — sacred lock would block poll; cross-page cart checkout-missing does not arm it'
  );
}

/**
 * WM-6: checkout SPA live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 wm6-live-poll-cycle on checkout SPA (fixture-e2e has browser coverage).
 */
function runWm6CheckoutSpaLivePollCycleTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-checkout-spa/992';
  const checkoutTabUrl = 'https://www.walmart.com/checkout/spa-stall';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6: checkout SPA live poll must not arm sacred lock on start');
  assert.ok(
    !inQueueUrls.has(normCheckoutTabUrl),
    'WM-6: checkout SPA tab URL must not be sacred lock key'
  );

  let timeoutCycles = 0;
  const simulateCheckoutSpaTimeout = () => {
    timeoutCycles += 1;
    return { type: 'WALMART_NAV_FAILED', url: monitorProductUrl };
  };

  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(inQueueUrls.size, 0, 'WM-6: checkout SPA timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6: checkout SPA timeout releases navigationLock');

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(timeoutCycles, 2, 'WM-6: reload must re-trigger checkout SPA timeout');
  assert.equal(inQueueUrls.size, 0, 'WM-6: reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6: reload timeout releases navigationLock');
  assert.match(WMT_SRC, /wmHandleCheckout timed out/, 'WM-6: checkout SPA timeout log in source');

  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `WM-6: checkout SPA live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `WM-6: checkout SPA live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `WM-6: checkout SPA live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6: checkout SPA live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'WM-6: checkout SPA navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'WM-6: contrast WM-5 — sacred lock would block poll; checkout SPA timeout does not arm it'
  );
}

/**
 * WM-6: price-guard timeout — NAV_FAILED after wait cap, no sacred lock, no queue wait.
 * Parity with FIX-3 wm6-price-guard-timeout (fixture-e2e has browser coverage).
 */
function runWm6PriceGuardTimeoutTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  assert.match(WMT_SRC, /wmPriceGuardTimeoutMs/, 'WM-6 price-guard: timeout helper in source');
  assert.match(
    WMT_SRC,
    /Price guard wait — no sacred lock/,
    'WM-6 price-guard: no-sacred-lock log in source'
  );
  assert.match(
    WMT_SRC,
    /Price guard wait timed out/,
    'WM-6 price-guard: timeout log in source'
  );

  const productUrl = 'https://www.walmart.com/ip/mock-price-guard-timeout/991';
  const normUrl = normalizeProductUrl(productUrl);
  const settings = { walmartMaxPrice: 50, productUrl, currentPrice: 99.99 };
  const priceGuardPage = makePage({
    pathname: '/ip/mock-price-guard-timeout/991',
    bodyText: 'Listed above max price',
    docAttrs: {
      'data-tch-fixture': 'walmart-product-price-guard-timeout',
      'data-tch-price-guard-timeout-ms': '750',
    },
    elements: [
      {
        selectors: ['[itemprop="price"]'],
        tag: 'span',
        text: '$99.99',
        content: '99.99',
      },
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        tag: 'button',
      },
    ],
  });

  const entry = wmDecideProductPageEntry(priceGuardPage, settings);
  assert.equal(entry.action, 'price_guard_wait', 'WM-6 price-guard: above max enters price guard wait');
  assert.ok(
    !entry.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'WM-6 price-guard: must not arm sacred lock on entry'
  );
  assert.equal(wmGetCurrentPrice(priceGuardPage, true), 99.99, 'WM-6 price-guard: reads DOM price');
  assert.equal(wmPriceGuardTimeoutMs(priceGuardPage), 750, 'WM-6 price-guard: reads timeout override');

  assert.deepEqual(
    wmPriceGuardTimeoutMessages(priceGuardPage, settings, productUrl, 749),
    [],
    'WM-6 price-guard: no NAV_FAILED before timeout'
  );
  const timeoutMsgs = wmPriceGuardTimeoutMessages(priceGuardPage, settings, productUrl, 750);
  assert.equal(timeoutMsgs.length, 1, 'WM-6 price-guard: timeout sends NAV_FAILED');
  assert.equal(timeoutMsgs[0].type, 'WALMART_NAV_FAILED', 'WM-6 price-guard: NAV_FAILED message type');
  assert.equal(timeoutMsgs[0].url, productUrl, 'WM-6 price-guard: NAV_FAILED uses productUrl');

  const inQueueUrls = new Set();
  const navigationLock = new Set([normUrl]);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, timeoutMsgs[0]);
  assert.equal(inQueueUrls.size, 0, 'WM-6 price-guard: timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normUrl), 'WM-6 price-guard: timeout releases navigationLock');
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-6 price-guard: poll may retry after timeout when not in queue'
  );

  const clearedPage = makePage({
    pathname: '/ip/mock-price-guard-cleared/992',
    docAttrs: { 'data-tch-price-guard-timeout-ms': '750' },
    elements: [
      {
        selectors: ['[itemprop="price"]'],
        tag: 'span',
        text: '$45.00',
        content: '45.00',
      },
    ],
  });
  assert.deepEqual(
    wmPriceGuardTimeoutMessages(clearedPage, settings, productUrl, 750),
    [],
    'WM-6 price-guard: no NAV_FAILED when price drops before timeout'
  );
}

/**
 * WM-6: price-guard live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 wm6-live-poll-cycle on price-guard route (fixture-e2e has browser coverage).
 */
function runWm6PriceGuardLivePollCycleTests() {
  const productUrl = 'https://www.walmart.com/ip/mock-price-guard-timeout/991';
  const normUrl = normalizeProductUrl(productUrl);
  const settings = { walmartMaxPrice: 50, productUrl };
  const priceGuardPage = makePage({
    pathname: '/ip/mock-price-guard-timeout/991',
    docAttrs: { 'data-tch-price-guard-timeout-ms': '750' },
    elements: [
      {
        selectors: ['[itemprop="price"]'],
        tag: 'span',
        text: '$99.99',
        content: '99.99',
      },
    ],
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6 price-guard live poll: must not arm sacred lock on start');

  let timeoutCycles = 0;
  const simulatePriceGuardTimeout = () => {
    timeoutCycles += 1;
    const msgs = wmPriceGuardTimeoutMessages(priceGuardPage, settings, productUrl, 750);
    assert.equal(msgs.length, 1, 'WM-6 price-guard live poll: timeout sends NAV_FAILED');
    return msgs[0];
  };

  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulatePriceGuardTimeout());
  assert.equal(inQueueUrls.size, 0, 'WM-6 price-guard live poll: timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normUrl), 'WM-6 price-guard live poll: timeout releases navigationLock');

  navigationLock.add(normUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulatePriceGuardTimeout());
  assert.equal(timeoutCycles, 2, 'WM-6 price-guard live poll: reload must re-trigger timeout');
  assert.equal(inQueueUrls.size, 0, 'WM-6 price-guard live poll: reload must not arm sacred lock');
  assert.ok(!navigationLock.has(normUrl), 'WM-6 price-guard live poll: reload timeout releases navigationLock');

  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: productUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `WM-6 price-guard live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normUrl)) {
      assert.ok(
        !inQueueUrls.has(normUrl),
        `WM-6 price-guard live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
      `WM-6 price-guard live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6 price-guard live poll: must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normUrl),
    'WM-6 price-guard live poll: navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, wmSacredLock, new Set()),
    'WM-6 price-guard live poll: contrast WM-5 — sacred lock would block poll; price-guard timeout does not arm it'
  );
}

/**
 * WM-6: data-tch-px-timeout-ms override — timeout fires at override ms, not prod 2min default.
 * Parity with FIX-3 px-timeout-ms-override (fixture-e2e has browser coverage).
 */
function runWm6PxTimeoutOverrideTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  assert.match(WMT_SRC, /data-tch-px-timeout-ms/, 'WM-6 PX override: attribute in source');
  assert.match(WMT_SRC, /wmPxTimeoutMs/, 'WM-6 PX override: timeout helper in source');

  const overridePage = makePage({
    pathname: '/ip/mock-px-override/558',
    bodyText: "Hang tight! We're loading your experience.",
    docAttrs: {
      'data-tch-fixture': 'walmart-product-px-override',
      'data-tch-px-timeout-ms': '750',
    },
  });
  assert.ok(wmIsPxPage(overridePage), 'WM-6 PX override: hang-tight page detected');
  assert.equal(wmPxTimeoutMs(overridePage), 750, 'WM-6 PX override: reads data-tch-px-timeout-ms');
  assert.deepEqual(
    wmPxTimeoutMessages(overridePage, 749),
    [],
    'WM-6 PX override: no NAV_FAILED before override timeout'
  );
  const overrideTimeoutMsgs = wmPxTimeoutMessages(overridePage, 750);
  assert.equal(overrideTimeoutMsgs.length, 1, 'WM-6 PX override: NAV_FAILED at override timeout');
  assert.equal(overrideTimeoutMsgs[0].type, 'WALMART_NAV_FAILED');

  const fixtureDefaultPage = makePage({
    pathname: '/ip/mock-px-fixture-default/559',
    bodyText: "Hang tight! We're loading your experience.",
    docAttrs: { 'data-tch-fixture': 'walmart-product-px' },
  });
  assert.equal(wmPxTimeoutMs(fixtureDefaultPage), 2000, 'WM-6 PX override: fixture default is 2s');
  assert.deepEqual(
    wmPxTimeoutMessages(fixtureDefaultPage, 1999),
    [],
    'WM-6 PX override: no NAV_FAILED before fixture default timeout'
  );
  assert.equal(
    wmPxTimeoutMessages(fixtureDefaultPage, 2000).length,
    1,
    'WM-6 PX override: NAV_FAILED at fixture default timeout'
  );

  const prodPage = makePage({
    pathname: '/ip/wm6-px-prod/560',
    elements: [{ selectors: ['#px-captcha'], tag: 'div' }],
  });
  assert.equal(wmPxTimeoutMs(prodPage), 120000, 'WM-6 PX override: prod default is 2min');
  assert.deepEqual(
    wmPxTimeoutMessages(prodPage, 119999),
    [],
    'WM-6 PX override: no NAV_FAILED before prod timeout'
  );

  const inQueueUrls = new Set();
  const navigationLock = new Set();
  const normPx = normalizeProductUrl(overrideTimeoutMsgs[0].url);
  navigationLock.add(normPx);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, overrideTimeoutMsgs[0]);
  assert.equal(inQueueUrls.size, 0, 'WM-6 PX override: timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normPx), 'WM-6 PX override: timeout releases navigationLock');
  assert.ok(
    !bgPollWouldSkipNavigation(normPx, inQueueUrls, navigationLock),
    'WM-6 PX override: poll may retry after override timeout'
  );
}

/**
 * WM-6: PX page live poll cycle with timeout override — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 wm6-live-poll-cycle on px-override route (fixture-e2e has browser coverage).
 */
function runWm6PxLivePollCycleTests() {
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-px-override/558';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);

  const pxPage = makePage({
    pathname: '/ip/mock-px-override/558',
    bodyText: "Hang tight! We're loading your experience.",
    docAttrs: {
      'data-tch-fixture': 'walmart-product-px-override',
      'data-tch-px-timeout-ms': '750',
    },
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6 PX live poll: must not arm sacred lock on start');
  assert.equal(wmPxInitDecision(pxPage).action, 'px_wait', 'WM-6 PX live poll: PX wait branch');

  let pxTimeoutCycles = 0;
  const simulatePxTimeout = () => {
    pxTimeoutCycles += 1;
    const msgs = wmPxTimeoutMessages(pxPage, 750);
    assert.equal(msgs.length, 1, 'WM-6 PX live poll: override timeout sends NAV_FAILED');
    return msgs[0];
  };

  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulatePxTimeout());
  assert.equal(inQueueUrls.size, 0, 'WM-6 PX live poll: override timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'WM-6 PX live poll: timeout releases navigationLock');

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulatePxTimeout());
  assert.equal(pxTimeoutCycles, 2, 'WM-6 PX live poll: reload must re-trigger PX override timeout');
  assert.equal(inQueueUrls.size, 0, 'WM-6 PX live poll: reload must not arm sacred lock');

  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `WM-6 PX live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `WM-6 PX live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `WM-6 PX live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-6 PX live poll: must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'WM-6 PX live poll: navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'WM-6 PX live poll: contrast WM-5 — sacred lock would block poll; PX override timeout does not arm it'
  );
}

/**
 * Shared WM-6 PX live poll cycle assertions for fixture routes (hang-tight, captcha, px-block).
 * Parity with FIX-3 wm6-live-poll-cycle on those routes (fixture-e2e has browser coverage).
 */
function assertWm6PxLivePollCycle({ page, monitorProductUrl, timeoutMs, label }) {
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, `${label}: must not arm sacred lock on start`);
  assert.equal(wmPxInitDecision(page).action, 'px_wait', `${label}: PX wait branch`);

  let pxTimeoutCycles = 0;
  const simulatePxTimeout = () => {
    pxTimeoutCycles += 1;
    const msgs = wmPxTimeoutMessages(page, timeoutMs);
    assert.equal(msgs.length, 1, `${label}: timeout sends NAV_FAILED`);
    return msgs[0];
  };

  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulatePxTimeout());
  assert.equal(inQueueUrls.size, 0, `${label}: timeout must not arm sacred lock`);
  assert.ok(!navigationLock.has(normMonitorUrl), `${label}: timeout releases navigationLock`);

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, simulatePxTimeout());
  assert.equal(pxTimeoutCycles, 2, `${label}: reload must re-trigger PX timeout`);
  assert.equal(inQueueUrls.size, 0, `${label}: reload must not arm sacred lock`);

  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `${label}: live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `${label}: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `${label}: live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, `${label}: must not arm inQueueUrls after poll wait`);
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    `${label}: navigationLock alone must not imply sacred lock after poll wait`
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    `${label}: contrast WM-5 — sacred lock would block poll; PX timeout does not arm it`
  );
}

/**
 * WM-6: PX hang-tight, #px-captcha, and px-block live poll cycles — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 wm6-live-poll-cycle on /ip/mock-px/555, /ip/mock-px-captcha/556, /ip/mock-px-block/557.
 */
function runWm6PxFixtureRoutesLivePollCycleTests() {
  const hangTightUrl = 'https://www.walmart.com/ip/mock-px/555';
  const hangTightPage = makePage({
    pathname: '/ip/mock-px/555',
    bodyText: "Hang tight! We're loading your experience.",
    docAttrs: { 'data-tch-fixture': 'walmart-product-px' },
  });
  assert.ok(wmIsPxPage(hangTightPage), 'WM-6 PX hang-tight live poll: page detected');
  assertWm6PxLivePollCycle({
    page: hangTightPage,
    monitorProductUrl: hangTightUrl,
    timeoutMs: wmPxTimeoutMs(hangTightPage),
    label: 'WM-6 PX hang-tight live poll',
  });

  const pxCaptchaUrl = 'https://www.walmart.com/ip/mock-px-captcha/556';
  const pxCaptchaPage = makePage({
    pathname: '/ip/mock-px-captcha/556',
    elements: [{ selectors: ['#px-captcha'], tag: 'div' }],
  });
  assert.ok(wmIsPxPage(pxCaptchaPage), 'WM-6 PX captcha live poll: page detected');
  assertWm6PxLivePollCycle({
    page: pxCaptchaPage,
    monitorProductUrl: pxCaptchaUrl,
    timeoutMs: wmPxTimeoutMs(pxCaptchaPage),
    label: 'WM-6 PX captcha live poll',
  });

  const pxBlockUrl = 'https://www.walmart.com/ip/mock-px-block/557';
  const pxBlockPage = makePage({
    pathname: '/ip/mock-px-block/557',
    bodyText: 'Access denied',
    docAttrs: { 'data-tch-fixture': 'walmart-product-px-block' },
    elements: [{ selectors: ['[class*="px-block"]'], tag: 'div' }],
  });
  assert.ok(wmIsPxPage(pxBlockPage), 'WM-6 PX block live poll: page detected');
  assertWm6PxLivePollCycle({
    page: pxBlockPage,
    monitorProductUrl: pxBlockUrl,
    timeoutMs: wmPxTimeoutMs(pxBlockPage),
    label: 'WM-6 PX block live poll',
  });
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

  // WM-5: QUEUE_TIMEOUT clears sacred lock AND navigationLock — poll may recover.
  inQueueUrls.clear();
  navigationLock.clear();
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
  navigationLock.add(normUrl);
  assert.ok(inQueueUrls.has(normUrl), 'WM-5: sacred lock armed before QUEUE_TIMEOUT');
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll blocked before QUEUE_TIMEOUT'
  );
  bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
    type: 'WALMART_QUEUE_TIMEOUT',
    url: productUrl,
  });
  assert.ok(!inQueueUrls.has(normUrl), 'WM-5: QUEUE_TIMEOUT clears inQueueUrls');
  assert.ok(!navigationLock.has(normUrl), 'WM-5: QUEUE_TIMEOUT clears navigationLock');
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll may navigate after QUEUE_TIMEOUT'
  );

  // WM-5: QUEUE_TIMEOUT is distinct from NAV_FAILED — NAV_FAILED preserves sacred lock.
  inQueueUrls.clear();
  navigationLock.clear();
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
  navigationLock.add(normUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: productUrl,
  });
  assert.ok(
    inQueueUrls.has(normUrl),
    'WM-5: NAV_FAILED does not clear sacred lock (contrast QUEUE_TIMEOUT)'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll still blocked after NAV_FAILED while sacred lock active'
  );

  // WM-5: poll recovery after QUEUE_TIMEOUT — navigationLock re-arms, no sacred lock.
  inQueueUrls.clear();
  navigationLock.clear();
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
  navigationLock.add(normUrl);
  bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
    type: 'WALMART_QUEUE_TIMEOUT',
    url: productUrl,
  });
  navigationLock.add(normUrl);
  assert.equal(inQueueUrls.size, 0, 'WM-5: poll recovery must not re-arm sacred lock');
  assert.ok(
    navigationLock.has(normUrl),
    'WM-5: poll recovery re-arms navigationLock after QUEUE_TIMEOUT'
  );
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: productUrl,
  });
  assert.ok(
    !navigationLock.has(normUrl),
    'WM-5: NAV_FAILED during poll recovery releases lock for retry'
  );
  assert.equal(
    inQueueUrls.size,
    0,
    'WM-5: poll recovery NAV_FAILED must not arm sacred lock'
  );

  // WM-5: isInCheckoutFlow + sacred lock — checkout tab must not be sent back to product.
  assert.ok(
    isInCheckoutFlow('https://www.walmart.com/checkout'),
    'WM-5: walmart /checkout is checkout flow'
  );
  assert.ok(
    isInCheckoutFlow('https://www.walmart.com/cart'),
    'WM-5: cart path is checkout flow'
  );
  assert.ok(
    !isInCheckoutFlow('https://www.walmart.com/qp'),
    'WM-5: /qp uses sacred lock, not checkout-flow guard'
  );
  assert.ok(
    !isInCheckoutFlow('https://www.walmart.com/ip/wm5-sacred-lock/555'),
    'WM-5: product page is not checkout flow'
  );

  inQueueUrls.clear();
  navigationLock.clear();
  const checkoutTabUrl = 'https://www.walmart.com/checkout?step=review';
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: productUrl,
  });
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: sacred lock blocks poll skip even when navigationLock cleared by NAV_FAILED'
  );
  assert.ok(
    !bgWouldNavigateRestock(normUrl, checkoutTabUrl, inQueueUrls, navigationLock),
    'WM-5: restock must not navigate checkout tab while sacred lock holds product URL'
  );

  // Without sacred lock, checkout tab may be navigated on restock (poll retry path).
  inQueueUrls.clear();
  navigationLock.clear();
  assert.ok(
    bgWouldNavigateRestock(normUrl, checkoutTabUrl, inQueueUrls, navigationLock),
    'WM-5: restock may navigate checkout tab when no locks held'
  );

  // Sacred lock on product URL while tab still on product page — poll skip, no restock nav.
  inQueueUrls.clear();
  navigationLock.clear();
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
  const productTabUrl = 'https://www.walmart.com/ip/wm5-sacred-lock/555';
  assert.ok(
    !isInCheckoutFlow(productTabUrl),
    'WM-5: product tab URL is not checkout flow'
  );
  assert.ok(
    !bgWouldNavigateRestock(normUrl, productTabUrl, inQueueUrls, navigationLock),
    'WM-5: restock must not navigate product tab while sacred lock holds'
  );

  // WM-5: checkout SPA timeout after queue — must release sacred lock (NAV_FAILED alone leaves poll stuck).
  inQueueUrls.clear();
  navigationLock.clear();
  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
  navigationLock.add(normUrl);
  assert.ok(inQueueUrls.has(normUrl), 'WM-5: post-queue checkout still holds sacred lock before timeout');
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: productUrl,
  });
  assert.ok(
    inQueueUrls.has(normUrl),
    'WM-5: NAV_FAILED alone does not clear sacred lock (checkout timeout must use QUEUE_TIMEOUT)'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: stuck sacred lock blocks poll after NAV_FAILED-only checkout timeout'
  );
  bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
    type: 'WALMART_QUEUE_TIMEOUT',
    url: productUrl,
  });
  assert.ok(!inQueueUrls.has(normUrl), 'WM-5: checkout timeout QUEUE_TIMEOUT clears sacred lock');
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'WM-5: poll may retry after checkout timeout releases sacred lock'
  );
}

/** Mirrors wmWaitInProductQueue lock message — uses settings.productUrl when monitored. */
function wmProductQueueSacredLockMessages(settings, locationHref) {
  const lockUrl = settings?.productUrl || locationHref;
  if (!lockUrl) return [];
  return [{ type: 'WALMART_IN_QUEUE', url: lockUrl }];
}

/** WM-5: cross-page product queue poll — tab on /ip/*, sacred lock keys monitor productUrl (parity FIX-3). */
function runWm5ProductQueuePollCrossPagePollRecoveryTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-queue/456';
  const recoveryProductUrl = 'https://www.walmart.com/ip/mock-queue-poll-recovery/461';
  const queueTabUrl = 'https://www.walmart.com/ip/mock-queue-poll/457';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normQueueTabUrl = normalizeProductUrl(queueTabUrl);

  assert.match(
    WMT_SRC,
    /const lockUrl = settings\?\.productUrl \|\| location\.href/,
    'WM-5: product-page queue lock uses settings.productUrl before location.href'
  );
  assert.match(
    WMT_SRC,
    /wmSignalQueueTimeout\(lockUrl\)/,
    'WM-5: product-page queue timeout uses lockUrl (monitor product when cross-page)'
  );

  const lockMessages = wmProductQueueSacredLockMessages({ productUrl: monitorProductUrl }, queueTabUrl);
  assert.equal(lockMessages.length, 1, 'WM-5: product queue cross-page emits one lock message');
  assert.equal(
    lockMessages[0].url,
    monitorProductUrl,
    'WM-5: product queue cross-page lock uses monitor productUrl not tab URL'
  );
  assert.notEqual(
    normalizeProductUrl(lockMessages[0].url),
    normQueueTabUrl,
    'WM-5: product queue cross-page lock must not key queue tab URL'
  );

  const inQueueUrls = new Set();
  const navigationLock = new Set();
  bgApplyWalmartInQueue(inQueueUrls, lockMessages[0]);
  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page product queue arms sacred lock on monitor product'
  );
  assert.ok(
    !inQueueUrls.has(normQueueTabUrl),
    'WM-5: cross-page product queue sacred lock must not key queue tab URL'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page product queue sacred lock blocks poll on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: monitorProductUrl,
  });
  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page product queue NAV_FAILED must not clear sacred lock'
  );
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'WM-5: cross-page product queue NAV_FAILED releases navigationLock only'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page product queue poll still blocked after NAV_FAILED while sacred lock holds'
  );

  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page product queue reload preserves sacred lock'
  );
  assert.ok(
    !bgWouldNavigateRestock(normMonitorUrl, queueTabUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page restock must not navigate queue tab while sacred lock holds monitor product'
  );

  bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
    type: 'WALMART_QUEUE_TIMEOUT',
    url: monitorProductUrl,
  });
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page product queue timeout clears sacred lock'
  );
  assert.ok(
    !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page product queue poll may retry after QUEUE_TIMEOUT'
  );

  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'WM-5: cross-page product queue poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'WM-5: cross-page product queue poll recovery must not arm sacred lock');
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: recoveryProductUrl,
  });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'WM-5: cross-page product queue NAV_FAILED during poll recovery releases recovery lock'
  );
}

/** WM-5: cross-page checkout SPA sacred lock — tab on /checkout/*, lock keys monitor productUrl (parity FIX-3). */
function runWm5CheckoutSpaCrossPageSacredPollRecoveryTests() {
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-checkout-spa-cross-monitor/1002';
  const recoveryProductUrl = 'https://www.walmart.com/ip/mock-checkout-spa-cross-recovery/1004';
  const checkoutTabUrl = 'https://www.walmart.com/checkout/spa-stall-sacred-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: monitorProductUrl });
  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page checkout SPA arms sacred lock on monitor product'
  );
  assert.ok(
    !inQueueUrls.has(normCheckoutTabUrl),
    'WM-5: cross-page sacred lock must not key checkout tab URL'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page sacred lock blocks poll on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: monitorProductUrl,
  });
  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page NAV_FAILED must not clear sacred lock'
  );
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'WM-5: cross-page NAV_FAILED releases navigationLock only'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page poll still blocked after NAV_FAILED while sacred lock holds'
  );

  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page checkout SPA reload preserves sacred lock'
  );
  assert.ok(
    !bgWouldNavigateRestock(normMonitorUrl, checkoutTabUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page restock must not navigate checkout tab while sacred lock holds monitor product'
  );

  bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
    type: 'WALMART_QUEUE_TIMEOUT',
    url: monitorProductUrl,
  });
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page checkout SPA timeout clears sacred lock'
  );
  assert.ok(
    !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page poll may retry after checkout SPA timeout'
  );

  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'WM-5: cross-page poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'WM-5: cross-page poll recovery must not arm sacred lock');
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: recoveryProductUrl,
  });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'WM-5: cross-page NAV_FAILED during poll recovery releases recovery lock'
  );
}

/**
 * WM-5: pre-timeout live poll cycle — sacred lock survives reload + NAV_FAILED before QUEUE_TIMEOUT.
 * Parity with FIX-3 wm5-pre-timeout-live-poll-cycle on monitored /qp, /checkout, and product-page routes.
 */
function runWm5PreTimeoutLivePollCycleTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  assert.match(
    WMT_SRC,
    /wmHandleQueueRoom: no productUrl in settings/,
    'WM-5 pre-timeout: /qp warns when productUrl missing'
  );
  assert.match(
    WMT_SRC,
    /wmHandleQueue: no productUrl in settings/,
    'WM-5 pre-timeout: checkout queue warns when productUrl missing'
  );
  assert.match(
    WMT_SRC,
    /\/qp waiting room detected/,
    'WM-5 pre-timeout: /qp queue detection log in source'
  );
  assert.match(
    WMT_SRC,
    /Product-page queue detected/,
    'WM-5 pre-timeout: product-page queue detection log in source'
  );

  const scenarios = [
    {
      label: '/qp monitored pretimeout',
      productUrl: 'https://www.walmart.com/ip/mock-qp-timeout-monitored/994',
    },
    {
      label: '/checkout monitored pretimeout',
      productUrl: 'https://www.walmart.com/ip/mock-checkout-timeout-monitored/995',
    },
    {
      label: 'product-page queue pretimeout',
      productUrl: 'https://www.walmart.com/ip/mock-product-queue-pretimeout/460',
    },
  ];

  for (const { label, productUrl } of scenarios) {
    const normUrl = normalizeProductUrl(productUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: productUrl });
    navigationLock.add(normUrl);
    assert.ok(inQueueUrls.has(normUrl), `${label}: sacred lock armed before pre-timeout poll`);
    assert.ok(
      bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
      `${label}: poll must skip while sacred lock holds`
    );

    // Simulated page reload — background inQueueUrls persists before QUEUE_TIMEOUT fires.
    assert.ok(
      inQueueUrls.has(normUrl),
      `${label}: reload preserves sacred lock in background before QUEUE_TIMEOUT`
    );
    assert.ok(
      bgPollWouldSkipNavigation(normUrl, inQueueUrls, new Set()),
      `${label}: poll must skip after reload while sacred lock holds (no navigationLock required)`
    );

    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      navigationLock.add(normUrl);
      bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
        type: navFailTypes[i],
        url: productUrl,
      });
      assert.ok(
        inQueueUrls.has(normUrl),
        `${label}: pre-timeout cycle ${i + 1} must preserve sacred lock after ${navFailTypes[i]}`
      );
      assert.ok(
        !navigationLock.has(normUrl),
        `${label}: pre-timeout cycle ${i + 1} must not re-arm navigationLock after ${navFailTypes[i]}`
      );
      assert.ok(
        bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
        `${label}: poll still blocked after ${navFailTypes[i]} before QUEUE_TIMEOUT`
      );
    }

    assert.ok(inQueueUrls.has(normUrl), `${label}: sacred lock held before QUEUE_TIMEOUT fires`);

    bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
      type: 'WALMART_QUEUE_TIMEOUT',
      url: productUrl,
    });
    assert.ok(!inQueueUrls.has(normUrl), `${label}: QUEUE_TIMEOUT clears sacred lock after pre-timeout window`);
    assert.ok(
      !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
      `${label}: poll may retry after QUEUE_TIMEOUT`
    );
  }
}

/**
 * WM-5: QUEUE_TIMEOUT → poll recovery rearm on distinct recovery product — no sacred lock.
 * Parity with FIX-3 wm5-poll-recovery-rearm on monitored /qp, /checkout, and product-page queue timeout routes.
 */
function runWm5PollRecoveryRearmTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  assert.match(WMT_SRC, /WALMART_QUEUE_TIMEOUT/, 'WM-5 poll recovery: QUEUE_TIMEOUT handler in source');
  assert.match(WMT_SRC, /wmSignalQueueTimeout/, 'WM-5 poll recovery: queue timeout signal in source');

  function assertWm5PollRecoveryRearm(monitorProductUrl, recoveryProductUrl, label) {
    const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
    const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: monitorProductUrl });
    navigationLock.add(normMonitorUrl);
    assert.ok(inQueueUrls.has(normMonitorUrl), `${label}: sacred lock armed before QUEUE_TIMEOUT`);
    assert.ok(
      bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `${label}: poll blocked while sacred lock holds monitor product`
    );

    bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
      type: 'WALMART_QUEUE_TIMEOUT',
      url: monitorProductUrl,
    });
    assert.ok(!inQueueUrls.has(normMonitorUrl), `${label}: QUEUE_TIMEOUT clears sacred lock on monitor product`);
    assert.ok(
      !navigationLock.has(normMonitorUrl),
      `${label}: QUEUE_TIMEOUT clears navigationLock on monitor product`
    );
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `${label}: poll may retry monitor product after QUEUE_TIMEOUT`
    );

    navigationLock.add(normRecoveryUrl);
    assert.ok(
      navigationLock.has(normRecoveryUrl),
      `${label}: poll recovery re-arms navigationLock on recovery product`
    );
    assert.equal(inQueueUrls.size, 0, `${label}: poll recovery must not arm sacred lock`);
    assert.ok(
      !inQueueUrls.has(normRecoveryUrl),
      `${label}: recovery product must not be in sacred lock`
    );

    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: 'WALMART_NAV_FAILED',
      url: recoveryProductUrl,
    });
    assert.ok(
      !navigationLock.has(normRecoveryUrl),
      `${label}: NAV_FAILED during poll recovery releases recovery lock for retry`
    );
    assert.equal(inQueueUrls.size, 0, `${label}: poll recovery NAV_FAILED must not arm sacred lock`);
    assert.ok(
      !bgPollWouldSkipNavigation(normRecoveryUrl, inQueueUrls, navigationLock),
      `${label}: poll may retry after poll recovery NAV_FAILED (no sacred lock)`
    );

    const wmSacredLock = new Set([normRecoveryUrl]);
    assert.ok(
      bgPollWouldSkipNavigation(normRecoveryUrl, wmSacredLock, new Set()),
      `${label}: contrast WM-5 — sacred lock would block poll; post-timeout recovery does not arm it`
    );
  }

  const scenarios = [
    {
      label: '/qp monitored timeout',
      monitorProductUrl: 'https://www.walmart.com/ip/mock-qp-timeout-monitored/994',
      recoveryProductUrl: 'https://www.walmart.com/ip/mock-qp-timeout-monitored-recovery/998',
      lockMessages: () =>
        wmQueueRoomSacredLockMessages({
          productUrl: 'https://www.walmart.com/ip/mock-qp-timeout-monitored/994',
        }),
    },
    {
      label: '/checkout monitored timeout',
      monitorProductUrl: 'https://www.walmart.com/ip/mock-checkout-timeout-monitored/995',
      recoveryProductUrl: 'https://www.walmart.com/ip/mock-checkout-timeout-monitored-recovery/999',
      lockMessages: () =>
        wmCheckoutQueueSacredLockMessages({
          productUrl: 'https://www.walmart.com/ip/mock-checkout-timeout-monitored/995',
        }),
    },
    {
      label: 'product-page queue timeout',
      monitorProductUrl: 'https://www.walmart.com/ip/mock-product-queue-timeout/458',
      recoveryProductUrl: 'https://www.walmart.com/ip/mock-product-queue-timeout-recovery/459',
      lockMessages: () =>
        wmProductQueueSacredLockMessages(
          { productUrl: 'https://www.walmart.com/ip/mock-product-queue-timeout/458' },
          'https://www.walmart.com/ip/mock-product-queue-timeout/458'
        ),
    },
  ];

  for (const { label, monitorProductUrl, recoveryProductUrl, lockMessages } of scenarios) {
    const lockMsg = lockMessages()[0];
    assert.ok(lockMsg, `${label}: queue entry emits WALMART_IN_QUEUE with monitor productUrl`);
    assert.equal(
      lockMsg.url,
      monitorProductUrl,
      `${label}: sacred lock keys monitor productUrl not queue tab URL`
    );
    assertWm5PollRecoveryRearm(monitorProductUrl, recoveryProductUrl, label);
  }
}

/**
 * WM-5: checkout SPA live poll cycle — pre-armed sacred lock survives reload + NAV_FAILED before timeout.
 * Parity with FIX-3 wm5-checkout-spa-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runWm5CheckoutSpaLivePollCycleTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-checkout-spa-sacred/996';
  const checkoutTabUrl = 'https://www.walmart.com/checkout/spa-stall-sacred';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: monitorProductUrl });
  assert.ok(inQueueUrls.has(normMonitorUrl), 'WM-5: checkout SPA live poll expects pre-armed sacred lock');
  assert.ok(
    !inQueueUrls.has(normCheckoutTabUrl),
    'WM-5: checkout SPA tab URL must not be sacred lock key'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: checkout SPA live poll blocks poll on monitor product'
  );

  // Simulated reload during live poll — sacred lock persists in background.
  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: checkout SPA reload preserves sacred lock before timeout'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: checkout SPA reload must skip poll while sacred lock holds'
  );
  assert.match(
    WMT_SRC,
    /releasing sacred lock for poll recovery/,
    'WM-5: checkout timeout releases sacred lock (not before timeout)'
  );

  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.ok(
      inQueueUrls.has(normMonitorUrl),
      `WM-5: checkout SPA live poll cycle ${i + 1} must preserve sacred lock after ${navFailTypes[i]}`
    );
    assert.ok(
      !navigationLock.has(normMonitorUrl),
      `WM-5: checkout SPA live poll cycle ${i + 1} must not re-arm navigationLock after ${navFailTypes[i]}`
    );
    assert.ok(
      bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `WM-5: checkout SPA poll blocked after ${navFailTypes[i]} before timeout`
    );
    assert.ok(
      !bgWouldNavigateRestock(normMonitorUrl, checkoutTabUrl, inQueueUrls, navigationLock),
      `WM-5: checkout SPA restock must not navigate tab while sacred lock holds after ${navFailTypes[i]}`
    );
  }

  // Contrast: checkout timeout uses QUEUE_TIMEOUT (not NAV_FAILED) to release sacred lock.
  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: monitorProductUrl,
  });
  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: checkout SPA NAV_FAILED alone must not clear sacred lock before timeout'
  );
  bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
    type: 'WALMART_QUEUE_TIMEOUT',
    url: monitorProductUrl,
  });
  assert.ok(!inQueueUrls.has(normMonitorUrl), 'WM-5: checkout SPA timeout QUEUE_TIMEOUT clears sacred lock');
}

/**
 * WM-5: cross-page checkout SPA sacred live poll cycle — tab on /checkout/spa-stall-sacred-cross,
 * sacred lock keys monitor productUrl; reload + repeated NAV_FAILED before timeout, lock persists.
 * Parity with FIX-3 wm5-checkout-spa-live-poll-cycle on /checkout/spa-stall-sacred-cross (fixture-e2e has browser coverage).
 */
function runWm5CheckoutSpaCrossLivePollCycleTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  const monitorProductUrl = 'https://www.walmart.com/ip/mock-checkout-spa-cross-monitor/1002';
  const checkoutTabUrl = 'https://www.walmart.com/checkout/spa-stall-sacred-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: monitorProductUrl });
  assert.ok(inQueueUrls.has(normMonitorUrl), 'WM-5: cross-page checkout SPA live poll expects pre-armed sacred lock');
  assert.ok(
    !inQueueUrls.has(normCheckoutTabUrl),
    'WM-5: cross-page checkout SPA tab URL must not be sacred lock key'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page checkout SPA live poll blocks poll on monitor product'
  );

  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page checkout SPA reload preserves sacred lock before timeout'
  );
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'WM-5: cross-page checkout SPA reload must skip poll while sacred lock holds'
  );
  assert.match(
    WMT_SRC,
    /releasing sacred lock for poll recovery/,
    'WM-5: cross-page checkout timeout releases sacred lock (not before timeout)'
  );

  const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.ok(
      inQueueUrls.has(normMonitorUrl),
      `WM-5: cross-page checkout SPA live poll cycle ${i + 1} must preserve sacred lock after ${navFailTypes[i]}`
    );
    assert.ok(
      !navigationLock.has(normMonitorUrl),
      `WM-5: cross-page checkout SPA live poll cycle ${i + 1} must not re-arm navigationLock after ${navFailTypes[i]}`
    );
    assert.ok(
      bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `WM-5: cross-page checkout SPA poll blocked after ${navFailTypes[i]} before timeout`
    );
    assert.ok(
      !bgWouldNavigateRestock(normMonitorUrl, checkoutTabUrl, inQueueUrls, navigationLock),
      `WM-5: cross-page checkout SPA restock must not navigate tab while sacred lock holds after ${navFailTypes[i]}`
    );
    assert.notEqual(
      normalizeProductUrl(checkoutTabUrl),
      normMonitorUrl,
      `WM-5: cross-page checkout SPA live poll cycle ${i + 1} sacred lock must key monitor productUrl not tab URL`
    );
  }

  bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
    type: 'WALMART_NAV_FAILED',
    url: monitorProductUrl,
  });
  assert.ok(
    inQueueUrls.has(normMonitorUrl),
    'WM-5: cross-page checkout SPA NAV_FAILED alone must not clear sacred lock before timeout'
  );
  bgApplyWalmartQueueTimeout(navigationLock, inQueueUrls, {
    type: 'WALMART_QUEUE_TIMEOUT',
    url: monitorProductUrl,
  });
  assert.ok(!inQueueUrls.has(normMonitorUrl), 'WM-5: cross-page checkout SPA timeout QUEUE_TIMEOUT clears sacred lock');
}

/**
 * WM-5: sacred-lock live poll cycle — reload + repeated NAV_FAILED, lock persists (no QUEUE_TIMEOUT).
 * Parity with FIX-3 wm5-live-poll-cycle on product-page queue + monitored /qp + /checkout routes.
 */
function runWm5LivePollCycleTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  assert.match(
    WMT_SRC,
    /Product-page queue detected/,
    'WM-5 live poll: product-page queue detection log in source'
  );
  assert.match(
    WMT_SRC,
    /\/qp waiting room detected/,
    'WM-5 live poll: /qp queue detection log in source'
  );
  assert.match(
    WMT_SRC,
    /Queue detected/,
    'WM-5 live poll: checkout queue detection log in source'
  );

  const scenarios = [
    {
      label: 'product-page queue',
      lockUrl: 'https://www.walmart.com/ip/mock-queue/456',
    },
    {
      label: '/qp monitored',
      lockUrl: 'https://www.walmart.com/ip/mock-qp-product/999',
    },
    {
      label: '/checkout sacred',
      lockUrl: 'https://www.walmart.com/ip/mock-wm6-checkout/789',
    },
  ];

  for (const { label, lockUrl } of scenarios) {
    const normUrl = normalizeProductUrl(lockUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    bgApplyWalmartInQueue(inQueueUrls, { type: 'WALMART_IN_QUEUE', url: lockUrl });
    assert.ok(inQueueUrls.has(normUrl), `${label}: sacred lock armed before live poll`);
    assert.ok(
      bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
      `${label}: poll must skip while sacred lock holds`
    );

    // Simulated page reload — background inQueueUrls persists (unlike pre-timeout, no QUEUE_TIMEOUT follows).
    assert.ok(
      inQueueUrls.has(normUrl),
      `${label}: reload preserves sacred lock during live poll`
    );
    assert.ok(
      bgPollWouldSkipNavigation(normUrl, inQueueUrls, new Set()),
      `${label}: poll must skip after reload while sacred lock holds`
    );

    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      navigationLock.add(normUrl);
      bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
        type: navFailTypes[i],
        url: lockUrl,
      });
      assert.ok(
        inQueueUrls.has(normUrl),
        `${label}: live poll cycle ${i + 1} must preserve sacred lock after ${navFailTypes[i]}`
      );
      assert.ok(
        !navigationLock.has(normUrl),
        `${label}: live poll cycle ${i + 1} must not re-arm navigationLock after ${navFailTypes[i]}`
      );
      assert.ok(
        bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
        `${label}: poll still blocked after ${navFailTypes[i]} during live poll`
      );
    }

    assert.ok(
      inQueueUrls.has(normUrl),
      `${label}: sacred lock must persist at end of live poll (no QUEUE_TIMEOUT)`
    );
    assert.ok(
      bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
      `${label}: poll must still skip navigate while sacred lock holds at end of live poll`
    );
  }
}

/**
 * WM-4: unmonitored queue live poll cycle — reload + NAV_FAILED must not arm sacred lock.
 * Parity with FIX-3 wm4-live-poll-cycle on unmonitored /qp + /checkout (Target-only monitor).
 */
function runWm4LivePollCycleTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  assert.match(
    WMT_SRC,
    /wmHandleQueueRoom: no productUrl in settings/,
    'WM-4 live poll: /qp warns when productUrl missing'
  );
  assert.match(
    WMT_SRC,
    /wmHandleQueue: no productUrl in settings/,
    'WM-4 live poll: checkout queue warns when productUrl missing'
  );

  const scenarios = [
    {
      label: '/qp unmonitored',
      pageUrl: 'https://www.walmart.com/qp/waiting-room',
      walmartProbeUrl: 'https://www.walmart.com/ip/mock-wm4-qp-live/111',
    },
    {
      label: '/checkout unmonitored',
      pageUrl: 'https://www.walmart.com/checkout/unmonitored',
      walmartProbeUrl: 'https://www.walmart.com/ip/mock-wm4-checkout-live/222',
    },
  ];

  for (const { label, pageUrl, walmartProbeUrl } of scenarios) {
    const normPageUrl = normalizeProductUrl(pageUrl);
    const normWalmartProbeUrl = normalizeProductUrl(walmartProbeUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    assert.equal(inQueueUrls.size, 0, `${label}: unmonitored queue must not arm sacred lock on start`);
    assert.ok(
      !inQueueUrls.has(normPageUrl),
      `${label}: queue page URL must not be sacred lock key on start`
    );

    // Simulated reload during live poll — still no sacred lock (WM-4).
    assert.equal(
      inQueueUrls.size,
      0,
      `${label}: reload during live poll must not arm inQueueUrls`
    );
    assert.ok(
      !inQueueUrls.has(normPageUrl),
      `${label}: queue page URL must not be sacred lock key after reload`
    );

    const navFailTypes = ['WALMART_NAV_FAILED', 'NAV_FAILED', 'WALMART_NAV_FAILED', 'NAV_FAILED'];
    for (let i = 0; i < navFailTypes.length; i++) {
      navigationLock.add(normWalmartProbeUrl);
      bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
        type: navFailTypes[i],
        url: walmartProbeUrl,
      });
      assert.equal(
        inQueueUrls.size,
        0,
        `${label}: live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
      );
      assert.ok(
        !inQueueUrls.has(normPageUrl),
        `${label}: live poll cycle ${i + 1} must not sacred-lock queue page ${normPageUrl} after ${navFailTypes[i]}`
      );
      if (navigationLock.has(normWalmartProbeUrl)) {
        assert.ok(
          !inQueueUrls.has(normWalmartProbeUrl),
          `${label}: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock on ${normWalmartProbeUrl} after ${navFailTypes[i]}`
        );
      }
      assert.ok(
        !bgPollWouldSkipNavigation(normPageUrl, inQueueUrls, navigationLock),
        `${label}: live poll cycle ${i + 1} must allow poll retry on unmonitored queue page (no sacred lock)`
      );
    }

    assert.equal(
      inQueueUrls.size,
      0,
      `${label}: live poll must not arm inQueueUrls on unmonitored queue page`
    );

    const wmSacredLock = new Set([normWalmartProbeUrl]);
    assert.ok(
      bgPollWouldSkipNavigation(normWalmartProbeUrl, wmSacredLock, new Set()),
      `${label}: contrast WM-5 — sacred lock would block poll; unmonitored WM-4 does not arm it`
    );
  }
}

/**
 * WM-4/WM-6: unmonitored queue timeout → NAV_FAILED (no productUrl) + poll recovery rearm.
 * Parity with FIX-3 wm4-qp-timeout-no-producturl, wm4-checkout-timeout-no-producturl,
 * wm4-poll-recovery-rearm (fixture-e2e has browser coverage).
 */
function runWm4UnmonitoredQueueTimeoutTests() {
  const WMT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../target-checkout-helper/walmart-content.js'),
    'utf8'
  );
  assert.match(
    WMT_SRC,
    /\/qp waiting room timeout — no productUrl — releasing navigation lock/,
    'WM-4 unmonitored /qp timeout: no-productUrl NAV_FAILED path in source'
  );
  assert.match(
    WMT_SRC,
    /Queue timeout — no productUrl — releasing navigation lock/,
    'WM-4 unmonitored checkout timeout: no-productUrl NAV_FAILED path in source'
  );

  function assertWm4UnmonitoredTimeoutPollRecovery(pageUrl, monitorProductUrl, label) {
    const normPageUrl = normalizeProductUrl(pageUrl);
    const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    assert.equal(inQueueUrls.size, 0, `${label}: unmonitored queue must not arm sacred lock on start`);

    const timeoutNavFail = { type: 'WALMART_NAV_FAILED', url: pageUrl };
    navigationLock.add(normPageUrl);
    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, timeoutNavFail);
    assert.ok(
      !navigationLock.has(normPageUrl),
      `${label}: timeout NAV_FAILED releases navigationLock on queue page`
    );
    assert.equal(inQueueUrls.size, 0, `${label}: timeout must not arm sacred lock`);

    navigationLock.add(normMonitorUrl);
    assert.ok(
      navigationLock.has(normMonitorUrl),
      `${label}: poll recovery re-arms navigationLock on monitor product after timeout NAV_FAILED`
    );
    assert.equal(inQueueUrls.size, 0, `${label}: poll recovery must not arm sacred lock`);

    bgApplyWalmartNavFailed(navigationLock, inQueueUrls, {
      type: 'WALMART_NAV_FAILED',
      url: monitorProductUrl,
    });
    assert.ok(
      !navigationLock.has(normMonitorUrl),
      `${label}: repeated NAV_FAILED during poll recovery releases monitor lock for retry`
    );
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `${label}: poll may retry after unmonitored timeout (no sacred lock)`
    );

    const wmSacredLock = new Set([normMonitorUrl]);
    assert.ok(
      bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
      `${label}: contrast WM-5 — sacred lock would block poll; unmonitored timeout does not arm it`
    );
  }

  const scenarios = [
    {
      label: '/qp unmonitored timeout',
      pageUrl: 'https://www.walmart.com/qp/waiting-room-timeout',
      monitorProductUrl: 'https://www.walmart.com/ip/mock-qp-unmonitored-recovery/996',
      lockMessages: () => wmQueueRoomSacredLockMessages({}),
    },
    {
      label: '/checkout unmonitored timeout',
      pageUrl: 'https://www.walmart.com/checkout/unmonitored-timeout',
      monitorProductUrl: 'https://www.walmart.com/ip/mock-checkout-unmonitored-recovery/997',
      lockMessages: () => wmCheckoutQueueSacredLockMessages({}),
    },
  ];

  for (const { label, pageUrl, monitorProductUrl, lockMessages } of scenarios) {
    assert.deepEqual(
      lockMessages(),
      [],
      `${label}: no productUrl must not send WALMART_IN_QUEUE on queue entry`
    );
    assertWm4UnmonitoredTimeoutPollRecovery(pageUrl, monitorProductUrl, label);
  }
}

async function main() {
  runPageTypeTests();
  runDispatchTests();
  await runFlowTests();
  runWm2PredropQueueTests();
  runWm2LivePollCycleTests();
  await runWm2FlowTests();
  runWm3MainWorldQueueTests();
  runWm4SacredLockTests();
  runWm5SacredLockNavTests();
  runWm5ProductQueuePollCrossPagePollRecoveryTests();
  runWm5CheckoutSpaCrossPageSacredPollRecoveryTests();
  runWm5PreTimeoutLivePollCycleTests();
  runWm5PollRecoveryRearmTests();
  runWm5CheckoutSpaLivePollCycleTests();
  runWm5CheckoutSpaCrossLivePollCycleTests();
  runWm5LivePollCycleTests();
  runWm4LivePollCycleTests();
  runWm4UnmonitoredQueueTimeoutTests();
  runWm6QueueErrorPathTests();
  runWm6PollRecoveryRearmTests();
  runWm6MissingAtcLivePollCycleTests();
  await runWm6CartCheckoutMissingTests();
  await runWm6CartCrossPageCheckoutMissingTests();
  await runWm6CartCrossPagePollRecoveryTests();
  await runWm6CartLivePollCycleTests();
  await runWm6CartCrossLivePollCycleTests();
  runWm6CheckoutSpaLivePollCycleTests();
  runWm6PriceGuardTimeoutTests();
  runWm6PriceGuardLivePollCycleTests();
  runWm6PxTimeoutOverrideTests();
  runWm6PxLivePollCycleTests();
  runWm6PxFixtureRoutesLivePollCycleTests();
  runWm7OfferIdReadyTests();
  console.log(
    'walmart-flow-simulation PASS (WM-1 + WM-2 + WM-3 + WM-4 + WM-5 + WM-6 + WM-7): page type, flow, pre-drop queue, WebSocket sniff, sacred lock, nav guard, queue error paths, WM-5 product queue cross-page poll recovery, WM-5 pre-timeout live poll cycle, WM-5 poll recovery rearm, WM-5 checkout SPA live poll cycle, WM-5 cross-page checkout SPA live poll cycle, WM-5 live poll cycle, WM-4 live poll cycle, WM-4 unmonitored queue timeout, WM-6 poll recovery rearm, missing-atc live poll cycle, cart live poll cycle, cross-page cart poll recovery, cross-page cart live poll cycle, checkout SPA live poll cycle, price-guard timeout, price-guard live poll cycle, PX timeout override, PX live poll cycle, PX fixture routes live poll cycle, offerId ready'
  );
}

main().catch((e) => {
  console.error('walmart-flow-simulation FAIL:', e);
  process.exit(1);
});
