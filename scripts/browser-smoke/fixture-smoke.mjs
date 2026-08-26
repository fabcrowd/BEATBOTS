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
  targetCheckoutSignin: {
    fixtureId: 'target-checkout-signin',
    journeys: ['TGT-4'],
    markers: ['data-tch-fixture="target-checkout-signin"', 'data-test="authModal"'],
  },
  targetCheckoutSigninCross: {
    fixtureId: 'target-checkout-signin-cross',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-checkout-signin-cross"',
      'data-tch-path="/checkout/signin-gate-cross"',
      'data-test="authModal"',
      'monitor keys product',
    ],
  },
  targetProductSigninCrossMonitor: {
    fixtureId: 'target-product-signin-cross-monitor',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-product-signin-cross-monitor"',
      'data-tch-path="/p/mock-signin-cross-monitor/A-880097"',
      'data-test="shipItButton"',
      'href="/checkout/signin-gate-cross"',
    ],
  },
  targetProductSigninCrossRecovery: {
    fixtureId: 'target-product-signin-cross-recovery',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-product-signin-cross-recovery"',
      'data-tch-path="/p/mock-signin-cross-recovery/A-880098"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
  },
  targetProductSigninRecovery: {
    fixtureId: 'target-product-signin-recovery',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-product-signin-recovery"',
      'data-tch-path="/p/mock-signin-recovery/A-880099"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
  },
  targetCheckoutSpaTimeout: {
    fixtureId: 'target-checkout-spa-timeout',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-checkout-spa-timeout"',
      'data-tch-checkout-timeout-ms="750"',
      'data-tch-path="/checkout/spa-stall"',
    ],
  },
  targetCheckoutSpaCross: {
    fixtureId: 'target-checkout-spa-cross',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-checkout-spa-cross"',
      'data-tch-path="/checkout/spa-stall-cross"',
      'data-tch-checkout-timeout-ms="750"',
      'monitor keys product',
    ],
  },
  targetProductCheckoutSpaCrossMonitor: {
    fixtureId: 'target-product-checkout-spa-cross-monitor',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-product-checkout-spa-cross-monitor"',
      'data-tch-path="/p/mock-checkout-spa-cross-monitor/A-880092"',
      'data-test="shipItButton"',
      'href="/checkout/spa-stall-cross"',
    ],
  },
  targetProductCheckoutSpaCrossRecovery: {
    fixtureId: 'target-product-checkout-spa-cross-recovery',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-product-checkout-spa-cross-recovery"',
      'data-tch-path="/p/mock-checkout-spa-cross-recovery/A-880093"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
  },
  targetCartNoCheckout: {
    fixtureId: 'target-cart-no-checkout',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-cart-no-checkout"',
      'data-tch-cart-checkout-wait-ms="750"',
      'data-tch-path="/cart/no-checkout"',
    ],
  },
  targetCartNoCheckoutCross: {
    fixtureId: 'target-cart-no-checkout-cross',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-cart-no-checkout-cross"',
      'data-tch-path="/cart/no-checkout-cross"',
      'data-tch-cart-checkout-wait-ms="750"',
      'monitor keys product',
    ],
  },
  targetProductCartCrossMonitor: {
    fixtureId: 'target-product-cart-cross-monitor',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-product-cart-cross-monitor"',
      'data-tch-path="/p/mock-cart-cross-monitor/A-880088"',
      'data-test="shipItButton"',
      'href="/cart/no-checkout-cross"',
    ],
  },
  targetProductCartCrossRecovery: {
    fixtureId: 'target-product-cart-cross-recovery',
    journeys: ['TGT-4'],
    markers: [
      'data-tch-fixture="target-product-cart-cross-recovery"',
      'data-tch-path="/p/mock-cart-cross-recovery/A-880089"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
  },
  targetProductNoAtc: {
    fixtureId: 'target-product-no-atc',
    journeys: ['TGT-1'],
    markers: [
      'data-tch-fixture="target-product-no-atc"',
      'data-tch-atc-wait-ms="750"',
      'data-tch-path="/p/-/A-66666666"',
    ],
  },
  targetProductMissingAtcCrossMonitor: {
    fixtureId: 'target-product-missing-atc-cross-monitor',
    journeys: ['TGT-1'],
    markers: [
      'data-tch-fixture="target-product-missing-atc-cross-monitor"',
      'data-tch-path="/p/mock-missing-atc-cross-monitor/A-880094"',
      'data-test="shipItButton"',
    ],
  },
  targetProductMissingAtcCross: {
    fixtureId: 'target-product-missing-atc-cross',
    journeys: ['TGT-1'],
    markers: [
      'data-tch-fixture="target-product-missing-atc-cross"',
      'data-tch-path="/p/mock-missing-atc-cross/A-880095"',
      'data-tch-atc-wait-ms="750"',
      'monitor keys product',
    ],
  },
  targetProductMissingAtcCrossRecovery: {
    fixtureId: 'target-product-missing-atc-cross-recovery',
    journeys: ['TGT-1'],
    markers: [
      'data-tch-fixture="target-product-missing-atc-cross-recovery"',
      'data-tch-path="/p/mock-missing-atc-cross-recovery/A-880096"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
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
  walmartProductQueueTimeout: {
    fixtureId: 'walmart-product-queue-timeout',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-product-queue-timeout"',
      'data-tch-queue-timeout-ms="750"',
      'estimated wait time',
      'data-automation-id="queue-hold-spot-btn"',
    ],
  },
  walmartProductQueuePretimeout: {
    fixtureId: 'walmart-product-queue-pretimeout',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-product-queue-pretimeout"',
      'data-tch-queue-timeout-ms="5000"',
      'data-tch-path="/ip/mock-product-queue-pretimeout/460"',
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
  samsclubProductFcfsDisabled: {
    fixtureId: 'samsclub-product-fcfs-disabled',
    journeys: ['SC-3'],
    markers: [
      'data-tch-fixture="samsclub-product-fcfs-disabled"',
      'data-tch-atc-wait-ms="750"',
      'data-automation-id="add-to-cart-btn"',
      'disabled',
    ],
  },
  samsclubProductFcfsRestock: {
    fixtureId: 'samsclub-product-fcfs-restock',
    journeys: ['SC-6'],
    markers: [
      'data-tch-fixture="samsclub-product-fcfs-restock"',
      'data-tch-atc-wait-ms="750"',
      'data-automation-id="add-to-cart-btn"',
      'disabled',
    ],
  },
  samsclubProductFcfsInvisibleAtc: {
    fixtureId: 'samsclub-product-fcfs-invisible-atc',
    journeys: ['SC-6'],
    markers: [
      'data-tch-fixture="samsclub-product-fcfs-invisible-atc"',
      'data-tch-atc-wait-ms="750"',
      'data-automation-id="add-to-cart-btn"',
      'display:none',
    ],
  },
  samsclubCart: {
    fixtureId: 'samsclub-cart',
    journeys: ['SC-2'],
    markers: [
      'data-tch-fixture="samsclub-cart"',
      'data-tch-path="/cart"',
      'data-automation-id="checkout-btn"',
    ],
  },
  samsclubCartNoCheckout: {
    fixtureId: 'samsclub-cart-no-checkout',
    journeys: ['SC-2', 'SC-6'],
    markers: [
      'data-tch-fixture="samsclub-cart-no-checkout"',
      'data-tch-path="/cart/no-checkout"',
      'data-tch-cart-checkout-wait-ms="750"',
    ],
  },
  samsclubCartNoCheckoutCross: {
    fixtureId: 'samsclub-cart-no-checkout-cross',
    journeys: ['SC-6'],
    markers: [
      'data-tch-fixture="samsclub-cart-no-checkout-cross"',
      'data-tch-path="/cart/no-checkout-cross"',
      'data-tch-cart-checkout-wait-ms="750"',
      'monitor keys product',
    ],
  },
  samsclubProductCartCrossMonitor: {
    fixtureId: 'samsclub-product-cart-cross-monitor',
    journeys: ['SC-6'],
    markers: [
      'data-tch-fixture="samsclub-product-cart-cross-monitor"',
      'data-tch-path="/p/mock-fcfs-cart-cross-monitor/794"',
      'data-automation-id="add-to-cart-btn"',
      'href="/cart/no-checkout-cross"',
    ],
  },
  samsclubProductCartCrossRecovery: {
    fixtureId: 'samsclub-product-cart-cross-recovery',
    journeys: ['SC-6'],
    markers: [
      'data-tch-fixture="samsclub-product-cart-cross-recovery"',
      'data-tch-path="/p/mock-fcfs-cart-cross-recovery/795"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
  },
  samsclubProductCartMissing: {
    fixtureId: 'samsclub-product-cart-missing',
    journeys: ['SC-6'],
    markers: [
      'data-tch-fixture="samsclub-product-cart-missing"',
      'data-tch-path="/p/mock-fcfs-cart-missing/792"',
      'data-automation-id="add-to-cart-btn"',
      'href="/cart/no-checkout"',
    ],
  },
  samsclubCheckoutReview: {
    fixtureId: 'samsclub-checkout-review',
    journeys: ['SC-4', 'TGT-4'],
    markers: [
      'data-tch-fixture="samsclub-checkout-review"',
      'data-tch-path="/checkout"',
      'data-automation-id="place-order-btn"',
    ],
  },
  samsclubCheckoutSpa: {
    fixtureId: 'samsclub-checkout-spa',
    journeys: ['SC-4'],
    markers: [
      'data-tch-fixture="samsclub-checkout-spa"',
      'data-tch-path="/checkout/spa"',
      'name="firstName"',
      'name="cardNumber"',
      'data-automation-id="place-order-btn"',
    ],
  },
  samsclubCheckoutSpaTimeout: {
    fixtureId: 'samsclub-checkout-spa-timeout',
    journeys: ['SC-4', 'SC-6'],
    markers: [
      'data-tch-fixture="samsclub-checkout-spa-timeout"',
      'data-tch-path="/checkout/spa-stall"',
      'data-tch-checkout-timeout-ms="750"',
    ],
  },
  samsclubCheckoutSpaCross: {
    fixtureId: 'samsclub-checkout-spa-cross',
    journeys: ['SC-4', 'SC-6'],
    markers: [
      'data-tch-fixture="samsclub-checkout-spa-cross"',
      'data-tch-path="/checkout/spa-stall-cross"',
      'data-tch-checkout-timeout-ms="750"',
      'monitor keys product',
    ],
  },
  samsclubProductCheckoutSpaCrossMonitor: {
    fixtureId: 'samsclub-product-checkout-spa-cross-monitor',
    journeys: ['SC-6'],
    markers: [
      'data-tch-fixture="samsclub-product-checkout-spa-cross-monitor"',
      'data-tch-path="/p/mock-checkout-spa-cross-monitor/796"',
      'data-automation-id="add-to-cart-btn"',
      'href="/checkout/spa-stall-cross"',
    ],
  },
  samsclubProductCheckoutSpaCrossRecovery: {
    fixtureId: 'samsclub-product-checkout-spa-cross-recovery',
    journeys: ['SC-6'],
    markers: [
      'data-tch-fixture="samsclub-product-checkout-spa-cross-recovery"',
      'data-tch-path="/p/mock-checkout-spa-cross-recovery/797"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
  },
  walmartCartNoCheckout: {
    fixtureId: 'walmart-cart-no-checkout',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-cart-no-checkout"',
      'data-tch-path="/cart/no-checkout"',
      'data-tch-cart-checkout-wait-ms="750"',
    ],
  },
  walmartCartNoCheckoutCross: {
    fixtureId: 'walmart-cart-no-checkout-cross',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-cart-no-checkout-cross"',
      'data-tch-path="/cart/no-checkout-cross"',
      'data-tch-cart-checkout-wait-ms="750"',
      'monitor keys product',
    ],
  },
  walmartProductCartCrossMonitor: {
    fixtureId: 'walmart-product-cart-cross-monitor',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-product-cart-cross-monitor"',
      'data-tch-path="/ip/mock-cart-cross-monitor/890"',
      'data-automation-id="add-to-cart-btn"',
      'href="/cart/no-checkout-cross"',
    ],
  },
  walmartProductCartCrossRecovery: {
    fixtureId: 'walmart-product-cart-cross-recovery',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-product-cart-cross-recovery"',
      'data-tch-path="/ip/mock-cart-cross-recovery/891"',
      'data-tch-atc-wait-ms="750"',
    ],
  },
  walmartProductCartMissing: {
    fixtureId: 'walmart-product-cart-missing',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-product-cart-missing"',
      'data-automation-id="add-to-cart-btn"',
      'data-automation-id="go-to-cart-btn"',
    ],
  },
  walmartQpRoomTimeout: {
    fixtureId: 'walmart-qp-room-timeout',
    journeys: ['WM-4', 'WM-6'],
    markers: [
      'data-tch-fixture="walmart-qp-room-timeout"',
      'data-tch-queue-timeout-ms="750"',
      'estimated wait time',
    ],
  },
  walmartQpRoomMonitoredPretimeout: {
    fixtureId: 'walmart-qp-room-monitored-pretimeout',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-qp-room-monitored-pretimeout"',
      'data-tch-queue-timeout-ms="5000"',
      'data-tch-path="/qp/waiting-room-monitored-timeout"',
      'estimated wait time',
    ],
  },
  walmartCheckoutQueueTimeout: {
    fixtureId: 'walmart-checkout-queue-timeout',
    journeys: ['WM-4', 'WM-6'],
    markers: [
      'data-tch-fixture="walmart-checkout-queue-timeout"',
      'data-tch-queue-timeout-ms="750"',
      'estimated wait time',
    ],
  },
  walmartCheckoutMonitoredPretimeout: {
    fixtureId: 'walmart-checkout-monitored-pretimeout',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-checkout-monitored-pretimeout"',
      'data-tch-queue-timeout-ms="5000"',
      'data-tch-path="/checkout/monitored-timeout"',
      'estimated wait time',
    ],
  },
  walmartProductPriceGuardTimeout: {
    fixtureId: 'walmart-product-price-guard-timeout',
    journeys: ['WM-2', 'WM-6'],
    markers: [
      'data-tch-fixture="walmart-product-price-guard-timeout"',
      'data-tch-price-guard-timeout-ms="750"',
      'itemprop="price"',
    ],
  },
  walmartCheckoutSpaTimeout: {
    fixtureId: 'walmart-checkout-spa-timeout',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-checkout-spa-timeout"',
      'data-tch-checkout-timeout-ms="750"',
      'data-tch-path="/checkout/spa-stall"',
    ],
  },
  walmartCheckoutSpaSacred: {
    fixtureId: 'walmart-checkout-spa-sacred',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-checkout-spa-sacred"',
      'data-tch-checkout-timeout-ms="5000"',
      'data-tch-path="/checkout/spa-stall-sacred"',
    ],
  },
  walmartCheckoutSpaSacredCross: {
    fixtureId: 'walmart-checkout-spa-sacred-cross',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-checkout-spa-sacred-cross"',
      'data-tch-checkout-timeout-ms="5000"',
      'data-tch-path="/checkout/spa-stall-sacred-cross"',
      'sacred lock keys monitor product',
    ],
  },
  walmartProductNoAtc: {
    fixtureId: 'walmart-product-no-atc',
    journeys: ['WM-6'],
    markers: [
      'data-tch-fixture="walmart-product-no-atc"',
      'data-tch-atc-wait-ms="750"',
      'no ATC element',
    ],
  },
  walmartProductPollRecovery: {
    fixtureId: 'walmart-product-poll-recovery',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-product-poll-recovery"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
  },
  walmartProductQueuePollRecovery: {
    fixtureId: 'walmart-product-queue-poll-recovery',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-product-queue-poll-recovery"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
  },
  walmartProductQueuePollCross: {
    fixtureId: 'walmart-product-queue-poll-cross',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-product-queue-poll-cross"',
      'data-tch-path="/ip/mock-queue-poll/457"',
      'data-tch-queue-timeout-ms="5000"',
      'data-automation-id="queue-hold-spot-btn"',
      'sacred lock keys monitor product',
    ],
  },
  walmartProductQueuePollCrossRecovery: {
    fixtureId: 'walmart-product-queue-poll-cross-recovery',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-product-queue-poll-cross-recovery"',
      'data-tch-path="/ip/mock-queue-poll-recovery/461"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
    ],
  },
  walmartCheckoutPollRecovery: {
    fixtureId: 'walmart-checkout-poll-recovery',
    journeys: ['WM-5'],
    markers: [
      'data-tch-fixture="walmart-checkout-poll-recovery"',
      'data-tch-atc-wait-ms="750"',
      'poll recovery',
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
