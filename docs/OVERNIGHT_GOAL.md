# Overnight agent goal — BEATBOTS / Target Checkout Helper

**Branch:** `agent/overnight-improvements` (never merge to `main` without human review)

## End goal

Keep the Chrome MV3 extension (`target-checkout-helper/`) reliable across **Target, Walmart, and Sam's Club** drop/checkout journeys. Each automation run should make **one focused improvement** that moves the test suite toward green while respecting scope and invariants.

## Definition of done (automation stops iterating when all are true)

- [ ] `cd scripts/browser-smoke && npm ci && npx playwright install chromium && npm run test:extension` exits **0**
- [ ] Every test file traces to a journey step in `scripts/browser-smoke/test-scope.mjs` (no orphan tests)
- [ ] All **INVARIANTS** in `test-scope.mjs` still hold (MON-2, WM-2/4/5, SC-5, TGT-4, WM-3, SC-3)
- [ ] No unrelated refactors outside files required for the failing test or journey step
- [ ] `docs/WALMART-DROP-DEBUG-HANDOFF.md` two-phase queue model unchanged unless a test explicitly requires a fix

## Priority order (work top to bottom)

1. Fix any **failing** step in `npm run test:extension` (run full suite first; do not assume which file fails).
2. If suite is green: pick the **lowest automated journey ID** in `test-scope.mjs` with weak or missing coverage and add/strengthen tests only if they map to a journey step.
3. If suite is green and coverage is adequate: harden **error paths** for Walmart queue (WM-4, WM-5) and Sam's Club FCFS (SC-5, SC-6) without changing happy-path behavior.

## Non-goals

- Chrome Web Store packaging, installer builds, or `dist/` changes
- New retailers beyond Target / Walmart / Sam's Club
- Enabling auto Place Order by default (TGT-4 stays manual unless explicitly scoped)
- Broad manifest / permission changes without a journey step and test
- `claudekit-skills-main/`, `discord-chat-exporter-*`, or other non-extension directories

## Test commands (authoritative)

```bash
cd scripts/browser-smoke
npm ci
npx playwright install chromium
npm run test:extension
```

Faster subset when debugging a single retailer (only after full suite was green or failure is isolated):

```bash
npm run functional
npm run test:offline
npm run e2e:walmart
npm run e2e:samsclub
```

## Key references

| File | Purpose |
|------|---------|
| `scripts/browser-smoke/test-scope.mjs` | Journey IDs, invariants, mock URLs |
| `docs/WALMART-DROP-DEBUG-HANDOFF.md` | Walmart queue / sacred lock semantics |
| `docs/CLOUD_AGENT_SETUP.md` | Cloud VM install steps for this repo |
| `target-checkout-helper/` | Extension source |

## Human review bar

Open or update a PR only when:

- Tests pass in the cloud run for that session, **or**
- The change is docs-only with no behavior change

PR title format: `agent(overnight): <short summary>`
