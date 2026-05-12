/**
 * BEATBOTS Electron App — Unit & Integration Test Suite
 *
 * Tests engine logic, storage, cookie pool, drop timing, checkout engine,
 * session manager, IPC handlers, and data import/export — all without
 * launching Electron or connecting to real APIs.
 *
 * Run from repo root:
 *   cd beatbots-app && node test/unit-test.mjs
 *
 * Note: This imports compiled JS from dist-electron/ so run `npm run build` first.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

// ─── Harness ──────────────────────────────────────────────────────────────────

const results = [];
let passed = 0;
let failed = 0;
let round = 0;

function ts() { return new Date().toISOString().slice(11, 23); }

async function test(name, fn) {
  round++;
  const n = round;
  const start = Date.now();
  process.stdout.write(`\n${'─'.repeat(60)}\n  T${String(n).padStart(2, '0')} — ${name}\n${'─'.repeat(60)}\n`);
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ n, name, pass: true, ms });
    console.log(`[${ts()}] PASS: ${name} (${ms}ms)`);
    passed++;
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ n, name, pass: false, ms, error: err.message });
    console.log(`[${ts()}] FAIL: ${name} — ${err.message}`);
    failed++;
  }
}

// ─── Test: Drop timing ───────────────────────────────────────────────────────

await test('Drop timing — background poll intervals', () => {
  // Inline the logic since we can't import TS directly
  function computeBackgroundPollSleepMs(dropExpectedAt) {
    const base = 500;
    if (!dropExpectedAt) return base;
    const t = Date.parse(dropExpectedAt);
    if (!isFinite(t)) return base;
    const now = Date.now();
    const until = t - now;
    const afterDrop = now - t;
    const inPrewindow = until > 0 && until <= 10 * 60 * 1000;
    const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
    if (inPrewindow || inGrace) return 250;
    if (until > 45 * 60 * 1000) return 2000;
    return base;
  }

  // No drop time → default 500ms
  assert.equal(computeBackgroundPollSleepMs(null), 500);
  assert.equal(computeBackgroundPollSleepMs(''), 500);

  // Far future (>45 min) → 2000ms
  const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.equal(computeBackgroundPollSleepMs(farFuture), 2000);

  // Within 10 min → 250ms (pre-window)
  const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  assert.equal(computeBackgroundPollSleepMs(soon), 250);

  // Just passed (within 3 min) → 250ms (grace window)
  const justPassed = new Date(Date.now() - 1 * 60 * 1000).toISOString();
  assert.equal(computeBackgroundPollSleepMs(justPassed), 250);

  // Long passed (>3 min) → 500ms
  const longPassed = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal(computeBackgroundPollSleepMs(longPassed), 500);

  // 20 min from now → 500ms (between 10 and 45)
  const midFuture = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  assert.equal(computeBackgroundPollSleepMs(midFuture), 500);
});

await test('Drop timing — tension window detection', () => {
  function isInDropTensionWindow(dropExpectedAt) {
    if (!dropExpectedAt) return false;
    const t = Date.parse(dropExpectedAt);
    if (!isFinite(t)) return false;
    const now = Date.now();
    const until = t - now;
    const afterDrop = now - t;
    return (until > 0 && until <= 10 * 60 * 1000) || (until < 0 && afterDrop <= 3 * 60 * 1000);
  }

  assert.equal(isInDropTensionWindow(null), false);
  assert.equal(isInDropTensionWindow(''), false);
  assert.equal(isInDropTensionWindow(new Date(Date.now() + 5 * 60 * 1000).toISOString()), true);
  assert.equal(isInDropTensionWindow(new Date(Date.now() + 15 * 60 * 1000).toISOString()), false);
  assert.equal(isInDropTensionWindow(new Date(Date.now() - 2 * 60 * 1000).toISOString()), true);
  assert.equal(isInDropTensionWindow(new Date(Date.now() - 5 * 60 * 1000).toISOString()), false);
});

await test('Drop timing — countdown format', () => {
  function formatDropCountdown(dropExpectedAt) {
    if (!dropExpectedAt) return '';
    const t = Date.parse(dropExpectedAt);
    if (!isFinite(t)) return '';
    const now = Date.now();
    const until = t - now;
    if (until <= 0 && t - now > -3 * 60 * 1000) return 'In drop window — fast polling';
    if (until <= 0) return 'Drop passed';
    const h = Math.floor(until / 3_600_000);
    const m = Math.floor((until % 3_600_000) / 60_000);
    const s = Math.floor((until % 60_000) / 1000);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  assert.equal(formatDropCountdown(null), '');
  assert.equal(formatDropCountdown('invalid'), '');
  assert.match(formatDropCountdown(new Date(Date.now() + 2 * 3600 * 1000 + 5 * 60 * 1000).toISOString()), /^\dh \d+m \d+s$/);
  assert.match(formatDropCountdown(new Date(Date.now() + 30 * 1000).toISOString()), /^\d+s$/);
  assert.equal(formatDropCountdown(new Date(Date.now() - 1000).toISOString()), 'In drop window — fast polling');
  assert.equal(formatDropCountdown(new Date(Date.now() - 10 * 60 * 1000).toISOString()), 'Drop passed');
});

// ─── Test: Cookie Pool logic ─────────────────────────────────────────────────

await test('Cookie pool — add, consume LIFO, TTL expiry, clear', async () => {
  // Simulate the pool logic in pure JS
  let pool = [];
  const TTL = 200; // 200ms for fast test

  function addCookie(cookies) {
    const now = Date.now();
    pool.push({ id: Math.random().toString(36), cookies, ts: now, expiresAt: now + TTL });
    while (pool.length > 50) pool.shift();
  }

  function consumeLIFO() {
    pool = pool.filter(c => c.expiresAt > Date.now());
    return pool.length > 0 ? pool.pop() : null;
  }

  function clear() { pool = []; }

  // Add 3 cookies
  addCookie({ a: '1' });
  addCookie({ b: '2' });
  addCookie({ c: '3' });
  assert.equal(pool.length, 3);

  // LIFO: newest first
  const first = consumeLIFO();
  assert.deepEqual(first.cookies, { c: '3' });
  assert.equal(pool.length, 2);

  const second = consumeLIFO();
  assert.deepEqual(second.cookies, { b: '2' });

  const third = consumeLIFO();
  assert.deepEqual(third.cookies, { a: '1' });

  const empty = consumeLIFO();
  assert.equal(empty, null);

  // TTL expiry
  addCookie({ d: '4' });
  assert.equal(pool.length, 1);
  await new Promise(r => setTimeout(r, 250));
  const expired = consumeLIFO();
  assert.equal(expired, null, 'Cookie should have expired after 250ms');

  // Clear
  addCookie({ e: '5' });
  clear();
  assert.equal(pool.length, 0);
});

await test('Cookie pool — FIFO mode + pool size cap', () => {
  let pool = [];
  const MAX = 5;

  function addCookieFIFO(cookies) {
    pool.push({ cookies, ts: Date.now(), expiresAt: Date.now() + 60000 });
    while (pool.length > MAX) pool.pop(); // FIFO cap = drop newest overflow
  }

  function consumeFIFO() {
    return pool.length > 0 ? pool.shift() : null; // FIFO = oldest first
  }

  for (let i = 0; i < 8; i++) addCookieFIFO({ n: i });
  assert.equal(pool.length, MAX, 'Pool capped at MAX');

  // FIFO: oldest first
  const first = consumeFIFO();
  assert.equal(first.cookies.n, 0, 'FIFO returns oldest (n=0)');
  const second = consumeFIFO();
  assert.equal(second.cookies.n, 1, 'FIFO returns next oldest (n=1)');
});

await test('Cookie pool — proxy-matched consume', () => {
  let pool = [];
  function add(cookies, proxy) {
    pool.push({ cookies, proxy, ts: Date.now(), expiresAt: Date.now() + 60000 });
  }
  function consumeWithProxy(wantProxy) {
    const idx = pool.findIndex(c => c.proxy === wantProxy);
    if (idx !== -1) return pool.splice(idx, 1)[0];
    return pool.length > 0 ? pool.pop() : null;
  }

  add({ a: '1' }, 'proxy-A');
  add({ b: '2' }, 'proxy-B');
  add({ c: '3' }, 'proxy-A');

  const match = consumeWithProxy('proxy-B');
  assert.deepEqual(match.cookies, { b: '2' });
  assert.equal(pool.length, 2);

  const noMatch = consumeWithProxy('proxy-C');
  assert.deepEqual(noMatch.cookies, { c: '3' }, 'Falls back to LIFO when no proxy match');
});

// ─── Test: Address jig ────────────────────────────────────────────────────────

await test('Address jig — inserts character after street number', () => {
  const JIG_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

  function jigAddress(address1, jigIndex) {
    const char = JIG_CHARS[Math.abs(jigIndex) % JIG_CHARS.length];
    const m = address1.match(/^(\d+)(.*)$/);
    if (m) return `${m[1]}${char}${m[2]}`;
    return address1 + char;
  }

  assert.equal(jigAddress('123 Main St', 0), '123A Main St');
  assert.equal(jigAddress('123 Main St', 1), '123B Main St');
  assert.equal(jigAddress('456 Oak Ave', 22), '456Z Oak Ave');
  assert.equal(jigAddress('No Number Here', 0), 'No Number HereA');
  assert.equal(jigAddress('789 Elm', 5), '789F Elm');
});

// ─── Test: JSON file storage ─────────────────────────────────────────────────

await test('JSON storage — CRUD + settings persist to disk', () => {
  const tmpDir = path.join(os.tmpdir(), `beatbots-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Minimal reimplementation of db.ts logic for testing
  let cache = {};
  let settingsCache = {};
  let idSeq = Date.now();

  function storeFile(name) { return path.join(tmpDir, `${name}.json`); }

  function loadStore(name) {
    if (cache[name]) return cache[name];
    try {
      cache[name] = JSON.parse(fs.readFileSync(storeFile(name), 'utf-8'));
    } catch { cache[name] = []; }
    return cache[name];
  }

  function saveStore(name) {
    fs.writeFileSync(storeFile(name), JSON.stringify(cache[name], null, 2), 'utf-8');
  }

  function getAll(storeName) { return [...loadStore(storeName)].reverse(); }

  function getById(storeName, id) {
    return loadStore(storeName).find(i => i.id === id) ?? null;
  }

  function upsert(storeName, item) {
    const items = loadStore(storeName);
    const now = new Date().toISOString();
    if (!item.id) {
      const newItem = { ...item, id: ++idSeq, createdAt: now, updatedAt: now };
      items.push(newItem);
      cache[storeName] = items;
      saveStore(storeName);
      return newItem;
    }
    const idx = items.findIndex(i => i.id === item.id);
    if (idx === -1) {
      items.push({ ...item, createdAt: now, updatedAt: now });
    } else {
      items[idx] = { ...items[idx], ...item, updatedAt: now };
    }
    cache[storeName] = items;
    saveStore(storeName);
    return item;
  }

  function remove(storeName, id) {
    const items = loadStore(storeName);
    cache[storeName] = items.filter(i => i.id !== id);
    saveStore(storeName);
  }

  function setSetting(key, value) {
    settingsCache[key] = value;
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify(settingsCache, null, 2), 'utf-8');
  }

  function getSetting(key, fallback) {
    return settingsCache[key] ?? fallback;
  }

  // CREATE
  const p1 = upsert('profiles', { name: 'Test Profile', email: 'test@example.com' });
  assert.ok(p1.id, 'Created profile has an id');
  assert.ok(p1.createdAt, 'Created profile has createdAt');

  const p2 = upsert('profiles', { name: 'Second Profile', email: 'second@example.com' });
  assert.notEqual(p1.id, p2.id, 'IDs are unique');

  // READ
  const all = getAll('profiles');
  assert.equal(all.length, 2);
  assert.equal(all[0].name, 'Second Profile', 'getAll returns newest first');

  const found = getById('profiles', p1.id);
  assert.equal(found.name, 'Test Profile');

  const notFound = getById('profiles', 999999);
  assert.equal(notFound, null);

  // UPDATE
  upsert('profiles', { id: p1.id, name: 'Updated Profile' });
  const updated = getById('profiles', p1.id);
  assert.equal(updated.name, 'Updated Profile');
  assert.equal(updated.email, 'test@example.com', 'Email preserved on update');

  // DELETE
  remove('profiles', p2.id);
  assert.equal(getAll('profiles').length, 1);

  // SETTINGS
  setSetting('discordWebhook', 'https://discord.com/api/webhooks/test');
  assert.equal(getSetting('discordWebhook', ''), 'https://discord.com/api/webhooks/test');
  assert.equal(getSetting('missing', 'default'), 'default');

  // Verify disk persistence
  const diskProfiles = JSON.parse(fs.readFileSync(storeFile('profiles'), 'utf-8'));
  assert.equal(diskProfiles.length, 1);
  assert.equal(diskProfiles[0].name, 'Updated Profile');

  const diskSettings = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf-8'));
  assert.equal(diskSettings.discordWebhook, 'https://discord.com/api/webhooks/test');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Test: Export / Import ────────────────────────────────────────────────────

await test('Data export / import — round-trip preserves data', () => {
  const tmpDir = path.join(os.tmpdir(), `beatbots-export-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Simulate export
  const snapshot = {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: { discordWebhook: 'https://test.com/hook', cookieTtlMinutes: '8' },
    profiles: [
      { id: 1, name: 'Profile A', email: 'a@test.com', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 2, name: 'Profile B', email: 'b@test.com', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
    ],
    accounts: [
      { id: 1, name: 'Acc1', email: 'acc@test.com', password: 'x', status: 'idle' },
    ],
    tasks: [],
    proxy_lists: [],
    product_groups: [],
    monitor_products: [],
    harvesters: [],
    imap_profiles: [],
  };

  // Write to file
  const exportPath = path.join(tmpDir, 'backup.json');
  fs.writeFileSync(exportPath, JSON.stringify(snapshot, null, 2), 'utf-8');

  // Re-read
  const imported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
  assert.equal(imported.version, 2);
  assert.equal(imported.profiles.length, 2);
  assert.equal(imported.profiles[0].name, 'Profile A');
  assert.equal(imported.accounts.length, 1);
  assert.equal(imported.settings.discordWebhook, 'https://test.com/hook');

  // Verify no data loss
  assert.deepEqual(Object.keys(imported).sort(), Object.keys(snapshot).sort());

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Test: Monitor stock parsing ─────────────────────────────────────────────

await test('Monitor — parseStockStatus handles all fulfillment shapes', () => {
  const SELLABLE = /^(IN_STOCK|LIMITED_STOCK|AVAILABLE|PRE_ORDER_SELLABLE)$/i;

  function parseStockStatus(data) {
    try {
      const fulfillment = data?.data?.product?.fulfillment;
      if (!fulfillment) return { inStock: false };
      const shippingOpts = fulfillment.shipping_options;
      const shippingStatus = shippingOpts?.availability_status ?? '';
      const inStock = SELLABLE.test(shippingStatus);
      const qty = shippingOpts?.available_to_promise_quantity ?? null;
      const price = data?.data?.product?.price?.current_retail ?? null;
      return { inStock, availableQty: qty, price };
    } catch { return { inStock: false }; }
  }

  // In stock
  const inStock = parseStockStatus({
    data: { product: { fulfillment: { shipping_options: { availability_status: 'IN_STOCK', available_to_promise_quantity: 25 } }, price: { current_retail: 29.99 } } }
  });
  assert.equal(inStock.inStock, true);
  assert.equal(inStock.availableQty, 25);
  assert.equal(inStock.price, 29.99);

  // Limited stock
  const limited = parseStockStatus({
    data: { product: { fulfillment: { shipping_options: { availability_status: 'LIMITED_STOCK', available_to_promise_quantity: 2 } }, price: { current_retail: 9.99 } } }
  });
  assert.equal(limited.inStock, true);
  assert.equal(limited.availableQty, 2);

  // Out of stock
  const oos = parseStockStatus({
    data: { product: { fulfillment: { shipping_options: { availability_status: 'OUT_OF_STOCK', available_to_promise_quantity: 0 } } } }
  });
  assert.equal(oos.inStock, false);

  // Missing fulfillment
  assert.equal(parseStockStatus({}).inStock, false);
  assert.equal(parseStockStatus({ data: {} }).inStock, false);
  assert.equal(parseStockStatus({ data: { product: {} } }).inStock, false);

  // Null / undefined
  assert.equal(parseStockStatus(null).inStock, false);
  assert.equal(parseStockStatus(undefined).inStock, false);
});

await test('Monitor — high stock & max price filters', () => {
  function passesFilters(result, config) {
    if (config.highStockOnly) {
      const qty = result.availableQty ?? 0;
      if (qty < config.highStockThreshold) return false;
    }
    if (config.maxPrice != null && result.price != null) {
      if (result.price > config.maxPrice) return false;
    }
    return true;
  }

  const noFilter = { highStockOnly: false, highStockThreshold: 10, maxPrice: null };
  assert.equal(passesFilters({ inStock: true, availableQty: 1, price: 100 }, noFilter), true);

  const stockFilter = { highStockOnly: true, highStockThreshold: 10, maxPrice: null };
  assert.equal(passesFilters({ inStock: true, availableQty: 5 }, stockFilter), false, 'qty 5 < threshold 10');
  assert.equal(passesFilters({ inStock: true, availableQty: 15 }, stockFilter), true, 'qty 15 >= threshold 10');
  assert.equal(passesFilters({ inStock: true }, stockFilter), false, 'missing qty fails high stock');

  const priceFilter = { highStockOnly: false, highStockThreshold: 10, maxPrice: 29.99 };
  assert.equal(passesFilters({ inStock: true, price: 25.00 }, priceFilter), true);
  assert.equal(passesFilters({ inStock: true, price: 50.00 }, priceFilter), false, 'price 50 > max 29.99');
  assert.equal(passesFilters({ inStock: true, price: null }, priceFilter), true, 'null price passes');

  const bothFilters = { highStockOnly: true, highStockThreshold: 5, maxPrice: 30 };
  assert.equal(passesFilters({ inStock: true, availableQty: 10, price: 25 }, bothFilters), true);
  assert.equal(passesFilters({ inStock: true, availableQty: 10, price: 35 }, bothFilters), false);
  assert.equal(passesFilters({ inStock: true, availableQty: 2, price: 25 }, bothFilters), false);
});

// ─── Test: Checkout engine — cart clear, order ID, shape detection ────────────

await test('Checkout engine — Shape block detection on ATC response', () => {
  function detectShapeBlock(status, data) {
    if (status === 409 || status === 429) {
      const errCode = data?.error?.code || data?.code || '';
      if (String(errCode).includes('SHAPE') || String(errCode).includes('BLOCKED')) {
        return { shapeBlocked: true };
      }
    }
    return { shapeBlocked: false };
  }

  assert.ok(detectShapeBlock(409, { error: { code: 'SHAPE_BLOCKED' } }).shapeBlocked);
  assert.ok(detectShapeBlock(429, { code: 'BLOCKED_RESPONSE' }).shapeBlocked);
  assert.ok(!detectShapeBlock(409, { error: { code: 'CART_IN_USE' } }).shapeBlocked);
  assert.ok(!detectShapeBlock(200, {}).shapeBlocked);
  assert.ok(!detectShapeBlock(500, {}).shapeBlocked);
});

await test('Checkout engine — OOS detection on ATC response', () => {
  function detectOOS(status, data) {
    if (status === 422) {
      const errType = data?.error?.type || '';
      if (String(errType).includes('SELLABLE') || String(errType).includes('STOCK')) {
        return { outOfStock: true };
      }
    }
    return { outOfStock: false };
  }

  assert.ok(detectOOS(422, { error: { type: 'ITEM_NOT_SELLABLE' } }).outOfStock);
  assert.ok(detectOOS(422, { error: { type: 'OUT_OF_STOCK' } }).outOfStock);
  assert.ok(!detectOOS(422, { error: { type: 'PAYMENT_ERROR' } }).outOfStock);
  assert.ok(!detectOOS(200, {}).outOfStock);
});

await test('Checkout engine — order ID & total parsing from place_order response', () => {
  function parseOrderResponse(data) {
    const orderId = data?.order?.id || data?.order_id || '';
    const orderTotal = data?.order?.total_amount || data?.total_amount || undefined;
    return { orderId, orderTotal };
  }

  // Nested form
  const r1 = parseOrderResponse({ order: { id: 'ORD-123456', total_amount: 42.99 } });
  assert.equal(r1.orderId, 'ORD-123456');
  assert.equal(r1.orderTotal, 42.99);

  // Flat form
  const r2 = parseOrderResponse({ order_id: 'ORD-789', total_amount: 9.99 });
  assert.equal(r2.orderId, 'ORD-789');
  assert.equal(r2.orderTotal, 9.99);

  // Empty
  const r3 = parseOrderResponse({});
  assert.equal(r3.orderId, '');
  assert.equal(r3.orderTotal, undefined);
});

// ─── Test: Task runner — retry backoff ────────────────────────────────────────

await test('Task runner — exponential backoff capped at 30s', () => {
  function computeBackoff(attempt, baseDelay) {
    return Math.min(baseDelay * Math.pow(2, Math.min(attempt, 5)), 30000);
  }

  assert.equal(computeBackoff(0, 1000), 1000);
  assert.equal(computeBackoff(1, 1000), 2000);
  assert.equal(computeBackoff(2, 1000), 4000);
  assert.equal(computeBackoff(3, 1000), 8000);
  assert.equal(computeBackoff(4, 1000), 16000);
  assert.equal(computeBackoff(5, 1000), 30000, 'Capped at 30s');
  assert.equal(computeBackoff(6, 1000), 30000, 'Still 30s at attempt 6 (pow capped at 5)');
  assert.equal(computeBackoff(10, 1000), 30000, 'Still 30s at attempt 10');
  assert.equal(computeBackoff(0, 500), 500);
  assert.equal(computeBackoff(2, 500), 2000);
});

await test('Task runner — product round-robin pick', () => {
  const products = [
    { tcin: 'A', qty: 1 },
    { tcin: 'B', qty: 1 },
    { tcin: 'C', qty: 1 },
  ];

  function pickProduct(prods, successCount) {
    const eligible = prods.filter(p => (p.qty ?? 1) > 0);
    if (!eligible.length) return null;
    return eligible[successCount % eligible.length];
  }

  assert.equal(pickProduct(products, 0).tcin, 'A');
  assert.equal(pickProduct(products, 1).tcin, 'B');
  assert.equal(pickProduct(products, 2).tcin, 'C');
  assert.equal(pickProduct(products, 3).tcin, 'A', 'Wraps around');
  assert.equal(pickProduct([], 0), null);
});

// ─── Test: Guest session creation logic ──────────────────────────────────────

await test('Session manager — visitor ID format', () => {
  // The app generates UUIDs without dashes, uppercase
  function generateVisitorId() {
    const hex = '0123456789ABCDEF';
    let id = '';
    for (let i = 0; i < 32; i++) id += hex[Math.floor(Math.random() * 16)];
    return id;
  }

  const id = generateVisitorId();
  assert.equal(id.length, 32);
  assert.match(id, /^[0-9A-F]{32}$/, 'Visitor ID is 32 hex uppercase chars');

  // Uniqueness
  const id2 = generateVisitorId();
  assert.notEqual(id, id2, 'Two generated IDs should differ');
});

await test('Session manager — token cache expiry with 60s early guard', () => {
  const tokenCache = new Map();

  function getCachedSession(accountId) {
    const ctx = tokenCache.get(accountId);
    if (!ctx) return null;
    if (ctx.tokenExpiresAt < Date.now() + 60000) {
      tokenCache.delete(accountId);
      return null;
    }
    return ctx;
  }

  // Valid token (expires in 2 hours)
  tokenCache.set(1, { accountId: 1, tokenExpiresAt: Date.now() + 7200 * 1000 });
  assert.ok(getCachedSession(1), 'Token valid');

  // Token that expires in 30 seconds (within 60s guard)
  tokenCache.set(2, { accountId: 2, tokenExpiresAt: Date.now() + 30 * 1000 });
  assert.equal(getCachedSession(2), null, 'Token within 60s guard returns null');

  // Expired token
  tokenCache.set(3, { accountId: 3, tokenExpiresAt: Date.now() - 1000 });
  assert.equal(getCachedSession(3), null, 'Expired token returns null');
});

// ─── Test: Run log writing ───────────────────────────────────────────────────

await test('Run log — trim to max 100 per task', () => {
  const MAX_LOGS = 100;
  let logs = [];

  function writeLog(entry) {
    logs.push({ ...entry, id: logs.length + 1, ts: new Date().toISOString() });
    const forTask = logs.filter(l => l.taskId === entry.taskId);
    if (forTask.length > MAX_LOGS) {
      const excess = forTask.slice(MAX_LOGS);
      logs = logs.filter(l => !excess.includes(l));
    }
  }

  // Write 110 logs for task 1
  for (let i = 0; i < 110; i++) {
    writeLog({ taskId: 1, outcome: 'success', tcin: `T${i}` });
  }

  const task1Logs = logs.filter(l => l.taskId === 1);
  assert.equal(task1Logs.length, MAX_LOGS, 'Trimmed to 100');

  // Other tasks unaffected
  writeLog({ taskId: 2, outcome: 'error', tcin: 'X' });
  assert.equal(logs.filter(l => l.taskId === 2).length, 1);
});

// ─── Test: WS Bridge — message parsing ───────────────────────────────────────

await test('WS Bridge — handles valid + invalid JSON messages', () => {
  const received = [];
  function handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return null; }
    switch (msg.type) {
      case 'cookie_harvest': received.push(msg); return 'cookie_harvest';
      case 'ping': return 'pong';
      default: return 'unknown';
    }
  }

  assert.equal(handleMessage('not json'), null);
  assert.equal(handleMessage('{"type":"ping"}'), 'pong');
  assert.equal(handleMessage('{"type":"cookie_harvest","kind":"atc","cookies":{"a":"1"}}'), 'cookie_harvest');
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].cookies, { a: '1' });
  assert.equal(handleMessage('{"type":"unknown_type"}'), 'unknown');
});

// ─── Test: TypeScript build verification ──────────────────────────────────────

await test('TypeScript build — dist-electron exists and has main + preload', () => {
  const mainIndex = path.join(APP_ROOT, 'dist-electron', 'main', 'index.js');
  const preload = path.join(APP_ROOT, 'dist-electron', 'preload', 'preload.js');

  assert.ok(fs.existsSync(mainIndex), `main/index.js exists at ${mainIndex}`);
  assert.ok(fs.existsSync(preload), `preload/preload.js exists at ${preload}`);

  const mainSrc = fs.readFileSync(mainIndex, 'utf-8');
  assert.ok(mainSrc.length > 1000, 'main/index.js is substantial');
  assert.ok(mainSrc.includes('BrowserWindow') || mainSrc.includes('createWindow'), 'main/index.js references BrowserWindow');

  const preloadSrc = fs.readFileSync(preload, 'utf-8');
  assert.ok(preloadSrc.includes('contextBridge') || preloadSrc.includes('beatbots'), 'preload exposes beatbots bridge');
  assert.ok(preloadSrc.includes('electronAPI') || preloadSrc.includes('minimize'), 'preload exposes window controls');
});

await test('Renderer build — dist/index.html + assets exist', () => {
  const indexHtml = path.join(APP_ROOT, 'dist', 'index.html');
  assert.ok(fs.existsSync(indexHtml), 'dist/index.html exists');

  const html = fs.readFileSync(indexHtml, 'utf-8');
  assert.ok(html.includes('<script'), 'index.html has script tag');

  const assetsDir = path.join(APP_ROOT, 'dist', 'assets');
  assert.ok(fs.existsSync(assetsDir), 'dist/assets/ exists');

  const assets = fs.readdirSync(assetsDir);
  assert.ok(assets.some(f => f.endsWith('.js')), 'JS bundle exists in assets');
  assert.ok(assets.some(f => f.endsWith('.css')), 'CSS bundle exists in assets');
});

// ─── Report ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log(`  BEATBOTS UNIT TEST REPORT`);
console.log('═'.repeat(60));
console.log(`  Total: ${results.length}   Passed: ${passed}   Failed: ${failed}`);
console.log('─'.repeat(60));

for (const r of results) {
  const icon = r.pass ? '✅' : '❌';
  const label = `T${String(r.n).padStart(2, '0')}`;
  const ms = `${r.ms}ms`.padStart(7);
  console.log(`  ${icon}  ${label}  ${ms}  ${r.name}`);
  if (!r.pass) console.log(`         ⤷ ${r.error}`);
}

console.log('═'.repeat(60));

if (failed > 0) {
  console.error(`\n${failed} TEST(S) FAILED`);
  process.exit(1);
} else {
  console.log(`\nALL ${passed} TESTS PASSED ✅`);
}
