const SHIPPING_FIELDS = ['firstName', 'lastName', 'address1', 'address2', 'city', 'state', 'zip', 'phone'];
const PAYMENT_FIELDS  = ['cardNumber', 'expMonth', 'expYear', 'cvv', 'billingZip'];

const SAVE_LABEL = 'Save settings';
const SAVE_OK_LABEL = 'Saved!';

const $ = (id) => document.getElementById(id);

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

const enableToggle = $('enableToggle');
const statusText   = $('statusText');
const saveBtn      = $('saveBtn');
const checkoutRetryMaxIn = $('checkoutRetryMax');
const checkoutRetryDelayIn = $('checkoutRetryDelay');
const tabMain = $('tabMain');
const tabForms = $('tabForms');
const panelMain = $('panelMain');
const panelForms = $('panelForms');
const productListEmpty = $('productListEmpty');

/** LIFO = newest snapshot consumed first (matches common “use newest first” bot UI). */
let harvestRemovalIsLifo = true;

function gatherHarvestConfigFromDom() {
  const per = $('harvestPerLoad');
  const ex = $('harvestExpireMin');
  const he = $('harvestEnabled');
  const ds = $('harvestDontStop');
  const ap = $('harvestApplyNext');
  return {
    harvestingEnabled: !!(he && he.checked),
    harvestsPerPageLoad: per ? parseIntInRange(per.value, 1, 5, 1) : 1,
    expirationMinutes: ex ? parseIntInRange(ex.value, 1, 120, 3) : 3,
    removalOrder: harvestRemovalIsLifo ? 'lifo' : 'fifo',
    dontStopHarvesting: !!(ds && ds.checked),
    applyNextBeforeCheckout: !!(ap && ap.checked),
  };
}

function updateHarvestOrderLabels() {
  const label = $('harvestOrderLabel');
  const btn = $('harvestOrderBtn');
  if (!label || !btn) return;
  if (harvestRemovalIsLifo) {
    label.textContent = 'Cookie order: use newest first (LIFO)';
    btn.textContent = 'Use oldest first (FIFO)';
  } else {
    label.textContent = 'Cookie order: use oldest first (FIFO)';
    btn.textContent = 'Use newest first (LIFO)';
  }
}

async function refreshDebuggerStatus() {
  if (!hasChromeStorage()) return;
  try {
    const st = await chrome.runtime.sendMessage({ type: 'DEBUGGER_STATUS' });
    const el = $('debuggerStatusText');
    if (!el || !st) return;
    if (st.ok === false) {
      el.textContent = 'Debugger: status unavailable';
      return;
    }
    el.textContent = st.attached
      ? `Debugger: attached to tab ${st.tabId}`
      : 'Debugger: not attached';
  } catch (_) {}
}

async function refreshHarvestStatus() {
  if (!hasChromeStorage()) return;
  try {
    const s = await chrome.runtime.sendMessage({ type: 'HARVEST_GET_STATUS' });
    const c = $('harvestCountText');
    const w = $('harvestSessionWarn');
    if (c && s && s.ok !== false) {
      c.textContent = `Snapshots ready: ${typeof s.count === 'number' ? s.count : '—'}`;
    }
    if (w && s) w.hidden = !!s.sessionStorage;
  } catch (_) {}
}

async function pushHarvestConfig(data) {
  if (!hasChromeStorage()) return;
  try {
    await chrome.runtime.sendMessage({ type: 'HARVEST_UPDATE_CONFIG', data: data || gatherHarvestConfigFromDom() });
    await refreshHarvestStatus();
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', enabled: enableToggle.checked });
  } catch (_) {}
}

function parseIntInRange(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function updateHeaderVisualState(enabled) {
  statusText.textContent = enabled
    ? 'On — open a Target product page to run checkout help'
    : 'Off — automation paused';
  document.querySelector('.app-header')?.classList.toggle('is-active', !!enabled);
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
    maxAttempts: parseIntInRange(checkoutRetryMaxIn.value, 0, 50, 0),
    delaySec: parseIntInRange(checkoutRetryDelayIn.value, 1, 60, 1),
  };

  return {
    enabled: enableToggle.checked,
    shipping,
    payment,
    retryPolicy,
    useSavedPayment: $('useSavedPayment').checked,
    autoPlaceOrder: $('autoPlaceOrder').checked,
    harvestConfig: gatherHarvestConfigFromDom(),
  };
}

let toastTimer = null;
function showToast(msg) {
  const el = $('toastRegion');
  if (!el || !msg) return;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.textContent = ''; }, 2400);
}

function renderSpeedComparison(speeds) {
  const el = $('speedCompare');
  if (!el) return;

  const entries = Array.isArray(speeds) ? speeds : [];
  if (!entries.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  const saved    = entries.filter(e => e.mode === 'saved');
  const formfill = entries.filter(e => e.mode === 'formfill');

  const avgMs = (arr) => arr.length
    ? Math.round(arr.reduce((sum, e) => sum + e.durationMs, 0) / arr.length)
    : null;

  const fmtSec = (ms) => ms !== null ? `${(ms / 1000).toFixed(1)}s` : 'N/A';

  const savedAvg    = avgMs(saved);
  const formfillAvg = avgMs(formfill);

  let html = '<div class="speed-rows">';
  if (saved.length) {
    html += `<div class="speed-row"><span class="speed-label">Saved payment</span>`
          + `<span class="speed-val">${fmtSec(savedAvg)} avg`
          + ` (${saved.length} run${saved.length !== 1 ? 's' : ''})</span></div>`;
  }
  if (formfill.length) {
    html += `<div class="speed-row"><span class="speed-label">Form fill</span>`
          + `<span class="speed-val">${fmtSec(formfillAvg)} avg`
          + ` (${formfill.length} run${formfill.length !== 1 ? 's' : ''})</span></div>`;
  }
  if (saved.length && formfill.length && savedAvg !== null && formfillAvg !== null) {
    const diff = formfillAvg - savedAvg;
    if (diff > 500) {
      html += `<div class="speed-winner">Saved payment is ${fmtSec(diff)} faster ✓</div>`;
    } else if (diff < -500) {
      html += `<div class="speed-winner">Form fill is ${fmtSec(-diff)} faster</div>`;
    } else {
      html += `<div class="speed-winner">Both methods are similar speed</div>`;
    }
  }
  html += '</div>';

  el.innerHTML = html;
  el.hidden = false;
}

function populateFields(data) {
  if (data.enabled) {
    enableToggle.checked = true;
  }
  updateHeaderVisualState(!!data.enabled);

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
    if (typeof data.retryPolicy.maxAttempts === 'number') {
      checkoutRetryMaxIn.value = String(data.retryPolicy.maxAttempts);
    }
    if (typeof data.retryPolicy.delaySec === 'number') {
      checkoutRetryDelayIn.value = String(data.retryPolicy.delaySec);
    }
  }

  if (data.useSavedPayment) {
    $('useSavedPayment').checked = true;
  }

  if (data.autoPlaceOrder) {
    $('autoPlaceOrder').checked = true;
  }

  const hc = data.harvestConfig || {};
  harvestRemovalIsLifo = (hc.removalOrder || 'lifo') === 'lifo';
  updateHarvestOrderLabels();
  const he = $('harvestEnabled');
  if (he) he.checked = !!hc.harvestingEnabled;
  const hpl = $('harvestPerLoad');
  if (hpl && typeof hc.harvestsPerPageLoad === 'number') hpl.value = String(hc.harvestsPerPageLoad);
  const hex = $('harvestExpireMin');
  if (hex && typeof hc.expirationMinutes === 'number') hex.value = String(hc.expirationMinutes);
  const hds = $('harvestDontStop');
  if (hds) hds.checked = !!hc.dontStopHarvesting;
  const hap = $('harvestApplyNext');
  if (hap) hap.checked = !!hc.applyNextBeforeCheckout;

  renderSpeedComparison(data.checkoutSpeeds);
  void refreshHarvestStatus();

  const adv = data.advancedSettings || {};
  const dbgAny = $('debuggerAllowAnyTab');
  if (dbgAny) dbgAny.checked = !!adv.allowDebuggerAnyTab;
  void refreshDebuggerStatus();
}

async function save() {
  if (!hasChromeStorage()) {
    showToast('Open from the toolbar puzzle icon');
    return;
  }
  saveBtn.disabled = true;
  try {
    const prev = await chrome.storage.local.get('advancedSettings');
    const settings = gatherSettings();
    await chrome.storage.local.set({
      ...settings,
      advancedSettings: {
        ...(prev.advancedSettings || {}),
        allowDebuggerAnyTab: !!$('debuggerAllowAnyTab')?.checked,
      },
    });

    chrome.runtime.sendMessage({
      type: 'SETTINGS_UPDATED',
      enabled: settings.enabled,
    });

    saveBtn.textContent = SAVE_OK_LABEL;
    saveBtn.classList.add('saved');
    showToast('Settings saved');
    setTimeout(() => {
      saveBtn.textContent = SAVE_LABEL;
      saveBtn.classList.remove('saved');
    }, 1600);
  } finally {
    saveBtn.disabled = false;
  }
}

enableToggle.addEventListener('change', async () => {
  const enabled = enableToggle.checked;
  updateHeaderVisualState(enabled);
  if (!hasChromeStorage()) return;
  try {
    const data = await chrome.storage.local.get(null);
    await chrome.storage.local.set({ ...data, enabled });
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', enabled });
  } catch (_) {}
});

saveBtn.addEventListener('click', save);

if (hasChromeStorage()) {
  chrome.storage.local.get(
    [
      'enabled',
      'shipping',
      'payment',
      'retryPolicy',
      'useSavedPayment',
      'autoPlaceOrder',
      'checkoutSpeeds',
      'harvestConfig',
      'advancedSettings',
    ],
    populateFields
  );
} else {
  populateFields({});
}

function wireHarvestControls() {
  $('harvestEnabled')?.addEventListener('change', () => { void pushHarvestConfig(); });
  $('harvestPerLoad')?.addEventListener('change', () => { void pushHarvestConfig(); });
  $('harvestExpireMin')?.addEventListener('change', () => { void pushHarvestConfig(); });
  $('harvestDontStop')?.addEventListener('change', () => { void pushHarvestConfig(); });
  $('harvestApplyNext')?.addEventListener('change', () => { void pushHarvestConfig(); });
  $('harvestOrderBtn')?.addEventListener('click', () => {
    harvestRemovalIsLifo = !harvestRemovalIsLifo;
    updateHarvestOrderLabels();
    void pushHarvestConfig({ removalOrder: harvestRemovalIsLifo ? 'lifo' : 'fifo' });
  });
  $('harvestClearBtn')?.addEventListener('click', async () => {
    if (!hasChromeStorage()) return;
    try {
      await chrome.runtime.sendMessage({ type: 'HARVEST_CLEAR' });
      showToast('Harvest cleared');
      await refreshHarvestStatus();
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', enabled: enableToggle.checked });
    } catch (_) {}
  });
  $('harvestNowBtn')?.addEventListener('click', async () => {
    if (!hasChromeStorage()) return;
    const cfg = gatherHarvestConfigFromDom();
    if (!cfg.harvestingEnabled) {
      showToast('Turn harvesting on first');
      return;
    }
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabUrl = tabs[0]?.url || '';
      let retailer = 'target';
      try {
        const h = new URL(tabUrl).hostname.toLowerCase();
        if (h === 'walmart.com' || h.endsWith('.walmart.com')) retailer = 'walmart';
      } catch (_) {}
      const r = await chrome.runtime.sendMessage({
        type: 'HARVEST_CAPTURE_BURST',
        data: { count: 1, kind: 'manual', url: tabUrl, retailer },
      });
      showToast(r?.ok ? 'Captured 1 snapshot' : 'Capture failed');
      await refreshHarvestStatus();
    } catch (_) {
      showToast('Capture failed');
    }
  });
}

wireHarvestControls();

function wireAdvancedDebuggerControls() {
  $('debuggerAllowAnyTab')?.addEventListener('change', async () => {
    if (!hasChromeStorage()) return;
    const checked = !!$('debuggerAllowAnyTab')?.checked;
    try {
      const prev = await chrome.storage.local.get('advancedSettings');
      await chrome.storage.local.set({
        advancedSettings: { ...(prev.advancedSettings || {}), allowDebuggerAnyTab: checked },
      });
      showToast('Advanced setting saved');
    } catch (_) {}
  });
  $('debuggerAttachBtn')?.addEventListener('click', async () => {
    if (!hasChromeStorage()) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        showToast('No active tab');
        return;
      }
      const r = await chrome.runtime.sendMessage({
        type: 'DEBUGGER_ATTACH',
        tabId: tab.id,
        tabUrl: tab.url || '',
      });
      const hint = r?.hint ? ` — ${r.hint}` : '';
      showToast(r?.ok ? 'Debugger attached' : `Attach failed${hint}`);
      await refreshDebuggerStatus();
    } catch (_) {
      showToast('Attach failed');
    }
  });
  $('debuggerDetachBtn')?.addEventListener('click', async () => {
    if (!hasChromeStorage()) return;
    try {
      await chrome.runtime.sendMessage({ type: 'DEBUGGER_DETACH' });
      showToast('Detached');
      await refreshDebuggerStatus();
    } catch (_) {
      showToast('Detach failed');
    }
  });
}

wireAdvancedDebuggerControls();

try {
  const ver = hasChromeStorage() ? chrome.runtime.getManifest?.()?.version : '';
  const el = $('extVersion');
  if (ver && el) el.textContent = `v${ver}`;
} catch (_) {}

// ─── Tabs ───────────────────────────────────────────────────────────────────

function setActiveTab(panel) {
  const isMain = panel === 'main';
  tabMain.classList.toggle('tab-btn-active', isMain);
  tabMain.setAttribute('aria-selected', isMain);
  tabForms.classList.toggle('tab-btn-active', !isMain);
  tabForms.setAttribute('aria-selected', !isMain);
  panelMain.hidden = !isMain;
  panelForms.hidden = isMain;
}

tabMain.addEventListener('click', () => setActiveTab('main'));
tabForms.addEventListener('click', () => setActiveTab('forms'));

tabMain.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    tabForms.focus();
    setActiveTab('forms');
  }
});
tabForms.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    tabMain.focus();
    setActiveTab('main');
  }
});

// ─── PRODUCT MONITOR ─────────────────────────────────────────────────────────

const productUrlInput    = $('productUrl');
const addProductBtn      = $('addProductBtn');
const productListEl      = $('productList');
const monitorControls    = $('monitorControls');
const monitorBtn         = $('monitorBtn');
const monitorStatusEl    = $('monitorStatus');
const refreshIntervalIn  = $('refreshInterval');
const dropExpectedAtIn   = $('dropExpectedAt');
const dropCountdownEl    = $('dropCountdown');

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
  if (monitorControls) monitorControls.hidden = false;
  if (productListEmpty) productListEmpty.hidden = products.length > 0;

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
    qtySelect.setAttribute('aria-label', 'Quantity');
    for (let n = 1; n <= 5; n++) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      if (n === p.qty) opt.selected = true;
      qtySelect.appendChild(opt);
    }
    qtySelect.addEventListener('change', () => {
      products[i].qty = parseInt(qtySelect.value, 10);
      saveProducts();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', 'Remove product');
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

function readDropExpectedAtValue() {
  const v = (dropExpectedAtIn?.value || '').trim();
  return v || null;
}

async function saveProducts() {
  if (!hasChromeStorage()) return;
  const { monitor } = await chrome.storage.local.get('monitor');
  const next = { ...(monitor || {}), products };
  const dropVal = readDropExpectedAtValue();
  if (dropVal) next.dropExpectedAt = dropVal;
  else delete next.dropExpectedAt;
  await chrome.storage.local.set({ monitor: next });
}

function formatDropCountdown(iso) {
  if (!dropCountdownEl || !iso) {
    if (dropCountdownEl) dropCountdownEl.textContent = '';
    return;
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    dropCountdownEl.textContent = '';
    return;
  }
  const now = Date.now();
  const d = t - now;
  const after = now - t;
  if (after > 3 * 60 * 1000) {
    dropCountdownEl.textContent = 'Drop time passed — clear or update for next drop';
    return;
  }
  if (d < 0 && after <= 3 * 60 * 1000) {
    dropCountdownEl.textContent = 'In drop window — fast polling';
    return;
  }
  const s = Math.floor(d / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    dropCountdownEl.textContent = `${h}h ${m % 60}m until drop`;
  } else if (m > 0) {
    dropCountdownEl.textContent = `${m}m ${s % 60}s until drop`;
  } else {
    dropCountdownEl.textContent = `${s}s until drop`;
  }
}

function addProduct() {
  const url = productUrlInput.value.trim();
  if (!url) return;

  if (!/^https?:\/\/(www\.)?target\.com\/p\//i.test(url)) {
    productUrlInput.classList.add('error');
    showToast('Use a Target product URL (/p/…)');
    setTimeout(() => productUrlInput.classList.remove('error'), 1500);
    return;
  }

  const norm = normalizeProductUrl(url);
  if (products.some((p) => normalizeProductUrl(p.url) === norm)) {
    showToast('Already in list');
    productUrlInput.value = '';
    productUrlInput.focus();
    return;
  }

  products.push({ url, qty: 1 });
  productUrlInput.value = '';
  saveProducts();
  renderProducts();
  showToast('Added to list');
}

addProductBtn.addEventListener('click', addProduct);
productUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addProduct();
});

async function toggleMonitor() {
  if (!hasChromeStorage()) {
    showToast('Monitoring needs the real extension popup');
    return;
  }
  if (monitorActive) {
    await chrome.runtime.sendMessage({ type: 'STOP_MONITOR' });
    monitorActive = false;
    updateMonitorUI();
    stopStatusPoll();
    monitorStatusEl.textContent = '';
    monitorStatusEl.classList.remove('is-live');
    showToast('Monitoring stopped');
  } else {
    if (!products.length) return;
    await chrome.runtime.sendMessage({
      type: 'START_MONITOR',
      products,
      refreshInterval: parseInt(refreshIntervalIn.value, 10) || 1,
      dropExpectedAt: readDropExpectedAtValue(),
    });
    monitorActive = true;
    updateMonitorUI();
    startStatusPoll();
    showToast('Monitoring — keep Chrome open');
  }
}

function updateMonitorUI() {
  monitorBtn.textContent = monitorActive ? 'Stop monitoring' : 'Start monitoring';
  monitorBtn.classList.toggle('active', monitorActive);
  monitorBtn.disabled = !monitorActive && !products.length;
  productUrlInput.disabled = monitorActive;
  addProductBtn.disabled = monitorActive;
  refreshIntervalIn.disabled = monitorActive;
  if (dropExpectedAtIn) dropExpectedAtIn.disabled = monitorActive;
  renderProducts();
}

monitorBtn.addEventListener('click', toggleMonitor);

async function pollStatus() {
  if (!hasChromeStorage()) return;
  try {
    const m = await chrome.runtime.sendMessage({ type: 'GET_MONITOR_STATUS' });
    if (!m) return;
    const retryStatus = formatRetryStatus(m.checkoutTelemetry);

    if (m.active) {
      monitorStatusEl.classList.add('is-live');
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
      monitorStatusEl.classList.remove('is-live');
      monitorStatusEl.textContent = retryStatus
        ? `Done — heading to checkout · ${retryStatus}`
        : 'Done — heading to checkout';
    } else {
      monitorStatusEl.classList.remove('is-live');
      monitorStatusEl.textContent = retryStatus || '';
    }
  } catch (_) {}
}

function formatRetryStatus(telemetry) {
  const event = telemetry?.lastEvent;
  if (!event) return '';

  if (event.status === 'scheduled') {
    if (event.maxAttempts > 0) {
      return `Retry ${event.attempt}/${event.maxAttempts}: ${event.reason}`;
    }
    return `Retry #${event.attempt} (until cancel): ${event.reason}`;
  }
  if (event.status === 'watching') {
    if (event.maxAttempts > 0) {
      return `Watching stock (${event.attempt}/${event.maxAttempts}): ${event.reason}`;
    }
    return `Watching stock (until cancel): ${event.reason}`;
  }
  if (event.status === 'stock_detected') {
    return 'Stock detected — reloading now';
  }
  if (event.status === 'exhausted') {
    return `Retries exhausted (${event.maxAttempts}): ${event.reason}`;
  }
  if (event.status === 'cancelled') {
    return 'Retries canceled';
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

async function loadMonitorData() {
  if (!hasChromeStorage()) {
    products = [];
    renderProducts();
    updateMonitorUI();
    formatDropCountdown('');
    return;
  }
  const { monitor } = await chrome.storage.local.get('monitor');
  if (!monitor) {
    products = [];
    renderProducts();
    updateMonitorUI();
    formatDropCountdown('');
    pollStatus();
    return;
  }

  products = monitor.products || [];
  monitorActive = !!monitor.active;
  if (monitor.refreshInterval) refreshIntervalIn.value = monitor.refreshInterval;
  if (dropExpectedAtIn && monitor.dropExpectedAt) {
    dropExpectedAtIn.value = monitor.dropExpectedAt;
  }

  renderProducts();
  updateMonitorUI();
  formatDropCountdown(monitor.dropExpectedAt || readDropExpectedAtValue() || '');
  if (monitorActive) startStatusPoll();
  else pollStatus();
}

if (dropExpectedAtIn) {
  dropExpectedAtIn.addEventListener('change', () => {
    formatDropCountdown(readDropExpectedAtValue() || '');
    saveProducts();
  });
}

setInterval(() => {
  formatDropCountdown(readDropExpectedAtValue() || '');
}, 1000);

loadMonitorData();
