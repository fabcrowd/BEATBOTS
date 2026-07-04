#!/usr/bin/env node
/**
 * Monitor ATC guard tests (no Chrome).
 * Locks in handleATCSuccess reload-skip when tab is already in cart/checkout.
 */

function isInCheckoutFlow(url) {
  if (!url) return false;
  try {
    const path = new URL(url).pathname;
    return /^\/(cart|checkout|thankyou|thank-you|order-confirm)/i.test(path);
  } catch {
    return false;
  }
}

function shouldReloadMonitorTabForNextQty(tabUrl) {
  return !isInCheckoutFlow(tabUrl);
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

assert(isInCheckoutFlow('https://www.target.com/checkout'), 'target checkout path');
assert(isInCheckoutFlow('https://www.walmart.com/cart'), 'walmart cart path');
assert(!isInCheckoutFlow('https://www.target.com/p/-/A-12345'), 'product page not checkout flow');
assert(!shouldReloadMonitorTabForNextQty('https://www.target.com/checkout'), 'skip reload on checkout');
assert(shouldReloadMonitorTabForNextQty('https://www.target.com/p/-/A-12345'), 'reload ok on product page');

if (process.exitCode === 1) {
  console.error('\nMonitor ATC tests failed.');
  process.exit(1);
}
console.log('All monitor ATC guard tests passed.');
