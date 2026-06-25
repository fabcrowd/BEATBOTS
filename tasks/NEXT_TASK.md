# Next task

**Boss agent:** `@it` (senior developer — read `.cursor/skills/senior-singulr-dev/SKILL.md`)

## Active task — tonight's ~4am drop

`docs/autopilot/overnight/drop-prep-4am.json`

```bash
python -m orchestrator autopilot use docs/autopilot/overnight/drop-prep-4am.json
python -m orchestrator autopilot status
```

## Overnight debug (no PC babysitting)

```bash
./scripts/drop-prep-tonight.sh --detach
tmux attach -t drop-prep-tonight   # optional watch
```

Single cycle:

```bash
node scripts/drop-prep-cycle.mjs
```

## Live rehearsal (optional — needs credentials on host)

```bash
cp scripts/browser-smoke/.env.rehearsal.example scripts/browser-smoke/.env.rehearsal
# fill TCH_TARGET_EMAIL + TCH_TARGET_PASSWORD
```

## Quality gate

```bash
bash scripts/verify.sh
cd scripts/browser-smoke && xvfb-run -a npm run test:extension
```
