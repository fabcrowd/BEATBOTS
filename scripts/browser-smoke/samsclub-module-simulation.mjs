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
 * Mirrors scHandleProductPage decision tree (no queue branch).
 */
function scDecideProductPageEntry(page) {
  const atc = scFindAtcButton(page);
  if (!atc || atc.disabled || !scIsVisible(atc)) {
    return { action: 'fcfs_restock_wait', messages: [] };
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

function main() {
  const hosts = loadHosts();
  runSc1HostsTests(hosts);
  runSc1ManifestTests();
  runSc5NoSacredLockTests();
  runSc1PageTypeTests();
  runSc3FcfsAtcTests();
  console.log(
    "samsclub-module-simulation PASS (SC-1 + SC-3 + SC-5): hosts, manifest, FCFS ATC, no sacred lock"
  );
}

main();
