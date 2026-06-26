#!/usr/bin/env node
/**
 * Node tests for target-checkout-helper/core/checkoutReliability.js
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const relPath = path.join(__dirname, '../target-checkout-helper/core/checkoutReliability.js');
const code = fs.readFileSync(relPath, 'utf8');

function loadReliability() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.TCH_CHECKOUT_RELIABILITY;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

const R = loadReliability();

assert(R.hasHighVolumeBlock('We are experiencing issues due to high volume'), 'high volume text');
assert(R.hasHighVolumeBlock('Something went wrong. Please try again later.'), 'error banner');
assert(!R.hasHighVolumeBlock('Add to cart'), 'normal PDP text');

assert(R.isCartEmptyText('Your cart is empty'), 'empty cart copy');
assert(!R.isCartEmptyText('1 item in cart'), 'in cart copy');

assert(R.shouldRetryFromProductAfterCartFailure('Cart empty on cart page'), 'retry from product on empty');
assert(!R.shouldRetryFromProductAfterCartFailure('ATC button not found'), 'no retry on ATC miss');

if (process.exitCode) {
  console.error('checkout-reliability-test: FAILED');
  process.exit(1);
}
console.log('All checkout reliability tests passed.');
