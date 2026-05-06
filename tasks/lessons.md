# Lessons learned

## Don't gate independent features on the master toggle without checking precedent

**Mistake (twice):** When adding a recurring harvest tick, I gated it on
`runtimeEnabled` (the master "extension on/off" flag). But the existing page-load
harvest path runs *before* the `!data.enabled` early-return inside `init()`,
meaning the codebase already treats harvesting as **independent of the master
toggle**. My gate broke pool-building for users with the extension off.

**Rule for next time:**
- Before adding a guard on a global flag like `runtimeEnabled`, grep for how
  the *existing* code paths treat the same feature — match the precedent.
- "Sub-feature off" and "master extension off" are not interchangeable; users
  intentionally use them as orthogonal switches.
- A reconciliation step on `SETTINGS_UPDATED` that runs *before* the
  `!runtimeEnabled` early-return is the safest way to keep independent
  sub-features in sync regardless of master state.

## Filter scopes should match the user's explicit opt-in

**Mistake:** `maybeAutoHarvestBurst` rejected every URL that wasn't a `/p/`
product or login/account path. With "Don't stop harvesting" on, that filter
silently fights the user's stated intent — they can sit on the Target homepage
or cart for an hour and never get a single capture.

**Rule for next time:**
- When a user toggles an explicit "do this continuously" preference, broaden
  passive filters to match. If the cookies/session are origin-scoped, the
  source page typically doesn't matter for pool quality.
- Mention the URL-filter expansion in user-facing diagnostics so the help text
  matches the real behavior ("any open Target tab will capture").

## Walmart API: always verify endpoints against actual browser network traffic

**Mistake:** `wmDirectAtc()` was written with two wrong endpoints (`/api/checkout/v3/cart` and `/api/checkout/v3/cart/items`) — neither matches what Walmart's frontend actually calls. The real endpoint is `POST /api/v3/cart/guest/{CID}/items` where CID must be extracted from `__NEXT_DATA__.props.pageProps.customerId` or the `vidUserId` cookie.

**Rule for next time:**
- For any retailer API call, verify the endpoint by inspecting actual browser XHR in DevTools before coding it. Don't guess from pattern-matching similar paths.
- The customer/guest ID is always required for Walmart cart calls — check `__NEXT_DATA__` first (most reliable, embedded in HTML), fall back to cookie parsing.
- Include `sec-fetch-site`, `sec-fetch-mode`, `sec-fetch-dest` headers on direct API calls — Walmart's WAF checks these to distinguish XHR from navigation.

## Walmart stock: `LIMITED_STOCK` is a valid sellable status

**Mistake:** `checkWalmartItemStock()` only accepted `status === 'IN_STOCK'`, missing `LIMITED_STOCK` which is common during drops when inventory is constrained. Background already had `SELLABLE_STATUSES` set (with LIMITED_STOCK) but the function didn't use it.

**Rule for next time:**
- Before writing a new status check, grep for existing status constants in the file. Reuse them.
- `LIMITED_STOCK` = item is live but low quantity. It's the most important status to catch on drops — excluding it means the bot misses the restock entirely.

## Queue-it `/qp` page type must be detected by URL, not DOM

**Mistake:** `wmHasQueueIndicators()` tried `[class*="queue-it"]` to detect Walmart's waiting room — this selector never matches because Walmart runs a white-labeled Queue-it under their own subdomain. The `/qp` path is the reliable signal.

**Rule for next time:**
- For Walmart's waiting room: check `location.pathname.startsWith('/qp')` first, before any DOM inspection. URL is authoritative; class names are opaque implementation details.
- Add new page types to `wmGetPageType()` explicitly — `'unknown'` return means the handler silently does nothing, which is hard to debug.

## Tab-visibility tracking in MV3 extensions

**Mistake:** Treated `harvestHiddenTabs.size > 0` as "the user can't see Target." This lit
up the warning whenever *any* Target tab in the set was hidden — including stale entries
from closed tabs and any non-active sibling tab in the same window — even when the user
clearly had a visible Target tab in the foreground.

**Rule for next time:**
- A "tab is hidden" set must be **reconciled to currently-open tabs** (clean up on
  `chrome.tabs.onRemoved`) and the user-visible meaning must be **"every relevant tab is
  hidden,"** not "any tab ever was hidden."
- `visibilitychange` only fires on **transitions**, never on initial load. If you need to
  know visibility for newly-loaded tabs, send the initial state from the content script
  on injection.
- Chrome only throttles timers when **all** of an origin's foreground views are hidden,
  so the warning semantics should match that physics.
