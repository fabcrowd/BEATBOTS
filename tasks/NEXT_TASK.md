# Next task

**Boss agent:** `@it` — **SHIP READY for 10pm** (see `docs/autopilot/overnight/SHIP-10PM.md`)

## Ship

Merge PR [#17](https://github.com/fabcrowd/BEATBOTS/pull/17) → reload extension in Chrome.

```bash
bash scripts/verify.sh   # must PASS before you rely on build
```

## Active task (complete except req 6 stuck)

`docs/autopilot/overnight/drop-prep-4am.json` — 6/7 pass, req 6 stuck (cloud checkout modal)

```bash
python -m orchestrator autopilot use docs/autopilot/overnight/drop-prep-4am.json
python -m orchestrator autopilot status
```

## Overnight gates (optional)

```bash
./scripts/drop-prep-tonight.sh --continuous --detach
```

## Before ~4am drop

One Target tab, clear cart, extension ON, manual sign-in at checkout if prompted, auto place order OFF.
