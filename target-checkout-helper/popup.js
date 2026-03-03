const SHIPPING_FIELDS = ['firstName', 'lastName', 'address1', 'address2', 'city', 'state', 'zip', 'phone'];
const PAYMENT_FIELDS  = ['cardNumber', 'expMonth', 'expYear', 'cvv', 'billingZip'];

const $ = (id) => document.getElementById(id);

const enableToggle = $('enableToggle');
const statusText   = $('statusText');
const saveBtn      = $('saveBtn');
const checkoutRetryMaxIn = $('checkoutRetryMax');
const checkoutRetryDelayIn = $('checkoutRetryDelay');

function parseIntInRange(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function updateStatusText(enabled) {
  statusText.textContent = enabled ? 'Extension active — ready to assist' : 'Extension disabled';
}

function gatherSettings() {
  const shipping = {};
  for (const id of SHIPPING_FIELDS) {
    shipping[id] = $(id).value.trim();
  }

  const payment = {};
  for (const id of PAYMENT_FIELDS) {
    payment[id] = $(id).value.trim();
  }

  const retryPolicy = {
    maxAttempts: parseIntInRange(checkoutRetryMaxIn.value, 1, 20, 4),
    delaySec: parseIntInRange(checkoutRetryDelayIn.value, 1, 60, 2),
  };

  return { enabled: enableToggle.checked, shipping, payment, retryPolicy };
}

function populateFields(data) {
  if (data.enabled) {
    enableToggle.checked = true;
  }
  updateStatusText(!!data.enabled);

  if (data.shipping) {
    for (const id of SHIPPING_FIELDS) {
      if (data.shipping[id]) $(id).value = data.shipping[id];
    }
  }

  if (data.payment) {
    for (const id of PAYMENT_FIELDS) {
      if (data.payment[id]) $(id).value = data.payment[id];
    }
  }

  if (data.retryPolicy) {
    if (data.retryPolicy.maxAttempts) {
      checkoutRetryMaxIn.value = String(data.retryPolicy.maxAttempts);
    }
    if (data.retryPolicy.delaySec) {
      checkoutRetryDelayIn.value = String(data.retryPolicy.delaySec);
    }
  }
}

async function save() {
  const settings = gatherSettings();
  await chrome.storage.local.set(settings);

  chrome.runtime.sendMessage({
    type: 'SETTINGS_UPDATED',
    enabled: settings.enabled,
  });

  saveBtn.textContent = 'Saved!';
  saveBtn.classList.add('saved');
  setTimeout(() => {
    saveBtn.textContent = 'Save Settings';
    saveBtn.classList.remove('saved');
  }, 1500);
}

enableToggle.addEventListener('change', () => {
  updateStatusText(enableToggle.checked);
});

saveBtn.addEventListener('click', save);

chrome.storage.local.get(['enabled', 'shipping', 'payment', 'retryPolicy'], populateFields);

// ─── PRODUCT MONITOR ─────────────────────────────────────────────────────────

const productUrlInput    = $('productUrl');
const addProductBtn      = $('addProductBtn');
const productListEl      = $('productList');
const monitorControls    = $('monitorControls');
const monitorBtn         = $('monitorBtn');
const monitorStatusEl    = $('monitorStatus');
const refreshIntervalIn  = $('refreshInterval');

let products = [];
let monitorActive = false;
let statusPollId = null;

function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function extractProductName(url) {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/^\/p\/([^/]+)/);
    if (match) {
      const name = match[1].replace(/-/g, ' ');
      return name.length > 28 ? name.slice(0, 28) + '…' : name;
    }
    return 'Product';
  } catch {
    return 'Product';
  }
}

function renderProducts() {
  productListEl.innerHTML = '';
  monitorControls.style.display = '';

  products.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'product-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'product-name';
    nameSpan.title = p.url;
    nameSpan.textContent = extractProductName(p.url);

    const qtySelect = document.createElement('select');
    qtySelect.className = 'qty-select';
    qtySelect.disabled = monitorActive;
    for (let n = 1; n <= 5; n++) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      if (n === p.qty) opt.selected = true;
      qtySelect.appendChild(opt);
    }
    qtySelect.addEventListener('change', () => {
      products[i].qty = parseInt(qtySelect.value);
      saveProducts();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.disabled = monitorActive;
    removeBtn.addEventListener('click', () => {
      products.splice(i, 1);
      saveProducts();
      renderProducts();
    });

    li.appendChild(nameSpan);
    li.appendChild(qtySelect);
    li.appendChild(removeBtn);
    productListEl.appendChild(li);
  });
}

async function saveProducts() {
  const { monitor } = await chrome.storage.local.get('monitor');
  await chrome.storage.local.set({
    monitor: { ...(monitor || {}), products },
  });
}

function addProduct() {
  const url = productUrlInput.value.trim();
  if (!url) return;

  if (!/^https?:\/\/(www\.)?target\.com\/p\//i.test(url)) {
    productUrlInput.classList.add('error');
    setTimeout(() => productUrlInput.classList.remove('error'), 1500);
    return;
  }

  const norm = normalizeProductUrl(url);
  if (products.some((p) => normalizeProductUrl(p.url) === norm)) {
    productUrlInput.value = '';
    return;
  }

  products.push({ url, qty: 1 });
  productUrlInput.value = '';
  saveProducts();
  renderProducts();
}

addProductBtn.addEventListener('click', addProduct);
productUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addProduct();
});

// Monitor start / stop

async function toggleMonitor() {
  if (monitorActive) {
    await chrome.runtime.sendMessage({ type: 'STOP_MONITOR' });
    monitorActive = false;
    updateMonitorUI();
    stopStatusPoll();
    monitorStatusEl.textContent = '';
  } else {
    if (!products.length) return;
    await chrome.runtime.sendMessage({
      type: 'START_MONITOR',
      products,
      refreshInterval: parseInt(refreshIntervalIn.value) || 1,
    });
    monitorActive = true;
    updateMonitorUI();
    startStatusPoll();
  }
}

function updateMonitorUI() {
  monitorBtn.textContent = monitorActive ? 'Stop Monitoring' : 'Start Monitoring';
  monitorBtn.classList.toggle('active', monitorActive);
  monitorBtn.disabled = !monitorActive && !products.length;
  productUrlInput.disabled = monitorActive;
  addProductBtn.disabled = monitorActive;
  refreshIntervalIn.disabled = monitorActive;
  renderProducts();
}

monitorBtn.addEventListener('click', toggleMonitor);

// Status polling

async function pollStatus() {
  try {
    const m = await chrome.runtime.sendMessage({ type: 'GET_MONITOR_STATUS' });
    if (!m) return;
    const retryStatus = formatRetryStatus(m.checkoutTelemetry);

    if (m.active) {
      const parts = (m.products || []).map((p) => {
        const name = extractProductName(p.url);
        const count = m.counts?.[normalizeProductUrl(p.url)] || 0;
        return `${name}: ${count}/${p.qty}`;
      });
      const textParts = [];
      if (parts.length) textParts.push(parts.join(' · '));
      if (retryStatus) textParts.push(retryStatus);
      monitorStatusEl.textContent = textParts.join(' | ');
    } else if (monitorActive) {
      monitorActive = false;
      updateMonitorUI();
      stopStatusPoll();
      monitorStatusEl.textContent = retryStatus
        ? `Done — proceeding to checkout! | ${retryStatus}`
        : 'Done — proceeding to checkout!';
    } else if (retryStatus) {
      monitorStatusEl.textContent = retryStatus;
    }
  } catch {}
}

function formatRetryStatus(telemetry) {
  const event = telemetry?.lastEvent;
  if (!event) return '';

  if (event.status === 'scheduled') {
    return `Retry ${event.attempt}/${event.maxAttempts}: ${event.reason}`;
  }
  if (event.status === 'exhausted') {
    return `Retries exhausted (${event.maxAttempts}): ${event.reason}`;
  }
  if (event.status === 'success') {
    return `Checkout completed after ${event.failedAttempts || 0} failed attempt(s)`;
  }
  return '';
}

function startStatusPoll() {
  pollStatus();
  statusPollId = setInterval(pollStatus, 1500);
}

function stopStatusPoll() {
  if (statusPollId) {
    clearInterval(statusPollId);
    statusPollId = null;
  }
}

// Load monitor data on popup open

async function loadMonitorData() {
  const { monitor } = await chrome.storage.local.get('monitor');
  if (!monitor) {
    pollStatus();
    return;
  }

  products = monitor.products || [];
  monitorActive = !!monitor.active;
  if (monitor.refreshInterval) refreshIntervalIn.value = monitor.refreshInterval;

  renderProducts();
  updateMonitorUI();
  if (monitorActive) startStatusPoll();
  else pollStatus();
}

loadMonitorData();
