#!/usr/bin/env node
/**
 * SC-1 / SC-3 / SC-5 / SC-6: Sam's Club retailer module — hosts, manifest, FCFS product ATC.
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
  testSc5Source();
  runSc5FcfsNoSacredLockTests();
  testSc6Source();
  runSc6ErrorPathHardeningTests();
  console.log(
    "samsclub-module-simulation PASS (SC-1 + SC-2 + SC-3 + SC-5 + SC-6): hosts, manifest, FCFS cart→checkout, product-page ATC, no sacred lock, error-path hardening"
  );
}

main();
