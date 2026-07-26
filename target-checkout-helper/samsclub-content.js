// samsclub-content.js — Sam's Club Checkout Helper (SC-1 / SC-3)
// Injected into *.samsclub.com pages. FCFS retailer — no Walmart queue lock (SC-5).

// ─── SELECTORS ───────────────────────────────────────────────────────────────

const SC_SEL = {
  atc:
    '[data-automation-id="add-to-cart-btn"], button[data-automation-id="atc-button"], button[class*="AddToCartButton"], button[class*="add-to-cart"]',
  viewCart: 'a[href="/cart"], button[data-automation-id="go-to-cart-btn"]',
  checkout: '[data-automation-id="checkout-btn"], a[href^="/checkout"]',
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
    ]).catch(() => ({}));
  }
  return scSettingsCache;
}

function scInvalidateCache() {
  scSettingsCache = null;
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

const scSleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    chrome.runtime.sendMessage({ type: 'NAV_FAILED', url });
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
    console.log('[SC] ATC button not found or disabled — FCFS restock wait, releasing nav lock');
    scSignalNavFailed(settings.productUrl || location.href);
    return;
  }

  scShowToast('Adding to cart…', 'persistent');
  console.log('[SC] Clicking ATC button');
  atcBtn.click();
  scSignalAtcSuccess(settings.productUrl || location.href);

  // SC-5/SC-6: multi-qty monitor — stay on product so background poll can re-arm
  // navigationLock (/cart trips isInCheckoutFlow and blocks poll recovery).
  const data = await scGetSettings();
  const mon = data.monitor;
  if (mon?.active && settings.productUrl) {
    try {
      const pathNorm = new URL(settings.productUrl).pathname;
      const matched = (mon.products || []).find((p) => {
        try {
          return new URL(p.url).pathname === pathNorm;
        } catch {
          return false;
        }
      });
      if (matched && (matched.qty || 1) > 1) {
        console.log('[SC] Multi-qty monitor — staying on product for poll recovery');
        return;
      }
    } catch (_) {}
  }

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
  };

  if (page === 'product') {
    await scHandleProductPage(settings);
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

function scScheduleInit() {
  if (document.body) scInit();
  else document.addEventListener('DOMContentLoaded', scInit, { once: true });
}

// Poll may reload the tab while scInit is waiting for ATC — allow the next pass to run.
window.addEventListener('pageshow', () => {
  scInitInFlight = false;
  scScheduleInit();
});

scScheduleInit();
