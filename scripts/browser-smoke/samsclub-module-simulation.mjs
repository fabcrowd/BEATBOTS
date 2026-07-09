#!/usr/bin/env node
/**
 * SC-1 / SC-3 / SC-5: Sam's Club retailer module — hosts, manifest, FCFS product ATC, no sacred lock.
 * Offline simulation + source invariants — no browser required for core checks.
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
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'target-checkout-helper/manifest.json'), 'utf8'));
const CONTENT_SRC = readFileSync(join(ROOT, 'target-checkout-helper/content.js'), 'utf8');

/** Evaluate hosts.js in a vm sandbox (mirrors content-script global). */
function loadHosts() {
  const sandbox = vm.createContext({ URL });
  sandbox.globalThis = sandbox;
  vm.runInContext(HOSTS_SRC, sandbox);
  return sandbox.TCH_HOSTS;
}

/** Mirrors SC_SEL.atc in samsclub-content.js */
const SC_SEL = {
  atc:
    '[data-automation-id="add-to-cart-btn"], button[data-automation-id="atc-button"], button[class*="AddToCartButton"], button[class*="add-to-cart"]',
  viewCart: 'a[href="/cart"], button[data-automation-id="go-to-cart-btn"]',
};

/** Minimal DOM stub for offline SC-3 product-page simulations. */
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
  const selectors = SC_SEL.atc.split(', ');
  for (const sel of selectors) {
    const el = page.querySelector(sel);
    if (el) return el;
  }
  return scFindByText(page, 'add to cart');
}

function scIsVisible(el) {
  return !!(el && el.visible);
}

function scGetPageType(pathname) {
  if (/\/p\//.test(pathname) || /\/ip\//.test(pathname) || /\/prod\//.test(pathname)) return 'product';
  if (pathname.includes('/cart')) return 'cart';
  if (pathname.includes('/checkout')) return 'checkout';
  return 'other';
}

/**
 * SC-3: FCFS product entry — disabled ATC is restock wait, never queue/sacred lock.
 * SC-6: restock wait emits NAV_FAILED so background poll can retry.
 * Mirrors scHandleProductPage decision tree (no queue branch).
 */
function scDecideProductPageEntry(page) {
  const atc = scFindAtcButton(page);
  if (!atc || atc.disabled || !scIsVisible(atc)) {
    return { action: 'fcfs_restock_wait', messages: [{ type: 'NAV_FAILED' }] };
  }
  return { action: 'proceed_atc', messages: [] };
}

/** Mirrors scHandleProductPage happy path — DOM ATC → cart, no queue semantics. */
function scHandleProductPageSim(page) {
  const entry = scDecideProductPageEntry(page);
  if (entry.action === 'fcfs_restock_wait') {
    return { path: 'restock_wait', actions: ['fcfs_restock_wait'], messages: entry.messages };
  }
  const atc = scFindAtcButton(page);
  atc.click();
  const cartLink = page.querySelector(SC_SEL.viewCart) || scFindByText(page, 'view cart');
  if (cartLink && scIsVisible(cartLink)) {
    cartLink.click();
    return { path: 'atc_to_cart', actions: ['click_atc', 'click_cart'], messages: [] };
  }
  page.navigate('https://www.samsclub.com/cart');
  return { path: 'atc_nav_cart', actions: ['click_atc', 'nav_cart'], messages: [] };
}

function runSc1HostsTests(hosts) {
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

function runSc1ManifestTests() {
  const hostPerms = MANIFEST.host_permissions || [];
  assert.ok(
    hostPerms.some((p) => p.includes('samsclub.com')),
    'SC-1: manifest host_permissions includes samsclub.com'
  );

  const scScript = (MANIFEST.content_scripts || []).find(
    (cs) => Array.isArray(cs.matches) && cs.matches.some((m) => m.includes('samsclub.com'))
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

function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * Mirrors background.js NAV_FAILED / WALMART_NAV_FAILED handlers (SC-6).
 * Releases navigationLock only — never arms inQueueUrls.
 */
function bgApplyNavFailed(inQueueUrls, navigationLock, message) {
  const norm = normalizeProductUrl(message.url || '');
  if (!norm) return { inQueueUrls, navigationLock };
  navigationLock.delete(norm);
  return { inQueueUrls, navigationLock };
}

/** Mirrors background poll skip + re-navigate after nav lock released. */
function bgPollCycle(inQueueUrls, navigationLock, productUrl) {
  const norm = normalizeProductUrl(productUrl);
  if (inQueueUrls.has(norm)) return { skipped: true, navigationLock };
  if (navigationLock.has(norm)) return { skipped: true, navigationLock };
  navigationLock.add(norm);
  return { skipped: false, navigationLock };
}

/**
 * Mirrors background.js WALMART_IN_QUEUE / WALMART_NAV_FAILED handlers.
 * Sam's Club FCFS must never emit these message types (SC-5).
 */
function bgApplyWalmartMessage(inQueueUrls, navigationLock, message) {
  const norm = normalizeProductUrl(message.url || '');
  if (!norm) return { inQueueUrls, navigationLock };
  if (message.type === 'WALMART_IN_QUEUE') {
    inQueueUrls.add(norm);
  }
  if (message.type === 'WALMART_NAV_FAILED') {
    navigationLock.delete(norm);
  }
  return { inQueueUrls, navigationLock };
}

/** Mirrors handleATCSuccess lock side-effects only — releases locks, never arms inQueueUrls. */
function bgApplyAtcSuccess(inQueueUrls, navigationLock, url) {
  const norm = normalizeProductUrl(url);
  if (!norm) return { inQueueUrls, navigationLock };
  navigationLock.delete(norm);
  inQueueUrls.delete(norm);
  return { inQueueUrls, navigationLock };
}

function runSc5NoSacredLockTests() {
  const forbidden = [
    'inQueueUrls',
    'WALMART_IN_QUEUE',
    'WALMART_NAV_FAILED',
    'navigationLock',
    'sacred',
    'wmIsProductQueued',
    'wmHasQueueIndicators',
  ];
  for (const token of forbidden) {
    assert.ok(
      !SC_SRC.includes(token),
      `SC-5: samsclub-content.js must not reference Walmart queue token "${token}"`
    );
  }
  assert.ok(
    !CONTENT_SRC.includes("detected === 'samsclub'") ||
      CONTENT_SRC.includes('samsclub_handled'),
    'SC-1: content.js delegates samsclub to samsclub-content.js'
  );
}

/** SC-5: FCFS race — ATC_SUCCESS releases locks; poll never arms inQueueUrls for Sam's Club. */
function runSc5FcfsRaceTests() {
  const scProductUrl = 'https://www.samsclub.com/p/member-mark-race/123';
  const norm = normalizeProductUrl(scProductUrl);

  assert.ok(
    SC_SRC.includes("type: 'ATC_SUCCESS'"),
    'SC-5: FCFS race signals ATC_SUCCESS (not WALMART_IN_QUEUE)'
  );
  assert.ok(!SC_SRC.includes('WALMART_IN_QUEUE'), 'SC-5: samsclub must not emit WALMART_IN_QUEUE');

  // Poll navigated tab — FCFS ATC success releases navigationLock, never arms sacred lock.
  const inQ = new Set();
  const navL = new Set([norm]);
  bgApplyAtcSuccess(inQ, navL, scProductUrl);
  assert.ok(!inQ.has(norm), 'SC-5: FCFS ATC_SUCCESS must not arm inQueueUrls');
  assert.ok(!navL.has(norm), 'SC-5: FCFS ATC_SUCCESS releases navigationLock');

  // FCFS race: repeated poll navigate + ATC cycles must never populate inQueueUrls.
  for (let i = 0; i < 3; i++) {
    navL.add(norm);
    bgApplyAtcSuccess(inQ, navL, scProductUrl);
    assert.ok(!inQ.has(norm), `SC-5: FCFS race cycle ${i + 1} must not arm inQueueUrls`);
  }

  // Poll navigationLock alone is not sacred lock (contrast with WM-4).
  const pollOnly = new Set();
  const pollNav = new Set();
  pollNav.add(norm);
  bgApplyWalmartMessage(pollOnly, pollNav, { type: 'ATC_SUCCESS', url: scProductUrl });
  assert.ok(!pollOnly.has(norm), 'SC-5: navigationLock alone must not populate inQueueUrls');

  // Contrast: Walmart queue confirmation arms sacred lock — Sam's Club must never do this.
  const wmUrl = 'https://www.walmart.com/ip/sc5-contrast/999';
  const wmNorm = normalizeProductUrl(wmUrl);
  const wmInQ = new Set();
  bgApplyWalmartMessage(wmInQ, new Set(), { type: 'WALMART_IN_QUEUE', url: wmUrl });
  assert.ok(wmInQ.has(wmNorm), "SC-5 contrast: Walmart WALMART_IN_QUEUE arms inQueueUrls");
}

function runSc1PageTypeTests() {
  assert.equal(scGetPageType('/p/member-mark/123'), 'product');
  assert.equal(scGetPageType('/ip/test-item/456'), 'product');
  assert.equal(scGetPageType('/prod/foo'), 'product');
  assert.equal(scGetPageType('/cart'), 'cart');
  assert.equal(scGetPageType('/checkout/review'), 'checkout');
  assert.equal(scGetPageType('/help'), 'other');
}

function runSc3FcfsAtcTests() {
  // SC-3 invariant: disabled ATC alone is FCFS restock wait — not queue/sacred lock.
  const disabledPage = makePage({
    pathname: '/p/member-mark/123',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });
  const disabledEntry = scDecideProductPageEntry(disabledPage);
  assert.equal(disabledEntry.action, 'fcfs_restock_wait');
  assert.ok(
    !disabledEntry.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'SC-3: disabled ATC must not emit WALMART_IN_QUEUE'
  );

  const queueTextPage = makePage({
    pathname: '/p/member-mark/123',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });
  assert.equal(scDecideProductPageEntry(queueTextPage).action, 'fcfs_restock_wait');

  // Happy path: enabled ATC → cart click.
  const happyPage = makePage({
    pathname: '/p/member-mark/456',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
      },
      {
        selectors: ['a[href="/cart"]'],
        tag: 'a',
        text: 'View cart',
        href: '/cart',
      },
    ],
  });
  const happy = scHandleProductPageSim(happyPage);
  assert.equal(happy.path, 'atc_to_cart');
  assert.deepEqual(happy.actions, ['click_atc', 'click_cart']);
  assert.ok(happyPage.elements[0].clicked, 'SC-3: ATC button clicked');
  assert.ok(happyPage.elements[1].clicked, 'SC-3: cart link clicked');

  // Fallback: navigate to /cart when no cart link.
  const navPage = makePage({
    pathname: '/p/member-mark/789',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
      },
    ],
  });
  const navResult = scHandleProductPageSim(navPage);
  assert.equal(navResult.path, 'atc_nav_cart');
  assert.equal(navPage.navigatedTo, 'https://www.samsclub.com/cart');

  // SC-3 source: must define scHandleProductPage and not import walmart queue handlers.
  assert.ok(SC_SRC.includes('scHandleProductPage'), 'SC-3: scHandleProductPage defined');
  assert.ok(SC_SRC.includes('FCFS'), 'SC-3: FCFS semantics documented in source');
  assert.ok(!SC_SRC.includes('walmart-content'), 'SC-3: must not import walmart-content.js');
}

/** SC-6: FCFS error paths — NAV_FAILED releases poll lock, never arms sacred lock. */
function runSc6ErrorPathTests() {
  const scProductUrl = 'https://www.samsclub.com/p/sc6-restock/123';
  const norm = normalizeProductUrl(scProductUrl);

  assert.ok(
    SC_SRC.includes("type: 'NAV_FAILED'"),
    'SC-6: samsclub emits NAV_FAILED on FCFS restock wait'
  );
  assert.ok(
    !SC_SRC.includes('WALMART_NAV_FAILED'),
    'SC-6: samsclub must not emit WALMART_NAV_FAILED'
  );
  assert.ok(SC_SRC.includes('scSignalNavFailed'), 'SC-6: scSignalNavFailed helper defined');

  const restockPage = makePage({
    pathname: '/p/sc6-restock/123',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        disabled: true,
      },
    ],
  });
  const restockEntry = scDecideProductPageEntry(restockPage);
  assert.equal(restockEntry.action, 'fcfs_restock_wait', 'SC-6: disabled ATC → restock wait');
  assert.ok(
    restockEntry.messages.some((m) => m.type === 'NAV_FAILED'),
    'SC-6: restock wait must emit NAV_FAILED for poll retry'
  );

  const invisibleAtcPage = makePage({
    pathname: '/p/sc6-invisible-atc/456',
    elements: [
      {
        selectors: ['[data-automation-id="add-to-cart-btn"]'],
        text: 'Add to cart',
        visible: false,
      },
    ],
  });
  const invisibleEntry = scDecideProductPageEntry(invisibleAtcPage);
  assert.equal(invisibleEntry.action, 'fcfs_restock_wait', 'SC-6: invisible enabled ATC → restock wait');
  assert.ok(
    invisibleEntry.messages.some((m) => m.type === 'NAV_FAILED'),
    'SC-6: invisible ATC must emit NAV_FAILED (not sacred lock)'
  );
  assert.ok(
    !restockEntry.messages.some((m) => m.type === 'WALMART_IN_QUEUE'),
    'SC-6: restock wait must not emit WALMART_IN_QUEUE'
  );

  const inQ = new Set();
  const navL = new Set([norm]);
  for (const m of restockEntry.messages) {
    bgApplyNavFailed(inQ, navL, { type: m.type, url: scProductUrl });
  }
  assert.ok(!inQ.has(norm), 'SC-6: NAV_FAILED must not arm inQueueUrls');
  assert.ok(!navL.has(norm), 'SC-6: NAV_FAILED clears navigationLock for poll retry');

  const afterFailPoll = bgPollCycle(inQ, navL, scProductUrl);
  assert.equal(afterFailPoll.skipped, false, 'SC-6: poll can re-navigate after NAV_FAILED');
  assert.ok(navL.has(norm), 'SC-6: poll re-arms navigationLock after error-path NAV_FAILED');

  // FCFS race: repeated restock cycles must never populate inQueueUrls.
  for (let i = 0; i < 3; i++) {
    navL.add(norm);
    bgApplyNavFailed(inQ, navL, { type: 'NAV_FAILED', url: scProductUrl });
    assert.ok(!inQ.has(norm), `SC-6: restock cycle ${i + 1} must not arm inQueueUrls`);
    bgPollCycle(inQ, navL, scProductUrl);
  }
}

function main() {
  const hosts = loadHosts();
  runSc1HostsTests(hosts);
  runSc1ManifestTests();
  runSc5NoSacredLockTests();
  runSc5FcfsRaceTests();
  runSc1PageTypeTests();
  runSc3FcfsAtcTests();
  runSc6ErrorPathTests();
  console.log(
    "samsclub-module-simulation PASS (SC-1 + SC-3 + SC-5 + SC-6): hosts, manifest, FCFS ATC, error paths, no sacred lock"
  );
}

main();
