// content.js — Target Checkout Helper (speed-optimized v3)
// Injected at document_end into all target.com pages.

// ─── SELECTORS ───────────────────────────────────────────────────────────────

const SEL = {
  shipIt:          '[data-test="shipItButton"], [data-test="shippingButton"]',
  pickup:          '[data-test="orderPickupButton"]',
  preorder:        '[data-test="preorderButton"]',
  buyNow:          '[data-test="buyNowButton"]',
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
  retryMaxAttempts: 0, // 0 => run until user cancels
  retryDelayMs: 1000,
  retryWatchBaseMs: 900,
  retryWatchJitterMs: 250,
  retryMaxDelayMs: 7000,
  humanChallengeDelayMs: 12000,
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
      'useSavedPayment',
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
const CHECKOUT_START_KEY = 'tch:checkoutStart';
const CHECKOUT_MODE_KEY  = 'tch:checkoutMode';
const CHECKOUT_SPEEDS_STORAGE_KEY = 'checkoutSpeeds';
let checkoutRetryTimer = null;
let checkoutRetryScheduled = false;
let stockWatchTimer = null;
let stockWatchActive = false;
let stockWatchPolls = 0;
let runtimeEnabled = true;

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getRetryPolicy(settings) {
  const policy = settings?.retryPolicy || {};
  return {
    maxAttempts: clampInt(policy.maxAttempts, 0, 50, T.retryMaxAttempts),
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
  if (stockWatchTimer) {
    clearTimeout(stockWatchTimer);
    stockWatchTimer = null;
  }
  stockWatchActive = false;
  stockWatchPolls = 0;
  try { sessionStorage.removeItem(RETRY_STATE_KEY); } catch {}
  try { sessionStorage.removeItem(RETRY_NAV_MARK_KEY); } catch {}
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

function isStockWatchReason(reason) {
  return /ATC button not found|ATC button stayed disabled/i.test(reason);
}

function hasHumanVerificationChallenge() {
  const text = (document.body?.innerText || '').toLowerCase();
  return [
    'verify you are human',
    'are you human',
    'captcha',
    'unusual traffic',
    'security check',
    'robot',
  ].some((needle) => text.includes(needle));
}

function getNavigationRetryDelay(policy, attempt) {
  const growth = 1 + Math.min(Math.max(attempt - 1, 0) * 0.35, 2.0);
  const jitter = Math.floor(Math.random() * (T.retryWatchJitterMs + 1));
  return Math.min(Math.round(policy.delayMs * growth) + jitter, T.retryMaxDelayMs);
}

function getStockWatchDelay(policy, nullStreak = 0) {
  const base = Math.min(policy.delayMs, T.retryWatchBaseMs);
  const jitter = Math.floor(Math.random() * (T.retryWatchJitterMs + 1));
  const nullPenalty = Math.min(nullStreak * 500, 3000);
  return Math.min(base + jitter + nullPenalty, T.retryMaxDelayMs);
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
  if (!runtimeEnabled) return false;
  if (checkoutRetryScheduled) return true;

  const policy = getRetryPolicy(settings);
  const state = readRetryState();
  const nextAttempt = state.failedAttempts + 1;
  const unlimited = policy.maxAttempts === 0;
  const eventBase = {
    reason,
    page: getPageType(),
    url: location.href,
    ts: Date.now(),
    ...details,
  };

  if (!unlimited && nextAttempt > policy.maxAttempts) {
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
      mode: 'navigation',
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
  if (unlimited) {
    console.warn(`[TCH] retry attempt #${nextAttempt} (until canceled): ${reason}`);
  } else {
    console.warn(`[TCH] retry attempt ${nextAttempt}/${policy.maxAttempts}: ${reason}`);
  }

  if (isStockWatchReason(reason)) {
    // On the very first ATC failure, do a page reload before entering silent polling.
    // This resets any stale page state, re-authenticates the session, and gives the
    // product page one fresh chance to show the correct button state.
    if (!stockWatchActive && nextAttempt <= 1) {
      let delayMs = getNavigationRetryDelay(policy, nextAttempt);
      if (hasHumanVerificationChallenge()) {
        delayMs = Math.max(delayMs, T.humanChallengeDelayMs);
        console.warn('[TCH] challenge detected; slowing first-failure reload');
      }
      await reportRetryEvent({
        status: 'scheduled',
        attempt: nextAttempt,
        maxAttempts: policy.maxAttempts,
        mode: 'navigation',
        delayMs,
        ...eventBase,
      });
      if (unlimited) {
        showToast(`Reloading page to reset session (#${nextAttempt})…`, 'persistent');
      } else {
        showToast(`Retry ${nextAttempt}/${policy.maxAttempts}: reloading page…`, 'persistent');
      }
      checkoutRetryScheduled = true;
      checkoutRetryTimer = setTimeout(() => {
        if (!runtimeEnabled) return;
        checkoutRetryScheduled = false;
        checkoutRetryTimer = null;
        performRetryNavigation();
      }, delayMs);
      return true;
    }

    if (!stockWatchActive) {
      const watchUrl = getRememberedProductUrl() || normalizeProductUrl(location.href);
      const policyDelay = Math.max(1, Math.round(policy.delayMs / 1000));
      stockWatchActive = true;
      stockWatchPolls = 0;
      showToast(`Watching stock every ~${policyDelay}s…`, 'persistent');
      await reportRetryEvent({
        status: 'watching',
        attempt: nextAttempt,
        maxAttempts: policy.maxAttempts,
        mode: 'stock_watch',
        watchUrl,
        ...eventBase,
      });

      let nullStreak = 0;
      const poll = async () => {
        if (!runtimeEnabled || !stockWatchActive) return;
        const result = await streamingStockCheck(watchUrl);
        stockWatchPolls++;
        if (result === true) {
          const confirmResult = await streamingStockCheck(watchUrl, 8000, {
            requireFullParse: true,
          });
          if (confirmResult !== true) {
            stockWatchTimer = setTimeout(poll, getStockWatchDelay(policy, nullStreak));
            return;
          }
          stockWatchActive = false;
          if (stockWatchTimer) {
            clearTimeout(stockWatchTimer);
            stockWatchTimer = null;
          }
          console.log(`[TCH] stock watch detected in-stock after ${stockWatchPolls} polls`);
          await reportRetryEvent({
            status: 'stock_detected',
            attempt: nextAttempt,
            maxAttempts: policy.maxAttempts,
            mode: 'stock_watch',
            watchUrl,
            ...eventBase,
          });
          showToast('Stock detected — reloading now', 'success');
          markRetryNavigation(watchUrl);
          window.location.href = watchUrl;
          return;
        }

        if (result === null) {
          nullStreak++;
        } else {
          nullStreak = 0;
        }
        if (stockWatchPolls % 20 === 0) {
          console.log(`[TCH] stock watch polling: ${stockWatchPolls} checks`);
        }

        let delayMs = getStockWatchDelay(policy, nullStreak);
        if (hasHumanVerificationChallenge()) {
          delayMs = Math.max(delayMs, T.humanChallengeDelayMs);
          console.warn('[TCH] challenge detected; slowing stock watch polling');
        }
        stockWatchTimer = setTimeout(poll, delayMs);
      };
      stockWatchTimer = setTimeout(poll, getStockWatchDelay(policy, 0));
    }
    return true;
  }

  let delayMs = getNavigationRetryDelay(policy, nextAttempt);
  if (hasHumanVerificationChallenge()) {
    delayMs = Math.max(delayMs, T.humanChallengeDelayMs);
    console.warn('[TCH] challenge detected; slowing retry navigation cadence');
  }
  await reportRetryEvent({
    status: 'scheduled',
    attempt: nextAttempt,
    maxAttempts: policy.maxAttempts,
    mode: 'navigation',
    delayMs,
    ...eventBase,
  });
  if (unlimited) {
    showToast(`Retry #${nextAttempt} in ${Math.round(delayMs / 1000)}s`, 'persistent');
  } else {
    showToast(`Retry ${nextAttempt}/${policy.maxAttempts} in ${Math.round(delayMs / 1000)}s`, 'persistent');
  }

  checkoutRetryScheduled = true;
  checkoutRetryTimer = setTimeout(() => {
    if (!runtimeEnabled) return;
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

// main_world.js (declared in manifest.json with "world":"MAIN") runs in the
// page's full JavaScript context and writes window.__CONFIG__ values into
// document.documentElement dataset attributes, then fires '__tch_api_key__'.
// This isolated-world content script reads those attributes and forwards the
// key to the background SW via chrome.storage.
function cacheApiKeyWhenReady() {
  const read = () => {
    const apiKey    = document.documentElement.dataset.tchKey    || '';
    const redskyBase = document.documentElement.dataset.tchRedsky || 'https://redsky.target.com';
    if (!apiKey) return;
    console.log('[TCH] API key received from main world, caching for SW');
    chrome.storage.local.set({ bgApiKey: apiKey, bgRedskyBase: redskyBase })
      .then(() => chrome.runtime.sendMessage({ type: 'CACHE_API_KEY', apiKey, redskyBase }).catch(() => {}))
      .catch(() => {});
  };

  // Key may already be present if main_world.js ran before us.
  read();
  // Otherwise wait for main_world.js to fire the ready signal.
  document.documentElement.addEventListener('__tch_api_key__', read, { once: true });
}

function prefetchCheckout() {
  if (document.querySelector('link[data-tch-prefetch]')) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = 'https://www.target.com/checkout';
  link.setAttribute('data-tch-prefetch', '1');
  document.head.appendChild(link);
}

function markCheckoutStart(mode) {
  try {
    sessionStorage.setItem(CHECKOUT_START_KEY, String(Date.now()));
    sessionStorage.setItem(CHECKOUT_MODE_KEY, mode);
  } catch {}
}

async function recordCheckoutSpeed(mode, durationMs) {
  try {
    const data = await chrome.storage.local.get(CHECKOUT_SPEEDS_STORAGE_KEY);
    const entries = Array.isArray(data[CHECKOUT_SPEEDS_STORAGE_KEY])
      ? data[CHECKOUT_SPEEDS_STORAGE_KEY] : [];
    entries.push({ mode, durationMs, ts: Date.now() });
    if (entries.length > 20) entries.splice(0, entries.length - 20);
    await chrome.storage.local.set({ [CHECKOUT_SPEEDS_STORAGE_KEY]: entries });
  } catch {}
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

function getCheckoutStep(useSavedPayment = false) {
  if (document.querySelector(SEL.placeOrder) || findByText('place order')) return 'review';
  if (document.querySelector(SEL.cardNumber)) return 'payment';
  if (['input[id*="firstName"]', 'input[name="firstName"]', 'input[autocomplete="given-name"]']
    .some(s => document.querySelector(s))) return 'shipping';
  // When using saved payment, a pre-populated step shows a Continue button with no form fields.
  if (useSavedPayment && findContinueButton(true)) return 'saved';
  return 'unknown';
}

// ─── STEP HANDLERS ───────────────────────────────────────────────────────────

async function handleProductPage(settings) {
  console.log('[TCH] handleProductPage');
  prefetchCheckout();
  const fromRetryNavigation = consumeRetryNavigationMark();
  if (!fromRetryNavigation) clearCheckoutRetryState();
  rememberProductUrl(location.href);

  // When useSavedPayment: try Buy It Now first — instant checkout using account's saved info.
  if (settings.useSavedPayment) {
    const buyNowBtn = findFirst(SEL.buyNow) || findByText('buy it now');
    if (buyNowBtn && !buyNowBtn.disabled) {
      console.log('[TCH] clicking Buy It Now (saved payment mode)');
      markCheckoutStart('saved');
      buyNowBtn.click();
      showToast('Buy It Now → checkout…');
      setNavigationMark('product_to_checkout');
      return;
    }
  }

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

  if (settings.useSavedPayment) {
    // For preorder/ATC: wait for the "View Cart & Check Out" modal button, which routes
    // through the cart and uses the account's saved payment & address at checkout.
    markCheckoutStart('saved');
    showToast('ATC → waiting for checkout…');
    try {
      const viewCartBtn = await waitForAny([{ sel: SEL.viewCart }], 3000);
      setNavigationMark('product_to_checkout');
      viewCartBtn.click();
      return;
    } catch {
      // Modal didn't appear; fall through to immediate navigate
      console.log('[TCH] viewCart modal not found; falling back to direct navigate');
    }
  }

  markCheckoutStart('formfill');
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
  const step = getCheckoutStep(settings.useSavedPayment);
  console.log('[TCH] checkout step:', step);
  if (step === 'shipping')    return handleShippingStep(settings);
  if (step === 'payment')     return handlePaymentStep(settings);
  if (step === 'review')      return handleReviewStep(settings);
  if (step === 'saved')       return handleSavedStep(settings);
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
    else if (step === 'saved') await handleSavedStep(settings);
  };

  const observer = new MutationObserver(async () => {
    if (handled) return;
    await runStep(getCheckoutStep(settings.useSavedPayment));
  });
  checkoutStepObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });
  checkoutStepPollId = setInterval(() => {
    runStep(getCheckoutStep(settings.useSavedPayment));
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

  // When useSavedPayment and no address form is visible, a saved address is pre-selected —
  // just click Continue rather than trying to fill non-existent inputs.
  if (settings.useSavedPayment) {
    const hasFormFields = ['input[id*="firstName"]', 'input[name="firstName"]',
      'input[autocomplete="given-name"]'].some(sel => document.querySelector(sel));
    if (!hasFormFields) {
      console.log('[TCH] shipping: saved address detected (no form), clicking continue');
      const continueClicked = await waitAndClickContinue(5000);
      if (continueClicked) {
        const addrObs = new MutationObserver(() => {
          const useAddr = findByText('use this address') || findByText('save and continue')
            || findByText('use as entered') || findByText('suggested address');
          if (useAddr && !useAddr.disabled) { useAddr.click(); addrObs.disconnect(); }
        });
        addrObs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => addrObs.disconnect(), 5000);
        watchForCheckoutStep(settings);
        return;
      }
      await scheduleCheckoutRetry(settings, 'Saved address continue button unavailable');
      return;
    }
  }

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

  // When useSavedPayment and no card number input is visible, a saved payment method is
  // pre-selected — just click Continue rather than trying to fill non-existent inputs.
  if (settings.useSavedPayment) {
    const hasCardInput = !!document.querySelector(SEL.cardNumber);
    if (!hasCardInput) {
      console.log('[TCH] payment: saved payment detected (no card input), clicking continue');
      const continueClicked = await waitAndClickContinue(5000);
      if (continueClicked) {
        waitForAny([
          { sel: SEL.placeOrder }, { text: 'place order' },
        ], 15000).then(() => handleReviewStep(settings)).catch(() => watchForCheckoutStep(settings));
        return;
      }
      await scheduleCheckoutRetry(settings, 'Saved payment continue button unavailable');
      return;
    }
  }

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

async function handleSavedStep(settings) {
  console.log('[TCH] handleSavedStep: saved checkout data shown, clicking continue');
  markCheckoutFlow('saved_step_start');
  const continueClicked = await waitAndClickContinue(5000);
  if (continueClicked) {
    watchForCheckoutStep(settings);
    return;
  }
  await scheduleCheckoutRetry(settings, 'Saved checkout continue button unavailable');
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

  // Record end-to-end checkout speed for comparison between saved-payment and form-fill modes.
  try {
    const startMs = parseInt(sessionStorage.getItem(CHECKOUT_START_KEY) || '0', 10);
    const mode = sessionStorage.getItem(CHECKOUT_MODE_KEY) || 'formfill';
    if (startMs > 0) {
      const durationMs = Date.now() - startMs;
      console.log(`[TCH] checkout speed (${mode}): ${durationMs}ms`);
      sessionStorage.removeItem(CHECKOUT_START_KEY);
      sessionStorage.removeItem(CHECKOUT_MODE_KEY);
      await recordCheckoutSpeed(mode, durationMs);
    }
  } catch {}

  await markCheckoutSuccess();
  showToast('Reached review — Place Order remains manual.', 'persistent');
}

// ─── MONITOR MODE ────────────────────────────────────────────────────────────

const OOS_STRINGS = ['Preorders have sold out', 'Out of stock', 'Sold out',
  'This item is not available', 'Item not available', 'Currently unavailable'];
const WEAK_IN_STOCK_STRINGS = ['>Add to cart<'];
const FULFILLMENT_SELLABLE_STATUSES = new Set([
  'IN_STOCK',
  'LIMITED_STOCK',
  'PRE_ORDER_SELLABLE',
  'BACKORDER_AVAILABLE',
  'BACKORDERED',
  'AVAILABLE',
]);
const FULFILLMENT_BLOCKED_RE = /(OUT_OF_STOCK|UNSELLABLE|UNAVAILABLE|NOT_AVAILABLE|NO_INVENTORY|INVENTORY_UNAVAILABLE)/i;
const ENABLED_ATC_PATTERNS = [
  { name: 'ship_it_enabled', regex: /<button\b(?=[^>]*data-test=["']shipItButton["'])(?![^>]*\bdisabled\b)[^>]*>/i },
  { name: 'shipping_enabled', regex: /<button\b(?=[^>]*data-test=["']shippingButton["'])(?![^>]*\bdisabled\b)[^>]*>/i },
  { name: 'pickup_enabled', regex: /<button\b(?=[^>]*data-test=["']orderPickupButton["'])(?![^>]*\bdisabled\b)[^>]*>/i },
  { name: 'preorder_enabled', regex: /<button\b(?=[^>]*data-test=["']preorderButton["'])(?![^>]*\bdisabled\b)[^>]*>/i },
  { name: 'sticky_atc_enabled', regex: /<[^>]*data-test=["']StickyAddToCart["'][\s\S]{0,240}<button\b(?![^>]*\bdisabled\b)[^>]*>/i },
  { name: 'fulfillment_add_to_cart_enabled', regex: /fulfillmentSectionAddToCartButtonWrapper[\s\S]{0,260}<button\b(?![^>]*\bdisabled\b)[^>]*>\s*add to cart\s*<\/button>/i },
];
const DISABLED_ATC_PATTERNS = [
  { name: 'ship_it_disabled', regex: /<button\b(?=[^>]*data-test=["']shipItButton["'])(?=[^>]*\bdisabled\b)[^>]*>/i },
  { name: 'shipping_disabled', regex: /<button\b(?=[^>]*data-test=["']shippingButton["'])(?=[^>]*\bdisabled\b)[^>]*>/i },
  { name: 'pickup_disabled', regex: /<button\b(?=[^>]*data-test=["']orderPickupButton["'])(?=[^>]*\bdisabled\b)[^>]*>/i },
  { name: 'preorder_disabled', regex: /<button\b(?=[^>]*data-test=["']preorderButton["'])(?=[^>]*\bdisabled\b)[^>]*>/i },
  { name: 'sticky_atc_disabled', regex: /<[^>]*data-test=["']StickyAddToCart["'][\s\S]{0,240}<button\b(?=[^>]*\bdisabled\b)[^>]*>/i },
  { name: 'fulfillment_add_to_cart_disabled', regex: /fulfillmentSectionAddToCartButtonWrapper[\s\S]{0,260}<button\b(?=[^>]*\bdisabled\b)[^>]*>\s*add to cart\s*<\/button>/i },
];

function findCaseInsensitiveStringMatch(haystack, needles) {
  const lowerHaystack = haystack.toLowerCase();
  for (const needle of needles) {
    if (lowerHaystack.includes(needle.toLowerCase())) return needle;
  }
  return null;
}

function findRegexSignalMatch(haystack, patterns) {
  for (const pattern of patterns) {
    if (pattern.regex.test(haystack)) return pattern.name;
  }
  return null;
}

function analyzeStockSignals(html) {
  return {
    oosMatch: findCaseInsensitiveStringMatch(html, OOS_STRINGS),
    weakInStockMatch: findCaseInsensitiveStringMatch(html, WEAK_IN_STOCK_STRINGS),
    enabledATCMatch: findRegexSignalMatch(html, ENABLED_ATC_PATTERNS),
    disabledATCMatch: findRegexSignalMatch(html, DISABLED_ATC_PATTERNS),
  };
}

function extractTcinFromUrl(url) {
  try {
    const parsed = new URL(url, location.href);
    const pathMatch = parsed.pathname.match(/\/A-(\d{6,10})/i);
    if (pathMatch?.[1]) return pathMatch[1];
    const queryTcin = parsed.searchParams.get('tcin');
    if (queryTcin && /^\d{6,10}$/.test(queryTcin)) return queryTcin;
    return null;
  } catch {
    return null;
  }
}

function buildFulfillmentApiUrl(productUrl) {
  const tcin = extractTcinFromUrl(productUrl);
  if (!tcin) return null;

  const cfg = window.__CONFIG__?.services || {};
  const baseUrl = (cfg.redsky?.baseUrl || 'https://redsky.target.com').replace(/\/$/, '');
  const endpoint = (cfg.redsky?.apis?.redskyAggregations?.endpointPaths?.productFulfillment
    || 'redsky_aggregations/v1/web/product_fulfillment_v1').replace(/^\/+/, '');
  const apiKey = cfg.auth?.apiKey || cfg.apiPlatform?.apiKey || '';
  if (!apiKey) return null;

  return `${baseUrl}/${endpoint}?key=${encodeURIComponent(apiKey)}&tcin=${encodeURIComponent(tcin)}`;
}

function parseFulfillmentStockStatus(payload) {
  const fulfillment = payload?.data?.product?.fulfillment;
  if (!fulfillment || typeof fulfillment !== 'object') {
    return { result: null, status: '', qty: 0, soldOut: false, oosAllStores: false };
  }

  const shipping = fulfillment.shipping_options || {};
  const status = String(shipping.availability_status || '').toUpperCase();
  const qtyValue = Number(shipping.available_to_promise_quantity);
  const qty = Number.isFinite(qtyValue) ? qtyValue : 0;
  const soldOut = fulfillment.sold_out === true;
  const oosAllStores = fulfillment.is_out_of_stock_in_all_store_locations === true;

  const sellable = qty > 0 || FULFILLMENT_SELLABLE_STATUSES.has(status);
  const blocked = soldOut
    || FULFILLMENT_BLOCKED_RE.test(status)
    || (oosAllStores && qty <= 0 && !sellable);

  if (sellable) {
    return { result: true, status, qty, soldOut, oosAllStores };
  }
  if (blocked) {
    return { result: false, status, qty, soldOut, oosAllStores };
  }
  return { result: null, status, qty, soldOut, oosAllStores };
}

async function checkStockFromFulfillmentApi(url, timeoutMs = 3000) {
  const fulfillmentUrl = buildFulfillmentApiUrl(url);
  if (!fulfillmentUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(fulfillmentUrl, {
      cache: 'no-store',
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const payload = await res.json();
    const parsed = parseFulfillmentStockStatus(payload);
    return parsed.result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function checkStockFromHTML(html) {
  const signals = analyzeStockSignals(html);
  if (signals.enabledATCMatch) return true;
  if (signals.oosMatch || signals.disabledATCMatch) return false;
  // Weak "Add to cart" text appears in disabled/preorder contexts; treat as inconclusive.
  if (signals.weakInStockMatch) return false;
  return false;
}

// Stock check uses RedSky fulfillment API first (authoritative + fast).
// If unavailable, it falls back to streaming page HTML with conservative parsing.
async function streamingStockCheck(url, timeoutMs = 8000, options = null) {
  const requireFullParse = options?.requireFullParse === true;
  const fulfillmentResult = await checkStockFromFulfillmentApi(url, Math.min(timeoutMs, 3000));
  if (fulfillmentResult !== null) {
    return fulfillmentResult;
  }

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
    let loggedWeakCandidate = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const signals = analyzeStockSignals(buf);
      // A disabled button is unambiguous — item is OOS; no need to read further.
      if (signals.disabledATCMatch) {
        reader.cancel();
        return false;
      }
      // An enabled button takes priority over any OOS text that may appear earlier in
      // the HTML stream (e.g. "Preorders have sold out" above the button on restock).
      if (signals.enabledATCMatch) {
        if (!requireFullParse) {
          reader.cancel();
          return true;
        }
      } else if (signals.weakInStockMatch && !loggedWeakCandidate) {
        loggedWeakCandidate = true;
      }
      // OOS text alone does NOT cancel the read — button state is authoritative.
      // checkStockFromHTML at end checks enabledATCMatch first.
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

    // Decline any protection/coverage upsell modal immediately.
    setTimeout(() => { const c = document.querySelector(SEL.declineCoverage); if (c) c.click(); }, 300);

    // Wait for a cart-confirmation modal or any sign the item was added.
    // Preorder buttons can be slower than regular ATC; allow up to 5 seconds.
    let cartConfirmed = false;
    try {
      await waitForAny([
        { sel: SEL.viewCart },
        { text: 'continue shopping' }, { text: 'view cart' },
        { text: 'view cart & check out' }, { text: 'go to cart' },
        { text: 'item added' }, { text: 'added to cart' },
      ], 5000);
      cartConfirmed = true;
    } catch { /* modal didn't appear — item may still have been added */ }

    // Dismiss "continue shopping" so the monitor tab stays on the product page.
    const dismissBtn = findByText('continue shopping');
    if (dismissBtn) dismissBtn.click();

    showToast(`Monitor: Added! (${currentCount + 1}/${product.qty})`, 'success');
    console.log(`[TCH] monitor ATC: cart confirmed=${cartConfirmed}`);
    chrome.runtime.sendMessage({ type: 'ATC_SUCCESS', url: normUrl });
    return;
  }

  // Streaming fetch polling — reads chunks, terminates early on match
  let pollCount = 0;
  showToast(`Monitor: Polling every ${interval}s (no reload)…`, 'persistent');
  console.log('[TCH] passive polling for', normUrl);

  const pollId = setInterval(async () => {
    if (!runtimeEnabled) {
      clearInterval(pollId);
      return;
    }
    pollCount++;
    const result = await streamingStockCheck(normUrl);
    if (result === true) {
      const confirmResult = await streamingStockCheck(normUrl, 8000, {
        requireFullParse: true,
      });
      if (confirmResult !== true) {
        return;
      }
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
  runtimeEnabled = !!data.enabled;
  const page = getPageType();
  console.log('[TCH] init:', page, 'enabled:', data.enabled, 'monitor:', !!data.monitor?.active);

  // Target sets window.__CONFIG__ asynchronously after document_end, so retry
  // until it's populated (up to 10 seconds) then write to storage for the SW.
  cacheApiKeyWhenReady();

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

  if (!data.enabled) {
    clearCheckoutRetryState();
    stopInit('disabled');
    return;
  }
  const hasData = data.useSavedPayment
    || (data.shipping && Object.values(data.shipping).some(Boolean))
    || (data.payment && Object.values(data.payment).some(Boolean));
  if (!hasData) { showToast('Open popup to add your info', 'error'); stopInit('missing_settings'); return; }

  const settings = {
    shipping: data.shipping || {},
    payment: data.payment || {},
    retryPolicy: data.retryPolicy || {},
    useSavedPayment: !!data.useSavedPayment,
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
  if (message.type === 'REQUEST_API_KEY') {
    try {
      const apiKey = window.__CONFIG__?.services?.auth?.apiKey
                  || window.__CONFIG__?.services?.apiPlatform?.apiKey || '';
      const redskyBase = window.__CONFIG__?.services?.redsky?.baseUrl || '';
      if (apiKey) {
        chrome.runtime.sendMessage({ type: 'CACHE_API_KEY', apiKey, redskyBase }).catch(() => {});
      }
    } catch {}
    return;
  }

  if (message.type === 'SETTINGS_UPDATED') {
    invalidateCache();
    runtimeEnabled = !!message.enabled;
    if (!runtimeEnabled) {
      clearCheckoutRetryState();
      document.getElementById('tch-toast')?.remove();
      reportRetryEvent({
        status: 'cancelled',
        reason: 'Manual cancel',
        page: getPageType(),
        url: location.href,
        ts: Date.now(),
      });
      return;
    }
    init();
  }
});

// ─── GO ──────────────────────────────────────────────────────────────────────

if (document.body) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init, { once: true });
}
