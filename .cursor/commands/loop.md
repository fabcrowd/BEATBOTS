# /loop — Overnight Autopilot (Cursor)

> **Cursor mapping:** `autopilot tasks.json` from [Gens-ai/autopilot](https://github.com/Gens-ai/autopilot) — fresh `agent` session per requirement, state in JSON + notes, not in chat memory.

> **Boss agent:** `@it` — senior developer persona (`.cursor/skills/senior-singulr-dev/SKILL.md`). Overnight sessions run as "it".

Start tonight's **unattended debug & improve** loop for this repo.

## When to use

- User says `/loop`, "run overnight", "start autopilot tonight", or "loop while I sleep"
- Default task file: `docs/autopilot/overnight/repo-health.json` (8 requirements)

## Cursor vs Claude Code (official docs)

| Official Autopilot | This repo (Cursor) |
|--------------------|-------------------|
| `./install.sh` | `./scripts/install-autopilot-cursor.sh` |
| `/autopilot init` | `@autopilot-init` (or existing `autopilot.json`) |
| `/prd "feature"` | `@prd feature description` |
| `/tasks prd.md` | `@tasks docs/autopilot/feature/feature.md` |
| `/sandbox` | Not needed — runner uses `agent -p --force` |
| `autopilot tasks.json` | `./scripts/loop.sh` or `autopilot-cursor tasks.json` |
| `/autopilot tasks.json` | `@autopilot tasks.json` (single session, 1–4 reqs) |
| `/autopilot stop` | `kill -USR1 $(cat docs/autopilot/overnight/run.pid)` or Ctrl+C in loop terminal |

**Decision tree (same as upstream):**

```
5+ requirements or overnight  →  ./scripts/loop.sh --detach
1–4 requirements, interactive →  @autopilot <task.json> --batch 1
```

## Phase 0: Pre-flight

1. Read **`.cursor/skills/senior-singulr-dev/SKILL.md`** — you are **"it"** for this loop.
2. **Config:** Read `autopilot.json`. If missing, run equivalent of `@autopilot-init --force`.
3. **Tools:** `agent`, `jq`, `node`, `python3` must be available. `CURSOR_API_KEY` or `agent login` required for live overnight runs.
4. **Quality gate:** `bash scripts/verify.sh` must pass before starting overnight (or fix failures first).
5. **Parallel runs:** Check `docs/autopilot/*/run.pid`. If another loop is running, tell user to stop it first (`@autopilot stop` logic).
6. **Scope:** `target-checkout-helper/` and `scripts/` only — not `beatbots-app`, Discord exporter, research folders.

## Phase 1: Refresh tonight's task queue

Run:

```bash
node scripts/refresh-overnight-tasks.mjs
```

This:

- Verifies baseline tests (req 1–2) — skips if already green
- Resets **recurring** audit requirements (bug hunts, entropy, browser-smoke, summary)

Read `docs/autopilot/overnight/repo-health.json` and report: `N incomplete / 8 total`.

If user gave a **custom feature** in `$ARGUMENTS` (e.g. `/loop docs/autopilot/my-feature/my-feature.json`), use that task file instead and skip refresh script unless it's under `overnight/`.

## Phase 2: Branch

```bash
git checkout -b cursor/overnight-$(date +%Y%m%d) 2>/dev/null || git checkout cursor/overnight-$(date +%Y%m%d)
```

## Phase 3: Start the loop

### Option A — Terminal overnight (recommended for sleep)

Tell the user to run (or run it yourself if `CURSOR_API_KEY` is set and user asked to start):

```bash
export PATH="$HOME/.local/bin:$PATH"
export CURSOR_API_KEY=...   # if not already set
./scripts/loop.sh --detach
```

`--detach` starts tmux session `autopilot-overnight` (8h max, logs in `docs/autopilot/overnight/logs/`).

**Stop:** `tmux attach -t autopilot-overnight` then Ctrl+C, or `@autopilot stop`.

### Option B — In this chat (one batch only)

If user is watching or API key unavailable for subprocess:

1. Read `.cursor/commands/autopilot.md` TDD rules
2. Set `AUTOPILOT_PROMPT_TEMPLATE=docs/autopilot/IT_LOOP_PROMPT.md`
3. Execute **one** incomplete requirement from the task file (lowest id)
4. Run feedback loops before each commit:
   - `node scripts/checkout-speed-test.mjs`
   - `bash scripts/autopilot-syntax-check.sh`
5. Update `docs/autopilot/overnight/overnight-notes.md` and mark `passes: true` in JSON
6. Output `COMPLETE` when batch done

For full overnight coverage, **Option A is required** — this chat session will not persist after close.

## Phase 4: TDD execution (per requirement)

For each requirement picked up by the loop:

1. `git tag -f autopilot/req-{id}/start`
2. **Red** — failing test covering acceptance criteria
3. **Green** — minimal fix, feedback loops pass
4. **Refactor** — simplify, loops still pass
5. `git add <specific-files>` and commit (never `git add -A`)
6. Mark `passes: true` in task JSON; update notes **Current State**

**Stuck:** same error 3× → `stuck: true`, `blockedReason`, skip to next.

## Phase 5: Completion

When all requirements are `passes: true` or `stuck: true`:

- Write summary to `docs/autopilot/overnight/overnight-notes.md`
- Write `docs/autopilot/overnight/stop-signal` with content `done` (runner watches this)
- Report: completed / stuck / commits on branch

## Tonight's default queue (`repo-health.json`)

| ID | Focus |
|----|--------|
| 1–2 | Baseline + integration tests (auto-pass if green) |
| 3 | Bug hunt: Target `content.js` checkout/sign-in |
| 4 | Bug hunt: `background.js` monitor/harvest/401 |
| 5 | Bug hunt: `walmart-content.js` ATC/queue/login |
| 6 | Entropy: dedupe into `core/` |
| 7 | Browser-smoke tests (or mark stuck if no Chrome) |
| 8 | Overnight summary + commits |

## Custom feature loop

To loop a **new** feature instead of repo-health:

```
/loop docs/autopilot/checkout-speed/checkout-speed.json
```

Or full pipeline from scratch:

```
@prd improve drop polling reliability
@tasks docs/autopilot/drop-polling/drop-polling.md
./scripts/loop.sh --task docs/autopilot/drop-polling/drop-polling.json --detach
```

## Arguments

Parse `$ARGUMENTS`:

- Empty → use `docs/autopilot/overnight/repo-health.json`
- Path ending in `.json` → use as task file
- `--dry-run` → pass through to loop script
- `--foreground` → do not detach tmux

## Execution

Announce: "Starting overnight Autopilot loop for BEATBOTS (Cursor runtime)."

Run Phase 0–2, then start Phase 3 Option A if credentials allow, else give exact commands and offer Option B for one batch.
