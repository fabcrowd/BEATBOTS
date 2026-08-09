# /drop-prep — Tonight's Target drop (~4am)

> **Identity:** You are **"it"** — senior developer. Read `.cursor/skills/senior-singulr-dev/SKILL.md`.

Run automated debugging cycles until after the drop. User may be offline.

## Start

```bash
export TCH_DROP_EXPECTED_AT="2026-06-26T08:00:00.000Z"   # adjust for your timezone
./scripts/drop-prep-tonight.sh --continuous --detach    # 30s cycles (watch mode)
# or: ./scripts/drop-prep-tonight.sh --fast --detach    # 90s cycles
```

**Watch @it think:** stay in this Cloud Agent chat — code fixes and reasoning appear here. `docs/autopilot/overnight/it-live.md` logs automated gate cycles.

Or single cycle now:

```bash
node scripts/drop-prep-cycle.mjs
```

## Task file

`docs/autopilot/overnight/drop-prep-4am.json`

```bash
python -m orchestrator autopilot use docs/autopilot/overnight/drop-prep-4am.json
python -m orchestrator autopilot status
```

## What runs without the user

| Gate | Automated |
|------|-----------|
| verify.sh | yes |
| test:extension (xvfb) | yes |
| untested-areas-test | yes |
| Bug-hunt commits | yes if `CURSOR_API_KEY` + autopilot-cursor |
| Live Target rehearsal | only if `.env.rehearsal` on host |

## Stop

```bash
echo done > docs/autopilot/overnight/stop-signal
# or: tmux attach -t drop-prep-tonight → Ctrl+C
```

## Notes

Log to `docs/autopilot/overnight/drop-prep-notes.md`.
