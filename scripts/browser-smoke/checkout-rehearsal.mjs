/**
 * Checkout rehearsal (top → review only): loads unpacked extension in Playwright Chromium,
 * uses a **persistent** profile so your Target login stays. You never put passwords in
 * this script — use Target saved address + card (popup: "Use saved payment & address").
 *
 * Stops when content logs `[TCH] review reached` (Place Order stays manual per extension).
 *
 * Setup once:
 *   1. Sign in to Target in the opened window if the profile is new.
 *   2. When prompted, confirm popup settings: extension ON, **Use saved payment** ON,
 *      **Auto place order** OFF.
 *
 * Required env:
 *   TCH_PRODUCT_URL — in-stock Target product page, e.g. https://www.target.com/p/…
 *
 * Optional:
 *   TCH_PROFILE_DIR — Chrome user-data-dir (default: ~/.tch-rehearsal-chrome)
 *   TCH_REHEARSAL_TIMEOUT_MS — max wait for review (default: 420000 = 7 min)
 *   TCH_MANUAL_WAIT_SECS — skip Enter; wait N seconds after opening account (default: 0 = readline)
 */
import assert from 'node:assert/strict';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchWithExtension, rmProfileDir } from './launch-util.mjs';

const PRODUCT_URL = process.env.TCH_PRODUCT_URL?.trim();
const PROFILE_DIR =
  process.env.TCH_PROFILE_DIR?.trim() ||
  path.join(os.homedir(), '.tch-rehearsal-chrome');
const MAX_MS = Number(process.env.TCH_REHEARSAL_TIMEOUT_MS || '420000');

let browser;
let userDataDir;

async function waitForReady() {
  const secs = Number(process.env.TCH_MANUAL_WAIT_SECS || '0');
  if (secs > 0) {
    console.log(`\nWaiting ${secs}s — sign in / adjust extension popup if needed.\n`);
    await new Promise((r) => setTimeout(r, secs * 1000));
    return;
  }
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(
      '\n>>> In the browser: Target signed in; extension ON; Use saved payment ON; Auto place order OFF.\n>>> Press Enter to start the product → checkout → review run...\n'
    );
  } finally {
    rl.close();
  }
}

async function applyExtensionSettingsFromPopup(page, extensionId) {
  await page.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const next = {
          enabled: true,
          useSavedPayment: true,
          autoPlaceOrder: false,
          retryPolicy: { maxAttempts: 8, delaySec: 2 },
          shipping: {},
          payment: {},
          harvestConfig: {
            harvestingEnabled: false,
            harvestsPerPageLoad: 1,
            expirationMinutes: 3,
            removalOrder: 'lifo',
            dontStopHarvesting: false,
            applyNextBeforeCheckout: false,
          },
        };
        chrome.storage.local.set(next, () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else {
            chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', enabled: true }, () =>
              resolve()
            );
          }
        });
      })
  );
}

async function main() {
  if (!PRODUCT_URL || !/^https:\/\/(www\.)?target\.com\//i.test(PRODUCT_URL)) {
    console.error(
      'Set TCH_PRODUCT_URL to a full Target product URL, e.g.\n' +
        '  $env:TCH_PRODUCT_URL="https://www.target.com/p/some-item/-/A-12345678"\n' +
        'Pick an in-stock / purchasable SKU you are willing to take to review (you will not auto-place).'
    );
    process.exit(1);
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  userDataDir = PROFILE_DIR;

  const launched = await launchWithExtension({
    userDataDir: PROFILE_DIR,
    timeout: 120000,
  });
  browser = launched.browser;
  const { extensionId, TIMEOUT } = launched;

  console.log('\nPersistent profile:', PROFILE_DIR);
  console.log('Extension ID:', extensionId);
  console.log('Product URL:', PRODUCT_URL);

  const warm = await browser.newPage();
  await warm.goto('https://www.target.com/account', {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });
  await warm.close();

  await waitForReady();

  const popup = await browser.newPage();
  await applyExtensionSettingsFromPopup(popup, extensionId);
  await popup.close();

  const shop = await browser.newPage();
  const lines = [];
  const cdp = await shop.createCDPSession();
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.consoleAPICalled', (ev) => {
    const parts = (ev.args || []).map((a) => {
      if (a.value !== undefined) return String(a.value);
      if (a.unserializableValue) return String(a.unserializableValue);
      return a.description || '';
    });
    const text = parts.join(' ');
    if (text.includes('[TCH]')) lines.push(text);
  });

  console.log('\nNavigating to product (extension will drive toward review)...\n');
  await shop.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

  const deadline = Date.now() + MAX_MS;
  while (Date.now() < deadline) {
    if (lines.some((l) => l.includes('[TCH] review reached'))) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  assert.ok(
    lines.some((l) => l.includes('[TCH] review reached')),
    `Timed out waiting for [TCH] review reached (${MAX_MS}ms). Last lines:\n${lines.slice(-15).join('\n')}`
  );

  const url = shop.url();
  console.log('\nCHECKOUT REHEARSAL PASS — reached review (no Place Order).');
  console.log('Final URL:', url);
  if (lines.some((l) => l.includes('checkout_total_to_review'))) {
    const timing = lines.filter((l) => l.includes('checkout_total_to_review')).pop();
    console.log('Timing:', timing);
  }
}

main()
  .catch((e) => {
    console.error('\nCHECKOUT REHEARSAL FAIL:', e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (process.env.TCH_DELETE_PROFILE === '1') {
      await rmProfileDir(userDataDir);
    } else {
      console.log('\nProfile kept at:', userDataDir, '(set TCH_DELETE_PROFILE=1 to remove)');
    }
  });
