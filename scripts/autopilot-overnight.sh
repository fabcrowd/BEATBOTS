#!/usr/bin/env bash
#
# Overnight unattended Autopilot — debug & improve the repo while you sleep.
#
# Usage:
#   ./scripts/autopilot-overnight.sh              # run in foreground (8h max)
#   ./scripts/autopilot-overnight.sh --detach     # tmux session "autopilot-overnight"
#   ./scripts/autopilot-overnight.sh --max-hours 6 --model sonnet-4
#   ./scripts/autopilot-overnight.sh --dry-run
#
# Requires on the HOST machine:
#   export CURSOR_API_KEY=...   OR   agent login
#   curl https://cursor.com/install | bash   (for agent CLI)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_FILE="${AUTOPILOT_LOOP_TASK_FILE:-docs/autopilot/overnight/repo-health.json}"
FEATURE_DIR="$(dirname "$TASK_FILE")"
LOG_DIR="$FEATURE_DIR/logs"
NOTES_FILE="$FEATURE_DIR/$(basename "$TASK_FILE" .json)-notes.md"
if [[ ! -f "$NOTES_FILE" && "$FEATURE_DIR" == *overnight* ]]; then
  NOTES_FILE="$FEATURE_DIR/overnight-notes.md"
fi
MAX_HOURS=8
DETACH=false
# Never inherit DRY_RUN from parent shell/CI — only explicit --dry-run enables simulation
unset DRY_RUN 2>/dev/null || true
DRY_RUN=false
EXTRA_ARGS=()

export PATH="$HOME/.local/bin:$PATH"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --detach) DETACH=true; shift ;;
    --max-hours) MAX_HOURS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; EXTRA_ARGS+=(--dry-run); shift ;;
    --model) EXTRA_ARGS+=(--model "$2"); shift 2 ;;
    --batch) EXTRA_ARGS+=(--batch "$2"); shift 2 ;;
    --help|-h)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

run_overnight() {
  cd "$ROOT"
  mkdir -p "$LOG_DIR"
  local log_file="$LOG_DIR/$(date +%Y-%m-%d-%H%M%S).log"
  local branch="cursor/overnight-$(date +%Y%m%d)"

  echo "=== Autopilot overnight run ===" | tee -a "$log_file"
  echo "Started: $(date -Is)" | tee -a "$log_file"
  echo "Log: $log_file" | tee -a "$log_file"

  # Install / verify
  "$ROOT/scripts/install-autopilot-cursor.sh" 2>&1 | tee -a "$log_file"

  if ! command -v agent >/dev/null 2>&1; then
    echo "ERROR: Cursor agent CLI not found. Run: curl https://cursor.com/install -fsS | bash" | tee -a "$log_file"
    exit 1
  fi

  if [[ "$DRY_RUN" != true ]]; then
    if [[ -z "${CURSOR_API_KEY:-}" ]]; then
      if ! agent -p "reply ok" >/dev/null 2>&1; then
        echo "ERROR: Not authenticated. Set CURSOR_API_KEY or run: agent login" | tee -a "$log_file"
        exit 1
      fi
    fi
  else
    echo "DRY RUN: skipping agent auth check" | tee -a "$log_file"
  fi

  # Refresh task file (reset recurring audits, verify baselines)
  node "$ROOT/scripts/refresh-overnight-tasks.mjs" 2>&1 | tee -a "$log_file"

  # Feature branch
  if git rev-parse --git-dir >/dev/null 2>&1; then
    git checkout -b "$branch" 2>/dev/null || git checkout "$branch" 2>&1 | tee -a "$log_file"
  fi

  touch "$NOTES_FILE"

  export AUTOPILOT_PROMPT_TEMPLATE="$ROOT/docs/autopilot/IT_LOOP_PROMPT.md"
  export AUTOPILOT_STATE_DIR="$ROOT/$FEATURE_DIR"

  local incomplete
  incomplete=$(jq '[.requirements[] | select(.passes != true and .stuck != true)] | length' "$TASK_FILE")
  echo "Incomplete requirements: $incomplete" | tee -a "$log_file"

  if [[ "$incomplete" -eq 0 ]]; then
    echo "Nothing to do — all requirements complete or stuck." | tee -a "$log_file"
    exit 0
  fi

  echo "Running autopilot-cursor (max ${MAX_HOURS}h)..." | tee -a "$log_file"

  set +e
  timeout "$((MAX_HOURS * 3600))" \
    autopilot-cursor "$TASK_FILE" --batch 1 --delay 3 "${EXTRA_ARGS[@]}" \
    2>&1 | tee -a "$log_file"
  local exit_code=${PIPESTATUS[0]}
  set -e

  echo "Finished: $(date -Is) exit=$exit_code" | tee -a "$log_file"
  jq '[.requirements[] | {id, passes, stuck, blockedReason}]' "$TASK_FILE" | tee -a "$log_file"

  exit "$exit_code"
}

if [[ "$DETACH" == true ]]; then
  SESSION="autopilot-overnight"
  TMUX_CONF="${TMUX_CONF:-/exec-daemon/tmux.portal.conf}"
  if tmux -f "$TMUX_CONF" has-session -t "$SESSION" 2>/dev/null; then
    echo "tmux session '$SESSION' already running. Attach: tmux -f $TMUX_CONF attach -t $SESSION"
    exit 0
  fi
  tmux -f "$TMUX_CONF" new-session -d -s "$SESSION" -c "$ROOT" -- "${SHELL:-bash}" -lc \
    "./scripts/autopilot-overnight.sh --max-hours $MAX_HOURS ${DRY_RUN:+--dry-run} ${EXTRA_ARGS[*]:-}; echo DONE; sleep 5"
  echo "Started overnight autopilot in tmux session: $SESSION"
  echo "  Attach:  tmux -f $TMUX_CONF attach -t $SESSION"
  echo "  Logs:    ls -t $LOG_DIR/*.log | head -1"
else
  run_overnight
fi
