// samsclub-content.js — Sam's Club Checkout Helper (SC-1 / SC-3 / SC-4)
// Injected into *.samsclub.com pages. FCFS retailer — no Walmart queue lock (SC-5).

// ─── SELECTORS ───────────────────────────────────────────────────────────────

const SC_SEL = {
  atc:
    '[data-automation-id="add-to-cart-btn"], button[data-automation-id="atc-button"], button[class*="AddToCartButton"], button[class*="add-to-cart"]',
  viewCart: 'a[href="/cart"], button[data-automation-id="go-to-cart-btn"]',
  checkout: '[data-automation-id="checkout-btn"], a[href^="/checkout"]',
  continueBtn: 'button[data-automation-id="continue-btn"]',
  placeOrder: '[data-automation-id="place-order-btn"]',
  firstName: 'input[name="firstName"], input[autocomplete="given-name"]',
  lastName: 'input[name="lastName"], input[autocomplete="family-name"]',
  address1: 'input[name="addressLineOne"], input[autocomplete="address-line1"]',
  address2: 'input[name="addressLineTwo"], input[autocomplete="address-line2"]',
  city: 'input[name="city"], input[autocomplete="address-level2"]',
  state: 'select[name="state"], input[name="state"], input[autocomplete="address-level1"]',
  zip: 'input[name="postalCode"], input[name="zipCode"], input[autocomplete="postal-code"]',
  phone: 'input[name="phone"], input[autocomplete="tel"]',
  cardNumber:
    'input[id="creditCard"], input[name="cardNumber"], input[id*="card-number"], input[autocomplete="cc-number"]',
  expiry: 'input[name="expirationDate"], input[placeholder*="MM/YY"], input[placeholder*="MM / YY"]',
  expMonth: 'select[id="month-chooser"], select[name="month"], input[name="expiryMonth"]',
  expYear: 'select[id="year-chooser"], select[name="year"], input[name="expiryYear"]',
  cvv: 'input[id="cvv"], input[name="cvvNumber"], input[name="cvv"], input[autocomplete="cc-csc"]',
};

// ─── SETTINGS CACHE ──────────────────────────────────────────────────────────

let scSettingsCache = null;
let scRuntimeEnabled = false;
let scInitInFlight = false;

async function scGetSettings() {
  if (!scSettingsCache) {
    scSettingsCache = await chrome.storage.local.get([
      'enabled',
      'monitor',
      'autoPlaceOrder',
      'shipping',
      'payment',
      'useSavedPayment',
      'shippingJig',
      'jigIndex',
      'checkoutSound',
    ]).catch(() => ({}));
  }
  return scSettingsCache;
}

function scInvalidateCache() {
  scSettingsCache = null;
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

const scSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scNativeInputSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value'
).set;

function scFillInput(input, value) {
  scNativeInputSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function scFillSelect(select, value) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function scFindFirst(...selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function scFindByText(text) {
  const lower = text.toLowerCase();
  return (
    Array.from(document.querySelectorAll('a, button')).find((el) =>
      el.textContent.trim().toLowerCase().includes(lower)
    ) || null
  );
}

function scIsVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
}

function scFindAtcButton() {
  const el = document.querySelector(SC_SEL.atc);
  if (el) return el;
  return scFindByText('add to cart');
}

/** SC-6: FCFS ATC wait cap — optional data-tch-atc-wait-ms for fixture e2e. */
function scAtcWaitTimeoutMs() {
  const root = document.documentElement;
  const override = root?.getAttribute('data-tch-atc-wait-ms');
  if (override != null && override !== '') {
    const n = Number(override);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 8000;
}

/** Faster poll when ATC-wait override is set so fixture e2e can finish quickly. */
function scAtcWaitPollMs() {
  if (document.documentElement?.getAttribute('data-tch-atc-wait-ms')) return 200;
  return 200;
}

/** SC-4 / SC-6: checkout SPA step poll cap — optional data-tch-checkout-timeout-ms. */
function scCheckoutTotalTimeoutMs() {
  const root = document.documentElement;
  const override = root?.getAttribute('data-tch-checkout-timeout-ms');
  if (override != null && override !== '') {
    const n = Number(override);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 30 * 1000;
}

function scCheckoutPollMs() {
  if (document.documentElement?.getAttribute('data-tch-checkout-timeout-ms')) return 200;
  return 300;
}

/** SC-2 / SC-6: cart checkout-button wait cap — optional data-tch-cart-checkout-wait-ms. */
function scCartCheckoutWaitMs() {
  const root = document.documentElement;
  const override = root?.getAttribute('data-tch-cart-checkout-wait-ms');
  if (override != null && override !== '') {
    const n = Number(override);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 8000;
}

/** Faster poll when cart-checkout-wait override is set so fixture e2e can finish quickly. */
function scCartCheckoutPollMs() {
  if (document.documentElement?.getAttribute('data-tch-cart-checkout-wait-ms')) return 200;
  return 200;
}

async function scWaitFor(fn, timeoutMs = 8000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await scSleep(intervalMs);
  }
  return null;
}

function scSignalAtcSuccess(productUrl) {
  const url = productUrl || location.href;
  try {
    chrome.runtime.sendMessage({ type: 'ATC_SUCCESS', url });
  } catch (_) {}
}

/** SC-6: release background poll lock on FCFS restock wait — no Walmart queue semantics. */
function scSignalNavFailed(productUrl) {
  const url = productUrl || location.href;
  try {
    chrome.runtime.sendMessage({ type: 'SAMS_NAV_FAILED', url });
  } catch (_) {}
}

function scShowToast(msg, level = 'info') {
  try {
    chrome.runtime.sendMessage({ type: 'SHOW_TOAST', message: msg, level });
  } catch (_) {}
  console.log('[SC]', msg);
}

function scGetPageType() {
  const path = location.pathname;
  if (/\/p\//.test(path) || /\/ip\//.test(path) || /\/prod\//.test(path)) return 'product';
  if (path.includes('/cart')) return 'cart';
  if (path.includes('/checkout')) return 'checkout';
  return 'other';
}

// ─── SC-3: FCFS PRODUCT ATC (no queue semantics) ─────────────────────────────

/**
 * SC-3: FCFS product-page ATC — wait for enabled button, click, go to cart.
 * Disabled ATC is a stock wait, not a queue hold (SC-5: no Walmart-style queue lock).
 */
async function scHandleProductPage(settings) {
  console.log('[SC] handleProductPage — FCFS ATC');
  const atcBtn = await scWaitFor(() => {
    const el = scFindAtcButton();
    if (el && !el.disabled && scIsVisible(el)) return el;
    return null;
  }, scAtcWaitTimeoutMs(), scAtcWaitPollMs());

  if (!atcBtn) {
    scShowToast('ATC not available — waiting for restock', 'persistent');
    console.log('[SC] ATC button not found or disabled — FCFS restock wait, releasing navigation lock');
    scSignalNavFailed(settings.productUrl || location.href);
    return;
  }

  scShowToast('Adding to cart…', 'persistent');
  console.log('[SC] Clicking ATC button');
  atcBtn.click();
  scSignalAtcSuccess(settings.productUrl || location.href);
  await scSleep(1500);

  const cartLink =
    document.querySelector(SC_SEL.viewCart) ||
    scFindByText('view cart') ||
    scFindByText('go to cart');
  if (cartLink && scIsVisible(cartLink)) {
    cartLink.click();
  } else {
    console.log('[SC] No cart link after ATC — navigating to /cart');
    window.location.href = 'https://www.samsclub.com/cart';
  }
}

/**
 * SC-2: FCFS cart → checkout — no Walmart queue semantics (SC-5).
 */
async function scHandleCartPage(settings) {
  console.log('[SC] handleCartPage — FCFS cart → checkout');
  scShowToast('In cart — proceeding to checkout…', 'persistent');
  const checkoutBtn = await scWaitFor(() => {
    const primary = document.querySelector(SC_SEL.checkout);
    if (primary && scIsVisible(primary)) return primary;
    return (
      Array.from(document.querySelectorAll('button')).find((el) => {
        const text = el.textContent.trim().toLowerCase();
        return (text === 'checkout' || text === 'proceed to checkout') && scIsVisible(el);
      }) || null
    );
  }, scCartCheckoutWaitMs(), scCartCheckoutPollMs());

  if (!checkoutBtn) {
    scShowToast('Checkout button not found — take over manually', 'error');
    console.warn('[SC] Checkout button not found on cart page — releasing navigation lock');
    scSignalNavFailed(settings.productUrl || location.href);
    return;
  }
  console.log('[SC] Clicking checkout button');
  checkoutBtn.click();
}

function scFindContinueBtn() {
  const primary = document.querySelector(SC_SEL.continueBtn);
  if (primary && scIsVisible(primary)) return primary;
  return (
    Array.from(document.querySelectorAll('button')).find((el) => {
      const text = el.textContent.trim().toLowerCase();
      return (text === 'continue' || text.includes('continue to')) && scIsVisible(el);
    }) || null
  );
}

function scCheckoutHasShipping() {
  const el =
    scFindFirst(...SC_SEL.firstName.split(', ')) ||
    scFindFirst(...SC_SEL.address1.split(', ')) ||
    scFindFirst(...SC_SEL.zip.split(', '));
  return !!(el && scIsVisible(el));
}

function scCheckoutHasPayment() {
  const el =
    scFindFirst(...SC_SEL.cardNumber.split(', ')) ||
    scFindFirst(...SC_SEL.cvv.split(', '));
  return !!(el && scIsVisible(el));
}

function scCheckoutHasReview() {
  const btn = document.querySelector(SC_SEL.placeOrder) || scFindByText('place order');
  return !!(btn && scIsVisible(btn));
}

function scPlayBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.9);
  } catch (_) {}
}

/** SC-4: FCFS shipping step — no queue semantics (SC-5). */
async function scHandleShipping(settings) {
  const s = settings.shipping || {};
  console.log('[SC] Filling shipping form');

  const hasShippingForm = !!(
    document.querySelector(SC_SEL.firstName) ||
    document.querySelector(SC_SEL.address1)
  );

  if (!hasShippingForm) {
    console.log('[SC] No shipping form fields found — assuming saved address');
  } else {
    const jiRaw = settings.jigIndex;
    const jigIdx = typeof jiRaw === 'number' && Number.isFinite(jiRaw)
      ? jiRaw
      : parseInt(String(jiRaw ?? ''), 10);
    const scEffectiveAddress1 =
      typeof jigAddressLine1 === 'function'
        ? jigAddressLine1(s.address1, Number.isFinite(jigIdx) ? jigIdx : 0, settings.shippingJig)
        : (() => {
            const scJig = (settings.shippingJig || '').trim();
            return scJig && s.address1 ? `${scJig} ${s.address1}` : s.address1;
          })();
    const fieldMap = [
      [SC_SEL.firstName, s.firstName],
      [SC_SEL.lastName, s.lastName],
      [SC_SEL.address1, scEffectiveAddress1],
      [SC_SEL.address2, s.address2],
      [SC_SEL.city, s.city],
      [SC_SEL.zip, s.zip],
      [SC_SEL.phone, s.phone],
    ];
    for (const [sel, value] of fieldMap) {
      if (!value) continue;
      const el = scFindFirst(...sel.split(', '));
      if (el) scFillInput(el, value);
    }
    if (s.state) {
      const stateEl = scFindFirst(...SC_SEL.state.split(', '));
      if (stateEl) {
        if (stateEl.tagName === 'SELECT') scFillSelect(stateEl, s.state);
        else scFillInput(stateEl, s.state);
      }
    }
  }

  await scSleep(400);
  const continueBtn = scFindContinueBtn();
  if (continueBtn) {
    console.log('[SC] Clicking Continue on shipping');
    continueBtn.click();
  }
}

/** SC-4: FCFS payment step — no sacred lock (SC-5). */
async function scHandlePayment(settings) {
  if (settings.useSavedPayment) {
    console.log('[SC] useSavedPayment — skipping card fill');
    const continueBtn = scFindContinueBtn();
    if (continueBtn) {
      await scSleep(300);
      continueBtn.click();
    }
    return;
  }

  const p = settings.payment || {};
  console.log('[SC] Filling payment form');

  if (p.cardNumber) {
    const el = scFindFirst(...SC_SEL.cardNumber.split(', '));
    if (el) scFillInput(el, p.cardNumber);
  }

  const expCombined = scFindFirst(...SC_SEL.expiry.split(', '));
  if (expCombined && p.expMonth && p.expYear) {
    const yr = p.expYear.length === 4 ? p.expYear.slice(-2) : p.expYear;
    scFillInput(expCombined, `${p.expMonth}/${yr}`);
  } else {
    if (p.expMonth) {
      const el = scFindFirst(...SC_SEL.expMonth.split(', '));
      if (el) {
        if (el.tagName === 'SELECT') scFillSelect(el, p.expMonth);
        else scFillInput(el, p.expMonth);
      }
    }
    if (p.expYear) {
      const el = scFindFirst(...SC_SEL.expYear.split(', '));
      if (el) {
        if (el.tagName === 'SELECT') {
          const yr4 = p.expYear.length === 2 ? `20${p.expYear}` : p.expYear;
          scFillSelect(el, yr4);
        } else {
          scFillInput(el, p.expYear);
        }
      }
    }
  }

  if (p.cvv) {
    const el = scFindFirst(...SC_SEL.cvv.split(', '));
    if (el) scFillInput(el, p.cvv);
  }

  await scSleep(400);
  const continueBtn = scFindContinueBtn();
  if (continueBtn) {
    console.log('[SC] Clicking Continue on payment');
    continueBtn.click();
  }
}

/** SC-4 / TGT-4: default stop at review; Place Order only when autoPlaceOrder is enabled. */
async function scHandleReview(settings) {
  console.log('[SC] review reached');
  if (settings.checkoutSound !== false) scPlayBeep();
  if (!settings.autoPlaceOrder) {
    scShowToast('Reached review — Place Order remains manual', 'persistent');
    return;
  }
  const btn = document.querySelector(SC_SEL.placeOrder) || scFindByText('place order');
  if (btn && scIsVisible(btn)) {
    scShowToast('Auto placing order…', 'success');
    console.log('[SC] autoPlaceOrder: clicking Place Order');
    btn.click();
  } else {
    scShowToast('Place Order button not found — take over manually', 'error');
    console.warn('[SC] Place Order button not found');
  }
}

/**
 * SC-4: FCFS checkout SPA — shipping → payment → review on one /checkout URL.
 * No Walmart queue handlers (SC-3 / SC-5).
 */
async function scHandleCheckout(settings) {
  const stepTimeoutMs = 30 * 1000;
  const STEP_MIN_INTERVAL_MS = 5000;
  const stepHandledAt = {};
  const started = Date.now();
  const maxWaitMs = scCheckoutTotalTimeoutMs();
  const pollMs = scCheckoutPollMs();

  while (Date.now() - started < maxWaitMs) {
    if (scCheckoutHasReview()) {
      await scHandleReview(settings);
      return;
    }

    const hasPayment = scCheckoutHasPayment();
    const hasShipping = scCheckoutHasShipping();

    if (hasPayment && !hasShipping &&
        (Date.now() - (stepHandledAt.payment || 0)) > STEP_MIN_INTERVAL_MS) {
      stepHandledAt.payment = Date.now();
      scShowToast('Filling payment…', 'persistent');
      await scHandlePayment(settings);
      await scWaitFor(scCheckoutHasReview, stepTimeoutMs);
      continue;
    }

    if (hasShipping &&
        (Date.now() - (stepHandledAt.shipping || 0)) > STEP_MIN_INTERVAL_MS) {
      stepHandledAt.shipping = Date.now();
      scShowToast('Filling shipping…', 'persistent');
      await scHandleShipping(settings);
      await scWaitFor(
        () => scCheckoutHasPayment() || scCheckoutHasReview(),
        stepTimeoutMs
      );
      continue;
    }

    await scSleep(pollMs);
  }

  scShowToast('Checkout step timeout — take over manually', 'error');
  console.warn('[SC] scHandleCheckout timed out — releasing navigation lock');
  scSignalNavFailed(settings.productUrl || location.href);
}

// ─── INIT ────────────────────────────────────────────────────────────────────

async function scInit() {
  if (scInitInFlight) return;
  scInitInFlight = true;
  try {
    await _scInit();
  } finally {
    scInitInFlight = false;
  }
}

async function _scInit() {
  if (typeof TCH_HOSTS !== 'undefined' && TCH_HOSTS.detectRetailer) {
    if (TCH_HOSTS.detectRetailer(location.href) !== 'samsclub') return;
  }

  const data = await scGetSettings();
  scRuntimeEnabled = !!data.enabled;
  const page = scGetPageType();
  console.log(
    '[TCH] init:',
    page,
    'enabled:',
    data.enabled,
    'monitor:',
    !!data.monitor?.active,
    'retailer: samsclub'
  );

  if (!scRuntimeEnabled) return;

  const allProducts = data.monitor?.products || [];
  const scProducts = allProducts.filter((p) => /samsclub\.com/i.test(p.url));
  const matchedProduct =
    page === 'product'
      ? scProducts.find((p) => {
          try {
            return new URL(p.url).pathname === location.pathname;
          } catch {
            return false;
          }
        })
      : scProducts[0] || null;

  const hasData = !!(data.shipping?.firstName || data.payment?.cardNumber || data.useSavedPayment);
  const hasMonitor = !!(data.monitor?.active && scProducts.length > 0);
  if (!hasData && !hasMonitor) {
    console.log('[SC] No settings configured — skipping automation');
    return;
  }

  const settings = {
    shipping: data.shipping || {},
    payment: data.payment || {},
    useSavedPayment: !!data.useSavedPayment,
    autoPlaceOrder: !!data.autoPlaceOrder,
    productUrl: matchedProduct?.url || null,
    jigIndex: data.jigIndex,
    shippingJig: data.shippingJig,
    checkoutSound: data.checkoutSound,
  };

  if (page === 'product') {
    await scHandleProductPage(settings);
  } else if (page === 'cart') {
    await scHandleCartPage(settings);
  } else if (page === 'checkout') {
    await scHandleCheckout(settings);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_UPDATED') {
    scInvalidateCache();
    scRuntimeEnabled = !!message.enabled;
    if (!scRuntimeEnabled) return;
    scInit();
  }
  if (message.type === 'MONITOR_UPDATED') {
    scInvalidateCache();
    void scInit();
  }
});

if (document.body) {
  scInit();
} else {
  document.addEventListener('DOMContentLoaded', scInit, { once: true });
}
