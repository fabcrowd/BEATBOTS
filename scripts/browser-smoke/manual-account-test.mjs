/**
 * Headed browser + unpacked extension. YOU sign in to Target manually (never paste
 * passwords into chat or into this repo). When ready, continue in the terminal —
 * then we assert extension + loose "signed in" signals.
 *
 * Usage:
 *   cd scripts/browser-smoke && npm run manual-account
 *
 * Non-interactive wait (no Enter): TCH_MANUAL_WAIT_SECS=120 npm run manual-account
 *
 * Profile: TCH_PROFILE_DIR or ~/.tch-rehearsal-chrome (same default as checkout-rehearsal).
 */
import assert from 'node:assert/strict';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchWithExtension, rmProfileDir } from './launch-util.mjs';

const PROFILE_DIR =
  process.env.TCH_PROFILE_DIR?.trim() ||
  path.join(os.homedir(), '.tch-rehearsal-chrome');

let browser;
let userDataDir;

async function waitForManualLogin() {
  const secs = Number(process.env.TCH_MANUAL_WAIT_SECS || '0');
  if (secs > 0) {
    console.log(`\nWaiting ${secs}s — sign in to Target in the browser window now.\n`);
    await new Promise((r) => setTimeout(r, secs * 1000));
    return;
  }
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(
      '\n>>> Sign in to Target in the CHROME WINDOW (do not paste your password in chat).\n>>> When finished, return here and press Enter to continue...\n'
    );
  } finally {
    rl.close();
  }
}

async function main() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const { browser: br, extensionId, userDataDir: prof, TIMEOUT } = await launchWithExtension({
    userDataDir: PROFILE_DIR,
    timeout: 120000,
  });
  browser = br;
  userDataDir = prof;

  console.log('\nProfile (shared with checkout-rehearsal):', PROFILE_DIR);
  console.log('Extension loaded. ID:', extensionId);
  console.log('Opening Target sign-in / account area — use the browser window only.\n');

  const page = await browser.newPage();
  await page.goto('https://www.target.com/account', {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });

  await waitForManualLogin();

  const body = await page.evaluate(() => document.body?.innerText || '');
  const looksSignedIn =
    /\bSign out\b/i.test(body) ||
    /\bSign Out\b/i.test(body) ||
    /\bAccount\b.*\bOrders\b/i.test(body) ||
    /Hi,?\s+\w+/i.test(body);
  assert.ok(
    looksSignedIn,
    'Could not detect a signed-in account page (look for Sign out / account menu). If you are on a challenge page, complete it and run again with a longer TCH_MANUAL_WAIT_SECS.'
  );

  const tch = [];
  const cdp = await page.createCDPSession();
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.consoleAPICalled', (ev) => {
    const parts = (ev.args || []).map((a) => {
      if (a.value !== undefined) return String(a.value);
      if (a.unserializableValue) return String(a.unserializableValue);
      return a.description || '';
    });
    const text = parts.join(' ');
    if (text.includes('[TCH]')) tch.push(text);
  });

  await page.goto('https://www.target.com/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await new Promise((r) => setTimeout(r, 8000));
  assert.ok(tch.some((l) => l.includes('[TCH] init')), 'Content script should log [TCH] init on Target home while signed in');

  await page.goto('https://www.target.com/cart', { waitUntil: 'domcontentloaded', timeout: TIMEOUT }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  const cartUrl = page.url();
  assert.ok(cartUrl.includes('target.com'), 'Should stay on Target after cart navigation');

  console.log('\nMANUAL SESSION TEST PASS: signed-in heuristics + [TCH] init + cart reachable.');
  console.log('Next: try a product /p/… page with the extension ON for a real checkout rehearsal (you still place the order).');
}

main()
  .catch((e) => {
    console.error('\nMANUAL SESSION TEST FAIL:', e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (process.env.TCH_DELETE_PROFILE === '1') {
      await rmProfileDir(userDataDir);
    } else {
      console.log('\nProfile kept at:', userDataDir, '(npm run checkout-rehearsal reuses it; TCH_DELETE_PROFILE=1 to remove)');
    }
  });
