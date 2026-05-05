// walmart-content.js — Walmart Checkout Helper
// Injected into *.walmart.com pages. Standalone — no dependency on content.js.
// Handles: product ATC → cart → queue wait → shipping → payment → review.

// ─── SELECTORS ───────────────────────────────────────────────────────────────

const WM_SEL = {
  // Product page
  atc:          '[data-automation-id="add-to-cart-btn"]',
  atcAlt:       'button[class*="AddToCartButton"], button[class*="add-to-cart"]',
  // Price — try structured data first, fall back to text
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
  cardNumber:   'input[name="cardNumber"], input[id*="card-number"], input[autocomplete="cc-number"]',
  expiry:       'input[name="expirationDate"], input[placeholder*="MM/YY"], input[placeholder*="MM / YY"]',
  expMonth:     'input[name="expiryMonth"], input[id*="exp-month"]',
  expYear:      'input[name="expiryYear"], input[id*="exp-year"]',
  cvv:          'input[name="cvvNumber"], input[name="cvv"], input[autocomplete="cc-csc"]',
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
      'walmartUseSavedSession',
      'shippingJig',
      'checkoutSound',
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

function wmIsVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none') return false;
  return true;
}

/**
 * Returns the current product price as a number, or null if unreadable.
 * Checks the `content` attribute (structured data) first, then falls back
 * to the visible text of the first price element.
 */
function wmGetCurrentPrice() {
  for (const sel of WM_SEL.price.split(', ')) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      // structured data: <span itemprop="price" content="49.99">
      const content = el.getAttribute('content');
      if (content) {
        const n = parseFloat(content);
        if (!isNaN(n)) return n;
      }
      // visible text: strip currency symbol and commas
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
  const text = (document.body?.innerText || '').toLowerCase();
  return (
    text.includes('estimated wait') ||
    text.includes("you're in line") ||
    text.includes('your position in line') ||
    text.includes('admission likelihood') ||
    (text.includes('queue') && text.includes('wait')) ||
    !!document.querySelector('[class*="QueuePage"], [data-automation-id*="queue"], [class*="queue-it"]')
  );
}

/** Legacy alias — used for checkout-path queue detection. */
function wmIsQueuePage() { return wmHasQueueIndicators(); }

/**
 * True if we're on the product page and the ATC button is present but
 * disabled — the classic Walmart drop queue state.
 */
function wmIsProductQueued() {
  const atc = document.querySelector(WM_SEL.atc) ||
              document.querySelector(WM_SEL.atcAlt) ||
              wmFindByText('add to cart');
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
async function wmDirectAtc(oid) {
  wmShowToast('Direct ATC via OID…', 'persistent');
  console.log('[WMT] Direct ATC — OID:', oid);

  // Walmart's internal cart API used by the frontend when the ATC button is clicked.
  // Runs with the user's cookies (credentials: 'include') so no auth headers needed.
  const endpoints = [
    { url: 'https://www.walmart.com/api/checkout/v3/cart', body: { offerId: oid, quantity: 1 } },
    { url: 'https://www.walmart.com/api/checkout/v3/cart/items', body: { offerId: oid, quantity: 1 } },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(ep.body),
        signal: AbortSignal.timeout(5000),
      });
      console.log('[WMT] Direct ATC response:', ep.url, res.status);
      if (res.ok || res.status === 200) {
        wmShowToast('OID cart add succeeded — going to checkout…', 'success');
        wmSignalAtcSuccess(null); // productUrl resolved by background via sender.tab.url
        await wmSleep(300);
        window.location.href = 'https://www.walmart.com/checkout';
        return true;
      }
    } catch (e) {
      console.warn('[WMT] Direct ATC error on', ep.url, e.message);
    }
  }

  console.warn('[WMT] Direct ATC failed on all endpoints — falling back to DOM');
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

  while (Date.now() - started < maxWaitMs) {
    await wmSleep(1000);

    // Price guard — re-check each second during queue; don't proceed if price still high
    const maxPrice = parseFloat(settings.walmartMaxPrice) || 0;
    if (maxPrice > 0) {
      const currentPrice = wmGetCurrentPrice();
      if (currentPrice !== null && currentPrice > maxPrice) {
        // Still pre-drop price — keep waiting silently
        continue;
      }
    }

    // Check if ATC has become enabled (our turn in queue)
    const btn =
      document.querySelector(WM_SEL.atc) ||
      document.querySelector(WM_SEL.atcAlt) ||
      wmFindByText('add to cart');

    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && wmIsVisible(btn)) {
      wmShowToast('Your turn! Adding to cart…', 'success');
      console.log('[WMT] Queue cleared — ATC button is now enabled');

      // Try OID fast path now that queue has cleared
      if (oid) {
        const ok = await wmDirectAtc(oid);
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
    if (elapsed % 30 === 0) {
      wmShowToast(`In queue — ${elapsed}s elapsed…`, 'persistent');
    }
  }

  wmShowToast('Queue wait exceeded 45 min — take over manually', 'error');
  console.warn('[WMT] Product-page queue wait timed out after 45 min');
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
  if (oid) {
    const ok = await wmDirectAtc(oid);
    if (ok) return;
    // API failed — fall through to DOM path
  }

  // ── Normal ATC (short wait) ───────────────────────────────────────────────
  // Wait up to 8s for ATC to appear and be enabled. If after 8s it's still
  // disabled, the queue may have just loaded — hand off to wmWaitInProductQueue.
  const atcBtn = await wmWaitFor(() => {
    const primary = document.querySelector(WM_SEL.atc);
    if (primary && !primary.disabled && wmIsVisible(primary)) return primary;
    const alt = document.querySelector(WM_SEL.atcAlt);
    if (alt && !alt.disabled && wmIsVisible(alt)) return alt;
    const byText = wmFindByText('add to cart');
    if (byText && !byText.disabled && wmIsVisible(byText)) return byText;
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
    // Update toast periodically with elapsed time.
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (elapsed % 30 === 0) {
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
    const wmJig = (settings.shippingJig || '').trim();
    const wmEffectiveAddress1 = wmJig && s.address1 ? `${wmJig} ${s.address1}` : s.address1;
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

  // Try combined MM/YY expiry first, then split month/year.
  const expCombined = wmFindFirst(...WM_SEL.expiry.split(', '));
  if (expCombined && p.expMonth && p.expYear) {
    const yr = p.expYear.length === 4 ? p.expYear.slice(-2) : p.expYear;
    wmFillInput(expCombined, `${p.expMonth}/${yr}`);
  } else {
    if (p.expMonth) {
      const el = wmFindFirst(...WM_SEL.expMonth.split(', '));
      if (el) wmFillInput(el, p.expMonth);
    }
    if (p.expYear) {
      const el = wmFindFirst(...WM_SEL.expYear.split(', '));
      if (el) wmFillInput(el, p.expYear);
    }
  }

  if (p.cvv) {
    const el = wmFindFirst(...WM_SEL.cvv.split(', '));
    if (el) wmFillInput(el, p.cvv);
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
      wmShowToast('Please log in to Walmart — bot will resume after login', 'persistent');
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
    walmartUseSavedSession: data.walmartUseSavedSession !== false,
    shippingJig:           data.shippingJig || '',
    checkoutSound:         data.checkoutSound !== false,
    productUrl:            matchedProduct?.url || null,
  };

  if (page === 'product')      await wmHandleProductPage(settings, oid);
  else if (page === 'cart')    await wmHandleCart(settings);
  else if (page === 'queue')   await wmHandleQueue(settings);
  else if (page === 'checkout') await wmHandleCheckout(settings);
  else if (page === 'review')  await wmHandleReview(settings);
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
