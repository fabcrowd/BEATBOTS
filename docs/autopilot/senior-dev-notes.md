# Senior dev ("it") — decisions

## 2026-06-27 — Consolidated release handoff

**Decision:** Single PR `cursor/release-handoff-4bbd` → `main` supersedes #28–#34; handoff for next LLM in `docs/autopilot/HANDOFF.md`.

**Decision:** Extension ships at **v2.5.0** (anti-detection + stock monitor P1/P2 + overnight IT loop).

**Decision:** Overnight loop requires real `CURSOR_API_KEY`; `autopilot-overnight.sh` unsets inherited `DRY_RUN` so unauthenticated runs exit instead of simulating.

**State:** `bash scripts/verify.sh` green; `stock-monitor-research.json` 6/6; `stock-monitor-phase2.json` 3/3; `repo-health.json` refreshed (0/6 pending).

## 2026-06-25 — Bootstrap wiring

**Decision:** Map Telegram-bot `python -m orchestrator autopilot` pattern to BEATBOTS with a stdlib-only `orchestrator/` package instead of a separate Node runner.

**Decision:** Quality gate is `scripts/verify.sh` (Linux/macOS) and `scripts/verify.ps1` (Windows); both wrap syntax-check, signin-step-test, checkout-speed-test, and integration tests.

**Decision:** `@it` is the offline boss persona; overnight loads **`docs/autopilot/IT_LOOP_PROMPT.md`** (canonical; mirrors Telegram-bot `docs/autopilot/IT_LOOP_PROMPT.md`).

**Decision:** Active task pointer lives in `.autopilot/active-task.json` (gitignored). Default task: `docs/autopilot/overnight/repo-health.json`.

**Decision:** Broke circular dependency — `test-autopilot-cursor.sh` must not invoke `refresh-overnight-tasks.mjs` (req 2 verification calls the test script).

## Next

Merge release PR; run `@it` or `./scripts/loop.sh --detach` with `CURSOR_API_KEY` for unattended overnight work.
