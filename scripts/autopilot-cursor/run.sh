#!/bin/bash
#
# run.sh - Token-frugal wrapper for Cursor Agent autopilot
#
# Runs autopilot with fresh context for each requirement by invoking
# `agent -p --force` in a loop, completing one requirement per session.
#
# Usage:
#   ./run.sh <taskfile.json> [options]    # Task file mode
#   ./run.sh /<command> [options]          # Command loop mode
#
# Options:
#   --batch N       Complete N requirements per session (default: 1, task mode only)
#   --max N         Maximum iterations/command runs (default: 10, command mode only)
#   --delay N       Seconds to wait between sessions (default: 2)
#   --model MODEL   Cursor model to use (e.g. sonnet-4, gpt-5)
#   --cleanup       Kill stale agent processes before starting
#   --dry-run       Show what would be done without executing
#   --help          Show this help message
#
# Examples:
#   ./run.sh docs/autopilot/feature.json
#   ./run.sh docs/autopilot/feature.json --batch 3
#   ./run.sh docs/autopilot/feature.json --model sonnet
#   ./run.sh docs/autopilot/feature.json --delay 5
#   ./run.sh /my-command --max 5
#   ./run.sh /review-pr 123 --max 3

set -e

# Resolve script directory for locating sibling scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Subcommand dispatch ───────────────────────────────────────────────────────
# Handle 'autopilot <subcommand> [args]' before normal argument parsing.
# Each subcommand lives in a sibling script named autopilot-<subcommand>.
if [[ $# -gt 0 && "${1:0:1}" != "-" && "${1:0:1}" != "/" && "$1" != *.json && "$1" != *.md ]]; then
    SUBCMD="$1"
    shift
    SUBCMD_SCRIPT="$SCRIPT_DIR/autopilot-${SUBCMD}"
    if [[ -x "$SUBCMD_SCRIPT" ]]; then
        exec "$SUBCMD_SCRIPT" "$@"
    else
        echo -e "${RED}Error: unknown subcommand '${SUBCMD}'${NC}"
        echo ""
        echo "Usage:"
        echo "  autopilot <taskfile.json>              # Run task loop"
        echo "  autopilot /<slash-command> [args]      # Run slash command loop"
        echo "  autopilot test-stories <domain-file>   # Test user stories"
        echo ""
        echo "Run 'autopilot --help' for full options."
        exit 1
    fi
fi

# --- Process cleanup helpers ---

# Get all descendant PIDs of a process (recursive)
get_descendants() {
    local pid=$1
    local children
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    for child in $children; do
        echo "$child"
        get_descendants "$child"
    done
}

# Kill a Cursor agent session and all its child processes
# Collects descendant PIDs before killing the parent (they reparent to init after)
kill_session() {
    local pid=$1

    if ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi

    # Collect all descendant PIDs BEFORE killing parent
    # (once parent dies, children reparent to init and we lose the tree)
    local descendants
    descendants=$(get_descendants "$pid")

    # Send SIGTERM to main process and all descendants
    kill -TERM "$pid" 2>/dev/null || true
    for desc in $descendants; do
        kill -TERM "$desc" 2>/dev/null || true
    done

    # Wait for graceful shutdown (up to 5 seconds)
    local waited=0
    while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 5 ]]; do
        sleep 1
        waited=$((waited + 1))
    done

    # Force kill any survivors
    kill -KILL "$pid" 2>/dev/null || true
    for desc in $descendants; do
        kill -KILL "$desc" 2>/dev/null || true
    done
}

# Kill stale agent processes from previous sessions
# Only targets background processes (no controlling terminal)
cleanup_stale_processes() {
    local patterns="(agent-cli|/\.local/bin/agent|cursor-agent)"
    local count=0
    local pids=""

    while IFS= read -r line; do
        local pid tty
        pid=$(echo "$line" | awk '{print $2}')
        tty=$(echo "$line" | awk '{print $7}')

        # Skip processes with a controlling terminal (active sessions)
        [[ "$tty" != "?" ]] && continue
        # Skip our own process
        [[ "$pid" == "$$" ]] && continue

        pids="$pids $pid"
        count=$((count + 1))
        local cmd
        cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i}' | head -c 80)
        echo -e "  ${YELLOW}Killing${NC} PID $pid: $cmd"
    done < <(ps aux 2>/dev/null | grep -E "$patterns" | grep -v -E "grep|run\.sh|cleanup\.sh" || true)

    if [[ $count -eq 0 ]]; then
        echo -e "${GREEN}No stale processes found${NC}"
        return 0
    fi

    # Wait briefly, then force kill survivors
    sleep 2
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done
    echo -e "${GREEN}Cleaned up $count stale process(es)${NC}"
}

# --- End process cleanup helpers ---

# Default values
BATCH_SIZE="1"  # Default: 1 requirement per session (fresh context)
MAX_ITERATIONS=10  # Default: 10 iterations for command mode
DELAY=2
DRY_RUN=false
CLEANUP=false
MODEL=""  # Empty means Cursor default model
TASKFILE=""
COMMAND=""  # Slash command for command loop mode
COMMAND_ARGS=""  # Arguments for the slash command
MODE="task"  # "task" or "command"

# PID file — set after mode/taskfile are known (see path setup block below)
PID_FILE=""
STOP_REQUESTED=false
CURRENT_AGENT_PID=""

# Signal handler for graceful shutdown
handle_stop() {
    STOP_REQUESTED=true
}

trap handle_stop SIGUSR1 SIGINT SIGTERM

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --batch)
            BATCH_SIZE="$2"
            shift 2
            ;;
        --max)
            MAX_ITERATIONS="$2"
            shift 2
            ;;
        --delay)
            DELAY="$2"
            shift 2
            ;;
        --model)
            MODEL="$2"
            shift 2
            ;;
        --cleanup)
            CLEANUP=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            echo "run.sh - Token-frugal wrapper for Cursor Agent autopilot"
            echo ""
            echo "Usage:"
            echo "  ./run.sh <taskfile.json> [options]    # Task file mode"
            echo "  ./run.sh /<command> [args] [options]  # Command loop mode"
            echo ""
            echo "Options:"
            echo "  --batch N       Complete N requirements per session (default: 1, task mode)"
            echo "  --max N         Maximum command runs (default: 10, command mode)"
            echo "  --delay N       Seconds to wait between sessions (default: 2)"
            echo "  --model MODEL   Cursor model (e.g. sonnet-4, gpt-5)"
            echo "  --cleanup       Kill stale agent processes before starting"
            echo "  --dry-run       Show what would be done without executing"
            echo "  --help          Show this help message"
            echo ""
            echo "Task mode runs Cursor Autopilot in a loop, starting a fresh"
            echo "session for each batch of requirements."
            echo ""
            echo "Command mode runs a slash command repeatedly with fresh sessions."
            echo "Example: ./run.sh /my-command --max 5"
            echo ""
            echo "Requirements:"
            echo "  - Cursor Agent CLI (agent) installed and authenticated"
            echo "  - Task file must be valid JSON with 'requirements' array (task mode)"
            exit 0
            ;;
        -*)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
        /*)
            # Slash command - switch to command mode
            if [[ -z "$COMMAND" ]]; then
                COMMAND="$1"
                MODE="command"
            else
                # Additional argument for the command
                COMMAND_ARGS="$COMMAND_ARGS $1"
            fi
            shift
            ;;
        *)
            if [[ "$MODE" == "command" ]]; then
                # Argument for the slash command
                COMMAND_ARGS="$COMMAND_ARGS $1"
            elif [[ -z "$TASKFILE" ]]; then
                TASKFILE="$1"
            else
                echo -e "${RED}Unexpected argument: $1${NC}"
                exit 1
            fi
            shift
            ;;
    esac
done

# Check for required dependencies
if ! command -v agent &> /dev/null; then
    echo -e "${RED}Error: Cursor Agent CLI is required but not installed${NC}"
    echo ""
    echo "Install Cursor CLI:"
    echo "  curl https://cursor.com/install -fsS | bash"
    echo ""
    echo "Authenticate:"
    echo "  export CURSOR_API_KEY=your_key   # or: agent login"
    echo ""
    echo "Docs: https://cursor.com/docs/cli/headless"
    exit 1
fi

# Mode-specific validation
if [[ "$MODE" == "command" ]]; then
    # Command mode validation
    if [[ -z "$COMMAND" ]]; then
        echo -e "${RED}Error: No command specified${NC}"
        echo "Usage: ./run.sh /<command> [args] [options]"
        exit 1
    fi
else
    # Task mode validation - requires jq and valid task file
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is required but not installed${NC}"
        echo ""
        echo "Install jq using your package manager:"
        echo "  macOS:   brew install jq"
        echo "  Ubuntu:  sudo apt-get install jq"
        echo "  Fedora:  sudo dnf install jq"
        echo "  Arch:    sudo pacman -S jq"
        echo ""
        echo "Or visit: https://jqlang.github.io/jq/download/"
        exit 1
    fi

    if [[ -z "$TASKFILE" ]]; then
        echo -e "${RED}Error: No task file or command specified${NC}"
        echo "Usage:"
        echo "  ./run.sh <taskfile.json> [options]    # Task file mode"
        echo "  ./run.sh /<command> [args] [options]  # Command loop mode"
        exit 1
    fi

    if [[ ! -f "$TASKFILE" ]]; then
        echo -e "${RED}Error: Task file not found: $TASKFILE${NC}"
        echo ""
        echo "Common task file locations:"
        echo "  docs/autopilot/<feature>.json"
        echo "  tasks/<feature>.json"
        echo ""
        echo "Run '/tasks <prd-file.md>' to generate a task file from a PRD."
        exit 1
    fi

    # Validate task file is valid JSON with requirements array
    if ! jq empty "$TASKFILE" 2>/dev/null; then
        echo -e "${RED}Error: Task file is not valid JSON: $TASKFILE${NC}"
        echo ""
        echo "Check for syntax errors like:"
        echo "  - Missing commas between items"
        echo "  - Unclosed brackets or braces"
        echo "  - Trailing commas before closing brackets"
        echo ""
        echo "Validate with: jq . $TASKFILE"
        exit 1
    fi

    if ! jq -e '.requirements' "$TASKFILE" >/dev/null 2>&1; then
        echo -e "${RED}Error: Task file missing 'requirements' array: $TASKFILE${NC}"
        echo ""
        echo "Task files must have a 'requirements' array. Example:"
        echo '  { "requirements": [{ "id": "1", "description": "..." }] }'
        echo ""
        echo "Run '/tasks <prd-file.md>' to generate a valid task file."
        exit 1
    fi
fi

# --- Path setup: per-feature dirs for task mode, shared .autopilot/ for command mode ---
if [[ "$MODE" == "task" ]]; then
    FEATURE_DIR=$(dirname "$TASKFILE")
    mkdir -p "$FEATURE_DIR"
    PID_FILE="$FEATURE_DIR/run.pid"
    STOP_SIGNAL_FILE="$FEATURE_DIR/stop-signal"
    LOOP_STATE_FILE="$FEATURE_DIR/loop-state.md"
    export AUTOPILOT_STATE_DIR="$FEATURE_DIR"
else
    mkdir -p .autopilot
    PID_FILE=".autopilot/command.pid"
    STOP_SIGNAL_FILE=".autopilot/stop-signal"
    LOOP_STATE_FILE=".autopilot/loop-state.md"
    export AUTOPILOT_STATE_DIR=".autopilot"
fi

# Check if another instance is running
if [[ -f "$PID_FILE" ]]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo -e "${RED}Error: Another autopilot instance is running (PID $OLD_PID)${NC}"
        echo -e "${YELLOW}Use '/autopilot stop' to stop it, or 'kill -USR1 $OLD_PID'${NC}"
        exit 1
    else
        echo -e "${YELLOW}Removed stale PID file${NC}"
    fi
fi

# Write our PID and ensure cleanup on exit
echo $$ > "$PID_FILE"

cleanup_on_exit() {
    # Kill any running agent session and its children
    if [[ -n "$CURRENT_AGENT_PID" ]] && kill -0 "$CURRENT_AGENT_PID" 2>/dev/null; then
        echo -e "\n${YELLOW}Cleaning up Cursor agent session (PID $CURRENT_AGENT_PID)...${NC}" >&2
        kill_session "$CURRENT_AGENT_PID"
        wait "$CURRENT_AGENT_PID" 2>/dev/null || true
    fi
    # Sweep for any daemonized children that escaped the process tree
    # (MCP servers started with --daemon double-fork and reparent to init)
    cleanup_stale_processes
    rm -f "$PID_FILE"
}
trap cleanup_on_exit EXIT

# Clean up any stale stop signal file from previous runs
rm -f "$STOP_SIGNAL_FILE"

# Run stale process cleanup if requested
if [[ "$CLEANUP" == "true" ]]; then
    echo -e "${BLUE}Cleaning up stale processes...${NC}"
    cleanup_stale_processes
    echo ""
fi

# Function to check for stop signal (either SIGUSR1 or sentinel file)
check_stop() {
    if [[ "$STOP_REQUESTED" == "true" ]]; then
        echo ""
        echo -e "${YELLOW}Stop signal received (SIGUSR1)${NC}"
        echo -e "${YELLOW}Stopping autopilot loop...${NC}"
        return 0
    fi
    if [[ -f "$STOP_SIGNAL_FILE" ]]; then
        echo ""
        echo -e "${GREEN}Stop signal received (sentinel file)${NC}"
        echo -e "${GREEN}Autopilot requested exit.${NC}"
        rm -f "$STOP_SIGNAL_FILE"
        return 0
    fi
    return 1
}

# Function to count incomplete requirements
count_incomplete() {
    # Count requirements where passes is false/missing AND not stuck AND not invalidTest
    local count
    count=$(jq '[.requirements[] | select(.passes != true and .stuck != true and .invalidTest != true)] | length' "$TASKFILE" 2>/dev/null || echo "0")
    echo "$count"
}

# Function to count completed requirements
count_completed() {
    local count
    count=$(jq '[.requirements[] | select(.passes == true)] | length' "$TASKFILE" 2>/dev/null || echo "0")
    echo "$count"
}

# Function to count stuck requirements
count_stuck() {
    local count
    count=$(jq '[.requirements[] | select(.stuck == true)] | length' "$TASKFILE" 2>/dev/null || echo "0")
    echo "$count"
}

# Function to count total requirements
count_total() {
    local count
    count=$(jq '.requirements | length' "$TASKFILE" 2>/dev/null || echo "0")
    echo "$count"
}

# Print status
print_status() {
    local total completed stuck incomplete
    total=$(count_total)
    completed=$(count_completed)
    stuck=$(count_stuck)
    incomplete=$(count_incomplete)

    echo -e "${BLUE}----------------------------------------${NC}"
    echo -e "${BLUE}Task File:${NC} $TASKFILE"
    echo -e "${GREEN}Completed:${NC} $completed / $total"
    echo -e "${YELLOW}Stuck:${NC} $stuck"
    echo -e "${BLUE}Remaining:${NC} $incomplete"
    echo -e "${BLUE}----------------------------------------${NC}"
}

# Build Cursor Agent CLI options
AGENT_OPTS=(-p --force --output-format text)
if [[ -n "$MODEL" ]]; then
    AGENT_OPTS+=(--model "$MODEL")
fi

# Render session prompt from template
build_session_prompt() {
    local task_line="$1"
    local notes_file="$2"
    local state_dir="$3"
    local feature_name="$4"
    local template="$SCRIPT_DIR/session-prompt.md"
    if [[ ! -f "$template" ]]; then
        echo "Follow .cursor/commands/autopilot.md. Task: $task_line"
        return
    fi
    sed \
        -e "s|{{TASK_LINE}}|${task_line//|/\\|}|g" \
        -e "s|{{NOTES_FILE}}|${notes_file//|/\\|}|g" \
        -e "s|{{STATE_DIR}}|${state_dir//|/\\|}|g" \
        -e "s|{{FEATURE_NAME}}|${feature_name//|/\\|}|g" \
        "$template"
}

# ============================================================================
# COMMAND MODE LOOP
# ============================================================================
if [[ "$MODE" == "command" ]]; then
    FULL_COMMAND="$COMMAND$COMMAND_ARGS"

    echo -e "${GREEN}Starting run.sh (command mode)${NC}"
    echo -e "Command: ${FULL_COMMAND}"
    echo -e "Max iterations: ${MAX_ITERATIONS}"
    echo -e "Delay between sessions: ${DELAY}s"
    if [[ -n "$MODEL" ]]; then
        echo -e "Model: ${MODEL}"
    fi
    echo ""

    ITERATION=0

    while [[ "$ITERATION" -lt "$MAX_ITERATIONS" ]]; do
        # Check for stop signal
        if check_stop; then
            echo -e "${BLUE}----------------------------------------${NC}"
            echo -e "${BLUE}Command:${NC} $FULL_COMMAND"
            echo -e "${GREEN}Completed:${NC} $ITERATION / $MAX_ITERATIONS iterations"
            echo -e "${BLUE}----------------------------------------${NC}"
            break
        fi

        ITERATION=$((ITERATION + 1))
        echo ""
        echo -e "${BLUE}=== Iteration $ITERATION of $MAX_ITERATIONS ===${NC}"
        echo -e "${BLUE}Running:${NC} $FULL_COMMAND"

        if [[ "$DRY_RUN" == "true" ]]; then
            echo -e "${YELLOW}[DRY RUN] Would execute:${NC}"
            echo "  agent ${AGENT_OPTS[*]} \"<session prompt>\""
            echo ""
            echo -e "${YELLOW}Simulating command execution...${NC}"
            if [[ $ITERATION -ge 3 ]]; then
                echo -e "${YELLOW}[DRY RUN] Stopping after 3 simulated iterations${NC}"
                break
            fi
        else
            echo -e "${BLUE}Starting Cursor Agent session...${NC}"
            echo ""

            # Create loop state file to instruct agent to run command and exit
            cat > "$LOOP_STATE_FILE" << LOOPSTATE
---
iteration: 1
max_iterations: 1
completion_promise: COMPLETE
command: $FULL_COMMAND
---

Run the slash command $FULL_COMMAND.

After the command completes, immediately output COMPLETE and exit. Do not wait for user input.
LOOPSTATE

            # Run agent with the command wrapped in autonomous instructions
            PROMPT=$(build_session_prompt "Run slash command: $FULL_COMMAND" "n/a" "$AUTOPILOT_STATE_DIR" "command-loop")
            agent "${AGENT_OPTS[@]}" "$PROMPT" &
            AGENT_PID=$!
            CURRENT_AGENT_PID=$AGENT_PID

            # Wait for agent to finish
            IDLE_SECONDS=0
            while kill -0 "$AGENT_PID" 2>/dev/null; do
                if [[ "$STOP_REQUESTED" == "true" ]]; then
                    kill_session "$AGENT_PID"
                    wait "$AGENT_PID" 2>/dev/null || true
                    CURRENT_AGENT_PID=""
                    rm -f "$LOOP_STATE_FILE"
                    echo -e "${YELLOW}Stopped${NC}"
                    exit 0
                fi

                # Check for sentinel stop file
                if [[ -f "$STOP_SIGNAL_FILE" ]]; then
                    kill_session "$AGENT_PID"
                    wait "$AGENT_PID" 2>/dev/null || true
                    CURRENT_AGENT_PID=""
                    rm -f "$STOP_SIGNAL_FILE" "$LOOP_STATE_FILE"
                    echo -e "${GREEN}Command signaled completion${NC}"
                    break
                fi

                # Timeout after 10 minutes of no activity
                IDLE_SECONDS=$((IDLE_SECONDS + 2))
                if [[ "$IDLE_SECONDS" -ge 600 ]]; then
                    echo -e "${YELLOW}Timeout - terminating session${NC}"
                    kill_session "$AGENT_PID"
                    break
                fi

                sleep 2
            done

            wait "$AGENT_PID" 2>/dev/null || true
            AGENT_EXIT=$?
            CURRENT_AGENT_PID=""
            rm -f "$LOOP_STATE_FILE"

            # Sweep for daemonized children that escaped kill_session
            cleanup_stale_processes

            echo ""
            if [[ "$AGENT_EXIT" -eq 0 ]]; then
                echo -e "${GREEN}Iteration $ITERATION complete${NC}"
            else
                echo -e "${YELLOW}Iteration $ITERATION exited with code $AGENT_EXIT${NC}"
            fi

            # Check for stop signal after session completes
            if check_stop; then
                echo -e "${BLUE}----------------------------------------${NC}"
                echo -e "${BLUE}Command:${NC} $FULL_COMMAND"
                echo -e "${GREEN}Completed:${NC} $ITERATION / $MAX_ITERATIONS iterations"
                echo -e "${BLUE}----------------------------------------${NC}"
                break
            fi
        fi

        # Brief pause between sessions if more iterations remain
        if [[ "$ITERATION" -lt "$MAX_ITERATIONS" ]]; then
            echo -e "${BLUE}Waiting ${DELAY}s before next iteration...${NC}"
            sleep "$DELAY"
        fi
    done

    echo ""
    echo -e "${GREEN}run.sh finished (command mode)${NC}"
    echo -e "${BLUE}----------------------------------------${NC}"
    echo -e "${BLUE}Command:${NC} $FULL_COMMAND"
    echo -e "${GREEN}Completed:${NC} $ITERATION / $MAX_ITERATIONS iterations"
    echo -e "${BLUE}----------------------------------------${NC}"
    exit 0
fi

# ============================================================================
# TASK MODE LOOP
# ============================================================================
echo -e "${GREEN}Starting run.sh${NC}"
echo -e "Batch size: ${BATCH_SIZE} requirement(s) per session"
echo -e "Delay between sessions: ${DELAY}s"
if [[ -n "$MODEL" ]]; then
    echo -e "Model: ${MODEL}"
fi
echo ""

SESSION=0

while true; do
    # Check for stop signal
    if check_stop; then
        print_status
        break
    fi

    # Check how many requirements remain
    INCOMPLETE=$(count_incomplete)

    if [[ "$INCOMPLETE" -eq 0 ]]; then
        echo ""
        echo -e "${GREEN}All requirements complete!${NC}"
        print_status
        break
    fi

    SESSION=$((SESSION + 1))
    echo ""
    echo -e "${BLUE}=== Session $SESSION ===${NC}"
    print_status

    # Build the autopilot task line (Cursor @autopilot equivalent)
    AUTOPILOT_CMD="@autopilot $TASKFILE"
    if [[ -n "$BATCH_SIZE" ]]; then
        AUTOPILOT_CMD="$AUTOPILOT_CMD --batch $BATCH_SIZE"
    fi
    TASKNAME_STEM=$(basename "$TASKFILE" .json | sed 's/\.md$//')
    NOTES_FILE="$(dirname "$TASKFILE")/${TASKNAME_STEM}-notes.md"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${YELLOW}[DRY RUN] Would execute:${NC}"
        echo "  agent ${AGENT_OPTS[*]} \"<session prompt for $AUTOPILOT_CMD>\""
        echo ""
        echo -e "${YELLOW}Simulating completion of ${BATCH_SIZE:-all} requirement(s)...${NC}"
        # In dry run, we'd need to manually exit
        if [[ $SESSION -ge 3 ]]; then
            echo -e "${YELLOW}[DRY RUN] Stopping after 3 simulated sessions${NC}"
            break
        fi
    else
        echo -e "${BLUE}Starting Cursor Agent session...${NC}"
        echo ""

        # Track progress before session
        COMPLETED_BEFORE=$(count_completed)
        STUCK_BEFORE=$(count_stuck)

        # Track session start time for analytics
        SESSION_START_EPOCH=$(date +%s)

        PROMPT=$(build_session_prompt "$AUTOPILOT_CMD" "$NOTES_FILE" "$AUTOPILOT_STATE_DIR" "$TASKNAME_STEM")
        agent "${AGENT_OPTS[@]}" "$PROMPT" &
        AGENT_PID=$!
        CURRENT_AGENT_PID=$AGENT_PID

        # Monitor for batch completion by checking task JSON
        IDLE_TIMEOUT=600  # 10 minutes with no progress = assume stuck
        LAST_PROGRESS=0
        IDLE_SECONDS=0

        while kill -0 "$AGENT_PID" 2>/dev/null; do
            # Check for manual stop request
            if [[ "$STOP_REQUESTED" == "true" ]]; then
                echo ""
                echo -e "${YELLOW}Stop signal received - terminating session...${NC}"
                kill_session "$AGENT_PID"
                wait "$AGENT_PID" 2>/dev/null || true
                CURRENT_AGENT_PID=""
                print_status
                echo -e "${GREEN}run.sh stopped${NC}"
                exit 0
            fi

            # Check for sentinel stop file
            if [[ -f "$STOP_SIGNAL_FILE" ]]; then
                echo ""
                echo -e "${GREEN}All requirements complete - stopping...${NC}"
                kill_session "$AGENT_PID"
                wait "$AGENT_PID" 2>/dev/null || true
                CURRENT_AGENT_PID=""
                rm -f "$STOP_SIGNAL_FILE"
                print_status
                echo -e "${GREEN}run.sh finished${NC}"
                exit 0
            fi

            # Check task JSON for batch completion
            CURRENT_COMPLETED=$(count_completed)
            CURRENT_STUCK=$(count_stuck)
            PROGRESS=$((CURRENT_COMPLETED + CURRENT_STUCK - COMPLETED_BEFORE - STUCK_BEFORE))

            if [[ "$PROGRESS" -ge "$BATCH_SIZE" ]]; then
                sleep 2  # Give agent a moment to finish output
                echo ""
                echo -e "${GREEN}Batch complete ($PROGRESS requirement(s)) - terminating for fresh context...${NC}"
                kill_session "$AGENT_PID"
                rm -f "$LOOP_STATE_FILE"
                break
            fi

            # Track idle time - restart if progress made but now idle
            if [[ "$PROGRESS" -gt "$LAST_PROGRESS" ]]; then
                LAST_PROGRESS=$PROGRESS
                IDLE_SECONDS=0
            else
                IDLE_SECONDS=$((IDLE_SECONDS + 2))
                # If we made progress and now idle for 30s, restart for fresh context
                if [[ "$PROGRESS" -gt 0 && "$IDLE_SECONDS" -ge 30 ]]; then
                    echo ""
                    echo -e "${GREEN}Progress made ($PROGRESS requirement(s)) - restarting for fresh context...${NC}"
                    kill_session "$AGENT_PID"
                    rm -f "$LOOP_STATE_FILE"
                    break
                fi
                # No progress at all and idle too long = stuck
                if [[ "$PROGRESS" -eq 0 && "$IDLE_SECONDS" -ge "$IDLE_TIMEOUT" ]]; then
                    echo ""
                    echo -e "${YELLOW}No progress for ${IDLE_TIMEOUT}s - terminating idle session...${NC}"
                    kill_session "$AGENT_PID"
                    rm -f "$LOOP_STATE_FILE"
                    break
                fi
            fi

            sleep 2
        done

        # Wait for agent to finish
        wait "$AGENT_PID" 2>/dev/null || true
        AGENT_EXIT=$?
        CURRENT_AGENT_PID=""

        # Sweep for daemonized children that escaped kill_session
        cleanup_stale_processes

        # --- Update analytics from ground truth ---
        if command -v jq &>/dev/null; then
            # Derive analytics directory from task file location
            # e.g., "docs/autopilot/user-auth/user-auth.json" → "docs/autopilot/user-auth/analytics"
            TASKNAME_STEM=$(basename "$TASKFILE" .json | sed 's/\.md$//')
            ANALYTICS_DIR="$(dirname "$TASKFILE")/analytics"

            # Find most recent analytics file matching task name
            if [[ -d "$ANALYTICS_DIR" ]]; then
                ANALYTICS_FILE=$(ls -t "${ANALYTICS_DIR}/"*"${TASKNAME_STEM}"*.json 2>/dev/null | head -1 || true)
                if [[ -n "$ANALYTICS_FILE" && -f "$ANALYTICS_FILE" ]]; then
                    UPDATE_SCRIPT="$SCRIPT_DIR/hooks/update-analytics.sh"
                    if [[ -x "$UPDATE_SCRIPT" ]]; then
                        "$UPDATE_SCRIPT" "$ANALYTICS_FILE" "$TASKFILE" "$SESSION_START_EPOCH" || true
                    fi
                fi
            fi
        fi

        echo ""

        # Track progress after session
        COMPLETED_AFTER=$(count_completed)
        STUCK_AFTER=$(count_stuck)
        COMPLETED_THIS_SESSION=$((COMPLETED_AFTER - COMPLETED_BEFORE))
        STUCK_THIS_SESSION=$((STUCK_AFTER - STUCK_BEFORE))

        # Show session result
        if [[ "$AGENT_EXIT" -eq 0 ]]; then
            echo -e "${GREEN}Session $SESSION complete${NC}"
        else
            echo -e "${YELLOW}Session $SESSION exited with code $AGENT_EXIT${NC}"
        fi

        # Show progress made this session
        if [[ "$COMPLETED_THIS_SESSION" -gt 0 ]]; then
            echo -e "${GREEN}  + $COMPLETED_THIS_SESSION requirement(s) completed${NC}"
        fi
        if [[ "$STUCK_THIS_SESSION" -gt 0 ]]; then
            echo -e "${YELLOW}  + $STUCK_THIS_SESSION requirement(s) stuck${NC}"
        fi
        if [[ "$COMPLETED_THIS_SESSION" -eq 0 && "$STUCK_THIS_SESSION" -eq 0 ]]; then
            echo -e "${YELLOW}  No progress this session (may need manual intervention)${NC}"
        fi

        # Check for stop signal after session completes
        if check_stop; then
            print_status
            break
        fi
    fi

    # Brief pause between sessions if more requirements remain than batch size
    if [[ "$INCOMPLETE" -gt "$BATCH_SIZE" ]]; then
        echo -e "${BLUE}Waiting ${DELAY}s before next session...${NC}"
        sleep "$DELAY"
    fi
done

echo ""
echo -e "${GREEN}run.sh finished${NC}"
print_status
