/**
 * Extension E2E (see .cursor/skills/extension-e2e-test/SKILL.md):
 * Puppeteer + Playwright Chromium, --load-extension, MV3 service worker → id,
 * chrome-extension:// popup, then Target.com [TCH] init.
 */
import assert from 'node:assert/strict';
import { launchWithExtension, rmProfileDir } from './launch-util.mjs';

let browser;
let userDataDir;

async function sendBg(page, msg) {
  return page.evaluate(
    (m) =>
      new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(m, (res) => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(res);
          });
        } catch (e) {
          reject(e);
        }
      }),
    msg
  );
}

async function main() {
  const launched = await launchWithExtension({ profilePrefix: 'tch-e2e-' });
  browser = launched.browser;
  userDataDir = launched.userDataDir;
  const { extensionId, TIMEOUT } = launched;
  console.log('Extension ID:', extensionId);

  const popupPage = await browser.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });

  await popupPage.waitForSelector('#appTitle', { timeout: 15000 });
  const appTitle = await popupPage.$eval('#appTitle', (el) => el.textContent?.trim());
  assert.equal(appTitle, 'Target Checkout Helper');

  await popupPage.waitForSelector('#enableToggle', { timeout: 10000 });
  assert.ok(await popupPage.$('#enableToggle'));

  const statusText = await popupPage.$eval('#statusText', (el) => el.textContent?.trim() || '');
  assert.ok(
    statusText.includes('Extension') || statusText.includes('On') || statusText.includes('Off'),
    `statusText: ${statusText}`
  );

  await popupPage.click('#tabForms');
  await popupPage.waitForFunction(
    () => {
      const p = document.getElementById('panelForms');
      return p && !p.hidden;
    },
    { timeout: 10000 }
  );

  const targetPage = await browser.newPage();
  const tchLogs = [];
  const cdp = await targetPage.createCDPSession();
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.consoleAPICalled', (ev) => {
    const parts = (ev.args || []).map((a) => {
      if (a.value !== undefined) return String(a.value);
      if (a.unserializableValue) return String(a.unserializableValue);
      return a.description || '';
    });
    const text = parts.join(' ');
    if (text.includes('[TCH]')) tchLogs.push(text);
  });

  await targetPage.goto('https://www.target.com/', {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });
  await new Promise((r) => setTimeout(r, 10000));

  assert.ok(
    tchLogs.some((l) => l.includes('[TCH] init')),
    `expected [TCH] init in console, got: ${tchLogs.slice(0, 5).join(' | ') || '(none)'}`
  );

  const pgTitle = await targetPage.title();
  assert.ok(pgTitle.length > 0, 'Target page should have a title');

  console.log('E2E PASS: popup UI + Target [TCH] init');
}

main()
  .catch((err) => {
    console.error('E2E FAIL:', err);
    process.exit(1);
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    await rmProfileDir(userDataDir);
  });
