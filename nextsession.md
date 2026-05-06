# Next session handoff

## Purpose

Read after `AGENTS.md`. Continuity for agents without long chat history.

## What this repository is

**Target Checkout Helper** — Chrome MV3 extension in `target-checkout-helper/`. No build step. Manifest **v1.7.0** (Discord webhook, endless mode after checkout success, high-stock gate).

## Architecture

| Subsystem | Path |
|-----------|------|
| Background | `target-checkout-helper/background.js` |
| Content + checkout flow | `target-checkout-helper/content.js` |
| Drop-window math + harvest intervals | `target-checkout-helper/dropPollingTiming.js` (`getDropAwarePollSeconds`, `isInDropTensionWindow`, `getHarvestKeepaliveMinIntervalMs`, `getHarvestBurstSameUrlDedupMs`) |
| Popup | `target-checkout-helper/popup.html`, `popup.js`, `popup.css` |
| Main world bridge | `target-checkout-helper/main_world.js` |
| Cookie pool | `target-checkout-helper/cookieHarvest.js` (imported by SW) |

## Recent session (v1.8.0 — Walmart Phase 2 bug fixes + queue strategy)

### Bugs fixed

1. **`checkWalmartItemStock()` (background.js L332–353)** — Now accepts `LIMITED_STOCK` via `SELLABLE_STATUSES.has(status)` (was `=== 'IN_STOCK'` only). Extracts `priceInfo.currentPrice.price` and returns it in the result object.
2. **`wmDirectAtc()` (walmart-content.js L294+)** — Full rewrite. Old code hit wrong endpoints (`/api/checkout/v3/cart`). New code: extracts CID from `__NEXT_DATA__.props.pageProps.customerId` or `vidUserId` cookie; calls `POST /api/v3/cart/guest/{CID}/items` with correct body (location block, `shipMethodDefaultRule: 'SHIP_RULE_1'`); adds `wm_offer_id`, `sec-fetch-*`, `Referer` headers; 3 attempts if `walmartSkipMonitoring`, 1 otherwise.
3. **`wmGetPageType()` (walmart-content.js)** — Added `queue-room` return for `/qp` path.
4. **`wmHasQueueIndicators()` (walmart-content.js)** — Removed dead `[class*="queue-it"]` selector; added `/qp` URL check as primary signal.
5. **`wmHandleQueueRoom()` (walmart-content.js)** — New function for `/qp` waiting room page; passive 5s poll, sends `WALMART_IN_QUEUE` lock to background, 45-min timeout. Wired into `_wmInit()` dispatch.
6. **WM_SEL (walmart-content.js)** — `expMonth` now includes `select[id="month-chooser"]`; `expYear` includes `select[id="year-chooser"]`; added `input[id="cvv"]`, `input[id="creditCard"]`, `atcFallback: '#add-on-atc-container button'`; added billing address selector set.
7. **`wmHandlePayment()` (walmart-content.js)** — Month/year fill now detects SELECT vs INPUT and uses `wmFillSelect` for dropdown elements; handles 2-digit/4-digit year normalization; fills billing address fields (uses `payment.billingZip`, falls back to shipping fields).
8. **`wmGetCurrentPrice()` (walmart-content.js)** — `__NEXT_DATA__.props.pageProps.initialData.data.product.priceInfo.currentPrice.price` checked first before DOM selectors.
9. **`walmartMaxPrice` gate (background.js)** — Threaded through `startMonitor()` opts, `START_MONITOR` handler, and poll loop. Walmart products (non-TCIN) now have a price gate that blocks navigation when `stockMap` price > max.
10. **popup.js** — `toggleMonitor()` now sends `walmartMaxPrice` in `START_MONITOR` message.

### Features added

11. **Backend-link / OID pre-extraction** — `_wmInit()` on product page extracts `primaryOffer.offerId` from `__NEXT_DATA__` and sends `WM_OFFER_ID_READY` to background. Background stores it on the matching product in monitor storage. On next dispatch, `wmHandleProductPage` uses it directly without polling delay — enables zero-latency ATC at `dropExpectedAt`.
12. **`WM_OFFER_ID_READY` handler (background.js)** — Updates `monitor.products[i].oid` in storage when content script reports OID from page.

### Confirmed from Refract guide research

- OID + Skip Monitoring = non-queue drops / blocked monitor only (not needed for queue drops)
- Queue timers (29:59, 9:59) are Walmart placeholder values — our passive wait correctly ignores them
- Multi-SKU doesn't work with Walmart queue — one tab per product is correct behavior
- 456 errors = proxy issue (proxy rotation is user's responsibility; our `wmIsPxPage()` passive wait is correct response)
- `walmartMaxPrice` = item price before tax/shipping

## Recent session (v1.6.0 — RefractBot parity batch)

### Features added (10)

1. **`harvestPerLoad` default → 3** — popup.html default value, matches community standard.
2. **Cookie pool color indicator** — `refreshHarvestStatus()` adds `harvest-count-low/mid/ok` classes (red <10, orange <30, green ≥30).
3. **Visibility warning** — `visibilitychange` listener in content.js → `HARVEST_VISIBILITY_CHANGE` in background.js → `harvestHidden` flag in `HARVEST_GET_STATUS` → `#harvestHiddenWarn` shown in popup.
4. **Address jig** — `shippingJig` input in Shipping tab; prepended to address line 1 in both `handleShippingStep()` (content.js) and `wmHandleShipping()` (walmart-content.js).
5. **Walmart Skip Monitoring** — `walmartSkipMonitoring` checkbox; forwarded via `START_MONITOR`; stored on `monitor.skipMonitoring`; bypasses `checkWalmartItemStock()` in `runBackgroundPoll()`.
6. **Walmart Use Saved Session** — `walmartUseSavedSession` checkbox (default ON); `_wmInit()` redirects to Walmart login if OFF and not logged in.
8. **Prefer pickup** — `preferPickup` checkbox; sets `preferPickupMode`; reorders `findFirstEnabledAtcButton()` selectors.
10. **Checkout beep** — `checkoutSound` checkbox (default ON); `playCheckoutBeep()` / `wmPlayBeep()` called in `handleReviewStep()` / `wmHandleReview()` on review page reached.
11. **Import/export settings** — Export/Import buttons in Guide tab; `exportSettings()` / `importSettings()` in popup.js; strips runtime-only keys on export.
12. **Extra product trick** — `addExtraProduct` toggle + `extraProductTcin` TCIN input; after main ATC, navigates to extra product page (state: `tch:extraAtcState=needed`) → ATCs it → proceeds to checkout.

## Recent session (Discord exporter local test fork)

- Created local mirror of installed Chrome extension under `discord-chat-exporter-local/` (source id `lljknccjfgeihgdboidlkoofdknieffm`, version `2.0.0_0`).
- Renamed branding strings to **Unlocked Discord Exporter** in local English locale and HTML titles.
- Built a private test fork at `discord-chat-exporter-testenv/` via `scripts/patch-dce-testenv.mjs`.
- Test fork patches applied:
  - Stubs license token check (`check-token.php`) to premium/pro response.
  - Removes free-tier caps in UI/state (`freeMessageCap`, `freeExportCap` set to max safe integer).
  - Disables hard 500-message free-limit branches in HTML/XLSX loops.
  - Removes install-time promo tab open in `background.js`.
  - Removes `host_permissions` from manifest and labels build as local test.
- Verified patched JS syntax with `node --check` and confirmed no `check-token.php` / `fetch(l` license call remains in patched `dash.js`.
- Added research/probe artifacts (kept intentionally):
  - `scripts/probe-dce-chunks.mjs`
  - `scripts/probe-out.txt`
  - `scripts/probe-out2.txt`
  - `scripts/count-max-per-file.mjs`
  - `scripts/find-export-call.mjs`
- User accepted keeping old export behavior for now (no plaintext single-batch UI feature implemented).

## Previous session (published work)

### Checkout reliability

- **`handleReviewStep` (content.js):** Review dedup (`lastReviewKey` / `lastReviewAt`) now commits **only after** a successful review completion (Place Order found + `markCheckoutSuccess` path), not after a failed probe — fixes a **15s no-op window** on `/checkout` where navigation retry is suppressed. Added **`reviewStepInFlight`** for the same URL to block concurrent duplicate runs (e.g. payment `waitForAny` `.then` + watcher) without reintroducing the old gap.
- **ATC:** **`findFirstEnabledAtcButton()`** prefers first **enabled** Ship / Pickup / Preorder / sticky / text match so Pickup is not skipped when Ship stays disabled.

### Session / harvest near drop

- **Drop-aware harvest:** `getHarvestKeepaliveMinIntervalMs` / `getHarvestBurstSameUrlDedupMs` in `dropPollingTiming.js`; background **`maybeRunDropAwareHarvestKeepalive`** piggybacks **`bgPollWatchdog`** (removed separate `tchSessionKeepAlive` alarm). `stopMonitor` resets `lastHarvestKeepaliveRunMs`.
- **Tests:** `scripts/checkout-speed-test.mjs` asserts the new helpers.

### Popup / account / robustness

- **Target account strip** in Checkout options (dots + values + ↻ Check); **`CHECK_ACCOUNT_STATUS`** → content **`TCH_CHECK_ACCOUNT`** (DOM + `guest_accounts` APIs, 401 handling); background forwards to first Target tab.
- **Popup.html:** Replaced **curly quotes** in Checkout options markup (was breaking `getElementById` / `.checked`).
- **Popup.js:** Null-safe **`gatherSettings`**, **`populateFields`**, **`pushHarvestConfig`**, **`enableToggle`/`saveBtn`** listeners; **`useSavedPayment`/`autoPlaceOrder`** use optional chaining.
- **Auto-save:** Toggles persist on change + flush before **Start monitoring** (from earlier session; still in tree).

### Automation

- **`scripts/browser-smoke/review-dedup-simulation.mjs`** — encodes post-fix review dedup + in-flight semantics; chained in **`npm run test:extension`** (`extension-e2e.mjs` → `extension-functional.mjs` → simulation).
- **How to use:** Cookie harvesting explainer + overnight / drop-aware ping copy in `popup.html` (section 3).

### Repo audit (no code from audit alone)

- Deep read-only pass + second pass on checkout state machine; **`AGENTS.md` line 69** (“never clicks Place Order”) contradicts **`autoPlaceOrder`** + `content.js` — doc cleanup still optional.

## Outstanding

1. **Docs:** Align `AGENTS.md` Place Order / `autoPlaceOrder` + permissions / `package.json` note for `scripts/browser-smoke/`.
2. Optional: tighten `markCartReady` / `ATC_SUCCESS` timing (see `.audit/findings/nemesis-verified.md` if still open).
3. **DNR:** Manual QA whether `rules/blocking.json` rule 4 (`||api.target.com` frames) ever breaks checkout — evidence-only until repro.
4. Reload extension in Chrome after edits.
5. If continuing Discord exporter work: load unpacked from `discord-chat-exporter-testenv/`; regenerate with `node scripts/patch-dce-testenv.mjs` after upstream/local changes.
6. If repo hygiene is needed later, decide whether to keep or remove research probe files under `scripts/` (currently retained on purpose).

## Quick runbook

```text
node --check target-checkout-helper/*.js
node scripts/checkout-speed-test.mjs
node scripts/extension-smoke.mjs
```

**Full browser extension tests** (headed Playwright Chromium; ~30–60s):

```text
cd scripts/browser-smoke
npm install
npx playwright install chromium
npm run test:extension
```

**Last updated:** Session — review dedup fix, ATC enabled-button pick, drop-aware harvest, popup/account + HTML/JS hardening, browser-smoke simulation + `test:extension` chain.
