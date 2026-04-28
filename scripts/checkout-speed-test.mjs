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
