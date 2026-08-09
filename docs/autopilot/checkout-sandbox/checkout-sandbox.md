# PRD: Checkout Sandbox Testing

## Introduction / Overview

Before high-traffic drops, the Target Checkout Helper needs a **repeatable sandbox** that loads the real unpacked extension in isolated Chrome, exercises extension wiring without touching live retailer APIs blindly, and optionally runs a **full Target checkout rehearsal** (product → cart → checkout → **review only**).

**Problem:** Node tests (`signin-step-test.mjs`, `checkout-speed-test.mjs`) catch logic regressions but not DOM timing, content-script injection, popup ↔ background messaging, or real Target checkout step transitions. Manual testing before every drop is slow and inconsistent.

**Goal:** Automated checkout rehearsal in isolated Chrome to find errors before drops — with a clear pass/fail signal and documented `blockedReason` when the environment cannot run (no Chromium, no product URL, sign-in wall, etc.).

## Goals

- Keep **`npm run test:extension`** green in `scripts/browser-smoke/` (ephemeral Playwright Chromium profile, no Target purchase).
- Provide a **checkout rehearsal** path (`checkout-rehearsal.mjs`) that reaches `[TCH] review reached` on a real in-stock Target product URL, or exits with a structured failure reason.
- Use **ephemeral profiles for CI/automation** and **optional persistent profile** (`TCH_PROFILE_DIR`, default `~/.tch-rehearsal-chrome`) for logged-in rehearsal on a developer machine.
- Never enable **Auto place order** in sandbox runs; rehearsal must stop at review.
- Produce **actionable logs** (`[TCH]` console lines, timing `checkout_total_to_review`) and notes for Autopilot (`checkout-sandbox-notes.md`).
- Integrate with Autopilot: PRD → tasks JSON → `@autopilot` / `@it` loop with `bash scripts/verify.sh` as gate.

## User Stories

1. **As a developer before a drop**, I want to run one command that loads the extension in clean Chrome and verifies popup/background/harvest/monitor wiring so I trust the build.
2. **As a developer with a Target session**, I want an optional rehearsal that drives product → review using saved payment/address so I catch checkout-step bugs on real DOM.
3. **As an Autopilot agent**, I want verification commands and acceptance criteria so I can fix failures with TDD and mark requirements `stuck: true` when Chromium or credentials are unavailable.
4. **As a CI maintainer**, I want ephemeral profiles and no secrets in repo so smoke tests run without a logged-in Target account.

## Requirements

### Functional

1. **Extension smoke (no live checkout):** `cd scripts/browser-smoke && npm run test:extension` runs the chained suite:
   - `extension-e2e.mjs` — load unpacked `target-checkout-helper/`, resolve extension ID from MV3 service worker, open popup, verify Target tab `[TCH]` init.
   - `extension-functional.mjs` — background harvest, debugger bridge, monitor start/stop via `chrome.runtime.sendMessage`.
   - `review-dedup-simulation.mjs` — review-step dedup / in-flight semantics.
2. **Checkout rehearsal (live Target, review only):** `npm run checkout-rehearsal` with required `TCH_PRODUCT_URL` (full `https://www.target.com/p/…` URL).
3. Rehearsal **must** set extension via popup storage: `enabled: true`, `useSavedPayment: true`, `autoPlaceOrder: false`.
4. Rehearsal **pass** condition: console log contains `[TCH] review reached` within `TCH_REHEARSAL_TIMEOUT_MS` (default 7 minutes).
5. Rehearsal **must not** click Place Order or charge a card.
6. On failure, output **last 15 `[TCH]` lines** and a single-line summary suitable for `blockedReason` in task JSON.

### UI

7. Rehearsal may pause for human setup via `TCH_MANUAL_WAIT_SECS` or readline prompt (sign-in, popup check) — document in README/notes, not blocking CI path.
8. No new popup UI required for v1; reuse existing toggles and storage keys.

### Integration

9. Reuse `scripts/browser-smoke/launch-util.mjs` for all launches (`--load-extension`, Playwright Chromium via `puppeteer-core`).
10. Ephemeral profile: default `launchWithExtension({ profilePrefix: 'tch-e2e-' })` → temp dir, deleted after run unless `TCH_DELETE_PROFILE` unset on rehearsal (rehearsal keeps profile by default).
11. Persistent profile: `checkout-rehearsal.mjs` uses `TCH_PROFILE_DIR` so Target login survives across runs.
12. Autopilot task file lives at `docs/autopilot/checkout-sandbox/checkout-sandbox.json`; notes at `docs/autopilot/checkout-sandbox/checkout-sandbox-notes.md`.
13. Wire verification into orchestrator: `python -m orchestrator autopilot use docs/autopilot/checkout-sandbox/checkout-sandbox.json`.

### Testing

14. **CI tier (required):** `npm run test:extension` exits 0 after `npm install` + `npx playwright install chromium` in `scripts/browser-smoke/`.
15. **Rehearsal tier (optional / local):** `TCH_PRODUCT_URL` set → `npm run checkout-rehearsal` reaches review or documents `blockedReason` (examples: `no_chromium`, `missing_product_url`, `signin_timeout`, `review_timeout`, `oos_or_atc_failed`).
16. Add or extend tests for **checkout step classification** touched by rehearsal (e.g. sign-in vs saved vs shipping) via existing `signin-step-test.mjs` where pure logic applies.
17. `bash scripts/verify.sh` must remain green after sandbox changes (syntax-check, signin-step, checkout-speed, integration).
18. Autopilot agents read `.cursor/skills/extension-e2e-test/SKILL.md` when adding Puppeteer coverage.

## Non-Goals (Out of Scope)

- **Walmart** checkout rehearsal (Target only for v1).
- **Auto place order** or any real purchase in sandbox/CI.
- **Mocking Target.com** as a full HTTP sandbox (real product URL required for rehearsal tier).
- Storing Target passwords in rehearsal scripts or task JSON.
- CAPTCHA / SMS / email OTP automation beyond existing Gmail OTP path in extension.
- Proxy lists, cookie jars, or multi-profile bot farms.
- Cloud VM headed Chrome in default CI (mark `stuck: true` when unavailable).

## Technical Considerations

- **Headed Chrome required:** Extensions do not run in headless mode; CI needs Xvfb or a machine with display for browser-smoke.
- **No extension build step:** Load `target-checkout-helper/` directly (same as production unpacked load).
- **Dependencies:** `scripts/browser-smoke/package.json` — Playwright 1.49.1, puppeteer-core 23.11.1; run `npm run install-chromium` once per machine.
- **Environment variables:**

  | Variable | Required | Purpose |
  |----------|----------|---------|
  | `TCH_PRODUCT_URL` | Rehearsal only | In-stock Target product page |
  | `TCH_PROFILE_DIR` | No | Persistent Chrome profile (default `~/.tch-rehearsal-chrome`) |
  | `TCH_REHEARSAL_TIMEOUT_MS` | No | Max wait for review (default 420000) |
  | `TCH_MANUAL_WAIT_SECS` | No | Seconds to wait for manual sign-in before product navigation |
  | `TCH_DELETE_PROFILE` | No | Set `1` to delete profile after rehearsal |

- **Autopilot mapping:** Upstream `/sandbox` is skipped in Cursor; this PRD **is** the sandbox spec. Terminal loop: `autopilot-cursor docs/autopilot/checkout-sandbox/checkout-sandbox.json`.
- **Safety:** Rehearsal uses **Use saved payment** so Target wallet can fill shipping/payment; user must use a product they are willing to take to review (no place order click).

## Success Metrics

- `npm run test:extension` passes on a machine with Playwright Chromium installed.
- With `TCH_PRODUCT_URL` and a signed-in persistent profile, `npm run checkout-rehearsal` prints `CHECKOUT REHEARSAL PASS — reached review (no Place Order)`.
- When rehearsal cannot run, failure message is explicit enough to set `stuck: true` + `blockedReason` in Autopilot task JSON.
- `bash scripts/verify.sh` passes after implementation work.
- Findings from failed runs are logged in `checkout-sandbox-notes.md` with file:line references when code fixes are made.

## Resolved Decisions

- **Retailer scope:** Target.com only; Walmart deferred.
- **Purchase policy:** Review step only; `autoPlaceOrder: false` enforced in rehearsal popup settings.
- **Profile strategy:** Ephemeral for `test:extension` and CI; persistent optional for local logged-in rehearsal.
- **Success definition:** `test:extension` green is the hard gate; rehearsal green is best-effort when env vars and login are available.
- **Autopilot quality gate:** `bash scripts/verify.sh` before marking requirements complete.
- **Agent skills:** `@extension-e2e-test` for Puppeteer patterns; `@it` for offline boss / product calls.
- **Existing assets:** Build on `checkout-rehearsal.mjs`, `launch-util.mjs`, and overnight repo-health req 7 (browser-smoke) — extend, do not replace, unless a clear bug requires it.

## Next Step

After approval, run:

```
@tasks docs/autopilot/checkout-sandbox/checkout-sandbox.md
```

Then:

```
python -m orchestrator autopilot use docs/autopilot/checkout-sandbox/checkout-sandbox.json
@autopilot docs/autopilot/checkout-sandbox/checkout-sandbox.json
```
