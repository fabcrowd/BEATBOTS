#!/usr/bin/env node
/**
 * Anti-detection helpers — poll jitter stats + Walmart ATC backoff bounds.
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

// ── dropPollingTiming jitter ───────────────────────────────────────────────────

const timingPath = path.join(__dirname, '../target-checkout-helper/dropPollingTiming.js');
const timingCode = fs.readFileSync(timingPath, 'utf8');
const timingSandbox = { console, Date: { now: () => 0, parse: Date.parse.bind(Date) } };
vm.createContext(timingSandbox);
vm.runInContext(timingCode, timingSandbox);

assert(typeof timingSandbox.jitterBackgroundPollSleepMs === 'function', 'jitterBackgroundPollSleepMs exported');

{
  const samples = [];
  for (let i = 0; i < 200; i++) {
    samples.push(timingSandbox.jitterBackgroundPollSleepMs(250));
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, v) => a + (v - mean) ** 2, 0) / samples.length;
  const stdev = Math.sqrt(variance);
  assert(mean >= 200 && mean <= 300, `jitter mean ~250ms (got ${mean.toFixed(1)})`);
  assert(stdev > 25, `jitter stdev > 25ms (got ${stdev.toFixed(1)})`);
  assert(samples.every((v) => v >= 50 && v <= 400), 'jitter samples in sane bounds');
  console.log(`Poll jitter: mean=${mean.toFixed(1)}ms stdev=${stdev.toFixed(1)}ms (n=200)`);
}

assert(timingSandbox.jitterBackgroundPollSleepMs(500) === 500, 'no jitter above 250ms base');
assert(timingSandbox.jitterBackgroundPollSleepMs(2000) === 2000, 'no jitter on far poll');

// ── Walmart wmDirectAtcRetryDelayMs (inline mirror) ───────────────────────────

function wmDirectAtcRetryDelayMs(attempt) {
  const base = 150 + Math.floor(Math.random() * 101);
  const backoff = Math.min((attempt || 1) * 10, 200);
  return Math.min(500, base + backoff);
}

{
  const delays = [];
  let prev = 0;
  let identicalRuns = 0;
  for (let attempt = 1; attempt <= 50; attempt++) {
    const d = wmDirectAtcRetryDelayMs(attempt);
    delays.push(d);
    if (d === prev) identicalRuns++;
    prev = d;
    assert(d >= 150 && d <= 500, `delay in [150,500] attempt ${attempt}: ${d}`);
  }
  assert(identicalRuns < 10, 'too many identical consecutive delays');
  const min = Math.min(...delays);
  const max = Math.max(...delays);
  console.log(`Walmart ATC backoff: min=${min}ms max=${max}ms over 50 attempts`);
}

// ── manifest permissions ─────────────────────────────────────────────────────

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../target-checkout-helper/manifest.json'), 'utf8')
);
assert(manifest.permissions.includes('cookies'), 'manifest has cookies permission');
assert(manifest.permissions.includes('browsingData'), 'manifest has browsingData permission');

if (process.exitCode) {
  console.error('anti-detection-test: FAILED');
  process.exit(1);
}
console.log('All anti-detection tests passed.');
