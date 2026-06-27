# Senior dev ("it") — decisions

## 2026-06-25 — Bootstrap wiring

**Decision:** Map Telegram-bot `python -m orchestrator autopilot` pattern to BEATBOTS with a stdlib-only `orchestrator/` package instead of a separate Node runner.

**Decision:** Quality gate is `scripts/verify.sh` (Linux/macOS) and `scripts/verify.ps1` (Windows); both wrap syntax-check, signin-step-test, checkout-speed-test, and integration tests.

**Decision:** `@it` is the offline boss persona; overnight loads **`docs/autopilot/IT_LOOP_PROMPT.md`** (canonical; mirrors Telegram-bot `docs/autopilot/IT_LOOP_PROMPT.md`).

**Decision:** Active task pointer lives in `.autopilot/active-task.json` (gitignored). Default task: `docs/autopilot/overnight/repo-health.json`.

**Decision:** Broke circular dependency — `test-autopilot-cursor.sh` must not invoke `refresh-overnight-tasks.mjs` (req 2 verification calls the test script).

## Current state

- `bash scripts/verify.sh` — green
- `python -m orchestrator autopilot status` — 6 pending on repo-health (req 2 fails until refresh runs after merge; integration test itself passes)

## Next

Run `@it` or `./scripts/loop.sh --detach` with `CURSOR_API_KEY` for unattended overnight work.
