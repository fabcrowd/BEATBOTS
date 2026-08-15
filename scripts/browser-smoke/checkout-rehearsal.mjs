/**
 * Checkout rehearsal (automated): extension auto sign-in + product → review only.
 *
 * Required env (automated — no manual wait):
 *   TCH_TARGET_EMAIL
 *   TCH_TARGET_PASSWORD
 *
 * Optional:
 *   TCH_PRODUCT_URL — default: Scotch shipping tape TCIN 13330690
 *   TCH_PROFILE_DIR — default ~/.tch-rehearsal-chrome
 *   TCH_REHEARSAL_TIMEOUT_MS — default 420000
 *   TCH_SIGNIN_TIMEOUT_MS — default 120000
 *   TCH_MANUAL_WAIT_SECS — only used when credentials missing (legacy manual mode)
 *
 * Load secrets from file (gitignored):
 *   source scripts/browser-smoke/.env.rehearsal
 *   or: ./scripts/run-checkout-rehearsal.sh
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchWithExtension, rmProfileDir } from './launch-util.mjs';
import {
  BLOCKED_REASON,
  exitRehearsal,
  formatRehearsalFail,
} from './rehearsal-errors.mjs';
import {
  DEFAULT_PRODUCT_URL,
  applyExtensionSettings,
  ensureTargetSignedIn,
  getAuthFromEnv,
} from './rehearsal-auth.mjs';

const PRODUCT_URL = (process.env.TCH_PRODUCT_URL || DEFAULT_PRODUCT_URL).trim();
const PROFILE_DIR =
  process.env.TCH_PROFILE_DIR?.trim() ||
  path.join(os.homedir(), '.tch-rehearsal-chrome');
const MAX_MS = Number(process.env.TCH_REHEARSAL_TIMEOUT_MS || '420000');
const SIGNIN_MS = Number(process.env.TCH_SIGNIN_TIMEOUT_MS || '120000');

let browser;
let userDataDir;
let tchLines = [];
let activeShopPage = null;

async function captureFailureDebug(page, reason) {
  if (!page) return;
  try {
    const probe = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyLength: (document.body?.innerText || '').length,
      dialogCount: document.querySelectorAll('[role="dialog"]').length,
      hasAuthModal: !!document.querySelector('[data-test="authModal"], [data-test="loginModal"]'),
      hasPasswordInput: !!document.querySelector('input[type="password"]'),
      hasPlaceOrder: !!document.querySelector('[data-test="placeOrderButton"], button[data-test*="place-order" i]'),
    }));
    console.error('\nDOM probe:', JSON.stringify(probe, null, 2));
  } catch (e) {
    console.error('DOM probe failed:', e?.message || e);
  }
  try {
    const dir = process.env.TCH_REHEARSAL_SCREENSHOT_DIR?.trim()
      || path.join(PROFILE_DIR, 'rehearsal-failures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${reason}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.error('Screenshot saved:', file);
  } catch (e) {
    console.error('Screenshot failed:', e?.message || e);
  }
}

async function failRehearsal(code, message, tchLinesArg = tchLines) {
  await captureFailureDebug(activeShopPage, code);
  exitRehearsal(code, message, tchLinesArg);
}

function attachTchConsole(page) {
  tchLines = [];
  return page.createCDPSession().then(async (cdp) => {
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.consoleAPICalled', (ev) => {
      const parts = (ev.args || []).map((a) => {
        if (a.value !== undefined) return String(a.value);
        if (a.unserializableValue) return String(a.unserializableValue);
        return a.description || '';
      });
      const text = parts.join(' ');
      if (text.includes('[TCH]')) tchLines.push(text);
    });
  });
}

function classifyRehearsalFailure(lines) {
  const joined = lines.join('\n').toLowerCase();
  if (joined.includes('checkout step: signin') || joined.includes('sign in')) {
    return BLOCKED_REASON.SIGNIN_TIMEOUT;
  }
  if (joined.includes('atc button not found') || joined.includes('out of stock')) {
    return BLOCKED_REASON.OOS_OR_ATC_FAILED;
  }
  return BLOCKED_REASON.REVIEW_TIMEOUT;
}

async function main() {
  const auth = getAuthFromEnv();
  if (!auth.automated || !auth.email || !auth.password) {
    exitRehearsal(
      BLOCKED_REASON.MISSING_CREDENTIALS,
      'Automated rehearsal requires TCH_TARGET_EMAIL and TCH_TARGET_PASSWORD.\n' +
        '  Create scripts/browser-smoke/.env.rehearsal (see .env.rehearsal.example)\n' +
        '  Or: ./scripts/run-checkout-rehearsal.sh'
    );
  }

  if (!PRODUCT_URL || !/^https:\/\/(www\.)?target\.com\//i.test(PRODUCT_URL)) {
    exitRehearsal(BLOCKED_REASON.MISSING_PRODUCT_URL, 'Invalid TCH_PRODUCT_URL');
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  userDataDir = PROFILE_DIR;

  let launched;
  try {
    launched = await launchWithExtension({
      userDataDir: PROFILE_DIR,
      timeout: 120000,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/chromium|executable|playwright/i.test(msg)) {
      exitRehearsal(
        BLOCKED_REASON.NO_CHROMIUM,
        `${msg}\nRun: cd scripts/browser-smoke && npx playwright install chromium`
      );
    }
    if (/display|x11|headed|launch/i.test(msg)) {
      exitRehearsal(BLOCKED_REASON.NO_DISPLAY, msg);
    }
    throw e;
  }

  browser = launched.browser;
  const { extensionId, TIMEOUT } = launched;

  console.log('\nPersistent profile:', PROFILE_DIR);
  console.log('Extension ID:', extensionId);
  console.log('Product URL:', PRODUCT_URL);
  console.log('Auto sign-in:', auth.email.replace(/(.).+(@.*)/, '$1***$2'));

  const popup = await browser.newPage();
  await applyExtensionSettings(popup, extensionId, auth);
  await popup.close();

  const signInPage = await browser.newPage();
  await attachTchConsole(signInPage);
  try {
    await ensureTargetSignedIn(signInPage, SIGNIN_MS, tchLines);
  } catch (e) {
    await failRehearsal(BLOCKED_REASON.SIGNIN_TIMEOUT, String(e.message || e), tchLines);
  }

  const shop = signInPage;
  activeShopPage = shop;
  console.log('\nWarming checkout session…\n');
  await shop.goto('https://www.target.com/checkout', { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 5000));

  console.log('\nNavigating to product (extension drives toward review)...\n');
  await shop.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

  const deadline = Date.now() + MAX_MS;
  while (Date.now() < deadline) {
    if (tchLines.some((l) => l.includes('[TCH] review reached'))) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!tchLines.some((l) => l.includes('[TCH] review reached'))) {
    await failRehearsal(
      classifyRehearsalFailure(tchLines),
      `Timed out waiting for [TCH] review reached (${MAX_MS}ms).`,
      tchLines
    );
  }

  console.log('\nCHECKOUT REHEARSAL PASS — reached review (no Place Order).');
  console.log('Final URL:', shop.url());
  const timing = tchLines.filter((l) => l.includes('checkout_total_to_review')).pop();
  if (timing) console.log('Timing:', timing);
}

main()
  .catch((e) => {
    const msg = String(e?.message || e);
    console.error('\nCHECKOUT REHEARSAL FAIL');
    console.error(formatRehearsalFail(classifyRehearsalFailure(tchLines), msg, tchLines));
    process.exit(1);
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (process.env.TCH_DELETE_PROFILE === '1') {
      await rmProfileDir(userDataDir);
    } else if (userDataDir) {
      console.log('\nProfile kept at:', userDataDir, '(set TCH_DELETE_PROFILE=1 to remove)');
    }
  });
