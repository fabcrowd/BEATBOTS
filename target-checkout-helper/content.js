// content.js — Target Checkout Helper (speed-optimized)
// Injected into all target.com pages. Drives the checkout flow automatically.

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

// ─── TIMING (aggressive — every ms counts) ──────────────────────────────────

const T = {
  observerTimeout: 10000,
  navSettleDelay:  50,
};

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

function waitForElement(selector, timeout = T.observerTimeout) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const timer = setTimeout(() => { observer.disconnect(); reject(); }, timeout);
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { clearTimeout(timer); observer.disconnect(); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function findFirst(...selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeProductUrl(url) {
  try { const u = new URL(url); return u.origin + u.pathname.replace(/\/$/, ''); }
  catch { return url; }
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
  toast.innerHTML = `<span style="margin-right:6px">🎯</span>${message}`;
  document.body.appendChild(toast);
  if (type !== 'persistent') {
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
  }
}

function findByText(text) {
  const lower = text.toLowerCase();
  return Array.from(document.querySelectorAll('a, button')).find(
    (el) => el.textContent.trim().toLowerCase().includes(lower)
  ) || null;
}

function waitForByText(text, timeout = T.observerTimeout) {
  const lower = text.toLowerCase();
  return new Promise((resolve, reject) => {
    const find = () => Array.from(document.querySelectorAll('a, button')).find(
      (el) => el.textContent.trim().toLowerCase().includes(lower)
    ) || null;
    const el = find();
    if (el) return resolve(el);
    const timer = setTimeout(() => { observer.disconnect(); reject(); }, timeout);
    const observer = new MutationObserver(() => {
      const el = find();
      if (el) { clearTimeout(timer); observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function clickContinue() {
  const patterns = ['save & continue', 'save and continue', 'continue', 'next'];
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const pattern of patterns) {
    const btn = buttons.find(
      (b) => b.textContent.trim().toLowerCase().startsWith(pattern) && !b.disabled
    );
    if (btn) { btn.click(); return true; }
  }
  return false;
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
    .some((s) => document.querySelector(s))) return 'shipping';
  return 'unknown';
}

// ─── STEP HANDLERS (speed-optimized: zero unnecessary sleeps) ────────────────

async function handleProductPage() {
  console.log('[TCH] handleProductPage');
  let addBtn;
  try {
    addBtn = await Promise.any([
      waitForElement(SEL.shipIt, 6000),
      waitForElement(SEL.pickup, 6000),
      waitForElement(SEL.preorder, 6000),
      waitForElement(SEL.stickyATC, 6000),
      waitForByText('add to cart', 6000),
      waitForByText('preorder', 6000),
    ]);
  } catch { showToast('ATC button not found', 'error'); return; }

  // Wait for button to become enabled — React replaces DOM nodes during render,
  // so we must re-query each iteration to avoid stale references.
  for (let i = 0; addBtn.disabled && i < 60; i++) {
    await sleep(100);
    addBtn = findFirst(SEL.shipIt, SEL.pickup, SEL.preorder, SEL.stickyATC)
      || findByText('add to cart') || findByText('preorder') || addBtn;
  }
  if (addBtn.disabled) {
    console.log('[TCH] button still disabled after wait');
    showToast('Button still disabled', 'error');
    return;
  }

  console.log('[TCH] clicking ATC');
  addBtn.click();

  // Don't wait for confirmation panel — navigate to checkout IMMEDIATELY.
  // Item is in cart server-side as soon as the click's XHR completes.
  // Fire coverage decline in background (non-blocking) just in case.
  setTimeout(() => {
    const cov = document.querySelector(SEL.declineCoverage);
    if (cov) cov.click();
  }, 400);

  showToast('ATC → checkout…');
  window.location.href = 'https://www.target.com/checkout';
}

async function handleCartPage() {
  console.log('[TCH] handleCartPage');
  try {
    const btn = await Promise.any([
      waitForElement(SEL.cartCheckout, 6000),
      waitForByText('check out', 6000),
      waitForByText('sign in to check out', 6000),
    ]);
    btn.click();
  } catch {
    window.location.href = 'https://www.target.com/checkout';
  }
}

async function handleCheckoutPage(settings) {
  const step = getCheckoutStep();
  console.log('[TCH] checkout step:', step);
  if (step === 'shipping')    return handleShippingStep(settings);
  if (step === 'payment')     return handlePaymentStep(settings);
  if (step === 'review')      return handleReviewStep();
  watchForCheckoutStep(settings);
}

function watchForCheckoutStep(settings) {
  let handled = false;
  const observer = new MutationObserver(async () => {
    if (handled) return;
    const step = getCheckoutStep();
    if (step === 'unknown') return;
    handled = true;
    observer.disconnect();
    if (step === 'shipping')    await handleShippingStep(settings);
    else if (step === 'payment') await handlePaymentStep(settings);
    else if (step === 'review')  await handleReviewStep();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30000);
}

async function handleShippingStep(settings) {
  const s = settings.shipping || {};
  console.log('[TCH] filling shipping');

  // Fill ALL fields in one synchronous burst — zero delay between fields
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

  // Tiny yield so React processes the fills, then click continue
  await sleep(30);
  clickContinue();

  // Handle address suggestion popup in background
  setTimeout(() => {
    const useAddr = findByText('use this address') || findByText('save and continue')
      || findByText('use as entered') || findByText('suggested address');
    if (useAddr && !useAddr.disabled) useAddr.click();
  }, 800);

  setTimeout(() => watchForCheckoutStep(settings), 200);
}

async function handlePaymentStep(settings) {
  const p = settings.payment || {};
  console.log('[TCH] filling payment');

  // Fill all payment fields in one synchronous burst
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

  await sleep(30);
  if (clickContinue()) {
    Promise.any([
      waitForElement(SEL.placeOrder, 15000),
      waitForByText('place order', 15000),
    ]).then(() => handleReviewStep()).catch(() => {});
  }
}

async function handleReviewStep() {
  console.log('[TCH] placing order');
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const placeBtn = await Promise.any([
        waitForElement(SEL.placeOrder, 4000),
        waitForByText('place order', 4000),
      ]);
      if (placeBtn.disabled) { await sleep(200); continue; }
      placeBtn.click();
      showToast('Order submitted!', 'success');
      return;
    } catch {
      if (attempt < 5) await sleep(200);
    }
  }
  showToast('Could not place order — click manually', 'persistent');
}

// ─── MONITOR MODE ────────────────────────────────────────────────────────────

function checkStockFromHTML(html) {
  const OOS = ['Preorders have sold out', 'Out of stock', 'Sold out',
    'This item is not available', 'Item not available', 'Currently unavailable'];
  for (const s of OOS) { if (html.includes(s)) return false; }
  return html.includes('shippingButton') || html.includes('shipItButton')
    || html.includes('orderPickupButton') || html.includes('>Add to cart<');
}

async function handleMonitoredATC(monitor, product) {
  console.log('[TCH] monitor ATC for', product.url);
  const normUrl = normalizeProductUrl(product.url);
  const currentCount = monitor.counts?.[normUrl] || 0;
  const interval = monitor.refreshInterval || 1;

  if (currentCount >= product.qty) return;

  // Try ATC on current DOM
  let addBtn = findFirst(SEL.shipIt, SEL.pickup, SEL.preorder, SEL.stickyATC)
    || findByText('add to cart') || findByText('preorder');

  if (!addBtn) {
    try {
      addBtn = await Promise.any([
        waitForElement(SEL.shipIt, 2000),
        waitForElement(SEL.pickup, 2000),
        waitForElement(SEL.preorder, 2000),
        waitForByText('add to cart', 2000),
        waitForByText('preorder', 2000),
      ]);
    } catch { addBtn = null; }
  }

  const pageOOS = /sold out|out of stock|currently unavailable|item not available/i.test(
    document.body?.innerText || ''
  );

  // Wait for button to enable if disabled during React render
  if (addBtn && addBtn.disabled && !pageOOS) {
    for (let i = 0; i < 30; i++) { await sleep(100); if (!addBtn.disabled) break; }
  }

  if (addBtn && !addBtn.disabled && !pageOOS) {
    showToast(`Monitor: ATC (${currentCount + 1}/${product.qty})…`);
    addBtn.click();

    setTimeout(() => { const c = document.querySelector(SEL.declineCoverage); if (c) c.click(); }, 300);

    // Brief wait for ATC XHR to complete, then report success
    await sleep(800);
    const dismissBtn = findByText('continue shopping');
    if (dismissBtn) dismissBtn.click();

    showToast(`Monitor: Added! (${currentCount + 1}/${product.qty})`, 'success');
    chrome.runtime.sendMessage({ type: 'ATC_SUCCESS', url: normUrl });
    return;
  }

  // Passive fetch polling — no page reloads
  let pollCount = 0;
  showToast(`Monitor: Polling every ${interval}s (no reload)…`, 'persistent');
  console.log('[TCH] passive polling for', normUrl);

  const pollId = setInterval(async () => {
    pollCount++;
    try {
      const res = await fetch(location.href, {
        cache: 'no-store', credentials: 'include',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      });
      if (!res.ok) return;
      const html = await res.text();
      if (checkStockFromHTML(html)) {
        clearInterval(pollId);
        console.log('[TCH] STOCK DETECTED after', pollCount, 'polls');
        showToast('STOCK DETECTED — reloading!', 'success');
        location.reload();
      } else if (pollCount % 10 === 0) {
        showToast(`Polling… (${pollCount} checks)`, 'persistent');
      }
    } catch {}
  }, interval * 1000);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function init() {
  const data = await chrome.storage.local.get(['enabled', 'shipping', 'payment', 'monitor']);
  const page = getPageType();
  console.log('[TCH] init:', page, 'enabled:', data.enabled, 'monitor:', !!data.monitor?.active);

  if (data.monitor?.active && page === 'product') {
    const normUrl = normalizeProductUrl(location.href);
    const product = (data.monitor.products || []).find(
      (p) => normalizeProductUrl(p.url) === normUrl
    );
    if (product) { await handleMonitoredATC(data.monitor, product); return; }
  }

  if (!data.enabled) return;
  const hasData = (data.shipping && Object.values(data.shipping).some(Boolean))
    || (data.payment && Object.values(data.payment).some(Boolean));
  if (!hasData) { showToast('Open popup to add your info', 'error'); return; }

  const settings = { shipping: data.shipping || {}, payment: data.payment || {} };
  if (page === 'product')      await handleProductPage();
  else if (page === 'cart')    await handleCartPage();
  else if (page === 'checkout') await handleCheckoutPage(settings);
  else if (page === 'confirmation') showToast('Order placed!', 'success');
}

// ─── SPA NAV WATCHER ─────────────────────────────────────────────────────────

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    document.getElementById('tch-toast')?.remove();
    setTimeout(init, T.navSettleDelay);
  }
}).observe(document, { subtree: true, childList: true });

// ─── MESSAGE LISTENER ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_UPDATED' && message.enabled) init();
});

// ─── GO ──────────────────────────────────────────────────────────────────────

init();
