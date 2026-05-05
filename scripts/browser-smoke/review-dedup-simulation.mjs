#!/usr/bin/env node
/**
 * Mirrors post-fix handleReviewStep: dedup commits only after successful completion;
 * failed Place Order probe does not arm dedup; in-flight blocks concurrent same-URL.
 *
 * Run: node scripts/browser-smoke/review-dedup-simulation.mjs
 */
import assert from 'node:assert/strict';

const reviewDedupWindowMs = 15000;

let lastReviewKey = null;
let lastReviewAt = 0;
let reviewStepInFlight = false;
let reviewStepInFlightKey = '';

async function handleReviewStepLike(reviewKey, placeOrderFound) {
  const now = Date.now();
  if (lastReviewKey === reviewKey && now - lastReviewAt < reviewDedupWindowMs) {
    return { path: 'early_return_dedup' };
  }
  if (reviewStepInFlight && reviewStepInFlightKey === reviewKey) {
    return { path: 'early_return_inflight' };
  }
  reviewStepInFlight = true;
  reviewStepInFlightKey = reviewKey;
  try {
    if (!placeOrderFound) {
      return { path: 'failed_wait', scheduleCheckoutRetry: true };
    }
    lastReviewKey = reviewKey;
    lastReviewAt = Date.now();
    return { path: 'success' };
  } finally {
    reviewStepInFlight = false;
    reviewStepInFlightKey = '';
  }
}

async function main() {
  const key = '/checkout?x=1';

  const r1 = await handleReviewStepLike(key, false);
  assert.equal(r1.path, 'failed_wait');
  assert.equal(lastReviewKey, null, 'failed probe must not arm dedup');

  const r2 = await handleReviewStepLike(key, true);
  assert.equal(r2.path, 'success');
  assert.equal(lastReviewKey, key);

  const r3 = await handleReviewStepLike(key, true);
  assert.equal(r3.path, 'early_return_dedup', 'second success within window should dedup');

  lastReviewAt = Date.now() - reviewDedupWindowMs - 1;
  const r4 = await handleReviewStepLike(key, true);
  assert.equal(r4.path, 'success', 'after window expires, should run again');

  const key2 = '/checkout?other=1';
  lastReviewKey = null;
  lastReviewAt = 0;
  reviewStepInFlight = true;
  reviewStepInFlightKey = key2;
  const r5 = await handleReviewStepLike(key2, true);
  assert.equal(r5.path, 'early_return_inflight');
  reviewStepInFlight = false;
  reviewStepInFlightKey = '';

  console.log('review-dedup-simulation PASS: matches content.js post-fix semantics');
}

main().catch((e) => {
  console.error('review-dedup-simulation FAIL:', e);
  process.exit(1);
});
