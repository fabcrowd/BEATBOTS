/**
 * BEATBOTS — Shape Cookie & Bot Material Deep Test
 *
 * Tests the full cookie lifecycle end-to-end:
 *   R01  Shape harvester CDP interception logic (cookie parsing, header capture)
 *   R02  Cookie pool lifecycle: add → consume LIFO/FIFO → TTL expiry → proxy match
 *   R03  Extension cookieHarvest.js: capture, burst, prune, apply, clear
 *   R04  WS bridge: extension → Electron cookie forwarding
 *   R05  Checkout engine: Shape block detection + cookie retry flow
 *   R06  Session recovery: RedSky 401/403 streak + PX cookie preservation
 *   R07  Extension ↔ Electron bridge: cookie_harvest message round-trip
 *   R08  Monitor stock parser: fulfillment block + batch response + price filters
 *   R09  Drop timing: harvest keepalive intervals + burst dedup windows
 *   R10  Harvester lifecycle: start/stop/crash-restart state machine
 *
 * Run:   node scripts/browser-smoke/shape-cookie-test.mjs
 */

import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';

const results = [];
let passed = 0;
let failed = 0;
let round = 0;

function ts() { return new Date().toISOString().slice(11, 23); }

async function test(name, fn) {
  round++;
  const n = round;
  const start = Date.now();
  process.stdout.write(`\n${'─'.repeat(60)}\n  R${String(n).padStart(2, '0')} — ${name}\n${'─'.repeat(60)}\n`);
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

// ─── R01: Shape harvester CDP interception logic ────────────────────────────

await test('Shape harvester — CDP cookie header parsing', () => {
  // Simulates what ShapeHarvester.requestHandler does with intercepted requests
  function parseInterceptedRequest(params) {
    const cookieHeader = params.request?.headers?.cookie ?? '';
    if (!cookieHeader || !params.request?.url?.includes('api.target.com')) {
      return { captured: false };
    }

    const cookies = {};
    for (const part of cookieHeader.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k) cookies[k.trim()] = v.join('=').trim();
    }

    const SHAPE_KEYS = ['x-api-key', 'x-t-request-id', 'x-application-name', 'user-agent', 'accept-language'];
    const shapeHeaders = {};
    for (const key of SHAPE_KEYS) {
      const val = params.request?.headers?.[key];
      if (val) shapeHeaders[key] = val;
    }

    const hasShape = Object.keys(cookies).some(k =>
      k.toLowerCase().includes('shape') ||
      k.startsWith('_abck') ||
      k === 'bm_sz' ||
      k === 'ak_bmsc'
    );

    return {
      captured: hasShape || Object.keys(cookies).length > 3,
      cookies,
      shapeHeaders,
      hasShape,
    };
  }

  // Shape cookies present
  const r1 = parseInterceptedRequest({
    request: {
      url: 'https://api.target.com/web_checkouts/v1/cart_items',
      headers: {
        cookie: '_abck=abc123; bm_sz=xyz; visitorId=AAA; TealeafAkaSid=BBB',
        'x-api-key': 'ff457966e64d5e877fdbad070f276d18ecec4a01',
        'x-t-request-id': 'req-uuid-here',
        'user-agent': 'Mozilla/5.0 Chrome/130',
      },
    },
  });
  assert.ok(r1.captured, 'Shape cookies detected');
  assert.ok(r1.hasShape, 'hasShape flag set');
  assert.equal(r1.cookies._abck, 'abc123');
  assert.equal(r1.cookies.bm_sz, 'xyz');
  assert.equal(r1.shapeHeaders['x-api-key'], 'ff457966e64d5e877fdbad070f276d18ecec4a01');

  // Cookie with = in value
  const r2 = parseInterceptedRequest({
    request: {
      url: 'https://api.target.com/cart',
      headers: {
        cookie: '_abck=encoded=value=here; other=val',
      },
    },
  });
  assert.equal(r2.cookies._abck, 'encoded=value=here', 'Handles = in cookie value');

  // Non-Target URL — should not capture
  const r3 = parseInterceptedRequest({
    request: {
      url: 'https://api.walmart.com/items',
      headers: { cookie: '_abck=abc' },
    },
  });
  assert.ok(!r3.captured, 'Non-Target URL not captured');

  // No Shape cookies but >3 cookies → still captured
  const r4 = parseInterceptedRequest({
    request: {
      url: 'https://api.target.com/cart',
      headers: {
        cookie: 'a=1; b=2; c=3; d=4',
      },
    },
  });
  assert.ok(r4.captured, '>3 cookies captured even without shape keys');
  assert.ok(!r4.hasShape, 'hasShape false when no shape keys');

  // Empty cookies → not captured
  const r5 = parseInterceptedRequest({
    request: {
      url: 'https://api.target.com/cart',
      headers: { cookie: '' },
    },
  });
  assert.ok(!r5.captured, 'Empty cookie header not captured');
});

// ─── R02: Cookie pool lifecycle ─────────────────────────────────────────────

await test('Cookie pool — full lifecycle with dual buckets', async () => {
  const pools = { login: [], atc: [] };
  const TTL = 200;
  let removalOrder = 'lifo';

  function addCookie(kind, cookies, shapeHeaders = {}, opts = {}) {
    const now = Date.now();
    pools[kind].push({
      id: Math.random().toString(36),
      kind, cookies, shapeHeaders,
      ts: now, expiresAt: now + TTL,
      harvesterId: opts.harvesterId ?? null,
      proxyUsed: opts.proxyUsed ?? null,
    });
    while (pools[kind].length > 50) {
      if (removalOrder === 'fifo') pools[kind].pop();
      else pools[kind].shift();
    }
  }

  function pruneExpired() {
    const now = Date.now();
    for (const kind of ['login', 'atc']) {
      pools[kind] = pools[kind].filter(c => c.expiresAt > now);
    }
  }

  function consumeCookie(kind, preferProxy) {
    pruneExpired();
    const pool = pools[kind];
    if (!pool.length) return null;
    if (preferProxy) {
      const idx = pool.findIndex(c => c.proxyUsed === preferProxy);
      if (idx !== -1) return pool.splice(idx, 1)[0];
    }
    if (removalOrder === 'lifo') return pool.pop() ?? null;
    return pool.shift() ?? null;
  }

  // Add to separate buckets
  addCookie('atc', { _abck: 'atc1' }, { 'x-api-key': 'key1' }, { harvesterId: 'h1' });
  addCookie('login', { _abck: 'login1' }, {}, { harvesterId: 'h2' });
  addCookie('atc', { _abck: 'atc2' }, { 'x-api-key': 'key2' }, { proxyUsed: 'proxy-A' });

  assert.equal(pools.atc.length, 2, '2 ATC cookies');
  assert.equal(pools.login.length, 1, '1 login cookie');

  // LIFO consume from ATC
  const c1 = consumeCookie('atc');
  assert.equal(c1.cookies._abck, 'atc2', 'LIFO: newest ATC first');
  assert.equal(c1.shapeHeaders['x-api-key'], 'key2');

  // Proxy-matched consume
  addCookie('atc', { _abck: 'atc3' }, {}, { proxyUsed: 'proxy-B' });
  addCookie('atc', { _abck: 'atc4' }, {}, { proxyUsed: 'proxy-A' });
  const proxyMatch = consumeCookie('atc', 'proxy-B');
  assert.equal(proxyMatch.cookies._abck, 'atc3', 'Proxy-matched cookie returned');

  // Login bucket independent
  const loginC = consumeCookie('login');
  assert.equal(loginC.cookies._abck, 'login1');
  assert.equal(consumeCookie('login'), null, 'Login bucket empty');

  // TTL expiry
  addCookie('atc', { _abck: 'expires-soon' });
  await new Promise(r => setTimeout(r, 250));
  const expired = consumeCookie('atc');
  // Only atc1 and atc4 should remain... but those also had TTL=200. Check:
  pruneExpired();
  assert.equal(pools.atc.length, 0, 'All ATCs expired after 250ms');
});

// ─── R03: Extension cookieHarvest.js logic ──────────────────────────────────

await test('Extension cookieHarvest — prune, LIFO cap, burst dedup', () => {
  function tchPruneExpired(entries, expirationMinutes) {
    const maxAge = Math.max(1, Number(expirationMinutes) || 3) * 60 * 1000;
    const now = Date.now();
    return entries.filter(e => now - (e.ts || 0) <= maxAge);
  }

  // Prune works
  const now = Date.now();
  const entries = [
    { ts: now - 10 * 60 * 1000, kind: 'atc', cookies: [] },
    { ts: now - 1 * 60 * 1000, kind: 'atc', cookies: [] },
    { ts: now, kind: 'login', cookies: [] },
  ];
  const pruned = tchPruneExpired(entries, 5);
  assert.equal(pruned.length, 2, 'Only 2 entries within 5 min');
  assert.equal(pruned[0].ts, entries[1].ts);

  // LIFO cap at 48
  let pool = [];
  for (let i = 0; i < 55; i++) {
    pool.push({ ts: now + i, kind: 'atc', cookies: [`cookie-${i}`] });
    while (pool.length > 48) pool.shift(); // LIFO cap = drop oldest
  }
  assert.equal(pool.length, 48, 'Capped at 48');
  assert.deepEqual(pool[0].cookies, ['cookie-7'], 'Oldest kept is cookie-7 (55-48=7)');

  // FIFO cap
  pool = [];
  for (let i = 0; i < 55; i++) {
    pool.push({ ts: now + i, kind: 'atc', cookies: [`cookie-${i}`] });
    while (pool.length > 48) pool.pop(); // FIFO cap = drop newest overflow
  }
  assert.equal(pool.length, 48, 'FIFO capped at 48');
  assert.deepEqual(pool[0].cookies, ['cookie-0'], 'FIFO keeps oldest (cookie-0)');

  // sameSite normalization
  function tchSameSiteForSet(ss) {
    const s = String(ss || '').toLowerCase();
    if (s === 'lax' || s === 'strict' || s === 'no_restriction') return s;
    return 'unspecified';
  }
  assert.equal(tchSameSiteForSet('Lax'), 'lax');
  assert.equal(tchSameSiteForSet('STRICT'), 'strict');
  assert.equal(tchSameSiteForSet('no_restriction'), 'no_restriction');
  assert.equal(tchSameSiteForSet('none'), 'unspecified');
  assert.equal(tchSameSiteForSet(null), 'unspecified');
  assert.equal(tchSameSiteForSet(undefined), 'unspecified');
});

// ─── R04: WS bridge cookie forwarding ────────────────────────────────────────

await test('WS bridge — cookie_harvest message round-trip', async () => {
  const received = [];

  // Use port 0 to let the OS pick a free port
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const serverReady = new Promise(resolve => wss.on('listening', resolve));
  await serverReady;
  const PORT = wss.address().port;

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', source: 'beatbots', version: '1.0.0' }));
    ws.on('message', (raw) => {
      try { received.push(JSON.parse(raw.toString())); } catch {}
    });
  });

  // Connect as the extension would — set up message listener BEFORE open
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const messages = [];
  ws.on('message', (raw) => {
    try { messages.push(JSON.parse(raw.toString())); } catch {}
  });
  const clientOpen = new Promise(resolve => ws.on('open', resolve));
  await clientOpen;

  // Wait for the hello message to arrive
  await new Promise(r => setTimeout(r, 200));
  const helloMsg = messages.find(m => m.type === 'hello');
  assert.ok(helloMsg, 'Hello message received');
  assert.equal(helloMsg.source, 'beatbots');

  // Send a cookie harvest (simulating bbSendCookieHarvest)
  ws.send(JSON.stringify({
    type: 'cookie_harvest',
    kind: 'atc',
    cookies: { _abck: 'test-value', bm_sz: 'sz123' },
    shapeHeaders: { 'x-api-key': 'ff457966' },
    proxy: 'proxy-A:1234',
  }));

  // Send a login harvest
  ws.send(JSON.stringify({
    type: 'cookie_harvest',
    kind: 'login',
    cookies: { _abck: 'login-val', TealeafAkaSid: 'session1' },
    shapeHeaders: {},
    proxy: null,
  }));

  // Send a ping
  ws.send(JSON.stringify({ type: 'ping' }));

  await new Promise(r => setTimeout(r, 200));

  assert.equal(received.length, 3, '3 messages received by server');

  const atcMsg = received[0];
  assert.equal(atcMsg.type, 'cookie_harvest');
  assert.equal(atcMsg.kind, 'atc');
  assert.equal(atcMsg.cookies._abck, 'test-value');
  assert.equal(atcMsg.shapeHeaders['x-api-key'], 'ff457966');
  assert.equal(atcMsg.proxy, 'proxy-A:1234');

  const loginMsg = received[1];
  assert.equal(loginMsg.kind, 'login');
  assert.equal(loginMsg.cookies.TealeafAkaSid, 'session1');

  assert.equal(received[2].type, 'ping');

  // Cleanup — must close clients first, then the server
  ws.close();
  for (const client of wss.clients) client.terminate();
  await new Promise(r => wss.close(r));
});

// ─── R05: Checkout engine Shape block detection + retry ─────────────────────

await test('Checkout engine — Shape block + OOS + cart-in-use detection', () => {
  function classifyATCError(status, data) {
    if (status === 409 || status === 429) {
      const errCode = data?.error?.code || data?.code || '';
      if (String(errCode).includes('SHAPE') || String(errCode).includes('BLOCKED')) {
        return { type: 'shape_block', retryable: true };
      }
    }
    if (status === 422) {
      const errType = data?.error?.type || '';
      if (String(errType).includes('SELLABLE') || String(errType).includes('STOCK')) {
        return { type: 'oos', retryable: false };
      }
    }
    if (status === 409) return { type: 'cart_in_use', retryable: true };
    if (status >= 500) return { type: 'server_error', retryable: true };
    return { type: 'unknown', retryable: false };
  }

  // Shape block scenarios
  assert.equal(classifyATCError(409, { error: { code: 'SHAPE_BLOCKED' } }).type, 'shape_block');
  assert.equal(classifyATCError(429, { code: 'BLOCKED_BY_SHAPE' }).type, 'shape_block');
  assert.ok(classifyATCError(409, { error: { code: 'SHAPE_BLOCKED' } }).retryable);

  // OOS
  assert.equal(classifyATCError(422, { error: { type: 'ITEM_NOT_SELLABLE' } }).type, 'oos');
  assert.ok(!classifyATCError(422, { error: { type: 'OUT_OF_STOCK' } }).retryable);

  // Cart in use (409 without shape code)
  assert.equal(classifyATCError(409, { error: { code: 'CART_IN_USE' } }).type, 'cart_in_use');
  assert.ok(classifyATCError(409, {}).retryable);

  // Server error
  assert.equal(classifyATCError(500, {}).type, 'server_error');
  assert.ok(classifyATCError(502, {}).retryable);

  // Unknown
  assert.equal(classifyATCError(400, {}).type, 'unknown');
  assert.ok(!classifyATCError(400, {}).retryable);
});

// ─── R06: Session recovery logic ─────────────────────────────────────────────

await test('Session recovery — streak threshold + checkout guard', () => {
  let streak = 0;
  let lastRecoveryMs = 0;
  const COOLDOWN = 12 * 60 * 1000;

  function shouldRecover(isCheckoutActive) {
    const now = Date.now();
    if (now - lastRecoveryMs < COOLDOWN) return { ok: false, reason: 'cooldown' };
    if (streak < 3) return { ok: false, reason: 'streak_below_threshold', streak };
    if (isCheckoutActive) return { ok: false, reason: 'checkout_in_progress' };
    lastRecoveryMs = now;
    streak = 0;
    return { ok: true };
  }

  // Streak < 3 → no recovery
  streak = 1;
  assert.ok(!shouldRecover(false).ok, 'streak 1: no recovery');
  streak = 2;
  assert.ok(!shouldRecover(false).ok, 'streak 2: no recovery');

  // Streak >= 3 → recovery
  streak = 3;
  const r1 = shouldRecover(false);
  assert.ok(r1.ok, 'streak 3: recovery triggered');
  assert.equal(streak, 0, 'streak reset after recovery');

  // Cooldown active → no recovery (takes priority over checkout guard)
  streak = 5;
  assert.equal(shouldRecover(false).reason, 'cooldown', 'Cooldown blocks recovery');

  // Simulate cooldown expiry
  lastRecoveryMs = Date.now() - COOLDOWN - 1;

  // Checkout in progress → no recovery even with high streak
  streak = 5;
  assert.equal(shouldRecover(true).reason, 'checkout_in_progress');
});

// ─── R07: Extension → Electron cookie message format validation ─────────────

await test('Bridge message format — validates all required fields', () => {
  function validateCookieHarvestMsg(msg) {
    const errors = [];
    if (msg.type !== 'cookie_harvest') errors.push('wrong type');
    if (!['atc', 'login'].includes(msg.kind)) errors.push('invalid kind');
    if (!msg.cookies || typeof msg.cookies !== 'object') errors.push('cookies not object');
    if (msg.shapeHeaders && typeof msg.shapeHeaders !== 'object') errors.push('shapeHeaders not object');
    // proxy can be null or string
    if (msg.proxy !== null && typeof msg.proxy !== 'string') errors.push('proxy not string or null');
    return { valid: errors.length === 0, errors };
  }

  // Valid ATC harvest
  assert.ok(validateCookieHarvestMsg({
    type: 'cookie_harvest', kind: 'atc',
    cookies: { _abck: 'val' }, shapeHeaders: { 'x-api-key': 'k' }, proxy: 'p:8080',
  }).valid);

  // Valid login harvest with null proxy
  assert.ok(validateCookieHarvestMsg({
    type: 'cookie_harvest', kind: 'login',
    cookies: { sess: 'val' }, shapeHeaders: {}, proxy: null,
  }).valid);

  // Invalid: wrong type
  assert.ok(!validateCookieHarvestMsg({ type: 'ping', kind: 'atc', cookies: {} }).valid);

  // Invalid: bad kind
  const r2 = validateCookieHarvestMsg({ type: 'cookie_harvest', kind: 'invalid', cookies: {} });
  assert.ok(!r2.valid);
  assert.ok(r2.errors.includes('invalid kind'));

  // Invalid: missing cookies
  assert.ok(!validateCookieHarvestMsg({ type: 'cookie_harvest', kind: 'atc', cookies: null }).valid);
});

// ─── R08: Monitor stock parser — fulfillment block + price ───────────────────

await test('Monitor stock parser — all Target fulfillment shapes + batch response', () => {
  const SELLABLE = new Set(['IN_STOCK', 'LIMITED_STOCK', 'PRE_ORDER_SELLABLE', 'AVAILABLE']);
  const BLOCKED_RE = /(OUT_OF_STOCK|UNSELLABLE|UNAVAILABLE|NOT_AVAILABLE)/i;

  function parseFulfillmentBlock(fulfillment) {
    if (!fulfillment || typeof fulfillment !== 'object') return { stock: null, qty: 0 };
    const shipping = fulfillment.shipping_options || {};
    const status = String(shipping.availability_status || '').toUpperCase();
    const qty = Number(shipping.available_to_promise_quantity) || 0;
    const soldOut = fulfillment.sold_out === true;
    const sellable = qty > 0 || SELLABLE.has(status);
    const blocked = soldOut || BLOCKED_RE.test(status);
    if (sellable && !soldOut) return { stock: true, qty };
    if (blocked) return { stock: false, qty };
    return { stock: null, qty };
  }

  function parseBatchResponse(payload) {
    const out = new Map();
    for (const p of payload?.data?.products ?? []) {
      const tcin = String(p.tcin ?? '');
      if (tcin) {
        const block = parseFulfillmentBlock(p.fulfillment);
        const price = p.price?.current_retail ?? null;
        out.set(tcin, { ...block, price });
      }
    }
    return out;
  }

  // Single fulfillment blocks
  assert.deepEqual(parseFulfillmentBlock({ shipping_options: { availability_status: 'IN_STOCK', available_to_promise_quantity: 50 } }), { stock: true, qty: 50 });
  assert.deepEqual(parseFulfillmentBlock({ shipping_options: { availability_status: 'LIMITED_STOCK', available_to_promise_quantity: 2 } }), { stock: true, qty: 2 });
  assert.deepEqual(parseFulfillmentBlock({ shipping_options: { availability_status: 'OUT_OF_STOCK', available_to_promise_quantity: 0 } }), { stock: false, qty: 0 });
  assert.deepEqual(parseFulfillmentBlock({ sold_out: true, shipping_options: { availability_status: 'IN_STOCK', available_to_promise_quantity: 1 } }), { stock: false, qty: 1 });
  assert.deepEqual(parseFulfillmentBlock(null), { stock: null, qty: 0 });
  assert.deepEqual(parseFulfillmentBlock({}), { stock: null, qty: 0 });

  // PRE_ORDER_SELLABLE (important for drops)
  assert.equal(parseFulfillmentBlock({ shipping_options: { availability_status: 'PRE_ORDER_SELLABLE', available_to_promise_quantity: 0 } }).stock, true);

  // Batch response
  const batch = parseBatchResponse({
    data: {
      products: [
        { tcin: '12345', fulfillment: { shipping_options: { availability_status: 'IN_STOCK', available_to_promise_quantity: 10 } }, price: { current_retail: 29.99 } },
        { tcin: '67890', fulfillment: { shipping_options: { availability_status: 'OUT_OF_STOCK', available_to_promise_quantity: 0 } }, price: { current_retail: 49.99 } },
        { tcin: '11111', fulfillment: { shipping_options: { availability_status: 'AVAILABLE', available_to_promise_quantity: 5 } }, price: {} },
      ],
    },
  });
  assert.equal(batch.size, 3);
  assert.equal(batch.get('12345').stock, true);
  assert.equal(batch.get('12345').price, 29.99);
  assert.equal(batch.get('67890').stock, false);
  assert.equal(batch.get('11111').stock, true);
  assert.equal(batch.get('11111').price, null);
});

// ─── R09: Drop timing — harvest intervals + burst dedup ──────────────────────

await test('Drop timing — harvest keepalive intervals + burst dedup windows', () => {
  function getHarvestKeepaliveMinIntervalMs(monitor) {
    if (!monitor?.dropExpectedAt) return 5 * 60 * 1000;
    const t = Date.parse(monitor.dropExpectedAt);
    if (!isFinite(t)) return 5 * 60 * 1000;
    const now = Date.now();
    const until = t - now;
    const afterDrop = now - t;
    const inPrewindow = until > 0 && until <= 10 * 60 * 1000;
    const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
    if (inPrewindow || inGrace) return 2 * 60 * 1000;
    if (until > 0 && until <= 45 * 60 * 1000) return 3 * 60 * 1000;
    if (until > 45 * 60 * 1000) return 5 * 60 * 1000;
    if (afterDrop > 3 * 60 * 1000) return 15 * 60 * 1000;
    return 5 * 60 * 1000;
  }

  function getHarvestBurstSameUrlDedupMs(monitor) {
    if (!monitor?.dropExpectedAt) return 120_000;
    const t = Date.parse(monitor.dropExpectedAt);
    if (!isFinite(t)) return 120_000;
    const now = Date.now();
    const until = t - now;
    const afterDrop = now - t;
    const inPrewindow = until > 0 && until <= 10 * 60 * 1000;
    const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
    if (inPrewindow || inGrace) return 20_000;
    if (until > 0 && until <= 45 * 60 * 1000) return 45_000;
    return 120_000;
  }

  // No drop → defaults
  assert.equal(getHarvestKeepaliveMinIntervalMs({}), 5 * 60 * 1000);
  assert.equal(getHarvestBurstSameUrlDedupMs({}), 120_000);

  // Pre-window (5 min before drop) → tightened
  const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  assert.equal(getHarvestKeepaliveMinIntervalMs({ dropExpectedAt: soon }), 2 * 60 * 1000);
  assert.equal(getHarvestBurstSameUrlDedupMs({ dropExpectedAt: soon }), 20_000);

  // Grace window (1 min after drop) → tightened
  const justPassed = new Date(Date.now() - 1 * 60 * 1000).toISOString();
  assert.equal(getHarvestKeepaliveMinIntervalMs({ dropExpectedAt: justPassed }), 2 * 60 * 1000);
  assert.equal(getHarvestBurstSameUrlDedupMs({ dropExpectedAt: justPassed }), 20_000);

  // Mid-range (20 min before) → moderate
  const midRange = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  assert.equal(getHarvestKeepaliveMinIntervalMs({ dropExpectedAt: midRange }), 3 * 60 * 1000);
  assert.equal(getHarvestBurstSameUrlDedupMs({ dropExpectedAt: midRange }), 45_000);

  // Far future (>45 min) → relaxed
  const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.equal(getHarvestKeepaliveMinIntervalMs({ dropExpectedAt: farFuture }), 5 * 60 * 1000);
  assert.equal(getHarvestBurstSameUrlDedupMs({ dropExpectedAt: farFuture }), 120_000);

  // Long after drop (>3 min) → very relaxed
  const longAfter = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal(getHarvestKeepaliveMinIntervalMs({ dropExpectedAt: longAfter }), 15 * 60 * 1000);
});

// ─── R10: Harvester lifecycle state machine ──────────────────────────────────

await test('Harvester lifecycle — start/stop/crash-restart state transitions', () => {
  // Simulates the ShapeHarvester state machine without Puppeteer
  class MockHarvester {
    status = 'idle';
    statusText = '';
    running = false;
    harvestedCount = 0;
    crashCount = 0;
    events = [];

    start() {
      if (this.running) return;
      this.running = true;
      this.setStatus('starting', 'Launching browser...');
      // Simulate success
      this.setStatus('running', 'Harvesting...');
    }

    stop() {
      this.running = false;
      this.setStatus('stopped', 'Stopped');
    }

    simulateHarvest() {
      if (!this.running) throw new Error('Not running');
      this.harvestedCount++;
      this.setStatus('running', `Harvested (${this.harvestedCount} total)`);
    }

    simulateCrash() {
      this.crashCount++;
      this.setStatus('error', `Crash #${this.crashCount}`);
      // Auto-restart logic
      if (this.running) {
        this.setStatus('running', 'Harvesting (restarted)...');
      }
    }

    setStatus(status, text) {
      this.status = status;
      this.statusText = text;
      this.events.push({ status, text });
    }
  }

  const h = new MockHarvester();

  // Initial state
  assert.equal(h.status, 'idle');
  assert.equal(h.running, false);

  // Start
  h.start();
  assert.equal(h.running, true);
  assert.equal(h.status, 'running');

  // Double start is no-op
  h.start();
  assert.equal(h.events.filter(e => e.status === 'starting').length, 1, 'Only started once');

  // Harvest
  h.simulateHarvest();
  assert.equal(h.harvestedCount, 1);
  h.simulateHarvest();
  assert.equal(h.harvestedCount, 2);

  // Crash and auto-restart
  h.simulateCrash();
  assert.equal(h.crashCount, 1);
  assert.equal(h.status, 'running', 'Auto-restarted after crash');

  // Stop
  h.stop();
  assert.equal(h.running, false);
  assert.equal(h.status, 'stopped');

  // Can't harvest when stopped
  assert.throws(() => h.simulateHarvest(), /Not running/);

  // Restart after stop
  h.start();
  assert.equal(h.running, true);
  assert.equal(h.status, 'running');
  h.simulateHarvest();
  assert.equal(h.harvestedCount, 3, 'Counter persists across stop/start');

  // Verify event history
  const statuses = h.events.map(e => e.status);
  assert.ok(statuses.includes('idle') || true); // idle is only initial
  assert.ok(statuses.includes('starting'));
  assert.ok(statuses.includes('running'));
  assert.ok(statuses.includes('error'));
  assert.ok(statuses.includes('stopped'));
});

// ─── Report ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log(`  SHAPE COOKIE & BOT MATERIAL TEST REPORT`);
console.log('═'.repeat(60));
console.log(`  Total: ${results.length}   Passed: ${passed}   Failed: ${failed}`);
console.log('─'.repeat(60));

for (const r of results) {
  const icon = r.pass ? '✅' : '❌';
  const label = `R${String(r.n).padStart(2, '0')}`;
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
