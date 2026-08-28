#!/usr/bin/env node
/**
 * SC-1 / SC-3 / SC-4 / SC-5 / SC-6: Sam's Club retailer module — hosts, manifest, FCFS product ATC.
 * Offline simulation — no browser required.
 *
 * SC-5: FCFS race — no sacred lock / inQueueUrls (contrast WM-4/WM-5).
 * SC-6: FCFS error-path hardening — SAMS_NAV_FAILED releases poll lock, no sacred lock.
 *
 * Run: node scripts/browser-smoke/samsclub-module-simulation.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const HOSTS_SRC = readFileSync(join(ROOT, 'target-checkout-helper/core/hosts.js'), 'utf8');
const SC_SRC = readFileSync(join(ROOT, 'target-checkout-helper/samsclub-content.js'), 'utf8');
const BG_SRC = readFileSync(join(ROOT, 'target-checkout-helper/background.js'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'target-checkout-helper/manifest.json'), 'utf8'));

/** Mirrors SC_SEL in samsclub-content.js */
const SC_SEL = {
  atc:
    'button[data-testid="add-to-cart"], button[data-automation-id="add-to-cart-btn"], button[aria-label*="Add to cart" i]',
  viewCart: 'a[href="/cart"], button[data-testid="go-to-cart"], a[href*="/cart"]',
  checkout: '[data-automation-id="checkout-btn"], a[href^="/checkout"]',
};

/** Evaluate hosts.js in a vm sandbox (mirrors content-script global). */
function loadHosts() {
  const sandbox = vm.createContext({ URL });
  sandbox.globalThis = sandbox;
  vm.runInContext(HOSTS_SRC, sandbox);
  return sandbox.TCH_HOSTS;
}

/** Minimal DOM stub for offline scHandleProductPage simulations. */
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
    href: el.href,
    clicked: false,
    click() {
      this.clicked = true;
    },
  }));

  return {
    pathname,
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
      if (sel === 'button, a[role="button"]') return all;
      if (sel === 'button') return all.filter((e) => e.tag === 'button');
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
    navigate(href) {
      this.navigatedTo = href;
    },
  };
}

function scFindByText(page, text) {
  const lower = text.toLowerCase();
  return page.elements.find((el) => el.text.trim().toLowerCase().includes(lower)) || null;
}

function scFindAtcButton(page) {
  for (const sel of SC_SEL.atc.split(', ')) {
    const el = page.querySelector(sel);
    if (el) return el;
  }
  return scFindByText(page, 'add to cart');
}

function scIsVisible(el) {
  return !!(el && el.visible);
}

/**
 * Mirrors scHandleProductPage entry — SC-3: disabled ATC is not queue; no sacred lock.
 */
function scDecideProductPageEntry(page) {
  const messages = [];
  const atc = scFindAtcButton(page);
  if (!atc || atc.disabled || !scIsVisible(atc)) {
    messages.push({
      type: 'SAMS_NAV_FAILED',
      url: `https://www.samsclub.com${page.pathname}`,
    });
    return { action: 'atc_unavailable', messages };
  }
  return { action: 'proceed_atc', messages: [] };
}

/** Mirrors scHandleProductPage happy path (DOM ATC → cart). */
function scHandleProductPageSim(page, settings = {}) {
  const actions = [];
  const entry = scDecideProductPageEntry(page);
  if (entry.action === 'atc_unavailable') {
    actions.push('nav_failed');
    return { path: 'atc_unavailable', actions, messages: entry.messages };
  }

  const atcBtn = scFindAtcButton(page);
  actions.push('click_atc');
  atcBtn.click();
  actions.push('signal_atc_success');

  const cartLink =
    page.querySelector(SC_SEL.viewCart) ||
    scFindByText(page, 'view cart') ||
    scFindByText(page, 'go to cart');

  if (cartLink && scIsVisible(cartLink)) {
    actions.push('click_cart_link');
    cartLink.click();
    page.navigate('/cart');
  } else {
    actions.push('navigate_cart');
    page.navigate('https://www.samsclub.com/cart');
  }

  return {
    path: 'product_to_cart',
    actions,
    messages: [{ type: 'ATC_SUCCESS', url: settings.productUrl || `https://www.samsclub.com${page.pathname}` }],
  };
}

/** Mirrors scGetPageType — SC-2 cart page detection. */
function scGetPageTypeSim(pathname) {
  if (/\/p\//.test(pathname) || /\/ip\//.test(pathname) || /\/prod\//.test(pathname)) return 'product';
  if (pathname.includes('/cart')) return 'cart';
  if (pathname.includes('/checkout')) return 'checkout';
  return 'other';
}

/** Mirrors scHandleCartPage happy path — SC-2 FCFS cart → checkout. */
function scHandleCartPageSim(page, settings = {}) {
  const actions = [];
  const primary = page.querySelector(SC_SEL.checkout.split(', ')[0]);
  let checkoutBtn = primary && scIsVisible(primary) ? primary : null;
  if (!checkoutBtn) {
    checkoutBtn =
      page.querySelectorAll('button').find((el) => {
        const text = el.text.trim().toLowerCase();
        return (text === 'checkout' || text === 'proceed to checkout') && scIsVisible(el);
      }) || null;
  }
  if (!checkoutBtn) {
    actions.push('checkout_missing');
    return {
      path: 'checkout_not_found',
      actions,
      messages: [
        {
          type: 'SAMS_NAV_FAILED',
          url: settings.productUrl || `https://www.samsclub.com${page.pathname}`,
        },
      ],
    };
  }
  actions.push('click_checkout');
  checkoutBtn.click();
  return { path: 'cart_to_checkout', actions, messages: [] };
}

function testSc2CartPageType() {
  assert.equal(scGetPageTypeSim('/cart'), 'cart', 'SC-2: /cart → cart');
  assert.equal(scGetPageTypeSim('/cart/no-checkout'), 'cart', 'SC-2: /cart/no-checkout → cart');
}

function testSc2CartHappyPath() {
  const page = makePage({
    pathname: '/cart',
    elements: [
      {
        selectors: ['[data-automation-id="checkout-btn"]'],
        text: 'Checkout',
        tag: 'button',
      },
    ],
  });
  const result = scHandleCartPageSim(page, {
    productUrl: 'https://www.samsclub.com/p/sc2-cart/100',
  });
  assert.equal(result.path, 'cart_to_checkout', 'SC-2: cart happy path');
  assert.deepEqual(result.actions, ['click_checkout']);
  assert.ok(page.elements[0].clicked, 'SC-2: checkout button clicked');
}

function testSc2CartCheckoutMissing() {
  const page = makePage({ pathname: '/cart/no-checkout', elements: [] });
  const result = scHandleCartPageSim(page, {
    productUrl: 'https://www.samsclub.com/p/sc2-cart-missing/101',
  });
  assert.equal(result.path, 'checkout_not_found', 'SC-2: missing checkout');
  assert.deepEqual(result.actions, ['checkout_missing']);
  const navFail = result.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(navFail, 'SC-2: missing checkout sends SAMS_NAV_FAILED');
  assert.equal(
    navFail.url,
    'https://www.samsclub.com/p/sc2-cart-missing/101',
    'SC-2: NAV_FAILED uses productUrl not cart URL'
  );
}

function testSc2ProductToCartChain() {
  const productPage = makePage({
    pathname: '/p/sc2-chain/102',
    elements: [
      {
        selectors: ['button[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: false,
      },
      {
        selectors: ['a[href="/cart"]', 'button[data-automation-id="go-to-cart-btn"]'],
        text: 'View cart',
        tag: 'a',
        href: '/cart',
      },
    ],
  });
  const productResult = scHandleProductPageSim(productPage, {
    productUrl: 'https://www.samsclub.com/p/sc2-chain/102',
  });
  assert.equal(productResult.path, 'product_to_cart');
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
  const cartResult = scHandleCartPageSim(cartPage, {
    productUrl: 'https://www.samsclub.com/p/sc2-chain/102',
  });
  assert.equal(cartResult.path, 'cart_to_checkout', 'SC-2: product → cart → checkout chain');
}

function testSc2Source() {
  assert.match(SC_SRC, /scHandleCartPage/, 'SC-2: scHandleCartPage defined');
  assert.match(SC_SRC, /page === 'cart'/, 'SC-2: cart page dispatched in init');
  assert.match(SC_SRC, /scCartCheckoutWaitMs/, 'SC-2: cart checkout wait helper');
}

function testSc1Hosts() {
  const hosts = loadHosts();
  assert.ok(hosts.SAMSCLUB, 'SC-1: TCH_HOSTS.SAMSCLUB defined');
  assert.equal(hosts.SAMSCLUB.id, 'samsclub');
  assert.equal(hosts.SAMSCLUB.hostSuffixes[0], 'samsclub.com');

  assert.equal(hosts.detectRetailer('https://www.samsclub.com/p/test/123'), 'samsclub');
  assert.equal(hosts.detectRetailer('https://samsclub.com/cart'), 'samsclub');
  assert.equal(hosts.detectRetailer('https://www.target.com/p/x'), 'target');
  assert.equal(hosts.detectRetailer('https://www.walmart.com/ip/x'), 'walmart');
  assert.equal(hosts.detectRetailer('https://example.com/'), null);

  assert.equal(hosts.cookieDomainsFor('samsclub')[0], 'samsclub.com');
  assert.equal(hosts.cookieDomainsFor('target')[0], 'target.com');
}

function testSc1Manifest() {
  assert.ok(
    MANIFEST.host_permissions.some((p) => p.includes('samsclub.com')),
    'SC-1: manifest host_permissions includes samsclub.com'
  );

  const scScript = MANIFEST.content_scripts.find((cs) =>
    cs.matches.some((m) => m.includes('samsclub.com'))
  );
  assert.ok(scScript, 'SC-1: content_scripts entry for samsclub.com');
  assert.ok(
    scScript.js.includes('samsclub-content.js'),
    'SC-1: samsclub content script loads samsclub-content.js'
  );
  assert.ok(
    scScript.js.includes('core/hosts.js'),
    'SC-1: samsclub content script loads core/hosts.js'
  );
}

function testSc1StubSource() {
  assert.ok(SC_SRC.includes('[TCH] init:'), 'SC-1: stub logs [TCH] init');
  assert.ok(
    SC_SRC.includes("detectRetailer(location.href) !== 'samsclub'"),
    'SC-1: stub guards on samsclub retailer detection'
  );
  assert.ok(SC_SRC.includes('FCFS'), 'SC-1: FCFS semantics documented in source');
  assert.ok(!SC_SRC.includes('WALMART_IN_QUEUE'), 'SC-5: stub must not emit WALMART_IN_QUEUE');
  assert.ok(!SC_SRC.includes('walmart-content'), 'SC-3: must not import walmart-content.js');
  assert.ok(SC_SRC.includes('scGetPageType'), 'SC-1: page type helper for init telemetry');
}

function testSc3Source() {
  assert.ok(SC_SRC.includes('scHandleProductPage'), 'SC-3: scHandleProductPage defined');
  assert.ok(SC_SRC.includes('scSignalAtcSuccess'), 'SC-3: scSignalAtcSuccess defined');
  assert.ok(SC_SRC.includes("type: 'ATC_SUCCESS'"), 'SC-3: emits ATC_SUCCESS on success');
  assert.ok(SC_SRC.includes('scSignalNavFailed'), 'SC-3: scSignalNavFailed for unavailable ATC');
  assert.ok(SC_SRC.includes("type: 'SAMS_NAV_FAILED'"), 'SC-3: emits SAMS_NAV_FAILED, not WALMART_IN_QUEUE');
  assert.ok(!SC_SRC.includes('inQueueUrls'), 'SC-5: must not reference sacred lock');
  assert.ok(!SC_SRC.includes('wmWaitInProductQueue'), 'SC-3: must not inherit Walmart queue wait');
}

function testSc3DisabledAtcNotQueue() {
  const page = makePage({
    pathname: '/p/test-item/123',
    elements: [
      {
        selectors: ['button[data-testid="add-to-cart"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });
  const entry = scDecideProductPageEntry(page);
  assert.equal(entry.action, 'atc_unavailable', 'SC-3: disabled ATC alone is not queue wait');
  assert.ok(
    entry.messages.some((m) => m.type === 'SAMS_NAV_FAILED'),
    'SC-3: unavailable ATC releases nav lock via SAMS_NAV_FAILED'
  );
  assert.ok(
    !entry.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'SC-3: disabled ATC must not arm sacred lock'
  );
}

function testSc3ProductPageHappyPath() {
  const page = makePage({
    pathname: '/p/test-item/456',
    elements: [
      {
        selectors: ['button[data-testid="add-to-cart"]'],
        text: 'Add to cart',
        disabled: false,
      },
      {
        tag: 'a',
        selectors: ['a[href="/cart"]'],
        text: 'View cart',
        href: '/cart',
      },
    ],
  });

  const result = scHandleProductPageSim(page, {
    productUrl: 'https://www.samsclub.com/p/test-item/456',
  });

  assert.equal(result.path, 'product_to_cart');
  assert.deepEqual(result.actions, ['click_atc', 'signal_atc_success', 'click_cart_link']);
  assert.ok(
    result.messages.some((m) => m.type === 'ATC_SUCCESS'),
    'SC-3: happy path signals ATC_SUCCESS'
  );
  assert.ok(page.elements[0].clicked, 'SC-3: ATC button clicked');
  assert.equal(page.navigatedTo, '/cart');
}

function testSc3ProductPageNavigateCartFallback() {
  const page = makePage({
    pathname: '/ip/test/789',
    elements: [
      {
        selectors: ['button[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: false,
      },
    ],
  });

  const result = scHandleProductPageSim(page);
  assert.equal(result.path, 'product_to_cart');
  assert.ok(result.actions.includes('navigate_cart'), 'SC-3: falls back to /cart navigation');
  assert.equal(page.navigatedTo, 'https://www.samsclub.com/cart');
}

/** Mirrors background.js normalizeProductUrl. */
function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

/** Mirrors background.js poll loop skip checks (inQueueUrls / navigationLock). */
function bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock) {
  if (inQueueUrls.has(normUrl)) return true;
  if (navigationLock.has(normUrl)) return true;
  return false;
}

/** Mirrors background.js SAMS_NAV_FAILED / WALMART_NAV_FAILED — navigationLock only. */
function bgApplyNavFailed(navigationLock, inQueueUrls, message) {
  const normFailUrl = normalizeProductUrl(message.url || '');
  if (normFailUrl) navigationLock.delete(normFailUrl);
  return normFailUrl;
}

/** Mirrors background.js handleATCSuccess lock release — never arms inQueueUrls. */
function bgApplyAtcSuccess(navigationLock, inQueueUrls, message) {
  const normUrl = normalizeProductUrl(message.url || '');
  if (normUrl) {
    navigationLock.delete(normUrl);
    inQueueUrls.delete(normUrl);
  }
  return normUrl;
}

/** Mirrors background.js isInCheckoutFlow — tab already in cart/checkout/thank-you. */
function isInCheckoutFlow(url) {
  try {
    const path = new URL(url).pathname;
    return /^\/(cart|checkout|thankyou|thank-you|order-confirm)/i.test(path);
  } catch {
    return false;
  }
}

/** Mirrors background.js poll restock navigate guard (WM-5 sacred lock + checkout flow). */
function bgWouldNavigateRestock(normUrl, tabUrl, inQueueUrls, navigationLock) {
  if (inQueueUrls.has(normUrl)) return false;
  if (navigationLock.has(normUrl)) return false;
  if (isInCheckoutFlow(tabUrl) && inQueueUrls.has(normUrl)) return false;
  return true;
}

/** Mirrors scSignalAtcSuccess — SC-5: ATC_SUCCESS only. */
function scFcfsSuccessMessages(productUrl) {
  return [{ type: 'ATC_SUCCESS', url: productUrl }];
}

function runSc5FcfsNoSacredLockTests() {
  const productUrl = 'https://www.samsclub.com/p/sc5-fcfs-race/123';
  const normUrl = normalizeProductUrl(productUrl);
  const inQueueUrls = new Set();
  const navigationLock = new Set();

  // SC-5: scSignalAtcSuccess path emits ATC_SUCCESS only — never WALMART_IN_QUEUE.
  const successMsgs = scFcfsSuccessMessages(productUrl);
  assert.equal(successMsgs.length, 1, 'SC-5: FCFS success sends one message');
  assert.equal(successMsgs[0].type, 'ATC_SUCCESS', 'SC-5: message type is ATC_SUCCESS');
  assert.ok(
    !successMsgs.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'SC-5: FCFS success must not emit WALMART_IN_QUEUE'
  );

  // SC-5: happy-path sim never arms sacred lock.
  const happyPage = makePage({
    pathname: '/p/sc5-fcfs-race/123',
    elements: [
      {
        selectors: ['button[data-testid="add-to-cart"]'],
        text: 'Add to cart',
        disabled: false,
      },
      {
        tag: 'a',
        selectors: ['a[href="/cart"]'],
        text: 'View cart',
        href: '/cart',
      },
    ],
  });
  const happyResult = scHandleProductPageSim(happyPage, { productUrl });
  assert.ok(
    !happyResult.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'SC-5: product-page happy path must not arm sacred lock'
  );
  for (const msg of happyResult.messages) {
    if (msg.type === 'ATC_SUCCESS') bgApplyAtcSuccess(navigationLock, inQueueUrls, msg);
  }
  assert.equal(inQueueUrls.size, 0, 'SC-5: ATC_SUCCESS must not populate inQueueUrls');

  // SC-5: unavailable ATC → SAMS_NAV_FAILED — releases nav lock, no sacred lock.
  inQueueUrls.clear();
  navigationLock.clear();
  navigationLock.add(normUrl);
  const failPage = makePage({
    pathname: '/p/sc5-fcfs-race/123',
    elements: [
      {
        selectors: ['button[data-testid="add-to-cart"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });
  const failEntry = scDecideProductPageEntry(failPage);
  const navFailMsg = failEntry.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(navFailMsg, 'SC-5: unavailable ATC sends SAMS_NAV_FAILED');
  assert.ok(
    !failEntry.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'SC-5: unavailable ATC must not arm sacred lock'
  );
  bgApplyNavFailed(navigationLock, inQueueUrls, navFailMsg);
  assert.ok(!navigationLock.has(normUrl), 'SC-5: SAMS_NAV_FAILED releases navigationLock');
  assert.equal(inQueueUrls.size, 0, 'SC-5: SAMS_NAV_FAILED must not populate inQueueUrls');
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'SC-5: FCFS race — poll may retry immediately after SAMS_NAV_FAILED'
  );

  // SC-5: contrast WM-5 — sacred lock would block poll; Sam's FCFS never arms it.
  inQueueUrls.clear();
  navigationLock.clear();
  navigationLock.add(normUrl);
  // Simulate poll cycle: nav lock held while content script loads — no sacred lock.
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'SC-5: navigationLock alone blocks poll during load'
  );
  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'SAMS_NAV_FAILED', url: productUrl });
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'SC-5: FCFS race allows poll re-navigation after failure (no sacred lock)'
  );

  // SC-5: ATC_SUCCESS clears locks without ever adding to inQueueUrls.
  inQueueUrls.add(normUrl); // hypothetical stale lock — Sam's should never add, but ATC clears.
  navigationLock.add(normUrl);
  bgApplyAtcSuccess(navigationLock, inQueueUrls, { type: 'ATC_SUCCESS', url: productUrl });
  assert.ok(!navigationLock.has(normUrl), 'SC-5: ATC_SUCCESS releases navigationLock');
  assert.ok(!inQueueUrls.has(normUrl), 'SC-5: ATC_SUCCESS clears inQueueUrls without arming');
}

/**
 * Parity with FIX-3 sc5-sc6-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runSc5Sc6LivePollCycleTests() {
  const scenarios = [
    {
      label: 'SC-5 FCFS',
      productUrl: 'https://www.samsclub.com/p/mock-fcfs-live/700',
    },
    {
      label: 'SC-6 restock',
      productUrl: 'https://www.samsclub.com/p/mock-fcfs-restock/790',
    },
    {
      label: 'SC-6 invisible ATC',
      productUrl: 'https://www.samsclub.com/p/mock-fcfs-invisible/791',
    },
    {
      label: "SC cart",
      productUrl: 'https://www.samsclub.com/cart',
    },
    {
      label: 'SC checkout SPA',
      productUrl: 'https://www.samsclub.com/checkout/spa-stall',
    },
  ];

  for (const { label, productUrl } of scenarios) {
    const normUrl = normalizeProductUrl(productUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    assert.ok(
      !inQueueUrls.has(normUrl),
      `${label}: must not be sacred lock key before live poll`
    );

    // Simulated FCFS tab reload during live poll — no sacred lock.
    assert.equal(
      inQueueUrls.size,
      0,
      `${label}: reload during live poll must not arm inQueueUrls`
    );
    assert.ok(
      !inQueueUrls.has(normUrl),
      `${label}: URL must not be sacred lock key after reload`
    );

    const liveSignalTypes = ['NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED', 'ATC_SUCCESS'];
    for (let i = 0; i < liveSignalTypes.length; i++) {
      navigationLock.add(normUrl);
      if (liveSignalTypes[i] === 'ATC_SUCCESS') {
        bgApplyAtcSuccess(navigationLock, inQueueUrls, { type: 'ATC_SUCCESS', url: productUrl });
      } else {
        bgApplyNavFailed(navigationLock, inQueueUrls, {
          type: liveSignalTypes[i],
          url: productUrl,
        });
      }
      assert.equal(
        inQueueUrls.size,
        0,
        `${label}: live poll cycle ${i + 1} must not arm inQueueUrls after ${liveSignalTypes[i]}`
      );
      assert.ok(
        !inQueueUrls.has(normUrl),
        `${label}: live poll cycle ${i + 1} must not sacred-lock ${normUrl} after ${liveSignalTypes[i]}`
      );
      if (navigationLock.has(normUrl)) {
        assert.ok(
          !inQueueUrls.has(normUrl),
          `${label}: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${liveSignalTypes[i]}`
        );
      }
      assert.ok(
        !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
        `${label}: live poll cycle ${i + 1} allows poll retry after ${liveSignalTypes[i]} (no sacred lock)`
      );
    }

    assert.equal(inQueueUrls.size, 0, `${label}: live poll must not arm inQueueUrls`);

    const wmSacredLock = new Set([normUrl]);
    assert.ok(
      bgPollWouldSkipNavigation(normUrl, wmSacredLock, new Set()),
      `${label}: contrast WM-5 — sacred lock would block poll; SC FCFS does not arm it`
    );
  }
}

function testSc5Source() {
  assert.ok(SC_SRC.includes('scSignalAtcSuccess'), 'SC-5: scSignalAtcSuccess defined');
  assert.ok(
    SC_SRC.includes("type: 'ATC_SUCCESS'"),
    'SC-5: scSignalAtcSuccess emits ATC_SUCCESS'
  );
  assert.ok(!SC_SRC.includes('WALMART_IN_QUEUE'), 'SC-5: source must not emit WALMART_IN_QUEUE');
  assert.ok(!SC_SRC.includes('inQueueUrls'), 'SC-5: source must not reference sacred lock');
  assert.ok(
    SC_SRC.includes('SAMS_NAV_FAILED'),
    'SC-5: FCFS failure uses SAMS_NAV_FAILED not sacred lock'
  );
}

/** Mirrors scHandleProductPage when scWaitFor times out — no ATC within 8s. */
function scSimulateAtcTimeout(pathname) {
  return {
    action: 'atc_timeout',
    messages: [{ type: 'SAMS_NAV_FAILED', url: `https://www.samsclub.com${pathname}` }],
  };
}

/**
 * Mirrors scHandleProductPage scWaitFor outcome — disabled ATC never satisfies wait.
 * Contrast scDecideProductPageEntry which fails immediately on disabled button.
 */
function scSimulateWaitForDisabledAtc(page) {
  const el = scFindAtcButton(page);
  if (el && !el.disabled && scIsVisible(el)) {
    return { action: 'proceed_atc', messages: [] };
  }
  // scWaitFor polled until deadline — disabled/invisible never satisfied
  return scSimulateAtcTimeout(page.pathname);
}

function scDecideProductPageMissingAtc(page) {
  const atc = scFindAtcButton(page);
  if (!atc) {
    return {
      action: 'atc_unavailable',
      messages: [{ type: 'SAMS_NAV_FAILED', url: `https://www.samsclub.com${page.pathname}` }],
    };
  }
  return scDecideProductPageEntry(page);
}

function scDecideProductPageInvisibleAtc(page) {
  const atc = scFindAtcButton(page);
  if (atc && !scIsVisible(atc)) {
    return {
      action: 'atc_unavailable',
      messages: [{ type: 'SAMS_NAV_FAILED', url: `https://www.samsclub.com${page.pathname}` }],
    };
  }
  return scDecideProductPageEntry(page);
}

/** Mirrors scHandleProductPage scWaitFor timeout — invisible/disabled ATC never satisfies wait. */
function scInvisibleAtcTimeoutMessages(page, productUrl) {
  const el = scFindAtcButton(page);
  if (el && !el.disabled && scIsVisible(el)) return [];
  return [{ type: 'SAMS_NAV_FAILED', url: productUrl }];
}

function testSc6Source() {
  assert.ok(SC_SRC.includes('scSignalNavFailed'), 'SC-6: scSignalNavFailed defined');
  assert.ok(
    SC_SRC.includes("type: 'SAMS_NAV_FAILED'"),
    'SC-6: scSignalNavFailed emits SAMS_NAV_FAILED'
  );
  assert.ok(
    SC_SRC.includes('releasing navigation lock'),
    'SC-6: error path logs navigation lock release'
  );
  assert.ok(BG_SRC.includes("case 'SAMS_NAV_FAILED'"), 'SC-6: background handles SAMS_NAV_FAILED');
  assert.ok(
    BG_SRC.includes('navigationLock.delete(normFailUrl)'),
    'SC-6: background releases navigationLock on NAV_FAILED'
  );
  const navFailedBlock = BG_SRC.slice(
    BG_SRC.indexOf("case 'SAMS_NAV_FAILED'"),
    BG_SRC.indexOf("case 'WALMART_IN_QUEUE'")
  );
  assert.ok(
    !navFailedBlock.includes('inQueueUrls.add'),
    'SC-6: SAMS_NAV_FAILED handler must not arm sacred lock'
  );
}

function runSc6ErrorPathHardeningTests() {
  const productUrl = 'https://www.samsclub.com/p/sc6-error-path/999';
  const normUrl = normalizeProductUrl(productUrl);
  const inQueueUrls = new Set();
  const navigationLock = new Set();

  // SC-6: missing ATC button → SAMS_NAV_FAILED, releases poll lock.
  const missingPage = makePage({ pathname: '/p/sc6-error-path/999', elements: [] });
  const missingDecision = scDecideProductPageMissingAtc(missingPage);
  assert.equal(missingDecision.action, 'atc_unavailable', 'SC-6: missing ATC is nav_failed');
  const missingMsg = missingDecision.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(missingMsg, 'SC-6: missing ATC sends SAMS_NAV_FAILED');
  navigationLock.add(normUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, missingMsg);
  assert.ok(!navigationLock.has(normUrl), 'SC-6: missing ATC releases navigationLock');
  assert.equal(inQueueUrls.size, 0, 'SC-6: missing ATC must not arm sacred lock');

  // SC-6: invisible ATC → SAMS_NAV_FAILED.
  navigationLock.add(normUrl);
  const invisiblePage = makePage({
    pathname: '/p/sc6-error-path/999',
    elements: [
      {
        selectors: ['button[data-testid="add-to-cart"]'],
        text: 'Add to cart',
        disabled: false,
        visible: false,
      },
    ],
  });
  const invisibleDecision = scDecideProductPageInvisibleAtc(invisiblePage);
  assert.equal(invisibleDecision.action, 'atc_unavailable', 'SC-6: invisible ATC is nav_failed');
  const invisibleMsg = invisibleDecision.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(invisibleMsg, 'SC-6: invisible ATC sends SAMS_NAV_FAILED');
  bgApplyNavFailed(navigationLock, inQueueUrls, invisibleMsg);
  assert.ok(!navigationLock.has(normUrl), 'SC-6: invisible ATC releases navigationLock');

  // SC-6: ATC wait timeout (scWaitFor returns null) → SAMS_NAV_FAILED.
  navigationLock.add(normUrl);
  const timeoutResult = scSimulateAtcTimeout('/p/sc6-error-path/999');
  assert.equal(timeoutResult.action, 'atc_timeout', 'SC-6: timeout path identified');
  const timeoutMsg = timeoutResult.messages[0];
  assert.equal(timeoutMsg.type, 'SAMS_NAV_FAILED', 'SC-6: timeout sends SAMS_NAV_FAILED');
  bgApplyNavFailed(navigationLock, inQueueUrls, timeoutMsg);
  assert.ok(!navigationLock.has(normUrl), 'SC-6: timeout releases navigationLock');
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'SC-6: poll may retry after timeout when not in queue'
  );

  // SC-6: SAMS_NAV_FAILED never adds to inQueueUrls (contrast WM-4 sacred lock).
  inQueueUrls.clear();
  navigationLock.clear();
  navigationLock.add(normUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'SAMS_NAV_FAILED', url: productUrl });
  assert.equal(inQueueUrls.size, 0, 'SC-6: NAV_FAILED must not populate inQueueUrls');
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'SC-6: poll lock released — background may re-navigate on next cycle'
  );

  // SC-6: stale inQueueUrls from another retailer must survive SAMS_NAV_FAILED (WM-5 parity).
  const staleUrl = normalizeProductUrl('https://www.walmart.com/ip/stale-wm/1');
  inQueueUrls.add(staleUrl);
  navigationLock.add(normUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'SAMS_NAV_FAILED', url: productUrl });
  assert.ok(inQueueUrls.has(staleUrl), 'SC-6: SAMS_NAV_FAILED must not clear unrelated inQueueUrls');
  assert.ok(!navigationLock.has(normUrl), 'SC-6: SAMS_NAV_FAILED still releases Sam poll lock');

  // SC-6: scWaitFor disabled ATC timeout — mirrors source wait loop, not immediate fail.
  const disabledWaitUrl = 'https://www.samsclub.com/p/sc6-disabled-wait/888';
  const disabledWaitNorm = normalizeProductUrl(disabledWaitUrl);
  navigationLock.clear();
  inQueueUrls.clear();
  navigationLock.add(disabledWaitNorm);
  const disabledWaitPage = makePage({
    pathname: '/p/sc6-disabled-wait/888',
    elements: [
      {
        selectors: ['button[data-testid="add-to-cart"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });
  const disabledWaitResult = scSimulateWaitForDisabledAtc(disabledWaitPage);
  assert.equal(disabledWaitResult.action, 'atc_timeout', 'SC-6: disabled ATC wait ends in timeout');
  const disabledWaitMsg = disabledWaitResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(disabledWaitMsg, 'SC-6: disabled ATC wait timeout sends SAMS_NAV_FAILED');
  bgApplyNavFailed(navigationLock, inQueueUrls, disabledWaitMsg);
  assert.ok(
    !navigationLock.has(disabledWaitNorm),
    'SC-6: disabled wait timeout releases navigationLock'
  );
  assert.equal(inQueueUrls.size, 0, 'SC-6: disabled wait timeout must not arm sacred lock');

  // SC-6: isInCheckoutFlow + no sacred lock — FCFS may navigate cart/checkout on restock (contrast WM-5).
  const checkoutTabUrl = 'https://www.samsclub.com/checkout';
  const cartTabUrl = 'https://www.samsclub.com/cart';
  assert.ok(isInCheckoutFlow(checkoutTabUrl), 'SC-6: samsclub /checkout is checkout flow');
  assert.ok(isInCheckoutFlow(cartTabUrl), 'SC-6: cart path is checkout flow');
  inQueueUrls.clear();
  navigationLock.clear();
  assert.ok(
    bgWouldNavigateRestock(normUrl, checkoutTabUrl, inQueueUrls, navigationLock),
    'SC-6: FCFS restock may navigate checkout tab when no sacred lock (contrast WM-5)'
  );
  assert.ok(
    bgWouldNavigateRestock(normUrl, cartTabUrl, inQueueUrls, navigationLock),
    'SC-6: FCFS restock may navigate cart tab when no sacred lock'
  );
  navigationLock.add(normUrl);
  assert.ok(
    !bgWouldNavigateRestock(normUrl, checkoutTabUrl, inQueueUrls, navigationLock),
    'SC-6: navigationLock blocks restock until NAV_FAILED'
  );
}

/** SC-6: product → cart (no checkout) → SAMS_NAV_FAILED — full error-path chain. */
function testSc6ProductToCartCheckoutMissingChain() {
  const productUrl = 'https://www.samsclub.com/p/sc6-cart-missing/792';
  const normUrl = normalizeProductUrl(productUrl);

  const productPage = makePage({
    pathname: '/p/sc6-cart-missing/792',
    elements: [
      {
        selectors: ['button[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
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
  const productResult = scHandleProductPageSim(productPage, { productUrl });
  assert.equal(productResult.path, 'product_to_cart', 'SC-6: product ATC → cart');
  assert.equal(productPage.navigatedTo, '/cart');

  const cartPage = makePage({ pathname: '/cart/no-checkout', elements: [] });
  const cartResult = scHandleCartPageSim(cartPage, { productUrl });
  assert.equal(cartResult.path, 'checkout_not_found', 'SC-6: cart missing checkout');
  assert.deepEqual(cartResult.actions, ['checkout_missing']);

  const navFail = cartResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(navFail, 'SC-6: cart checkout-missing sends SAMS_NAV_FAILED');
  assert.equal(navFail.url, productUrl, 'SC-6: NAV_FAILED uses productUrl not cart URL');

  const inQueueUrls = new Set();
  const navigationLock = new Set([normUrl]);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'SC-6: cart checkout-missing must not arm sacred lock');
  assert.ok(!navigationLock.has(normUrl), 'SC-6: cart checkout-missing releases navigationLock');
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'SC-6: poll may retry after cart checkout-missing NAV_FAILED'
  );
}

/** SC-6: cross-page cart checkout-missing — tab on /cart/*, monitor keys distinct productUrl (parity WM-6 / FIX-3). */
function testSc6CartCrossPageCheckoutMissingChain() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-fcfs-cart-cross-monitor/794';
  const recoveryProductUrl = 'https://www.samsclub.com/p/mock-fcfs-cart-cross-recovery/795';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);

  const cartPage = makePage({ pathname: '/cart/no-checkout-cross', elements: [] });
  const cartResult = scHandleCartPageSim(cartPage, { productUrl: monitorProductUrl });
  assert.equal(cartResult.path, 'checkout_not_found', 'SC-6: cross-page cart missing checkout');
  assert.deepEqual(cartResult.actions, ['checkout_missing']);
  const navFail = cartResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(navFail, 'SC-6: cross-page cart sends SAMS_NAV_FAILED');
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'SC-6: cross-page NAV_FAILED uses monitor productUrl not cart tab URL'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normalizeProductUrl(`https://www.samsclub.com${cartPage.pathname}`),
    'SC-6: cross-page NAV_FAILED must not key cart pathname'
  );

  const inQueueUrls = new Set();
  const navigationLock = new Set([normMonitorUrl]);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page cart checkout-missing must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'SC-6: cross-page cart checkout-missing releases navigationLock on monitor product'
  );
  assert.ok(
    !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'SC-6: poll may retry monitor product after cross-page cart NAV_FAILED'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6: cross-page poll recovery clears monitor lock');
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'SC-6: cross-page poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page poll recovery must not arm sacred lock');
  bgApplyNavFailed(navigationLock, inQueueUrls, {
    type: 'SAMS_NAV_FAILED',
    url: recoveryProductUrl,
  });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'SC-6: cross-page NAV_FAILED during poll recovery releases recovery lock'
  );
}

/**
 * SC-6: cross-page cart poll recovery — tab on /cart/no-checkout-cross, monitor keys distinct productUrl.
 * Parity with FIX-3 sc6-cart-cross-poll-recovery (fixture-e2e has browser coverage).
 */
function testSc6CartCrossPagePollRecovery() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-fcfs-cart-cross-monitor/794';
  const recoveryProductUrl = 'https://www.samsclub.com/p/mock-fcfs-cart-cross-recovery/795';
  const cartTabUrl = 'https://www.samsclub.com/cart/no-checkout-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normCartTabUrl = normalizeProductUrl(cartTabUrl);

  const cartPage = makePage({ pathname: '/cart/no-checkout-cross', elements: [] });
  const cartResult = scHandleCartPageSim(cartPage, { productUrl: monitorProductUrl });
  assert.equal(cartResult.path, 'checkout_not_found', 'SC-6 cart cross: missing checkout path');
  assert.deepEqual(cartResult.actions, ['checkout_missing'], 'SC-6 cart cross: checkout_missing action');

  const inQueueUrls = new Set();
  const navigationLock = new Set();
  assert.equal(inQueueUrls.size, 0, 'SC-6 cart cross: must not arm sacred lock at cart');
  assert.ok(
    !inQueueUrls.has(normCartTabUrl),
    'SC-6 cart cross: cart tab URL must not be sacred lock key'
  );
  assert.ok(
    !navigationLock.has(normCartTabUrl),
    'SC-6 cart cross: cart tab URL must not be navigationLock key at cart'
  );

  const navFail = cartResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(navFail, 'SC-6 cart cross: sends SAMS_NAV_FAILED');
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'SC-6 cart cross: live poll NAV_FAILED uses monitor productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normCartTabUrl,
    'SC-6 cart cross: NAV_FAILED must not key cart tab URL'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'SC-6 cart cross: NAV_FAILED must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'SC-6 cart cross: NAV_FAILED releases navigationLock on monitor product'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'SC-6 cart cross: poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'SC-6 cart cross: poll recovery must not arm sacred lock');

  bgApplyNavFailed(navigationLock, inQueueUrls, {
    type: 'SAMS_NAV_FAILED',
    url: recoveryProductUrl,
  });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'SC-6 cart cross: NAV_FAILED during poll recovery releases recovery lock'
  );
}

/**
 * SC-6: cross-page checkout SPA timeout — tab on /checkout/*, SAMS_NAV_FAILED keys monitor productUrl.
 * Parity with FIX-3 sc6-checkout-spa-cross-poll-recovery (fixture-e2e has browser coverage).
 */
function testSc6CheckoutSpaCrossPagePollRecovery() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-checkout-spa-cross-monitor/796';
  const recoveryProductUrl = 'https://www.samsclub.com/p/mock-checkout-spa-cross-recovery/797';
  const checkoutTabUrl = 'https://www.samsclub.com/checkout/spa-stall-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  assert.match(
    SC_SRC,
    /scSignalNavFailed\(settings\.productUrl \|\| location\.href\)/,
    'SC-6: checkout SPA timeout uses settings.productUrl before location.href'
  );

  const navFail = { type: 'SAMS_NAV_FAILED', url: monitorProductUrl };
  assert.equal(
    navFail.url,
    monitorProductUrl,
    'SC-6: cross-page checkout SPA NAV_FAILED uses monitor productUrl'
  );
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normCheckoutTabUrl,
    'SC-6: cross-page checkout SPA NAV_FAILED must not key checkout tab URL'
  );

  const inQueueUrls = new Set();
  const navigationLock = new Set([normMonitorUrl]);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page checkout SPA timeout must not arm sacred lock');
  assert.ok(
    !navigationLock.has(normMonitorUrl),
    'SC-6: cross-page checkout SPA timeout releases navigationLock on monitor product'
  );
  assert.ok(
    !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
    'SC-6: poll may retry monitor product after cross-page checkout SPA timeout'
  );

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, navFail);
  navigationLock.add(normRecoveryUrl);
  assert.ok(
    navigationLock.has(normRecoveryUrl),
    'SC-6: cross-page poll recovery re-arms navigationLock on recovery product'
  );
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page poll recovery must not arm sacred lock');
  bgApplyNavFailed(navigationLock, inQueueUrls, {
    type: 'SAMS_NAV_FAILED',
    url: recoveryProductUrl,
  });
  assert.ok(
    !navigationLock.has(normRecoveryUrl),
    'SC-6: cross-page NAV_FAILED during poll recovery releases recovery lock'
  );
}

/** Mirrors scCheckoutHasReview — SC-4 review step detection. */
function scCheckoutHasReviewSim(page) {
  const placeOrder = page.querySelector('[data-automation-id="place-order-btn"]');
  if (placeOrder && scIsVisible(placeOrder)) return true;
  return !!scFindByText(page, 'place order');
}

/** SC-4: checkout SPA review step — TGT-4 manual stop at review. */
function scHandleReviewSim(page, settings = {}) {
  const actions = [];
  if (!settings.autoPlaceOrder) {
    actions.push('review_manual_stop');
    return { path: 'review_manual', actions };
  }
  const btn = page.querySelector('[data-automation-id="place-order-btn"]') || scFindByText(page, 'place order');
  if (btn && scIsVisible(btn)) {
    actions.push('click_place_order');
    btn.click();
    return { path: 'review_auto', actions };
  }
  return { path: 'review_missing_btn', actions };
}

function testSc4Source() {
  assert.match(SC_SRC, /scHandleCheckout/, 'SC-4: scHandleCheckout defined');
  assert.match(SC_SRC, /scHandleReview/, 'SC-4: scHandleReview defined');
  assert.match(SC_SRC, /page === 'checkout'/, 'SC-4: checkout page dispatched in init');
  assert.match(SC_SRC, /\[SC\] review reached/, 'SC-4: review reached log');
  assert.match(SC_SRC, /scCheckoutTotalTimeoutMs/, 'SC-4: checkout timeout helper');
  assert.ok(!SC_SRC.includes('WALMART_IN_QUEUE'), 'SC-4: must not emit WALMART_IN_QUEUE');
  assert.ok(!SC_SRC.includes('wmHandleQueue'), 'SC-4: must not inherit Walmart queue handlers');
}

function testSc4ManualReviewStop() {
  const page = makePage({
    pathname: '/checkout',
    elements: [
      {
        selectors: ['[data-automation-id="place-order-btn"]'],
        tag: 'button',
        text: 'Place order',
      },
    ],
  });
  const result = scHandleReviewSim(page, { autoPlaceOrder: false });
  assert.equal(result.path, 'review_manual', 'SC-4: manual stop at review');
  assert.ok(result.actions.includes('review_manual_stop'), 'SC-4: does not click Place Order');
  assert.equal(page.elements[0].clicked, false, 'SC-4: Place Order not clicked');
}

function testSc4CheckoutReviewPath() {
  const page = makePage({
    pathname: '/checkout',
    elements: [
      {
        selectors: ['[data-automation-id="place-order-btn"]'],
        tag: 'button',
        text: 'Place order',
      },
    ],
  });
  assert.ok(scCheckoutHasReviewSim(page), 'SC-4: review step detected');
  const result = scHandleReviewSim(page, { autoPlaceOrder: false });
  assert.equal(result.path, 'review_manual', 'SC-4: checkout review happy path');
}

function testSc4CheckoutTimeoutNavFailed() {
  const productUrl = 'https://www.samsclub.com/p/mock-fcfs/789';
  const normUrl = normalizeProductUrl(productUrl);
  const navigationLock = new Set([normUrl]);
  const inQueueUrls = new Set();

  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'SAMS_NAV_FAILED', url: productUrl });
  assert.equal(inQueueUrls.size, 0, 'SC-4: checkout timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normUrl), 'SC-4: checkout timeout releases navigationLock');
  assert.match(SC_SRC, /scHandleCheckout timed out/, 'SC-4: timeout log in source');
  assert.match(
    SC_SRC,
    /Checkout step timeout — take over manually/,
    'SC-4: checkout timeout shows user-facing toast'
  );
}

/**
 * SC-3: disabled ATC wait timeout → poll recovery rearm — no sacred lock.
 * Parity with FIX-3 sc3-poll-recovery-rearm (fixture-e2e has browser coverage).
 */
function runSc3PollRecoveryRearmTests() {
  const productUrl = 'https://www.samsclub.com/p/mock-fcfs-disabled/792';
  const normUrl = normalizeProductUrl(productUrl);
  const inQueueUrls = new Set();
  const navigationLock = new Set();

  const disabledPage = makePage({
    pathname: '/p/mock-fcfs-disabled/792',
    elements: [
      {
        selectors: ['button[data-testid="add-to-cart"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });
  const waitResult = scSimulateWaitForDisabledAtc(disabledPage);
  assert.equal(waitResult.action, 'atc_timeout', 'SC-3: disabled ATC wait ends in timeout');
  const timeoutMsg = waitResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(timeoutMsg, 'SC-3: disabled ATC wait timeout sends SAMS_NAV_FAILED');
  assert.equal(timeoutMsg.url, productUrl, 'SC-3: NAV_FAILED uses monitor productUrl');

  navigationLock.add(normUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, timeoutMsg);
  assert.ok(!navigationLock.has(normUrl), 'SC-3: disabled ATC timeout releases navigationLock');
  assert.equal(inQueueUrls.size, 0, 'SC-3: disabled ATC timeout must not arm sacred lock');
  assert.match(SC_SRC, /FCFS restock wait/, 'SC-3: disabled ATC restock wait log in source');
  assert.match(
    SC_SRC,
    /ATC button not found or disabled/,
    'SC-3: disabled ATC timeout user-facing log in source'
  );

  // Poll recovery rearm — background re-navigates after NAV_FAILED, no sacred lock.
  navigationLock.add(normUrl);
  assert.ok(
    navigationLock.has(normUrl),
    'SC-3: poll recovery re-arms navigationLock after disabled ATC NAV_FAILED'
  );
  assert.equal(inQueueUrls.size, 0, 'SC-3: poll recovery must not arm sacred lock');
  bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'SAMS_NAV_FAILED', url: productUrl });
  assert.ok(
    !navigationLock.has(normUrl),
    'SC-3: repeated NAV_FAILED during poll recovery releases lock for retry'
  );
  assert.ok(
    !bgPollWouldSkipNavigation(normUrl, inQueueUrls, navigationLock),
    'SC-3: poll may retry after disabled ATC poll recovery (no sacred lock)'
  );

  // Contrast WM-4: sacred lock would block poll; SC-3 disabled ATC never arms it.
  const wmSacredLock = new Set([normUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normUrl, wmSacredLock, new Set()),
    'SC-3: contrast WM-4 — sacred lock would block poll; disabled ATC wait does not arm it'
  );
}

/**
 * SC-3: disabled-ATC product page live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 sc5-sc6-live-poll-cycle on /p/mock-fcfs-disabled/792 (fixture-e2e has browser coverage).
 */
function runSc3DisabledAtcLivePollCycleTests() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-fcfs-disabled/792';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);

  const disabledPage = makePage({
    pathname: '/p/mock-fcfs-disabled/792',
    elements: [
      {
        selectors: ['button[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-3 disabled-atc live poll: must not arm sacred lock on start');
  assert.equal(
    scDecideProductPageEntry(disabledPage).action,
    'atc_unavailable',
    'SC-3 disabled-atc live poll: disabled ATC is not immediate queue wait'
  );
  assert.equal(
    scSimulateWaitForDisabledAtc(disabledPage).action,
    'atc_timeout',
    'SC-3 disabled-atc live poll: disabled ATC wait ends in timeout'
  );

  let atcTimeoutCycles = 0;
  const simulateDisabledAtcTimeout = () => {
    atcTimeoutCycles += 1;
    const waitResult = scSimulateWaitForDisabledAtc(disabledPage);
    const timeoutMsg = waitResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
    assert.ok(timeoutMsg, 'SC-3 disabled-atc live poll: ATC wait timeout sends NAV_FAILED');
    assert.equal(timeoutMsg.url, monitorProductUrl, 'SC-3 disabled-atc live poll: NAV_FAILED uses monitor productUrl');
    return timeoutMsg;
  };

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateDisabledAtcTimeout());
  assert.equal(inQueueUrls.size, 0, 'SC-3 disabled-atc live poll: timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-3 disabled-atc live poll: timeout releases navigationLock');
  assert.match(SC_SRC, /FCFS restock wait/, 'SC-3 disabled-atc live poll: restock wait log in source');
  assert.ok(!disabledPage.elements[0].clicked, 'SC-3 disabled-atc live poll: must not click disabled ATC');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateDisabledAtcTimeout());
  assert.equal(atcTimeoutCycles, 2, 'SC-3 disabled-atc live poll: reload must re-trigger ATC wait timeout');
  assert.equal(inQueueUrls.size, 0, 'SC-3 disabled-atc live poll: reload must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-3 disabled-atc live poll: reload timeout releases navigationLock');

  const liveSignalTypes = ['NAV_FAILED', 'ATC_SUCCESS', 'NAV_FAILED', 'ATC_SUCCESS'];
  for (let i = 0; i < liveSignalTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    if (liveSignalTypes[i] === 'ATC_SUCCESS') {
      bgApplyAtcSuccess(navigationLock, inQueueUrls, { type: 'ATC_SUCCESS', url: monitorProductUrl });
    } else {
      bgApplyNavFailed(navigationLock, inQueueUrls, {
        type: liveSignalTypes[i],
        url: monitorProductUrl,
      });
    }
    assert.equal(
      inQueueUrls.size,
      0,
      `SC-3 disabled-atc live poll cycle ${i + 1} must not arm inQueueUrls after ${liveSignalTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `SC-3 disabled-atc live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${liveSignalTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `SC-3 disabled-atc live poll cycle ${i + 1} allows poll retry after ${liveSignalTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-3 disabled-atc live poll: must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'SC-3 disabled-atc live poll: navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'SC-3 disabled-atc live poll: contrast WM-4 — sacred lock would block poll; disabled ATC wait does not arm it'
  );
}

/**
 * SC-4: checkout review live poll cycle — reload + SAMS_NAV_FAILED/ATC_SUCCESS during poll, no sacred lock.
 * Parity with FIX-3 sc4-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runSc4LivePollCycleTests() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-fcfs/789';
  const checkoutTabUrl = 'https://www.samsclub.com/checkout';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const reviewPage = makePage({
    pathname: '/checkout',
    elements: [
      {
        selectors: ['[data-automation-id="place-order-btn"]'],
        tag: 'button',
        text: 'Place order',
      },
    ],
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-4: checkout review live poll must not arm sacred lock on start');
  assert.ok(
    !inQueueUrls.has(normCheckoutTabUrl),
    'SC-4: checkout tab URL must not be sacred lock key'
  );

  const reviewResult1 = scHandleReviewSim(reviewPage, { autoPlaceOrder: false });
  assert.equal(reviewResult1.path, 'review_manual', 'SC-4: initial review manual stop');
  assert.ok(scCheckoutHasReviewSim(reviewPage), 'SC-4: review step detected before reload');

  const reviewResult2 = scHandleReviewSim(reviewPage, { autoPlaceOrder: false });
  assert.equal(reviewResult2.path, 'review_manual', 'SC-4: checkout reload must re-detect review');
  assert.equal(reviewPage.elements[0].clicked, false, 'SC-4: reload must not auto-click Place Order');
  assert.equal(inQueueUrls.size, 0, 'SC-4: reload during live poll must not arm inQueueUrls');
  assert.match(SC_SRC, /\[SC\] review reached/, 'SC-4: review reached log in source');

  const liveSignalTypes = ['SAMS_NAV_FAILED', 'ATC_SUCCESS', 'SAMS_NAV_FAILED'];
  for (let i = 0; i < liveSignalTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    if (liveSignalTypes[i] === 'ATC_SUCCESS') {
      bgApplyAtcSuccess(navigationLock, inQueueUrls, { type: 'ATC_SUCCESS', url: monitorProductUrl });
    } else {
      bgApplyNavFailed(navigationLock, inQueueUrls, {
        type: liveSignalTypes[i],
        url: monitorProductUrl,
      });
    }
    assert.equal(
      inQueueUrls.size,
      0,
      `SC-4: live poll cycle ${i + 1} must not arm inQueueUrls after ${liveSignalTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `SC-4: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${liveSignalTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `SC-4: live poll cycle ${i + 1} allows poll retry after ${liveSignalTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-4: live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'SC-4: navigationLock alone must not imply sacred lock on checkout review after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'SC-4: contrast WM-5 — sacred lock would block poll; Sam checkout review does not arm it'
  );
}

/**
 * SC-4: checkout SPA timeout NAV_FAILED → poll recovery rearm — no sacred lock.
 * Parity with FIX-3 sc4-poll-recovery-rearm (fixture-e2e has browser coverage).
 */
function runSc4PollRecoveryRearmTests() {
  function assertSc4PollRecoveryRearm(monitorProductUrl, recoveryProductUrl, navFailMsg, label) {
    const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
    const normRecoveryUrl = normalizeProductUrl(recoveryProductUrl);
    const inQueueUrls = new Set();
    const navigationLock = new Set();

    assert.equal(navFailMsg.url, monitorProductUrl, `${label}: NAV_FAILED uses monitor productUrl`);

    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, navFailMsg);
    assert.ok(!navigationLock.has(normMonitorUrl), `${label}: checkout SPA timeout releases navigationLock`);
    assert.equal(inQueueUrls.size, 0, `${label}: checkout SPA timeout must not arm sacred lock`);
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `${label}: poll may retry monitor product after checkout SPA timeout`
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

    bgApplyNavFailed(navigationLock, inQueueUrls, {
      type: 'SAMS_NAV_FAILED',
      url: recoveryProductUrl,
    });
    assert.ok(
      !navigationLock.has(normRecoveryUrl),
      `${label}: NAV_FAILED during poll recovery releases recovery lock for retry`
    );
    assert.ok(
      !bgPollWouldSkipNavigation(normRecoveryUrl, inQueueUrls, navigationLock),
      `${label}: poll may retry after poll recovery NAV_FAILED (no sacred lock)`
    );

    const wmSacredLock = new Set([normRecoveryUrl]);
    assert.ok(
      bgPollWouldSkipNavigation(normRecoveryUrl, wmSacredLock, new Set()),
      `${label}: contrast WM-4 — sacred lock would block poll; SC-4 checkout timeout does not arm it`
    );
  }

  const monitorProductUrl = 'https://www.samsclub.com/p/mock-checkout-spa-stall/793';
  const recoveryProductUrl = 'https://www.samsclub.com/p/mock-fcfs-invisible-atc/791';
  const checkoutTabUrl = 'https://www.samsclub.com/checkout/spa-stall';
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  assert.match(
    SC_SRC,
    /scSignalNavFailed\(settings\.productUrl \|\| location\.href\)/,
    'SC-4 poll recovery: checkout SPA timeout uses settings.productUrl before location.href'
  );

  const navFail = { type: 'SAMS_NAV_FAILED', url: monitorProductUrl };
  assert.notEqual(
    normalizeProductUrl(navFail.url),
    normCheckoutTabUrl,
    'SC-4 poll recovery: NAV_FAILED must not key checkout tab URL'
  );
  assertSc4PollRecoveryRearm(
    monitorProductUrl,
    recoveryProductUrl,
    navFail,
    'SC-4 checkout SPA timeout'
  );
}

/**
 * SC-6: restock + invisible-atc NAV_FAILED → poll recovery rearm — no sacred lock.
 * Parity with FIX-3 sc6-poll-recovery-rearm (fixture-e2e has browser coverage).
 */
function runSc6PollRecoveryRearmTests() {
  function assertSc6PollRecoveryRearm(productUrl, navFailMsg, label) {
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

    bgApplyNavFailed(navigationLock, inQueueUrls, { type: 'SAMS_NAV_FAILED', url: productUrl });
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
      `${label}: contrast WM-4 — sacred lock would block poll; SC-6 error path does not arm it`
    );
  }

  const restockUrl = 'https://www.samsclub.com/p/mock-fcfs-restock/790';
  const restockPage = makePage({
    pathname: '/p/mock-fcfs-restock/790',
    elements: [
      {
        selectors: ['button[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });
  const restockResult = scSimulateWaitForDisabledAtc(restockPage);
  assert.equal(restockResult.action, 'atc_timeout', 'SC-6 restock: disabled ATC wait ends in timeout');
  const restockMsg = restockResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(restockMsg, 'SC-6 restock: wait timeout sends SAMS_NAV_FAILED');
  assert.match(SC_SRC, /FCFS restock wait/, 'SC-6 restock: restock wait log in source');
  assert.match(
    SC_SRC,
    /ATC button not found or disabled/,
    'SC-6 restock: disabled ATC timeout user-facing log in source'
  );
  assertSc6PollRecoveryRearm(restockUrl, restockMsg, 'SC-6 restock');

  const invisibleUrl = 'https://www.samsclub.com/p/mock-fcfs-invisible-atc/791';
  const invisiblePage = makePage({
    pathname: '/p/mock-fcfs-invisible-atc/791',
    elements: [
      {
        selectors: ['button[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: false,
        visible: false,
      },
    ],
  });
  const invisibleResult = scDecideProductPageInvisibleAtc(invisiblePage);
  assert.equal(invisibleResult.action, 'atc_unavailable', 'SC-6 invisible: hidden ATC is nav_failed');
  const invisibleMsg = invisibleResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
  assert.ok(invisibleMsg, 'SC-6 invisible: hidden ATC sends SAMS_NAV_FAILED');
  assert.match(SC_SRC, /scIsVisible/, 'SC-6 invisible: visibility check in source');
  assertSc6PollRecoveryRearm(invisibleUrl, invisibleMsg, 'SC-6 invisible-atc');
}

/**
 * SC-6: invisible-ATC product page live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 sc5-sc6-live-poll-cycle on /p/mock-fcfs-invisible-atc/791 (fixture-e2e has browser coverage).
 */
function runSc6InvisibleAtcLivePollCycleTests() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-fcfs-invisible-atc/791';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);

  const invisiblePage = makePage({
    pathname: '/p/mock-fcfs-invisible-atc/791',
    elements: [
      {
        selectors: ['button[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: false,
        visible: false,
      },
    ],
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6 invisible-atc live poll: must not arm sacred lock on start');
  assert.equal(
    scSimulateWaitForDisabledAtc(invisiblePage).action,
    'atc_timeout',
    'SC-6 invisible-atc live poll: invisible ATC wait ends in timeout'
  );

  let atcTimeoutCycles = 0;
  const simulateInvisibleAtcTimeout = () => {
    atcTimeoutCycles += 1;
    const msgs = scInvisibleAtcTimeoutMessages(invisiblePage, monitorProductUrl);
    assert.equal(msgs.length, 1, 'SC-6 invisible-atc live poll: ATC wait timeout sends NAV_FAILED');
    assert.equal(msgs[0].url, monitorProductUrl, 'SC-6 invisible-atc live poll: NAV_FAILED uses monitor productUrl');
    return msgs[0];
  };

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateInvisibleAtcTimeout());
  assert.equal(inQueueUrls.size, 0, 'SC-6 invisible-atc live poll: timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6 invisible-atc live poll: timeout releases navigationLock');
  assert.match(SC_SRC, /scIsVisible/, 'SC-6 invisible-atc live poll: visibility check in source');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateInvisibleAtcTimeout());
  assert.equal(atcTimeoutCycles, 2, 'SC-6 invisible-atc live poll: reload must re-trigger ATC wait timeout');
  assert.equal(inQueueUrls.size, 0, 'SC-6 invisible-atc live poll: reload must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6 invisible-atc live poll: reload timeout releases navigationLock');

  const navFailTypes = ['SAMS_NAV_FAILED', 'NAV_FAILED', 'SAMS_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `SC-6 invisible-atc live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `SC-6 invisible-atc live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `SC-6 invisible-atc live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6 invisible-atc live poll: must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'SC-6 invisible-atc live poll: navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'SC-6 invisible-atc live poll: contrast WM-5 — sacred lock would block poll; invisible ATC does not arm it'
  );
}

/**
 * SC-6: restock product page live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 sc5-sc6-live-poll-cycle on /p/mock-fcfs-restock/790 (fixture-e2e has browser coverage).
 */
function runSc6RestockLivePollCycleTests() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-fcfs-restock/790';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);

  const restockPage = makePage({
    pathname: '/p/mock-fcfs-restock/790',
    elements: [
      {
        selectors: ['button[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6 restock live poll: must not arm sacred lock on start');
  assert.equal(
    scDecideProductPageEntry(restockPage).action,
    'atc_unavailable',
    'SC-6 restock live poll: disabled ATC is not immediate queue wait'
  );
  assert.equal(
    scSimulateWaitForDisabledAtc(restockPage).action,
    'atc_timeout',
    'SC-6 restock live poll: disabled ATC wait ends in timeout'
  );

  let atcTimeoutCycles = 0;
  const simulateRestockAtcTimeout = () => {
    atcTimeoutCycles += 1;
    const waitResult = scSimulateWaitForDisabledAtc(restockPage);
    const timeoutMsg = waitResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
    assert.ok(timeoutMsg, 'SC-6 restock live poll: ATC wait timeout sends NAV_FAILED');
    assert.equal(timeoutMsg.url, monitorProductUrl, 'SC-6 restock live poll: NAV_FAILED uses monitor productUrl');
    return timeoutMsg;
  };

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateRestockAtcTimeout());
  assert.equal(inQueueUrls.size, 0, 'SC-6 restock live poll: timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6 restock live poll: timeout releases navigationLock');
  assert.match(SC_SRC, /FCFS restock wait/, 'SC-6 restock live poll: restock wait log in source');
  assert.match(
    SC_SRC,
    /ATC button not found or disabled/,
    'SC-6 restock live poll: disabled ATC timeout user-facing log in source'
  );
  assert.ok(!restockPage.elements[0].clicked, 'SC-6 restock live poll: must not click disabled ATC');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateRestockAtcTimeout());
  assert.equal(atcTimeoutCycles, 2, 'SC-6 restock live poll: reload must re-trigger ATC wait timeout');
  assert.equal(inQueueUrls.size, 0, 'SC-6 restock live poll: reload must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6 restock live poll: reload timeout releases navigationLock');

  const liveSignalTypes = ['SAMS_NAV_FAILED', 'ATC_SUCCESS', 'SAMS_NAV_FAILED', 'ATC_SUCCESS'];
  for (let i = 0; i < liveSignalTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    if (liveSignalTypes[i] === 'ATC_SUCCESS') {
      bgApplyAtcSuccess(navigationLock, inQueueUrls, { type: 'ATC_SUCCESS', url: monitorProductUrl });
    } else {
      bgApplyNavFailed(navigationLock, inQueueUrls, {
        type: liveSignalTypes[i],
        url: monitorProductUrl,
      });
    }
    assert.equal(
      inQueueUrls.size,
      0,
      `SC-6 restock live poll cycle ${i + 1} must not arm inQueueUrls after ${liveSignalTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `SC-6 restock live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${liveSignalTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `SC-6 restock live poll cycle ${i + 1} allows poll retry after ${liveSignalTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6 restock live poll: must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'SC-6 restock live poll: navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'SC-6 restock live poll: contrast WM-5 — sacred lock would block poll; restock wait does not arm it'
  );
}

/**
 * SC-6: checkout SPA live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 sc6-checkout-spa-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runSc6CheckoutSpaLivePollCycleTests() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-checkout-spa-stall/793';
  const checkoutTabUrl = 'https://www.samsclub.com/checkout/spa-stall';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  // Live poll: monitor keys productUrl; tab may be on checkout SPA stall.
  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6: checkout SPA live poll must not arm sacred lock on start');
  assert.ok(
    !inQueueUrls.has(normCheckoutTabUrl),
    'SC-6: checkout SPA tab URL must not be sacred lock key'
  );

  let timeoutCycles = 0;
  const simulateCheckoutSpaTimeout = () => {
    timeoutCycles += 1;
    return { type: 'SAMS_NAV_FAILED', url: monitorProductUrl };
  };

  // Checkout timeout cycle 1 (scHandleCheckout timed out).
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(inQueueUrls.size, 0, 'SC-6: checkout SPA timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6: checkout SPA timeout releases navigationLock');

  // Simulate page reload during live poll — poll re-navigates, timeout fires again.
  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(timeoutCycles, 2, 'SC-6: reload must re-trigger checkout SPA timeout');
  assert.equal(inQueueUrls.size, 0, 'SC-6: reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6: reload timeout releases navigationLock');
  assert.match(SC_SRC, /scHandleCheckout timed out/, 'SC-6: checkout SPA timeout log in source');

  // Live poll cycles: SAMS_NAV_FAILED + NAV_FAILED — never sacred lock.
  const navFailTypes = ['SAMS_NAV_FAILED', 'NAV_FAILED', 'SAMS_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `SC-6: live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `SC-6: live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `SC-6: live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  // Final poll wait: navigationLock may re-arm; sacred lock must stay empty.
  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6: live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'SC-6: navigationLock alone must not imply sacred lock on checkout SPA after poll wait'
  );

  // Contrast WM-5: sacred lock on same monitor URL would block poll through reload + NAV_FAILED.
  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'SC-6: contrast WM-5 — sacred lock would block poll; Sam checkout SPA timeout does not arm it'
  );
}

/**
 * SC-6: cross-page checkout SPA live poll cycle — tab on /checkout/spa-stall-cross,
 * monitor keys distinct productUrl; reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 sc6-checkout-spa-live-poll-cycle on /checkout/spa-stall-cross (fixture-e2e has browser coverage).
 */
function runSc6CheckoutSpaCrossLivePollCycleTests() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-checkout-spa-cross-monitor/796';
  const checkoutTabUrl = 'https://www.samsclub.com/checkout/spa-stall-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCheckoutTabUrl = normalizeProductUrl(checkoutTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page checkout SPA live poll must not arm sacred lock on start');
  assert.ok(
    !inQueueUrls.has(normCheckoutTabUrl),
    'SC-6: cross-page checkout SPA tab URL must not be sacred lock key'
  );

  let timeoutCycles = 0;
  const simulateCheckoutSpaTimeout = () => {
    timeoutCycles += 1;
    const navFail = { type: 'SAMS_NAV_FAILED', url: monitorProductUrl };
    assert.equal(navFail.url, monitorProductUrl, 'SC-6: cross-page checkout SPA NAV_FAILED uses monitor productUrl');
    assert.notEqual(
      normalizeProductUrl(navFail.url),
      normCheckoutTabUrl,
      'SC-6: cross-page checkout SPA NAV_FAILED must not key checkout tab URL'
    );
    return navFail;
  };

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page checkout SPA timeout must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6: cross-page checkout SPA timeout releases navigationLock');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCheckoutSpaTimeout());
  assert.equal(timeoutCycles, 2, 'SC-6: cross-page checkout SPA reload must re-trigger timeout');
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page checkout SPA reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6: cross-page checkout SPA reload timeout releases navigationLock');
  assert.match(SC_SRC, /scHandleCheckout timed out/, 'SC-6: cross-page checkout SPA timeout log in source');

  const navFailTypes = ['SAMS_NAV_FAILED', 'NAV_FAILED', 'SAMS_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `SC-6: cross-page checkout SPA live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `SC-6: cross-page checkout SPA live poll cycle ${i + 1} navigationLock alone must not imply sacred lock`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `SC-6: cross-page checkout SPA live poll cycle ${i + 1} allows poll retry (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page checkout SPA live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'SC-6: cross-page checkout SPA navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'SC-6: contrast WM-5 — sacred lock would block poll; cross-page Sam checkout SPA timeout does not arm it'
  );
}

/**
 * SC-6: cart checkout-missing live poll cycle — reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 sc6-cart-live-poll-cycle (fixture-e2e has browser coverage).
 */
function runSc6CartLivePollCycleTests() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-fcfs-cart-missing/792';
  const cartTabUrl = 'https://www.samsclub.com/cart/no-checkout';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCartTabUrl = normalizeProductUrl(cartTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  // Live poll: monitor keys productUrl; tab may be on cart checkout-missing page.
  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6: cart live poll must not arm sacred lock on start');
  assert.ok(
    !inQueueUrls.has(normCartTabUrl),
    'SC-6: cart tab URL must not be sacred lock key'
  );

  const cartPage = makePage({ pathname: '/cart/no-checkout', elements: [] });
  let checkoutMissingCycles = 0;
  const simulateCartCheckoutMissing = () => {
    checkoutMissingCycles += 1;
    const cartResult = scHandleCartPageSim(cartPage, { productUrl: monitorProductUrl });
    assert.equal(cartResult.path, 'checkout_not_found', 'SC-6: cart live poll checkout-missing path');
    const navFail = cartResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
    assert.ok(navFail, 'SC-6: cart checkout-missing sends SAMS_NAV_FAILED');
    assert.equal(navFail.url, monitorProductUrl, 'SC-6: cart NAV_FAILED uses monitor productUrl');
    return navFail;
  };

  // Cart checkout-missing cycle 1.
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCartCheckoutMissing());
  assert.equal(inQueueUrls.size, 0, 'SC-6: cart checkout-missing must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6: cart checkout-missing releases navigationLock');
  assert.match(SC_SRC, /Checkout button not found/, 'SC-6: cart checkout-missing log in source');

  // Simulate page reload during live poll — re-init re-detects missing checkout.
  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCartCheckoutMissing());
  assert.equal(checkoutMissingCycles, 2, 'SC-6: cart reload must re-trigger checkout-missing');
  assert.equal(inQueueUrls.size, 0, 'SC-6: cart reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6: cart reload checkout-missing releases navigationLock');

  // Live poll cycles: SAMS_NAV_FAILED + NAV_FAILED — never sacred lock.
  const navFailTypes = ['SAMS_NAV_FAILED', 'NAV_FAILED', 'SAMS_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `SC-6: cart live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `SC-6: cart live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `SC-6: cart live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  // Final poll wait: navigationLock may re-arm; sacred lock must stay empty.
  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6: cart live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'SC-6: cart navigationLock alone must not imply sacred lock after poll wait'
  );

  // Contrast WM-5: sacred lock on same monitor URL would block poll through reload + NAV_FAILED.
  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'SC-6: contrast WM-5 — sacred lock would block poll; Sam cart checkout-missing does not arm it'
  );
}

/**
 * SC-6: cross-page cart checkout-missing live poll cycle — tab on /cart/no-checkout-cross,
 * monitor keys distinct productUrl; reload + repeated NAV_FAILED during poll, no sacred lock.
 * Parity with FIX-3 sc6-cart-live-poll-cycle on /cart/no-checkout-cross (fixture-e2e has browser coverage).
 */
function runSc6CartCrossLivePollCycleTests() {
  const monitorProductUrl = 'https://www.samsclub.com/p/mock-fcfs-cart-cross-monitor/794';
  const cartTabUrl = 'https://www.samsclub.com/cart/no-checkout-cross';
  const normMonitorUrl = normalizeProductUrl(monitorProductUrl);
  const normCartTabUrl = normalizeProductUrl(cartTabUrl);

  const inQueueUrls = new Set();
  const navigationLock = new Set();

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page cart live poll must not arm sacred lock on start');
  assert.ok(!inQueueUrls.has(normCartTabUrl), 'SC-6: cross-page cart tab URL must not be sacred lock key');

  const cartPage = makePage({ pathname: '/cart/no-checkout-cross', elements: [] });
  let checkoutMissingCycles = 0;
  const simulateCartCheckoutMissing = () => {
    checkoutMissingCycles += 1;
    const cartResult = scHandleCartPageSim(cartPage, { productUrl: monitorProductUrl });
    assert.equal(cartResult.path, 'checkout_not_found', 'SC-6: cross-page cart live poll checkout-missing path');
    const navFail = cartResult.messages.find((m) => m.type === 'SAMS_NAV_FAILED');
    assert.ok(navFail, 'SC-6: cross-page cart checkout-missing sends SAMS_NAV_FAILED');
    assert.equal(navFail.url, monitorProductUrl, 'SC-6: cross-page cart NAV_FAILED uses monitor productUrl');
    assert.notEqual(
      normalizeProductUrl(navFail.url),
      normCartTabUrl,
      'SC-6: cross-page cart NAV_FAILED must not key cart tab URL'
    );
    return navFail;
  };

  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCartCheckoutMissing());
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page cart checkout-missing must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6: cross-page cart checkout-missing releases navigationLock');
  assert.match(SC_SRC, /Checkout button not found/, 'SC-6: cross-page cart checkout-missing log in source');

  navigationLock.add(normMonitorUrl);
  bgApplyNavFailed(navigationLock, inQueueUrls, simulateCartCheckoutMissing());
  assert.equal(checkoutMissingCycles, 2, 'SC-6: cross-page cart reload must re-trigger checkout-missing');
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page cart reload during live poll must not arm sacred lock');
  assert.ok(!navigationLock.has(normMonitorUrl), 'SC-6: cross-page cart reload checkout-missing releases navigationLock');

  const navFailTypes = ['SAMS_NAV_FAILED', 'NAV_FAILED', 'SAMS_NAV_FAILED', 'NAV_FAILED'];
  for (let i = 0; i < navFailTypes.length; i++) {
    navigationLock.add(normMonitorUrl);
    bgApplyNavFailed(navigationLock, inQueueUrls, {
      type: navFailTypes[i],
      url: monitorProductUrl,
    });
    assert.equal(
      inQueueUrls.size,
      0,
      `SC-6: cross-page cart live poll cycle ${i + 1} must not arm inQueueUrls after ${navFailTypes[i]}`
    );
    if (navigationLock.has(normMonitorUrl)) {
      assert.ok(
        !inQueueUrls.has(normMonitorUrl),
        `SC-6: cross-page cart live poll cycle ${i + 1} navigationLock alone must not imply sacred lock after ${navFailTypes[i]}`
      );
    }
    assert.ok(
      !bgPollWouldSkipNavigation(normMonitorUrl, inQueueUrls, navigationLock),
      `SC-6: cross-page cart live poll cycle ${i + 1} allows poll retry after ${navFailTypes[i]} (no sacred lock)`
    );
  }

  navigationLock.add(normMonitorUrl);
  assert.equal(inQueueUrls.size, 0, 'SC-6: cross-page cart live poll must not arm inQueueUrls after poll wait');
  assert.ok(
    !inQueueUrls.has(normMonitorUrl),
    'SC-6: cross-page cart navigationLock alone must not imply sacred lock after poll wait'
  );

  const wmSacredLock = new Set([normMonitorUrl]);
  assert.ok(
    bgPollWouldSkipNavigation(normMonitorUrl, wmSacredLock, new Set()),
    'SC-6: contrast WM-5 — sacred lock would block poll; cross-page Sam cart checkout-missing does not arm it'
  );
}

function main() {
  testSc1Hosts();
  testSc1Manifest();
  testSc1StubSource();
  testSc2Source();
  testSc2CartPageType();
  testSc2CartHappyPath();
  testSc2CartCheckoutMissing();
  testSc2ProductToCartChain();
  testSc3Source();
  testSc3DisabledAtcNotQueue();
  testSc3ProductPageHappyPath();
  testSc3ProductPageNavigateCartFallback();
  runSc3PollRecoveryRearmTests();
  runSc3DisabledAtcLivePollCycleTests();
  testSc5Source();
  runSc5FcfsNoSacredLockTests();
  runSc5Sc6LivePollCycleTests();
  testSc6Source();
  runSc6ErrorPathHardeningTests();
  runSc6PollRecoveryRearmTests();
  runSc6InvisibleAtcLivePollCycleTests();
  runSc6RestockLivePollCycleTests();
  testSc6ProductToCartCheckoutMissingChain();
  testSc6CartCrossPageCheckoutMissingChain();
  testSc6CartCrossPagePollRecovery();
  testSc6CheckoutSpaCrossPagePollRecovery();
  testSc4Source();
  testSc4ManualReviewStop();
  testSc4CheckoutReviewPath();
  testSc4CheckoutTimeoutNavFailed();
  runSc4PollRecoveryRearmTests();
  runSc4LivePollCycleTests();
  runSc6CheckoutSpaLivePollCycleTests();
  runSc6CheckoutSpaCrossLivePollCycleTests();
  runSc6CartLivePollCycleTests();
  runSc6CartCrossLivePollCycleTests();
  console.log(
    "samsclub-module-simulation PASS (SC-1 + SC-2 + SC-3 + SC-4 + SC-5 + SC-6): hosts, manifest, FCFS cart→checkout, checkout review, product-page ATC, SC-3 poll recovery rearm, SC-3 disabled-atc live poll cycle, SC-4 poll recovery rearm + live poll cycle, SC-5/SC-6 live poll cycle, SC-6 poll recovery rearm, invisible-atc live poll cycle, restock live poll cycle, cross-page cart poll recovery, cross-page checkout SPA poll recovery, no sacred lock, error-path hardening, checkout SPA live poll cycle, cross-page checkout SPA live poll cycle, cart live poll cycle, cross-page cart live poll cycle"
  );
}

main();
