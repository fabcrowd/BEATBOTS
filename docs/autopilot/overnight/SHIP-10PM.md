# Ship review — 10pm target (boss: @it)

**Status: SHIP READY** (automated gates green; one known stuck item documented)

## Automated quality gate (last run)

| Gate | Result |
|------|--------|
| `bash scripts/verify.sh` | PASS |
| `xvfb-run npm run test:extension` | PASS (E2E + functional + review-dedup) |
| `node scripts/browser-smoke/untested-areas-test.mjs` | PASS (cycles) |
| Drop-prep task reqs 1–5, 7 | PASS |
| Req 6 live rehearsal on cloud VM | STUCK (documented) |

## What ships in this release

**Drop-critical (Target ~4am)**

- Drop-window toast on monitored product pages
- RedSky 401 streak fix; aggressive polling during drop tension
- Harvest keepalive only after successful fetch
- Drop instant in tension window
- Checkout sign-in: in-flight guard, modal-scoped email+Continue, password-only re-auth, pending retries

**Ops**

- `scripts/drop-prep-tonight.sh --continuous --detach` (30s cycles)
- `node scripts/drop-prep-cycle.mjs`
- `@it` narration + subagent orchestration in skill/command

## Known limitation (not a ship blocker)

**Req 6 — live checkout rehearsal on cloud:** `/login` auto sign-in works; Target’s new checkout modal (email + Continue) does not complete under cloud automation (bot friction / “Something went wrong”). **On your PC:** sign in manually once at checkout if prompted; extension handles shipping → review after that.

## Your 10pm checklist (5 min)

1. Merge PR [#17](https://github.com/fabcrowd/BEATBOTS/pull/17) → `main` (or pull `cursor/drop-prep-tonight-4bbd`)
2. Chrome → `chrome://extensions` → **Reload** unpacked `target-checkout-helper/`
3. Popup: extension **ON**, drop time set, **Auto place order OFF**
4. Optional: `scripts/browser-smoke/.env.rehearsal` on **your PC** for local rehearsal only

## Before ~4am drop

- One Target tab; clear cart
- Do not toggle extension in the last minute
- Sign in at checkout if Target prompts (30 seconds manual)

## Branch

`cursor/drop-prep-tonight-4bbd` → merge to `main`
