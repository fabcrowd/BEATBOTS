# PRD: Overnight Repo Health & Debug

## Overview

Unattended Cursor Autopilot runs that **verify, debug, and improve** the Target Checkout Helper extension. Each night resets recurring audit requirements, runs the autopilot loop, and logs results.

## Goals

- Keep Node feedback loops green (`checkout-speed-test`, `signin-step-test`, syntax-check).
- Find and fix bugs in checkout, monitor, harvest, and Walmart flows.
- Add tests for fixed logic where practical.
- Produce a written summary in `overnight-notes.md`.

## Non-Goals

- Refactoring `beatbots-app`, Discord exporter, or research folders.
- Live Target.com / Walmart.com purchases.
- Pushing to remote without explicit user approval (commit locally only).

## Requirements

See `repo-health.json` — 7 recurring requirements + verification commands.

## Automation

```bash
./scripts/autopilot-overnight.sh          # foreground
./scripts/autopilot-overnight.sh --detach # tmux background
```

Needs `CURSOR_API_KEY` or `agent login` on the host machine.
