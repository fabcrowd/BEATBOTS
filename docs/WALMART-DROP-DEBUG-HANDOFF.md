# Walmart drop debug handoff

Reference for WM-3 / WM-4 / WM-5 invariants and `walmart-flow-simulation.mjs`.

## Two-phase queue model

Walmart drops can queue in **three** places. The extension treats them differently:

| Phase | URL / signal | Handler | Sacred lock (`inQueueUrls`) |
|-------|----------------|---------|----------------------------|
| **Product-page queue** | `/ip/...` with disabled ATC | `wmWaitInProductQueue` | Yes — `WALMART_IN_QUEUE` with `location.href` |
| **Waiting room** | `/qp?...` (Queue-it) | `wmHandleQueueRoom` | Yes — `WALMART_IN_QUEUE` with **product URL** (not `/qp`) |
| **Checkout queue** | `/checkout` with queue copy | `wmHandleQueue` | Yes — product URL lock |

**Not queue (WM-2):** disabled ATC alone without `wmHasQueueIndicators()` — e.g. pre-drop price guard or item not live yet. Do **not** arm sacred lock.

## Lock types

- **`inQueueUrls` (sacred lock):** Set by `WALMART_IN_QUEUE`. Background poll must **never** re-navigate this product URL while set. Cleared only on successful ATC (`ATC_SUCCESS`) or monitor stop.
- **`navigationLock`:** Set when background navigates a tab to a product. Released on `WALMART_NAV_FAILED` or ATC success. **Does not** clear `inQueueUrls` (WM-5).

## MAIN-world queue signal (WM-3)

`walmart-main-world.js` sniffs Queue-it WebSocket messages at `document_start`. On admission it dispatches `TCH_QUEUE_PASSED` on `document.documentElement`. Product-page wait loop listens for this to wake early when ATC lags.

## Debugging checklist

1. **Tab keeps reloading during queue** — check `inQueueUrls` in service worker logs (`[TCH bg] WALMART_IN_QUEUE locked`). Poll should skip locked URLs.
2. **Lost queue position after /qp** — verify lock URL is `settings.productUrl` (`/ip/...`), not `/qp?...`.
3. **Stuck after PX "Hang tight"** — content script should wait in `wmIsPxPage()`; on timeout sends `WALMART_NAV_FAILED` (releases `navigationLock` only).
4. **Pre-drop disabled ATC treated as queue** — WM-2: need queue indicators or product-page queue handler path, not ATC disabled alone.
5. **NAV_FAILED during sacred lock** — WM-5: `navigationLock` clears; `inQueueUrls` must remain until ATC or manual stop.

## Test coverage

Offline: `node scripts/browser-smoke/walmart-flow-simulation.mjs` (WM-1..WM-7).

Journey map: `node scripts/browser-smoke/test-scope.mjs`.
