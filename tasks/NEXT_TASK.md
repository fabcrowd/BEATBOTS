# Next task

**Boss agent:** `@it` (senior developer — read `.cursor/skills/senior-singulr-dev/SKILL.md`)

## Active task

`docs/autopilot/overnight/repo-health.json` — overnight repo health (debug + improve Chrome extension)

Set or switch:

```bash
python -m orchestrator autopilot use docs/autopilot/overnight/repo-health.json
python -m orchestrator autopilot status
python -m orchestrator autopilot next
```

## If no assignment here

1. Read `docs/autopilot/README.md`
2. Pick the next shippable slice (incomplete feature under `docs/autopilot/`, or refresh overnight queue)
3. Run `bash scripts/verify.sh` before and after work

## Overnight (unattended)

```bash
export CURSOR_API_KEY=...
./scripts/loop.sh --detach
```

Or in Cursor chat: `@it` then `@loop`

## Quality gate

```bash
bash scripts/verify.sh
```
