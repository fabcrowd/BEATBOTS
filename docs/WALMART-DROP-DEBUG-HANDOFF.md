# Walmart drop / queue — debug handoff

This document is the **authoritative narrative** for the **two-phase queue model** and **sacred lock** behavior enforced by `scripts/browser-smoke` (WM-2, WM-3, WM-4, WM-5, WM-6). It should stay aligned with `target-checkout-helper/walmart-content.js` and `target-checkout-helper/background.js`.

## Two-phase queue model (WM-3)

Walmart can show queue friction in **three different places**. The extension treats them as separate phases:

1. **Product-page queue** (`/ip/...`): ATC is present but **disabled** while you hold a ticket; you must **stay on the product page**. When your turn arrives, ATC enables and you proceed (OID or DOM click → cart).
2. **`/qp` waiting room**: White-labeled Queue-it URL. You **wait passively** until Walmart redirects you; the extension does not navigate away.
3. **Checkout queue** (`/checkout` with queue copy): Same idea as (2) but on the checkout host — wait until the queue clears and normal shipping/payment/review UI appears.

**MAIN-world sniff** (`walmart-main-world.js`): Queue-it WebSocket completion fires `TCH_QUEUE_PASSED` on `document.documentElement`. The product-page waiter listens for that in addition to enabled ATC (see `wmWaitInProductQueue`).

## Sacred lock vs poll locks (WM-4 / WM-5)

**Goal:** Once Walmart queue entry is **confirmed**, the background monitor must **not** re-navigate the tab or destroy queue position.

| Mechanism | Set by | Cleared by | Meaning |
|-----------|--------|------------|---------|
| `inQueueUrls` (sacred lock) | `WALMART_IN_QUEUE` → `background.js` | `WALMART_QUEUE_TIMEOUT` (normalized product URL) | Tab is in a **confirmed** queue wait; background poll must **skip navigation** for that normalized product URL. |
| `navigationLock` | Poll loop when scheduling navigation | `WALMART_NAV_FAILED` / `NAV_FAILED` / `SAMS_NAV_FAILED`, success paths, `STOP_MONITOR`, queue timeout | **Ordinary** “we are navigating or about to navigate” guard; released on content-script failure so the next poll can retry. |

**WM-5:** `WALMART_NAV_FAILED` clears **`navigationLock` only**, not `inQueueUrls`. That way a transient error on a queue page does **not** let the background yank the tab out of queue.

**`WALMART_QUEUE_TIMEOUT`:** Clears **both** `inQueueUrls` and `navigationLock` for the normalized product URL so the user/monitor can recover after a long wait.

## When sacred lock arms (WM-2 / WM-4)

- **WM-2:** **Disabled ATC alone** (pre-drop, restock wait, price guard) is **not** treated as queue. Do **not** arm sacred lock from “button disabled” only.
- **WM-4:** Sacred lock arms only when queue is **confirmed**: `wmHasQueueIndicators()` is true (see `wmShouldEnterSacredQueueWait` in `walmart-content.js`), or the product-page queue path sends `WALMART_IN_QUEUE` after entering `wmWaitInProductQueue`.
- **Lock URL:** Sacred lock is always keyed by the **monitored product URL** (`settings.productUrl`), normalized in the background. On product-page queue without a monitor URL, the code may fall back to `location.href` so the lock still matches poll keys—**never** key sacred lock off `/qp` alone when a product URL is known (`wmHandleQueueRoom`).

## Error paths (WM-6)

Content scripts call `wmSignalNavFailed(productUrl)` → `WALMART_NAV_FAILED` for **non-queue** failures (PX timeout, missing ATC, checkout SPA stall, etc.). That **re-arms** the poll by releasing `navigationLock` without dropping sacred queue state.

## Sam’s Club contrast (SC-5)

Sam’s Club is **FCFS**: `samsclub-content.js` uses `SAMS_NAV_FAILED` / `ATC_SUCCESS` only. It must **not** send `WALMART_IN_QUEUE` or use `inQueueUrls` for FCFS flows.

## Quick file map

| Area | Primary file |
|------|----------------|
| Queue detection, waits, signals | `target-checkout-helper/walmart-content.js` (`wmHasQueueIndicators`, `wmIsProductQueued`, `wmWaitInProductQueue`, `wmHandleQueueRoom`, …) |
| `inQueueUrls` / `navigationLock`, message handlers | `target-checkout-helper/background.js` |
| Queue-it WebSocket → `TCH_QUEUE_PASSED` | `target-checkout-helper/walmart-main-world.js` |

When debugging, grep for `WALMART_IN_QUEUE`, `WALMART_NAV_FAILED`, `WALMART_QUEUE_TIMEOUT`, and `inQueueUrls` in those files.
