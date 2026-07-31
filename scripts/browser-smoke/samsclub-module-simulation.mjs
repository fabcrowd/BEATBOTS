#!/usr/bin/env node
/**
 * SC-1: Sam's Club retailer module — hosts, manifest, FCFS stub content script.
 * Offline simulation — no browser required.
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

/** Evaluate hosts.js in a vm sandbox (mirrors content-script global). */
function loadHosts() {
  const sandbox = vm.createContext({ URL });
  sandbox.globalThis = sandbox;
  vm.runInContext(HOSTS_SRC, sandbox);
  return sandbox.TCH_HOSTS;
}

function testSc1Hosts() {
  const hosts = loadHosts();
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

function testSc1Manifest() {
  assert.ok(
    MANIFEST.host_permissions.some((p) => p.includes('samsclub.com')),
    'SC-1: manifest host_permissions includes samsclub.com'
  );

  const scScript = MANIFEST.content_scripts.find((cs) =>
    cs.matches.some((m) => m.includes('samsclub.com'))
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

function testSc1StubSource() {
  assert.ok(SC_SRC.includes('[TCH] init:'), 'SC-1: stub logs [TCH] init');
  assert.ok(
    SC_SRC.includes("detectRetailer(location.href) !== 'samsclub'"),
    'SC-1: stub guards on samsclub retailer detection'
  );
  assert.ok(SC_SRC.includes('FCFS'), 'SC-1: FCFS semantics documented in source');
  assert.ok(!SC_SRC.includes('WALMART_IN_QUEUE'), 'SC-5: stub must not emit WALMART_IN_QUEUE');
  assert.ok(!SC_SRC.includes('walmart-content'), 'SC-3: must not import walmart-content.js');
  assert.ok(SC_SRC.includes('scGetPageType'), 'SC-1: page type helper for init telemetry');
}

function main() {
  testSc1Hosts();
  testSc1Manifest();
  testSc1StubSource();
  console.log(
    "samsclub-module-simulation PASS (SC-1): hosts, manifest, FCFS stub content script"
  );
}

main();
