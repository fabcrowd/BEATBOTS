/**
 * BEATBOTS — Penetration Tests for Previously Untested Areas
 *
 * Based on Stellar AIO / Refract competitive research, these areas are
 * critical for a production bot but had zero test coverage until now:
 *
 *   R01  IMAP OTP extraction — all regex patterns against real Target email bodies
 *   R02  Proxy format parsing — ip:port, ip:port:user:pass, protocol://host:port
 *   R03  Profile payment formatting — card pad, expiry normalization, phone strip
 *   R04  Content.js page type detection — product, cart, checkout, thank-you routing
 *   R05  TCIN + Walmart item ID extraction from URLs (all known formats)
 *   R06  Gmail OTP extraction — base64 decode + 6-digit code from HTML email bodies
 *   R07  NTP offset calculation — RTT compensation correctness
 *   R08  Discord embed formatting — field truncation, structure, color codes
 *   R09  Checkout step detection — shipping, payment, review, sign-in gate
 *   R10  PX cookie preservation during session recovery
 *   R11  Walmart Queue-it detection + price extraction
 *   R12  Address jig integration — jigIndex=-1 disable, sequential jig uniqueness
 *
 * Run:  node scripts/browser-smoke/untested-areas-test.mjs
 */

import assert from 'node:assert/strict';

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

// ─── R01: IMAP OTP extraction ──────────────────────────────────────────────

await test('IMAP OTP extraction — all Target email patterns (matches session-manager.ts)', () => {
  // Mirrors extractOtpFromEmailText in session-manager.ts exactly
  function extractOtpFromEmailText(text) {
    const clean = text.replace(/<[^>]*>/g, ' ');
    const patterns = [
      /verification code[\s\w]*?[:\s]\s*(\d{6})/i,
      /security code[\s\w]*?[:\s]\s*(\d{6})/i,
      /enter this code[\s\w]*?[:\s]\s*(\d{6})/i,
      /your code[\s\w]*?[:\s]\s*(\d{6})/i,
      /(?:^|\s)(\d{6})(?:\s|$)/m,
    ];
    for (const re of patterns) {
      const m = clean.match(re);
      if (m) return m[1];
    }
    return null;
  }

  // Standard Target verification email — "code is: XXXXXX" (the word "is" is crucial)
  assert.equal(extractOtpFromEmailText('Your verification code is: 482917'), '482917');
  assert.equal(extractOtpFromEmailText('Your verification code is 123456'), '123456');

  // Without "is" — "code: XXXXXX"
  assert.equal(extractOtpFromEmailText('verification code: 654321'), '654321');

  // Newline-separated
  assert.equal(extractOtpFromEmailText('verification code\n\n847291'), '847291');

  // "Enter this code" variant
  assert.equal(extractOtpFromEmailText('Please enter this code: 192837'), '192837');

  // "Security code" variant
  assert.equal(extractOtpFromEmailText('Your security code is: 394857'), '394857');

  // "Your code" variant
  assert.equal(extractOtpFromEmailText('Your code is 928374'), '928374');

  // Standalone 6-digit number (fallback)
  assert.equal(extractOtpFromEmailText('Use 748291 to verify your identity'), '748291');

  // HTML email body with OTP buried in tags (previously broken — now fixed)
  assert.equal(extractOtpFromEmailText(
    '<html><body>Your Target verification code is: 551234</body></html>'
  ), '551234');

  // Complex HTML with nested tags
  assert.equal(extractOtpFromEmailText(
    '<div style="font-size:16px"><p>Your verification code is: <b>993847</b></p></div>'
  ), '993847');

  // No OTP present
  assert.equal(extractOtpFromEmailText('Thank you for your purchase'), null);
  assert.equal(extractOtpFromEmailText('Your order #12345 has shipped'), null);

  // Multiple 6-digit numbers — first matching pattern wins
  assert.equal(extractOtpFromEmailText(
    'Reference: 999999. Your verification code is: 111222'
  ), '111222');
});

// ─── R02: Proxy format parsing ─────────────────────────────────────────────

await test('Proxy format parsing — all industry-standard formats', () => {
  function formatProxy(proxy) {
    if (proxy.includes('://')) return proxy;
    const parts = proxy.split(':');
    if (parts.length === 2) return `http://${parts[0]}:${parts[1]}`;
    if (parts.length >= 4) return `http://${parts[0]}:${parts[1]}`;
    return proxy;
  }

  // ip:port
  assert.equal(formatProxy('192.168.1.1:8080'), 'http://192.168.1.1:8080');

  // ip:port:user:pass (common bot format)
  assert.equal(formatProxy('proxy.example.com:3128:user1:pass123'), 'http://proxy.example.com:3128');

  // Already has protocol
  assert.equal(formatProxy('http://proxy.example.com:3128'), 'http://proxy.example.com:3128');
  assert.equal(formatProxy('socks5://10.0.0.1:1080'), 'socks5://10.0.0.1:1080');

  // Residential proxy format (with session)
  assert.equal(formatProxy('gate.smartproxy.com:7777:user-session-abc:pass'),
    'http://gate.smartproxy.com:7777');

  // Edge: single value
  assert.equal(formatProxy('localhost'), 'localhost');
});

await test('Proxy auth extraction — user:pass from ip:port:user:pass', () => {
  function extractProxyAuth(proxy) {
    if (!proxy || proxy.includes('://')) return null;
    const parts = proxy.split(':');
    if (parts.length >= 4) return { username: parts[2], password: parts.slice(3).join(':') };
    return null;
  }

  const auth = extractProxyAuth('1.2.3.4:8080:myuser:mypass');
  assert.equal(auth.username, 'myuser');
  assert.equal(auth.password, 'mypass');

  // Password with colon
  const auth2 = extractProxyAuth('1.2.3.4:8080:user:pass:with:colons');
  assert.equal(auth2.username, 'user');
  assert.equal(auth2.password, 'pass:with:colons');

  // No auth
  assert.equal(extractProxyAuth('1.2.3.4:8080'), null);
  assert.equal(extractProxyAuth('http://proxy.com:3128'), null);
});

// ─── R03: Profile payment formatting ────────────────────────────────────────

await test('Profile payment formatting — card, expiry, phone for Target API', () => {
  // Card number: strip spaces
  function formatCard(cardNumber) {
    return cardNumber.replace(/\s/g, '');
  }
  assert.equal(formatCard('4111 1111 1111 1111'), '4111111111111111');
  assert.equal(formatCard('4111111111111111'), '4111111111111111');
  assert.equal(formatCard('5500 0000 0000 0004'), '5500000000000004');

  // Expiry month: zero-pad
  function formatExpMonth(month) {
    return month.padStart(2, '0');
  }
  assert.equal(formatExpMonth('1'), '01');
  assert.equal(formatExpMonth('12'), '12');
  assert.equal(formatExpMonth('9'), '09');

  // Expiry year: last 4 chars
  function formatExpYear(year) {
    return year.slice(-4);
  }
  assert.equal(formatExpYear('2027'), '2027');
  assert.equal(formatExpYear('27'), '27');
  assert.equal(formatExpYear('2030'), '2030');

  // Phone: strip non-digits
  function formatPhone(phone) {
    return phone.replace(/\D/g, '');
  }
  assert.equal(formatPhone('(555) 123-4567'), '5551234567');
  assert.equal(formatPhone('+1-555-123-4567'), '15551234567');
  assert.equal(formatPhone('5551234567'), '5551234567');
});

// ─── R04: Content.js page type detection ────────────────────────────────────

await test('Content.js page type detection — mirrors getPageType() in content.js', () => {
  // Exact copy of the production getPageType() from content.js lines 1088-1096
  function getPageType(url) {
    try {
      const path = new URL(url).pathname;
      if (/^\/p\//.test(path))                            return 'product';
      if (/^\/cart/.test(path))                           return 'cart';
      if (/^\/checkout/.test(path))                       return 'checkout';
      if (/^\/co-thankyou/.test(path))                    return 'confirmation';
      if (/^\/(?:account\/)?(?:login|signin)/i.test(path)) return 'signin';
      return 'other';
    } catch { return 'other'; }
  }

  // Product pages — /p/ prefix is the only requirement
  assert.equal(getPageType('https://www.target.com/p/pokemon-trading-card-game/-/A-12345678'), 'product');
  assert.equal(getPageType('https://www.target.com/p/item-name/-/A-87654321?preselect=87654321'), 'product');
  assert.equal(getPageType('https://www.target.com/p/anything'), 'product');

  // Checkout
  assert.equal(getPageType('https://www.target.com/checkout'), 'checkout');
  assert.equal(getPageType('https://www.target.com/checkout?step=shipping'), 'checkout');

  // Cart
  assert.equal(getPageType('https://www.target.com/cart'), 'cart');
  assert.equal(getPageType('https://www.target.com/cart?lnk=cart'), 'cart');

  // Confirmation (co-thankyou, not /thankyou)
  assert.equal(getPageType('https://www.target.com/co-thankyou'), 'confirmation');
  assert.equal(getPageType('https://www.target.com/co-thankyou?orderId=123'), 'confirmation');

  // Sign-in variants
  assert.equal(getPageType('https://www.target.com/login'), 'signin');
  assert.equal(getPageType('https://www.target.com/signin'), 'signin');
  assert.equal(getPageType('https://www.target.com/account/login'), 'signin');
  assert.equal(getPageType('https://www.target.com/account/signin'), 'signin');

  // Other
  assert.equal(getPageType('https://www.target.com/'), 'other');
  assert.equal(getPageType('https://www.target.com/c/electronics'), 'other');
  assert.equal(getPageType('not-a-url'), 'other');
});

// ─── R05: TCIN + Walmart item ID extraction ─────────────────────────────────

await test('TCIN + Walmart ID extraction — all URL formats', () => {
  // Target uses /A-XXXXXXXX in the URL for product TCINs (8 digits typical)
  function extractTcin(url) {
    try {
      const u = new URL(url);
      // Match exactly 7-9 digits after /A- (real Target TCINs)
      const m = u.pathname.match(/\/A-(\d{7,9})(?:$|[/?#])/);
      if (m?.[1]) return m[1];
      const q = u.searchParams.get('tcin');
      if (q && /^\d{7,9}$/.test(q)) return q;
      return null;
    } catch { return null; }
  }

  function extractWalmartItemId(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/ip\/[^/]+\/(\d+)/);
      return m?.[1] || null;
    } catch { return null; }
  }

  // Target TCIN from product URL (8 digits)
  assert.equal(extractTcin('https://www.target.com/p/some-product/-/A-12345678'), '12345678');
  assert.equal(extractTcin('https://www.target.com/p/item/-/A-87654321#reviews'), '87654321');
  assert.equal(extractTcin('https://www.target.com/p/item/-/A-87654321?preselect=87654321'), '87654321');

  // TCIN from query param
  assert.equal(extractTcin('https://www.target.com/checkout?tcin=12345678'), '12345678');

  // No TCIN
  assert.equal(extractTcin('https://www.target.com/'), null);
  assert.equal(extractTcin('https://www.target.com/c/electronics'), null);

  // TCIN too short (5 digits) or too long (11 digits)
  assert.equal(extractTcin('https://www.target.com/p/-/A-12345'), null);
  assert.equal(extractTcin('https://www.target.com/p/-/A-12345678901'), null);

  // Walmart item ID
  assert.equal(extractWalmartItemId('https://www.walmart.com/ip/Pokemon-TCG/123456789'), '123456789');
  assert.equal(extractWalmartItemId('https://www.walmart.com/ip/some-product-name/987654321'), '987654321');

  // Not Walmart
  assert.equal(extractWalmartItemId('https://www.target.com/p/-/A-12345'), null);
  assert.equal(extractWalmartItemId('https://www.walmart.com/cart'), null);
});

// ─── R06: Gmail OTP extraction ──────────────────────────────────────────────

await test('Gmail OTP extraction — base64 decode + HTML email body parsing', () => {
  function decodeB64(s) {
    try {
      return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    } catch { return ''; }
  }

  function extractOtpFromGmailBody(payload) {
    let body = '';
    if (payload.body?.data) {
      body = decodeB64(payload.body.data);
    } else {
      const parts = payload.parts || [];
      for (const p of parts) {
        if (p.body?.data) body += decodeB64(p.body.data);
        for (const sp of (p.parts || [])) {
          if (sp.body?.data) body += decodeB64(sp.body.data);
        }
      }
    }
    const match = body.match(/\b(\d{6})\b/);
    return match ? match[1] : null;
  }

  // Simple body with base64 encoded OTP
  const encoded = Buffer.from('Your Target verification code is 483927').toString('base64');
  assert.equal(extractOtpFromGmailBody({ body: { data: encoded } }), '483927');

  // URL-safe base64 (- and _ chars)
  const urlSafe = Buffer.from('Code: 192837').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(extractOtpFromGmailBody({ body: { data: urlSafe } }), '192837');

  // Multipart email
  const part1 = Buffer.from('No code here').toString('base64');
  const part2 = Buffer.from('Your code: 847291').toString('base64');
  assert.equal(extractOtpFromGmailBody({
    parts: [
      { body: { data: part1 } },
      { body: { data: part2 } },
    ],
  }), '847291');

  // Nested multipart
  const nested = Buffer.from('Enter 928374 to verify').toString('base64');
  assert.equal(extractOtpFromGmailBody({
    parts: [
      { body: {}, parts: [{ body: { data: nested } }] },
    ],
  }), '928374');

  // No OTP
  const noCode = Buffer.from('Thank you for shopping at Target').toString('base64');
  assert.equal(extractOtpFromGmailBody({ body: { data: noCode } }), null);

  // Empty payload
  assert.equal(extractOtpFromGmailBody({}), null);
});

// ─── R07: NTP offset calculation ────────────────────────────────────────────

await test('NTP offset calculation — RTT compensation correctness', () => {
  function calculateNtpOffset(localBefore, localAfter, serverTimeMs) {
    const rtt = localAfter - localBefore;
    const estimatedServerTime = serverTimeMs + rtt / 2;
    return estimatedServerTime - localAfter;
  }

  // Perfect sync (server == local)
  assert.equal(calculateNtpOffset(1000, 1100, 1050), 0);

  // Server 500ms ahead
  const offset1 = calculateNtpOffset(1000, 1100, 1550);
  assert.equal(offset1, 500);

  // Server 200ms behind
  const offset2 = calculateNtpOffset(1000, 1100, 850);
  assert.equal(offset2, -200);

  // High RTT (500ms round trip)
  const offset3 = calculateNtpOffset(1000, 1500, 1250);
  assert.equal(offset3, 0, 'High RTT compensated correctly');

  // adjustedNow should apply offset
  function adjustedNow(offset) {
    return Date.now() + offset;
  }
  const now = Date.now();
  const adjusted = adjustedNow(500);
  assert.ok(adjusted >= now + 499 && adjusted <= now + 502, 'adjustedNow adds offset');
});

// ─── R08: Discord embed formatting ──────────────────────────────────────────

await test('Discord embed formatting — structure, truncation, required fields', () => {
  function buildEmbed(opts) {
    return {
      embeds: [{
        title: opts.title,
        description: opts.description,
        color: opts.color ?? 0xef4444,
        fields: opts.fields ?? [],
        footer: opts.footer ? { text: opts.footer } : undefined,
        timestamp: new Date().toISOString(),
      }],
    };
  }

  // Success webhook
  const success = buildEmbed({
    title: 'Checkout Success',
    color: 0x22c55e,
    fields: [
      { name: 'Task', value: 'Task 1', inline: true },
      { name: 'TCIN', value: '12345678', inline: true },
      { name: 'Speed', value: '2.34s', inline: true },
    ],
    footer: 'BEATBOTS',
  });
  assert.equal(success.embeds.length, 1);
  assert.equal(success.embeds[0].title, 'Checkout Success');
  assert.equal(success.embeds[0].color, 0x22c55e);
  assert.equal(success.embeds[0].fields.length, 3);
  assert.equal(success.embeds[0].footer.text, 'BEATBOTS');
  assert.ok(success.embeds[0].timestamp);

  // Shape block webhook
  const shape = buildEmbed({
    title: 'Shape Block',
    color: 0xf59e0b,
    description: 'Task "Drop Hunter" hit a Shape block.',
  });
  assert.equal(shape.embeds[0].color, 0xf59e0b);
  assert.ok(shape.embeds[0].description.includes('Shape block'));

  // No footer → undefined
  const noFooter = buildEmbed({ title: 'Test' });
  assert.equal(noFooter.embeds[0].footer, undefined);

  // Extension webhook truncation logic
  function buildExtensionEmbed(opts) {
    return {
      title: String(opts.title || 'TCH').slice(0, 256),
      description: opts.description ? String(opts.description).slice(0, 2048) : undefined,
      fields: (opts.fields || []).map(f => ({
        name: String(f.name || '').slice(0, 256),
        value: String(f.value || '—').slice(0, 1024),
        inline: !!f.inline,
      })),
    };
  }

  // Long title truncated
  const longTitle = buildExtensionEmbed({ title: 'A'.repeat(500) });
  assert.equal(longTitle.title.length, 256);

  // Long description truncated
  const longDesc = buildExtensionEmbed({ title: 'T', description: 'B'.repeat(3000) });
  assert.equal(longDesc.description.length, 2048);

  // Long field value truncated
  const longField = buildExtensionEmbed({
    title: 'T',
    fields: [{ name: 'N'.repeat(300), value: 'V'.repeat(2000) }],
  });
  assert.equal(longField.fields[0].name.length, 256);
  assert.equal(longField.fields[0].value.length, 1024);
});

// ─── R09: Checkout step detection ───────────────────────────────────────────

await test('Checkout step detection — all Target checkout phases', () => {
  function isInCheckoutFlow(url) {
    if (!url) return false;
    try {
      const path = new URL(url).pathname;
      return /^\/(cart|checkout|thankyou|thank-you|order-confirm)/i.test(path);
    } catch { return false; }
  }

  assert.ok(isInCheckoutFlow('https://www.target.com/checkout'));
  assert.ok(isInCheckoutFlow('https://www.target.com/checkout?step=shipping'));
  assert.ok(isInCheckoutFlow('https://www.target.com/cart'));
  assert.ok(isInCheckoutFlow('https://www.target.com/thankyou'));
  assert.ok(isInCheckoutFlow('https://www.target.com/thank-you'));
  assert.ok(isInCheckoutFlow('https://www.target.com/order-confirm'));
  assert.ok(!isInCheckoutFlow('https://www.target.com/p/product/-/A-123'));
  assert.ok(!isInCheckoutFlow('https://www.target.com/'));
  assert.ok(!isInCheckoutFlow(null));
  assert.ok(!isInCheckoutFlow(''));
  assert.ok(!isInCheckoutFlow('not-a-url'));

  // Stock status parsing should treat these as "do not navigate"
  function stockEntryMeansAvailable(entry) {
    if (entry == null) return false;
    if (typeof entry === 'boolean') return entry === true;
    if (typeof entry === 'object' && 'stock' in entry) return entry.stock === true;
    return false;
  }

  assert.ok(stockEntryMeansAvailable({ stock: true, qty: 10 }));
  assert.ok(stockEntryMeansAvailable(true));
  assert.ok(!stockEntryMeansAvailable({ stock: false, qty: 0 }));
  assert.ok(!stockEntryMeansAvailable({ stock: null, qty: 0 }));
  assert.ok(!stockEntryMeansAvailable(null));
  assert.ok(!stockEntryMeansAvailable(false));
  assert.ok(!stockEntryMeansAvailable(undefined));
});

// ─── R10: PX cookie preservation ────────────────────────────────────────────

await test('PX cookie preservation — filter regex matches PerimeterX cookies', () => {
  const PX_RE = /^_?px|^pxcts/i;

  const cookies = [
    { name: '_pxvid', value: 'abc123' },
    { name: 'pxcts', value: 'def456' },
    { name: '_px3', value: 'ghi789' },
    { name: 'PX_COOKIE', value: 'jkl012' },
    { name: 'visitorId', value: 'AAA' },
    { name: '_abck', value: 'BBB' },
    { name: 'bm_sz', value: 'CCC' },
    { name: 'TealeafAkaSid', value: 'DDD' },
  ];

  const pxCookies = cookies.filter(c => PX_RE.test(c.name));
  assert.equal(pxCookies.length, 4, 'Should find 4 PX cookies');
  assert.ok(pxCookies.some(c => c.name === '_pxvid'));
  assert.ok(pxCookies.some(c => c.name === 'pxcts'));
  assert.ok(pxCookies.some(c => c.name === '_px3'));
  assert.ok(pxCookies.some(c => c.name === 'PX_COOKIE'));

  // Non-PX cookies should NOT match
  assert.ok(!PX_RE.test('_abck'));
  assert.ok(!PX_RE.test('bm_sz'));
  assert.ok(!PX_RE.test('visitorId'));
  assert.ok(!PX_RE.test('TealeafAkaSid'));
});

// ─── R11: Walmart patterns ──────────────────────────────────────────────────

await test('Walmart — Queue-it detection + price extraction', () => {
  // Queue-it detection from WebSocket messages
  function detectQueuePassed(wsMessage) {
    try {
      const data = JSON.parse(wsMessage);
      if (data?.d?.eventId === 'queue-it' && data?.d?.payload?.status === 'passed') return true;
      if (String(data?.type || '').includes('QUEUE_PASSED')) return true;
    } catch {}
    return false;
  }

  assert.ok(detectQueuePassed(JSON.stringify({
    d: { eventId: 'queue-it', payload: { status: 'passed' } }
  })));
  assert.ok(detectQueuePassed(JSON.stringify({ type: 'QUEUE_PASSED' })));
  assert.ok(!detectQueuePassed(JSON.stringify({ d: { eventId: 'queue-it', payload: { status: 'waiting' } } })));
  assert.ok(!detectQueuePassed('not json'));

  // Walmart stock status parsing
  const SELLABLE_STATUSES = new Set([
    'IN_STOCK', 'LIMITED_STOCK', 'PRE_ORDER_SELLABLE',
    'BACKORDER_AVAILABLE', 'BACKORDERED', 'AVAILABLE',
  ]);

  function parseWalmartStock(json) {
    const status = json?.product?.productAvailability?.availabilityStatus;
    if (!status) return null;
    const qty = Number(json?.product?.productAvailability?.inventoryAvailableQuantity ?? 0);
    const price = json?.product?.priceInfo?.currentPrice?.price ?? null;
    return {
      stock: SELLABLE_STATUSES.has(status),
      qty: Number.isFinite(qty) && qty >= 0 ? qty : 0,
      price: typeof price === 'number' ? price : null,
    };
  }

  assert.deepEqual(parseWalmartStock({
    product: {
      productAvailability: { availabilityStatus: 'IN_STOCK', inventoryAvailableQuantity: 50 },
      priceInfo: { currentPrice: { price: 19.99 } },
    },
  }), { stock: true, qty: 50, price: 19.99 });

  assert.deepEqual(parseWalmartStock({
    product: {
      productAvailability: { availabilityStatus: 'OUT_OF_STOCK', inventoryAvailableQuantity: 0 },
      priceInfo: { currentPrice: { price: 29.99 } },
    },
  }), { stock: false, qty: 0, price: 29.99 });

  assert.equal(parseWalmartStock({}), null);
  assert.equal(parseWalmartStock({ product: {} }), null);
});

// ─── R12: Address jig integration ────────────────────────────────────────────

await test('Address jig — sequential uniqueness + negative index disables', () => {
  const JIG_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

  function jigAddress(address1, jigIndex) {
    if (jigIndex < 0) return address1;
    const char = JIG_CHARS[Math.abs(jigIndex) % JIG_CHARS.length];
    const m = address1.match(/^(\d+)(.*)$/);
    if (m) return `${m[1]}${char}${m[2]}`;
    return address1 + char;
  }

  // Negative index → no jig (disabled)
  assert.equal(jigAddress('123 Main St', -1), '123 Main St');
  assert.equal(jigAddress('456 Oak Ave', -99), '456 Oak Ave');

  // Sequential jig produces unique addresses
  const address = '123 Main St';
  const jigged = new Set();
  for (let i = 0; i < JIG_CHARS.length; i++) {
    jigged.add(jigAddress(address, i));
  }
  assert.equal(jigged.size, JIG_CHARS.length, `All ${JIG_CHARS.length} jig variants are unique`);

  // Wraps around correctly
  assert.equal(jigAddress(address, 0), jigAddress(address, JIG_CHARS.length));
  assert.equal(jigAddress(address, 1), jigAddress(address, JIG_CHARS.length + 1));

  // No street number → appends
  assert.equal(jigAddress('PO Box 100', 0), 'PO Box 100A');
  assert.equal(jigAddress('Suite 200', 0), 'Suite 200A');

  // Verify jig characters exclude easily confused letters (I, O, Q)
  assert.ok(!JIG_CHARS.includes('I'), 'No I (confused with 1)');
  assert.ok(!JIG_CHARS.includes('O'), 'No O (confused with 0)');
  assert.ok(!JIG_CHARS.includes('Q'), 'No Q (confused with O)');
});

// ─── Report ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log(`  UNTESTED AREAS — PENETRATION TEST REPORT`);
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
