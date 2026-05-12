#!/usr/bin/env node
/**
 * Checkout-related speed tests (no live Target.com).
 *
 * 1) Asserts drop-window polling intervals match extension logic (dropPollingTiming.js).
 * 2) Micro-benchmarks those hot paths (negligible CPU).
 *
 * End-to-end checkout timing (ATC → review) only exists in a real browser: see DevTools
 * console for [TCH] timing checkout_total_to_review and popup "Saved payment vs form fill".
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const timingPath = path.join(__dirname, '../target-checkout-helper/dropPollingTiming.js');
const code = fs.readFileSync(timingPath, 'utf8');

function loadHelpers(frozenNowMs) {
  const sandbox = {
    console,
    Date: {
      now: () => frozenNowMs,
      parse: Date.parse.bind(Date),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

function section(title) {
  console.log('\n──', title, '──');
}

// Reference instant: "drop" at this absolute time (UTC string parses the same in Node & browsers).
const DROP_MS = Date.UTC(2025, 2, 20, 19, 0, 0);
const dropIso = new Date(DROP_MS).toISOString();

section('Drop polling logic (mocked clock)');
{
  // 7 minutes before drop → aggressive window
  const now = DROP_MS - 7 * 60 * 1000;
  const { computeBackgroundPollSleepMs, getDropAwarePollSeconds } = loadHelpers(now);
  assert(computeBackgroundPollSleepMs({ dropExpectedAt: dropIso }) === 250, 'bg sleep 250 in pre-window');
  assert(getDropAwarePollSeconds({ dropExpectedAt: dropIso }, 2) === 1, 'content poll caps at 1s in pre-window');
}

{
  // 50 minutes before drop → relaxed background poll
  const now = DROP_MS - 50 * 60 * 1000;
  const { computeBackgroundPollSleepMs, getDropAwarePollSeconds } = loadHelpers(now);
  assert(computeBackgroundPollSleepMs({ dropExpectedAt: dropIso }) === 2000, 'bg sleep 2000 when >45m out');
  assert(getDropAwarePollSeconds({ dropExpectedAt: dropIso }, 1) === 3, 'content poll min 3s when >30m out');
}

{
  // 90 seconds after drop → grace window
  const now = DROP_MS + 90 * 1000;
  const { computeBackgroundPollSleepMs, getDropAwarePollSeconds } = loadHelpers(now);
  assert(computeBackgroundPollSleepMs({ dropExpectedAt: dropIso }) === 250, 'bg sleep 250 in grace window');
  assert(getDropAwarePollSeconds({ dropExpectedAt: dropIso }, 2) === 1, 'content poll capped in grace window');
}

{
  // 4 minutes after drop → outside grace → base background sleep
  const now = DROP_MS + 4 * 60 * 1000;
  const { computeBackgroundPollSleepMs } = loadHelpers(now);
  assert(computeBackgroundPollSleepMs({ dropExpectedAt: dropIso }) === 500, 'bg base after grace ends');
}

{
  const mon = { dropExpectedAt: dropIso };
  const { isInDropTensionWindow } = loadHelpers(DROP_MS - 7 * 60 * 1000);
  assert(isInDropTensionWindow(mon) === true, 'tension window true in pre-window');
}
{
  const mon = { dropExpectedAt: dropIso };
  const { isInDropTensionWindow } = loadHelpers(DROP_MS - 50 * 60 * 1000);
  assert(isInDropTensionWindow(mon) === false, 'tension window false when far before drop');
}
{
  const mon = { dropExpectedAt: dropIso };
  const { isInDropTensionWindow } = loadHelpers(DROP_MS + 90 * 1000);
  assert(isInDropTensionWindow(mon) === true, 'tension window true in grace');
}
{
  const mon = { dropExpectedAt: dropIso };
  const { isInDropTensionWindow } = loadHelpers(DROP_MS + 4 * 60 * 1000);
  assert(isInDropTensionWindow(mon) === false, 'tension window false after grace');
}

{
  const mon = { dropExpectedAt: dropIso };
  const now = DROP_MS - 7 * 60 * 1000;
  const { getHarvestKeepaliveMinIntervalMs, getHarvestBurstSameUrlDedupMs } = loadHelpers(now);
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 2 * 60 * 1000, 'harvest keepalive 2m in tension');
  assert(getHarvestBurstSameUrlDedupMs(mon) === 20 * 1000, 'harvest burst dedup 20s in tension');
}
{
  const mon = { dropExpectedAt: dropIso };
  const now = DROP_MS - 20 * 60 * 1000;
  const { getHarvestKeepaliveMinIntervalMs, getHarvestBurstSameUrlDedupMs } = loadHelpers(now);
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 3 * 60 * 1000, 'harvest keepalive 3m within 45m pre-drop');
  assert(getHarvestBurstSameUrlDedupMs(mon) === 45 * 1000, 'harvest burst dedup 45s within 45m pre-drop');
}
{
  const mon = { dropExpectedAt: dropIso };
  const now = DROP_MS - 50 * 60 * 1000;
  const { getHarvestKeepaliveMinIntervalMs, getHarvestBurstSameUrlDedupMs } = loadHelpers(now);
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 5 * 60 * 1000, 'harvest keepalive 5m far from drop');
  assert(getHarvestBurstSameUrlDedupMs(mon) === 120 * 1000, 'harvest burst dedup 120s far from drop');
}
{
  const mon = {};
  const { getHarvestKeepaliveMinIntervalMs } = loadHelpers(DROP_MS);
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 5 * 60 * 1000, 'harvest keepalive default without drop');
}

{
  const mon = { dropExpectedAt: dropIso };
  const now = DROP_MS + 4 * 60 * 1000;
  const { getHarvestKeepaliveMinIntervalMs } = loadHelpers(now);
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 15 * 60 * 1000, 'harvest keepalive 15m after post-drop grace');
}

{
  const now = DROP_MS - 20 * 60 * 1000; // 20m before: between 10m and 45m rules
  const { computeBackgroundPollSleepMs, getDropAwarePollSeconds } = loadHelpers(now);
  assert(computeBackgroundPollSleepMs({ dropExpectedAt: dropIso }) === 500, 'bg base 500 in mid window');
  assert(getDropAwarePollSeconds({ dropExpectedAt: dropIso }, 1) === 1, 'content keeps user interval in mid window');
}

{
  const { computeBackgroundPollSleepMs, getDropAwarePollSeconds } = loadHelpers(DROP_MS);
  assert(computeBackgroundPollSleepMs({}) === 500, 'bg default without drop time');
  assert(getDropAwarePollSeconds({}, 1) === 1, 'content default interval');
  assert(computeBackgroundPollSleepMs({ dropExpectedAt: 'not-a-date' }) === 500, 'bg invalid drop string');
}

// ── Boundary edges ─────────────────────────────────────────────────────────────

section('Boundary edge cases');

{
  // Exactly at 10m pre-drop boundary — inclusive upper bound, must be in-window.
  const now = DROP_MS - 10 * 60 * 1000;
  const { computeBackgroundPollSleepMs, getDropAwarePollSeconds, isInDropTensionWindow,
          getHarvestKeepaliveMinIntervalMs, getHarvestBurstSameUrlDedupMs } = loadHelpers(now);
  const mon = { dropExpectedAt: dropIso };
  assert(computeBackgroundPollSleepMs(mon) === 250, '10m boundary: bg sleep 250ms');
  assert(getDropAwarePollSeconds(mon, 2) === 1, '10m boundary: content poll capped at 1s');
  assert(isInDropTensionWindow(mon) === true, '10m boundary: tension window true');
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 2 * 60 * 1000, '10m boundary: keepalive 2m');
  assert(getHarvestBurstSameUrlDedupMs(mon) === 20 * 1000, '10m boundary: burst dedup 20s');
}

{
  // Exactly at 45m pre-drop — strictly >45m returns 2000; at 45m returns base 500.
  const now = DROP_MS - 45 * 60 * 1000;
  const { computeBackgroundPollSleepMs, getHarvestKeepaliveMinIntervalMs } = loadHelpers(now);
  const mon = { dropExpectedAt: dropIso };
  assert(computeBackgroundPollSleepMs(mon) === 500, '45m boundary: bg base 500 (not >45m)');
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 3 * 60 * 1000, '45m boundary: keepalive 3m (within 45m)');
}

{
  // Exactly at 3m post-drop — inclusive upper bound, must still be in grace window.
  const now = DROP_MS + 3 * 60 * 1000;
  const { computeBackgroundPollSleepMs, getDropAwarePollSeconds, isInDropTensionWindow,
          getHarvestKeepaliveMinIntervalMs, getHarvestBurstSameUrlDedupMs } = loadHelpers(now);
  const mon = { dropExpectedAt: dropIso };
  assert(computeBackgroundPollSleepMs(mon) === 250, '3m post-drop: bg sleep 250ms (grace)');
  assert(getDropAwarePollSeconds(mon, 2) === 1, '3m post-drop: content poll capped (grace)');
  assert(isInDropTensionWindow(mon) === true, '3m post-drop: tension window true (grace)');
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 2 * 60 * 1000, '3m post-drop: keepalive 2m (grace)');
  assert(getHarvestBurstSameUrlDedupMs(mon) === 20 * 1000, '3m post-drop: burst dedup 20s (grace)');
}

{
  // 5m post-drop — past grace, should use relaxed defaults.
  const now = DROP_MS + 5 * 60 * 1000;
  const { computeBackgroundPollSleepMs, isInDropTensionWindow,
          getHarvestKeepaliveMinIntervalMs, getHarvestBurstSameUrlDedupMs } = loadHelpers(now);
  const mon = { dropExpectedAt: dropIso };
  assert(computeBackgroundPollSleepMs(mon) === 500, '5m post-drop: bg base after grace ends');
  assert(isInDropTensionWindow(mon) === false, '5m post-drop: tension window false after grace');
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 15 * 60 * 1000, '5m post-drop: keepalive 15m');
  assert(getHarvestBurstSameUrlDedupMs(mon) === 120 * 1000, '5m post-drop: burst dedup 120s');
}

{
  // Exactly 30m pre-drop — between 10m and 45m windows.
  const now = DROP_MS - 30 * 60 * 1000;
  const { computeBackgroundPollSleepMs, getDropAwarePollSeconds,
          getHarvestKeepaliveMinIntervalMs } = loadHelpers(now);
  const mon = { dropExpectedAt: dropIso };
  assert(computeBackgroundPollSleepMs(mon) === 500, '30m boundary: bg base 500 (mid window)');
  assert(getDropAwarePollSeconds(mon, 1) === 1, '30m boundary: content keeps user interval');
  assert(getHarvestKeepaliveMinIntervalMs(mon) === 3 * 60 * 1000, '30m boundary: keepalive 3m');
}

{
  // Malformed / null monitor — must not throw, must return base defaults.
  const { computeBackgroundPollSleepMs, getDropAwarePollSeconds } = loadHelpers(DROP_MS);
  assert(computeBackgroundPollSleepMs(null) === 500, 'null monitor: bg base 500');
  assert(computeBackgroundPollSleepMs(undefined) === 500, 'undefined monitor: bg base 500');
  assert(getDropAwarePollSeconds(null, 1) === 1, 'null monitor: content base interval');
  assert(computeBackgroundPollSleepMs({ dropExpectedAt: null }) === 500, 'null drop time: bg base');
  assert(computeBackgroundPollSleepMs({ dropExpectedAt: 12345 }) === 500, 'numeric drop time: bg base');
}

{
  // Negative baseSec in getDropAwarePollSeconds — must clamp to 0.25.
  const { getDropAwarePollSeconds } = loadHelpers(DROP_MS);
  assert(getDropAwarePollSeconds({}, -5) === 0.25, 'negative baseSec clamped to 0.25');
  assert(getDropAwarePollSeconds({}, 0) === 1, 'zero baseSec falls back to default 1 (0 is falsy in || 1)');
}

section('Effective poll rates (reference)');
console.log('Background loop (approx checks/min if each cycle is one fetch):');
console.log('  250ms sleep → ~240 cycles/min (aggressive window)');
console.log('  500ms sleep → ~120 cycles/min (default)');
console.log('  2000ms sleep → ~30 cycles/min (far before drop)');
console.log('Content passive monitor uses getDropAwarePollSeconds × 1000 ms between polls.');

section('Micro-benchmark (local CPU only)');
{
  const sandbox = { console, Date };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const n = 300_000;
  const mon = { dropExpectedAt: dropIso };
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    sandbox.computeBackgroundPollSleepMs(mon);
    sandbox.getDropAwarePollSeconds(mon, 1);
  }
  const elapsed = performance.now() - t0;
  console.log(`${n} paired calls in ${elapsed.toFixed(1)}ms (${((n * 2) / (elapsed / 1000)).toFixed(0)} ops/s)`);
}

section('End-to-end checkout latency');
console.log('Not measured here (requires Chrome + target.com + your account).');
console.log('When you reach review, the extension logs: [TCH] timing checkout_total_to_review: …ms');
console.log('and stores runs in chrome.storage under checkoutSpeeds for the popup comparison.');

if (process.exitCode === 1) {
  console.error('\nSome assertions failed.');
  process.exit(1);
}
console.log('\nAll drop-polling assertions passed.');

