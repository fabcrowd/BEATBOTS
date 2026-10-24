# Walmart drop debug handoff — two-phase queue model

This document describes how **Target Checkout Helper** handles Walmart drop queues, sacred lock, and background poll interaction. It is the authoritative reference for invariant **WM-3** in `scripts/browser-smoke/test-scope.mjs`.

**Do not change the two-phase queue model** unless a journey test in `test-scope.mjs` explicitly requires a fix.

## Overview

Walmart drops can surface a queue in **three distinct places**:

| Phase | URL / page | Handler | Sacred lock? |
|-------|------------|---------|--------------|
| **1 — Product-page queue** | `/ip/...` with queue indicators | `wmWaitInProductQueue` | Yes, when `wmHasQueueIndicators()` |
| **2 — Waiting room** | `/qp?...` (Queue-it white-label) | `wmHandleQueueRoom` | Yes, keyed to monitored `productUrl` |
| **3 — Checkout queue** | `/checkout` with queue DOM | `wmHandleQueue` | Yes, keyed to monitored `productUrl` |

**Pre-drop disabled ATC alone is not queue** (WM-2). A disabled Add-to-Cart button before go-time, without queue text or `/qp` redirect, must **not** arm sacred lock. Price-guard waits (`wmWaitForPriceDrop`) also never arm sacred lock.

## Sacred lock vs navigation lock

Background service worker (`background.js`) maintains two sets:

| Set | Purpose | Cleared by |
|-----|---------|------------|
| `navigationLock` | Background already navigated tab to product; content script is in control | `WALMART_NAV_FAILED`, `WALMART_QUEUE_TIMEOUT`, `ATC_SUCCESS`, `stopMonitor` |
| `inQueueUrls` (**sacred lock**) | User is in a confirmed queue; poll must never re-navigate | `WALMART_QUEUE_TIMEOUT`, `ATC_SUCCESS`, `stopMonitor` |

### WM-4 — when sacred lock arms

Content script sends `WALMART_IN_QUEUE` with a **normalized product URL** (`/ip/.../itemId`) when:

1. **Product-page queue** — `wmWaitInProductQueue` after `wmHasQueueIndicators()` is true.
2. **/qp waiting room** — `wmHandleQueueRoom` when `settings.productUrl` is set (monitored drop).
3. **Checkout queue** — `wmHandleQueue` when queue DOM appears on `/checkout`.

The lock URL **must** be the monitored product URL, not `location.href` on `/qp` or `/checkout`. Background poll keys `inQueueUrls` by normalized product URL; using the current page URL would fail to match and leave the tab unprotected.

### WM-5 — sacred lock behavior

While `inQueueUrls` holds a product URL:

- Background poll **skips** that product entirely (`Skipping … — in queue`).
- Background poll **never navigates** tabs in checkout flow when sacred lock is active (`isInCheckoutFlow` + `inQueueUrls` guard).
- `WALMART_NAV_FAILED` releases **`navigationLock` only** — sacred lock stays until queue timeout or ATC success.

### WM-6 — error paths without sacred lock

These paths send `WALMART_NAV_FAILED` (navigation lock only, no sacred lock):

- Pre-drop price guard timeout (`wmWaitForPriceDrop`)
- PX / hang-tight page timeout
- ATC not found / disabled without queue indicators
- Cart checkout button missing
- Unmonitored `/qp` or checkout queue timeout (no `productUrl` in settings)

`WALMART_QUEUE_TIMEOUT` releases **both** sacred lock and navigation lock so poll can recover.

## Two-phase queue model (WM-3)

### Phase 1 — Product page (`/ip/...`)

During high-demand drops Walmart often keeps users on the product page:

- ATC button is **disabled** while waiting in line.
- Queue text may appear (`"you're in line"`, `"estimated wait time"`, etc.).
- When position clears, ATC enables; user must **stay on the page**.

**Detection:** `wmShouldEnterSacredQueueWait()` → `wmHasQueueIndicators()` (not `wmIsProductQueued()` alone).

**Behavior:**

1. Send `WALMART_IN_QUEUE` immediately.
2. Poll DOM (and listen for `TCH_QUEUE_PASSED` — see below).
3. When ATC enables, click (or OID direct-API path) and proceed to cart.

### Phase 2 — Waiting room (`/qp`)

After ATC or checkout click, Walmart may redirect to Queue-it's white-labeled `/qp` URL.

**Behavior:**

1. Passive hold — **do not navigate or reload**.
2. Arm sacred lock using monitored `productUrl`.
3. When queue clears, Walmart auto-redirects; SPA watcher re-runs `wmInit()`.

### Phase 3 — Checkout queue (`/checkout`)

Queue can also appear inside the checkout SPA (same `/checkout` URL, different DOM).

**Behavior:**

1. `wmHandleCheckout` detects `wmIsQueuePage()` and delegates to `wmHandleQueue`.
2. Sacred lock on monitored `productUrl`.
3. When queue DOM clears, resume checkout step polling.

## Queue-it WebSocket fast path (WM-3)

`walmart-main-world.js` (MAIN world, `document_start`) patches `WebSocket` to sniff Queue-it frames. On `queuePassed` / `position === 0`, it dispatches:

```
document.documentElement → CustomEvent('TCH_QUEUE_PASSED')
```

`wmWaitInProductQueue` listens for this event to react faster than 1–2s DOM polling.

## Background poll interaction

```
┌─────────────┐     navigate to /ip/...      ┌──────────────────┐
│ bg poll     │ ───────────────────────────► │ navigationLock   │
│ (monitor)   │                              │ (per productUrl) │
└─────────────┘                              └────────┬─────────┘
       │                                              │
       │ skip if inQueueUrls                          │ content script loads
       ▼                                              ▼
┌─────────────┐     WALMART_IN_QUEUE         ┌──────────────────┐
│ inQueueUrls │ ◄─────────────────────────── │ walmart-content  │
│ (sacred)    │                              │ wmInit → handler │
└─────────────┘                              └────────┬─────────┘
       │                                              │
       │ poll skips product                           │ queue clears → ATC / checkout
       ▼                                              ▼
  (no re-nav)                              ATC_SUCCESS / QUEUE_TIMEOUT / NAV_FAILED
```

### Message types (Walmart-specific)

| Message | Sender | Effect |
|---------|--------|--------|
| `WALMART_IN_QUEUE` | content | Add URL to `inQueueUrls` |
| `WALMART_NAV_FAILED` | content | Delete from `navigationLock` only |
| `WALMART_QUEUE_TIMEOUT` | content | Delete from both sets |
| `ATC_SUCCESS` | content | Delete from both sets; increment monitor count |
| `WM_OFFER_ID_READY` | content | Update `monitor.products[].oid` for direct-API ATC |

## Debugging checklist

When a drop misbehaves, check in order:

1. **Console prefix `[WMT]`** — page type, queue detection, lock signals.
2. **Background `[TCH bg]`** — `in queue`, `navigation in progress`, `sacred lock` skip logs.
3. **Popup monitor status** — `GET_MONITOR_STATUS` returns `inQueueUrls` and `navigationLock` arrays.
4. **Is sacred lock warranted?** Pre-drop disabled ATC without queue text → should **not** lock (WM-2).
5. **Lock URL** — must be `/ip/...` product URL, not `/qp` or `/checkout` pathname.
6. **Poll recovery** — after `NAV_FAILED` without sacred lock, next poll cycle should re-arm `navigationLock` and re-navigate.

## Fixture e2e hooks

Offline tests under `scripts/browser-smoke/fixtures/` use `data-tch-*` attributes to shorten waits:

| Attribute | Used for |
|-----------|----------|
| `data-tch-queue-timeout-ms` | Queue wait cap (WM-4/WM-5 timeout paths) |
| `data-tch-price-guard-timeout-ms` | Price guard timeout (WM-6) |
| `data-tch-checkout-timeout-ms` | Checkout SPA stall timeout (WM-6) |
| `data-tch-px-timeout-ms` | PX page timeout (WM-6) |
| `data-tch-atc-wait-ms` | Short ATC wait before NAV_FAILED |
| `data-tch-cart-checkout-wait-ms` | Cart checkout button wait |

See `FIX-3` in `test-scope.mjs` for the full list of fixture e2e invariant routes.

## Related invariants

| ID | Rule |
|----|------|
| WM-2 | Pre-drop disabled ATC without queue indicators ≠ queue |
| WM-4 | Sacred lock only after queue confirmed via `WALMART_IN_QUEUE` |
| WM-5 | Sacred lock blocks background re-navigation; `NAV_FAILED` clears nav lock only |
| WM-6 | Error paths release nav lock without sacred lock unless queue was confirmed |
| SC-5 | Sam's Club FCFS must **not** use Walmart sacred lock |
| MON-2 | Only one retailer monitor active per session |

## Key source files

- `target-checkout-helper/walmart-content.js` — queue handlers, page routing, signal functions
- `target-checkout-helper/walmart-main-world.js` — Queue-it WebSocket sniff
- `target-checkout-helper/background.js` — `inQueueUrls`, `navigationLock`, poll loop
- `scripts/browser-smoke/walmart-flow-simulation.mjs` — offline WM-1..WM-7 simulation
- `scripts/browser-smoke/fixture-e2e.mjs` — offline invariant routes (FIX-3)
