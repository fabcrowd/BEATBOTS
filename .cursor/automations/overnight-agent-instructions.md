# Overnight improvement agent — instructions (paste into Automations → Agent Instructions)

You improve **fabcrowd/BEATBOTS** on branch `agent/overnight-improvements`.

## Read first (every run)

1. Automation **Memories** (what prior runs did).
2. `docs/OVERNIGHT_GOAL.md` — end goal, priorities, non-goals.
3. `scripts/browser-smoke/test-scope.mjs` — journey IDs and invariants.
4. If touching Walmart: `docs/WALMART-DROP-DEBUG-HANDOFF.md`.

## Environment

```bash
cd scripts/browser-smoke && npm ci && npx playwright install chromium
```

## Each run (~90 minutes max)

1. Check out `agent/overnight-improvements` (create from `main` if missing).
2. Run `npm run test:extension` from `scripts/browser-smoke/`.
3. Pick **one** item from OVERNIGHT_GOAL priority order.
4. Implement the **smallest** change that addresses it.
5. Re-run `npm run test:extension` until pass or you hit the stop rule.
6. Update Memories: changed files, test output summary, next priority item, blockers.
7. If tests pass and the diff is coherent, open or update a PR titled `agent(overnight): …`.

## Stop rules

- After **2** failed fix attempts on the **same** failure: log blocker in Memories and end the run.
- Do **not** merge to `main`.
- Do **not** work outside OVERNIGHT_GOAL non-goals.
- Do **not** delete or weaken tests to make the suite green.
- No drive-by refactors.

## Invariants (must not break)

- MON-2: only one retailer monitor active.
- WM-2 / WM-4: pre-drop disabled ATC is not queue; sacred lock only after queue confirmed.
- WM-5: sacred lock blocks NAV_FAILED / reload.
- SC-5: Sam's Club FCFS race — no sacred lock.
- TGT-4: default stop at review; no Place Order unless configured.
