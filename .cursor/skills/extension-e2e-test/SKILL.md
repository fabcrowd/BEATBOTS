---
name: extension-e2e-test
description: >-
  Runs automated end-to-end tests for Chrome extensions with Puppeteer: launch
  headed Chrome with --load-extension, resolve unpacked extension ID from the
  service worker target, open chrome-extension:// pages (popup, options, side
  panel), use frame.evaluate for sandbox iframes, and assert cross-context
  behavior. Use when the user mentions testing an extension, e2e extension,
  Puppeteer + extension, verifying the extension in Chrome, extension smoke, or
  loading unpacked in automation.
---

# Chrome Extension E2E Testing with Puppeteer

Automate end-to-end testing of Chrome extensions by loading them in a real Chrome instance via Puppeteer. This skill covers the full lifecycle: launching Chrome with the extension, getting the extension ID, navigating extension pages (side panel, popup, options), interacting with sandbox iframes, and verifying cross-context messaging (content script ↔ service worker ↔ offscreen document ↔ side panel).

## Agent checklist

1. Read this skill when the user wants extension E2E or Puppeteer against unpacked MV2/MV3.
2. Use `headless: false` and an isolated `user-data-dir` (see Step 2).
3. Resolve extension ID from a `service_worker` or `background_page` target whose URL starts with `chrome-extension://` (avoid brittle `service-worker` substring checks).
4. For this repo’s unpacked tree, extension root is often `target-checkout-helper/` (no build step); point `EXTENSION_PATH` there unless the project uses `dist/extension/`.

## When to Use

- Verifying a Chrome extension feature works after code changes
- Testing message routing between extension contexts (side panel, offscreen, service worker)
- Interacting with CSP-exempt sandbox iframes inside an extension
- Debugging extension-specific issues that can't be reproduced in CLI/standalone mode
- Running automated regression tests before shipping an extension update

## Prerequisites

1. **Puppeteer** installed in the project (`npm install --save-dev puppeteer`, or `puppeteer` as a dependency).
2. **An extension load directory** that contains `manifest.json` — typically from a build step (e.g. `npm run build:extension` → `dist/extension/`), or an unpacked extension folder if the project has no bundle step.

## FAQ

**What are the prerequisites for using this skill?**  
You need Puppeteer installed in your project and a directory that contains your extension’s `manifest.json` (e.g. build output like `dist/extension/`, or an unpacked tree).

**Can I test Manifest V3 features like service workers?**  
Yes. The skill includes patterns for waiting on the MV3 service worker target and for exercising flows that involve the service worker, offscreen documents, and other contexts; verify offscreen effects indirectly when you cannot attach a page to the offscreen document.

**Does this skill work with headless Chrome?**  
No. Extensions need a real Chrome UI session. Use `headless: false` (as in the skill). In CI, headed Chrome behind a virtual display (e.g. Xvfb) is the usual pattern if you need automation without a physical monitor.

**How does it interact with sandbox iframes?**  
Sandboxed extension pages are cross-origin from the parent, so `contentDocument` is not usable. Use Puppeteer’s **frame** API (`page.frames()`, `frame.evaluate()`, etc.) so CDP can reach the iframe’s execution context.

**How does the skill handle dynamic extension IDs?**  
The ID is read at runtime from the service worker (or MV2 `background_page`) target URL (`chrome-extension://<id>/...`). Prefer `t.url().startsWith('chrome-extension://')` on `service_worker` targets rather than matching a specific path fragment, so unpacked loads stay stable when the ID or SW path changes between runs.

## Instructions

### Step 1: Build (or locate) the extension

If the project has a build step, run it so output is fresh:

```bash
npm run build:extension
```

Otherwise use the unpacked extension directory that already contains `manifest.json`. That directory (often `dist/extension/` or e.g. `target-checkout-helper/`) is what you pass to `--load-extension` / `--disable-extensions-except`.

### Step 2: Launch Chrome with the Extension

Key flags:

- `--disable-extensions-except=<path>` — Only load your extension (no others)
- `--load-extension=<path>` — Load unpacked extension from this directory
- `--no-first-run` — Skip Chrome's first-run UI
- `--user-data-dir=/tmp/...` — Isolated profile so tests don't interfere with your real browser

```javascript
import puppeteer from 'puppeteer';
import path from 'node:path';
import os from 'node:os';

const EXTENSION_PATH = path.resolve(__dirname, 'dist/extension');
const userDataDir = path.join(os.tmpdir(), `ext-e2e-${Date.now()}`);

const browser = await puppeteer.launch({
  headless: false,  // Extensions require headed mode
  protocolTimeout: 60000,
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-popup-blocking',
    `--user-data-dir=${userDataDir}`,
  ],
});
```

**Critical:** Extensions do NOT work in headless mode. You must use `headless: false`.

### Step 3: Get the Extension ID

The extension ID is assigned dynamically when loading unpacked. Get it from the service worker target URL (Chrome uses `service_worker` in the path for many MV3 builds; matching `chrome-extension://` is reliable):

```javascript
const swTarget = await browser.waitForTarget(
  t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
  { timeout: 30000 },
);
const extensionId = swTarget.url().match(/chrome-extension:\/\/([^/]+)/)![1];
```

If your extension doesn't have a service worker (Manifest V2 with background page), use:

```javascript
const bgTarget = await browser.waitForTarget(
  t => t.type() === 'background_page',
  { timeout: 30000 },
);
```

### Step 4: Open Extension Pages

Extension pages (side panel, popup, options) can be opened by navigating directly to their `chrome-extension://` URL:

```javascript
const page = await browser.newPage();
await page.goto(`chrome-extension://${extensionId}/index.html`, {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
```

Common extension page paths:

- Side panel: `index.html` or `sidepanel.html`
- Popup: `popup.html`
- Options: `options.html`
- Offscreen: `offscreen.html` (usually created programmatically, not navigated to)

### Step 5: Wait for Extension Initialization

Extensions often need time to initialize (offscreen document creation, IndexedDB population, service worker startup). Poll for readiness:

```javascript
// Wait for a global flag set by your extension code
await page.waitForFunction(
  () => !!(window as any).__myExtensionReady,
  { timeout: 30000 }
);

// Or poll for specific state
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const ready = await page.evaluate(() => {
    // Check whatever indicates your extension is initialized
    return document.querySelector('.main-content') !== null;
  });
  if (ready) break;
  if (i === 19) throw new Error('Extension did not initialize within 20s');
}
```

### Step 6: Interact with Sandbox Iframes

Extension sandbox iframes (CSP-exempt pages listed in `manifest.json` `sandbox.pages`) are cross-origin — `iframe.contentDocument` returns null. Use Puppeteer's frame API instead:

```javascript
// Find the sandbox iframe's frame by URL pattern
const sandboxFrame = page.frames().find(
  f => f.url().includes('sandbox.html')
);

if (sandboxFrame) {
  // Evaluate inside the sandbox iframe
  const heading = await sandboxFrame.evaluate(() =>
    document.querySelector('h1')?.textContent?.trim() || '(none)'
  );

  // Check for bridge objects injected via postMessage
  const hasBridge = await sandboxFrame.evaluate(() =>
    typeof (window as any).myBridge !== 'undefined'
  );

  // Click buttons inside the sandbox
  await sandboxFrame.evaluate(() => {
    (document.querySelector('#my-button') as HTMLButtonElement)?.click();
  });
}
```

**Why not contentDocument?** Sandbox iframes run on a unique null origin, making them cross-origin even within the same extension. Puppeteer's frame API uses CDP to access them directly.

### Step 7: Test Cross-Context Messaging

To verify messages flow between contexts (e.g., side panel → service worker → offscreen):

```javascript
// Set up a listener in the page to catch messages
await page.evaluate(() => {
  (window as any).__capturedMessages = [];
  window.addEventListener('message', (e) => {
    (window as any).__capturedMessages.push(e.data);
  });
});

// Trigger an action that sends a message (e.g., from a sandbox iframe)
if (sandboxFrame) {
  await sandboxFrame.evaluate(() => {
    (window as any).myBridge.sendEvent({ action: 'test', data: { n: 1 } });
  });
}

// Wait and check
await new Promise(r => setTimeout(r, 1000));
const messages = await page.evaluate(() => (window as any).__capturedMessages);
console.assert(messages.length > 0, 'No messages received');
```

For `chrome.runtime` message verification (panel → offscreen), you typically can't directly observe the offscreen document from puppeteer. Instead, verify the effect — e.g., check that the UI updated, a DOM element changed, or state was persisted.

### Step 8: Test Data Push (Parent → Iframe)

To verify data flowing from the parent page into a sandbox iframe:

```javascript
// Register a handler inside the iframe
await sandboxFrame.evaluate(() => {
  (window as any).__receivedData = null;
  (window as any).myBridge.on('update', (data: any) => {
    (window as any).__receivedData = data;
  });
});

// Send data from the parent page
await page.evaluate(() => {
  (window as any).myManager.sendData('target-name', { msg: 'hello', n: 42 });
});

await new Promise(r => setTimeout(r, 1000));

const received = await sandboxFrame.evaluate(() => (window as any).__receivedData);
console.assert(received?.n === 42, 'Data not received in iframe');
```

### Step 9: Take Screenshots for Debugging

Capture screenshots at key points for visual verification and debugging failures:

```javascript
import path from 'node:path';
import os from 'node:os';
await page.screenshot({
  path: path.join(os.tmpdir(), 'ext-test-step1.png'),
  fullPage: true,
});
```

### Step 10: Clean Up

Always close the browser, even on failure:

```javascript
try {
  await runTests();
} catch (err) {
  console.error('FATAL:', err);
  process.exit(1);
} finally {
  await browser.close().catch(() => {});
}
```

## Complete Test Script Template

```typescript
import puppeteer, { type Browser } from 'puppeteer';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, 'dist/extension');
const TIMEOUT = 60000;

let browser: Browser;

function log(step: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString().slice(11, 23);
  const d = data !== undefined ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}] ${step}: ${msg}${d}`);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const userDataDir = path.join(os.tmpdir(), `ext-e2e-${Date.now()}`);
  // 1. Launch
  browser = await puppeteer.launch({
    headless: false,
    protocolTimeout: TIMEOUT,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-default-apps', '--disable-popup-blocking',
      `--user-data-dir=${userDataDir}`,
    ],
  });

  // 2. Get extension ID
  const swTarget = await browser.waitForTarget(
    t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
    { timeout: TIMEOUT },
  );
  const extensionId = swTarget.url().match(/chrome-extension:\/\/([^/]+)/)![1];
  log('SETUP', 'Extension ID: ' + extensionId);

  // 3. Open extension page
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`, {
    waitUntil: 'domcontentloaded', timeout: TIMEOUT,
  });

  // 4. Wait for initialization
  // ... (poll for your extension's ready state)

  // 5. Run tests
  // ... (use page.evaluate, frame API, screenshots)

  log('DONE', 'All tests complete');
}

run()
  .catch(err => { console.error('FATAL:', err); process.exit(1); })
  .finally(async () => { if (browser) await browser.close().catch(() => {}); });
```

Run with: `npx tsx test-extension.ts`
