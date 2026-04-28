/**
 * Spawns Chromium with --load-extension, connects over CDP, waits for the extension in
 * Preferences (or DevTools targets), then opens Target and listens for [TCH] init.
 *
 * **Playwright’s bundled Chromium** (recommended) is used when present — run
 * `npm run install-chromium` once after `npm install`. It is not policy-locked like
 * many Google Chrome installs. Falls back to Edge (Windows), then system Chrome.
 *
 * Run: npm install && npm run install-chromium && node run.mjs
 * Override: TCH_BROWSER_PATH or CHROME_PATH
 */
import { execFileSync, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);

function playwrightChromiumExe() {
  try {
    const { chromium } = require('playwright');
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* playwright not installed or browsers missing */
  }
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = fs.realpathSync.native(
  path.resolve(__dirname, '..', '..', 'target-checkout-helper')
);

/** Windows 8.3 path — some Chrome builds load --load-extension more reliably. */
function windowsShortPath(absPath) {
  if (process.platform !== 'win32') return absPath;
  try {
    const quoted = `"${absPath.replace(/"/g, '')}"`;
    const out = execFileSync(
      'cmd.exe',
      ['/d', '/s', '/c', `for %I in (${quoted}) do @echo %~sI`],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 4096 }
    )
      .trim()
      .split(/\r?\n/)
      .pop();
    if (out && fs.existsSync(out)) return out;
  } catch {
    /* ignore */
  }
  return absPath;
}

const extPathForChrome = windowsShortPath(extPath);
if (extPathForChrome !== extPath) {
  console.log('Using Windows short path for --load-extension:', extPathForChrome);
}

const edgeOnWin =
  process.platform === 'win32'
    ? [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : [];

const browserCandidates = [
  process.env.TCH_BROWSER_PATH,
  process.env.CHROME_PATH,
  playwrightChromiumExe(),
  ...edgeOnWin,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const executablePath = browserCandidates.find((p) => p && fs.existsSync(p));
if (!executablePath) {
  console.error(
    'No browser found. Run: npm install && npm run install-chromium\n' +
      'Or set CHROME_PATH / TCH_BROWSER_PATH.'
  );
  process.exit(1);
}
console.log('Browser binary:', executablePath);

const diskManifest = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf8'));
if (diskManifest.name !== 'Target Checkout Helper' || diskManifest.manifest_version !== 3) {
  console.error('FAIL: target-checkout-helper/manifest.json unexpected');
  process.exit(1);
}

function normExtPath(p) {
  return path.resolve(String(p).replace(/\//g, path.sep)).replace(/\\/g, '/').toLowerCase();
}
const wantNorm = normExtPath(extPath);
const wantNormShort = normExtPath(extPathForChrome);

/** Same mapping Chromium uses for unpacked ids (for target matching only). */
function unpackedExtensionIdFromPath(absPath) {
  const resolved = fs.realpathSync.native(absPath);
  const hash = crypto.createHash('sha256').update(resolved, 'utf8').digest();
  const ap = 'abcdefghijklmnop';
  let id = '';
  for (let i = 0; i < 16; i++) {
    const b = hash[i];
    id += ap[(b >> 4) & 15];
    id += ap[b & 15];
  }
  return id;
}

function readExtensionIdFromPreferencesFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  let prefs;
  try {
    prefs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  const settings = prefs.extensions?.settings || {};
  for (const [id, meta] of Object.entries(settings)) {
    if (!meta || typeof meta !== 'object' || !meta.path) continue;
    const pNorm = normExtPath(meta.path);
    if (pNorm === wantNorm || pNorm === wantNormShort) return id;
  }
  return null;
}

function listProfileDirs(profileRoot) {
  try {
    return fs.readdirSync(profileRoot).filter((n) => {
      const p = path.join(profileRoot, n);
      return fs.statSync(p).isDirectory() && (n === 'Default' || /^Profile \d+$/i.test(n));
    });
  } catch {
    return ['Default'];
  }
}

function readExtensionIdFromProfile(profileRoot) {
  for (const prof of listProfileDirs(profileRoot)) {
    const candidates = [
      path.join(profileRoot, prof, 'Preferences'),
      path.join(profileRoot, prof, 'Secure Preferences'),
    ];
    for (const fp of candidates) {
      const id = readExtensionIdFromPreferencesFile(fp);
      if (id) return id;
    }
  }
  return null;
}

async function debugListDevtoolsTargets(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = await r.json();
    const ext = list.filter((j) => String(j.url || '').startsWith('chrome-extension://'));
    console.log('--- DEBUG: /json/list chrome-extension entries ---');
    console.log(ext.length ? ext.map((j) => `${j.type}: ${j.url}`).join('\n') : '(none)');
  } catch (e) {
    console.log('--- DEBUG: /json/list failed:', e.message);
  }
}

function dumpExtensionPathsForDebug(profileRoot) {
  console.log('--- DEBUG: extension paths in profile ---');
  const ls = path.join(profileRoot, 'Local State');
  if (fs.existsSync(ls)) {
    try {
      const raw = fs.readFileSync(ls, 'utf8');
      console.log('Local State size:', raw.length, '| has "extensions":', raw.includes('"extensions"'));
    } catch {
      /* ignore */
    }
  }
  for (const prof of listProfileDirs(profileRoot)) {
    const fp = path.join(profileRoot, prof, 'Preferences');
    if (!fs.existsSync(fp)) {
      console.log('(no Preferences)', fp);
      continue;
    }
    try {
      const prefs = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const settings = prefs.extensions?.settings || {};
      const keys = Object.keys(settings);
      console.log(`Profile ${prof}: ${keys.length} extension(s) in settings`);
      for (const [id, meta] of Object.entries(settings)) {
        if (meta?.path) console.log(' ', id, '→', meta.path);
      }
    } catch (e) {
      console.log('Parse error', fp, e.message);
    }
  }
}

async function pollExtensionId(profileRoot, timeoutMs = 35000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = readExtensionIdFromProfile(profileRoot);
    if (id) return id;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

async function waitForDevtools(port, timeoutMs = 45000) {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/json/version`);
      if (r.ok) return base;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Chrome remote debugging did not come up on port ${port}`);
}

const userDataDir = path.join(os.tmpdir(), `tch-ext-smoke-${Date.now()}`);
fs.mkdirSync(userDataDir, { recursive: true });

const port = await pickFreePort();
const derivedId = unpackedExtensionIdFromPath(extPath);

const chromeArgs = [
  '--enable-extensions',
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${userDataDir}`,
  `--load-extension=${extPathForChrome}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
];

let chromeStderr = '';
const child = spawn(executablePath, chromeArgs, {
  detached: false,
  stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr?.on('data', (chunk) => {
  chromeStderr += chunk.toString();
  if (chromeStderr.length > 12000) chromeStderr = chromeStderr.slice(-12000);
});

const tchLines = [];
const rawConsole = [];

let browser;
let exitCode = 0;
try {
  const devtoolsBase = await waitForDevtools(port);
  browser = await puppeteer.connect({ browserURL: devtoolsBase });

  const prefsId = await pollExtensionId(userDataDir);
  console.log('Preferences extension id:', prefsId || '(not found in time)');

  await new Promise((r) => setTimeout(r, 1500));
  const targets = await browser.targets();
  const extTargets = targets.filter((t) => String(t.url()).startsWith('chrome-extension://'));
  const idFromPrefsOrDerived = prefsId || derivedId;
  const ours = extTargets.filter((t) => t.url().includes(idFromPrefsOrDerived));
  console.log('Chromium path-hash id (reference only):', derivedId);
  console.log(
    'DevTools targets matching prefs/hash id:',
    ours.length ? ours.map((t) => `${t.type()}:${t.url()}`).join(' | ') : '(none)'
  );
  const low = executablePath.toLowerCase();
  if (low.includes('ms-playwright') || low.includes('playwright')) {
    console.log('Note: using Playwright’s bundled Chromium.');
  } else if (low.includes('msedge')) {
    console.log('Note: using Edge — Google Chrome may ignore --load-extension when policy-locked.');
  }

  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());

  const cdp = await page.createCDPSession();
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.consoleAPICalled', (ev) => {
    const parts = (ev.args || []).map((a) => {
      if (a.value !== undefined) return String(a.value);
      if (a.unserializableValue) return String(a.unserializableValue);
      return a.description || '';
    });
    const text = parts.join(' ');
    rawConsole.push(text);
    if (text.includes('[TCH]')) tchLines.push(text);
  });

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[TCH]')) tchLines.push(text);
  });

  await page.goto('https://www.target.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 7000));

  let hasInit = tchLines.some((l) => l.includes('[TCH] init'));
  if (!hasInit) {
    await page.goto('https://www.target.com/c/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 5000));
    hasInit = tchLines.some((l) => l.includes('[TCH] init'));
  }

  const title = await page.title().catch(() => '');
  const url = page.url();

  console.log('--- Chrome + extension smoke ---');
  console.log('Extension path:', extPath);
  console.log('Disk manifest:', diskManifest.name, 'v' + diskManifest.version);
  console.log('Target page:', url, '| title:', title.slice(0, 80));
  console.log('[TCH] init:', hasInit ? 'PASS' : 'not observed (normal under automation)');

  const registered = !!prefsId || ours.length > 0;
  console.log('Extension registered in Chrome:', registered ? 'PASS' : 'FAIL');
  exitCode = registered ? 0 : 2;
  if (!registered) {
    await debugListDevtoolsTargets(port);
    dumpExtensionPathsForDebug(userDataDir);
    if (chromeStderr.trim()) {
      console.log('--- Chrome stderr (tail) ---\n', chromeStderr.slice(-4000));
    } else {
      console.log('--- Chrome stderr: (empty) ---');
    }
  }
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  try {
    if (browser) await browser.disconnect();
  } catch (_) {}
  try {
    if (child && !child.killed) child.kill();
  } catch (_) {}
  await new Promise((r) => setTimeout(r, 800));
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (_) {}
}

process.exit(exitCode);
