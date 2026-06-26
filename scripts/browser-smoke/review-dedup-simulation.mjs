#!/usr/bin/env node
/**
 * Mirrors post-fix handleReviewStep (TGT-3 dedup + TGT-4 autoPlaceOrder gate) and
 * wmHandleReview (Walmart manual stop). Offline simulation — no browser required.
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

  console.log('review-dedup-simulation PASS (TGT-3): dedup matches content.js post-fix semantics');
}

/** Mirrors content.js handleReviewStep autoPlaceOrder gate (lines ~1631–1649). */
function targetReviewAutoPlaceGate(settings, placeOrderBtn) {
  const clicks = [];
  if (settings.autoPlaceOrder) {
    const btn = placeOrderBtn;
    if (btn && !btn.disabled) {
      clicks.push('place_order');
      return { path: 'auto_click', clicks };
    }
    return { path: 'auto_blocked', clicks };
  }
  return { path: 'manual_stop', clicks, toast: 'Reached review — Place Order remains manual.' };
}

/** Mirrors walmart-content.js wmHandleReview (lines ~860–872). */
function walmartReviewAutoPlaceGate(settings, placeOrderBtn, visible) {
  if (!settings.autoPlaceOrder) {
    return { path: 'manual_stop', clicks: [], toast: 'Reached review — Place Order remains manual' };
  }
  if (placeOrderBtn && visible) {
    return { path: 'auto_click', clicks: ['place_order'] };
  }
  return { path: 'auto_not_found', clicks: [] };
}

function runTgt4Tests() {
  const defaultSettings = { autoPlaceOrder: false };
  const enabledBtn = { disabled: false };

  const manual = targetReviewAutoPlaceGate(defaultSettings, enabledBtn);
  assert.equal(manual.path, 'manual_stop', 'TGT-4: default settings stop at review');
  assert.equal(manual.clicks.length, 0, 'TGT-4: default must not click Place Order');
  assert.ok(manual.toast?.includes('manual'), 'TGT-4: manual toast on default');

  const autoOn = targetReviewAutoPlaceGate({ autoPlaceOrder: true }, enabledBtn);
  assert.equal(autoOn.path, 'auto_click', 'TGT-4: autoPlaceOrder ON clicks when button enabled');
  assert.deepEqual(autoOn.clicks, ['place_order']);

  const autoBlocked = targetReviewAutoPlaceGate({ autoPlaceOrder: true }, { disabled: true });
  assert.equal(autoBlocked.path, 'auto_blocked', 'TGT-4: disabled button blocks auto click');
  assert.equal(autoBlocked.clicks.length, 0);

  const wmManual = walmartReviewAutoPlaceGate(defaultSettings, enabledBtn, true);
  assert.equal(wmManual.path, 'manual_stop', 'TGT-4: Walmart default stops at review');
  assert.equal(wmManual.clicks.length, 0);

  const wmAuto = walmartReviewAutoPlaceGate({ autoPlaceOrder: true }, enabledBtn, true);
  assert.equal(wmAuto.path, 'auto_click', 'TGT-4: Walmart autoPlaceOrder ON clicks');
  assert.deepEqual(wmAuto.clicks, ['place_order']);

  const wmHidden = walmartReviewAutoPlaceGate({ autoPlaceOrder: true }, enabledBtn, false);
  assert.equal(wmHidden.path, 'auto_not_found', 'TGT-4: Walmart hidden button does not click');

  console.log('review-dedup-simulation PASS (TGT-4): autoPlaceOrder gate matches Target + Walmart');
}

async function mainAll() {
  await main();
  runTgt4Tests();
}

mainAll().catch((e) => {
  console.error('review-dedup-simulation FAIL:', e);
  process.exit(1);
});
