# Stock monitor research — brainstorm notes

**Autopilot task:** `stock-monitor-research`  
**User ask:** How do stocking bots track restocks? Plan adoption — no Discord webhook.

---

## One-paragraph answer (for the operator)

Stock bots don’t have magic. On **Target**, they poll **RedSky** — the same JSON API the product page uses — with a **TCIN** (the number in `/A-94300072`). They watch `availability_status` and **available_to_promise_quantity** flip from out-of-stock to in-stock, then either ping Discord or wake a checkout task. On **Walmart**, restock inside a 9 PM drop is usually irrelevant until **Queue-it** clears; monitors use `/item/json/{id}` for non-queue SKUs.

**We already poll RedSky** from the service worker (`checkTcinsStock`). The reason cook-group pings feel faster than you is: **they were polling before you got the notification**, often from **many IPs**, and their checkout task navigates **immediately** on flip — you wait for Discord → click → new tab.

---

## What paid stacks add that we don’t (yet)

| Advantage | Why it matters for window drops |
|-----------|--------------------------------|
| Always-on monitor | Covers **hours-long** Target windows without you guessing time |
| 1 proxy per SKU | Avoids 403 when polling many TCINs from one IP |
| Cook group PID list | You don’t need to find TCIN yourself |
| Separate checkout task | Monitor hammers API; checkout uses warm session |

---

## Code map (our implementation = same API family)

```
main_world.js          → extracts apiKey from __CONFIG__
background.js          → checkSingleTcin / checkTcinsStock (batch)
dropPollingTiming.js   → 250ms–2s sleep tiers
content.js             → parseFulfillmentStockStatus, HTML fallback
runBackgroundPoll      → on stock true → tabs.update(product.url)
```

**Gap:** `buildFulfillmentApiUrl` and `checkSingleTcin` omit explicit `zip` / `store_id` — commercial scrapers include them for geo ATP.

**Gap:** `dropExpectedAt` assumes a **point** in time; Target window drops need **monitor window** or “aggressive while ON”.

---

## Recommended Phase 1 (start here)

1. **Monitor window UI** — e.g. “Aggressive poll while monitor active” toggle OR start/end datetime pair for unknown-window SKUs.
2. **RedSky geo params** — append `zip` from saved shipping + optional store id from cookie.
3. **Flip telemetry** — `lastStockFlip: { tcin, from, to, at }` for debugging “did we see it?”
4. **Popup copy** — “Add SKU before window; don’t wait for Discord.”

**Not starting:** Discord, proxy farm, plp_search keyword monitor (Phase 2).

---

## Zephyr-specific note

Cook-group pings from Zephyr ≈ same RedSky flip we'd see in `runBackgroundPoll`. Pre-monitor TCINs to skip waiting on their Discord message. See **Zephyr Monitors** section in `stock-monitor-research.md`.

---

## Phase 1 build scope (@it)

**Full spec:** `STOCK-MONITOR-PHASE1-SCOPE.md` in this folder.

- **Branch:** `cursor/stock-monitor-phase1-4bbd`
- **Next autopilot req:** 2 (monitor window mode)
- **Senior call:** ship window start/end + `aggressiveWhileMonitorOn`; unified `isAggressivePoll`; zip on RedSky URLs; flip telemetry; Guide playbook
- **Not in Phase 1:** req 6 beatbots WS, Discord, proxies

---

## Review

- 2026-06-27 — Initial research PRD + tasks JSON from operator field report + Refract/RedSky public docs.
- 2026-06-25 — @it Phase 1 scope doc (`STOCK-MONITOR-PHASE1-SCOPE.md`); autopilot task activated; verify.sh green.
- 2026-06-25 — **Shipped v2.4.0:** reqs 2–6 complete (window mode, RedSky zip, flip telemetry, guide, beatbots `stock_flip` WS). `verify.sh` + `stock-monitor-test.mjs` green.
- 2026-06-25 — **Phase 2 v2.5.0:** batch fixtures, keyword watch (`plp_search_v2`), 2-of-3 navigate gate + ATP flicker hold (`stock-monitor-phase2.json` 3/3).
