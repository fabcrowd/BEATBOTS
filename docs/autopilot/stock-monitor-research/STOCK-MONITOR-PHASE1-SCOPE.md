# Phase 1 scope: Stock monitor (extension-only)

**Author:** @it (senior dev)  
**Autopilot task:** `docs/autopilot/stock-monitor-research/stock-monitor-research.json`  
**Branch:** `cursor/stock-monitor-phase1-4bbd`  
**Baseline:** `bash scripts/verify.sh` — green on main at scope time  
**Out of scope:** Req 6 (beatbots-app WS sidecar), Discord webhooks, proxy farm, `plp_search` keyword discovery

---

## Executive summary

Phase 1 closes the **notification gap** for Target **window drops**: pre-monitor TCINs in the extension so `runBackgroundPoll` navigates on the same RedSky flip Zephyr would Discord-ping — without changing the detection algorithm family.

| Req | Deliverable | Est. touch surface |
|-----|-------------|-------------------|
| **2** | Monitor window mode + unified aggressive poll helper | `dropPollingTiming.js`, `background.js`, `content.js`, `popup.*` |
| **3** | RedSky `zip` / `store_id` on fulfillment URLs | new `core/redskyFulfillment.js`, `background.js`, `content.js`, fixture + test |
| **4** | OOS→in-stock flip telemetry | `background.js`, `popup.js` |
| **5** | Operator playbook in popup Guide | `popup.html`, field-observations doc |

**Implementation order:** 2 → 3 → 4 → 5 (req 5 can land in parallel with 2).

**Autopilot loop (per requirement):**

```bash
python3 -m orchestrator autopilot use docs/autopilot/stock-monitor-research/stock-monitor-research.json
python3 -m orchestrator autopilot next
git checkout -b cursor/stock-monitor-phase1-4bbd
git tag -f autopilot/req-{id}/start
# red → green → refactor
python3 -m orchestrator autopilot verify {id}
python3 -m orchestrator autopilot complete {id}
bash scripts/verify.sh
```

In-chat alternative: `@autopilot` with this JSON (see `.cursor/skills/autopilot-cursor/SKILL.md`). Overnight: `./scripts/loop.sh` with task file swapped in `tasks/NEXT_TASK.md`.

---

## Problem statement

| Today | Window-drop reality |
|-------|---------------------|
| `dropExpectedAt` arms **±10m** tension polling only | Target drops span **hours** with no fixed T-0 |
| Steady poll **500ms** when no drop time | Slower than tension **250ms**; loses to cook-group monitors that poll continuously |
| RedSky URL = `key` + `tcin` only | Geo-sensitive ATP may differ from operator's store |
| No flip timestamp | Post-drop debug: "did we see stock before Discord?" is guesswork |
| Guide covers point-in-time + unknown restock | Missing **"pre-monitor beats Zephyr/Discord"** playbook |

**Success:** Operator adds SKUs before the window, starts monitor, gets tab navigation within **one poll cycle** of RedSky flip — without waiting on Discord.

---

## Design decisions (@it)

### D1 — Monitor window UX (req 2)

Ship **both** controls; they compose:

| Control | Type | When to use |
|---------|------|-------------|
| `monitorWindowStart` / `monitorWindowEnd` | `datetime-local` pair | Known multi-hour window (e.g. 2–6 AM) |
| `aggressiveWhileMonitorOn` | checkbox, default **OFF** | Unknown window bounds — fast poll for entire monitor session |

**Precedence (single helper `isAggressivePoll(monitor)`):**

1. `isInDropTensionWindow(monitor)` — existing ±10m / +3m grace around `dropExpectedAt` → aggressive  
2. `isInMonitorWindow(monitor)` — `now ∈ [start, end]` → aggressive  
3. `aggressiveWhileMonitorOn && monitor.active && !dropExpectedAt` → aggressive (steady unknown restock)  
4. Else → existing tiered slow paths (`500ms`, `2000ms` when far from point drop)

**Do not** slow existing tension behavior when `dropExpectedAt` is armed inside its band.

**Popup:** Place window fields under `dropExpectedAt` on Monitor tab; disable edits while monitor active (same as drop time). Update `#dropHint` to distinguish point vs window.

**Popup duplicate:** Remove local `isInDropTensionWindow(dropIso)` in `popup.js`; call shared logic via duplicated thin wrapper or import pattern — **refactor target:** popup reads monitor object and uses same semantics as `dropPollingTiming.js` (Node tests can't load popup; keep one source in `dropPollingTiming.js`).

### D2 — Shared RedSky URL builder (req 3)

New file: `target-checkout-helper/core/redskyFulfillment.js`

```js
// Loaded via importScripts in background.js; <script> in manifest before content.js
function buildRedskyFulfillmentUrl(tcin, { apiKey, redskyBase, zip, storeId }) {
  // product_fulfillment_v1 single-TCIN path
  // Append zip, store_id, pricing_store_id when present
}
```

| Param | Source priority |
|-------|-----------------|
| `zip` | `settings.shipping.zip` (5-digit) |
| `store_id` | optional `settings.targetStoreId` if we add field; else parse `fi` / `GuestLocation` cookie in background only |
| `pricing_store_id` | same as `store_id` when set |

**Phase 1 minimal:** `zip` from saved shipping only; `store_id` optional from new popup field **or** skip store_id if cookie parse is fragile — **recommend:** zip-only in v1, store_id behind optional advanced field.

Replace URL construction in:

- `checkSingleTcin` / batch URL in `checkTcinsStock` (batch endpoint may not take zip — **keep batch as-is**, apply geo only on single-TCIN fallback and content `buildFulfillmentApiUrl`)

### D3 — Stock flip telemetry (req 4)

Storage shape (`chrome.storage.local`):

```js
lastStockFlips: {
  "94300072": { from: "OOS", to: "IN_STOCK", at: "2026-06-25T14:32:01.123Z", qty: 12 }
}
```

- Pure function `detectStockFlip(prev, next)` → event or null  
- Debounce: same TCIN, same direction, within **30s** → no write  
- Cap: keep last **20** TCIN keys (LRU by `at`)  
- Popup `monitorStatus`: show `Flip 2:32:01 AM` per product when present  
- Do **not** mix into `checkoutTelemetry.events` — separate concern

### D4 — Operator playbook (req 5)

Add Guide section **"Target — Window drop (beat Discord)"**:

1. Add TCINs **before** window opens  
2. Set monitor window **or** aggressive-while-on  
3. Extension ON, one tab, pool built  
4. Zephyr path vs our path diagram (link `stock-monitor-research.md`)  
5. Do not depend on Discord click latency  

Cross-link `DROP-FIELD-OBSERVATIONS.md` Target window bullets.

---

## File-level change map

### `dropPollingTiming.js`

| Add | Purpose |
|-----|---------|
| `isInMonitorWindow(monitor)` | `start`/`end` ISO bounds |
| `isAggressivePoll(monitor)` | D1 precedence |
| Refactor `computeBackgroundPollSleepMs` | Call `isAggressivePoll` first |
| Refactor `getDropAwarePollSeconds` | Same aggressive gate for content passive watch |
| Refactor `isInDropTensionWindow` | Unchanged semantics; used by `isAggressivePoll` |

### `background.js`

| Change | Purpose |
|--------|---------|
| `importScripts('core/redskyFulfillment.js')` | Shared URL builder |
| `checkSingleTcin` | Use `buildRedskyFulfillmentUrl`; load zip from `shipping` in storage |
| `runBackgroundPoll` | Track `lastPollStockByTcin` Map in SW memory; call `recordStockFlip` |
| `startMonitor` | Persist `monitorWindowStart`, `monitorWindowEnd`, `aggressiveWhileMonitorOn` |
| `START_MONITOR` handler | Forward new fields from popup message |

### `content.js`

| Change | Purpose |
|--------|---------|
| `buildFulfillmentApiUrl` | Delegate to `buildRedskyFulfillmentUrl` + page apiKey; pass zip from settings cache |
| Passive stock watch | Use `isAggressivePoll(monitor)` via `getDropAwarePollSeconds` (already uses monitor) |

### `popup.html` / `popup.js`

| Change | Purpose |
|--------|---------|
| Window start/end inputs | Req 2 |
| `aggressiveWhileMonitorOn` checkbox | Req 2 |
| `readMonitorWindowValues()`, save to `monitor` | Persistence |
| `START_MONITOR` payload | Include new fields |
| `renderMonitorStatus` | Show flip times (req 4) |
| Guide section | Req 5 |

### `manifest.json`

| Change | Purpose |
|--------|---------|
| Add `core/redskyFulfillment.js` before `content.js` in content_scripts | Shared builder |

### New: `scripts/stock-monitor-test.mjs`

| Test | Purpose |
|------|---------|
| `buildRedskyFulfillmentUrl` | zip/store query string |
| `parseFulfillmentBlock` fixture | IN_STOCK vs OOS from `scripts/fixtures/redsky-fulfillment-sample.json` |
| `detectStockFlip` | false→true, debounce, null on no change |
| `isInMonitorWindow` / `isAggressivePoll` | Time-mocked via vm + `dropPollingTiming.js` |

### `scripts/checkout-speed-test.mjs`

Extend with monitor window cases:

- Inside 2h window → 250ms  
- Outside window, no aggressive flag → 500ms  
- `aggressiveWhileMonitorOn` + active, no drop time → 250ms  
- Point drop tension still wins inside ±10m when window also set  

### `scripts/verify.sh`

Add step `[7/7] stock-monitor-test` (or renumber).

### Version bump

`manifest.json` version **2.4.0** when Phase 1 ships (after anti-detection 2.3.0).

---

## API / message contracts

### `monitor` object (storage)

```js
{
  active: true,
  products: [...],
  refreshInterval: 1,
  dropExpectedAt: "2026-06-26T07:00:00",      // optional, point drop
  monitorWindowStart: "2026-06-26T02:00:00",  // NEW optional
  monitorWindowEnd: "2026-06-26T06:00:00",    // NEW optional
  aggressiveWhileMonitorOn: false,              // NEW
  // ...existing fields
}
```

### `START_MONITOR` message (popup → background)

Add keys: `monitorWindowStart`, `monitorWindowEnd`, `aggressiveWhileMonitorOn`.

### `GET_MONITOR_STATUS` response (if used by popup poll)

Include `lastStockFlips` slice for displayed products.

---

## Acceptance tests (mapped to autopilot reqs)

### Req 2 — Monitor window

- [ ] `isAggressivePoll({ monitorWindowStart, monitorWindowEnd, active: true })` true inside window (mocked clock)  
- [ ] Outside window returns false when `aggressiveWhileMonitorOn` false  
- [ ] `computeBackgroundPollSleepMs` === 250 inside aggressive  
- [ ] Outside window without aggressive === 500 (or 2000 far from point drop)  
- [ ] Existing checkout-speed-test cases unchanged for point-drop-only monitors  
- [ ] Popup disables window fields while monitor active  

### Req 3 — Geo params

- [ ] URL contains `zip=12345` when `shipping.zip` saved  
- [ ] Fixture JSON: parser returns `stock: true` for IN_STOCK sample  
- [ ] `verify.sh` runs `stock-monitor-test.mjs`  
- [ ] No regression on 401/403 recovery path  

### Req 4 — Flip telemetry

- [ ] `detectStockFlip({stock:false}, {stock:true})` returns event  
- [ ] Second flip within 30s suppressed  
- [ ] Popup shows human-readable time  
- [ ] `recordStockFlip` does not fire on true→true  

### Req 5 — Playbook

- [ ] Guide section visible on Guide tab  
- [ ] Mentions pre-monitor vs Discord/Zephyr  
- [ ] Link or reference to `stock-monitor-research.md`  

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| 250ms poll for hours increases 401/403 rate | Keep jitter (`jitterBackgroundPollSleepMs`); document one-tab discipline; session recovery already exists |
| Batch endpoint ignores zip | Geo on single-TCIN fallback only; log when fallback used |
| `datetime-local` timezone confusion | Same pattern as `dropExpectedAt`; countdown copy in popup |
| Popup/background `isInDropTensionWindow` drift | Single implementation in `dropPollingTiming.js` |
| store_id cookie parse brittle | Phase 1 zip-only default; store_id optional later |

---

## What we will NOT do in Phase 1

- Discord / webhook fan-out  
- N-of-M debounce before navigate (Phase 2)  
- `plp_search_v2` keyword watches  
- beatbots-app headless poller (req 6)  
- Walmart monitor window changes (Walmart stays point-drop + queue model)  

---

## Verification checklist (ship gate)

```bash
node --check target-checkout-helper/core/redskyFulfillment.js
node --check target-checkout-helper/dropPollingTiming.js
node --check target-checkout-helper/background.js
node --check target-checkout-helper/content.js
node --check target-checkout-helper/popup.js
node scripts/checkout-speed-test.mjs
node scripts/stock-monitor-test.mjs
bash scripts/verify.sh
```

Manual smoke (operator):

1. Load extension; add Target TCIN; set window start/end spanning now+5min  
2. Start monitor; confirm DevTools SW log shows ~250ms poll cadence inside window  
3. Save shipping zip; inspect fulfillment URL in SW log for `zip=`  
4. Simulate or wait for flip; popup shows flip timestamp  

---

## Suggested commits (one per req)

1. `feat(monitor): window mode + isAggressivePoll (autopilot req 2)`  
2. `feat(redsky): geo zip on fulfillment URLs (autopilot req 3)`  
3. `feat(telemetry): stock flip timestamps (autopilot req 4)`  
4. `docs(guide): Target window drop playbook (autopilot req 5)`  

---

## References

- PRD: `docs/autopilot/stock-monitor-research/stock-monitor-research.md`  
- Field notes: `docs/autopilot/field-observations/DROP-FIELD-OBSERVATIONS.md`  
- Autopilot JSON: `docs/autopilot/stock-monitor-research/stock-monitor-research.json`  
- Polling today: `target-checkout-helper/dropPollingTiming.js`  
- Poll loop: `background.js` `runBackgroundPoll` (sleep via `computeBackgroundPollSleepMs`)
