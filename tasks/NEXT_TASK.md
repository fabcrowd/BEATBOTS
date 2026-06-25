# Next task

**Boss agent:** `@it` (senior developer — read `.cursor/skills/senior-singulr-dev/SKILL.md`)

## Active task

`docs/autopilot/checkout-sandbox/checkout-sandbox.json` — checkout sandbox (browser smoke + optional rehearsal)

```bash
python -m orchestrator autopilot use docs/autopilot/checkout-sandbox/checkout-sandbox.json
python -m orchestrator autopilot status
```

## Local rehearsal (optional tier)

```bash
export TCH_PRODUCT_URL="https://www.target.com/p/…"
export TCH_MANUAL_WAIT_SECS=60
cd scripts/browser-smoke && npm run checkout-rehearsal
```

## Quality gate

```bash
bash scripts/verify.sh
cd scripts/browser-smoke && xvfb-run -a npm run test:extension
```
