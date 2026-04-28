# N E M E S I S — Verified Findings

## Scope

- **Language / runtime:** Vanilla JS, Chrome MV3 (`target-checkout-helper/`).
- **Modules:** `content.js` (tab automation + stock checks), `background.js` (monitor poll + telemetry), `popup.js` (settings), `main_world.js` (API key bridge), `dropPollingTiming.js` (shared poll intervals).
- **Coupled state pairs audited:** `chrome.storage.monitor.counts` ↔ tab navigation success; **fulfillment JSON** ↔ `{background parseFulfillmentBlock}` vs `{content parseFulfillmentStockStatus}`; **`CART_READY` session flag** ↔ actual cart contents; **`ATC_SUCCESS` message** ↔ completed add-to-cart.
- **Loop iterations:** Single nemesis cross-feed (Feynman-style ordering + state-gap overlay); suspects verified by direct code trace. Intermediate passes collapsed here per repo size.

## Nemesis Map (abbreviated)

| State A | State B | Writers | Gap signal |
|---------|---------|---------|------------|
| Fulfillment `sellable` | Fulfillment `soldOut` | Both parsers | Background requires `!soldOut` for `true`; content returns `true` on `sellable` alone |
| `tch:cartReady` | Cart actually contains SKU | `markCartReady` vs Target network | Flag set on click, not on confirmed cart response |
| `monitor.counts[normUrl]` | Real ATC success | `ATC_SUCCESS` from content | BIN path fires message before navigation/checkout completes |
| Telemetry `totalFailures` | User-perceived “failures” | `recordCheckoutRetryEvent` | `scheduled` and `watching` each increment counter |

## Verification Summary

| ID | Coupled pair | Severity | Verdict |
|----|--------------|----------|---------|
| NM-001 | Parsed fulfillment `sellable` ↔ `soldOut` | **High** | **True positive** — logic divergence with same API family |
| NM-002 | `CART_READY` ↔ cart truth | **Medium** | **True positive** — comment and retry routing contradict guarantee |
| NM-003 | `ATC_SUCCESS` ↔ ATC completed | **Medium** | **True positive** — premature success signal on monitor BIN |
| NM-004 | `totalFailures` ↔ retry episodes | **Low** | **True positive** — metric over-counts multi-status flows |

---

## Verified Findings (TRUE POSITIVES only)

### Finding NM-001: Fulfillment stock parsers disagree on `soldOut`

**Severity:** HIGH  
**Source:** State inconsistency (dual writers, single conceptual invariant: “in stock for automation purposes”)  
**Coupled pair:** `fulfillment.sold_out` ↔ `sellable` (status / ATP qty)  
**Invariant:** If `sold_out === true`, automation must not treat the line as purchasable in either worker or tab.  
**Breaking operation:** `parseFulfillmentStockStatus()` returns `result: true` whenever `sellable` is true, **without** requiring `!soldOut`. `parseFulfillmentBlock()` returns `true` only when `sellable && !soldOut`.  
**Trigger sequence:** API returns contradictory flags (e.g. `sold_out: true` with a sellable-looking `availability_status` / edge payload).  
**Consequence:** Background poll may **skip** navigating a monitor tab (`inStock !== true`) while `checkStockFromFulfillmentApi` in the tab returns **in stock** (or the reverse if ordering inverted), causing **missed restock** or **inconsistent** stock watch vs background.  
**Fix:** Align `parseFulfillmentStockStatus` with `parseFulfillmentBlock`: gate `result: true` on `sellable && !soldOut` (or extract one shared function in a small shared module imported by both contexts if you introduce a build-free shared file, e.g. duplicate the identical predicate in both files per project “no build” constraint).

**Evidence:**

```39:50:c:\Users\daroo\Desktop\BEATBOTS\target-checkout-helper\background.js
function parseFulfillmentBlock(fulfillment) {
  if (!fulfillment || typeof fulfillment !== 'object') return null;
  const shipping = fulfillment.shipping_options || {};
  const status = String(shipping.availability_status || '').toUpperCase();
  const qty = Number(shipping.available_to_promise_quantity) || 0;
  const soldOut = fulfillment.sold_out === true;
  const oosAll  = fulfillment.is_out_of_stock_in_all_store_locations === true;
  const sellable = qty > 0 || SELLABLE_STATUSES.has(status);
  const blocked  = soldOut || BLOCKED_RE.test(status) || (oosAll && qty <= 0 && !sellable);
  if (sellable && !soldOut) return true;
  if (blocked) return false;
  return null;
}
```

```1254:1264:c:\Users\daroo\Desktop\BEATBOTS\target-checkout-helper\content.js
  const sellable = qty > 0 || FULFILLMENT_SELLABLE_STATUSES.has(status);
  const blocked = soldOut
    || FULFILLMENT_BLOCKED_RE.test(status)
    || (oosAllStores && qty <= 0 && !sellable);

  if (sellable) {
    return { result: true, status, qty, soldOut, oosAllStores };
  }
  if (blocked) {
    return { result: false, status, qty, soldOut, oosAllStores };
  }
```

---

### Finding NM-002: `CART_READY` set on ATC click, not on confirmed add-to-cart

**Severity:** MEDIUM  
**Source:** Feynman ordering (“what if click does not commit?”) + state gap  
**Coupled pair:** `sessionStorage` `tch:cartReady` ↔ server-side cart  
**Invariant:** Retry navigation that assumes an item is in cart must only run when cart actually contains the item.  
**Breaking operation:** `markCartReady()` immediately after `addBtn.click()` on the main product path.  
**Trigger sequence:** Click dispatched; modal error, network failure, or soft OOS after click leaves cart empty; `performRetryNavigation()` then prefers `/cart` because `isCartReady()` is true.  
**Consequence:** User/extension can **land on an empty or wrong cart** and burn retry budget / time on checkout paths that do not match intent.  
**Fix:** Set `markCartReady()` only after the same confirmations used elsewhere (e.g. modal “view cart” success, cart badge update, or a lightweight cart API confirmation), or clear the flag on the next `init` if PDP still shows no “in cart” state.

**Evidence:**

```176:176:c:\Users\daroo\Desktop\BEATBOTS\target-checkout-helper\content.js
const CART_READY_KEY = 'tch:cartReady'; // set after ATC succeeds; cleared on checkout success
```

```779:782:c:\Users\daroo\Desktop\BEATBOTS\target-checkout-helper\content.js
  console.log('[TCH] clicking ATC');
  addBtn.click();

  markCartReady(); // ATC was clicked — cart should now have this item
```

```329:335:c:\Users\daroo\Desktop\BEATBOTS\target-checkout-helper\content.js
  if (isCartReady()) {
    markRetryNavigation('https://www.target.com/cart');
    window.location.href = 'https://www.target.com/cart';
    return;
  }
```

---

### Finding NM-003: Monitor mode sends `ATC_SUCCESS` before Buy It Now completes

**Severity:** MEDIUM  
**Source:** State/message ordering  
**Coupled pair:** `monitor.counts` (background) ↔ real checkout progress  
**Invariant:** Increment successful ATC count only after the action that actually adds the line to cart (or equivalent) completes.  
**Breaking operation:** `chrome.runtime.sendMessage({ type: 'ATC_SUCCESS', url: normUrl })` runs immediately after `buyNowBtn.click()` with no confirmation.  
**Trigger sequence:** BIN click fails or bounces to an error shell; background still increments count and may reload tab or declare batch done incorrectly relative to true inventory secured.  
**Consequence:** **Monitor quota / completion state** can desync from reality; early `allDone` or wrong reload cadence.  
**Fix:** Defer `ATC_SUCCESS` until the same signals used for normal ATC (navigation to checkout with expected step, cart confirmation, or explicit failure timeout with rollback).

**Evidence:**

```1368:1381:c:\Users\daroo\Desktop\BEATBOTS\target-checkout-helper\content.js
  if (settings.useSavedPayment) {
    const buyNowBtn = findFirst(SEL.buyNow) || findByText('buy it now');
    if (buyNowBtn && !buyNowBtn.disabled) {
      console.log('[TCH] monitor: clicking Buy It Now (saved payment mode)');
      markCheckoutStart('saved');
      buyNowBtn.click();
      showToast('Monitor: Buy It Now → checkout…');
      setNavigationMark('product_to_checkout');
      // Buy It Now routes directly to checkout; ATC_SUCCESS will be implied
      // once checkout completes, so send it now to let the background update counts.
      chrome.runtime.sendMessage({ type: 'ATC_SUCCESS', url: normUrl });
      return;
    }
  }
```

---

### Finding NM-004: Checkout telemetry `totalFailures` increments per event, not per failure episode

**Severity:** LOW  
**Source:** State accounting / naming  
**Coupled pair:** `telemetry.totalFailures` ↔ semantic “failure”  
**Invariant:** A counter named `totalFailures` should reflect distinct failures or user-visible failure episodes, not every internal state transition.  
**Breaking operation:** `recordCheckoutRetryEvent` adds 1 to `totalFailures` for **each** `scheduled` **and** `watching` event.  
**Trigger sequence:** Stock-watch flow emits `scheduled` then `watching` (or multiple `scheduled`); popup aggregates look inflated.  
**Consequence:** **Misleading telemetry** for debugging or user trust (not a direct money bug).  
**Fix:** Increment once per episode, rename field to `retryEventsTotal`, or only count `exhausted` / terminal errors.

**Evidence:**

```274:277:c:\Users\daroo\Desktop\BEATBOTS\target-checkout-helper\background.js
  if (compactEvent.status === 'scheduled' || compactEvent.status === 'watching') {
    telemetry.failedAttemptsCurrentRun = compactEvent.attempt;
    telemetry.totalFailures = (telemetry.totalFailures || 0) + 1;
```

---

## False Positives Eliminated

- **Generic “wrong Continue button”:** Possible in theory (`findContinueButton` matches broad text), but no DOM trace or repro in-repo; left out of verified set.
- **`WEAK_IN_STOCK` returns false:** Comment/code tension is conservative (avoids false **in** stock); not proven user-visible bug without Target HTML fixtures—**not elevated** to verified finding.

## Downgraded Findings

- None pending lab reproduction; NM-004 kept as LOW by severity rubric (telemetry only).

## Summary

Four **verified** issues: **one HIGH** parser mismatch between `background.js` and `content.js` on fulfillment, **two MEDIUM** lifecycle/order bugs (`CART_READY`, premature `ATC_SUCCESS` on BIN), **one LOW** telemetry counter semantics. External research is synthesized in `research_target_checkout_bots/report.md` (policy ambiguity, architectural alignment with common extension/bot-detection surfaces, weak public primary signal on Target-specific bots).

## Verification method

- **NM-001–004:** Static code trace + invariant comparison (no conflicting mitigating branch found).
- **Tests:** `node --check` on all extension JS; `node scripts/checkout-speed-test.mjs` — all passed (drop polling only; does not cover Target DOM).
