/**
 * Shared Playwright Chromium + Puppeteer launch with unpacked target-checkout-helper.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const EXTENSION_PATH = fs.realpathSync.native(
  path.resolve(__dirname, '..', '..', 'target-checkout-helper')
);

export function getChromiumExecutable() {
  const p = chromium.executablePath();
  if (!p || !fs.existsSync(p)) {
    throw new Error('Playwright Chromium missing. Run: npm run install-chromium');
  }
  return p;
}

/**
 * @param {{
 *   timeout?: number,
 *   profilePrefix?: string,
 *   /** If set, reuse this Chrome user-data-dir (login + extension state persist). */
 *   userDataDir?: string,
 * }} [options]
 */
export async function launchWithExtension(options = {}) {
  const TIMEOUT = options.timeout ?? 60000;
  const userDataDir =
    options.userDataDir ||
    path.join(os.tmpdir(), `${options.profilePrefix ?? 'tch-'}${Date.now()}`);
  if (options.userDataDir) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    protocolTimeout: TIMEOUT,
    executablePath: getChromiumExecutable(),
    userDataDir,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-popup-blocking',
    ],
  });

  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
    { timeout: TIMEOUT }
  );
  const m = swTarget.url().match(/chrome-extension:\/\/([^/]+)/);
  if (!m) throw new Error(`Bad SW URL: ${swTarget.url()}`);
  const extensionId = m[1];

  return { browser, extensionId, userDataDir, TIMEOUT };
}

export async function rmProfileDir(userDataDir) {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
