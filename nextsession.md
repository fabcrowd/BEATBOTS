# Next session handoff

## Purpose

Read after `AGENTS.md`. Continuity for agents without long chat history.

## What this repository is

**Target Checkout Helper** — Chrome MV3 extension in `target-checkout-helper/`. No build step.

## Architecture

| Subsystem | Path |
|-----------|------|
| Background | `target-checkout-helper/background.js` |
| Content + checkout flow | `target-checkout-helper/content.js` |
| Drop-window math + `isInDropTensionWindow` | `target-checkout-helper/dropPollingTiming.js` |
| Popup | `target-checkout-helper/popup.html`, `popup.js`, `popup.css` |
| Main world bridge | `target-checkout-helper/main_world.js` |

## Recent session

- **Industry practice → product behavior:** Stellar-style “fix 401 with fresh session” and Refract-style “one tab / don’t thrash settings at drop” are reflected in **AGENTS.md** § Drop discipline, **popup** copy, **401/403 RedSky** handling with throttled toast + tab message from background, **drop-window** one-time toast on monitored product pages, and **`parseFulfillmentStockStatus`** aligned with background (`sellable && !soldOut`).
- Version **1.2.5** in `manifest.json`.

## Outstanding

1. Optional: tighten `markCartReady` / `ATC_SUCCESS` timing (see `.audit/findings/nemesis-verified.md` if still open).
2. Reload extension in Chrome after edits.

## Quick runbook

```text
node --check target-checkout-helper/*.js
node scripts/checkout-speed-test.mjs
```

**Last updated:** Session — industry patterns applied to TCH (no vendor playbook stored here).
