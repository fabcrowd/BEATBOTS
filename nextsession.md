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
