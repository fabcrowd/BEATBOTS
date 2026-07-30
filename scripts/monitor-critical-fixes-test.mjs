#!/usr/bin/env node
/**
 * Regression tests for critical monitor/harvest fixes (no Chrome required).
 *
 * Run: node scripts/monitor-critical-fixes-test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bgSource = fs.readFileSync(
  path.join(__dirname, '../target-checkout-helper/background.js'),
  'utf8'
);
const harvestSource = fs.readFileSync(
  path.join(__dirname, '../target-checkout-helper/cookieHarvest.js'),
  'utf8'
);
const contentSource = fs.readFileSync(
  path.join(__dirname, '../target-checkout-helper/content.js'),
  'utf8'
);

function section(title) {
  console.log(`\n── ${title} ──`);
}

section('Endless restart preserves walmartMaxPrice + errorRetryDelayMs');
{
  assert.match(bgSource, /function startMonitorOptsFromStored\(monitor\)/);
  assert.match(bgSource, /walmartMaxPrice: Number\(monitor\.walmartMaxPrice\)/);
  assert.match(bgSource, /errorRetryDelayMs: Number\(monitor\.errorRetryDelayMs\)/);
  assert.match(bgSource, /\.\.\.startMonitorOptsFromStored\(monitor\)/);
}

section('Multi-product poll skips in-checkout tab without stalling siblings');
{
  const block = bgSource.match(
    /if \(isInCheckoutFlow\(currentTab\?\.url\)\) \{[\s\S]*?\n\s*\}/
  );
  assert.ok(block, 'checkout-flow guard present');
  assert.match(block[0], /continue;/);
  assert.doesNotMatch(block[0], /\bbreak;/);
}

section('Hype mode aborts when harvest status is unreachable');
{
  assert.match(
    contentSource,
    /if \(product\.hypeMode\)[\s\S]*?catch \{[\s\S]*?return;[\s\S]*?\}/
  );
  assert.doesNotMatch(
    contentSource.match(/if \(product\.hypeMode\)[\s\S]*?catch \{[\s\S]*?\}/)[0],
    /no-op if SW is inactive/
  );
}

section('Harvest apply shares _harvestLock with capture');
{
  const fn = harvestSource.match(/async function tchApplyNextSnapshot\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'tchApplyNextSnapshot found');
  assert.match(fn[0], /_harvestLock/);
  assert.match(fn[0], /await prior;/);
  assert.match(fn[0], /releaseLock\(\)/);
}

section('Harvest lock serializes concurrent read-modify-write');
{
  let lock = Promise.resolve();
  let entries = [{ id: 1 }, { id: 2 }];

  async function withLock(mutator) {
    const prior = lock;
    let release;
    lock = new Promise((resolve) => { release = resolve; });
    await prior;
    try {
      return await mutator(entries);
    } finally {
      release();
    }
  }

  const apply = withLock(async (list) => {
    await new Promise((r) => setTimeout(r, 5));
    const removed = list.shift();
    entries = [...list];
    return removed;
  });

  const capture = withLock(async (list) => {
    list.push({ id: 3 });
    entries = [...list];
    return list.length;
  });

  const [removed, finalLen] = await Promise.all([apply, capture]);
  assert.equal(removed.id, 1);
  assert.equal(finalLen, 2);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.id), [2, 3]);
}

console.log('\nAll monitor-critical-fixes assertions passed.');
