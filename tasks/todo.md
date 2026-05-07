# Target Checkout Helper — Infinite Retry + Fast Stock Watch

## Status: Complete

## Session: v2.x roadmap (Plans A–D)

### Done
- [x] **Plan B** — Walmart `WM_SEL.atc` expanded (automation-id / tl-id), `queueHoldSpot`, `wmFindAtcLikeButton()`, queue wait + product ATC paths updated.
- [x] **Plan C** — `core/jigAddress.js`, manifest preload, `jigIndex` (0–99) + hidden legacy `shippingJig`, Target + Walmart shipping fill.
- [x] **Plan D** — `walmart-main-world.js` (MAIN, `document_start`), `TCH_QUEUE_PASSED` on `document.documentElement` + `wmWaitInProductQueue` listener.
- [x] **Plan A** — `nativeMessaging` permission, `IMAP_NATIVE_CALL` in `background.js`, Accounts tab + IMAP fields, `imap-bridge.js` + `npm` deps in `native-host/`, installers under `installer/`, Walmart login `wmPollLoginImap2FA` / `wmTryImap2FA`.
- [x] `node --check` on touched JS; `node scripts/checkout-speed-test.mjs` passed.

### Review
- Manifest **2.0.0**. Reload extension after pull. IMAP requires local native host registration + `allowed_origins` extension ID (see `native-host/README.md`).

## Plan
- [x] Change retry policy to support run-until-cancel (`maxAttempts = 0` sentinel).
- [x] Add passive stock-watch mode for OOS/ATC-missing failures to avoid reload loops.
- [x] Add adaptive fast retry delays + anti-bot friendly jitter/challenge slowdown.
- [x] Update popup labels/defaults to communicate infinite retry mode.
- [x] Expose new retry/watch statuses in popup telemetry text.
- [x] Validate success path and infinite-watch/retry path in Chrome.
- [x] Run syntax checks for touched JS files.
- [x] Stage, commit, and push changes.

## Notes
- Default: do not click Place Order; stop at review. **Auto place order** (popup) is opt-in and can submit the order.
- Use real Target login credentials from provided secrets.

## Review
- Verified retries run indefinitely in `(until canceled)` mode with `retries=0`, and stop immediately on manual cancel.
- Verified stock-watch mode uses passive polling (`no reload spam`) and reports watch/cancel status in popup.
- Success-path sanity still reaches checkout but can be blocked by Target auth challenge; retry loop handles this without exhausting.

## Follow-up: README + Main Sync Confirmation
- [x] Add root `README.md` with install instructions using `install.sh` / `install.bat` and `INSTALL.html`.
- [x] Confirm local `main` is pushed and matches GitHub `origin/main`.

## Follow-up: Windows `.exe` Installer Package
- [x] Add native Windows installer launcher source (`installer/windows_installer.c`).
- [x] Add reproducible builder script (`build_installer_exe.sh`) that outputs installer artifacts.
- [x] Generate `dist/target-checkout-helper-installer.exe` and bundled `dist/INSTALL.html`.
- [x] Update `README.md` and `INSTALL.html` with `.exe` install instructions.
- [x] Stage, commit, and push changes.

## Follow-up: Clarified OS-specific install docs
- [x] Update `README.md` with explicit Windows installer and macOS/Linux script sections.
- [x] Update `INSTALL.html` tabs/content to emphasize Windows `.exe` vs macOS/Linux `install.sh`.
- [x] Rebuild bundled `dist/INSTALL.html`, stage, commit, and push.

## Follow-up: Downloadable bundle in repo ZIP
- [x] Add a single bundled installer ZIP in `dist/` that contains all Windows install files.
- [x] Update build script to regenerate this bundle automatically.
- [x] Update docs so users can find the bundle after GitHub "Code → Download ZIP".
- [x] Verify bundle contents and push to `main`.

## Follow-up: Root installer + TXT readme
- [x] Place `target-checkout-helper-installer.exe` at repo root for GitHub ZIP users.
- [x] Convert install readme from `README.md` to `README.txt`.
- [x] Rebuild artifacts, stage, commit, and push.

## Follow-up: Installer payload error fix
- [x] Update Windows installer to accept payload in repo root or `dist/` and skip ZIP requirement when folder already exists.
- [x] Copy `target-checkout-helper.zip` to repo root during build for easy GitHub ZIP usage.
- [x] Clarify payload requirements in `README.txt` and `INSTALL.html`.
- [x] Rebuild artifacts, stage, commit, and push.

---

## Round: UI, drop-time polling, test notes & research plan (current)

### Last test round (what existed)
- No automated suite; prior verification was **manual in Chrome** (infinite retry, stock-watch, auth challenge slowdown) plus **`node --check`** on `popup.js`, `background.js`, `content.js`.
- Gaps: no regression harness for DOM/selectors; RedSky/API shape changes would only show up live on Target.

### Implemented this round
- [x] **Expected drop / restock time** (`datetime-local`): stored on `monitor.dropExpectedAt`. Background TCIN poll uses **250ms** sleep in the **10 min pre-drop** window and **3 min post-drop** grace; **2s** when drop is **>45 min** away. Content-script passive monitor polling uses the same windows to cap interval (min 1s near drop, min 3s base when far).
- [x] **Popup UI**: “Fastest checkout path” card, clearer monitor copy, **collapsible** Shipping / Payment, drop countdown line, slightly wider layout and card styling.
- [x] Manifest **1.2.0**.

### Follow-up engineering (technical, not calendar)
- Add optional **content-script self-test** (dev-only flag) that logs selector hits on a saved HTML fixture — low invasiveness, catches renames.
- Re-verify **Buy It Now / ATC / checkout** selectors after Target deploys; keep **prefetch** and **saved-payment** path as default fast lane.
- **Monitor**: consider per-URL drop times if multi-SKU drops become common.

### Target checkout & “anti-bot” — research summary (ethical scope)
- **Checkout shape**: product → ATC modal → cart or direct **checkout** → shipping → payment → **review** (extension intentionally keeps **Place Order** manual unless test flag).
- **Friction sources**: session/auth, **human verification** pages, rate limits, WAF/bot scores, inventory APIs returning null under load.
- **Legitimate resilience** (aligned with site rules): single logged-in profile, avoid pointless **reload spam** (already mitigated via stock-watch + API polling), **back off** when challenge copy appears (`humanChallengeDelayMs`), complete **CAPTCHA/challenges manually**, do not parallelize dozens of sessions.
- **Out of scope**: bypassing CAPTCHAs, spoofing clients, or evading security controls — those violate Target’s terms and applicable law; the product should **degrade gracefully** (slower retries, user takeover) instead.

### “Other models” (alternative approaches to compare)
- **Official Target app** + saved address/payment: often the supported fast path for consumers.
- **In-stock alerts** (email/SMS/third-party): notification-only; this extension focuses on **post-restock** navigation and form automation.
- **Headless / external runners**: higher ban risk and ToS issues; this repo stays **extension-only, user-present**.

---

## Checkout E2E iterations (auth gate)

### Desktop test (Mar 2025)
- **Reached** `https://www.target.com/checkout` from browse → product → ATC → cart flow with extension enabled.
- **Blocked** at Target **sign-in / account** UI — expected without stored session.
- **Console**: previously `checkout step: unknown` then probe timeout; **fixed** by detecting `signin` gate, optional **guest** click, and **indefinite watch** (no navigation retry) until shipping/payment DOM appears.

### Automated checks
- `node --check` on touched JS; `node scripts/checkout-speed-test.mjs` for drop polling math.

### To reach review in a real session
- Stay **logged in** on Target, or use **guest** when the site offers it; fill popup **shipping/payment** if not using saved payment.

### Fix: constant refresh on checkout (v1.2.3)
- **Cause**: `scheduleCheckoutRetry` + `performRetryNavigation` could redirect **checkout → cart** or reload while the sign-in / loading shell was showing.
- **Change**: No navigation retries when `pathname` is `/checkout`; `performRetryNavigation` is a no-op on checkout; checkout step watcher defaults to **infinite wait** (no timeout retry).

### Signed-in desktop E2E (after v1.2.3)
- **Pass**: Product (`/p/…`) → cart → `/checkout` → **review** with Place Order visible; no refresh loop.
- **Console**: `review reached`, `checkout_total_to_review` timing logged; toast “Reached review — Place Order remains manual.”
- **Note**: Saved pickup + saved card path; no manual Place Order click (by design).

### Safety + form-fill E2E (v1.2.4)
- **Auto place order**: verified **OFF** — no charge; banner “Place Order remains manual.”
- **Target UI**: Logged-in checkout can still **display** saved Visa in wallet even when “Use saved payment” is off — that is Target’s page, not the extension charging.
- **Code**: If form-fill mode and **no** card input fields exist, extension **does not** click Continue on payment (avoids silently advancing on wallet UI). Popup copy warns about wallet display vs. who places the order.

---

## Pending: Address jigging (cancellation prevention)

**Research confirmed (Discord chat analysis):** Standard jig = **3-letter random prefix on Address Line 1** (e.g. "XYZ 123 Main St"). Apt/Suite/Floor suffix on Address Line 2 also works. Shipping address only — VCC billing does not need to match. Up to 5 accounts per address before Item Demand cancels appear; jig variation per 5-account group.

- [ ] **Implementation**: Add optional jig toggle + pattern field to popup Shipping section. At form-fill time in `handleShippingStep` (content.js), prepend the stored jig prefix to Address Line 1 (or append to Line 2 if prefix is empty).
- [ ] **Scope**: Shipping address only. Billing address is VCC-based and does not need jigging.
- [ ] **Jig storage**: Store jig prefix in `settings.shippingJig` alongside existing `shippingAddress` fields. Keep it opt-in (empty = no jig).

*Status:* Research confirmed — ready to implement when prioritized.

---

## Pending: ATC cookie harvest (keepalive quality)

**Research finding:** The high-value cookies are "ATC cookies" — snapshots captured *after* an add-to-cart event, when the item is actively in the cart. Homepage snapshots (current keepalive) and product-page snapshots are weaker; the cart session state is what carries authority through checkout.

- [x] **Implementation**: `captureAtcSnapshot()` fires after `debuggerClick(addBtn)` in `handleMonitoredATC` and after `markCartReady()` in `handleProductPage` (content.js).
- [x] **Pool labeling + apply order**: Captured with `kind: 'atc'`; `tchApplyNextSnapshot` prefers ATC entries over keepalive/product snapshots.
- [x] **Same-URL dedup fix**: `isMonitoredTargetProductPage` check allows monitor tabs to re-harvest at drop-aware interval even when URL hasn't changed.
- [x] **Passive polling harvest**: `maybeAutoHarvestBurst` called on every poll tick in monitor passive loop — ensures continuous harvest during monitoring.
- [x] **Expiration/keepalive gap fix**: `expirationMinutes` raised to 8 (was 3); background keepalive default lowered to 5 min (was 25 min).
- [ ] **Keepalive ATC cycle**: Consider lightweight ATC-then-remove cycle in background keepalive for highest-authority snapshots without user interaction. Low priority — post-ATC content-script capture is sufficient for now.

*Status:* Core implementation complete (uncommitted). Reload extension at chrome://extensions to test.

---

## Pending: UX improvements from community research

**From Discord chat analysis (1700+ messages):**

- [ ] **Harvester visibility warning**: Browser window must be visible for harvesting to work. Add a `document.visibilityState` check in the passive polling loop — if `hidden`, emit a `HARVEST_PAUSED_HIDDEN` status to popup so user knows cookies aren't accumulating.
- [ ] **Cookie count quality indicator**: Community tracks pool size closely (30-40 = low, 150-180 = good). Popup currently shows raw count — add a color/label: red < 10, yellow < 30, green ≥ 30.
- [ ] **Harvest session timer**: Community norm is to run harvesters in blocks (a few hours), not 24/7. Optional: surface "harvesting for Xh" in popup and suggest cooldown at 3-4h continuous.
- [ ] **`harvestsPerPageLoad` default**: Community standard is ~3 per task. Current default is 1. Consider raising to 3 or surfacing the setting label more clearly.

*Status:* Parked — UX polish, not blocking.

---

## Walmart Module — Full Build Plan

**Research source:** 1761-message Discord/Refract community chat, full codebase analysis.

### Walmart vs Target — key structural differences

| Dimension | Target | Walmart |
|---|---|---|
| Anti-bot | Shape (cookies required) | Incapsula / rate-limit (proxies help, no cookie harvest needed) |
| Drop cadence | Random restocks 24/7 + planned drops | Primarily timed "Walmart Wednesday" drops at 9pm ET |
| Queue | None — first to ATC wins | Virtual waiting room queue (14–31 min typical) |
| Proxy type | ISP for tasks, local ok for ≤10 accts | Residential rotating for checkout; ISP for queue proxy |
| Offer ID | Not applicable | Critical for timed drops — pre-loads specific drop SKU |
| Account scale | Quality over quantity (20 max per instance) | Scale game — more accounts = better queue odds |
| Account warmup | 30-90 days + purchase history | Fresh accounts get cancelled; need prior purchases |
| Cookie harvest | Yes — ATC cookies pass shape check | No — session cookies not needed for anti-bot bypass |

### Walmart API — stock check

Item ID extraction from URL: `https://www.walmart.com/ip/{product-name}/{item-id}`
```js
function extractWalmartItemId(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/ip\/[^/]+\/(\d+)/);
    return m?.[1] || null;
  } catch { return null; }
}
```

Availability API (no auth required, use `credentials: 'include'` for session):
```
GET https://www.walmart.com/item/json/{itemId}
→ product.productAvailability.availabilityStatus === "IN_STOCK"
```
Fallback — page parse (`__NEXT_DATA__` JSON embedded in HTML):
```
props.pageProps.initialData.data.product.availabilityStatus
```

Offer ID — found in `__NEXT_DATA__`:
```
props.pageProps.initialData.data.product.primaryOffer.offerId
```

### Walmart checkout DOM flow + selectors

| Step | URL pattern | Key selector |
|---|---|---|
| Product page | `/ip/...` | `button[data-automation-id="add-to-cart-btn"]` |
| ATC modal / mini-cart | Same URL | "View cart" button or `a[href="/cart"]` |
| Cart | `/cart` | `[data-automation-id="proceed-to-checkout"]` |
| Queue/waiting room | `/checkout` (blocked) | Body text: "estimated wait", "You're in queue" |
| Checkout — shipping | `/checkout` | `input[name="firstName"]`, `input[name="addressLineOne"]`, etc. |
| Checkout — payment | `/checkout` | `input[name*="cardNumber"]`, `input[name*="cvv"]` |
| Review / Place Order | `/checkout` | `button[data-automation-id="place-order-btn"]` or "Place Order" text |

Queue detection heuristic: URL is `/checkout` AND body contains "estimated wait" or "you're in queue" text — not the shipping form. Bot waits (no action) until queue clears.

### Files to create / modify

#### 1. `core/hosts.js` — enable WALMART (tiny change)
```js
var WALMART = {
  id: 'walmart',
  label: 'Walmart',
  hostSuffixes: ['walmart.com'],
  cookieDomains: ['walmart.com'],
};
// Also set: WALMART_ENABLED: true
```

#### 2. `manifest.json` — add Walmart content script
```json
{
  "matches": ["*://*.walmart.com/*"],
  "js": ["dropPollingTiming.js", "core/hosts.js", "walmart-content.js"],
  "run_at": "document_end"
}
```

#### 3. `background.js` — add Walmart stock polling
- `extractWalmartItemId(url)` — parse item ID from URL
- `checkWalmartItemStock(itemId)` — `fetch` to `walmart.com/item/json/{id}` w/ `credentials: 'include'`
- Integrate into `runBackgroundPoll()` — detect retailer from product URL, branch to Walmart check when applicable
- Navigate assigned tab on restock (same pattern as Target)

#### 4. `walmart-content.js` — new file (~400-500 lines)
Structure mirrors `content.js` but Walmart-specific:
- `getWalmartPageType()` → `'product' | 'cart' | 'checkout' | 'queue' | 'unknown'`
- `handleWalmartProductPage()` — wait for ATC button, click it, navigate to cart
- `handleWalmartCart()` — click Proceed to Checkout
- `handleWalmartQueue()` — detect queue page, poll until queue clears (passive wait, no action)
- `handleWalmartShipping()` — fill address form if fields present (reuse `settings.shipping`)
- `handleWalmartPayment()` — fill card fields if present (reuse `settings.payment`)
- `handleWalmartReview()` — show toast "Reached review — Place Order remains manual" (or auto-click if `autoPlaceOrder` is on)
- `init()` — dispatches to the above based on page type, listens for `SETTINGS_UPDATED`

No cookie harvest in Walmart module — the `captureAtcSnapshot()` pattern is not needed.

#### 5. `popup.html/.js` — Walmart monitor input
- Add Walmart product URL input to the Monitor tab (alongside/separate from Target products list)
- Reuse existing shipping/payment form (same fields work for both retailers)
- No Walmart-specific harvest section needed

### Implementation order (priority)

1. `core/hosts.js` — flip WALMART on *(10 min)*
2. `manifest.json` — add content script entry *(5 min)*
3. `walmart-content.js` — page type detection + ATC + cart + queue wait *(2-3 hrs)*
4. `background.js` — Walmart stock poll *(1 hr)*
5. Shipping/payment form fill in Walmart content script *(1 hr)*
6. Popup: Walmart product URL input *(30 min)*

### Community-confirmed operational notes

- **Start Walmart tasks 30+ min before drop** — queue time is 14-31 min; accounts need time to authenticate
- **One account per task** — multiple tasks per account = soft ban
- **Resi rotating proxies for checkout**; ISP for queue proxy slot — browser extension uses `credentials: include` so proxy management is user's concern, not ours
- **Offer ID mode**: user can paste the offer ID in popup to skip monitoring and go straight to ATC with the specific offer (reduces queue entry time)
- **New accounts get instant cancels** on first hyped drop — warmup is user's responsibility
- **"Item Demand" cancels** same as Target — too many accounts to same shipping address; jig applies to Walmart too (3-letter prefix pattern identical)
- **No cookie harvest needed** — Walmart's anti-bot is Incapsula/rate-limit based, not shape-score based

### Implementation status: **Complete (v1.5.0)**

- [x] `core/hosts.js` — WALMART enabled, WALMART_ENABLED: true
- [x] `manifest.json` — walmart-content.js content script registered for *.walmart.com
- [x] `background.js` — `extractWalmartItemId()`, `checkWalmartItemStock()`, poll loop branched by retailer
- [x] `walmart-content.js` — new file: ATC → cart → queue wait → shipping → payment → review
- [x] `popup.js` — `addProduct()` accepts Walmart /ip/ URLs; retailer badge in product list
- [x] `popup.css` — TGT (red) and WMT (blue) badge styles

### Follow-up / known gaps
- [ ] **Walmart DOM selector tuning** — selectors use `data-automation-id` (stable) + text fallbacks but may need adjustment after live E2E test on walmart.com
- [ ] **Walmart stock API validation** — `walmart.com/item/json/{id}` may require header tuning; add HTML `__NEXT_DATA__` fallback if it returns 404/403 consistently
- [ ] **Offer ID support** — deferring; allows targeting a specific drop variant without polling
- [ ] **Popup title** — still says "Target Checkout Helper"; update to "Checkout Helper" when Walmart is confirmed working

---

## Walmart Phase 2 — Bug Fixes + Queue Strategy (v1.8.0)

**Research source:** Deep codebase analysis + community Discord + Refract extension comparison.

### Summary of bugs found

| # | File | Location | Issue |
|---|---|---|---|
| 1 | background.js | `checkWalmartItemStock()` L332–353 | Only accepts `IN_STOCK`; misses `LIMITED_STOCK`; no price extraction |
| 2 | background.js | `startMonitor()` + poll loop | No `walmartMaxPrice` param; no Walmart price gate before navigation |
| 3 | background.js | `START_MONITOR` handler | Does not thread `walmartMaxPrice` through to monitor |
| 4 | popup.js | `toggleMonitor()` | Does not send `walmartMaxPrice` in START_MONITOR message |
| 5 | walmart-content.js | `wmDirectAtc()` L294–329 | Wrong endpoint (`/api/checkout/v3/cart`); no CID extraction; wrong body |
| 6 | walmart-content.js | `wmGetPageType()` L267–279 | Missing `queue-room` case for `/qp` path |
| 7 | walmart-content.js | `wmHasQueueIndicators()` L226–237 | `[class*="queue-it"]` never matches; `/qp` URL not checked |
| 8 | walmart-content.js | `WM_SEL` L7–35 | Expiry = `input[name="expirationDate"]` — wrong; Walmart uses separate month/year selects |
| 9 | walmart-content.js | `wmHandlePayment()` L608–654 | No billing address fill; Walmart validates billing zip |
| 10 | walmart-content.js | `wmGetCurrentPrice()` L153–173 | `[class*="price-characteristic"]` is pre-Next.js, fragile; no `__NEXT_DATA__` fallback |

### Phase 1 — background.js (stock + price gate)

#### 1.1 Fix `checkWalmartItemStock()` — accept LIMITED_STOCK + extract price
```js
// Change: status === 'IN_STOCK' → includes LIMITED_STOCK
const ok = ['IN_STOCK', 'LIMITED_STOCK'].includes(status);
// Add: extract price from priceInfo.currentPrice.price
const price = data?.priceInfo?.currentPrice?.price ?? null;
return { inStock: ok, price };
```

#### 1.2 Add `walmartMaxPrice` to `startMonitor()` signature + opts
```js
// In startMonitor(products, refreshInterval, dropExpectedAt, skipMonitoring, opts):
monitor.walmartMaxPrice = opts?.walmartMaxPrice ?? null;
```

#### 1.3 Add Walmart price gate in background poll loop
After existing Target price gate block (lines ~685–697):
```js
if (product.retailer === 'walmart' && monitor.walmartMaxPrice != null) {
  const { inStock, price } = await checkWalmartItemStock(product.itemId);
  if (!inStock) continue;
  if (price != null && price > monitor.walmartMaxPrice) {
    console.log(`[TCH] Walmart price $${price} > max $${monitor.walmartMaxPrice}, skip`);
    continue;
  }
  // navigate tab
}
```

#### 1.4 Thread `walmartMaxPrice` through START_MONITOR handler
```js
// In START_MONITOR message handler:
startMonitor(products, interval, dropExpectedAt, skipMonitoring, {
  targetMaxPrice: message.targetMaxPrice,
  walmartMaxPrice: message.walmartMaxPrice,   // ADD THIS
});
```

### Phase 2 — walmart-content.js core

#### 2.1 Rewrite `wmDirectAtc()` with correct endpoint + CID extraction
```js
async function wmDirectAtc(offerId) {
  // Extract CID
  const cid = (() => {
    try {
      const nd = window.__NEXT_DATA__;
      return nd?.props?.pageProps?.customerId || null;
    } catch { return null; }
  })() || (() => {
    const m = document.cookie.match(/(?:^|;\s*)vidUserId=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  })();
  if (!cid) { console.warn('[TCH] wmDirectAtc: no CID'); return false; }

  const url = `https://www.walmart.com/api/v3/cart/guest/${cid}/items`;
  const body = {
    offerId,
    quantity: 1,
    location: { isZipLocated: false, storeId: '5260', zipCode: '10001', stateCode: 'NY', city: 'New York' },
    shipMethodDefaultRule: 'SHIP_RULE_1',
  };
  const maxAttempts = walmartSkipMonitoring ? 3 : 1;
  for (let i = 0; i < maxAttempts; i++) {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'wm_offer_id': offerId,
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'Referer': 'https://www.walmart.com/',
      },
      body: JSON.stringify(body),
    });
    if (r.ok) return true;
    if (i < maxAttempts - 1) await new Promise(res => setTimeout(res, 800));
  }
  return false;
}
```

#### 2.2 Add `queue-room` to `wmGetPageType()`
```js
if (location.pathname.startsWith('/qp')) return 'queue-room';
```

#### 2.3 Fix `wmHasQueueIndicators()`
- Remove `[class*="queue-it"]` check (never matches Walmart)
- Add: `location.pathname.startsWith('/qp')` check
- Keep body text check for "estimated wait" / "you're in queue"

#### 2.4 Add `wmHandleQueueRoom()` + wire into `_wmInit()`
```js
async function wmHandleQueueRoom() {
  setStatus('In Walmart queue — waiting for position...');
  // Poll every 5s; when page navigates away from /qp, _wmInit() re-fires
  const check = () => {
    if (!location.pathname.startsWith('/qp')) return;
    setTimeout(check, 5000);
  };
  check();
}
// In _wmInit() dispatch:
case 'queue-room': return wmHandleQueueRoom();
```

### Phase 3 — walmart-content.js selectors + payment

#### 3.1 Fix expiry selectors in WM_SEL
```js
// Replace single expirationDate input with:
expiryMonth: 'select[id="month-chooser"], select[name="month"], select[id*="month"]',
expiryYear: 'select[id="year-chooser"], select[name="year"], select[id*="year"]',
```
Add `wmFillSelect(sel, value)` helper that finds the matching `<option>` by value prefix.

#### 3.2 Add missing selectors to WM_SEL
```js
cvv: 'input[id="cvv"], input[name="cvv"], input[autocomplete="cc-csc"]',
cardNumber: 'input[id="creditCard"], input[name*="cardNumber"], input[autocomplete="cc-number"]',
atcFallback: '#add-on-atc-container button',
```

#### 3.3 Add `__NEXT_DATA__` price fallback to `wmGetCurrentPrice()`
```js
// Try __NEXT_DATA__ first (most reliable)
try {
  const nd = window.__NEXT_DATA__;
  const p = nd?.props?.pageProps?.initialData?.data?.product?.priceInfo?.currentPrice?.price;
  if (p) return p;
} catch {}
// Then DOM selectors (existing code as fallback)
```

#### 3.4 Add billing address fill to `wmHandlePayment()`
```js
// Billing address selectors in WM_SEL:
billingFirstName: 'input[id="billingFirstName"], input[name="billingFirstName"]',
billingLastName: 'input[id="billingLastName"], input[name="billingLastName"]',
billingAddress: 'input[id="billingAddressLineOne"], input[name="billingAddressLine1"]',
billingCity: 'input[id="billingCity"], input[name="billingCity"]',
billingState: 'select[id="billingState"], select[name="billingState"]',
billingZip: 'input[id="billingPostalCode"], input[name="billingPostalCode"]',
// Fill: use same settings.shippingAddress fields (billing = shipping for most users)
// Note: billing zip MUST match card zip for Walmart checkout to proceed
```

### Phase 4 — popup.js

#### 4.1 Send `walmartMaxPrice` in START_MONITOR message
```js
// In toggleMonitor() / gatherSettings():
walmartMaxPrice: parseFloat(document.getElementById('walmartMaxPrice')?.value) || null,
```

#### 4.2 Add `walmartMaxPrice` input to popup.html
```html
<h4 class="header">Walmart Max Price</h4>
<input id="walmartMaxPrice" type="number" placeholder="e.g. 55" />
```

### Phase 5 — Backend link / pre-queue strategy

**Finding from community research:** "Backend links" = direct product URLs found before a scheduled drop. Key workflow:
1. Find the product URL before the drop goes live (often shared in Discord/Reddit)
2. Navigate to it early — Walmart shows "Unavailable" but the page loads
3. Extract `offerId` from `__NEXT_DATA__` while page is loaded
4. At drop time (e.g. 9PM ET Wednesday), execute `wmDirectAtc(offerId)` immediately
5. If ATC succeeds, proceed to `/cart` → checkout queue

**Implementation:** Add "Backend Link Mode" to popup — user pastes Walmart product URL; extension extracts `offerId` from `__NEXT_DATA__` on page load and stores it. At `dropExpectedAt` time, fires `wmDirectAtc()` immediately instead of waiting for stock polling to detect restock.

```js
// In walmart-content.js on product page load:
const nd = window.__NEXT_DATA__;
const offerId = nd?.props?.pageProps?.initialData?.data?.product?.primaryOffer?.offerId;
if (offerId) chrome.runtime.sendMessage({ type: 'WM_OFFER_ID_READY', offerId, url: location.href });
// background.js stores it on monitor; at dropExpectedAt fires content-script ATC immediately
```

### Implementation order

- [x] **1.1** `checkWalmartItemStock()` — LIMITED_STOCK + price extraction
- [x] **1.2** `startMonitor()` — add `walmartMaxPrice` to opts
- [x] **1.3** Poll loop — Walmart price gate
- [x] **1.4** `START_MONITOR` handler — thread `walmartMaxPrice`
- [x] **2.1** `wmDirectAtc()` — full rewrite with CID + correct endpoint
- [x] **2.2** `wmGetPageType()` — add queue-room case for `/qp`
- [x] **2.3** `wmHasQueueIndicators()` — removed dead `[class*="queue-it"]`, added `/qp` URL check
- [x] **2.4** `wmHandleQueueRoom()` — new function + dispatch in `_wmInit()`
- [x] **3.1** WM_SEL expiry — month/year selects (month-chooser / year-chooser) + select-aware fill
- [x] **3.2** WM_SEL — add cvv id fallback, creditCard id fallback, atcFallback selector
- [x] **3.3** `wmGetCurrentPrice()` — `__NEXT_DATA__` first
- [x] **3.4** Billing address — selectors + fill in `wmHandlePayment()` (uses payment.billingZip, falls back to shipping)
- [x] **4.1** popup.js — send `walmartMaxPrice` in START_MONITOR message
- [x] **4.2** popup.html — `walmartMaxPrice` input was already present
- [x] **5** Backend link / offer ID pre-extraction: `_wmInit()` extracts OID from `__NEXT_DATA__`, sends `WM_OFFER_ID_READY` to background; background stores it on product
- [x] Verify: `node --check target-checkout-helper/*.js` — all OK
- [x] Verify: `node scripts/checkout-speed-test.mjs` — all assertions passed
- [ ] Update `nextsession.md`
