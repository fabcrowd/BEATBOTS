// content.js — Target Checkout Helper
// Injected into all target.com pages. Drives the checkout flow automatically.

// ─── SELECTORS (confirmed via PhoenixBot & BuyBot source analysis) ───────────

const SEL = {
  shipIt:          '[data-test="shipItButton"]',
  pickup:          '[data-test="orderPickupButton"]',
  declineCoverage: '[data-test="espModalContent-declineCoverageButton"]',
  viewCart:        '[data-test="addToCartModalViewCartCheckout"]',
  cartCheckout:    '[data-test="checkout-button"]',
  placeOrder:      '[data-test="placeOrderButton"]',  // NEVER auto-clicked
  cardNumber:      '#creditCardInput-cardNumber',
  cvv:             '#creditCardInput-cvv',
};

// ─── TIMING ──────────────────────────────────────────────────────────────────

const T = {
  observerTimeout: 20000,  // Max wait for an element (ms)
  fieldDelay:      150,    // Delay between filling each form field (ms)
  postClickDelay:  600,    // Brief pause after clicking a button (ms)
  navSettleDelay:  1200,   // Wait after URL change before re-running (ms)
};

// ─── UTILITIES ────────────────────────────────────────────────────────────────

// Fill a React-controlled input. Plain .value= doesn't trigger React's state.
function fillInput(input, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Fill a React-controlled <select>
function fillSelect(select, value) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

// Wait for a CSS selector to appear in the DOM (MutationObserver based)
function waitForElement(selector, timeout = T.observerTimeout) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout: ${selector}`));
    }, timeout);

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(found);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// Try a list of selectors, return first match
function findFirst(...selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

// Show a floating toast on the page
function showToast(message, type = 'info') {
  const existing = document.getElementById('tch-toast');
  if (existing) existing.remove();

  const colors = { info: '#cc0000', success: '#1a7340', error: '#333', persistent: '#cc0000' };

  const toast = document.createElement('div');
  toast.id = 'tch-toast';
  Object.assign(toast.style, {
    position:   'fixed',
    bottom:     '24px',
    right:      '24px',
    background: colors[type] || colors.info,
    color:      'white',
    padding:    '12px 18px',
    borderRadius: '8px',
    fontFamily: '-apple-system, sans-serif',
    fontSize:   '13px',
    fontWeight: '600',
    zIndex:     '2147483647',
    boxShadow:  '0 4px 16px rgba(0,0,0,0.35)',
    lineHeight: '1.4',
    maxWidth:   '320px',
    transition: 'opacity 0.3s',
  });

  toast.innerHTML = `<span style="margin-right:6px">🎯</span>${message}`;
  document.body.appendChild(toast);

  if (type !== 'persistent') {
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 350);
    }, 4000);
  }
}

// Find and click a "Continue" / "Save & continue" button on checkout pages
async function clickContinue() {
  const patterns = ['save & continue', 'save and continue', 'continue', 'next'];
  const buttons = Array.from(document.querySelectorAll('button'));

  for (const pattern of patterns) {
    const btn = buttons.find(
      (b) => b.textContent.trim().toLowerCase().startsWith(pattern) && !b.disabled
    );
    if (btn) {
      btn.click();
      return true;
    }
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

// Within /checkout, detect which sub-step is active by DOM presence
function getCheckoutStep() {
  if (document.querySelector(SEL.placeOrder))        return 'review';
  if (document.querySelector(SEL.cardNumber))        return 'payment';

  // Shipping step: look for name/address fields
  const shippingFields = [
    'input[id*="firstName"]',
    'input[id*="first-name"]',
    'input[name="firstName"]',
    'input[autocomplete="given-name"]',
  ];
  if (shippingFields.some((s) => document.querySelector(s))) return 'shipping';

  return 'unknown';
}

// ─── STEP HANDLERS ───────────────────────────────────────────────────────────

async function handleProductPage(settings) {
  showToast('Detecting Add to Cart...');

  // Try "Ship It" first, fall back to "Pickup"
  let addBtn;
  try {
    addBtn = await waitForElement(SEL.shipIt);
  } catch {
    try {
      addBtn = await waitForElement(SEL.pickup, 8000);
    } catch {
      showToast('Add to Cart button not found', 'error');
      return;
    }
  }

  addBtn.click();
  showToast('Added to cart...');
  await sleep(T.postClickDelay);

  // Decline optional coverage/protection plan popup
  try {
    const coverageBtn = await waitForElement(SEL.declineCoverage, 5000);
    coverageBtn.click();
    await sleep(T.postClickDelay);
  } catch {
    // Not present — continue
  }

  // Click "View Cart & Check Out"
  try {
    const viewCartBtn = await waitForElement(SEL.viewCart);
    await sleep(300);
    viewCartBtn.click();
    showToast('Heading to checkout...');
  } catch {
    showToast('Could not find "View Cart & Check Out" button', 'error');
  }
}

async function handleCartPage(settings) {
  showToast('Proceeding to checkout...');
  try {
    const checkoutBtn = await waitForElement(SEL.cartCheckout);
    await sleep(T.postClickDelay);
    checkoutBtn.click();
  } catch {
    showToast('Checkout button not found', 'error');
  }
}

async function handleCheckoutPage(settings) {
  // The checkout page is a multi-step SPA — detect the current step
  const step = getCheckoutStep();

  if (step === 'shipping') {
    await handleShippingStep(settings);
  } else if (step === 'payment') {
    await handlePaymentStep(settings);
  } else if (step === 'review') {
    showToast('Ready — review your order and click Place Order', 'persistent');
  } else {
    // Step not yet rendered — watch for DOM changes
    watchForCheckoutStep(settings);
  }
}

// Watch the DOM until a recognizable checkout step appears
function watchForCheckoutStep(settings) {
  let handled = false;

  const observer = new MutationObserver(async () => {
    if (handled) return;
    const step = getCheckoutStep();

    if (step === 'shipping') {
      handled = true;
      observer.disconnect();
      await handleShippingStep(settings);
    } else if (step === 'payment') {
      handled = true;
      observer.disconnect();
      await handlePaymentStep(settings);
    } else if (step === 'review') {
      handled = true;
      observer.disconnect();
      showToast('Ready — review your order and click Place Order', 'persistent');
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Safety: stop watching after 30s
  setTimeout(() => observer.disconnect(), 30000);
}

async function handleShippingStep(settings) {
  const s = settings.shipping || {};
  showToast('Filling shipping info...');
  await sleep(400);

  // Ordered list of fields with multiple possible selectors per field
  const fields = [
    {
      selectors: ['input[id*="firstName"]', 'input[name="firstName"]', 'input[autocomplete="given-name"]'],
      value: s.firstName,
    },
    {
      selectors: ['input[id*="lastName"]', 'input[name="lastName"]', 'input[autocomplete="family-name"]'],
      value: s.lastName,
    },
    {
      selectors: ['input[id*="addressLine1"]', 'input[name="addressLine1"]', 'input[id*="address1"]', 'input[autocomplete="address-line1"]'],
      value: s.address1,
    },
    {
      selectors: ['input[id*="addressLine2"]', 'input[name="addressLine2"]', 'input[id*="address2"]', 'input[autocomplete="address-line2"]'],
      value: s.address2,
    },
    {
      selectors: ['input[id*="city"]', 'input[name="city"]', 'input[autocomplete="address-level2"]'],
      value: s.city,
    },
    {
      selectors: ['input[id*="zipCode"]', 'input[name="zipCode"]', 'input[id*="zip"]', 'input[autocomplete="postal-code"]'],
      value: s.zip,
    },
    {
      selectors: ['input[id*="phone"]', 'input[name="phone"]', 'input[autocomplete="tel"]'],
      value: s.phone,
    },
  ];

  for (const { selectors, value } of fields) {
    if (!value) continue;
    const input = findFirst(...selectors);
    if (input) {
      fillInput(input, value);
      await sleep(T.fieldDelay);
    }
  }

  // State dropdown
  if (s.state) {
    const stateEl = findFirst(
      'select[id*="state"]',
      'select[name*="state"]',
      'select[autocomplete="address-level1"]'
    );
    if (stateEl) {
      fillSelect(stateEl, s.state);
      await sleep(T.fieldDelay);
    }
  }

  await sleep(500);
  const clicked = await clickContinue();
  if (clicked) {
    showToast('Shipping filled — advancing...');
    // Watch for next step
    setTimeout(() => watchForCheckoutStep(settings), 1500);
  } else {
    showToast('Could not find Continue button on shipping step', 'error');
  }
}

async function handlePaymentStep(settings) {
  const p = settings.payment || {};
  showToast('Filling payment info...');
  await sleep(400);

  // Card number
  if (p.cardNumber) {
    const cardInput = document.querySelector(SEL.cardNumber);
    if (cardInput) {
      fillInput(cardInput, p.cardNumber);
      await sleep(T.fieldDelay);
    }
  }

  // Expiration — Target may use a combined MM/YY field or two separate fields
  const expCombined = findFirst(
    '#creditCardInput-expDate',
    'input[id*="expiration"]',
    'input[placeholder*="MM/YY"]',
    'input[placeholder*="MM / YY"]'
  );

  if (expCombined && p.expMonth && p.expYear) {
    const yr = p.expYear.length === 4 ? p.expYear.slice(-2) : p.expYear;
    fillInput(expCombined, `${p.expMonth}/${yr}`);
    await sleep(T.fieldDelay);
  } else {
    if (p.expMonth) {
      const mo = findFirst('input[id*="expMonth"]', 'input[name*="expMonth"]');
      if (mo) { fillInput(mo, p.expMonth); await sleep(T.fieldDelay); }
    }
    if (p.expYear) {
      const yr = findFirst('input[id*="expYear"]', 'input[name*="expYear"]');
      if (yr) { fillInput(yr, p.expYear); await sleep(T.fieldDelay); }
    }
  }

  // CVV
  if (p.cvv) {
    const cvvInput = document.querySelector(SEL.cvv);
    if (cvvInput) {
      fillInput(cvvInput, p.cvv);
      await sleep(T.fieldDelay);
    }
  }

  // Billing zip (if separate from shipping zip)
  if (p.billingZip) {
    const billingZip = findFirst(
      'input[id*="billingZip"]',
      'input[id*="billing-zip"]',
      'input[name*="billingZip"]'
    );
    if (billingZip) {
      fillInput(billingZip, p.billingZip);
      await sleep(T.fieldDelay);
    }
  }

  await sleep(500);
  const clicked = await clickContinue();
  if (clicked) {
    showToast('Payment filled — advancing to review...');
    // Watch for the review step (Place Order button)
    waitForElement(SEL.placeOrder, 20000)
      .then(() => showToast('Ready — review your order and click Place Order', 'persistent'))
      .catch(() => {});
  } else {
    showToast('Could not find Continue button on payment step', 'error');
  }
}

// ─── MONITOR MODE ────────────────────────────────────────────────────────────

async function handleMonitoredATC(monitor, product) {
  const normUrl = normalizeProductUrl(product.url);
  const currentCount = monitor.counts?.[normUrl] || 0;

  if (currentCount >= product.qty) {
    showToast(`Monitor: Already added ${currentCount}/${product.qty}`, 'success');
    return;
  }

  showToast(`Monitor: Adding to cart (${currentCount + 1}/${product.qty})…`);

  let addBtn;
  try {
    addBtn = await waitForElement(SEL.shipIt, 10000);
  } catch {
    try {
      addBtn = await waitForElement(SEL.pickup, 5000);
    } catch {
      const interval = monitor.refreshInterval || 5;
      showToast(`Monitor: Unavailable — retrying in ${interval}s…`, 'error');
      setTimeout(() => location.reload(), interval * 1000);
      return;
    }
  }

  if (addBtn.disabled) {
    const interval = monitor.refreshInterval || 5;
    showToast(`Monitor: Button disabled — retrying in ${interval}s…`, 'error');
    setTimeout(() => location.reload(), interval * 1000);
    return;
  }

  addBtn.click();
  await sleep(T.postClickDelay);

  // Decline optional coverage popup
  try {
    const coverageBtn = await waitForElement(SEL.declineCoverage, 4000);
    coverageBtn.click();
    await sleep(T.postClickDelay);
  } catch {}

  // Wait for ATC confirmation modal (viewCart button means item was added)
  try {
    await waitForElement(SEL.viewCart, 10000);
  } catch {
    const interval = monitor.refreshInterval || 5;
    showToast(`Monitor: Add to cart uncertain — retrying in ${interval}s…`, 'error');
    setTimeout(() => location.reload(), interval * 1000);
    return;
  }

  showToast(`Monitor: Added! (${currentCount + 1}/${product.qty})`, 'success');
  chrome.runtime.sendMessage({ type: 'ATC_SUCCESS', url: normUrl });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function init() {
  const data = await chrome.storage.local.get(['enabled', 'shipping', 'payment', 'monitor']);
  const page = getPageType();

  // Monitor mode: on a monitored product page, try ATC without navigating away
  if (data.monitor?.active && page === 'product') {
    const normUrl = normalizeProductUrl(location.href);
    const product = (data.monitor.products || []).find(
      (p) => normalizeProductUrl(p.url) === normUrl
    );
    if (product) {
      await handleMonitoredATC(data.monitor, product);
      return;
    }
  }

  if (!data.enabled) return;

  const hasShipping = data.shipping && Object.values(data.shipping).some(Boolean);
  const hasPayment  = data.payment  && Object.values(data.payment).some(Boolean);

  if (!hasShipping && !hasPayment) {
    showToast('Open the extension popup to add your info', 'error');
    return;
  }

  const settings = { shipping: data.shipping || {}, payment: data.payment || {} };

  switch (page) {
    case 'product':      await handleProductPage(settings); break;
    case 'cart':         await handleCartPage(settings);    break;
    case 'checkout':     await handleCheckoutPage(settings); break;
    case 'confirmation': showToast('Order placed!', 'success'); break;
  }
}

// ─── SPA NAVIGATION WATCHER ──────────────────────────────────────────────────
// Target is a React SPA — URL changes don't fire full page loads

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // Remove any existing toast so the next step can render its own
    document.getElementById('tch-toast')?.remove();
    setTimeout(init, T.navSettleDelay);
  }
}).observe(document, { subtree: true, childList: true });

// ─── MESSAGE LISTENER (from popup via background) ─────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_UPDATED' && message.enabled) {
    init();
  }
});

// ─── INITIAL RUN ──────────────────────────────────────────────────────────────

init();
