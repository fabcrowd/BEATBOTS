const SHIPPING_FIELDS = ['firstName', 'lastName', 'address1', 'address2', 'city', 'state', 'zip', 'phone'];
const PAYMENT_FIELDS  = ['cardNumber', 'expMonth', 'expYear', 'cvv', 'billingZip'];

const $ = (id) => document.getElementById(id);

const enableToggle = $('enableToggle');
const statusText   = $('statusText');
const saveBtn      = $('saveBtn');

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

  return { enabled: enableToggle.checked, shipping, payment };
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

chrome.storage.local.get(['enabled', 'shipping', 'payment'], populateFields);
