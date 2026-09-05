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
    tests: ['extension-functional.mjs', 'fixture-e2e.mjs'],
  },
  'MON-3': {
    id: 'MON-3',
    retailer: 'core',
    summary: 'Background poll navigationLock + inQueueUrls skip re-navigation; isInCheckoutFlow guard; START_MONITOR restart clears inQueueUrls',
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
    tests: ['extension-e2e.mjs', 'extension-functional.mjs', 'target-content-simulation.mjs'],
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
    impl: ['target-checkout-helper/content.js', 'target-checkout-helper/popup.html (#autoPlaceOrder unchecked by default)'],
    coverage: 'strong',
    tests: ['review-dedup-simulation.mjs', 'extension-e2e.mjs', 'target-content-simulation.mjs'],
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
    tests: ['walmart-main-world-simulation.mjs'],
  },
  'WM-4': {
    id: 'WM-4',
    retailer: 'walmart',
    summary: 'Sacred lock (WALMART_IN_QUEUE → inQueueUrls) only after queue confirmed',
    impl: ['target-checkout-helper/walmart-content.js', 'target-checkout-helper/background.js'],
    coverage: 'strong',
    tests: ['walmart-flow-simulation.mjs', 'extension-functional.mjs'],
  },
  'WM-5': {
    id: 'WM-5',
    retailer: 'walmart',
    summary: 'Sacred lock blocks background re-navigation; WALMART_NAV_FAILED clears navigationLock only, not inQueueUrls',
    impl: ['target-checkout-helper/background.js', 'target-checkout-helper/walmart-content.js'],
    coverage: 'strong',
    tests: ['walmart-flow-simulation.mjs', 'extension-functional.mjs'],
  },
  'WM-6': {
    id: 'WM-6',
    retailer: 'walmart',
    summary: 'Walmart queue error paths (PX timeout, NAV_FAILED while not in queue)',
    impl: ['target-checkout-helper/walmart-content.js'],
    coverage: 'strong',
    tests: ['walmart-flow-simulation.mjs', 'extension-functional.mjs'],
  },
  'WM-7': {
    id: 'WM-7',
    retailer: 'walmart',
    summary: 'Product-page __NEXT_DATA__ offerId → WM_OFFER_ID_READY updates monitor.products[].oid',
    impl: [
      'target-checkout-helper/walmart-content.js (_wmInit)',
      'target-checkout-helper/background.js (WM_OFFER_ID_READY handler)',
    ],
    coverage: 'strong',
    tests: ['extension-functional.mjs', 'fixture-e2e.mjs'],
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
    coverage: 'strong',
    tests: ['samsclub-module-simulation.mjs', 'extension-functional.mjs'],
  },
  'SC-2': {
    id: 'SC-2',
    retailer: 'samsclub',
    summary: "Sam's Club FCFS cart → checkout (no queue semantics)",
    impl: ['target-checkout-helper/samsclub-content.js (scHandleCartPage)'],
    coverage: 'strong',
    tests: ['samsclub-module-simulation.mjs', 'fixture-smoke.mjs', 'fixture-e2e.mjs'],
  },
  'SC-4': {
    id: 'SC-4',
    retailer: 'samsclub',
    summary: "Sam's Club FCFS checkout SPA — shipping/payment/review; default stop at review (TGT-4)",
    impl: [
      'target-checkout-helper/samsclub-content.js (scHandleCheckout, scHandleReview)',
    ],
    coverage: 'strong',
    tests: ['samsclub-module-simulation.mjs', 'fixture-smoke.mjs', 'fixture-e2e.mjs'],
  },
  'SC-3': {
    id: 'SC-3',
    retailer: 'samsclub',
    summary: "Sam's Club FCFS product-page ATC without queue semantics (disabled ATC → restock wait, no sacred lock)",
    impl: ['target-checkout-helper/samsclub-content.js (scHandleProductPage)'],
    coverage: 'strong',
    tests: ['samsclub-module-simulation.mjs', 'fixture-smoke.mjs', 'fixture-e2e.mjs'],
  },
  'SC-5': {
    id: 'SC-5',
    retailer: 'samsclub',
    summary: "Sam's Club FCFS race — no sacred lock / inQueueUrls",
    impl: ['target-checkout-helper/samsclub-content.js (scSignalAtcSuccess → ATC_SUCCESS)'],
    coverage: 'strong',
    tests: ['samsclub-module-simulation.mjs'],
  },
  'SC-6': {
    id: 'SC-6',
    retailer: 'samsclub',
    summary: "Sam's Club FCFS error-path hardening — NAV_FAILED releases poll lock, no sacred lock",
    impl: [
      'target-checkout-helper/samsclub-content.js (scSignalNavFailed)',
      'target-checkout-helper/background.js (NAV_FAILED handler)',
    ],
    coverage: 'strong',
    tests: ['samsclub-module-simulation.mjs'],
  },
  'FIX-1': {
    id: 'FIX-1',
    retailer: 'core',
    summary: 'Offline HTML fixtures (MOCK_URLS) exist with journey-aligned DOM markers',
    impl: ['scripts/browser-smoke/fixtures/*.html'],
    coverage: 'strong',
    tests: ['fixture-smoke.mjs'],
  },
  'FIX-2': {
    id: 'FIX-2',
    retailer: 'core',
    summary: 'Fixture pages on retailer hostnames — content scripts init offline (local server + host aliases)',
    impl: ['scripts/browser-smoke/fixture-server.mjs', 'scripts/browser-smoke/fixture-e2e.mjs'],
    coverage: 'strong',
    tests: ['fixture-e2e.mjs'],
  },
  'FIX-3': {
    id: 'FIX-3',
    retailer: 'core',
    summary: 'Fixture e2e asserts journey invariants offline (MON-2 mon2-live-poll-cycle on Target product + checkout (Walmart-only monitor + Target page reload during live poll, retailer filter holds)) + MON-2 mon2-samsclub-live-poll-cycle on Target product + checkout + Walmart pre-drop + checkout/unmonitored (Sam\'s-only monitor + cross-retailer page reload during live poll, retailer filter holds)) + WM-2 pre-drop no sacred lock + WM-2 live START_MONITOR poll cycle (wm2-live-poll-cycle), SC-5 no sacred lock, WM-4/WM-5/WM-6 sacred lock + product-page queue lock URL (location.href) + wm5-live-poll-cycle on product-page sacred lock + /qp + /checkout (sacred-lock page reload during live poll) + wm5-pre-timeout-live-poll-cycle on monitored /qp/waiting-room-monitored + /checkout sacred-lock routes (live START_MONITOR on productUrl before queue page — sacred lock survives reload + NAV_FAILED before any timeout) + wm4-qp-no-producturl + wm4-live-poll-cycle on unmonitored /qp + /checkout (Target-only monitor + queue page reload during live poll) + wm4-checkout-no-producturl + wm4-qp-timeout-no-producturl + wm4-checkout-timeout-no-producturl (data-tch-queue-timeout-ms NAV_FAILED without sacred lock) + wm4-live-poll-cycle on unmonitored + monitored /qp + /checkout timeout routes (Target-only monitor + queue page reload + repeated NAV_FAILED during live poll, no sacred lock) + wm4-poll-recovery-rearm (unmonitored /qp + /checkout timeout NAV_FAILED → poll re-arms navigationLock, no sacred lock) + wm4-qp-timeout-with-producturl + wm4-checkout-timeout-with-producturl + wm5-poll-recovery-rearm distinct recovery product on monitored /qp + /checkout timeout (QUEUE_TIMEOUT → poll re-arms navigationLock on helper product, no sacred lock) + wm5-pre-timeout-live-poll-cycle (product-page sacred lock + monitored /qp + /checkout queue timeout routes — sacred lock survives page reload + NAV_FAILED live poll before QUEUE_TIMEOUT fires) + wm5-product-queue-pretimeout (monitored product-page queue timeout — same pre-timeout live poll hardening) + wm5-poll-recovery-rearm cross-page on /ip/mock-queue-poll/457 (tab queue on 457, sacred lock keys monitor /ip/mock-queue/456 — QUEUE_TIMEOUT → poll re-arms on /ip/mock-queue-poll-recovery/461, no sacred lock) + wm5-checkout-spa-cross-poll-recovery on /checkout/spa-stall-sacred-cross (tab checkout SPA, sacred lock keys monitor /ip/mock-checkout-spa-cross-monitor/1002 — checkout timeout → poll re-arms on /ip/mock-checkout-spa-cross-recovery/1004, no sacred lock; STOP_MONITOR before poll-recovery asserts) + wm5-product-queue-timeout (monitored product-page queue uses wmQueueWaitTimeoutMs + QUEUE_TIMEOUT releases sacred lock) + wm5-queue-timeout-clears-sacred-lock (monitored /qp + /checkout QUEUE_TIMEOUT releases sacred lock) + wm5-checkout-spa-timeout-clears-sacred-lock (checkout SPA stall with pre-armed sacred lock — wmHandleCheckout timeout releases sacred lock) + wm5-checkout-spa-live-poll-cycle (checkout SPA stall reload + NAV_FAILED during live poll before timeout — sacred lock survives until checkout timeout) + wm5-poll-recovery-rearm on checkout SPA sacred (checkout timeout clears sacred lock → poll re-arms navigationLock on recovery product, no sacred lock) + wm6-price-guard-timeout (data-tch-price-guard-timeout-ms NAV_FAILED without sacred lock) + wm6-repeated-nav-failed on /ip/mock-price-guard-timeout/991 (repeated WALMART_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + wm6-repeated-nav-failed on /ip/mock-price-guard-cross/993 (tab price-guard product, monitor keys /ip/mock-price-guard-cross-monitor/992 — repeated WALMART_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + wm6-live-poll-cycle on /ip/mock-price-guard-cross/993 (tab price-guard product, monitor keys /ip/mock-price-guard-cross-monitor/992 — page reload + repeated NAV_FAILED during live poll, no sacred lock) + wm6-poll-recovery-rearm on /ip/mock-price-guard-cross/993 (tab price-guard product, monitor keys /ip/mock-price-guard-cross-monitor/992 — price-guard timeout WALMART_NAV_FAILED → poll re-arms on /ip/mock-price-guard-cross-recovery/994, no sacred lock; STOP_MONITOR before poll-recovery asserts) + wm6-repeated-nav-failed on /ip/mock-px-cross/995 (tab PX hang-tight, monitor keys /ip/mock-px-cross-monitor/996 — repeated WALMART_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + wm6-live-poll-cycle on /ip/mock-px-cross/995 (tab PX hang-tight, monitor keys /ip/mock-px-cross-monitor/996 — page reload + repeated NAV_FAILED during live poll, no sacred lock) + wm6-poll-recovery-rearm on /ip/mock-px-cross/995 (tab PX hang-tight, monitor keys /ip/mock-px-cross-monitor/996 — PX timeout WALMART_NAV_FAILED → poll re-arms on /ip/mock-px-cross-recovery/997, no sacred lock; STOP_MONITOR before poll-recovery asserts) + wm6-checkout-spa-timeout (data-tch-checkout-timeout-ms NAV_FAILED without sacred lock) + wm6-repeated-nav-failed on /checkout/spa-stall (tab checkout SPA, monitor keys /ip/mock-checkout-spa/992 — repeated WALMART_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + wm6-repeated-nav-failed on /checkout/spa-stall-cross (tab checkout SPA, monitor keys /ip/mock-checkout-spa-cross-monitor/1003 — repeated WALMART_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + wm6-live-poll-cycle on /checkout/spa-stall-cross (tab checkout SPA, monitor keys /ip/mock-checkout-spa-cross-monitor/1003 — page reload + repeated NAV_FAILED during live poll, no sacred lock) + wm6-poll-recovery-rearm on /checkout/spa-stall-cross (tab checkout SPA, monitor keys /ip/mock-checkout-spa-cross-monitor/1003 — checkout SPA timeout WALMART_NAV_FAILED → poll re-arms on /ip/mock-checkout-spa-cross-recovery/1005, no sacred lock; STOP_MONITOR before poll-recovery asserts) + wm6-live-poll-cycle on price-guard + checkout SPA (page reload + repeated NAV_FAILED during live poll, no sacred lock) + wm6-poll-recovery-rearm (price-guard + checkout SPA NAV_FAILED → poll re-arms navigationLock, no sacred lock) + wm6-cart-live-poll-cycle on /cart/no-checkout (cart checkout-missing reload + repeated NAV_FAILED during live poll) + wm6-poll-recovery-rearm on cart (product→cart checkout-missing NAV_FAILED → poll re-arms navigationLock, no sacred lock) + wm6-repeated-nav-failed on /cart/no-checkout (repeated WALMART_NAV_FAILED cycles keyed on monitor productUrl /ip/mock-cart-missing/888, no sacred lock) + wm6-repeated-nav-failed on /cart/no-checkout-cross (tab cart, monitor keys /ip/mock-cart-cross-monitor/890 — repeated WALMART_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + PX hang-tight + #px-captcha + px-block + data-tch-px-timeout-ms override timeout error paths + wm6-live-poll-cycle on PX hang-tight + #px-captcha + px-block + PX override with repeated NAV_FAILED during poll + wm6-repeated-nav-failed on /ip/mock-px/555 + /ip/mock-px-captcha/556 + /ip/mock-px-block/557 + /ip/mock-px-override/558 (repeated WALMART_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + wm6-poll-recovery-rearm on PX hang-tight + #px-captcha + px-block + PX override (PX timeout NAV_FAILED → poll re-arms navigationLock, no sacred lock), WM-5 repeated NAV_FAILED + poll-skip + live START_MONITOR poll cycle with sacred-lock page reload + repeated NAV_FAILED during poll on product-page queue URL + monitored /qp + /checkout (wm5-live-poll-cycle), SC-5 repeated ATC_SUCCESS FCFS race cycles + SC-5/SC-6 live START_MONITOR poll cycle with FCFS page reload during live poll + repeated NAV_FAILED/ATC_SUCCESS during poll (sc5-sc6-live-poll-cycle on FCFS restock + invisible-atc + Sam\'s /cart + /checkout/spa happy path) + SC-6 sc6-invisible-atc (enabled but hidden ATC → NAV_FAILED, no sacred lock, data-tch-atc-wait-ms) + sc6-poll-recovery-rearm (restock + invisible-atc NAV_FAILED → poll re-arms navigationLock, no sacred lock) + wm5-poll-recovery-rearm (monitored /qp + product-page queue + monitored /checkout QUEUE_TIMEOUT → poll re-arms navigationLock, no sacred lock), SC-6 restock repeated NAV_FAILED + SC-5 ATC_SUCCESS combo, TGT-1 tgt-live-poll-cycle (product reload + ATC_SUCCESS/NAV_FAILED during live poll, no sacred lock), TGT-4 manual review + tgt4-live-poll-cycle (checkout reload during live poll preserves manual stop; cross-page NAV_FAILED keys monitor productUrl on /checkout + /checkout/review-cross) + tgt-poll-recovery-rearm on /checkout (tab review, monitor keys /p/mock-product — review manual stop + live poll NAV_FAILED keys monitor productUrl → poll re-arms on /p/mock-review-recovery/A-880100, no sacred lock) + tgt-review-cross-poll-recovery on /checkout/review-cross (tab review, monitor keys /p/mock-review-cross-monitor/A-880101 — review manual stop + live poll NAV_FAILED keys monitor productUrl → poll re-arms on /p/mock-review-cross-recovery/A-880102, no sacred lock; STOP_MONITOR before poll-recovery asserts) + tgt-checkout-signin (checkout sign-in gate — pending step, no review, no retry spam) + tgt-signin-live-poll-cycle (signin reload + NAV_FAILED/ATC_SUCCESS during live poll — no sacred lock, no review; monitor productUrl NAV_FAILED when tab on /checkout/signin-gate) + tgt-poll-recovery-rearm on /checkout/signin-gate (tab signin gate, monitor keys /p/mock-product — signin pending + live poll NAV_FAILED keys monitor productUrl → poll re-arms on /p/mock-signin-recovery/A-880099, no sacred lock) + tgt-signin-cross-poll-recovery on /checkout/signin-gate-cross (tab signin gate, monitor keys /p/mock-signin-cross-monitor/A-880097 — signin pending + live poll NAV_FAILED keys monitor productUrl → poll re-arms on /p/mock-signin-cross-recovery/A-880098, no sacred lock; STOP_MONITOR before poll-recovery asserts) + tgt4-checkout-spa-timeout (checkout SPA stall handleCheckoutStall timeout → NAV_FAILED, no sacred lock) + tgt4-checkout-spa-live-poll-cycle (checkout SPA stall reload + repeated NAV_FAILED during live poll, no sacred lock) + tgt-repeated-nav-failed (checkout SPA timeout on /checkout/spa-stall — repeated NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + tgt-poll-recovery-rearm (checkout SPA stall NAV_FAILED → poll re-arms navigationLock on TCIN skip-monitoring product, no sacred lock), WM-7 wm7-offer-id-ready (__NEXT_DATA__ offerId → monitor.products[].oid) + wm6-missing-atc-element (no ATC DOM element → NAV_FAILED, no sacred lock, data-tch-atc-wait-ms) + wm6-repeated-nav-failed (missing ATC on /ip/mock-no-atc/559 — repeated NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + wm6-poll-recovery-rearm on missing-atc (NAV_FAILED → poll re-arms navigationLock, no sacred lock) + wm6-repeated-nav-failed on /ip/mock-no-atc-cross/998 (tab missing-ATC product, monitor keys /ip/mock-no-atc-cross-monitor/999 — repeated WALMART_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + wm6-live-poll-cycle on /ip/mock-no-atc-cross/998 (tab missing-ATC product, monitor keys /ip/mock-no-atc-cross-monitor/999 — page reload + repeated NAV_FAILED during live poll, no sacred lock) + wm6-poll-recovery-rearm on /ip/mock-no-atc-cross/998 (tab missing-ATC product, monitor keys /ip/mock-no-atc-cross-monitor/999 — missing ATC timeout WALMART_NAV_FAILED → poll re-arms on /ip/mock-no-atc-cross-recovery/1000, no sacred lock; STOP_MONITOR before poll-recovery asserts) + sc6-cart-live-poll-cycle on /cart/no-checkout (cart checkout-missing reload + repeated SAMS_NAV_FAILED during live poll, no sacred lock) + sc6-repeated-nav-failed on /cart/no-checkout (repeated SAMS_NAV_FAILED cycles keyed on monitor productUrl /p/mock-fcfs-cart-missing/792, no sacred lock) + sc6-cart-cross-poll-recovery on /cart/no-checkout-cross (tab cart, monitor keys /p/mock-fcfs-cart-cross-monitor/794 — cart checkout-missing SAMS_NAV_FAILED → poll re-arms on /p/mock-fcfs-cart-cross-recovery/795, no sacred lock; STOP_MONITOR before poll-recovery asserts) + sc6-repeated-nav-failed on /cart/no-checkout-cross (tab cart, monitor keys /p/mock-fcfs-cart-cross-monitor/794 — repeated SAMS_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + sc6-checkout-spa-cross-poll-recovery on /checkout/spa-stall-cross (tab checkout SPA, monitor keys /p/mock-checkout-spa-cross-monitor/796 — checkout SPA timeout SAMS_NAV_FAILED → poll re-arms on /p/mock-checkout-spa-cross-recovery/797, no sacred lock; STOP_MONITOR before poll-recovery asserts) + sc4-repeated-nav-failed on /checkout/spa-stall-cross (tab checkout SPA, monitor keys /p/mock-checkout-spa-cross-monitor/796 — repeated SAMS_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + sc4-poll-recovery-rearm (checkout SPA stall SAMS_NAV_FAILED → poll re-arms navigationLock on invisible-atc product, no sacred lock) + sc4-repeated-nav-failed (checkout SPA timeout on /checkout/spa-stall — repeated SAMS_NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + sc6-checkout-spa-live-poll-cycle (checkout SPA stall reload + repeated SAMS_NAV_FAILED during live poll, no sacred lock) + tgt-cart-checkout-missing (cart checkout-missing NAV_FAILED, no sacred lock, data-tch-cart-checkout-wait-ms) + tgt-cart-live-poll-cycle on /cart/no-checkout (cart checkout-missing reload + repeated NAV_FAILED during live poll, no sacred lock) + tgt-poll-recovery-rearm on cart (product→cart checkout-missing NAV_FAILED → poll re-arms navigationLock on TCIN skip-monitoring product, no sacred lock) + tgt-cart-cross-poll-recovery on /cart/no-checkout-cross (tab cart, monitor keys /p/mock-cart-cross-monitor/A-880088 — cart checkout-missing NAV_FAILED → poll re-arms on /p/mock-cart-cross-recovery/A-880089, no sacred lock; STOP_MONITOR before poll-recovery asserts) + tgt4-checkout-spa-cross-poll-recovery on /checkout/spa-stall-cross (tab checkout SPA, monitor keys /p/mock-checkout-spa-cross-monitor/A-880092 — checkout SPA timeout NAV_FAILED → poll re-arms on /p/mock-checkout-spa-cross-recovery/A-880093, no sacred lock; STOP_MONITOR before poll-recovery asserts) + tgt-repeated-nav-failed on /checkout/spa-stall-cross (tab checkout SPA, monitor keys /p/mock-checkout-spa-cross-monitor/A-880092 — repeated NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + tgt-missing-atc-element (no ATC DOM element → NAV_FAILED, no sacred lock, data-tch-atc-wait-ms) + tgt-repeated-nav-failed (missing ATC on /p/-/A-66666666 — repeated NAV_FAILED cycles keyed on monitor productUrl, no sacred lock) + tgt-live-poll-cycle on /p/-/A-66666666 (missing ATC page reload + repeated NAV_FAILED during live poll, no sacred lock) + tgt-poll-recovery-rearm on /p/-/A-66666666 (missing ATC NAV_FAILED → poll re-arms navigationLock, no sacred lock) + tgt-missing-atc-cross-poll-recovery on /p/mock-missing-atc-cross/A-880095 (tab product page, monitor keys /p/mock-missing-atc-cross-monitor/A-880094 — missing ATC NAV_FAILED → poll re-arms on /p/mock-missing-atc-cross-recovery/A-880096, no sacred lock; STOP_MONITOR before poll-recovery asserts) + tgt-live-poll-cycle on /p/mock-missing-atc-cross/A-880095 (tab product page, monitor keys /p/mock-missing-atc-cross-monitor/A-880094 — page reload + repeated NAV_FAILED during live poll, no sacred lock) + tgt-repeated-nav-failed on /p/mock-missing-atc-cross/A-880095 (tab product page, monitor keys /p/mock-missing-atc-cross-monitor/A-880094 — repeated NAV_FAILED cycles keyed on monitor productUrl, no sacred lock))',
    impl: ['scripts/browser-smoke/fixture-e2e.mjs'],
    coverage: 'strong',
    tests: ['fixture-e2e.mjs'],
  },
};

/**
 * Behavioral invariants — must hold after every overnight change.
 * @type {Record<string, { id: string, rule: string, code: string[] }>}
 */
export const INVARIANTS = {
  'MON-2': {
    id: 'MON-2',
    rule: 'Only one retailer monitor active per session; Target and Walmart start buttons share monitorActive and filter products by retailer.',
    code: ['target-checkout-helper/popup.js'],
  },
  'WM-2': {
    id: 'WM-2',
    rule: 'Pre-drop disabled ATC without queue indicators is not queue; do not arm sacred lock for price-guard-only waits.',
    code: ['target-checkout-helper/walmart-content.js'],
  },
  'WM-4': {
    id: 'WM-4',
    rule: 'Sacred lock (inQueueUrls) is set only after queue entry is confirmed via WALMART_IN_QUEUE.',
    code: ['target-checkout-helper/walmart-content.js', 'target-checkout-helper/background.js'],
  },
  'WM-5': {
    id: 'WM-5',
    rule: 'While inQueueUrls holds a product URL, background poll must not re-navigate; WALMART_NAV_FAILED releases navigationLock only.',
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
    code: ['target-checkout-helper/content.js', 'target-checkout-helper/walmart-content.js', 'target-checkout-helper/popup.html'],
  },
  'WM-3': {
    id: 'WM-3',
    rule: 'Two-phase queue model: product-page queue vs /qp waiting room vs checkout queue — see WALMART-DROP-DEBUG-HANDOFF.md.',
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
  'extension-e2e.mjs': ['TGT-1', 'TGT-2', 'TGT-4'],
  'extension-functional.mjs': ['MON-1', 'MON-2', 'MON-3', 'TGT-1', 'TGT-2', 'WM-4', 'WM-5', 'WM-6', 'WM-7', 'SC-1'],
  'review-dedup-simulation.mjs': ['TGT-3', 'TGT-4'],
  'target-content-simulation.mjs': ['TGT-1', 'TGT-4'],
  'walmart-flow-simulation.mjs': ['WM-1', 'WM-2', 'WM-4', 'WM-5', 'WM-6'],
  'walmart-main-world-simulation.mjs': ['WM-3'],
  'samsclub-module-simulation.mjs': ['SC-1', 'SC-2', 'SC-3', 'SC-4', 'SC-5', 'SC-6'],
  'fixture-smoke.mjs': ['FIX-1'],
  'fixture-e2e.mjs': ['FIX-2', 'FIX-3', 'WM-7'],
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
 * Mock HTML fixtures for offline retailer e2e (FIX-1: fixture-smoke.mjs; FIX-2: fixture-e2e.mjs).
 * Paths are relative to scripts/browser-smoke/.
 */
export const MOCK_URLS = {
  targetProduct: 'fixtures/target-product.html',
  targetCheckoutReview: 'fixtures/target-checkout-review.html',
  targetCheckoutSignin: 'fixtures/target-checkout-signin.html',
  targetCheckoutSigninCross: 'fixtures/target-checkout-signin-cross.html',
  targetProductSigninCrossMonitor: 'fixtures/target-product-signin-cross-monitor.html',
  targetProductSigninCrossRecovery: 'fixtures/target-product-signin-cross-recovery.html',
  targetProductSigninRecovery: 'fixtures/target-product-signin-recovery.html',
  targetCheckoutReviewCross: 'fixtures/target-checkout-review-cross.html',
  targetProductReviewRecovery: 'fixtures/target-product-review-recovery.html',
  targetProductReviewCrossMonitor: 'fixtures/target-product-review-cross-monitor.html',
  targetProductReviewCrossRecovery: 'fixtures/target-product-review-cross-recovery.html',
  targetCheckoutSpaTimeout: 'fixtures/target-checkout-spa-timeout.html',
  targetCheckoutSpaCross: 'fixtures/target-checkout-spa-cross.html',
  targetProductCheckoutSpaCrossMonitor: 'fixtures/target-product-checkout-spa-cross-monitor.html',
  targetProductCheckoutSpaCrossRecovery: 'fixtures/target-product-checkout-spa-cross-recovery.html',
  targetCartNoCheckout: 'fixtures/target-cart-no-checkout.html',
  targetCartNoCheckoutCross: 'fixtures/target-cart-no-checkout-cross.html',
  targetProductCartCrossMonitor: 'fixtures/target-product-cart-cross-monitor.html',
  targetProductCartCrossRecovery: 'fixtures/target-product-cart-cross-recovery.html',
  targetProductNoAtc: 'fixtures/target-product-no-atc.html',
  targetProductMissingAtcCrossMonitor: 'fixtures/target-product-missing-atc-cross-monitor.html',
  targetProductMissingAtcCross: 'fixtures/target-product-missing-atc-cross.html',
  targetProductMissingAtcCrossRecovery: 'fixtures/target-product-missing-atc-cross-recovery.html',
  walmartProductPreDrop: 'fixtures/walmart-product-predrop.html',
  walmartProductQueue: 'fixtures/walmart-product-queue.html',
  walmartProductQueueTimeout: 'fixtures/walmart-product-queue-timeout.html',
  walmartQpRoom: 'fixtures/walmart-qp-room.html',
  walmartCheckoutQueue: 'fixtures/walmart-checkout-queue.html',
  walmartProductPx: 'fixtures/walmart-product-px.html',
  walmartProductPxCaptcha: 'fixtures/walmart-product-px-captcha.html',
  walmartProductPxBlock: 'fixtures/walmart-product-px-block.html',
  walmartProductPxOverride: 'fixtures/walmart-product-px-override.html',
  walmartProductNoAtc: 'fixtures/walmart-product-no-atc.html',
  walmartProductOid: 'fixtures/walmart-product-oid.html',
  samsclubProductFcfs: 'fixtures/samsclub-product-fcfs.html',
  samsclubProductFcfsDisabled: 'fixtures/samsclub-product-fcfs-disabled.html',
  samsclubCart: 'fixtures/samsclub-cart.html',
  samsclubCartNoCheckout: 'fixtures/samsclub-cart-no-checkout.html',
  samsclubCartNoCheckoutCross: 'fixtures/samsclub-cart-no-checkout-cross.html',
  samsclubProductCartCrossMonitor: 'fixtures/samsclub-product-cart-cross-monitor.html',
  samsclubProductCartCrossRecovery: 'fixtures/samsclub-product-cart-cross-recovery.html',
  samsclubProductCartMissing: 'fixtures/samsclub-product-cart-missing.html',
  samsclubCheckoutReview: 'fixtures/samsclub-checkout-review.html',
  samsclubCheckoutSpa: 'fixtures/samsclub-checkout-spa.html',
  samsclubCheckoutSpaTimeout: 'fixtures/samsclub-checkout-spa-timeout.html',
  samsclubCheckoutSpaCross: 'fixtures/samsclub-checkout-spa-cross.html',
  samsclubProductCheckoutSpaCrossMonitor: 'fixtures/samsclub-product-checkout-spa-cross-monitor.html',
  samsclubProductCheckoutSpaCrossRecovery: 'fixtures/samsclub-product-checkout-spa-cross-recovery.html',
  samsclubProductFcfsRestock: 'fixtures/samsclub-product-fcfs-restock.html',
  samsclubProductFcfsInvisibleAtc: 'fixtures/samsclub-product-fcfs-invisible-atc.html',
  walmartCartNoCheckout: 'fixtures/walmart-cart-no-checkout.html',
  walmartCartNoCheckoutCross: 'fixtures/walmart-cart-no-checkout-cross.html',
  walmartProductCartCrossMonitor: 'fixtures/walmart-product-cart-cross-monitor.html',
  walmartProductCartCrossRecovery: 'fixtures/walmart-product-cart-cross-recovery.html',
  walmartProductCartMissing: 'fixtures/walmart-product-cart-missing.html',
  walmartQpRoomTimeout: 'fixtures/walmart-qp-room-timeout.html',
  walmartQpRoomMonitoredPretimeout: 'fixtures/walmart-qp-room-monitored-pretimeout.html',
  walmartCheckoutQueueTimeout: 'fixtures/walmart-checkout-queue-timeout.html',
  walmartCheckoutMonitoredPretimeout: 'fixtures/walmart-checkout-monitored-pretimeout.html',
  walmartProductQueuePretimeout: 'fixtures/walmart-product-queue-pretimeout.html',
  walmartProductPriceGuardTimeout: 'fixtures/walmart-product-price-guard-timeout.html',
  walmartProductPriceGuardCross: 'fixtures/walmart-product-price-guard-cross.html',
  walmartProductPriceGuardCrossMonitor: 'fixtures/walmart-product-price-guard-cross-monitor.html',
  walmartProductPriceGuardCrossRecovery: 'fixtures/walmart-product-price-guard-cross-recovery.html',
  walmartProductPxCross: 'fixtures/walmart-product-px-cross.html',
  walmartProductPxCrossMonitor: 'fixtures/walmart-product-px-cross-monitor.html',
  walmartProductPxCrossRecovery: 'fixtures/walmart-product-px-cross-recovery.html',
  walmartProductNoAtcCross: 'fixtures/walmart-product-no-atc-cross.html',
  walmartProductNoAtcCrossMonitor: 'fixtures/walmart-product-no-atc-cross-monitor.html',
  walmartProductNoAtcCrossRecovery: 'fixtures/walmart-product-no-atc-cross-recovery.html',
  walmartCheckoutSpaTimeout: 'fixtures/walmart-checkout-spa-timeout.html',
  walmartCheckoutSpaCross: 'fixtures/walmart-checkout-spa-cross.html',
  walmartProductCheckoutSpaCrossMonitor: 'fixtures/walmart-product-checkout-spa-cross-monitor.html',
  walmartProductCheckoutSpaCrossRecovery: 'fixtures/walmart-product-checkout-spa-cross-recovery.html',
  walmartCheckoutSpaSacred: 'fixtures/walmart-checkout-spa-sacred.html',
  walmartCheckoutSpaSacredCross: 'fixtures/walmart-checkout-spa-sacred-cross.html',
  walmartProductPollRecovery: 'fixtures/walmart-product-poll-recovery.html',
  walmartProductQueuePollRecovery: 'fixtures/walmart-product-queue-poll-recovery.html',
  walmartProductQueuePollCross: 'fixtures/walmart-product-queue-poll-cross.html',
  walmartProductQueuePollCrossRecovery: 'fixtures/walmart-product-queue-poll-cross-recovery.html',
  walmartCheckoutPollRecovery: 'fixtures/walmart-checkout-poll-recovery.html',
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
  console.log(`Next strengthen: ${weak ? `${weak.id} (${weak.coverage}) — ${weak.summary}` : '(none)'}`);
}
