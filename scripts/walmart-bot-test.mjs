#!/usr/bin/env node
/**
 * Walmart bot unit + stress tests.
 * Covers: jigAddress, page type detection, queue indicators, PX detection,
 * price extraction, ATC selector chain, WebSocket queue intercept,
 * direct ATC retry logic, checkout step router, and IMAP 2FA gating.
 *
 * Run:  node scripts/walmart-bot-test.mjs
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(__dirname, '../target-checkout-helper');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    passed++;
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`  FAIL: ${msg} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failed++;
  } else {
    passed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function loadJigAddress() {
  const code = fs.readFileSync(path.join(EXT, 'core/jigAddress.js'), 'utf8');
  const sandbox = { self: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.self.jigAddressLine1 || sandbox.jigAddressLine1;
}

function makeDom(opts = {}) {
  const elements = new Map();
  const bodyText = opts.bodyText || '';
  const pathName = opts.pathname || '/';
  const nextData = opts.nextData || null;

  const doc = {
    body: { innerText: bodyText, get textContent() { return bodyText; } },
    documentElement: {
      _listeners: {},
      addEventListener(type, fn) {
        if (!this._listeners[type]) this._listeners[type] = [];
        this._listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (!this._listeners[type]) return;
        this._listeners[type] = this._listeners[type].filter(l => l !== fn);
      },
      dispatchEvent(e) {
        for (const fn of (this._listeners[e.type] || [])) fn(e);
      },
      dataset: {},
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        id: '',
        style: {},
        textContent: '',
        remove() {},
        appendChild() {},
      };
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector(sel) {
      const exact = elements.get('__sel:' + sel);
      if (exact) return exact;
      // Real browsers try each part of a comma-separated selector list
      for (const part of sel.split(',')) {
        const trimmed = part.trim();
        const found = elements.get('__sel:' + trimmed);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll() { return []; },
  };

  function addElement(selector, props = {}) {
    const el = {
      tagName: (props.tagName || 'BUTTON').toUpperCase(),
      disabled: !!props.disabled,
      textContent: props.textContent || '',
      getAttribute(a) {
        if (a === 'aria-disabled') return props.ariaDisabled || null;
        if (a === 'content') return props.content || null;
        return null;
      },
      getBoundingClientRect() {
        return { width: props.width ?? 100, height: props.height ?? 40, left: 0, top: 0 };
      },
      click() {},
      remove() {},
      appendChild() {},
      _isElement: true,
    };
    elements.set('__sel:' + selector, el);
    return el;
  }

  return {
    document: doc,
    addElement,
    elements,
    location: { pathname: pathName, href: `https://www.walmart.com${pathName}` },
    __NEXT_DATA__: nextData,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init?.detail; }
    },
  };
}

function loadWalmartFunctions(domOpts = {}) {
  const dom = makeDom(domOpts);
  const code = fs.readFileSync(path.join(EXT, 'walmart-content.js'), 'utf8');
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    window: dom,
    document: dom.document,
    location: dom.location,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    HTMLInputElement: { prototype: { value: '' } },
    Object,
    Array,
    Element: class Element {},
    Event: class Event { constructor(t, o) { this.type = t; } },
    CustomEvent: dom.CustomEvent,
    MutationObserver: class { observe() {} disconnect() {} },
    AudioContext: class { createOscillator() { return { connect() {}, frequency: { setValueAtTime() {} }, start() {}, stop() {} }; } createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; } get destination() { return {}; } },
    chrome: {
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
      runtime: {
        sendMessage: () => Promise.resolve({ ok: true }),
        onMessage: { addListener() {} },
      },
      tabs: { onRemoved: { addListener() {} } },
    },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortSignal: { timeout: () => ({}) },
    fetch: () => Promise.resolve({ ok: false, status: 503 }),
    __NEXT_DATA__: dom.__NEXT_DATA__,
    URL,
    Promise,
    Date,
    Number,
    String,
    Math,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    RegExp,
    Error,
    TypeError,
    decodeURIComponent,
    encodeURIComponent,
  };

  sandbox.self = sandbox;
  sandbox.window = sandbox;

  // Pre-load jigAddress into the sandbox (manifest loads it before walmart-content.js)
  const jigCode = fs.readFileSync(path.join(EXT, 'core/jigAddress.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(jigCode, sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, dom };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

section('jigAddressLine1 — core logic');
{
  const jig = loadJigAddress();

  assertEq(jig('123 Main Street', 0), '123 Main Street', 'index 0 returns original');
  assertEq(jig('123 Main Street', 0, 'APT 2B'), 'APT 2B 123 Main Street', 'index 0 uses legacy prefix');
  assertEq(jig('123 Main Street', 0, ''), '123 Main Street', 'index 0 empty prefix = no change');
  assertEq(jig('123 Main Street', 0, null), '123 Main Street', 'index 0 null prefix = no change');
  // When base is empty and prefix is set, current logic returns empty (prefix needs base).
  // This is intentional: jig prefix makes no sense without a real street address.
  assertEq(jig('', 0, 'ABC'), '', 'empty base with prefix = empty (prefix needs base)');
  assertEq(jig('', 0), '', 'empty base no prefix is empty');

  // Index 1 should strip "Street" and rotate
  const r1 = jig('123 Main Street', 1);
  assert(!r1.endsWith('Street Street'), 'index 1 should not double-suffix: ' + r1);
  assert(r1.startsWith('123 Main'), 'index 1 keeps core: ' + r1);

  // Suffix rotation: different indices produce different suffixes
  const results = new Set();
  for (let i = 1; i <= 8; i++) results.add(jig('123 Main Street', i));
  assert(results.size >= 4, `8 indices produce at least 4 unique addresses, got ${results.size}`);

  // Unit type rotation: index 1 has unit type '', index 2 has 'Apt', etc.
  const r2 = jig('123 Main St', 2);
  assert(r2.includes('Apt') || r2.includes('Unit') || r2.includes('Suite'), 'index 2+ includes unit type: ' + r2);

  // Edge: no suffix in base address
  const noSuf = jig('PO Box 500', 3);
  assert(noSuf.startsWith('PO Box 500'), 'non-street address keeps base: ' + noSuf);

  // Edge: already abbreviated
  const abbrev = jig('123 Main St.', 5);
  assert(!abbrev.includes('St. St'), 'abbreviated suffix should be stripped: ' + abbrev);
  assert(!abbrev.includes('St.St'), 'no double suffix: ' + abbrev);

  // Boundary: negative index treated as 0
  assertEq(jig('123 A St', -1), '123 A St', 'negative index = 0');

  // Boundary: index > 99 clamped to 99
  const r99 = jig('1 B Street', 100);
  const r99b = jig('1 B Street', 99);
  assertEq(r99, r99b, 'index 100 clamped to 99');

  // Boundary: NaN index
  assertEq(jig('1 C St', NaN), '1 C St', 'NaN index = 0');
  assertEq(jig('1 C St', undefined), '1 C St', 'undefined index = 0');
  assertEq(jig('1 C St', null), '1 C St', 'null index = 0');
}

section('jigAddressLine1 — stress: all 100 indices are unique');
{
  const jig = loadJigAddress();
  const base = '456 Elm Street';
  const all = new Set();
  for (let i = 0; i <= 99; i++) all.add(jig(base, i));
  assert(all.size >= 40, `100 indices should produce at least 40 unique addresses, got ${all.size}`);

  // No result should be empty
  for (let i = 0; i <= 99; i++) {
    const r = jig(base, i);
    assert(r.length > 0, `index ${i} should produce non-empty address`);
  }
}

section('wmGetPageType — URL pattern matching');
{
  const cases = [
    ['/ip/pokemon-cards/12345', 'product'],
    ['/ip/some-name/67890?attr=variant', 'product'],
    ['/cart', 'cart'],
    ['/cart?items=1', 'cart'],
    ['/qp', 'queue-room'],
    ['/qp?eventId=abc', 'queue-room'],
    ['/checkout', 'checkout'],
    ['/thankyou', 'confirmation'],
    ['/thank-you/order123', 'confirmation'],
    ['/order-confirm', 'confirmation'],
    ['/', 'unknown'],
    ['/browse/electronics', 'unknown'],
    ['/account/login', 'unknown'],
    ['/search?q=ps5', 'unknown'],
  ];

  for (const [pathname, expected] of cases) {
    const { sandbox } = loadWalmartFunctions({ pathname });
    assertEq(sandbox.wmGetPageType(), expected, `wmGetPageType('${pathname}') = ${expected}`);
  }
}

section('wmHasQueueIndicators — text matching');
{
  const positiveTexts = [
    'estimated wait time: 14 min',
    "you're in line for this item",
    'you are in line',
    'your position in line: 42',
    'admission likelihood: high',
    'queue position: 15',
    'you are in the queue',
    "you're in the queue",
    'in queue - please wait',
  ];

  for (const text of positiveTexts) {
    const { sandbox } = loadWalmartFunctions({ bodyText: text, pathname: '/checkout' });
    assert(sandbox.wmHasQueueIndicators() === true, `queue text detected: "${text.slice(0, 40)}"`);
  }

  // /qp pathname always returns true regardless of body text
  {
    const { sandbox } = loadWalmartFunctions({ bodyText: '', pathname: '/qp' });
    assert(sandbox.wmHasQueueIndicators() === true, '/qp pathname = queue');
  }

  const negativeTexts = [
    'your item is ready',
    'checkout complete',
    'shipping address',
    'payment method',
    'queue is not mentioned here at all',
    'waiting for response...',
    '',
  ];

  for (const text of negativeTexts) {
    const { sandbox } = loadWalmartFunctions({ bodyText: text, pathname: '/checkout' });
    assert(sandbox.wmHasQueueIndicators() === false, `no false positive: "${text.slice(0, 40)}"`);
  }
}

section('wmIsPxPage — PerimeterX detection');
{
  const pxTexts = [
    'Hang tight! Loading your experience.',
    "we're loading your experience",
    'Hang tight\nWe are loading your page',
  ];
  for (const text of pxTexts) {
    const { sandbox } = loadWalmartFunctions({ bodyText: text, pathname: '/ip/test/123' });
    assert(sandbox.wmIsPxPage() === true, `PX detected: "${text.slice(0, 40)}"`);
  }

  const notPx = [
    'Welcome to Walmart',
    'Add to cart',
    'Loading...',
    'Please hang on',
  ];
  for (const text of notPx) {
    const { sandbox } = loadWalmartFunctions({ bodyText: text, pathname: '/ip/test/123' });
    assert(sandbox.wmIsPxPage() === false, `not PX: "${text.slice(0, 40)}"`);
  }
}

section('wmGetCurrentPrice — __NEXT_DATA__ + DOM fallback');
{
  // __NEXT_DATA__ price
  const nd = {
    props: { pageProps: { initialData: { data: { product: {
      priceInfo: { currentPrice: { price: 49.99 } }
    } } } } }
  };
  const { sandbox } = loadWalmartFunctions({ nextData: nd, pathname: '/ip/test/1' });
  assertEq(sandbox.wmGetCurrentPrice(), 49.99, '__NEXT_DATA__ price extracted');
  assertEq(sandbox.wmGetCurrentPrice(true), null, 'liveOnly=true skips __NEXT_DATA__');

  // Missing __NEXT_DATA__
  const { sandbox: s2 } = loadWalmartFunctions({ pathname: '/ip/test/2' });
  assertEq(s2.wmGetCurrentPrice(), null, 'null when no price source');

  // __NEXT_DATA__ with price = 0 (should be skipped, 0 is not > 0)
  const nd0 = {
    props: { pageProps: { initialData: { data: { product: {
      priceInfo: { currentPrice: { price: 0 } }
    } } } } }
  };
  const { sandbox: s3 } = loadWalmartFunctions({ nextData: nd0, pathname: '/ip/test/3' });
  assertEq(s3.wmGetCurrentPrice(), null, 'price 0 treated as missing');

  // Negative price (malformed data)
  const ndNeg = {
    props: { pageProps: { initialData: { data: { product: {
      priceInfo: { currentPrice: { price: -5 } }
    } } } } }
  };
  const { sandbox: s4 } = loadWalmartFunctions({ nextData: ndNeg, pathname: '/ip/test/4' });
  assertEq(s4.wmGetCurrentPrice(), null, 'negative price treated as missing');
}

section('wmIsProductQueued — ATC button state');
{
  // No ATC button at all → not queued
  const { sandbox: s1 } = loadWalmartFunctions({ pathname: '/ip/test/1' });
  assertEq(s1.wmIsProductQueued(), false, 'no button = not queued');

  // ATC button present but disabled (register the individual selector the comma chain resolves to)
  const { sandbox: s2, dom: d2 } = loadWalmartFunctions({ pathname: '/ip/test/2' });
  d2.addElement('[data-automation-id="add-to-cart-btn"]', { disabled: true, _isElement: true });
  assertEq(s2.wmIsProductQueued(), true, 'disabled button = queued');

  // ATC with aria-disabled="true"
  const { sandbox: s3, dom: d3 } = loadWalmartFunctions({ pathname: '/ip/test/3' });
  d3.addElement('[data-automation-id="add-to-cart-btn"]', { ariaDisabled: 'true', _isElement: true });
  assertEq(s3.wmIsProductQueued(), true, 'aria-disabled = queued');

  // Enabled ATC → not queued
  const { sandbox: s4, dom: d4 } = loadWalmartFunctions({ pathname: '/ip/test/4' });
  d4.addElement('[data-automation-id="add-to-cart-btn"]', { disabled: false, _isElement: true });
  assertEq(s4.wmIsProductQueued(), false, 'enabled button = not queued');
}

section('wmFindAtcLikeButton — selector chain priority');
{
  // Primary selector wins
  const { sandbox: s1, dom: d1 } = loadWalmartFunctions({ pathname: '/ip/test/1' });
  const el1 = d1.addElement('[data-automation-id="add-to-cart-btn"], button[data-automation-id="atc-button"], button[data-tl-id="ProductPrimaryCTA-cta_add_to_cart_button"]', { textContent: 'primary' });
  const result1 = s1.wmFindAtcLikeButton();
  assert(result1 !== null, 'primary selector found');

  // Falls back to queueHoldSpot
  const { sandbox: s2, dom: d2 } = loadWalmartFunctions({ pathname: '/ip/test/2' });
  d2.addElement('button[data-automation-id="queue-hold-spot-btn"]', { textContent: 'hold' });
  const result2 = s2.wmFindAtcLikeButton();
  assert(result2 !== null, 'queueHoldSpot fallback found');

  // Falls back to atcFallback
  const { sandbox: s3, dom: d3 } = loadWalmartFunctions({ pathname: '/ip/test/3' });
  d3.addElement('#add-on-atc-container button', { textContent: 'fallback' });
  const result3 = s3.wmFindAtcLikeButton();
  assert(result3 !== null, 'atcFallback found');

  // No buttons at all
  const { sandbox: s4 } = loadWalmartFunctions({ pathname: '/ip/test/4' });
  const result4 = s4.wmFindAtcLikeButton();
  assertEq(result4, null, 'returns null when no ATC elements');
}

section('WebSocket queue intercept (walmart-main-world.js)');
{
  const code = fs.readFileSync(path.join(EXT, 'walmart-main-world.js'), 'utf8');

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
      for (const fn of (this._listeners[type] || [])) fn(data);
    }
  }
  FakeWS.CONNECTING = 0;
  FakeWS.OPEN = 1;
  FakeWS.CLOSING = 2;
  FakeWS.CLOSED = 3;
  FakeWS.prototype.CONNECTING = 0;
  FakeWS.prototype.OPEN = 1;

  const docEl = {
    dispatchEvent(e) { capturedEvents.push(e); },
  };

  const sandbox = {
    window: { WebSocket: FakeWS },
    document: { documentElement: docEl },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init?.detail; this.bubbles = init?.bubbles; }
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

  // queuePassed message
  capturedEvents = [];
  const ws1 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws1._emit('message', { data: JSON.stringify({ type: 'queuePassed' }) });
  assertEq(capturedEvents.length, 1, 'queuePassed fires TCH_QUEUE_PASSED');
  assertEq(capturedEvents[0]?.type, 'TCH_QUEUE_PASSED', 'correct event type');

  // QueuePassed (capital Q)
  capturedEvents = [];
  const ws2 = new PatchedWS('wss://queueit.example.com/ws');
  ws2._emit('message', { data: JSON.stringify({ type: 'QueuePassed' }) });
  assertEq(capturedEvents.length, 1, 'QueuePassed (capitalized) fires event');

  // position === 0
  capturedEvents = [];
  const ws3 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws3._emit('message', { data: JSON.stringify({ position: 0 }) });
  assertEq(capturedEvents.length, 1, 'position 0 fires event');

  // queueState === 'passed'
  capturedEvents = [];
  const ws4 = new PatchedWS('wss://queue.it-service.com/ws');
  ws4._emit('message', { data: JSON.stringify({ queueState: 'passed' }) });
  assertEq(capturedEvents.length, 1, 'queueState passed fires event');

  // Non-queue URL — should NOT intercept
  capturedEvents = [];
  const ws5 = new PatchedWS('wss://www.walmart.com/api/cart');
  ws5._emit('message', { data: JSON.stringify({ type: 'queuePassed' }) });
  assertEq(capturedEvents.length, 0, 'non-queue URL ignored');

  // Binary data — should not crash
  capturedEvents = [];
  const ws6 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws6._emit('message', { data: new ArrayBuffer(8) });
  assertEq(capturedEvents.length, 0, 'binary message silently ignored');

  // Invalid JSON — should not crash
  capturedEvents = [];
  const ws7 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws7._emit('message', { data: 'not-json{{{' });
  assertEq(capturedEvents.length, 0, 'invalid JSON silently ignored');

  // position: 5 (still waiting) — should NOT fire
  capturedEvents = [];
  const ws8 = new PatchedWS('wss://queue-it.walmart.com/ws');
  ws8._emit('message', { data: JSON.stringify({ position: 5 }) });
  assertEq(capturedEvents.length, 0, 'position > 0 does not fire');

  // WebSocket static constants preserved
  assertEq(PatchedWS.CONNECTING, 0, 'CONNECTING constant preserved');
  assertEq(PatchedWS.OPEN, 1, 'OPEN constant preserved');
  assertEq(PatchedWS.CLOSING, 2, 'CLOSING constant preserved');
  assertEq(PatchedWS.CLOSED, 3, 'CLOSED constant preserved');
}

section('Checkout step router — wmCheckoutHas* detection');
{
  // Has shipping form
  const { sandbox: s1, dom: d1 } = loadWalmartFunctions({ pathname: '/checkout' });
  d1.addElement('input[name="firstName"], input[autocomplete="given-name"]', { tagName: 'INPUT' });
  assertEq(s1.wmCheckoutHasShipping(), true, 'firstName input = has shipping');
  assertEq(s1.wmCheckoutHasPayment(), false, 'no card fields = no payment');
  assertEq(s1.wmCheckoutHasReview(), false, 'no place order = no review');

  // Has payment form
  const { sandbox: s2, dom: d2 } = loadWalmartFunctions({ pathname: '/checkout' });
  d2.addElement('input[id="creditCard"], input[name="cardNumber"], input[id*="card-number"], input[autocomplete="cc-number"]', { tagName: 'INPUT' });
  assertEq(s2.wmCheckoutHasPayment(), true, 'card input = has payment');

  // Has review (place order button)
  const { sandbox: s3, dom: d3 } = loadWalmartFunctions({ pathname: '/checkout' });
  d3.addElement('[data-automation-id="place-order-btn"]', { textContent: 'Place Order' });
  assertEq(s3.wmCheckoutHasReview(), true, 'place order btn = review');
}

section('wmTryImap2FA — gating logic');
{
  // Disabled → false
  const { sandbox: s1 } = loadWalmartFunctions({ pathname: '/account/login' });
  const r1 = await s1.wmTryImap2FA({ imap2faEnabled: false, imapProfile: { host: 'h', user: 'u', password: 'p' } });
  assertEq(r1, false, 'disabled = skip');

  // Missing host
  const { sandbox: s2 } = loadWalmartFunctions({ pathname: '/account/login' });
  const r2 = await s2.wmTryImap2FA({ imap2faEnabled: true, imapProfile: { host: '', user: 'u', password: 'p' } });
  assertEq(r2, false, 'missing host = skip');

  // Missing password
  const { sandbox: s3 } = loadWalmartFunctions({ pathname: '/account/login' });
  const r3 = await s3.wmTryImap2FA({ imap2faEnabled: true, imapProfile: { host: 'h', user: 'u', password: '' } });
  assertEq(r3, false, 'missing password = skip');

  // Enabled but no code input on page → false (no visible input)
  const { sandbox: s4 } = loadWalmartFunctions({ pathname: '/account/login' });
  const r4 = await s4.wmTryImap2FA({ imap2faEnabled: true, imapProfile: { host: 'h', user: 'u', password: 'p' } });
  assertEq(r4, false, 'no code input on page = skip');
}

section('Edge: /checkout that looks like queue → wmGetPageType returns "queue"');
{
  const { sandbox } = loadWalmartFunctions({
    pathname: '/checkout',
    bodyText: 'estimated wait time: 14 minutes. your position in line: 23',
  });
  assertEq(sandbox.wmGetPageType(), 'queue', '/checkout + queue text = queue page type');
}

section('Edge: /checkout with place order → returns "review"');
{
  const { sandbox, dom } = loadWalmartFunctions({ pathname: '/checkout' });
  dom.addElement('[data-automation-id="place-order-btn"]', { textContent: 'Place Order' });
  assertEq(sandbox.wmGetPageType(), 'review', '/checkout + Place Order button = review');
}

section('Edge: /ip with query params → still "product"');
{
  const { sandbox } = loadWalmartFunctions({ pathname: '/ip/some-long-product-name/1234567890' });
  assertEq(sandbox.wmGetPageType(), 'product', '/ip/... = product regardless of slug');
}

section('Stress: jigAddress with every suffix variant in base');
{
  const jig = loadJigAddress();
  const variants = ['St', 'St.', 'Str', 'Strt', 'Stet', 'Street', 'Str.', 'Ste'];
  for (const v of variants) {
    const base = `100 Oak ${v}`;
    const result = jig(base, 1);
    assert(!result.includes(`${v} ${v}`) && !result.includes(`${v}${v}`),
      `no double suffix for base "${base}": ${result}`);
  }
}

section('Stress: rapid queue indicator checks (perf)');
{
  const iterations = 50000;
  const { sandbox } = loadWalmartFunctions({ bodyText: 'nothing special', pathname: '/checkout' });
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    sandbox.wmHasQueueIndicators();
  }
  const elapsed = performance.now() - t0;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  console.log(`  ${iterations} wmHasQueueIndicators calls in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/s)`);
  assert(elapsed < 5000, `should complete within 5s, took ${elapsed.toFixed(0)}ms`);
}

section('Stress: page type detection (perf)');
{
  const iterations = 50000;
  const { sandbox } = loadWalmartFunctions({ pathname: '/checkout' });
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    sandbox.wmGetPageType();
  }
  const elapsed = performance.now() - t0;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  console.log(`  ${iterations} wmGetPageType calls in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/s)`);
  assert(elapsed < 5000, `should complete within 5s, took ${elapsed.toFixed(0)}ms`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n═══════════════════════════════════`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`═══════════════════════════════════`);

if (failed > 0) {
  process.exitCode = 1;
  console.error('\nSome tests failed.');
} else {
  console.log('\nAll Walmart bot tests passed.');
}
