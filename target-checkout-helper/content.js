// content.js — Target Checkout Helper (speed-optimized v3)
// Injected at document_end into all target.com pages.

// ─── SELECTORS ───────────────────────────────────────────────────────────────

const SEL = {
  shipIt:          '[data-test="shipItButton"], [data-test="shippingButton"]',
  pickup:          '[data-test="orderPickupButton"]',
  preorder:        '[data-test="preorderButton"]',
  declineCoverage: '[data-test="espModalContent-declineCoverageButton"]',
  viewCart:        '[data-test="addToCartModalViewCartCheckout"]',
  cartCheckout:    '[data-test="checkout-button"]',
  placeOrder:      '[data-test="placeOrderButton"]',
  cardNumber:      '#creditCardInput-cardNumber',
  cvv:             '#creditCardInput-cvv',
  stickyATC:       '[data-test="StickyAddToCart"] button',
};

const T = {
  observerTimeout: 10000,
  checkoutProbeInterval: 60,
  checkoutProbeTimeout: 2500,
  reviewDedupWindowMs: 15000,
  retryMaxAttempts: 4,
  retryDelayMs: 1500,
  retryStateTtlMs: 20 * 60 * 1000,
};

// ─── SETTINGS CACHE ─────────────────────────────────────────────────────────

let settingsCache = null;

async function getSettings() {
  if (!settingsCache) {
    settingsCache = await chrome.storage.local.get([
      'enabled',
      'shipping',
      'payment',
      'monitor',
      'retryPolicy',
    ]);
  }
  return settingsCache;
}

function invalidateCache() { settingsCache = null; }

// ─── UTILITIES ───────────────────────────────────────────────────────────────

const nativeInputSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
).set;

function fillInput(input, value) {
  nativeInputSetter.call(input, value);
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillSelect(select, value) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(r));

function startTiming(label, details = '') {
  const started = performance.now();
  if (details) {
    console.log(`[TCH] timing start ${label}: ${details}`);
  }
  return (suffix = '') => {
    const ms = Math.round(performance.now() - started);
    console.log(`[TCH] timing ${label}: ${ms}ms${suffix ? ` (${suffix})` : ''}`);
    return ms;
  };
}

function setNavigationMark(key) {
  try {
    sessionStorage.setItem(`tch:nav:${key}`, String(Date.now()));
  } catch {}
}

function flushNavigationTiming(key, label) {
  try {
    const storageKey = `tch:nav:${key}`;
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return;
    sessionStorage.removeItem(storageKey);
    const ms = Date.now() - Number(raw);
    if (Number.isFinite(ms) && ms >= 0) {
      console.log(`[TCH] timing ${label}: ${ms}ms`);
    }
  } catch {}
}

function findFirst(...selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function findByText(text) {
  const lower = text.toLowerCase();
  return Array.from(document.querySelectorAll('a, button')).find(
    el => el.textContent.trim().toLowerCase().includes(lower)
  ) || null;
}

function normalizeProductUrl(url) {
  try { const u = new URL(url); return u.origin + u.pathname.replace(/\/$/, ''); }
  catch { return url; }
}

const RETRY_STATE_KEY = 'tch:checkoutRetryState';
const LAST_PRODUCT_URL_KEY = 'tch:lastProductUrl';
const RETRY_NAV_MARK_KEY = 'tch:checkoutRetryNav';
let checkoutRetryTimer = null;
let checkoutRetryScheduled = false;

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getRetryPolicy(settings) {
  const policy = settings?.retryPolicy || {};
  return {
    maxAttempts: clampInt(policy.maxAttempts, 1, 20, T.retryMaxAttempts),
    delayMs: clampInt(policy.delaySec, 1, 60, Math.round(T.retryDelayMs / 1000)) * 1000,
  };
}

function readRetryState() {
  try {
    const raw = sessionStorage.getItem(RETRY_STATE_KEY);
    if (!raw) return { failedAttempts: 0, lastFailure: null, updatedAt: Date.now() };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
    if (Date.now() - (parsed.updatedAt || 0) > T.retryStateTtlMs) {
      return { failedAttempts: 0, lastFailure: null, updatedAt: Date.now() };
    }
    return {
      failedAttempts: Number(parsed.failedAttempts) || 0,
      lastFailure: parsed.lastFailure || null,
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return { failedAttempts: 0, lastFailure: null, updatedAt: Date.now() };
  }
}

function writeRetryState(state) {
  try {
    sessionStorage.setItem(
      RETRY_STATE_KEY,
      JSON.stringify({ ...state, updatedAt: Date.now() })
    );
  } catch {}
}

function clearCheckoutRetryState() {
  checkoutRetryScheduled = false;
  if (checkoutRetryTimer) {
    clearTimeout(checkoutRetryTimer);
    checkoutRetryTimer = null;
  }
  try { sessionStorage.removeItem(RETRY_STATE_KEY); } catch {}
}

function rememberProductUrl(url = location.href) {
  try { sessionStorage.setItem(LAST_PRODUCT_URL_KEY, normalizeProductUrl(url)); } catch {}
}

function getRememberedProductUrl() {
  try { return sessionStorage.getItem(LAST_PRODUCT_URL_KEY) || ''; }
  catch { return ''; }
}

function markRetryNavigation(targetUrl) {
  try {
    sessionStorage.setItem(RETRY_NAV_MARK_KEY, JSON.stringify({
      ts: Date.now(),
      targetUrl: normalizeProductUrl(targetUrl),
    }));
  } catch {}
}

function consumeRetryNavigationMark(maxAgeMs = 30000) {
  try {
    const raw = sessionStorage.getItem(RETRY_NAV_MARK_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(RETRY_NAV_MARK_KEY);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const ts = Number(parsed.ts);
    if (!Number.isFinite(ts) || Date.now() - ts >= maxAgeMs) return false;
    const targetUrl = parsed.targetUrl ? normalizeProductUrl(parsed.targetUrl) : '';
    const currentUrl = normalizeProductUrl(location.href);
    return !targetUrl || targetUrl === currentUrl;
  } catch {
    return false;
  }
}

async function reportRetryEvent(event) {
  try {
    await chrome.runtime.sendMessage({ type: 'CHECKOUT_RETRY_EVENT', event });
  } catch {}
}

function performRetryNavigation() {
  const remembered = getRememberedProductUrl();
  const destination = remembered || (getPageType() === 'checkout'
    ? 'https://www.target.com/cart'
    : location.href);
  markRetryNavigation(destination);

  if (remembered) {
    window.location.href = remembered;
    return;
  }
  if (getPageType() === 'checkout') {
    window.location.href = 'https://www.target.com/cart';
    return;
  }
  location.reload();
}

async function scheduleCheckoutRetry(settings, reason, details = {}) {
  if (checkoutRetryScheduled) return true;

  const policy = getRetryPolicy(settings);
  const state = readRetryState();
  const nextAttempt = state.failedAttempts + 1;
  const eventBase = {
    reason,
    page: getPageType(),
    url: location.href,
    ts: Date.now(),
    ...details,
  };

  if (nextAttempt > policy.maxAttempts) {
    writeRetryState({
      failedAttempts: policy.maxAttempts,
      lastFailure: {
        reason,
        page: eventBase.page,
        url: eventBase.url,
        ts: eventBase.ts,
      },
    });
    console.error(`[TCH] retry exhausted after ${policy.maxAttempts} attempts: ${reason}`);
    showToast(`Checkout retries exhausted: ${reason}`, 'error');
    await reportRetryEvent({
      status: 'exhausted',
      attempt: policy.maxAttempts,
      maxAttempts: policy.maxAttempts,
      ...eventBase,
    });
    return false;
  }

  writeRetryState({
    failedAttempts: nextAttempt,
    lastFailure: {
      reason,
      page: eventBase.page,
      url: eventBase.url,
      ts: eventBase.ts,
    },
  });
  console.warn(`[TCH] retry attempt ${nextAttempt}/${policy.maxAttempts}: ${reason}`);

  const delayMs = policy.delayMs * Math.min(nextAttempt, 3);
  await reportRetryEvent({
    status: 'scheduled',
    attempt: nextAttempt,
    maxAttempts: policy.maxAttempts,
    delayMs,
    ...eventBase,
  });
  showToast(`Retry ${nextAttempt}/${policy.maxAttempts} in ${Math.round(delayMs / 1000)}s`, 'persistent');

  checkoutRetryScheduled = true;
  checkoutRetryTimer = setTimeout(() => {
    checkoutRetryScheduled = false;
    checkoutRetryTimer = null;
    performRetryNavigation();
  }, delayMs);
  return true;
}

async function markCheckoutSuccess() {
  const state = readRetryState();
  const failedAttempts = state.failedAttempts || 0;
  await reportRetryEvent({
    status: 'success',
    failedAttempts,
    page: getPageType(),
    url: location.href,
    ts: Date.now(),
  });
  clearCheckoutRetryState();
}

function waitForAny(specs, timeout = T.observerTimeout) {
  return new Promise((resolve, reject) => {
    const check = () => {
      for (const s of specs) {
        if (s.sel)  { const el = document.querySelector(s.sel); if (el) return el; }
        if (s.text) { const el = findByText(s.text); if (el) return el; }
      }
      return null;
    };
    const found = check();
    if (found) return resolve(found);
    const timer = setTimeout(() => { obs.disconnect(); reject(new Error('timeout')); }, timeout);
    const obs = new MutationObserver(() => {
      const el = check();
      if (el) { clearTimeout(timer); obs.disconnect(); resolve(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
}

function waitForEnabled(getFn, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const el = getFn();
    if (el && !el.disabled) return resolve(el);
    const timer = setTimeout(() => { obs.disconnect(); reject(); }, timeout);
    const obs = new MutationObserver(() => {
      const el = getFn();
      if (el && !el.disabled) { clearTimeout(timer); obs.disconnect(); resolve(el); }
    });
    obs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['disabled'],
    });
  });
}

function showToast(message, type = 'info') {
  const existing = document.getElementById('tch-toast');
  if (existing) existing.remove();
  const colors = { info: '#cc0000', success: '#1a7340', error: '#333', persistent: '#cc0000' };
  const toast = document.createElement('div');
  toast.id = 'tch-toast';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', right: '24px',
    background: colors[type] || colors.info, color: 'white',
    padding: '12px 18px', borderRadius: '8px',
    fontFamily: '-apple-system, sans-serif', fontSize: '13px', fontWeight: '600',
    zIndex: '2147483647', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    lineHeight: '1.4', maxWidth: '320px',
  });
  toast.textContent = '🎯 ' + message;
  document.body.appendChild(toast);
  if (type !== 'persistent') {
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
  }
}

function findContinueButton(enabledOnly = false) {
  const patterns = ['save & continue', 'save and continue', 'continue', 'next'];
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.find((button) => {
    if (enabledOnly && button.disabled) return false;
    const text = button.textContent.trim().toLowerCase().replace(/\s+/g, ' ');
    return patterns.some((pattern) => text === pattern || text.startsWith(pattern));
  }) || null;
}

function clickContinue() {
  const btn = findContinueButton(true);
  if (btn) { btn.click(); return true; }
  return false;
}

async function waitAndClickContinue(timeout = 5000) {
  if (clickContinue()) return true;
  try {
    const btn = await waitForEnabled(() => findContinueButton(true), timeout);
    btn.click();
    return true;
  } catch {
    return false;
  }
}

function prefetchCheckout() {
  if (document.querySelector('link[data-tch-prefetch]')) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = 'https://www.target.com/checkout';
  link.setAttribute('data-tch-prefetch', '1');
  document.head.appendChild(link);
}

// ─── PAGE DETECTION ──────────────────────────────────────────────────────────

function getPageType() {
  const path = window.location.pathname;
  if (/^\/p\//.test(path))             return 'product';
  if (/^\/cart/.test(path))            return 'cart';
  if (/^\/checkout/.test(path))        return 'checkout';
  if (/^\/co-thankyou/.test(path))     return 'confirmation';
  return 'other';
}

function getCheckoutStep() {
  if (document.querySelector(SEL.placeOrder) || findByText('place order')) return 'review';
  if (document.querySelector(SEL.cardNumber)) return 'payment';
  if (['input[id*="firstName"]', 'input[name="firstName"]', 'input[autocomplete="given-name"]']
    .some(s => document.querySelector(s))) return 'shipping';
  return 'unknown';
}

// ─── STEP HANDLERS ───────────────────────────────────────────────────────────

async function handleProductPage(settings) {
  console.log('[TCH] handleProductPage');
  prefetchCheckout();
  const fromRetryNavigation = consumeRetryNavigationMark();
  if (!fromRetryNavigation) clearCheckoutRetryState();
  rememberProductUrl(location.href);

  const stopFindAtc = startTiming('product_wait_for_atc');
  let addBtn;
  try {
    addBtn = await waitForAny([
      { sel: SEL.shipIt }, { sel: SEL.pickup }, { sel: SEL.preorder },
      { sel: SEL.stickyATC }, { text: 'add to cart' }, { text: 'preorder' },
    ], 6000);
    stopFindAtc('found');
  } catch {
    showToast('ATC button not found', 'error');
    await scheduleCheckoutRetry(settings, 'ATC button not found');
    return;
  }

  if (addBtn.disabled) {
    const stopEnableAtc = startTiming('product_wait_for_enabled_atc');
    try {
      addBtn = await waitForEnabled(
        () => findFirst(SEL.shipIt, SEL.pickup, SEL.preorder, SEL.stickyATC)
              || findByText('add to cart') || findByText('preorder'),
        6000
      );
      stopEnableAtc('enabled');
    } catch {
      showToast('Button still disabled', 'error');
      await scheduleCheckoutRetry(settings, 'ATC button stayed disabled');
      return;
    }
  }

  console.log('[TCH] clicking ATC');
  addBtn.click();
  showToast('ATC → checkout…');
  setNavigationMark('product_to_checkout');
  window.location.href = 'https://www.target.com/checkout';
}

async function handleCartPage(settings) {
  console.log('[TCH] handleCartPage');
  const stopCartCheckout = startTiming('cart_wait_for_checkout_button');
  try {
    const btn = await waitForAny([
      { sel: SEL.cartCheckout }, { text: 'check out' }, { text: 'sign in to check out' },
    ], 6000);
    stopCartCheckout('clicked');
    setNavigationMark('cart_to_checkout');
    btn.click();
  } catch {
    stopCartCheckout('fallback_redirect');
    setNavigationMark('cart_to_checkout');
    window.location.href = 'https://www.target.com/checkout';
  }
}

let checkoutFlowStart = null;
let checkoutStepObserver = null;
let checkoutStepPollId = null;
let checkoutStepPollTimer = null;
let lastReviewKey = null;
let lastReviewAt = 0;

function markCheckoutFlow(step) {
  if (checkoutFlowStart === null) {
    checkoutFlowStart = performance.now();
    console.log('[TCH] timing checkout_flow_start: 0ms');
  }
  const ms = Math.round(performance.now() - checkoutFlowStart);
  console.log(`[TCH] timing checkout_${step}: ${ms}ms`);
}

async function handleCheckoutPage(settings) {
  markCheckoutFlow('page_ready');
  const step = getCheckoutStep();
  console.log('[TCH] checkout step:', step);
  if (step === 'shipping')    return handleShippingStep(settings);
  if (step === 'payment')     return handlePaymentStep(settings);
  if (step === 'review')      return handleReviewStep(settings);
  watchForCheckoutStep(settings);
}

function watchForCheckoutStep(settings) {
  if (checkoutStepObserver) {
    checkoutStepObserver.disconnect();
    checkoutStepObserver = null;
  }
  if (checkoutStepPollId) {
    clearInterval(checkoutStepPollId);
    checkoutStepPollId = null;
  }
  if (checkoutStepPollTimer) {
    clearTimeout(checkoutStepPollTimer);
    checkoutStepPollTimer = null;
  }

  let handled = false;
  const runStep = async (step) => {
    if (handled) return;
    if (step === 'unknown') return;
    handled = true;
    markCheckoutFlow(`${step}_detected`);
    if (checkoutStepObserver) {
      checkoutStepObserver.disconnect();
      checkoutStepObserver = null;
    }
    if (checkoutStepPollId) {
      clearInterval(checkoutStepPollId);
      checkoutStepPollId = null;
    }
    if (checkoutStepPollTimer) {
      clearTimeout(checkoutStepPollTimer);
      checkoutStepPollTimer = null;
    }
    if (step === 'shipping') await handleShippingStep(settings);
    else if (step === 'payment') await handlePaymentStep(settings);
    else if (step === 'review') await handleReviewStep(settings);
  };

  const observer = new MutationObserver(async () => {
    if (handled) return;
    await runStep(getCheckoutStep());
  });
  checkoutStepObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });
  checkoutStepPollId = setInterval(() => {
    runStep(getCheckoutStep());
  }, T.checkoutProbeInterval);
  checkoutStepPollTimer = setTimeout(() => {
    if (!handled && checkoutStepObserver === observer) {
      observer.disconnect();
      checkoutStepObserver = null;
    }
    if (checkoutStepPollId) {
      clearInterval(checkoutStepPollId);
      checkoutStepPollId = null;
    }
    if (!handled) {
      scheduleCheckoutRetry(settings, 'Checkout step detection timed out');
    }
    checkoutStepPollTimer = null;
  }, T.checkoutProbeTimeout);
}

async function handleShippingStep(settings) {
  const s = settings.shipping || {};
  console.log('[TCH] filling shipping');
  markCheckoutFlow('shipping_start');

  const stopFill = startTiming('shipping_fill_fields');
  const fieldMap = [
    [['input[id*="firstName"]', 'input[name="firstName"]', 'input[autocomplete="given-name"]'], s.firstName],
    [['input[id*="lastName"]', 'input[name="lastName"]', 'input[autocomplete="family-name"]'], s.lastName],
    [['input[id*="addressLine1"]', 'input[name="addressLine1"]', 'input[id*="address1"]', 'input[autocomplete="address-line1"]'], s.address1],
    [['input[id*="addressLine2"]', 'input[name="addressLine2"]', 'input[id*="address2"]', 'input[autocomplete="address-line2"]'], s.address2],
    [['input[id*="city"]', 'input[name="city"]', 'input[autocomplete="address-level2"]'], s.city],
    [['input[id*="zipCode"]', 'input[name="zipCode"]', 'input[id*="zip"]', 'input[autocomplete="postal-code"]'], s.zip],
    [['input[id*="phone"]', 'input[name="phone"]', 'input[autocomplete="tel"]'], s.phone],
  ];

  for (const [selectors, value] of fieldMap) {
    if (!value) continue;
    const input = findFirst(...selectors);
    if (input) fillInput(input, value);
  }

  if (s.state) {
    const stateEl = findFirst('select[id*="state"]', 'select[name*="state"]', 'select[autocomplete="address-level1"]');
    if (stateEl) fillSelect(stateEl, s.state);
  }
  stopFill();

  await nextFrame();
  const stopContinue = startTiming('shipping_wait_for_continue');
  const continueClicked = await waitAndClickContinue(5000);
  stopContinue(continueClicked ? 'clicked' : 'not_found_or_disabled');
  if (!continueClicked) {
    await scheduleCheckoutRetry(settings, 'Shipping continue button unavailable');
    return;
  }

  const addrObs = new MutationObserver(() => {
    const useAddr = findByText('use this address') || findByText('save and continue')
      || findByText('use as entered') || findByText('suggested address');
    if (useAddr && !useAddr.disabled) { useAddr.click(); addrObs.disconnect(); }
  });
  addrObs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => addrObs.disconnect(), 5000);

  watchForCheckoutStep(settings);
}

async function handlePaymentStep(settings) {
  const p = settings.payment || {};
  console.log('[TCH] filling payment');
  markCheckoutFlow('payment_start');

  const stopFill = startTiming('payment_fill_fields');
  if (p.cardNumber) {
    const el = document.querySelector(SEL.cardNumber);
    if (el) fillInput(el, p.cardNumber);
  }

  const expCombined = findFirst(
    '#creditCardInput-expDate', 'input[id*="expiration"]',
    'input[placeholder*="MM/YY"]', 'input[placeholder*="MM / YY"]'
  );
  if (expCombined && p.expMonth && p.expYear) {
    const yr = p.expYear.length === 4 ? p.expYear.slice(-2) : p.expYear;
    fillInput(expCombined, `${p.expMonth}/${yr}`);
  } else {
    if (p.expMonth) { const mo = findFirst('input[id*="expMonth"]', 'input[name*="expMonth"]'); if (mo) fillInput(mo, p.expMonth); }
    if (p.expYear) { const yr = findFirst('input[id*="expYear"]', 'input[name*="expYear"]'); if (yr) fillInput(yr, p.expYear); }
  }

  if (p.cvv) { const el = document.querySelector(SEL.cvv); if (el) fillInput(el, p.cvv); }

  if (p.billingZip) {
    const el = findFirst('input[id*="billingZip"]', 'input[id*="billing-zip"]', 'input[name*="billingZip"]');
    if (el) fillInput(el, p.billingZip);
  }
  stopFill();

  await nextFrame();
  const stopContinue = startTiming('payment_wait_for_continue');
  const continueClicked = await waitAndClickContinue(5000);
  stopContinue(continueClicked ? 'clicked' : 'not_found_or_disabled');
  if (!continueClicked) {
    await scheduleCheckoutRetry(settings, 'Payment continue button unavailable');
    return;
  }
  if (continueClicked) {
    waitForAny([
      { sel: SEL.placeOrder }, { text: 'place order' },
    ], 15000).then(() => handleReviewStep(settings)).catch(() => watchForCheckoutStep(settings));
  }
}

async function handleReviewStep(settings) {
  const reviewKey = `${location.pathname}${location.search}`;
  const now = Date.now();
  if (lastReviewKey === reviewKey && now - lastReviewAt < T.reviewDedupWindowMs) return;
  lastReviewKey = reviewKey;
  lastReviewAt = now;

  const stopReviewWait = startTiming('review_wait_for_place_order');
  markCheckoutFlow('review_start');
  try {
    await waitForAny([
      { sel: SEL.placeOrder }, { text: 'place order' },
    ], 4000);
    stopReviewWait('found');
  } catch {
    stopReviewWait('not_found');
    await scheduleCheckoutRetry(settings, 'Review step missing Place Order button');
    return;
  }

  console.log('[TCH] review reached: safety stop before Place Order');
  if (checkoutFlowStart !== null) {
    const totalMs = Math.round(performance.now() - checkoutFlowStart);
    console.log(`[TCH] timing checkout_total_to_review: ${totalMs}ms`);
  }
  await markCheckoutSuccess();
  showToast('Reached review — Place Order remains manual.', 'persistent');
}

// ─── MONITOR MODE ────────────────────────────────────────────────────────────

const OOS_STRINGS = ['Preorders have sold out', 'Out of stock', 'Sold out',
  'This item is not available', 'Item not available', 'Currently unavailable'];
const IN_STOCK_STRINGS = ['shippingButton', 'shipItButton', 'orderPickupButton', '>Add to cart<'];

function checkStockFromHTML(html) {
  for (const s of OOS_STRINGS) { if (html.includes(s)) return false; }
  for (const s of IN_STOCK_STRINGS) { if (html.includes(s)) return true; }
  return false;
}

// Streaming stock check — reads the response in chunks and terminates early
// as soon as a stock-status string is found, avoiding full page download.
async function streamingStockCheck(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: 'no-store', credentials: 'include',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      for (const s of OOS_STRINGS) {
        if (buf.includes(s)) { reader.cancel(); return false; }
      }
      for (const s of IN_STOCK_STRINGS) {
        if (buf.includes(s)) { reader.cancel(); return true; }
      }
    }

    return checkStockFromHTML(buf);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function handleMonitoredATC(monitor, product) {
  console.log('[TCH] monitor ATC for', product.url);
  rememberProductUrl(product.url);
  const normUrl = normalizeProductUrl(product.url);
  const currentCount = monitor.counts?.[normUrl] || 0;
  const interval = monitor.refreshInterval || 1;

  if (currentCount >= product.qty) return;

  let addBtn = findFirst(SEL.shipIt, SEL.pickup, SEL.preorder, SEL.stickyATC)
    || findByText('add to cart') || findByText('preorder');

  if (!addBtn) {
    try {
      addBtn = await waitForAny([
        { sel: SEL.shipIt }, { sel: SEL.pickup }, { sel: SEL.preorder },
        { text: 'add to cart' }, { text: 'preorder' },
      ], 2000);
    } catch { addBtn = null; }
  }

  const pageOOS = /sold out|out of stock|currently unavailable|item not available/i.test(
    document.body?.textContent || ''
  );

  if (addBtn && addBtn.disabled && !pageOOS) {
    try {
      addBtn = await waitForEnabled(
        () => findFirst(SEL.shipIt, SEL.pickup, SEL.preorder, SEL.stickyATC)
              || findByText('add to cart') || findByText('preorder'),
        3000
      );
    } catch { /* stays disabled */ }
  }

  if (addBtn && !addBtn.disabled && !pageOOS) {
    showToast(`Monitor: ATC (${currentCount + 1}/${product.qty})…`);
    addBtn.click();

    setTimeout(() => { const c = document.querySelector(SEL.declineCoverage); if (c) c.click(); }, 300);

    await sleep(800);
    const dismissBtn = findByText('continue shopping');
    if (dismissBtn) dismissBtn.click();

    showToast(`Monitor: Added! (${currentCount + 1}/${product.qty})`, 'success');
    chrome.runtime.sendMessage({ type: 'ATC_SUCCESS', url: normUrl });
    return;
  }

  // Streaming fetch polling — reads chunks, terminates early on match
  let pollCount = 0;
  showToast(`Monitor: Polling every ${interval}s (no reload)…`, 'persistent');
  console.log('[TCH] passive polling for', normUrl);

  const pollId = setInterval(async () => {
    pollCount++;
    const result = await streamingStockCheck(location.href);
    if (result === true) {
      clearInterval(pollId);
      console.log('[TCH] STOCK DETECTED after', pollCount, 'polls');
      showToast('STOCK DETECTED — reloading!', 'success');
      location.reload();
    } else if (result === null) {
      // network error — skip this poll
    } else if (pollCount % 10 === 0) {
      showToast(`Polling… (${pollCount} checks)`, 'persistent');
    }
  }, interval * 1000);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function init() {
  const stopInit = startTiming('init_total', location.pathname);
  const data = await getSettings();
  const page = getPageType();
  console.log('[TCH] init:', page, 'enabled:', data.enabled, 'monitor:', !!data.monitor?.active);

  if (page !== 'checkout') {
    checkoutFlowStart = null;
  } else {
    flushNavigationTiming('product_to_checkout', 'nav_product_to_checkout');
    flushNavigationTiming('cart_to_checkout', 'nav_cart_to_checkout');
  }

  if (data.monitor?.active && page === 'product') {
    const normUrl = normalizeProductUrl(location.href);
    const product = (data.monitor.products || []).find(
      p => normalizeProductUrl(p.url) === normUrl
    );
    if (product) { await handleMonitoredATC(data.monitor, product); stopInit('monitor_mode'); return; }
  }

  if (!data.enabled) { stopInit('disabled'); return; }
  const hasData = (data.shipping && Object.values(data.shipping).some(Boolean))
    || (data.payment && Object.values(data.payment).some(Boolean));
  if (!hasData) { showToast('Open popup to add your info', 'error'); stopInit('missing_settings'); return; }

  const settings = {
    shipping: data.shipping || {},
    payment: data.payment || {},
    retryPolicy: data.retryPolicy || {},
  };

  if (page === 'product' || page === 'cart') prefetchCheckout();

  if (page === 'product')      await handleProductPage(settings);
  else if (page === 'cart')    await handleCartPage(settings);
  else if (page === 'checkout') await handleCheckoutPage(settings);
  else if (page === 'confirmation') {
    await markCheckoutSuccess();
    showToast('Order placed!', 'success');
  }
  stopInit(`done:${page}`);
}

// ─── SPA NAV WATCHER ─────────────────────────────────────────────────────────

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    invalidateCache();
    document.getElementById('tch-toast')?.remove();
    requestAnimationFrame(init);
  }
}).observe(document, { subtree: true, childList: true });

// ─── MESSAGE LISTENER ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_UPDATED') {
    invalidateCache();
    if (message.enabled) init();
  }
});

// ─── GO ──────────────────────────────────────────────────────────────────────

if (document.body) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init, { once: true });
}
