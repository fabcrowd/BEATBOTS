# Checkout research deep-dive & brainstorm

**Boss:** @it | **Date:** 2026-06-26 | **Sources:** repo research, implementation map, vendor guides (Refract/Stellar/Divine/AMNotify), Shape/F5 literature, live rehearsal failures

---

## Executive summary

**We are strong** on drop timing, RedSky monitoring, session recovery, CDP input, and passive/ATC cookie harvest. **We are weak** where the industry wins: **Shape-ready ATC cookies**, **pre-authenticated checkout** (no auth at cart time), and **monitor/checkout session isolation**.

Reddit did **not** yield reliable Target-bot threads (search API blocked; prior research pass found no substantive Reddit signal). **Actionable community knowledge** lives in vendor docs (Refract, Stellar, Hidden AIO, Divine, AMNotify) and our `tasks/todo.md` Discord-derived notes — treat those as proxy for “forum wisdom.”

**Shippable tonight:** extension + runbook. **Structural parity with Stellar** requires `beatbots-app` (Shape harvester + API checkout) or accepting extension limits.

---

## Research ↔ implementation crosswalk

| Research finding | Where in code | Gap |
|------------------|---------------|-----|
| Shape cookies required for hype ATC/login (Refract) | `cookieHarvest.js` passive + `captureAtcSnapshot()` | No **active** Shape generation in extension; `beatbots-app` has Puppeteer intercept |
| Login cookies ≠ ATC cookies; each ATC **consumes** cookie (Refract) | Pool is generic snapshots; `kind: 'atc'` preferred on apply | No separate login vs ATC pools; no consume-on-ATC accounting |
| Hype mode needs cookie pool (Refract) | `hypeMode` gate in `handleMonitoredATC` | ✓ implemented |
| 1 checkout task per account (Stellar) | Single tab | Operational — document only |
| Monitor before checkout; checkout in **Watch** until ping (Stellar) | BG poll + `navigationLock`; same tab/session | Checkout shares monitor tab cookies/IP |
| Pre-login before drop; no auth at checkout (Stellar, Divine) | `autoSignIn` at checkout modal | **Fails** on new Target modal under automation |
| Monitor delay ~3500ms (Refract) | Tension: 250ms–1s | We are **faster** in tension — good for drops |
| Test evening before drop (Divine) | `verify.sh`, rehearsal | Cloud rehearsal stuck at checkout modal |
| Address jig reduces cancels (Discord/todo) | `core/jigAddress.js` | ✓ — ensure popup default on |
| Cookie↔IP coherence (harvest research) | Single IP extension | No proxy layer in extension |
| API checkout faster (Stellar comparison) | DOM `content.js` | `beatbots-app` checkout-engine |
| Session recovery preserve PX (our edge) | `background.js` `maybeAutoRecoverTargetSession` | ✓ — blocked on `/checkout` tabs |
| New checkout UI: email + Continue + passkey (rehearsal DOM probe) | `handleSignInPage`, `findVisibleSignInInputs` | Password step never appears; Target error banner |
| Reddit bot threads | `findings_public_landscape.md` | **No reliable Reddit corpus** — use vendor + Discord intel |

---

## What Reddit *would* say (vendor/forum consensus)

Direct Reddit scrape failed. These points recur across **Refract, Stellar, Divine, AMNotify, Unknown Proxies** guides:

1. **Cookies are non-optional** for hype — extension harvest > in-bot harvest.
2. **Start tasks when product page loads**, not 24/7 (account locks, proxy flags).
3. **One checkout per account** — parallel tasks on same account = locks.
4. **Pre-test the night before** — login, proxy health, preview checkout.
5. **Cancels** are common — bot flow, address, account age, “item demand” / ThreatMetrix-style scoring.
6. **Residential proxies** often beat ISP on Target (Divine); extension users = one IP.
7. **Don’t use raw Playwright/Puppeteer** for checkout without stealth — CDP detection (Shape 2025/2026 lit).
8. **Use real Chrome profile** for lowest friction (YouTube bot guides) — aligns with our CDP-in-real-Chrome approach.

---

## Brainstorm: checkout improvements (prioritized)

### Tier A — Extension-only, high ROI before next drop

| # | Idea | Rationale | Complexity |
|---|------|-----------|------------|
| A1 | **Pre-drop auth warmup** — after login, visit `/account` or product, never re-run full email flow at checkout if session valid | Stellar/Divine; fixes rehearsal pain | Medium |
| A2 | **New checkout modal flow** — treat “Sign in or create account” + email+Continue as **distinct** from `/login` two-step; optional **guest** when `useSavedPayment` + modal blocks | DOM probe showed different UI | Medium |
| A3 | **Fresh tab checkout** — monitor in tab A; on restock open tab B, `applyNext` harvest, navigate checkout (session separation light) | Stellar monitor/checkout split lite | Medium |
| A4 | **Stop auto-sign-in retries when Target shows error banner** (“Something went wrong”) — toast + wait for user | Rehearsal log | Small |
| A5 | **Login vs ATC pool labels** — separate queues; consume ATC snapshot on ATC click | Refract cookie model | Medium |
| A6 | **Runbook in popup** — 5-line pre-drop checklist (one tab, clear cart, sign in early, hype pool, no toggle) | AMNotify/Divine discipline | Small |

### Tier B — Extension + existing `beatbots-app`

| # | Idea | Rationale |
|---|------|-----------|
| B1 | **Bridge: extension triggers app Shape harvest** before monitor ATC | Closes #1 gap in comparison doc |
| B2 | **Optional API checkout path** when app connected | Orders-of-magnitude speed |
| B3 | **WebSocket status** — app reports Shape pool depth to popup | User visibility (Refract “cookie count”) |

### Tier C — Research / not extension scope

| # | Idea | Notes |
|---|------|-------|
| C1 | Multi-account parallel | Chrome profiles × extension |
| C2 | Per-task proxies | `chrome.proxy` or companion |
| C3 | Active Shape loop in extension only | High ban risk; app is the right place |

---

## Autopilot `/loop` execution plan

Task file: `docs/autopilot/checkout-improvements/checkout-improvements.json`

| Req | Focus |
|-----|--------|
| 1 | Baseline `verify.sh` |
| 2 | A4 — Target error banner detection + backoff |
| 3 | A1 — pre-auth warmup helper + rehearsal path |
| 4 | A2 — checkout modal guest/continue when logged-in signals conflict |
| 5 | A3 — fresh-tab checkout option (monitor setting) |
| 6 | A6 — popup pre-drop checklist |
| 7 | Tests + notes + summary |

Start loop:

```bash
bash scripts/verify.sh
node scripts/refresh-overnight-tasks.mjs   # if using repo-health instead
./scripts/loop.sh --task docs/autopilot/checkout-improvements/checkout-improvements.json --detach
```

---

## Decisions (@it)

1. **Do not** chase full Reddit scrape — low signal; vendor docs + our rehearsal DOM probes are higher quality.
2. **Do not** block ship on cloud checkout rehearsal — manual sign-in at checkout is acceptable if warmup + modal fixes land.
3. **Do** run `/loop` on Tier A items through tonight; Tier B needs `beatbots-app` running locally.
4. **Shape generation** stays in app; extension documents “start app harvester before hype drop.”

---

## References (in repo)

- `research_target_checkout_bots/`, `research_cookie_harvesting/report.md`
- `tasks/stellar-vs-us-comparison.md`, `tasks/stellar-target-intel.md`, `tasks/todo.md`
- `docs/autopilot/overnight/drop-prep-notes.md`, `SHIP-10PM.md`
- Refract Target module, Stellar TargetGO guides (web)
- Divine Target botting guide, AMNotify Target guide (web)
