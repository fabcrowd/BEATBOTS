// walmart-content.js — Walmart Checkout Helper
// Injected into *.walmart.com pages. Standalone — no dependency on content.js.
// Handles: product ATC → cart → queue wait → shipping → payment → review.

// ─── SELECTORS ───────────────────────────────────────────────────────────────

const WM_SEL = {
  // Product page — comma chain = first match wins (querySelector)
  atc:
    '[data-automation-id="add-to-cart-btn"], button[data-automation-id="atc-button"], button[data-tl-id="ProductPrimaryCTA-cta_add_to_cart_button"]',
  atcAlt:       'button[class*="AddToCartButton"], button[class*="add-to-cart"]',
  atcFallback:  '#add-on-atc-container button',
  /** Secondary signal that product-page queue cleared (walmart_pokemon parity). */
  queueHoldSpot: 'button[data-automation-id="queue-hold-spot-btn"]',
  // Price — __NEXT_DATA__ preferred (see wmGetCurrentPrice); DOM fallbacks below
  price:        '[itemprop="price"], [data-automation-id="product-price"], [class*="price-characteristic"]',
  // Post-ATC modal / mini-cart
  viewCart:     'a[href="/cart"][data-automation-id], button[data-automation-id="go-to-cart-btn"]',
  // Cart page
  checkout:     '[data-automation-id="checkout-btn"], a[href^="/checkout"]',
  // Checkout navigation
  continueBtn:  'button[data-automation-id="continue-btn"]',
  placeOrder:   '[data-automation-id="place-order-btn"]',
  // Shipping fields
  firstName:    'input[name="firstName"], input[autocomplete="given-name"]',
  lastName:     'input[name="lastName"], input[autocomplete="family-name"]',
  address1:     'input[name="addressLineOne"], input[autocomplete="address-line1"]',
  address2:     'input[name="addressLineTwo"], input[autocomplete="address-line2"]',
  city:         'input[name="city"], input[autocomplete="address-level2"]',
  state:        'select[name="state"], input[name="state"], input[autocomplete="address-level1"]',
  zip:          'input[name="postalCode"], input[name="zipCode"], input[autocomplete="postal-code"]',
  phone:        'input[name="phone"], input[autocomplete="tel"]',
  // Payment fields
  cardNumber:   'input[id="creditCard"], input[name="cardNumber"], input[id*="card-number"], input[autocomplete="cc-number"]',
  expiry:       'input[name="expirationDate"], input[placeholder*="MM/YY"], input[placeholder*="MM / YY"]',
  expMonth:     'select[id="month-chooser"], select[name="month"], input[name="expiryMonth"], input[id*="exp-month"]',
  expYear:      'select[id="year-chooser"], select[name="year"], input[name="expiryYear"], input[id*="exp-year"]',
  cvv:          'input[id="cvv"], input[name="cvvNumber"], input[name="cvv"], input[autocomplete="cc-csc"]',
  // Billing address (Walmart validates billing zip matches card)
  billingFirstName: 'input[id="billingFirstName"], input[name="billingFirstName"]',
  billingLastName:  'input[id="billingLastName"], input[name="billingLastName"]',
  billingAddress1:  'input[id="billingAddressLineOne"], input[name="billingAddressLine1"], input[name="billingAddress1"]',
  billingCity:      'input[id="billingCity"], input[name="billingCity"]',
  billingState:     'select[id="billingState"], select[name="billingState"]',
  billingZip:       'input[id="billingPostalCode"], input[name="billingPostalCode"], input[name="billingZip"]',
};

// ─── SETTINGS CACHE ──────────────────────────────────────────────────────────

let wmSettingsCache = null;

async function wmGetSettings() {
  if (!wmSettingsCache) {
    wmSettingsCache = await chrome.storage.local.get([
      'enabled',
      'shipping',
      'payment',
      'monitor',
      'retryPolicy',
      'useSavedPayment',
      'autoPlaceOrder',
      'walmartMaxPrice',
      'walmartSkipMonitoring',
      'walmartAtcOnly',
      'walmartUseSavedSession',
      'shippingJig',
      'jigIndex',
      'checkoutSound',
      'imap2faEnabled',
      'imapProfile',
    ]).catch(() => ({}));
  }
  return wmSettingsCache;
}

function wmInvalidateCache() { wmSettingsCache = null; }

// ─── UTILITIES ───────────────────────────────────────────────────────────────

const wmNativeInputSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
).set;

function wmFillInput(input, value) {
  wmNativeInputSetter.call(input, value);
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function wmFillSelect(select, value) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const wmSleep = (ms) => new Promise(r => setTimeout(r, ms));

function wmPlayBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.9);
  } catch (_) {}
}

/** Tell background monitor to increment the ATC count for this product. Fire-and-forget. */
function wmSignalAtcSuccess(productUrl) {
  const url = productUrl || location.href;
  try { chrome.runtime.sendMessage({ type: 'ATC_SUCCESS', url }); } catch (_) {}
}

/** Same telemetry path as Target review — drives Discord webhooks + endless mode. */
async function wmReportCheckoutSuccess() {
  try {
    await chrome.runtime.sendMessage({
      type: 'CHECKOUT_RETRY_EVENT',
      event: {
        status: 'success',
        failedAttempts: 0,
        mode: 'walmart',
        page: 'review',
        url: location.href,
        ts: Date.now(),
      },
    });
  } catch (_) {}
}

function wmFindFirst(...selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

function wmFindByText(text) {
  const lower = text.toLowerCase();
  return Array.from(document.querySelectorAll('a, button')).find(
    el => el.textContent.trim().toLowerCase().includes(lower)
  ) || null;
}

/** ATC / queue-hold primary controls — keep all paths in sync when Walmart rotates markup. */
function wmFindAtcLikeButton() {
  return (
    document.querySelector(WM_SEL.atc) ||
    document.querySelector(WM_SEL.atcAlt) ||
    document.querySelector(WM_SEL.queueHoldSpot) ||
    document.querySelector(WM_SEL.atcFallback) ||
    wmFindByText('add to cart')
  );
}

function wmIsVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none') return false;
  return true;
}

/**
 * @param {boolean} [liveOnly=false] Skip __NEXT_DATA__ and read DOM only.
 *   Use this inside polling loops: __NEXT_DATA__ is frozen at page load and will
 *   NOT reflect the drop price when Walmart flips it via React re-render at go-time.
 */
function wmGetCurrentPrice(liveOnly = false) {
  if (!liveOnly) {
    try {
      const nd = window.__NEXT_DATA__;
      const p = nd?.props?.pageProps?.initialData?.data?.product?.priceInfo?.currentPrice?.price;
      if (typeof p === 'number' && p > 0) return p;
    } catch (_) {}
  }

  for (const sel of WM_SEL.price.split(', ')) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      const content = el.getAttribute('content');
      if (content) {
        const n = parseFloat(content);
        if (!isNaN(n)) return n;
      }
      const text = el.textContent.replace(/[^0-9.]/g, '');
      if (text) {
        const n = parseFloat(text);
        if (!isNaN(n)) return n;
      }
    } catch (_) {}
  }
  return null;
}

function wmShowToast(message, type = 'info') {
  const existing = document.getElementById('wmt-toast');
  if (existing) existing.remove();
  const colors = { info: '#0071ce', success: '#1a7340', error: '#333', persistent: '#0071ce' };
  const toast = document.createElement('div');
  toast.id = 'wmt-toast';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', right: '24px',
    background: colors[type] || colors.info, color: 'white',
    padding: '12px 18px', borderRadius: '8px',
    fontFamily: '-apple-system, sans-serif', fontSize: '13px', fontWeight: '600',
    zIndex: '2147483647', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    lineHeight: '1.4', maxWidth: '320px',
  });
  toast.textContent = '🛒 ' + message;
  document.body.appendChild(toast);
  if (type !== 'persistent') {
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}

/** Polls selectorFn every 100ms until it returns a truthy value, or timeout. */
async function wmWaitFor(selectorFn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = selectorFn();
    if (result) return result;
    await wmSleep(100);
  }
  return null;
}

/** Click via the debugger bridge (human-like). Falls back to .click(). */
async function wmDebuggerClick(el) {
  if (!el) return;
  try {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top  + r.height / 2);
    const res = await chrome.runtime.sendMessage({ type: 'DEBUGGER_CLICK', x, y });
    if (res?.ok) return;
  } catch (_) {}
  el.click();
}

// ─── PAGE TYPE DETECTION ─────────────────────────────────────────────────────

/** Generic queue/waiting-room indicator — works on both product page and /checkout. */
function wmHasQueueIndicators() {
  // /qp is Walmart's white-labeled Queue-it waiting room URL
  if (location.pathname.startsWith('/qp')) return true;
  const text = (document.body?.innerText || '').toLowerCase();
  // Use specific contiguous phrases only — "queue" && "wait" individually are too
  // common in checkout SPA internals and would false-positive into wmHandleQueue.
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
    !!document.querySelector('[class*="QueuePage"], [data-automation-id*="queue-room"]')
  );
}

/** Legacy alias — used for checkout-path queue detection. */
function wmIsQueuePage() { return wmHasQueueIndicators(); }

/**
 * True if we're on the product page and the ATC button is present but
 * disabled — the classic Walmart drop queue state.
 */
function wmIsProductQueued() {
  const atc = wmFindAtcLikeButton();
  if (!atc) return false;
  return atc.disabled || atc.getAttribute('aria-disabled') === 'true';
}

/**
 * Detects Walmart's PerimeterX / bot-check loading page.
 * Shows as "Hang tight! We're loading your experience." or similar.
 * This page auto-redirects — we must wait, not retry.
 */
function wmIsPxPage() {
  const text = (document.body?.innerText || '').toLowerCase();
  return (
    (text.includes('hang tight') && text.includes('loading')) ||
    text.includes("we're loading your experience") ||
    !!document.querySelector('#px-captcha, [class*="px-block"], [id*="px-captcha"]')
  );
}

function wmGetPageType() {
  const path = location.pathname;
  if (/^\/ip\//.test(path))           return 'product';
  if (/^\/cart/.test(path))           return 'cart';
  if (/^\/qp/.test(path))             return 'queue-room';
  if (/^\/checkout/.test(path)) {
    if (wmIsQueuePage())              return 'queue';
    if (document.querySelector(WM_SEL.placeOrder) ||
        wmFindByText('place order'))  return 'review';
    return 'checkout'; // shipping or payment step
  }
  if (/\/(thankyou|thank-you|order-confirm)/i.test(path)) return 'confirmation';
  return 'unknown';
}

// ─── DIRECT ATC (OID PATH) ───────────────────────────────────────────────────

/**
 * Attempt to add the item to cart directly via Walmart's internal API using the
 * Offer ID (OID). This skips the product page DOM entirely — faster than clicking
 * the ATC button, which means an earlier checkout endpoint hit and better queue
 * position on timed drops.
 *
 * Falls back silently if the API call fails so the DOM path can take over.
 *
 * @param {string} oid  Walmart Offer ID (hex string)
 * @returns {Promise<boolean>}  true if item was added and we navigated to checkout
 */
/**
 * @param {string} oid
 * @param {object} settings
 * @param {object} [opts]
 * @param {number} [opts.rapidRetryMs=0]  If >0, retry every 200ms including on 4xx
 *   until this many ms have elapsed. Use for skip-monitoring mode where the item
 *   may go live any moment and a 4xx just means "not yet".
 */
async function wmDirectAtc(oid, settings, opts = {}) {
  const { rapidRetryMs = 0 } = opts;
  wmShowToast('Direct ATC via OID…', 'persistent');
  console.log('[WMT] Direct ATC — OID:', oid, rapidRetryMs > 0 ? `rapid ${rapidRetryMs}ms` : 'single');

  // Extract customer ID (CID) required by the v3 cart API.
  // Walmart embeds it in __NEXT_DATA__.props.pageProps.customerId and also in
  // the vidUserId cookie for guest sessions.
  const cid = (() => {
    try {
      const nd = window.__NEXT_DATA__;
      return nd?.props?.pageProps?.customerId || null;
    } catch { return null; }
  })() || (() => {
    const m = document.cookie.match(/(?:^|;\s*)vidUserId=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  })();

  if (!cid) {
    console.warn('[WMT] wmDirectAtc: no CID found — falling back to DOM');
    return false;
  }

  const s = settings?.shipping || {};
  const url = `https://www.walmart.com/api/v3/cart/guest/${cid}/items`;
  const body = {
    offerId: oid,
    quantity: 1,
    location: {
      isZipLocated: !!(s.zip),
      storeId: '5260',
      zipCode: s.zip || '10001',
      stateCode: s.state || 'NY',
      city: s.city || 'New York',
    },
    shipMethodDefaultRule: 'SHIP_RULE_1',
  };

  const deadline = Date.now() + (rapidRetryMs > 0 ? rapidRetryMs : 0);
  let attempt = 0;

  do {
    attempt++;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'wm_offer_id': oid,
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          'Referer': 'https://www.walmart.com/',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      console.warn('[WMT] Direct ATC network error (attempt', attempt, '):', e.message);
      await wmSleep(200);
      continue;
    }

    console.log('[WMT] Direct ATC response:', res.status, 'attempt', attempt);
    if (res.ok) {
      wmShowToast('OID cart add succeeded — going to checkout…', 'success');
      wmSignalAtcSuccess(null);
      await wmSleep(300);
      window.location.href = 'https://www.walmart.com/checkout';
      return true;
    }

    if (rapidRetryMs === 0) {
      // Single-attempt mode: any HTTP error means fall through to DOM path.
      console.warn('[WMT] Direct ATC HTTP', res.status, '— falling back to DOM');
      break;
    }

    // Rapid mode: 4xx/5xx = item not live yet. Retry in 200ms.
    if (attempt % 10 === 0) {
      wmShowToast(`Direct ATC retry #${attempt} (HTTP ${res.status})…`, 'persistent');
    }
    await wmSleep(200);
  } while (Date.now() < deadline);

  console.warn('[WMT] Direct ATC failed — falling back to DOM');
  return false;
}

// ─── CHECKOUT HANDLERS ───────────────────────────────────────────────────────

/**
 * Walmart drop queue — runs while waiting on the PRODUCT PAGE for ATC to enable.
 *
 * During Walmart Wednesday drops the queue appears on /ip/... itself:
 *   • The ATC button is disabled (your queue ticket is "pending")
 *   • When your position clears (ticket → "valid"), ATC becomes enabled
 *   • You MUST stay on the product page — navigating away loses your spot
 *
 * We send WALMART_IN_QUEUE immediately so background.js stops touching the tab,
 * then poll every second until ATC becomes clickable.
 */
async function wmWaitInProductQueue(settings, oid) {
  wmShowToast('In queue — waiting for your turn…', 'persistent');
  console.log('[WMT] Product-page queue detected — passive wait, DO NOT navigate');

  // Lock the tab in background poll so it doesn't re-navigate while we wait.
  try { chrome.runtime.sendMessage({ type: 'WALMART_IN_QUEUE', url: location.href }); } catch (_) {}

  const maxWaitMs = 45 * 60 * 1000;
  const started = Date.now();
  let queuePassedSignal = false;
  const onQueuePassed = () => { queuePassedSignal = true; };
  const docEl = document.documentElement;
  docEl.addEventListener('TCH_QUEUE_PASSED', onQueuePassed);

  try {
  while (Date.now() - started < maxWaitMs) {
    if (!queuePassedSignal) await wmSleep(1000);

    // Price guard — use DOM-only (liveOnly=true): __NEXT_DATA__ is frozen at
    // page load and won't update when Walmart flips the drop price at go-time.
    const maxPrice = parseFloat(settings.walmartMaxPrice) || 0;
    if (maxPrice > 0) {
      const currentPrice = wmGetCurrentPrice(true);
      if (currentPrice !== null && currentPrice > maxPrice) {
        // Don't consume the signal — we may have already passed the queue but
        // price is still above limit. Retry next tick with signal intact.
        queuePassedSignal = false;
        continue;
      }
    }

    // Signal consumed only when we proceed to ATC check.
    queuePassedSignal = false;

    // Check if ATC has become enabled (our turn in queue)
    const btn = wmFindAtcLikeButton();

    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && wmIsVisible(btn)) {
      wmShowToast('Your turn! Adding to cart…', 'success');
      console.log('[WMT] Queue cleared — ATC button is now enabled');

      // Try OID fast path now that queue has cleared
      if (oid) {
        const ok = await wmDirectAtc(oid, settings);
        if (ok) return;
      }

      await wmSleep(200);
      await wmDebuggerClick(btn);
      wmSignalAtcSuccess(settings.productUrl || location.href);
      await wmSleep(1500);

      // Navigate to cart
      const cartLink =
        document.querySelector(WM_SEL.viewCart) ||
        wmFindByText('view cart') ||
        wmFindByText('go to cart') ||
        wmFindByText('cart');
      if (cartLink && wmIsVisible(cartLink)) {
        cartLink.click();
      } else {
        window.location.href = 'https://www.walmart.com/cart';
      }
      return;
    }

    const elapsed = Math.round((Date.now() - started) / 1000);
    if (elapsed > 0 && elapsed % 30 === 0) {
      wmShowToast(`In queue — ${elapsed}s elapsed…`, 'persistent');
    }
  }

  wmShowToast('Queue wait exceeded 45 min — take over manually', 'error');
  console.warn('[WMT] Product-page queue wait timed out after 45 min');
  } finally {
    docEl.removeEventListener('TCH_QUEUE_PASSED', onQueuePassed);
  }
}

/**
 * Handles Walmart's /qp waiting room page (white-labeled Queue-it).
 * The queue auto-redirects to /checkout when the user's position clears —
 * we must stay on the page and wait, not navigate or reload.
 */
async function wmHandleQueueRoom(settings) {
  wmShowToast('In Walmart waiting room — holding your spot…', 'persistent');
  console.log('[WMT] /qp waiting room detected — passive hold, DO NOT navigate');

  // Lock MUST use the product URL (/ip/.../itemId) — the poll loop keys inQueueUrls
  // by normalized product URL. Using location.href (/qp?...) would normalize to /qp
  // and never match, leaving the tab unprotected from background re-navigation.
  const lockUrl = settings?.productUrl;
  if (lockUrl) {
    try { chrome.runtime.sendMessage({ type: 'WALMART_IN_QUEUE', url: lockUrl }); } catch (_) {}
  } else {
    console.warn('[WMT] wmHandleQueueRoom: no productUrl in settings — background nav lock NOT set');
  }

  const maxWaitMs = 45 * 60 * 1000;
  const started = Date.now();

  while (Date.now() - started < maxWaitMs) {
    await wmSleep(5000);
    // When the waiting room clears, Walmart redirects away from /qp automatically.
    // The SPA watcher fires wmInit() on URL change — no extra action needed here.
    if (!location.pathname.startsWith('/qp')) return;
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (elapsed > 0 && elapsed % 60 === 0) {
      wmShowToast(`Waiting room — ${Math.round(elapsed / 60)}m elapsed…`, 'persistent');
    }
  }

  wmShowToast('Waiting room exceeded 45 min — take over manually', 'error');
  console.warn('[WMT] /qp waiting room timeout after 45 min');
}

async function wmHandleProductPage(settings, oid) {
  // ── Price guard ─────────────────────────────────────────────────────────────
  // Walmart drops are often listed at high MSRP before go-time; real drop price
  // appears at the drop moment. If price > max, enter queue wait below so we're
  // still holding our position when the price drops.
  const maxPrice = parseFloat(settings.walmartMaxPrice) || 0;
  if (maxPrice > 0) {
    const currentPrice = wmGetCurrentPrice();
    if (currentPrice !== null && currentPrice > maxPrice) {
      wmShowToast(`Price $${currentPrice.toFixed(2)} > max $${maxPrice.toFixed(2)} — holding position`, 'persistent');
      console.log(`[WMT] Price guard: $${currentPrice} > max $${maxPrice} — entering queue wait`);
      // Don't ATC yet, but DO hold position via queue wait (handles both queue + pre-drop price)
      await wmWaitInProductQueue(settings, oid);
      return;
    }
  }

  // ── Check for product-page queue ─────────────────────────────────────────
  // During drops, Walmart's queue appears on the /ip/... product page itself.
  // The ATC button exists but is disabled until your queue position clears.
  // Navigating away loses your spot — we must wait here.
  if (wmHasQueueIndicators() || wmIsProductQueued()) {
    await wmWaitInProductQueue(settings, oid);
    return;
  }

  // ── OID direct-API path ──────────────────────────────────────────────────
  // If an Offer ID is set, try the fast cart API path first. Faster than DOM
  // click = earlier checkout endpoint hit on drops without a queue.
  // In skip-monitoring mode the drop fires at a precise time — if we fire early
  // we'll get 4xx until the item goes live, so use rapid retry for up to 30s.
  if (oid) {
    const atcOpts = settings?.walmartSkipMonitoring ? { rapidRetryMs: 30000 } : {};
    const ok = await wmDirectAtc(oid, settings, atcOpts);
    if (ok) return;
    // API failed — fall through to DOM path
  }

  // ── Normal ATC (short wait) ───────────────────────────────────────────────
  // Wait up to 8s for ATC to appear and be enabled. If after 8s it's still
  // disabled, the queue may have just loaded — hand off to wmWaitInProductQueue.
  const atcBtn = await wmWaitFor(() => {
    const el = wmFindAtcLikeButton();
    if (el && !el.disabled && wmIsVisible(el)) return el;
    return null;
  }, 8000);

  if (!atcBtn) {
    // Re-check: did the queue load while we were waiting?
    if (wmHasQueueIndicators() || wmIsProductQueued()) {
      await wmWaitInProductQueue(settings, oid);
      return;
    }
    wmShowToast('ATC not available — waiting for restock', 'persistent');
    console.log('[WMT] ATC button not found or disabled — releasing navigation lock');
    try { chrome.runtime.sendMessage({ type: 'WALMART_NAV_FAILED', url: location.href }); } catch (_) {}
    return;
  }

  wmShowToast('Adding to cart…', 'persistent');
  console.log('[WMT] Clicking ATC button');
  await wmDebuggerClick(atcBtn);
  wmSignalAtcSuccess(settings.productUrl || location.href);
  await wmSleep(1500);

  const cartLink =
    document.querySelector(WM_SEL.viewCart) ||
    wmFindByText('view cart') ||
    wmFindByText('go to cart') ||
    wmFindByText('cart');
  if (cartLink && wmIsVisible(cartLink)) {
    cartLink.click();
  } else {
    console.log('[WMT] No cart link found after ATC — navigating directly to /cart');
    window.location.href = 'https://www.walmart.com/cart';
  }
}

async function wmHandleCart(settings) {
  // ATC-only mode: bot's job is done. Alert the user and stop here.
  if (settings.walmartAtcOnly) {
    wmShowToast('✅ ATC done — take over now! Checkout is yours.', 'persistent');
    console.log('[WMT] walmartAtcOnly — stopping at cart, handing off to user');
    if (settings.checkoutSound !== false) wmPlayBeep();
    return;
  }
  wmShowToast('In cart — proceeding to checkout…', 'persistent');
  const checkoutBtn = await wmWaitFor(() => {
    const primary = document.querySelector(WM_SEL.checkout);
    if (primary && wmIsVisible(primary)) return primary;
    // Restrict to <button> + exact text to avoid matching header nav <a> links.
    return Array.from(document.querySelectorAll('button')).find(el => {
      const text = el.textContent.trim().toLowerCase();
      return (text === 'checkout' || text === 'proceed to checkout') && wmIsVisible(el);
    }) || null;
  }, 8000);

  if (!checkoutBtn) {
    wmShowToast('Checkout button not found — take over manually', 'error');
    console.warn('[WMT] Checkout button not found on cart page');
    return;
  }
  console.log('[WMT] Clicking checkout button');
  await wmDebuggerClick(checkoutBtn);
}

async function wmHandleQueue(settings) {
  wmShowToast('In queue — waiting…', 'persistent');
  console.log('[WMT] Queue detected — passive wait started');

  // Send the monitored product URL (not location.href which is /checkout) so
  // background.js can match it against the normalised product URL in inQueueUrls.
  const lockUrl = settings.productUrl || location.href;
  try {
    chrome.runtime.sendMessage({ type: 'WALMART_IN_QUEUE', url: lockUrl });
  } catch (_) {}

  const maxWaitMs = 45 * 60 * 1000;
  const started = Date.now();

  while (Date.now() - started < maxWaitMs) {
    await wmSleep(2000);
    if (!wmIsQueuePage()) {
      console.log('[WMT] Queue cleared');
      wmShowToast('Queue cleared — continuing checkout', 'success');
      await wmSleep(500);
      await wmHandleCheckout(settings);
      return;
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (elapsed > 0 && elapsed % 30 === 0) {
      wmShowToast(`In queue — ${elapsed}s elapsed…`, 'persistent');
    }
  }
  wmShowToast('Queue wait exceeded 45 min — take over manually', 'error');
  console.warn('[WMT] Queue wait timed out after 45 min');
}

/**
 * Finds the checkout Continue button without matching nav/modal false-positives.
 * wmFindByText('continue') also matches "Continue Shopping", "Continue as Guest", etc.
 */
function wmFindContinueBtn() {
  const blockedRe = /shopping|as guest|browsing|cart|home/i;
  const primary = document.querySelector(WM_SEL.continueBtn);
  if (primary && wmIsVisible(primary)) return primary;
  return Array.from(document.querySelectorAll('a, button')).find(el => {
    const text = el.textContent.trim();
    if (!/continue|save & continue/i.test(text)) return false;
    if (blockedRe.test(text)) return false;
    return wmIsVisible(el);
  }) || null;
}

async function wmHandleShipping(settings) {
  const s = settings.shipping || {};
  console.log('[WMT] Filling shipping form');

  // Check if shipping form fields are present at all.
  const hasShippingForm = !!(
    document.querySelector(WM_SEL.firstName) ||
    document.querySelector(WM_SEL.address1)
  );

  if (!hasShippingForm) {
    // Saved address may already be selected — just continue.
    console.log('[WMT] No shipping form fields found — assuming saved address');
  } else {
    const jiRaw = settings.jigIndex;
    const jigIdx = typeof jiRaw === 'number' && Number.isFinite(jiRaw)
      ? jiRaw
      : parseInt(String(jiRaw ?? ''), 10);
    const wmEffectiveAddress1 =
      typeof jigAddressLine1 === 'function'
        ? jigAddressLine1(s.address1, Number.isFinite(jigIdx) ? jigIdx : 0, settings.shippingJig)
        : (() => {
            const wmJig = (settings.shippingJig || '').trim();
            return wmJig && s.address1 ? `${wmJig} ${s.address1}` : s.address1;
          })();
    const fieldMap = [
      [WM_SEL.firstName, s.firstName],
      [WM_SEL.lastName,  s.lastName],
      [WM_SEL.address1,  wmEffectiveAddress1],
      [WM_SEL.address2,  s.address2],
      [WM_SEL.city,      s.city],
      [WM_SEL.zip,       s.zip],
      [WM_SEL.phone,     s.phone],
    ];
    for (const [sel, value] of fieldMap) {
      if (!value) continue;
      const el = wmFindFirst(...sel.split(', '));
      if (el) wmFillInput(el, value);
    }
    if (s.state) {
      const stateEl = wmFindFirst(...WM_SEL.state.split(', '));
      if (stateEl) {
        if (stateEl.tagName === 'SELECT') wmFillSelect(stateEl, s.state);
        else wmFillInput(stateEl, s.state);
      }
    }
  }

  await wmSleep(400);
  const continueBtn = wmFindContinueBtn();
  if (continueBtn) {
    console.log('[WMT] Clicking Continue on shipping');
    await wmDebuggerClick(continueBtn);
  }
}

async function wmHandlePayment(settings) {
  if (settings.useSavedPayment) {
    console.log('[WMT] useSavedPayment — skipping card fill');
    const continueBtn = wmFindContinueBtn();
    if (continueBtn) {
      await wmSleep(300);
      await wmDebuggerClick(continueBtn);
    }
    return;
  }

  const p = settings.payment || {};
  console.log('[WMT] Filling payment form');

  if (p.cardNumber) {
    const el = wmFindFirst(...WM_SEL.cardNumber.split(', '));
    if (el) wmFillInput(el, p.cardNumber);
  }

  // Try combined MM/YY expiry first, then split month/year selects or inputs.
  const expCombined = wmFindFirst(...WM_SEL.expiry.split(', '));
  if (expCombined && p.expMonth && p.expYear) {
    const yr = p.expYear.length === 4 ? p.expYear.slice(-2) : p.expYear;
    wmFillInput(expCombined, `${p.expMonth}/${yr}`);
  } else {
    if (p.expMonth) {
      const el = wmFindFirst(...WM_SEL.expMonth.split(', '));
      if (el) {
        if (el.tagName === 'SELECT') wmFillSelect(el, p.expMonth);
        else wmFillInput(el, p.expMonth);
      }
    }
    if (p.expYear) {
      const el = wmFindFirst(...WM_SEL.expYear.split(', '));
      if (el) {
        if (el.tagName === 'SELECT') {
          // year-chooser options are typically 4-digit values
          const yr4 = p.expYear.length === 2 ? `20${p.expYear}` : p.expYear;
          wmFillSelect(el, yr4);
        } else {
          wmFillInput(el, p.expYear);
        }
      }
    }
  }

  if (p.cvv) {
    const el = wmFindFirst(...WM_SEL.cvv.split(', '));
    if (el) wmFillInput(el, p.cvv);
  }

  // Billing address — Walmart validates billing zip matches the card's billing zip.
  // Use payment.billingZip if set; fall back to shipping address fields for the rest.
  const s = settings.shipping || {};
  const billingMap = [
    [WM_SEL.billingFirstName, p.billingFirstName || s.firstName],
    [WM_SEL.billingLastName,  p.billingLastName  || s.lastName],
    [WM_SEL.billingAddress1,  p.billingAddress1  || s.address1],
    [WM_SEL.billingCity,      p.billingCity      || s.city],
    [WM_SEL.billingZip,       p.billingZip       || s.zip],
  ];
  for (const [sel, value] of billingMap) {
    if (!value) continue;
    const el = wmFindFirst(...sel.split(', '));
    if (el) wmFillInput(el, value);
  }
  if (p.billingState || s.state) {
    const el = wmFindFirst(...WM_SEL.billingState.split(', '));
    if (el) wmFillSelect(el, p.billingState || s.state);
  }

  await wmSleep(400);
  const continueBtn = wmFindContinueBtn();
  if (continueBtn) {
    console.log('[WMT] Clicking Continue on payment');
    await wmDebuggerClick(continueBtn);
  }
}

async function wmHandleReview(settings) {
  console.log('[WMT] Review reached');
  try {
    if (!sessionStorage.getItem('wm:checkoutTelemetrySent')) {
      sessionStorage.setItem('wm:checkoutTelemetrySent', '1');
      await wmReportCheckoutSuccess();
    }
  } catch (_) {}
  if (settings.checkoutSound !== false) wmPlayBeep();
  if (!settings.autoPlaceOrder) {
    wmShowToast('Reached review — Place Order remains manual', 'persistent');
    return;
  }
  const btn = document.querySelector(WM_SEL.placeOrder) || wmFindByText('place order');
  if (btn && wmIsVisible(btn)) {
    wmShowToast('Auto placing order…', 'success');
    console.log('[WMT] Auto-clicking Place Order');
    await wmDebuggerClick(btn);
  } else {
    wmShowToast('Place Order button not found — take over manually', 'error');
    console.warn('[WMT] Place Order button not found');
  }
}

function wmCheckoutHasShipping() {
  return !!(
    document.querySelector(WM_SEL.firstName) ||
    document.querySelector(WM_SEL.address1) ||
    document.querySelector(WM_SEL.zip)
  );
}

function wmCheckoutHasPayment() {
  return !!(
    document.querySelector(WM_SEL.cardNumber) ||
    document.querySelector(WM_SEL.cvv)
  );
}

function wmCheckoutHasReview() {
  return !!(document.querySelector(WM_SEL.placeOrder) || wmFindByText('place order'));
}

/**
 * Dispatches within /checkout across all SPA steps.
 *
 * Walmart checkout is a multi-step SPA on a single /checkout URL — the URL
 * does NOT change between shipping → payment → review. The MutationObserver
 * URL watcher therefore never fires between steps, so we must poll the DOM
 * ourselves after each Continue click until the next step appears.
 */
async function wmHandleCheckout(settings) {
  const stepTimeoutMs = 30 * 1000;
  // Timestamp-based cooldown — if Walmart shows a validation error and re-displays
  // a form, lastStep string dedup would lock up forever. Timestamps allow retry
  // after STEP_MIN_INTERVAL_MS so the form is re-filled after the error clears.
  const STEP_MIN_INTERVAL_MS = 5000;
  const stepHandledAt = {};
  const started = Date.now();

  while (Date.now() - started < 10 * 60 * 1000) {
    if (wmIsQueuePage()) {
      await wmHandleQueue(settings);
      return;
    }
    if (wmCheckoutHasReview()) {
      await wmHandleReview(settings);
      return;
    }

    const hasPayment  = wmCheckoutHasPayment();
    const hasShipping = wmCheckoutHasShipping();

    if (hasPayment && !hasShipping &&
        (Date.now() - (stepHandledAt.payment || 0)) > STEP_MIN_INTERVAL_MS) {
      stepHandledAt.payment = Date.now();
      wmShowToast('Filling payment…', 'persistent');
      await wmHandlePayment(settings);
      // Poll for next step (review) to appear.
      await wmWaitFor(wmCheckoutHasReview, stepTimeoutMs);
      continue;
    }

    if (hasShipping &&
        (Date.now() - (stepHandledAt.shipping || 0)) > STEP_MIN_INTERVAL_MS) {
      stepHandledAt.shipping = Date.now();
      wmShowToast('Filling shipping…', 'persistent');
      await wmHandleShipping(settings);
      // Poll for payment or review to appear after Continue.
      await wmWaitFor(() => wmCheckoutHasPayment() || wmCheckoutHasReview(), stepTimeoutMs);
      continue;
    }

    // No recognizable form yet — page still loading or transitioning.
    await wmSleep(500);
  }

  console.warn('[WMT] wmHandleCheckout timed out after 10 min');
}

// ─── WALMART LOGIN / 2FA (IMAP via native host) ────────────────────────────────

async function wmTryImap2FA(loginSettings) {
  const p = loginSettings.imapProfile || {};
  if (!loginSettings.imap2faEnabled || !p.host || !p.user || !p.password) return false;

  const input = document.querySelector(
    'input[id*="code"], input[name*="code"], input[id*="verification"], input[id*="otp"], input[autocomplete="one-time-code"], input[inputmode="numeric"]'
  );
  if (!input || !wmIsVisible(input)) return false;

  wmShowToast('Fetching verification code from email…', 'persistent');
  let res;
  try {
    res = await chrome.runtime.sendMessage({
      type: 'IMAP_NATIVE_CALL',
      payload: {
        cmd: 'readCode',
        host: p.host,
        port: Number(p.port) || 993,
        user: p.user,
        password: p.password,
        timeoutMs: 85000,
      },
    });
  } catch (_) {
    wmShowToast('IMAP request failed', 'error');
    return false;
  }

  if (!res?.ok || !res.code) {
    wmShowToast(res?.error ? String(res.error).slice(0, 120) : 'No code from inbox', 'error');
    return false;
  }

  wmFillInput(input, res.code);
  input.dispatchEvent(new Event('input', { bubbles: true }));

  const submitBtn =
    document.querySelector('button[type="submit"]') ||
    wmFindByText('verify') ||
    wmFindByText('continue');
  if (submitBtn && wmIsVisible(submitBtn)) {
    await wmSleep(400);
    await wmDebuggerClick(submitBtn);
  }
  wmShowToast('Verification code submitted', 'success');
  return true;
}

async function wmPollLoginImap2FA(loginSettings) {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline && /\/account\/login/i.test(location.pathname)) {
    if (await wmTryImap2FA(loginSettings)) return;
    await wmSleep(2500);
  }
}

// ─── INIT ────────────────────────────────────────────────────────────────────

let wmRuntimeEnabled = true;
let wmInitInFlight = false;

async function wmInit() {
  // Concurrency guard: SPA watcher + message listener can both call wmInit at the
  // same time. Without this, two flows race through checkout in parallel.
  if (wmInitInFlight) return;
  wmInitInFlight = true;
  try {
    await _wmInit();
  } finally {
    wmInitInFlight = false;
  }
}

async function _wmInit() {
  const data = await wmGetSettings();
  wmRuntimeEnabled = !!data.enabled;
  if (!wmRuntimeEnabled) return;

  // Guard: only run on Walmart pages.
  if (typeof TCH_HOSTS !== 'undefined') {
    const detected = TCH_HOSTS.detectRetailer ? TCH_HOSTS.detectRetailer(location.href) : null;
    if (detected !== 'walmart') return;
  }

  // Use Saved Session guard: when OFF, redirect to login if not already logged in.
  const useSavedSession = data.walmartUseSavedSession !== false;
  if (!useSavedSession) {
    const isLoggedIn = !!(
      document.querySelector('[data-automation-id="account-greeting"]') ||
      Array.from(document.querySelectorAll('a')).some(a => /\/account\/logout|sign-out/i.test(a.href || ''))
    );
    if (!isLoggedIn && !/\/account\/login/i.test(location.pathname)) {
      wmShowToast('Use Saved Session is OFF — redirecting to Walmart login…');
      window.location.href = 'https://www.walmart.com/account/login';
      wmInitInFlight = false;
      return;
    }
    if (/\/account\/login/i.test(location.pathname)) {
      wmShowToast('Walmart login — complete captcha if shown; 2FA can be filled from email when enabled.', 'persistent');
      void wmPollLoginImap2FA({
        imap2faEnabled: !!data.imap2faEnabled,
        imapProfile: data.imapProfile || {},
      });
      wmInitInFlight = false;
      return;
    }
  }

  // PerimeterX "hang tight" challenge — Walmart's bot detection landing page.
  // It auto-redirects after a few seconds. Do NOT retry or navigate — just wait.
  // The SPA watcher will call wmInit() again when the redirect fires.
  if (wmIsPxPage()) {
    wmShowToast('Walmart traffic page — waiting for redirect…', 'persistent');
    console.log('[WMT] PX/loading page detected — waiting for auto-redirect, not retrying');
    setTimeout(() => {
      if (wmIsPxPage()) {
        console.log('[WMT] PX page still showing after 2min — releasing nav lock');
        try { chrome.runtime.sendMessage({ type: 'WALMART_NAV_FAILED', url: location.href }); } catch (_) {}
      }
    }, 2 * 60 * 1000);
    return;
  }

  const page = wmGetPageType();
  console.log('[WMT] init:', page, 'enabled:', data.enabled, 'monitor:', !!data.monitor?.active);

  // Find the matching monitored product (if any) to get the OID and product URL.
  // On product pages match by pathname; on cart/checkout use any Walmart product
  // in the monitor list (the background navigated us here, so there's at least one).
  const allProducts = data.monitor?.products || [];
  const walmartProducts = allProducts.filter(p => /walmart\.com\/ip\//i.test(p.url));
  const matchedProduct = page === 'product'
    ? walmartProducts.find(p => {
        try { return new URL(p.url).pathname === location.pathname; } catch { return false; }
      })
    : walmartProducts[0] || null;
  const oid = matchedProduct?.oid || null;

  // Data guard: don't automate if there's nothing configured — prevents ATCing
  // every Walmart /ip/ page the user browses while the extension is simply "on".
  const hasData = !!(data.shipping?.firstName || data.payment?.cardNumber || data.useSavedPayment);
  const hasMonitor = !!(data.monitor?.active && walmartProducts.length > 0);
  if (!hasData && !hasMonitor) {
    console.log('[WMT] No settings configured — skipping automation');
    return;
  }

  const settings = {
    shipping:              data.shipping          || {},
    payment:               data.payment           || {},
    retryPolicy:           data.retryPolicy       || {},
    useSavedPayment:       !!data.useSavedPayment,
    autoPlaceOrder:        !!data.autoPlaceOrder,
    walmartMaxPrice:       parseFloat(data.walmartMaxPrice) || 0,
    walmartSkipMonitoring: !!data.walmartSkipMonitoring,
    walmartAtcOnly:        !!data.walmartAtcOnly,
    walmartUseSavedSession: data.walmartUseSavedSession !== false,
    shippingJig:           data.shippingJig || '',
    jigIndex: typeof data.jigIndex === 'number' && Number.isFinite(data.jigIndex)
      ? data.jigIndex
      : Math.max(0, Math.min(99, parseInt(String(data.jigIndex ?? '0'), 10) || 0)),
    checkoutSound:         data.checkoutSound !== false,
    productUrl:            matchedProduct?.url || null,
  };

  if (page === 'product') {
    // Extract OID from __NEXT_DATA__ and report to background — enables backend-link
    // mode where background fires ATC immediately at dropExpectedAt without poll delay.
    const pageOid = (() => {
      try {
        const nd = window.__NEXT_DATA__;
        return nd?.props?.pageProps?.initialData?.data?.product?.primaryOffer?.offerId || null;
      } catch { return null; }
    })();
    if (pageOid && pageOid !== oid) {
      chrome.runtime.sendMessage({ type: 'WM_OFFER_ID_READY', offerId: pageOid, url: location.href }).catch(() => {});
    }
    await wmHandleProductPage(settings, oid || pageOid);
  }
  else if (page === 'cart')      await wmHandleCart(settings);
  else if (page === 'queue-room') await wmHandleQueueRoom(settings);
  else if (page === 'queue')     await wmHandleQueue(settings);
  else if (page === 'checkout')  await wmHandleCheckout(settings);
  else if (page === 'review')    await wmHandleReview(settings);
  else if (page === 'confirmation') wmShowToast('Order placed!', 'success');
}

// ─── SPA NAV WATCHER ─────────────────────────────────────────────────────────

let wmLastUrl = location.href;
new MutationObserver(() => {
  if (location.href === wmLastUrl) return;
  wmLastUrl = location.href;
  wmInvalidateCache();
  document.getElementById('wmt-toast')?.remove();
  if (typeof TCH_HOSTS !== 'undefined' && TCH_HOSTS.detectRetailer) {
    if (TCH_HOSTS.detectRetailer(location.href) !== 'walmart') return;
  }
  requestAnimationFrame(wmInit);
}).observe(document, { subtree: true, childList: true });

// ─── MESSAGE LISTENER ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_UPDATED') {
    wmInvalidateCache();
    wmRuntimeEnabled = !!message.enabled;
    if (!wmRuntimeEnabled) {
      document.getElementById('wmt-toast')?.remove();
      return;
    }
    wmInit();
  }
  if (message.type === 'MONITOR_UPDATED') {
    wmInvalidateCache();
    void wmInit();
  }
});

// ─── GO ──────────────────────────────────────────────────────────────────────

if (document.body) {
  wmInit();
} else {
  document.addEventListener('DOMContentLoaded', wmInit, { once: true });
}
