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
const tabAccounts = $('tabAccounts');
const panelMain = $('panelMain');
const panelForms = $('panelForms');
const panelAccounts = $('panelAccounts');
const productListEmpty = $('productListEmpty');

/** LIFO = newest snapshot consumed first (matches common “use newest first” bot UI). */
let harvestRemovalIsLifo = true;
let harvestNextDeadlineMs = null;
let harvestNextMode = '';
let harvestLastCaptureMs = 0;
let harvestLastCaptureKind = '';
let harvestLastCount = null;
let harvestEnabled = false;
let harvestDontStop = false;
let harvestSessionStorageOk = true;
let harvestHidden = false;

function gatherHarvestConfigFromDom() {
  const per = $('harvestPerLoad');
  const ex = $('harvestExpireMin');
  const he = $('harvestEnabled');
  const ds = $('harvestDontStop');
  const ap = $('harvestApplyNext');
  return {
    harvestingEnabled: !!(he && he.checked),
    harvestsPerPageLoad: per ? parseIntInRange(per.value, 1, 5, 1) : 1,
    expirationMinutes: ex ? parseIntInRange(ex.value, 1, 120, 8) : 8,
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

const ACCT_LABELS = {
  login:   { ok: 'Yes',  fail: 'Not logged in', unknown: 'Open a Target tab' },
  address: { ok: 'Saved', fail: 'None',          unknown: '—' },
  payment: { ok: 'Saved', fail: 'None',          unknown: '—' },
};

function setAcctItem(dotId, valId, state, labelKey) {
  const dot = $(dotId);
  const val = $(valId);
  if (dot) dot.className = `acct-dot acct-dot-${state}`;
  if (val) {
    val.textContent = ACCT_LABELS[labelKey]?.[state] ?? (state === 'checking' ? '…' : '—');
    val.className = `acct-item-val acct-val-${state}`;
  }
}

async function checkAccountStatus() {
  if (!hasChromeStorage()) return;
  setAcctItem('acctLoginDot', 'acctLoginVal', 'checking', 'login');
  setAcctItem('acctAddrDot',  'acctAddrVal',  'checking', 'address');
  setAcctItem('acctPayDot',   'acctPayVal',   'checking', 'payment');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'CHECK_ACCOUNT_STATUS' });
    if (r.noTab) {
      setAcctItem('acctLoginDot', 'acctLoginVal', 'unknown', 'login');
      setAcctItem('acctAddrDot',  'acctAddrVal',  'unknown', 'address');
      setAcctItem('acctPayDot',   'acctPayVal',   'unknown', 'payment');
      return;
    }
    setAcctItem('acctLoginDot', 'acctLoginVal', r.loggedIn === true ? 'ok' : r.loggedIn === false ? 'fail' : 'unknown', 'login');
    setAcctItem('acctAddrDot',  'acctAddrVal',  r.hasAddress === true ? 'ok' : r.hasAddress === false ? 'fail' : 'unknown', 'address');
    setAcctItem('acctPayDot',   'acctPayVal',   r.hasPayment === true ? 'ok' : r.hasPayment === false ? 'fail' : 'unknown', 'payment');
  } catch (_) {
    setAcctItem('acctLoginDot', 'acctLoginVal', 'unknown', 'login');
    setAcctItem('acctAddrDot',  'acctAddrVal',  'unknown', 'address');
    setAcctItem('acctPayDot',   'acctPayVal',   'unknown', 'payment');
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
    const n = $('harvestNextText');
    const w = $('harvestSessionWarn');
    const hw = $('harvestHiddenWarn');
    if (c && s && s.ok !== false) {
      const count = typeof s.count === 'number' ? s.count : null;
      c.textContent = `Snapshots ready: ${count !== null ? count : '—'}`;
      c.className = 'harvest-count';
      if (count !== null) {
        if (count < 10) c.classList.add('harvest-count-low');
        else if (count < 30) c.classList.add('harvest-count-mid');
        else c.classList.add('harvest-count-ok');
      }
    }
    if (w && s) w.hidden = !!s.sessionStorage;
    if (hw && s) hw.hidden = !s.harvestHidden;
    if (s) {
      harvestEnabled = !!s?.config?.harvestingEnabled;
      harvestDontStop = !!s?.config?.dontStopHarvesting;
      harvestSessionStorageOk = s.sessionStorage !== false;
      harvestHidden = !!s.harvestHidden;
      harvestLastCount = typeof s.count === 'number' ? s.count : null;
      harvestLastCaptureMs = Number(s.lastHarvestCaptureMs) || 0;
      harvestLastCaptureKind = String(s.lastHarvestCaptureKind || '');
      harvestNextMode = String(s.nextHarvestMode || '');
      if (typeof s.nextHarvestInMs === 'number' && Number.isFinite(s.nextHarvestInMs)) {
        harvestNextDeadlineMs = Date.now() + Math.max(0, s.nextHarvestInMs);
      } else {
        harvestNextDeadlineMs = null;
      }
    }
    if (n) updateHarvestNextText();
    updateHarvestDiagnostics();
  } catch (_) {}
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function appendHarvestTimerSpan(parent, text) {
  const span = document.createElement('span');
  span.className = 'harvest-timer';
  span.textContent = text;
  parent.appendChild(span);
}

function updateHarvestNextText() {
  const n = $('harvestNextText');
  if (!n) return;
  const hasLast = harvestLastCaptureMs > 0;
  const lastAgoSec = hasLast ? Math.max(0, Math.floor((Date.now() - harvestLastCaptureMs) / 1000)) : 0;

  n.replaceChildren();

  if (hasLast) {
    const kind = harvestLastCaptureKind || 'snapshot';
    n.appendChild(document.createTextNode(`Last capture: ${kind} `));
    appendHarvestTimerSpan(n, `(${lastAgoSec}s ago)`);
    n.appendChild(document.createTextNode('. '));
  } else {
    n.appendChild(document.createTextNode('Last capture: none yet. '));
  }

  if (harvestNextMode === 'monitor_keepalive' && harvestNextDeadlineMs) {
    const leftMs = Math.max(0, harvestNextDeadlineMs - Date.now());
    n.appendChild(document.createTextNode('Next keepalive harvest in '));
    appendHarvestTimerSpan(n, formatCountdown(leftMs));
    n.appendChild(document.createTextNode('.'));
    return;
  }
  if (harvestNextMode === 'auto_recurring' && harvestNextDeadlineMs) {
    const leftMs = Math.max(0, harvestNextDeadlineMs - Date.now());
    n.appendChild(document.createTextNode('Next auto harvest in '));
    appendHarvestTimerSpan(n, formatCountdown(leftMs));
    n.appendChild(document.createTextNode(' (any open Target tab will capture).'));
    return;
  }
  n.appendChild(document.createTextNode('Next auto harvest happens on Target product/login page load.'));
}

function updateHarvestDiagnostics() {
  const l1 = $('harvestDiagLine1');
  const l2 = $('harvestDiagLine2');
  const l3 = $('harvestDiagLine3');
  if (!l1 || !l2 || !l3) return;

  const countText = harvestLastCount == null ? 'unknown' : String(harvestLastCount);
  l1.textContent = `Status: enabled=${harvestEnabled ? 'yes' : 'no'} | pool=${countText} | storage.session=${harvestSessionStorageOk ? 'ok' : 'unavailable'}`;

  if (!harvestEnabled) {
    l2.textContent = 'Reason: harvesting is OFF in Cookie harvest settings.';
    l3.textContent = 'Next action: turn ON Harvesting on, then open a Target product/login page or click Harvest now.';
    return;
  }
  if (!harvestSessionStorageOk) {
    l2.textContent = 'Reason: Chrome session storage is unavailable, so snapshots only live in temporary worker memory.';
    l3.textContent = 'Next action: keep the browser open and use Harvest now; restart browser/profile if this persists.';
    return;
  }
  if (harvestHidden) {
    l2.textContent = 'Reason: every open Target tab is currently hidden; Chrome may throttle background timers.';
    l3.textContent = 'Next action: bring a Target tab to the foreground (or open one), or use Harvest now manually.';
    return;
  }
  if (!harvestLastCaptureMs) {
    l2.textContent = 'Reason: no capture has occurred yet this session.';
    l3.textContent = 'Next action: open a Target /p/ product page (or sign-in page), wait 2-3s, then check count.';
    return;
  }
  if (harvestNextMode === 'monitor_keepalive') {
    l2.textContent = 'Reason: monitor keepalive scheduler is active.';
    l3.textContent = 'Next action: no action needed; countdown above shows next automatic keepalive capture.';
    return;
  }
  if (harvestNextMode === 'auto_recurring') {
    l2.textContent = 'Reason: "Don\u2019t stop harvesting" is on; recurring capture timer is running.';
    l3.textContent = 'Next action: keep any target.com tab open and visible. Countdown above shows the next eligible recapture.';
    return;
  }
  if (!harvestDontStop) {
    l2.textContent = 'Reason: "Don\u2019t stop harvesting" is OFF, so each URL captures only once until you navigate.';
    l3.textContent = 'Next action: turn on "Don\u2019t stop harvesting" (Cookie harvest section) to build the pool from any Target tab, or keep navigating between Target product/sign-in pages.';
    return;
  }
  l2.textContent = `Reason: last capture source = ${harvestLastCaptureKind || 'unknown'}.`;
  l3.textContent = 'Next action: auto-capture triggers on Target product/login page loads (or monitor keepalive when monitoring is active).';
}

async function pushHarvestConfig(data) {
  if (!hasChromeStorage()) return;
  try {
    await chrome.runtime.sendMessage({ type: 'HARVEST_UPDATE_CONFIG', data: data || gatherHarvestConfigFromDom() });
    await refreshHarvestStatus();
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', enabled: !!enableToggle?.checked });
  } catch (_) {}
}

function parseIntInRange(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function updateHeaderVisualState(enabled) {
  if (statusText) {
    statusText.textContent = enabled
      ? 'On — open a Target product page to run checkout help'
      : 'Off — automation paused';
  }
  document.querySelector('.app-header')?.classList.toggle('is-active', !!enabled);
}

function gatherSettings() {
  const shipping = {};
  for (const id of SHIPPING_FIELDS) {
    const el = $(id);
    shipping[id] = el ? el.value.trim() : '';
  }

  const payment = {};
  for (const id of PAYMENT_FIELDS) {
    const el = $(id);
    payment[id] = el ? el.value.trim() : '';
  }

  const retryPolicy = {
    maxAttempts: checkoutRetryMaxIn
      ? parseIntInRange(checkoutRetryMaxIn.value, 0, 50, 0)
      : 0,
    delaySec: checkoutRetryDelayIn
      ? parseIntInRange(checkoutRetryDelayIn.value, 1, 60, 1)
      : 1,
  };

  const jigEl = $('jigIndex');
  const legacyJigEl = $('shippingJigLegacy');

  return {
    enabled: !!enableToggle?.checked,
    shipping,
    payment,
    retryPolicy,
    useSavedPayment: !!$('useSavedPayment')?.checked,
    autoPlaceOrder: !!$('autoPlaceOrder')?.checked,
    preferPickup: !!$('preferPickup')?.checked,
    checkoutSound: $('checkoutSound') ? !!$('checkoutSound').checked : true,
    addExtraProduct: !!$('addExtraProduct')?.checked,
    extraProductTcin: ($('extraProductTcin')?.value || '').trim(),
    jigIndex: jigEl ? parseIntInRange(jigEl.value, 0, 99, 0) : 0,
    /** @deprecated Kept for exports / migration — prefix-only when jigIndex is 0 */
    shippingJig: legacyJigEl ? legacyJigEl.value.trim() : '',
    walmartMaxPrice: parseFloat($('walmartMaxPrice')?.value) || 0,
    walmartSkipMonitoring: !!$('walmartSkipMonitoring')?.checked,
    walmartAtcOnly: !!$('walmartAtcOnly')?.checked,
    walmartUseSavedSession: $('walmartUseSavedSession') ? !!$('walmartUseSavedSession').checked : true,
    harvestConfig: gatherHarvestConfigFromDom(),
    discordWebhook: ($('discordWebhook')?.value || '').trim(),
    webhookSendFailures: !!$('webhookSendFailures')?.checked,
    gmailClientId: ($('gmailClientId')?.value || '').trim(),
    gmailClientSecret: ($('gmailClientSecret')?.value || '').trim(),
    autoSignIn: !!$('autoSignIn')?.checked,
    targetEmail: ($('targetEmail')?.value || '').trim(),
    targetPassword: ($('targetPassword')?.value || '').trim(),
    endlessMode: !!$('endlessMode')?.checked,
    endlessLimit: $('endlessLimit')
      ? parseIntInRange($('endlessLimit').value, 0, 99, 0)
      : 0,
    highStockOnly: !!$('highStockOnly')?.checked,
    highStockThreshold: $('highStockThreshold')
      ? parseIntInRange($('highStockThreshold').value, 1, 999, 10)
      : 10,
    targetMaxPrice: parseFloat($('targetMaxPrice')?.value) || 0,
    imap2faEnabled: !!$('imap2faEnabled')?.checked,
    imapProfile: {
      host: ($('imapHost')?.value || '').trim(),
      port: $('imapPort') ? parseIntInRange($('imapPort').value, 1, 65535, 993) : 993,
      user: ($('imapUser')?.value || '').trim(),
      password: $('imapPassword')?.value || '',
    },
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

let lastApplyHintAt = 0;
function showApplyHint(kind = 'save') {
  const now = Date.now();
  if (now - lastApplyHintAt < 1200) return;
  lastApplyHintAt = now;
  if (kind === 'toggle') {
    showToast('Extension toggle applies immediately');
    return;
  }
  showToast('Changed setting — click Save settings to fully apply');
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
  if (enableToggle) {
    enableToggle.checked = !!data.enabled;
  }
  updateHeaderVisualState(!!data.enabled);

  if (data.shipping) {
    for (const id of SHIPPING_FIELDS) {
      if (!data.shipping[id]) continue;
      const el = $(id);
      if (el) el.value = data.shipping[id];
    }
  }

  if (data.payment) {
    for (const id of PAYMENT_FIELDS) {
      if (!data.payment[id]) continue;
      const el = $(id);
      if (el) el.value = data.payment[id];
    }
  }

  if (data.retryPolicy) {
    if (checkoutRetryMaxIn && typeof data.retryPolicy.maxAttempts === 'number') {
      checkoutRetryMaxIn.value = String(data.retryPolicy.maxAttempts);
    }
    if (checkoutRetryDelayIn && typeof data.retryPolicy.delaySec === 'number') {
      checkoutRetryDelayIn.value = String(data.retryPolicy.delaySec);
    }
  }

  const useSaved = $('useSavedPayment');
  if (useSaved) useSaved.checked = !!data.useSavedPayment;

  const autoPlace = $('autoPlaceOrder');
  if (autoPlace) autoPlace.checked = !!data.autoPlaceOrder;

  const preferPickupEl = $('preferPickup');
  if (preferPickupEl) preferPickupEl.checked = !!data.preferPickup;

  const checkoutSoundEl = $('checkoutSound');
  if (checkoutSoundEl) checkoutSoundEl.checked = data.checkoutSound !== false;

  const addExtraEl = $('addExtraProduct');
  if (addExtraEl) {
    addExtraEl.checked = !!data.addExtraProduct;
    const row = $('extraProductRow');
    if (row) row.style.display = addExtraEl.checked ? '' : 'none';
  }

  const extraTcinEl = $('extraProductTcin');
  if (extraTcinEl && data.extraProductTcin) extraTcinEl.value = data.extraProductTcin;

  const jigIdxEl = $('jigIndex');
  if (jigIdxEl) {
    const ji = typeof data.jigIndex === 'number' ? data.jigIndex : parseInt(String(data.jigIndex ?? '0'), 10);
    jigIdxEl.value = String(Number.isFinite(ji) ? Math.max(0, Math.min(99, ji)) : 0);
  }
  const legacyJigEl = $('shippingJigLegacy');
  if (legacyJigEl && typeof data.shippingJig === 'string') legacyJigEl.value = data.shippingJig;

  const wmSkipEl = $('walmartSkipMonitoring');
  if (wmSkipEl) wmSkipEl.checked = !!data.walmartSkipMonitoring;

  const wmAtcOnlyEl = $('walmartAtcOnly');
  if (wmAtcOnlyEl) wmAtcOnlyEl.checked = !!data.walmartAtcOnly;

  const wmSessionEl = $('walmartUseSavedSession');
  if (wmSessionEl) wmSessionEl.checked = data.walmartUseSavedSession !== false;

  const wmMaxPrice = $('walmartMaxPrice');
  if (wmMaxPrice && typeof data.walmartMaxPrice === 'number') {
    wmMaxPrice.value = String(data.walmartMaxPrice);
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

  const disc = $('discordWebhook');
  if (disc && typeof data.discordWebhook === 'string') disc.value = data.discordWebhook;
  const wsf = $('webhookSendFailures');
  if (wsf) wsf.checked = !!data.webhookSendFailures;

  const gmCid = $('gmailClientId');
  if (gmCid && typeof data.gmailClientId === 'string') gmCid.value = data.gmailClientId;
  const gmSec = $('gmailClientSecret');
  if (gmSec && typeof data.gmailClientSecret === 'string') gmSec.value = data.gmailClientSecret;

  const asi = $('autoSignIn');
  if (asi) asi.checked = !!data.autoSignIn;
  const teml = $('targetEmail');
  if (teml && typeof data.targetEmail === 'string') teml.value = data.targetEmail;
  const tpwd = $('targetPassword');
  if (tpwd && typeof data.targetPassword === 'string') tpwd.value = data.targetPassword;

  void updateGmailStatus();

  const em = $('endlessMode');
  if (em) {
    em.checked = !!data.endlessMode;
    const elRow = $('endlessLimitRow');
    if (elRow) elRow.style.display = em.checked ? '' : 'none';
  }
  const elLim = $('endlessLimit');
  if (elLim && typeof data.endlessLimit === 'number') elLim.value = String(data.endlessLimit);

  const hs = $('highStockOnly');
  if (hs) {
    hs.checked = !!data.highStockOnly;
    const hsRow = $('highStockThresholdRow');
    if (hsRow) hsRow.style.display = hs.checked ? '' : 'none';
  }
  const hst = $('highStockThreshold');
  if (hst && typeof data.highStockThreshold === 'number') hst.value = String(data.highStockThreshold);

  const tm = $('targetMaxPrice');
  if (tm && typeof data.targetMaxPrice === 'number') tm.value = String(data.targetMaxPrice);

  const i2fa = $('imap2faEnabled');
  if (i2fa) i2fa.checked = !!data.imap2faEnabled;
  const ip = data.imapProfile || {};
  const ih = $('imapHost');
  if (ih && typeof ip.host === 'string') ih.value = ip.host;
  const ipt = $('imapPort');
  if (ipt && typeof ip.port === 'number') ipt.value = String(ip.port);
  const iu = $('imapUser');
  if (iu && typeof ip.user === 'string') iu.value = ip.user;
  const ipw = $('imapPassword');
  if (ipw && typeof ip.password === 'string' && ip.password) ipw.value = ip.password;

  renderSpeedComparison(data.checkoutSpeeds);
  void refreshHarvestStatus();
  void checkAccountStatus();

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
  if (!saveBtn) return;
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

if (enableToggle) {
  enableToggle.addEventListener('change', async () => {
    const enabled = !!enableToggle.checked;
    updateHeaderVisualState(enabled);
    showApplyHint('toggle');
    if (!hasChromeStorage()) return;
    try {
      const data = await chrome.storage.local.get(null);
      await chrome.storage.local.set({ ...data, enabled });
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', enabled });
    } catch (_) {}
  });
}

if (saveBtn) saveBtn.addEventListener('click', save);

function wireApplyHintReminders() {
  const ids = [
    'useSavedPayment', 'autoPlaceOrder', 'preferPickup', 'checkoutSound',
    'discordWebhook', 'webhookSendFailures', 'endlessMode', 'endlessLimit',
    'addExtraProduct', 'extraProductTcin', 'highStockOnly', 'highStockThreshold',
    'targetMaxPrice', 'refreshInterval', 'checkoutRetryMax', 'checkoutRetryDelay',
    'dropExpectedAt', 'harvestEnabled', 'harvestPerLoad', 'harvestExpireMin',
    'harvestDontStop', 'harvestApplyNext', 'walmartUseSavedSession',
    'walmartSkipMonitoring', 'walmartMaxPrice', 'wmDropExpectedAt',
    'gmailClientId', 'gmailClientSecret', 'autoSignIn', 'targetEmail', 'targetPassword',
    'imap2faEnabled', 'imapHost', 'imapPort', 'imapUser', 'imapPassword',
    'firstName', 'lastName', 'address1', 'address2', 'jigIndex', 'city', 'state',
    'zip', 'phone', 'cardNumber', 'expMonth', 'expYear', 'cvv', 'billingZip',
  ];
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('change', () => showApplyHint('save'));
  }
}
wireApplyHintReminders();

if (hasChromeStorage()) {
  chrome.storage.local.get(
    [
      'enabled',
      'shipping',
      'payment',
      'retryPolicy',
      'useSavedPayment',
      'autoPlaceOrder',
      'preferPickup',
      'checkoutSound',
      'addExtraProduct',
      'extraProductTcin',
      'shippingJig',
      'jigIndex',
      'walmartMaxPrice',
      'walmartSkipMonitoring',
      'walmartAtcOnly',
      'walmartUseSavedSession',
      'checkoutSpeeds',
      'harvestConfig',
      'advancedSettings',
      'discordWebhook',
      'webhookSendFailures',
      'gmailClientId',
      'gmailClientSecret',
      'gmailRefreshToken',
      'autoSignIn',
      'targetEmail',
      'targetPassword',
      'endlessMode',
      'endlessLimit',
      'highStockOnly',
      'highStockThreshold',
      'targetMaxPrice',
      'imap2faEnabled',
      'imapProfile',
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
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', enabled: !!enableToggle?.checked });
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
setInterval(() => {
  updateHarvestNextText();
}, 1000);
setInterval(() => {
  void refreshHarvestStatus();
}, 5000);

// Auto-save these toggles immediately on change so they survive popup close/reopen.
async function autoSaveToggle() {
  if (!hasChromeStorage()) return;
  try {
    const prev = await chrome.storage.local.get('advancedSettings');
    const settings = gatherSettings();
    await chrome.storage.local.set({
      ...settings,
      advancedSettings: { ...(prev.advancedSettings || {}), allowDebuggerAnyTab: !!$('debuggerAllowAnyTab')?.checked },
    });
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', enabled: settings.enabled });
  } catch (_) {}
}
$('useSavedPayment')?.addEventListener('change', autoSaveToggle);
$('autoPlaceOrder')?.addEventListener('change', autoSaveToggle);
$('preferPickup')?.addEventListener('change', autoSaveToggle);
$('checkoutSound')?.addEventListener('change', autoSaveToggle);
$('walmartSkipMonitoring')?.addEventListener('change', autoSaveToggle);
$('walmartAtcOnly')?.addEventListener('change', autoSaveToggle);
$('walmartUseSavedSession')?.addEventListener('change', autoSaveToggle);
$('addExtraProduct')?.addEventListener('change', () => {
  const row = $('extraProductRow');
  if (row) row.style.display = $('addExtraProduct').checked ? '' : 'none';
  autoSaveToggle();
});
$('endlessMode')?.addEventListener('change', () => {
  const row = $('endlessLimitRow');
  if (row) row.style.display = $('endlessMode')?.checked ? '' : 'none';
  autoSaveToggle();
});
$('highStockOnly')?.addEventListener('change', () => {
  const row = $('highStockThresholdRow');
  if (row) row.style.display = $('highStockOnly')?.checked ? '' : 'none';
  autoSaveToggle();
});
$('discordWebhook')?.addEventListener('change', autoSaveToggle);
$('webhookSendFailures')?.addEventListener('change', autoSaveToggle);
$('endlessLimit')?.addEventListener('change', autoSaveToggle);
$('highStockThreshold')?.addEventListener('change', autoSaveToggle);
$('targetMaxPrice')?.addEventListener('change', autoSaveToggle);

$('webhookTestBtn')?.addEventListener('click', async () => {
  if (!hasChromeStorage()) return;
  await autoSaveToggle().catch(() => {});
  try {
    const r = await chrome.runtime.sendMessage({ type: 'WEBHOOK_TEST' });
    if (r?.ok) showToast('Test webhook sent');
    else if (r?.skipped) showToast('Paste a discord.com webhook URL first');
    else showToast('Webhook request failed — check URL and network');
  } catch (_) {
    showToast('Webhook test failed');
  }
});

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

// ─── GMAIL 2FA ──────────────────────────────────────────────────────────────

async function updateGmailStatus() {
  const el = $('gmailStatusText');
  const hint = $('gmailExtIdHint');
  if (!el) return;
  if (hint && typeof chrome !== 'undefined' && chrome.runtime?.id) {
    hint.textContent = `Extension ID: ${chrome.runtime.id}`;
  }
  if (!hasChromeStorage()) { el.textContent = 'Gmail: unavailable'; return; }
  try {
    const d = await chrome.storage.local.get(['gmailRefreshToken']);
    el.textContent = d.gmailRefreshToken
      ? 'Gmail: \u25CF connected'
      : 'Gmail: not connected';
  } catch { el.textContent = 'Gmail: status unknown'; }
}

async function connectGmail() {
  if (!hasChromeStorage()) { showToast('Not available outside extension popup'); return; }
  const clientId = ($('gmailClientId')?.value || '').trim();
  const clientSecret = ($('gmailClientSecret')?.value || '').trim();
  if (!clientId) { showToast('Enter your Client ID first'); return; }
  if (!clientSecret) { showToast('Enter your Client Secret first'); return; }

  await chrome.storage.local.set({ gmailClientId: clientId, gmailClientSecret: clientSecret });

  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const scope = 'https://www.googleapis.com/auth/gmail.modify';
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
    + `?client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&response_type=code&scope=${encodeURIComponent(scope)}`
    + '&access_type=offline&prompt=consent';

  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectUrl) => {
    if (chrome.runtime.lastError || !redirectUrl) {
      showToast('Gmail auth cancelled or failed');
      void updateGmailStatus();
      return;
    }
    try {
      const code = new URL(redirectUrl).searchParams.get('code');
      if (!code) { showToast('No auth code received'); return; }
      const result = await chrome.runtime.sendMessage({
        type: 'GMAIL_EXCHANGE_CODE', code, redirectUri,
      });
      if (result?.ok) {
        showToast('Gmail connected');
      } else {
        showToast('Gmail token exchange failed');
      }
    } catch (e) {
      showToast('Gmail connection error');
      console.error('[TCH popup] Gmail connect error', e);
    }
    void updateGmailStatus();
  });
}

async function disconnectGmail() {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.remove(['gmailRefreshToken', 'gmailAccessToken', 'gmailTokenExpiry']);
  showToast('Gmail disconnected');
  void updateGmailStatus();
}

$('gmailConnectBtn')?.addEventListener('click', connectGmail);
$('gmailDisconnectBtn')?.addEventListener('click', disconnectGmail);
$('gmailClientId')?.addEventListener('change', autoSaveToggle);
$('gmailClientSecret')?.addEventListener('change', autoSaveToggle);
$('autoSignIn')?.addEventListener('change', autoSaveToggle);
$('targetEmail')?.addEventListener('change', autoSaveToggle);
$('targetPassword')?.addEventListener('change', autoSaveToggle);

$('acctCheckBtn')?.addEventListener('click', () => { void checkAccountStatus(); });

try {
  const ver = hasChromeStorage() ? chrome.runtime.getManifest?.()?.version : '';
  const el = $('extVersion');
  if (ver && el) el.textContent = `v${ver}`;
} catch (_) {}

// ─── Tabs ───────────────────────────────────────────────────────────────────

const tabWalmart   = $('tabWalmart');
const panelWalmart = $('panelWalmart');
const tabGuide     = $('tabGuide');
const panelGuide   = $('panelGuide');

function setActiveTab(panel) {
  const isMain    = panel === 'main';
  const isWalmart = panel === 'walmart';
  const isForms   = panel === 'forms';
  const isAccounts = panel === 'accounts';
  const isGuide   = panel === 'guide';
  tabMain.classList.toggle('tab-btn-active', isMain);
  tabMain.setAttribute('aria-selected', isMain);
  tabWalmart.classList.toggle('tab-btn-active', isWalmart);
  tabWalmart.setAttribute('aria-selected', isWalmart);
  tabForms.classList.toggle('tab-btn-active', isForms);
  tabForms.setAttribute('aria-selected', isForms);
  if (tabAccounts) {
    tabAccounts.classList.toggle('tab-btn-active', isAccounts);
    tabAccounts.setAttribute('aria-selected', isAccounts);
  }
  tabGuide.classList.toggle('tab-btn-active', isGuide);
  tabGuide.setAttribute('aria-selected', isGuide);
  panelMain.hidden    = !isMain;
  panelWalmart.hidden = !isWalmart;
  panelForms.hidden   = !isForms;
  if (panelAccounts) panelAccounts.hidden = !isAccounts;
  panelGuide.hidden   = !isGuide;

  // Header color + title
  const header = document.querySelector('.app-header');
  const title  = $('appTitle');
  if (isWalmart) {
    header?.classList.add('header-walmart');
    if (title) title.textContent = 'Walmart Checkout Helper';
  } else {
    header?.classList.remove('header-walmart');
    if (title) title.textContent = 'Target Checkout Helper';
  }
}

tabMain.addEventListener('click',    () => setActiveTab('main'));
tabWalmart.addEventListener('click', () => setActiveTab('walmart'));
tabForms.addEventListener('click',   () => setActiveTab('forms'));
tabAccounts?.addEventListener('click', () => setActiveTab('accounts'));
tabGuide.addEventListener('click',   () => setActiveTab('guide'));

document.addEventListener('click', (e) => {
  const link = e.target.closest('.guide-setting-link');
  if (!link) return;
  e.preventDefault();
  const panel = link.dataset.panel;
  const elId = link.dataset.el;
  if (panel) setActiveTab(panel);
  if (elId) {
    const target = $(elId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus?.();
      target.style.outline = '2px solid #0af';
      setTimeout(() => { target.style.outline = ''; }, 2000);
    }
  }
});

tabMain.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault(); tabWalmart.focus(); setActiveTab('walmart');
  }
});
tabWalmart.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault(); tabMain.focus(); setActiveTab('main');
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault(); tabForms.focus(); setActiveTab('forms');
  }
});
tabForms.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault(); tabWalmart.focus(); setActiveTab('walmart');
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault(); tabAccounts?.focus(); setActiveTab('accounts');
  }
});
tabAccounts?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault(); tabForms.focus(); setActiveTab('forms');
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault(); tabGuide.focus(); setActiveTab('guide');
  }
});
tabGuide.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault(); tabAccounts?.focus(); setActiveTab('accounts');
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
  // Monitor tab shows Target products only — Walmart products live on the Walmart tab
  const targetProducts = products.filter(p => !/walmart\.com/i.test(p.url));
  if (productListEmpty) productListEmpty.hidden = targetProducts.length > 0;

  targetProducts.forEach((p) => {
    const i = products.indexOf(p); // keep real index for edits/removes
    const li = document.createElement('li');
    li.className = 'product-item';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'product-name-edit';
    nameInput.value = p.name || extractProductName(p.url);
    nameInput.title = p.url;
    nameInput.placeholder = 'Name';
    nameInput.disabled = monitorActive;
    nameInput.setAttribute('aria-label', 'Product name');
    nameInput.addEventListener('change', () => {
      products[i].name = nameInput.value.trim() || extractProductName(p.url);
      saveProducts();
    });

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

    const topRow = document.createElement('div');
    topRow.className = 'product-item-top';
    topRow.appendChild(nameInput);
    topRow.appendChild(qtySelect);
    topRow.appendChild(removeBtn);

    const urlRow = document.createElement('div');
    urlRow.className = 'product-item-url';
    urlRow.title = p.url;

    // Retailer badge
    const isWalmartProduct = /walmart\.com\/ip\//i.test(p.url);
    const badge = document.createElement('span');
    badge.className = 'retailer-badge retailer-badge-' + (isWalmartProduct ? 'wmt' : 'tgt');
    badge.textContent = isWalmartProduct ? 'WMT' : 'TGT';
    const urlText = document.createTextNode(' ' + p.url);
    urlRow.appendChild(badge);
    urlRow.appendChild(urlText);

    li.appendChild(topRow);
    li.appendChild(urlRow);

    // OID row — Walmart only
    if (isWalmartProduct) {
      const oidRow = document.createElement('div');
      oidRow.className = 'product-item-oid';
      const oidInput = document.createElement('input');
      oidInput.type = 'text';
      oidInput.className = 'product-oid-edit';
      oidInput.placeholder = 'OID (optional)';
      oidInput.value = p.oid || '';
      oidInput.disabled = monitorActive;
      oidInput.setAttribute('aria-label', 'Walmart Offer ID');
      oidInput.addEventListener('change', () => {
        products[i].oid = oidInput.value.trim() || null;
        saveProducts();
      });
      oidRow.appendChild(oidInput);
      li.appendChild(oidRow);
    }

    productListEl.appendChild(li);
  });
  // Keep Walmart tab list in sync
  renderWalmartProducts();
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
    showToast('Use a Target product URL (/p/…) — Walmart goes on the Walmart tab');
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

  const nameInputEl = $('productName');
  const oidInputEl  = $('productOid');
  const customName  = nameInputEl?.value.trim() || '';
  const customOid   = oidInputEl?.value.trim() || '';
  products.push({ url, qty: 1, name: customName || extractProductName(url), oid: customOid || null });
  productUrlInput.value = '';
  if (nameInputEl) nameInputEl.value = '';
  if (oidInputEl)  oidInputEl.value  = '';
  saveProducts();
  renderProducts();
  showToast('Added to list');
}

addProductBtn.addEventListener('click', addProduct);
productUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addProduct();
});

// ─── WALMART TAB ─────────────────────────────────────────────────────────────

let wmEditIndex = -1; // -1 = adding new, >=0 = editing existing

function wmSetEditMode(index) {
  wmEditIndex = index;
  const label   = $('wmFormLabel');
  const addBtn  = $('wmAddProductBtn');
  const cancelBtn = $('wmCancelEditBtn');
  if (index >= 0) {
    if (label)   { label.textContent = 'Edit product'; label.className = 'wm-form-label editing'; }
    if (addBtn)  addBtn.textContent = 'Update product';
    if (cancelBtn) cancelBtn.style.display = '';
  } else {
    if (label)   { label.textContent = 'Add product'; label.className = 'wm-form-label'; }
    if (addBtn)  addBtn.textContent = 'Save product';
    if (cancelBtn) cancelBtn.style.display = 'none';
    wmClearForm();
  }
}

function wmClearForm() {
  const u = $('wmProductUrl');  if (u) u.value = '';
  const o = $('wmProductOid');  if (o) o.value = '';
  const n = $('wmProductName'); if (n) n.value = '';
  const q = $('wmProductQty');  if (q) q.value = '1';
  wmSaveDraft();
}

// Auto-save draft so popup closing never loses partially-entered data
function wmSaveDraft() {
  if (!hasChromeStorage()) return;
  const draft = {
    url:  ($('wmProductUrl')?.value  || '').trim(),
    oid:  ($('wmProductOid')?.value  || '').trim(),
    name: ($('wmProductName')?.value || '').trim(),
    qty:  $('wmProductQty')?.value || '1',
  };
  chrome.storage.local.set({ wmDraft: draft }).catch(() => {});
}

function wmRestoreDraft(draft) {
  if (!draft) return;
  if (draft.url  && $('wmProductUrl'))  $('wmProductUrl').value  = draft.url;
  if (draft.oid  && $('wmProductOid'))  $('wmProductOid').value  = draft.oid;
  if (draft.name && $('wmProductName')) $('wmProductName').value = draft.name;
  if (draft.qty  && $('wmProductQty'))  $('wmProductQty').value  = draft.qty;
}

['wmProductUrl','wmProductOid','wmProductName','wmProductQty'].forEach(id => {
  $(`${id}`)?.addEventListener('input', wmSaveDraft);
  $(`${id}`)?.addEventListener('change', wmSaveDraft);
});

function addWalmartProduct() {
  const url  = ($('wmProductUrl')?.value  || '').trim();
  const name = ($('wmProductName')?.value || '').trim();
  const oid  = ($('wmProductOid')?.value  || '').trim();
  const qty  = parseInt($('wmProductQty')?.value || '1', 10);

  if (!url) { showToast('Paste a Walmart URL first'); return; }

  if (wmEditIndex >= 0 && wmEditIndex < products.length) {
    // Update existing
    products[wmEditIndex] = { ...products[wmEditIndex], url, name: name || extractProductName(url), oid: oid || null, qty };
    showToast('Updated');
  } else {
    // Add new
    products.push({ url, qty, name: name || extractProductName(url), oid: oid || null });
    showToast('Added');
  }

  wmSetEditMode(-1);
  chrome.storage.local.set({ wmDraft: null }).catch(() => {});
  saveProducts();
  renderProducts();
}

function renderWalmartProducts() {
  const listEl  = $('wmProductList');
  const emptyEl = $('wmProductListEmpty');
  if (!listEl) return;
  const wmProducts = products.filter(p => /walmart\.com/i.test(p.url));
  if (emptyEl) emptyEl.hidden = wmProducts.length > 0;
  listEl.innerHTML = '';
  wmProducts.forEach((p) => {
    const i = products.indexOf(p);
    const li = document.createElement('li');
    li.className = 'product-item';

    const topRow = document.createElement('div');
    topRow.className = 'product-item-top';

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;cursor:pointer';
    nameSpan.textContent = p.name || extractProductName(p.url);
    nameSpan.title = 'Click to edit';

    const badges = document.createElement('span');
    badges.className = 'inline-hint';
    badges.style.flexShrink = '0';
    badges.textContent = `qty ${p.qty}`;
    if (p.oid) {
      const ob = document.createElement('span');
      ob.style.cssText = 'color:#0071ce;margin-left:4px';
      ob.textContent = 'OID';
      badges.appendChild(ob);
    }

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'harvest-btn';
    editBtn.textContent = 'Edit';
    editBtn.style.cssText = 'font-size:10px;padding:2px 6px;flex-shrink:0';
    editBtn.addEventListener('click', () => {
      const u = $('wmProductUrl');  if (u) u.value = p.url;
      const o = $('wmProductOid');  if (o) o.value = p.oid || '';
      const n = $('wmProductName'); if (n) n.value = p.name || '';
      const q = $('wmProductQty');  if (q) q.value = String(p.qty || 1);
      wmSetEditMode(i);
      wmSaveDraft();
      $('wmProductUrl')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('wmProductUrl')?.focus();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', 'Remove');
    removeBtn.addEventListener('click', () => {
      if (wmEditIndex === i) wmSetEditMode(-1);
      products.splice(i, 1);
      saveProducts();
      renderProducts();
    });

    topRow.appendChild(nameSpan);
    topRow.appendChild(badges);
    topRow.appendChild(editBtn);
    topRow.appendChild(removeBtn);
    li.appendChild(topRow);
    listEl.appendChild(li);
  });
}

$('wmAddProductBtn')?.addEventListener('click', addWalmartProduct);
$('wmCancelEditBtn')?.addEventListener('click', () => wmSetEditMode(-1));
$('wmProductUrl')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addWalmartProduct(); });

// Walmart drop time — synced with Monitor tab's dropExpectedAt
$('wmDropExpectedAt')?.addEventListener('change', () => {
  const v = $('wmDropExpectedAt').value;
  if (dropExpectedAtIn) dropExpectedAtIn.value = v;
  saveProducts();
  formatDropCountdown(v);
  wmFormatDropCountdown(v);
});

function wmFormatDropCountdown(iso) {
  const el = $('wmDropCountdown');
  if (!el || !iso) { if (el) el.textContent = ''; return; }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) { el.textContent = ''; return; }
  const d = t - Date.now();
  if (d < 0 && Date.now() - t <= 3 * 60 * 1000) { el.textContent = 'In drop window — fast polling'; return; }
  if (d < 0) { el.textContent = 'Drop time passed'; return; }
  const s = Math.floor(d / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  el.textContent = h > 0 ? `${h}h ${m % 60}m until drop` : m > 0 ? `${m}m ${s % 60}s until drop` : `${s}s until drop`;
}

// Walmart Start/Stop button — mirrors the main toggleMonitor
$('wmMonitorBtn')?.addEventListener('click', () => {
  // Sync drop time from Walmart tab before toggling
  const wmDrop = $('wmDropExpectedAt')?.value;
  if (wmDrop && dropExpectedAtIn) dropExpectedAtIn.value = wmDrop;
  toggleMonitor();
});

function updateWmMonitorBtn() {
  const btn = $('wmMonitorBtn');
  const status = $('wmMonitorStatus');
  if (!btn) return;
  btn.textContent = monitorActive ? 'Stop monitoring' : 'Start monitoring';
  btn.style.background = monitorActive ? '#333' : '#0071ce';
  btn.style.borderColor = monitorActive ? '#333' : '#0071ce';
  if (status) {
    const mainStatus = $('monitorStatus');
    status.textContent = mainStatus?.textContent || '';
    status.className = 'monitor-status-panel' + (monitorActive ? ' is-live' : '');
  }
}

// Grab URL from the current active tab
$('wmGrabTabBtn')?.addEventListener('click', async () => {
  try {
    const allActive = await chrome.tabs.query({ active: true });
    const tab =
      allActive.find(t => /walmart\.com\/ip\//i.test(t.url || '')) ||
      allActive.find(t => !/^chrome(-extension)?:\/\//i.test(t.url || ''));
    if (!tab?.url) { showToast('No active tab found'); return; }
    const urlEl = $('wmProductUrl');
    if (urlEl) {
      urlEl.value = tab.url;
      wmSaveDraft();
      urlEl.focus();
      showToast('URL loaded');
    }
  } catch { showToast('Could not read tab URL'); }
});

// Pop out — opens the popup as a standalone window that stays open
$('popoutBtn')?.addEventListener('click', () => {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 440,
    height: 680,
  });
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
    // Persist current UI state before starting so settings survive popup close/reopen.
    await autoSaveToggle().catch(() => {});
    await chrome.runtime.sendMessage({
      type: 'START_MONITOR',
      products,
      refreshInterval: parseInt(refreshIntervalIn.value, 10) || 1,
      dropExpectedAt: readDropExpectedAtValue(),
      walmartSkipMonitoring: !!$('walmartSkipMonitoring')?.checked,
      highStockOnly: !!$('highStockOnly')?.checked,
      highStockThreshold: $('highStockThreshold')
        ? parseIntInRange($('highStockThreshold').value, 1, 999, 10)
        : 10,
      targetMaxPrice: parseFloat($('targetMaxPrice')?.value) || 0,
      walmartMaxPrice: parseFloat($('walmartMaxPrice')?.value) || 0,
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
  const hsOnlyEl = $('highStockOnly');
  if (hsOnlyEl) hsOnlyEl.disabled = monitorActive;
  const hsThrEl = $('highStockThreshold');
  if (hsThrEl) hsThrEl.disabled = monitorActive;
  const tmEl = $('targetMaxPrice');
  if (tmEl) tmEl.disabled = monitorActive;
  // Sync Walmart tab drop time display
  const wmDrop = $('wmDropExpectedAt');
  if (wmDrop && dropExpectedAtIn?.value) wmDrop.value = dropExpectedAtIn.value;
  updateWmMonitorBtn();
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
      void refreshHarvestStatus();
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
  if ($('highStockOnly')) {
    $('highStockOnly').checked = !!monitor.highStockOnly;
    const hsr = $('highStockThresholdRow');
    if (hsr) hsr.style.display = $('highStockOnly').checked ? '' : 'none';
  }
  if ($('highStockThreshold') && monitor.highStockThreshold != null) {
    $('highStockThreshold').value = String(monitor.highStockThreshold);
  }
  if ($('targetMaxPrice') && monitor.targetMaxPrice != null) {
    $('targetMaxPrice').value = String(monitor.targetMaxPrice);
  }
  if (dropExpectedAtIn && monitor.dropExpectedAt) {
    dropExpectedAtIn.value = monitor.dropExpectedAt;
  }
  // Sync Walmart tab drop time
  const wmDrop = $('wmDropExpectedAt');
  if (wmDrop && monitor.dropExpectedAt) {
    wmDrop.value = monitor.dropExpectedAt;
    wmFormatDropCountdown(monitor.dropExpectedAt);
  }

  renderProducts();
  updateMonitorUI();
  formatDropCountdown(monitor.dropExpectedAt || readDropExpectedAtValue() || '');
  if (monitorActive) startStatusPoll();
  else pollStatus();

  // Restore Walmart draft fields (data entered before popup closed)
  const { wmDraft } = await chrome.storage.local.get('wmDraft').catch(() => ({}));
  if (wmDraft?.url || wmDraft?.oid) wmRestoreDraft(wmDraft);
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

// ─── LIVE NTP CLOCK (Walmart tab) ────────────────────────────────────────────
// Fetches the NTP offset from the background service worker once, then ticks
// locally every ~16ms (≈60fps) for a smooth millisecond display.

let wmNtpOffset = 0;

function wmTickClock() {
  const clockEl = $('wmLiveClock');
  if (!clockEl) return;
  const now = new Date(Date.now() + wmNtpOffset);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  clockEl.textContent = `${hh}:${mm}:${ss}.${ms}`;
}

function wmStartClock() {
  if (!hasChromeStorage()) return;
  chrome.runtime.sendMessage({ type: 'GET_NTP_OFFSET' }, (resp) => {
    if (chrome.runtime.lastError || !resp) return;
    wmNtpOffset = resp.ntpOffsetMs || 0;
    const badge = $('wmNtpBadge');
    if (badge) {
      const synced = resp.lastSyncMs > 0;
      badge.textContent = synced ? `offset ${wmNtpOffset > 0 ? '+' : ''}${wmNtpOffset}ms` : 'not synced';
      badge.style.color = synced ? '#4caf50' : '#888';
    }
  });
  // Re-fetch offset every 30s in case background resynced
  setInterval(() => {
    if (!hasChromeStorage()) return;
    chrome.runtime.sendMessage({ type: 'GET_NTP_OFFSET' }, (resp) => {
      if (chrome.runtime.lastError || !resp) return;
      wmNtpOffset = resp.ntpOffsetMs || 0;
      const badge = $('wmNtpBadge');
      if (badge && resp.lastSyncMs > 0) {
        badge.textContent = `offset ${wmNtpOffset > 0 ? '+' : ''}${wmNtpOffset}ms`;
        badge.style.color = '#4caf50';
      }
    });
  }, 30000);
  setInterval(wmTickClock, 16);
}

wmStartClock();

loadMonitorData();

// ─── SETTINGS EXPORT / IMPORT ────────────────────────────────────────────────

async function exportSettings() {
  if (!hasChromeStorage()) { showToast('Not available outside extension popup'); return; }
  try {
    const data = await chrome.storage.local.get(null);
    const { monitor, checkoutTelemetry, checkoutSpeeds, bgApiKey, bgRedskyBase, wmDraft, ...exportable } = data;
    const json = JSON.stringify(exportable, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tch-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Settings exported');
  } catch (e) {
    showToast('Export failed');
    console.error('[TCH popup] export failed', e);
  }
}

async function importSettings() {
  const fileInput = $('importFileInput');
  if (!fileInput) return;
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
      await chrome.storage.local.set(parsed);
      showToast('Settings imported — reloading…');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      showToast('Import failed — check file format');
      console.error('[TCH popup] import failed', e);
    }
    fileInput.value = '';
  };
  fileInput.click();
}

$('exportSettingsBtn')?.addEventListener('click', exportSettings);
$('importSettingsBtn')?.addEventListener('click', importSettings);

$('imapTestBtn')?.addEventListener('click', async () => {
  if (!hasChromeStorage()) {
    showToast('Use the extension popup');
    return;
  }
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'IMAP_NATIVE_CALL',
      payload: { cmd: 'ping' },
    });
    if (r?.ok && r?.pong) showToast('Native host responded');
    else showToast(r?.error ? String(r.error).slice(0, 120) : 'Native host failed');
  } catch (e) {
    showToast('Native host error — see console');
    console.error('[TCH popup] IMAP ping', e);
  }
});

$('imapProbeBtn')?.addEventListener('click', async () => {
  if (!hasChromeStorage()) {
    showToast('Use the extension popup');
    return;
  }
  const g = gatherSettings();
  const p = g.imapProfile || {};
  if (!p.host || !p.user || !p.password) {
    showToast('Fill IMAP host, user, and password');
    return;
  }
  showToast('Probing inbox…');
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'IMAP_NATIVE_CALL',
      payload: {
        cmd: 'readCode',
        host: p.host,
        port: p.port || 993,
        user: p.user,
        password: p.password,
        timeoutMs: 35000,
      },
    });
    if (r?.ok && r?.code) showToast(`Code found: ${r.code}`);
    else showToast(r?.error ? String(r.error).slice(0, 140) : 'No code in recent mail');
  } catch (e) {
    showToast('IMAP probe failed');
    console.error('[TCH popup] IMAP probe', e);
  }
});
