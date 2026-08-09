#!/usr/bin/env bash
#
# loop — One command to start tonight's Autopilot (Cursor runtime).
#
# Maps to upstream: autopilot docs/autopilot/overnight/repo-health.json
#
# Usage:
#   ./scripts/loop.sh                    # overnight, tmux background, 8h max
#   ./scripts/loop.sh --foreground       # stay in this terminal
#   ./scripts/loop.sh --task path.json   # custom task file
#   ./scripts/loop.sh --dry-run
#   ./scripts/loop.sh --max-hours 6 --model sonnet-4
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_FILE="docs/autopilot/overnight/repo-health.json"
DETACH=true
FORWARD=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task) TASK_FILE="$2"; shift 2 ;;
    --foreground) DETACH=false; shift ;;
    --detach) DETACH=true; shift ;;
    --help|-h)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      FORWARD+=("$1")
      shift
      ;;
  esac
done

export PATH="$HOME/.local/bin:$PATH"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Autopilot /loop — Cursor overnight TDD                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Task file:  $TASK_FILE"
echo "  Runner:     autopilot-cursor (fresh agent session per req)"
echo "  Docs:       docs/autopilot/README.md"
echo ""

# Refresh overnight queue when using default repo-health task
if [[ "$TASK_FILE" == "docs/autopilot/overnight/repo-health.json" ]] \
  || [[ "$TASK_FILE" == */overnight/repo-health.json ]]; then
  node "$ROOT/scripts/refresh-overnight-tasks.mjs"
fi

OVERNIGHT_ARGS=(--max-hours 8)
if [[ "$DETACH" == true ]]; then
  OVERNIGHT_ARGS+=(--detach)
fi
OVERNIGHT_ARGS+=("${FORWARD[@]}")

# Pass custom task via env for overnight script
export AUTOPILOT_LOOP_TASK_FILE="$TASK_FILE"

exec "$ROOT/scripts/autopilot-overnight.sh" "${OVERNIGHT_ARGS[@]}"
