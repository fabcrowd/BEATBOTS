# Next task

**Boss agent:** `@it` — overnight loop uses **`docs/autopilot/IT_LOOP_PROMPT.md`**

## Start overnight loop

```bash
export CURSOR_API_KEY=...   # required on host — or: agent login
export PATH="$HOME/.local/bin:$PATH"
./scripts/loop.sh --detach
tmux -f /exec-daemon/tmux.portal.conf attach -t autopilot-overnight
```

Default task: `docs/autopilot/overnight/repo-health.json` (refreshed by `refresh-overnight-tasks.mjs`).

Custom task example:

```bash
./scripts/loop.sh --task docs/autopilot/stock-monitor-research/stock-monitor-phase2.json --detach
```

## Pre-flight (must pass before loop)

```bash
bash scripts/verify.sh
python3 -m orchestrator autopilot use docs/autopilot/overnight/repo-health.json
python3 -m orchestrator autopilot status
```

## Active PRs (merge when green)

- [#33](https://github.com/fabcrowd/BEATBOTS/pull/33) — stock monitor Phase 2 (v2.5.0)
- [#32](https://github.com/fabcrowd/BEATBOTS/pull/32) — stock monitor Phase 1 (v2.4.0)

## Logs

- Runner: `docs/autopilot/overnight/logs/`
- Gate journal: `docs/autopilot/overnight/it-live.md`
