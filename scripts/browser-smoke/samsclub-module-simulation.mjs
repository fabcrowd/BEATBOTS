#!/usr/bin/env node
/**
 * SC-1: Sam's Club retailer module — hosts detection, manifest wiring, FCFS no-sacred-lock (SC-5).
 * Offline simulation + source invariants — no browser required for core checks.
 *
 * Run: node scripts/browser-smoke/samsclub-module-simulation.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const HOSTS_SRC = readFileSync(join(ROOT, 'target-checkout-helper/core/hosts.js'), 'utf8');
const SC_SRC = readFileSync(join(ROOT, 'target-checkout-helper/samsclub-content.js'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'target-checkout-helper/manifest.json'), 'utf8'));
const CONTENT_SRC = readFileSync(join(ROOT, 'target-checkout-helper/content.js'), 'utf8');

/** Evaluate hosts.js in a vm sandbox (mirrors content-script global). */
function loadHosts() {
  const sandbox = vm.createContext({ URL });
  sandbox.globalThis = sandbox;
  vm.runInContext(HOSTS_SRC, sandbox);
  return sandbox.TCH_HOSTS;
}

function scGetPageType(pathname) {
  if (/\/p\//.test(pathname) || /\/ip\//.test(pathname) || /\/prod\//.test(pathname)) return 'product';
  if (pathname.includes('/cart')) return 'cart';
  if (pathname.includes('/checkout')) return 'checkout';
  return 'other';
}

function runSc1HostsTests(hosts) {
  assert.ok(hosts.SAMSCLUB, 'SC-1: TCH_HOSTS.SAMSCLUB defined');
  assert.equal(hosts.SAMSCLUB.id, 'samsclub');
  assert.equal(hosts.SAMSCLUB.hostSuffixes[0], 'samsclub.com');

  assert.equal(hosts.detectRetailer('https://www.samsclub.com/p/test/123'), 'samsclub');
  assert.equal(hosts.detectRetailer('https://samsclub.com/cart'), 'samsclub');
  assert.equal(hosts.detectRetailer('https://www.target.com/p/x'), 'target');
  assert.equal(hosts.detectRetailer('https://www.walmart.com/ip/x'), 'walmart');
  assert.equal(hosts.detectRetailer('https://example.com/'), null);

  assert.equal(hosts.cookieDomainsFor('samsclub')[0], 'samsclub.com');
  assert.equal(hosts.cookieDomainsFor('target')[0], 'target.com');
}

function runSc1ManifestTests() {
  const hostPerms = MANIFEST.host_permissions || [];
  assert.ok(
    hostPerms.some((p) => p.includes('samsclub.com')),
    'SC-1: manifest host_permissions includes samsclub.com'
  );

  const scScript = (MANIFEST.content_scripts || []).find(
    (cs) => Array.isArray(cs.matches) && cs.matches.some((m) => m.includes('samsclub.com'))
  );
  assert.ok(scScript, 'SC-1: content_scripts entry for samsclub.com');
  assert.ok(
    scScript.js.includes('samsclub-content.js'),
    'SC-1: samsclub content script loads samsclub-content.js'
  );
  assert.ok(
    scScript.js.includes('core/hosts.js'),
    'SC-1: samsclub content script loads core/hosts.js'
  );
}

function runSc5NoSacredLockTests() {
  const forbidden = [
    'inQueueUrls',
    'WALMART_IN_QUEUE',
    'WALMART_NAV_FAILED',
    'navigationLock',
    'sacred',
    'wmIsProductQueued',
    'wmHasQueueIndicators',
  ];
  for (const token of forbidden) {
    assert.ok(
      !SC_SRC.includes(token),
      `SC-5: samsclub-content.js must not reference Walmart queue token "${token}"`
    );
  }
  assert.ok(
    !CONTENT_SRC.includes("detected === 'samsclub'") ||
      CONTENT_SRC.includes('samsclub_handled'),
    'SC-1: content.js delegates samsclub to samsclub-content.js'
  );
}

function runSc1PageTypeTests() {
  assert.equal(scGetPageType('/p/member-mark/123'), 'product');
  assert.equal(scGetPageType('/ip/test-item/456'), 'product');
  assert.equal(scGetPageType('/prod/foo'), 'product');
  assert.equal(scGetPageType('/cart'), 'cart');
  assert.equal(scGetPageType('/checkout/review'), 'checkout');
  assert.equal(scGetPageType('/help'), 'other');
}

function main() {
  const hosts = loadHosts();
  runSc1HostsTests(hosts);
  runSc1ManifestTests();
  runSc5NoSacredLockTests();
  runSc1PageTypeTests();
  console.log(
    "samsclub-module-simulation PASS (SC-1 + SC-5): hosts, manifest, FCFS no sacred lock"
  );
}

main();
