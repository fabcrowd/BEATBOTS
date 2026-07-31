// samsclub-content.js — Sam's Club Checkout Helper
// Injected into *.samsclub.com pages. FCFS retailer — no Walmart queue lock (SC-5).

const SC_SEL = {
  atc:
    'button[data-testid="add-to-cart"], button[data-automation-id="add-to-cart-btn"], button[aria-label*="Add to cart" i]',
  viewCart: 'a[href="/cart"], button[data-testid="go-to-cart"], a[href*="/cart"]',
};

let scSettingsCache = null;
let scInitInFlight = false;

async function scGetSettings() {
  if (!scSettingsCache) {
    scSettingsCache = await chrome.storage.local
      .get([
        'enabled',
        'monitor',
        'shipping',
        'payment',
        'useSavedPayment',
      ])
      .catch(() => ({}));
  }
  return scSettingsCache;
}

function scInvalidateCache() {
  scSettingsCache = null;
}

function scGetPageType() {
  const path = location.pathname;
  if (/\/p\//.test(path) || /\/ip\//.test(path) || /\/prod\//.test(path)) return 'product';
  if (path.includes('/cart')) return 'cart';
  if (path.includes('/checkout')) return 'checkout';
  return 'other';
}

const scSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function scIsVisible(el) {
  if (!el) return false;
  try {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
  } catch (_) {}
  return true;
}

function scFindByText(text) {
  const lower = text.toLowerCase();
  const nodes = document.querySelectorAll('button, a[role="button"]');
  for (const el of nodes) {
    if (el.textContent.trim().toLowerCase().includes(lower)) return el;
  }
  return null;
}

function scFindAtcButton() {
  for (const sel of SC_SEL.atc.split(', ')) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return scFindByText('add to cart');
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

/** SC-5: FCFS success — ATC_SUCCESS only, never sacred lock / queue messages. */
function scSignalAtcSuccess(productUrl) {
  const url = productUrl || location.href;
  try {
    chrome.runtime.sendMessage({ type: 'ATC_SUCCESS', url });
  } catch (_) {}
}

/** Release background navigation lock when FCFS ATC cannot proceed (no sacred lock). */
function scSignalNavFailed(url) {
  try {
    chrome.runtime.sendMessage({ type: 'SAMS_NAV_FAILED', url: url || location.href });
  } catch (_) {}
}

/**
 * SC-3: FCFS product-page ATC — wait for enabled button, click, signal success, go to cart.
 * No Walmart queue wait or sacred lock semantics.
 */
async function scHandleProductPage(settings) {
  const atcBtn = await scWaitFor(() => {
    const el = scFindAtcButton();
    if (el && !el.disabled && scIsVisible(el)) return el;
    return null;
  }, 8000);

  if (!atcBtn) {
    console.log('[SC] ATC not available — releasing navigation lock (FCFS, no queue wait)');
    scSignalNavFailed(location.href);
    return;
  }

  console.log('[SC] Clicking ATC (FCFS)');
  atcBtn.click();
  scSignalAtcSuccess(settings?.productUrl || location.href);
  await scSleep(1500);

  const cartLink =
    document.querySelector(SC_SEL.viewCart) ||
    scFindByText('view cart') ||
    scFindByText('go to cart');
  if (cartLink && scIsVisible(cartLink)) {
    cartLink.click();
  } else {
    console.log('[SC] No cart link found after ATC — navigating directly to /cart');
    window.location.href = 'https://www.samsclub.com/cart';
  }
}

async function scInit() {
  if (scInitInFlight) return;
  scInitInFlight = true;
  try {
    if (typeof TCH_HOSTS !== 'undefined' && TCH_HOSTS.detectRetailer) {
      if (TCH_HOSTS.detectRetailer(location.href) !== 'samsclub') return;
    }

    const data = await scGetSettings();
    const page = scGetPageType();
    console.log(
      '[TCH] init:',
      page,
      'enabled:',
      !!data.enabled,
      'monitor:',
      !!data.monitor?.active,
      'retailer: samsclub'
    );

    if (!data.enabled) return;

    const allProducts = data.monitor?.products || [];
    const samsProducts = allProducts.filter((p) => {
      try {
        return TCH_HOSTS.detectRetailer(p.url) === 'samsclub';
      } catch {
        return /samsclub\.com/i.test(p.url);
      }
    });
    const matchedProduct =
      page === 'product'
        ? samsProducts.find((p) => {
            try {
              return new URL(p.url).pathname === location.pathname;
            } catch {
              return false;
            }
          })
        : samsProducts[0] || null;

    const hasData = !!(data.shipping?.firstName || data.payment?.cardNumber || data.useSavedPayment);
    const hasMonitor = !!(data.monitor?.active && samsProducts.length > 0);
    if (!hasData && !hasMonitor) {
      console.log('[SC] No settings configured — skipping automation');
      return;
    }

    const settings = {
      productUrl: matchedProduct?.url || null,
    };

    if (page === 'product') {
      await scHandleProductPage(settings);
    }
  } finally {
    scInitInFlight = false;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_UPDATED') {
    scInvalidateCache();
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
