#!/usr/bin/env bash
#
# Drop-prep overnight — automated debug cycles until after the drop.
# No user at PC required for Node + browser-smoke gates.
#
# Usage:
#   ./scripts/drop-prep-tonight.sh --detach
#   TCH_DROP_EXPECTED_AT="2026-06-26T08:00:00.000Z" ./scripts/drop-prep-tonight.sh --detach
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DETACH=false
CYCLE_SECS="${TCH_DROP_CYCLE_SECS:-1200}"
MAX_HOURS="${TCH_DROP_MAX_HOURS:-8}"
TASK_FILE="docs/autopilot/overnight/drop-prep-4am.json"
LOG_DIR="$ROOT/docs/autopilot/overnight/logs"
STOP_FILE="$ROOT/docs/autopilot/overnight/stop-signal"

# Default: next 4:00 in TCH_DROP_TZ (override with TCH_DROP_EXPECTED_AT)
export TCH_DROP_EXPECTED_AT="${TCH_DROP_EXPECTED_AT:-$(node -e "
const tz = process.env.TCH_DROP_TZ || 'America/New_York';
function tzParts(ms) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, +x.value])
  );
}
let t = Date.now() + 60_000;
for (let i = 0; i < 2880; i++) {
  const p = tzParts(t);
  if (p.hour === 4 && p.minute === 0) {
    console.log(new Date(t).toISOString());
    process.exit(0);
  }
  t += 60_000;
}
console.log('2026-06-26T08:00:00.000Z');
" 2>/dev/null || echo "2026-06-26T08:00:00.000Z")}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --detach) DETACH=true; shift ;;
    --foreground) DETACH=false; shift ;;
    --help|-h)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) shift ;;
  esac
done

run_loop() {
  cd "$ROOT"
  export PATH="$HOME/.local/bin:$HOME/.cursor/bin:$PATH"
  mkdir -p "$LOG_DIR"
  local log="$LOG_DIR/drop-prep-$(date +%Y%m%d-%H%M%S).log"
  local started=$(date +%s)
  local max_end=$((started + MAX_HOURS * 3600))
  local drop_epoch
  drop_epoch=$(node -e "const t=Date.parse(process.env.TCH_DROP_EXPECTED_AT||''); console.log(Number.isFinite(t)?Math.floor(t/1000):0)")

  {
    echo "=== Drop prep overnight (@it) ==="
    echo "Started: $(date -Is)"
    echo "Drop target: $TCH_DROP_EXPECTED_AT"
    echo "Cycle every: ${CYCLE_SECS}s"
    echo "Task: $TASK_FILE"
    echo ""
    python3 -m orchestrator autopilot use "$TASK_FILE" || true
    "$ROOT/scripts/checkout-sandbox-setup.sh" || true

    while [[ $(date +%s) -lt $max_end ]]; do
      if [[ -f "$STOP_FILE" ]]; then
        echo "Stop signal — exiting"
        break
      fi
      now=$(date +%s)
      if [[ "$drop_epoch" -gt 0 ]] && [[ $now -gt $((drop_epoch + 5400)) ]]; then
        echo "Past drop + 90m — stopping"
        break
      fi

      echo "--- Cycle $(date -Is) ---"
      node "$ROOT/scripts/drop-prep-cycle.mjs" || true

      if [[ -n "${CURSOR_API_KEY:-}" ]] && command -v autopilot-cursor >/dev/null; then
        echo "Agent batch (one requirement)..."
        autopilot-cursor "$TASK_FILE" --batch 1 || true
      else
        echo "Agent batch skipped (no CURSOR_API_KEY — Node cycles only)"
      fi

      sleep "$CYCLE_SECS"
    done

    echo "=== Drop prep finished $(date -Is) ==="
  } 2>&1 | tee -a "$log"
}

if [[ "$DETACH" == true ]]; then
  SESSION="drop-prep-tonight"
  if tmux -f /exec-daemon/tmux.portal.conf has-session -t "$SESSION" 2>/dev/null; then
    echo "tmux session $SESSION already running"
    exit 0
  fi
  tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$SESSION" -c "$ROOT" -- "${SHELL:-bash}" -lc "
    export TCH_DROP_EXPECTED_AT='$TCH_DROP_EXPECTED_AT'
    export TCH_DROP_CYCLE_SECS='$CYCLE_SECS'
    export TCH_DROP_MAX_HOURS='$MAX_HOURS'
    '$ROOT/scripts/drop-prep-tonight.sh' --foreground
  "
  echo "Detached: tmux attach -t $SESSION"
else
  run_loop
fi
