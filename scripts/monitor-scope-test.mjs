#!/usr/bin/env node
/**
 * Node tests for target-checkout-helper/core/monitorScope.js (no browser).
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scopePath = path.join(__dirname, '../target-checkout-helper/core/monitorScope.js');
const code = fs.readFileSync(scopePath, 'utf8');

function loadMonitorScope() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.TCH_MONITOR_SCOPE;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

const M = loadMonitorScope();
const mixed = [
  { url: 'https://www.target.com/p/a/-/A-1' },
  { url: 'https://www.walmart.com/ip/item/1' },
];

assert(M.resolvePollScope() === 'target', 'default scope is target');
assert(M.resolvePollScope(/walmart\.com/i) === 'walmart', 'walmart filter scope');
assert(M.filterProductsByPollScope(mixed, 'target').length === 1, 'target scope keeps Target SKU');
assert(M.filterProductsByPollScope(mixed, 'walmart').length === 1, 'walmart scope keeps Walmart SKU');
assert(M.filterProductsByPollScope(mixed, 'all').length === 2, 'all scope keeps both');
assert(!M.isRetailerFilter({}), 'plain object is not retailer filter');
assert(M.isRetailerFilter(/walmart/i), 'regex is retailer filter');

if (process.exitCode) {
  console.error('monitor-scope-test: failures');
  process.exit(process.exitCode);
}
console.log('monitor-scope-test: PASS');
