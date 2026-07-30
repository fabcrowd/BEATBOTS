/**
 * Journey IDs, invariants, and test-file mapping for BEATBOTS / Target Checkout Helper.
 *
 * Every file in `npm run test:extension` must trace to at least one journey step here.
 * Supplementary scripts (run.mjs, untested-areas-test.mjs, …) are listed under
 * `supplementaryTests` and are not required for overnight automation green.
 *
 * Run: node scripts/browser-smoke/test-scope.mjs  (prints coverage summary)
 */
import { fileURLToPath } from 'node:url';

/** @typedef {'target'|'walmart'|'samsclub'|'core'} RetailerScope */

/**
 * Checkout / monitor journey steps in priority order (lowest ID = strengthen first
 * when the suite is green).
 * @type {Record<string, { id: string, retailer: RetailerScope, summary: string, impl: string[], coverage: 'strong'|'weak'|'missing', tests: string[] }>}
 */
export const JOURNEYS = {
  'MON-1': {
    id: 'MON-1',
    retailer: 'core',
    summary: 'Background monitor start/stop and GET_MONITOR_STATUS',
    impl: ['target-checkout-helper/background.js', 'target-checkout-helper/popup.js'],
    coverage: 'strong',
    tests: ['extension-functional.mjs'],
  },
  'MON-2': {
    id: 'MON-2',
    retailer: 'core',
    summary: 'Only one retailer monitor active — START_MONITOR filters by retailer tab',
    impl: ['target-checkout-helper/popup.js (toggleMonitor retailerFilter)'],
    coverage: 'strong',
    tests: ['extension-functional.mjs'],
  },
  'MON-3': {
    id: 'MON-3',
    retailer: 'core',
    summary:
      'Background poll navigationLock + inQueueUrls skip re-navigation; isInCheckoutFlow guard; START_MONITOR restart clears inQueueUrls',
    impl: ['target-checkout-helper/background.js'],
    coverage: 'strong',
    tests: ['extension-functional.mjs'],
  },
  'TGT-1': {
    id: 'TGT-1',
    retailer: 'target',
    summary: 'Target content script initializes on target.com ([TCH] init)',
    impl: ['target-checkout-helper/content.js'],
    coverage: 'strong',
    tests: ['extension-e2e.mjs', 'extension-functional.mjs'],
  },
  'TGT-2': {
    id: 'TGT-2',
    retailer: 'target',
    summary: 'Popup shell: default title, toggle, forms tab',
    impl: ['target-checkout-helper/popup.html', 'target-checkout-helper/popup.js'],
    coverage: 'strong',
    tests: ['extension-e2e.mjs', 'extension-functional.mjs'],
  },
  'TGT-3': {
    id: 'TGT-3',
    retailer: 'target',
    summary: 'Review-step dedup: failed Place Order probe must not arm dedup window',
    impl: ['target-checkout-helper/content.js (handleReviewStep)'],
    coverage: 'strong',
    tests: ['review-dedup-simulation.mjs'],
  },
  'TGT-4': {
    id: 'TGT-4',
    retailer: 'target',
    summary: 'Default stop at review; Place Order only when autoPlaceOrder is enabled',
    impl: [
      'target-checkout-helper/content.js',
      'target-checkout-helper/popup.html (#autoPlaceOrder unchecked by default)',
    ],
    coverage: 'strong',
    tests: ['review-dedup-simulation.mjs'],
  },
  'WM-1': {
    id: 'WM-1',
    retailer: 'walmart',
    summary: 'Walmart content script product → cart → checkout flow',
    impl: ['target-checkout-helper/walmart-content.js'],
    coverage: 'strong',
    tests: ['walmart-flow-simulation.mjs'],
  },
  'WM-2': {
    id: 'WM-2',
    retailer: 'walmart',
    summary: 'Pre-drop disabled ATC alone is not queue — do not treat as sacred lock',
    impl: ['target-checkout-helper/walmart-content.js (wmIsProductQueued vs wmHasQueueIndicators)'],
    coverage: 'strong',
    tests: ['walmart-flow-simulation.mjs'],
  },
  'WM-3': {
    id: 'WM-3',
    retailer: 'walmart',
    summary: 'Queue-it MAIN-world WebSocket sniff → TCH_QUEUE_PASSED on documentElement',
    impl: ['target-checkout-helper/walmart-main-world.js'],
    coverage: 'strong',
    tests: ['walmart-flow-simulation.mjs'],
  },
  'WM-4': {
    id: 'WM-4',
    retailer: 'walmart',
    summary: 'Sacred lock (WALMART_IN_QUEUE → inQueueUrls) only after queue confirmed',
    impl: ['target-checkout-helper/walmart-content.js', 'target-checkout-helper/background.js'],
    coverage: 'strong',
    tests: ['walmart-flow-simulation.mjs'],
  },
  'WM-5': {
    id: 'WM-5',
    retailer: 'walmart',
    summary:
      'Sacred lock blocks background re-navigation; WALMART_NAV_FAILED clears navigationLock only, not inQueueUrls',
    impl: ['target-checkout-helper/background.js', 'target-checkout-helper/walmart-content.js'],
    coverage: 'strong',
    tests: ['walmart-flow-simulation.mjs'],
  },
  'WM-6': {
    id: 'WM-6',
    retailer: 'walmart',
    summary: 'Walmart queue error paths (PX timeout, NAV_FAILED while not in queue)',
    impl: ['target-checkout-helper/walmart-content.js'],
    coverage: 'missing',
    tests: [],
  },
  'WM-7': {
    id: 'WM-7',
    retailer: 'walmart',
    summary: 'Product-page __NEXT_DATA__ offerId → WM_OFFER_ID_READY updates monitor.products[].oid',
    impl: [
      'target-checkout-helper/walmart-content.js (_wmInit)',
      'target-checkout-helper/background.js (WM_OFFER_ID_READY handler)',
    ],
    coverage: 'missing',
    tests: [],
  },
  'SC-1': {
    id: 'SC-1',
    retailer: 'samsclub',
    summary: "Sam's Club retailer module registered in manifest with FCFS stub content script",
    impl: [
      'target-checkout-helper/manifest.json',
      'target-checkout-helper/core/hosts.js',
      'target-checkout-helper/samsclub-content.js',
    ],
    coverage: 'missing',
    tests: [],
  },
  'SC-3': {
    id: 'SC-3',
    retailer: 'samsclub',
    summary: "Sam's Club FCFS product-page ATC without queue semantics",
    impl: ['target-checkout-helper/samsclub-content.js (scHandleProductPage)'],
    coverage: 'missing',
    tests: [],
  },
  'SC-5': {
    id: 'SC-5',
    retailer: 'samsclub',
    summary: "Sam's Club FCFS race — no sacred lock / inQueueUrls",
    impl: ['target-checkout-helper/samsclub-content.js (scSignalAtcSuccess → ATC_SUCCESS)'],
    coverage: 'missing',
    tests: [],
  },
  'SC-6': {
    id: 'SC-6',
    retailer: 'samsclub',
    summary:
      "Sam's Club FCFS error-path hardening — NAV_FAILED releases poll lock, no sacred lock",
    impl: [
      'target-checkout-helper/samsclub-content.js (scSignalNavFailed)',
      'target-checkout-helper/background.js (NAV_FAILED handler)',
    ],
    coverage: 'missing',
    tests: [],
  },
};

/**
 * Behavioral invariants — must hold after every overnight change.
 * @type {Record<string, { id: string, rule: string, code: string[] }>}
 */
export const INVARIANTS = {
  'MON-2': {
    id: 'MON-2',
    rule:
      'Only one retailer monitor active per session; Target and Walmart start buttons share monitorActive and filter products by retailer.',
    code: ['target-checkout-helper/popup.js'],
  },
  'WM-2': {
    id: 'WM-2',
    rule:
      'Pre-drop disabled ATC without queue indicators is not queue; do not arm sacred lock for price-guard-only waits.',
    code: ['target-checkout-helper/walmart-content.js'],
  },
  'WM-4': {
    id: 'WM-4',
    rule: 'Sacred lock (inQueueUrls) is set only after queue entry is confirmed via WALMART_IN_QUEUE.',
    code: ['target-checkout-helper/walmart-content.js', 'target-checkout-helper/background.js'],
  },
  'WM-5': {
    id: 'WM-5',
    rule:
      'While inQueueUrls holds a product URL, background poll must not re-navigate; WALMART_NAV_FAILED releases navigationLock only.',
    code: ['target-checkout-helper/background.js'],
  },
  'SC-5': {
    id: 'SC-5',
    rule: "Sam's Club FCFS drops must not use Walmart-style sacred lock.",
    code: ['target-checkout-helper/samsclub-content.js'],
  },
  'TGT-4': {
    id: 'TGT-4',
    rule: 'Default stop at review; Place Order click only when autoPlaceOrder is explicitly enabled.',
    code: [
      'target-checkout-helper/content.js',
      'target-checkout-helper/walmart-content.js',
      'target-checkout-helper/popup.html',
    ],
  },
  'WM-3': {
    id: 'WM-3',
    rule:
      'Two-phase queue model: product-page queue vs /qp waiting room vs checkout queue — see WALMART-DROP-DEBUG-HANDOFF.md.',
    code: ['target-checkout-helper/walmart-content.js', 'target-checkout-helper/walmart-main-world.js'],
  },
  'SC-3': {
    id: 'SC-3',
    rule: "Sam's Club checkout must not inherit Walmart queue handlers.",
    code: ['target-checkout-helper/samsclub-content.js'],
  },
};

/** Authoritative `npm run test:extension` files → journey IDs they cover. */
export const EXTENSION_SUITE = {
  'extension-e2e.mjs': ['TGT-1', 'TGT-2'],
  'extension-functional.mjs': ['MON-1', 'MON-2', 'MON-3', 'TGT-1', 'TGT-2'],
  'review-dedup-simulation.mjs': ['TGT-3', 'TGT-4'],
  'walmart-flow-simulation.mjs': ['WM-1', 'WM-2', 'WM-3', 'WM-4'],
};

/** Offline / manual scripts — not run by test:extension. */
export const SUPPLEMENTARY_TESTS = {
  'run.mjs': ['TGT-1'],
  'untested-areas-test.mjs': ['TGT-1', 'WM-1'],
  'shape-cookie-test.mjs': [],
  'beatbots-10round-test.mjs': [],
  'checkout-rehearsal.mjs': [],
  'manual-account-test.mjs': [],
};

/**
 * Mock HTML fixtures for offline retailer e2e (future FIX-1 / FIX-2 journeys).
 * Paths are relative to scripts/browser-smoke/.
 */
export const MOCK_URLS = {
  targetProduct: 'fixtures/target-product.html',
  targetCheckoutReview: 'fixtures/target-checkout-review.html',
  walmartProductPreDrop: 'fixtures/walmart-product-predrop.html',
  walmartProductQueue: 'fixtures/walmart-product-queue.html',
  samsclubProductFcfs: 'fixtures/samsclub-product-fcfs.html',
};

/** Lowest journey ID with weak or missing coverage (automation priority #2). */
export function lowestWeakJourney() {
  const order = Object.keys(JOURNEYS);
  for (const id of order) {
    const j = JOURNEYS[id];
    if (j.coverage === 'weak' || j.coverage === 'missing') return j;
  }
  return null;
}

/** Validate every test:extension file maps to at least one journey. */
export function validateExtensionSuite() {
  const orphans = Object.keys(EXTENSION_SUITE).filter((file) => {
    const ids = EXTENSION_SUITE[file];
    return !ids.length || ids.every((id) => !JOURNEYS[id]);
  });
  if (orphans.length) {
    throw new Error(`Orphan test files in EXTENSION_SUITE: ${orphans.join(', ')}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateExtensionSuite();
  const weak = lowestWeakJourney();
  console.log('test-scope.mjs OK');
  console.log(`Journeys: ${Object.keys(JOURNEYS).length} | Invariants: ${Object.keys(INVARIANTS).length}`);
  console.log(`Extension suite: ${Object.keys(EXTENSION_SUITE).join(', ')}`);
  console.log(
    `Next strengthen: ${weak ? `${weak.id} (${weak.coverage}) — ${weak.summary}` : '(none)'}`
  );
}
