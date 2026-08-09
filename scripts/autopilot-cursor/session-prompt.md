# Cursor Autopilot session

You are running an **Autopilot TDD session** in Cursor (not Claude Code).

## Instructions

1. Read and follow **`.cursor/commands/autopilot.md`** — that is the full Autopilot spec (TDD phases, feedback loops, git rules, stuck handling).
2. Read **`autopilot.json`** in the project root for feedback-loop commands and iteration limits.
3. Execute the task below autonomously. Do not ask the user questions; make reasonable choices.
4. When your batch is done (requirements marked `passes: true` or `stuck: true` per batch limit), output **`COMPLETE`** on its own line and stop.

## Task

{{TASK_LINE}}

## Notes

- Notes file: `{{NOTES_FILE}}` (create or update with progress)
- State directory: `{{STATE_DIR}}`
- Feature branch: create or checkout `{{FEATURE_NAME}}` before committing
- Use `git add <specific-files>` — never `git add -A` when parallel agents may run
- Run feedback loops from `autopilot.json` before each commit
