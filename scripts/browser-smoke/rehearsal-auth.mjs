/**
 * Auth + extension storage helpers for automated checkout rehearsal.
 * Credentials from env only — never commit .env.rehearsal
 *
 * Env:
 *   TCH_TARGET_EMAIL
 *   TCH_TARGET_PASSWORD
 *   TCH_AUTO_SIGNIN=1 (default on when email+password set)
 */

export const DEFAULT_PRODUCT_URL =
  'https://www.target.com/p/scotch-shipping-packaging-tape-1-88in-x-54-6yd/-/A-13330690';

/**
 * @returns {{ automated: boolean, email: string, password: string }}
 */
export function getAuthFromEnv() {
  const email = (process.env.TCH_TARGET_EMAIL || '').trim();
  const password = process.env.TCH_TARGET_PASSWORD || '';
  const forceAuto = process.env.TCH_AUTO_SIGNIN === '1' || process.env.TCH_AUTO === '1';
  const automated = forceAuto || (email.length > 0 && password.length > 0);
  return { automated, email, password };
}

/**
 * @param {{ email: string, password: string }} auth
 */
export function buildExtensionStoragePatch(auth) {
  const patch = {
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
  if (auth.email && auth.password) {
    patch.autoSignIn = true;
    patch.targetEmail = auth.email;
    patch.targetPassword = auth.password;
  }
  return patch;
}

/**
 * @param {string} body
 */
export function looksSignedIn(body) {
  const t = String(body || '');
  return (
    /\bSign out\b/i.test(t) ||
    /\bSign Out\b/i.test(t) ||
    /Hi,?\s+\w+/i.test(t) ||
    (/\bOrders\b/i.test(t) && /\bAccount\b/i.test(t))
  );
}

/**
 * @param {import('puppeteer-core').Page} page
 * @param {string} extensionId
 * @param {{ email: string, password: string }} auth
 */
export async function applyExtensionSettings(page, extensionId, auth) {
  await page.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  const patch = buildExtensionStoragePatch(auth);
  await page.evaluate((next) => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(next, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else {
          chrome.storage.local.get(
            ['autoPlaceOrder', 'useSavedPayment', 'enabled', 'autoSignIn', 'targetEmail'],
            (data) => {
              if (data.autoPlaceOrder !== false || data.useSavedPayment !== true || data.enabled !== true) {
                reject(new Error('popup settings safety check failed'));
                return;
              }
              if (next.autoSignIn && (!data.autoSignIn || !data.targetEmail)) {
                reject(new Error('auto sign-in settings not persisted'));
                return;
              }
              chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', enabled: true }, () => resolve());
            }
          );
        }
      });
    });
  }, patch);
}

/**
 * Navigate to Target login and wait for extension auto sign-in.
 * @param {import('puppeteer-core').Page} page
 * @param {number} timeoutMs
 * @param {string[]} tchLines
 */
export async function ensureTargetSignedIn(page, timeoutMs, tchLines) {
  const loginUrl = 'https://www.target.com/login';
  console.log('\nAuto sign-in: opening Target login (extension fills credentials)...\n');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const url = page.url();
    if (looksSignedIn(body)) {
      console.log('Auto sign-in: detected signed-in account UI.');
      return;
    }
    if (!/\/login|\/signin/i.test(url) && /target\.com/i.test(url) && looksSignedIn(body)) {
      return;
    }
    if (tchLines.some((l) => l.includes('auto sign-in: submitting'))) {
      await new Promise((r) => setTimeout(r, 5000));
      const body2 = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (looksSignedIn(body2)) return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`sign-in timeout after ${timeoutMs}ms`);
}
