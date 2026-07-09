#!/usr/bin/env node
/**
 * FIX-1: Offline HTML fixtures from test-scope.mjs MOCK_URLS — file existence + DOM markers.
 * DOM-only validation; retailer-hostname e2e is fixture-e2e.mjs (FIX-2).
 *
 * Run: node scripts/browser-smoke/fixture-smoke.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_URLS } from './test-scope.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Required DOM markers per MOCK_URLS key (mirrors extension selectors / simulation stubs).
 * @type {Record<string, { fixtureId: string, journeys: string[], markers: string[] }>}
 */
const FIXTURE_MARKERS = {
  targetProduct: {
    fixtureId: 'target-product',
    journeys: ['TGT-1'],
    markers: ['data-tch-fixture="target-product"', 'data-test="shipItButton"'],
  },
  targetCheckoutReview: {
    fixtureId: 'target-checkout-review',
    journeys: ['TGT-4'],
    markers: ['data-tch-fixture="target-checkout-review"', 'data-test="placeOrderButton"'],
  },
  walmartProductPreDrop: {
    fixtureId: 'walmart-product-predrop',
    journeys: ['WM-2'],
    markers: [
      'data-tch-fixture="walmart-product-predrop"',
      'data-automation-id="add-to-cart-btn"',
      'disabled',
    ],
  },
  walmartProductQueue: {
    fixtureId: 'walmart-product-queue',
    journeys: ['WM-2', 'WM-4'],
    markers: [
      'data-tch-fixture="walmart-product-queue"',
      'estimated wait time',
      'data-automation-id="queue-hold-spot-btn"',
    ],
  },
  walmartQpRoom: {
    fixtureId: 'walmart-qp-room',
    journeys: ['WM-3', 'WM-4'],
    markers: [
      'data-tch-fixture="walmart-qp-room"',
      'data-tch-path="/qp/waiting-room"',
      'estimated wait time',
    ],
  },
  walmartCheckoutQueue: {
    fixtureId: 'walmart-checkout-queue',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-checkout-queue"',
      'data-tch-path="/checkout"',
      'estimated wait time',
    ],
  },
  walmartProductPx: {
    fixtureId: 'walmart-product-px',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-product-px"',
      'hang tight',
      "we're loading your experience",
    ],
  },
  walmartProductPxCaptcha: {
    fixtureId: 'walmart-product-px-captcha',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-product-px-captcha"',
      'id="px-captcha"',
    ],
  },
  walmartProductPxBlock: {
    fixtureId: 'walmart-product-px-block',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-product-px-block"',
      'class="px-block-overlay"',
    ],
  },
  walmartProductPxOverride: {
    fixtureId: 'walmart-product-px-override',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-product-px-override"',
      'data-tch-px-timeout-ms="750"',
      'hang tight',
    ],
  },
  walmartProductOid: {
    fixtureId: 'walmart-product-oid',
    journeys: ['WM-7'],
    markers: [
      'data-tch-fixture="walmart-product-oid"',
      '__NEXT_DATA__',
      'FIXTURE-OID-WM7-777',
      'data-automation-id="add-to-cart-btn"',
    ],
  },
  samsclubProductFcfs: {
    fixtureId: 'samsclub-product-fcfs',
    journeys: ['SC-3', 'SC-5'],
    markers: [
      'data-tch-fixture="samsclub-product-fcfs"',
      'data-automation-id="add-to-cart-btn"',
    ],
  },
  samsclubProductFcfsRestock: {
    fixtureId: 'samsclub-product-fcfs-restock',
    journeys: ['SC-6'],
    markers: [
      'data-tch-fixture="samsclub-product-fcfs-restock"',
      'data-automation-id="add-to-cart-btn"',
      'disabled',
    ],
  },
};

function assertFixture(key, relPath) {
  const spec = FIXTURE_MARKERS[key];
  assert.ok(spec, `FIX-1: missing FIXTURE_MARKERS entry for ${key}`);

  const abs = join(__dirname, relPath);
  assert.ok(existsSync(abs), `FIX-1: fixture file missing: ${relPath}`);

  const html = readFileSync(abs, 'utf8').toLowerCase();
  for (const marker of spec.markers) {
    assert.ok(
      html.includes(marker.toLowerCase()),
      `FIX-1: ${relPath} missing marker: ${marker}`
    );
  }

  const fixtureAttr = `data-tch-fixture="${spec.fixtureId}"`;
  assert.ok(
    html.includes(fixtureAttr),
    `FIX-1: ${relPath} must declare ${fixtureAttr}`
  );
}

function main() {
  const mockKeys = Object.keys(MOCK_URLS);
  const markerKeys = Object.keys(FIXTURE_MARKERS);
  assert.deepEqual(
    mockKeys.sort(),
    markerKeys.sort(),
    'FIX-1: MOCK_URLS keys must match FIXTURE_MARKERS keys'
  );

  for (const [key, relPath] of Object.entries(MOCK_URLS)) {
    assertFixture(key, relPath);
  }

  const journeys = [...new Set(Object.values(FIXTURE_MARKERS).flatMap((s) => s.journeys))].sort();
  console.log(`fixture-smoke PASS (FIX-1): ${mockKeys.length} fixtures with DOM markers`);
  console.log(`  journeys: ${journeys.join(', ')}`);
}

main();
