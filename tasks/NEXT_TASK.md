# Next task

**Boss agent:** `@it` — overnight loop uses **`docs/autopilot/IT_LOOP_PROMPT.md`**

**LLM handoff:** [`docs/autopilot/HANDOFF.md`](../docs/autopilot/HANDOFF.md) — read before picking up work.

## Merge first

- Open PR: `cursor/release-handoff-4bbd` → `main` (consolidates #28, #29, #32, #33, #34)
- After merge: close superseded PRs; reload extension at `chrome://extensions` (v2.5.0)

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

## Deferred

- Stock monitor Phase 3 (headless poller at scale) — PRD only
- Live Target checkout rehearsal in cloud (auth modal)

## Logs

- Runner: `docs/autopilot/overnight/logs/`
- Gate journal: `docs/autopilot/overnight/it-live.md`
- Session notes: `docs/autopilot/overnight/overnight-notes.md`
