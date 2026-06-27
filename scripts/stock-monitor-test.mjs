#!/usr/bin/env node
/**
 * Stock monitor unit tests (no live Target.com).
 * - RedSky URL builder + fulfillment parser
 * - Stock flip telemetry
 * - Monitor window / aggressive poll helpers
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  }
}

function loadScript(relPath, sandboxExtra = {}) {
  const code = fs.readFileSync(path.join(root, relPath), 'utf8');
  const sandbox = { console, Date, URLSearchParams, ...sandboxExtra };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

function section(title) {
  console.log('\n──', title, '──');
}

section('buildRedskyFulfillmentUrl');
{
  const { buildRedskyFulfillmentUrl } = loadScript('target-checkout-helper/core/redskyFulfillment.js');
  const url = buildRedskyFulfillmentUrl('94300072', { apiKey: 'test-key', zip: '90210' });
  assert(url && url.includes('tcin=94300072'), 'tcin in url');
  assert(url.includes('zip=90210'), 'zip in url');
  assert(url.includes('key=test-key'), 'api key in url');

  const noZip = buildRedskyFulfillmentUrl('94300072', { apiKey: 'k' });
  assert(noZip && !noZip.includes('zip='), 'no zip when omitted');

  const withStore = buildRedskyFulfillmentUrl('1', { apiKey: 'k', storeId: '1234' });
  assert(withStore.includes('store_id=1234'), 'store_id');
  assert(withStore.includes('pricing_store_id=1234'), 'pricing_store_id');
}

section('parseFulfillmentBlock fixture');
{
  const { parseFulfillmentBlock } = loadScript('target-checkout-helper/core/redskyFulfillment.js');
  const inStock = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/redsky-fulfillment-instock.json'), 'utf8'));
  const oos = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/redsky-fulfillment-oos.json'), 'utf8'));

  const a = parseFulfillmentBlock(inStock.data.product.fulfillment);
  assert(a.stock === true && a.qty === 12, 'IN_STOCK fixture');

  const b = parseFulfillmentBlock(oos.data.product.fulfillment);
  assert(b.stock === false, 'OOS fixture');
}

section('detectStockFlip + debounce');
{
  const { detectStockFlip, shouldRecordStockFlip, applyStockFlipRecord } = loadScript(
    'target-checkout-helper/core/stockFlipTelemetry.js'
  );

  const flip = detectStockFlip({ stock: false }, { stock: true, qty: 5 }, '2026-06-25T12:00:00.000Z');
  assert(flip && flip.to === 'IN_STOCK' && flip.qty === 5, 'OOS→in-stock flip');

  assert(detectStockFlip({ stock: true }, { stock: true }) === null, 'no flip when already in');
  assert(detectStockFlip(null, { stock: true }) !== null, 'first sighting counts as flip');

  const now = Date.parse('2026-06-25T12:00:30.000Z');
  const recent = { at: '2026-06-25T12:00:10.000Z' };
  assert(shouldRecordStockFlip(recent, flip, now, 30000) === false, 'debounce within 30s');
  assert(shouldRecordStockFlip(recent, flip, now + 25000, 30000) === true, 'debounce after 30s');

  let flips = {};
  for (let i = 0; i < 25; i++) {
    flips = applyStockFlipRecord(flips, String(i), { at: new Date(i * 1000).toISOString(), to: 'IN_STOCK' });
  }
  assert(Object.keys(flips).length === 20, 'cap at 20 TCINs');
}

section('isInMonitorWindow / isAggressivePoll');
{
  const DROP_MS = Date.UTC(2026, 5, 25, 14, 0, 0);
  const startIso = new Date(DROP_MS - 2 * 60 * 60 * 1000).toISOString();
  const endIso = new Date(DROP_MS + 2 * 60 * 60 * 1000).toISOString();
  const frozen = DROP_MS;
  const code = fs.readFileSync(path.join(root, 'target-checkout-helper/dropPollingTiming.js'), 'utf8');
  const sandbox = {
    console,
    Date: { now: () => frozen, parse: Date.parse.bind(Date) },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const mon = { monitorWindowStart: startIso, monitorWindowEnd: endIso, active: true };
  assert(sandbox.isInMonitorWindow(mon) === true, 'inside monitor window');
  assert(sandbox.isAggressivePoll(mon) === true, 'aggressive inside window');
  assert(sandbox.computeBackgroundPollSleepMs(mon) === 250, '250ms inside window');

  const aggressive = { aggressiveWhileMonitorOn: true, active: true };
  assert(sandbox.isAggressivePoll(aggressive) === true, 'aggressive while on without drop time');
  assert(sandbox.computeBackgroundPollSleepMs(aggressive) === 250, '250ms aggressive while on');

  const outside = {
    monitorWindowStart: startIso,
    monitorWindowEnd: endIso,
    active: true,
  };
  const outsideSandbox = {
    console,
    Date: { now: () => DROP_MS + 3 * 60 * 60 * 1000, parse: Date.parse.bind(Date) },
  };
  vm.createContext(outsideSandbox);
  vm.runInContext(code, outsideSandbox);
  assert(outsideSandbox.isInMonitorWindow(outside) === false, 'outside monitor window');
  assert(outsideSandbox.computeBackgroundPollSleepMs({}) === 500, '500ms default outside');
}

section('parseBatchFulfillmentMap + batch fallback');
{
  const { parseBatchFulfillmentMap } = loadScript('target-checkout-helper/core/redskyFulfillment.js');
  const { tcinsNeedingSingleFallback } = loadScript('target-checkout-helper/core/stockNavigateGate.js');
  const batch = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/redsky-batch-summary.json'), 'utf8'));
  const map = parseBatchFulfillmentMap(batch);
  assert(map['94300072']?.stock === true, 'batch TCIN in stock');
  assert(map['88888888']?.stock === false, 'batch TCIN oos');
  const missing = tcinsNeedingSingleFallback(['94300072', '99999999'], map);
  assert(missing.length === 1 && missing[0] === '99999999', 'missing TCIN needs single fallback');
}

section('buildPlpSearchUrl + parsePlpSearchTcins');
{
  const { buildPlpSearchUrl, parsePlpSearchTcins } = loadScript('target-checkout-helper/core/redskyFulfillment.js');
  const url = buildPlpSearchUrl('pokemon cards', { apiKey: 'k', zip: '10001' });
  assert(url && url.includes('plp_search_v2'), 'plp endpoint');
  assert(url.includes('keyword=pokemon'), 'keyword param');
  assert(url.includes('zip=10001'), 'zip on search');

  const plp = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/redsky-plp-search-sample.json'), 'utf8'));
  const tcins = parsePlpSearchTcins(plp, 8);
  assert(tcins.length === 2 && tcins[0] === '94300072', 'valid TCINs only');
}

section('stock navigate gate N-of-M');
{
  const {
    pushStockPollSample,
    stockConfirmedForNavigate,
    isAtpStatusFlicker,
  } = loadScript('target-checkout-helper/core/stockNavigateGate.js');

  let buf = [];
  buf = pushStockPollSample(buf, { stock: true, qty: 0 });
  assert(!stockConfirmedForNavigate(buf, { required: 2, window: 3 }), '1 sample not enough');
  buf = pushStockPollSample(buf, { stock: true, qty: 12 });
  assert(stockConfirmedForNavigate(buf, { required: 2, window: 3 }), '2-of-3 confirmed');

  const flicker = [
    { stock: true, qty: 0 },
    { stock: true, qty: 0 },
    { stock: true, qty: 0 },
  ];
  assert(isAtpStatusFlicker(flicker, { window: 3 }), 'ATP/status flicker detected');
  assert(!isAtpStatusFlicker([{ stock: true, qty: 5 }], { window: 3 }), 'qty>0 not flicker');
}

if (process.exitCode === 1) {
  console.error('\nSome stock-monitor assertions failed.');
  process.exit(1);
}
console.log('\nAll stock-monitor tests passed.');
