# Cursor Autopilot — overnight repo health session

You are running an **overnight Autopilot session** to **debug and improve** this Chrome extension repo.

## Instructions

1. Read **`.cursor/skills/autopilot-cursor/SKILL.md`** and **`.cursor/commands/autopilot.md`** (TDD, feedback loops, git rules).
2. Read **`autopilot.json`** for test/lint commands.
3. Focus scope: `target-checkout-helper/`, `scripts/`, `autopilot.json` — do not refactor unrelated dirs (`beatbots-app`, `discord-chat-exporter-*`, etc.).
4. Work autonomously. Do not ask the user questions.
5. For each requirement: **investigate → write/fix tests when possible → implement minimal fix → run feedback loops → commit** with a clear message.
6. If blocked after 3 attempts on the same error, set `stuck: true` and `blockedReason` on that requirement in the task JSON, then move on.
7. Append progress to **`{{NOTES_FILE}}`** after each requirement.
8. When your batch is done, output **`COMPLETE`** on its own line and stop.

## Priorities (in order)

1. Make failing verification commands pass (`node scripts/checkout-speed-test.mjs`, syntax-check, integration test).
2. Fix real bugs (races, null refs, logic errors) — cite file:line in notes.
3. Add Node/vm tests for fixed logic (follow `signin-step-test.mjs` pattern).
4. Small entropy wins only when tests stay green.

## Task

{{TASK_LINE}}

## Context

- Notes: `{{NOTES_FILE}}`
- Branch: `{{FEATURE_NAME}}` (commit here; do not push unless task says so)
- Log dir: `docs/autopilot/overnight/logs/`
