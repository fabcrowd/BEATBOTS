# Autopilot (Cursor)

Autonomous TDD for this repo, adapted from [Gens-ai/autopilot](https://github.com/Gens-ai/autopilot) for **Cursor Agent** instead of Claude Code.

## Quick start

```bash
# One-time
curl https://cursor.com/install -fsS | bash
./scripts/install-autopilot-cursor.sh
export PATH="$HOME/.local/bin:$PATH"
export CURSOR_API_KEY=...    # or: agent login

# Tonight (one command)
./scripts/loop.sh --detach
```

In Cursor chat: **`@loop`**

## Workflow

| Step | Cursor |
|------|--------|
| 0. Init | `@autopilot-init` (once; `autopilot.json` exists) |
| 1. PRD | `@prd describe your feature` |
| 2. Tasks | `@tasks docs/autopilot/feature/feature.md` |
| 3. Sandbox | Skipped — `agent -p --force` in runner |
| 4. Loop | `./scripts/loop.sh` or `@loop` |

## Two ways to run

| Method | When |
|--------|------|
| `./scripts/loop.sh` / `autopilot-cursor` | 5+ requirements, **overnight**, fresh context per req |
| `@autopilot task.json` | 1–4 requirements, interactive, shared context |

## Commands

| Cursor / Terminal | Purpose |
|-------------------|---------|
| `@loop` | Start tonight's overnight debug/improve loop |
| `@autopilot` | TDD task execution (in-chat) |
| `@prd` | Write PRD markdown |
| `@tasks` | PRD → task JSON |
| `autopilot-cursor file.json` | Terminal loop (low-level) |
| `./scripts/loop.sh --detach` | Overnight + tmux |

## Feedback loops

```bash
bash scripts/verify.sh          # full quality gate (Linux/macOS)
powershell -File scripts/verify.ps1   # Windows
node scripts/checkout-speed-test.mjs
bash scripts/autopilot-syntax-check.sh
./scripts/test-autopilot-cursor.sh
python -m orchestrator autopilot status
```

## Senior dev boss (`@it`)

While offline, **`@it`** runs as the senior developer agent. Read `.cursor/skills/senior-singulr-dev/SKILL.md`.

```bash
bash scripts/verify.sh
python -m orchestrator autopilot use docs/autopilot/overnight/repo-health.json
python -m orchestrator autopilot status
python -m orchestrator autopilot next
```

Assigned work: `tasks/NEXT_TASK.md`

Configured in `autopilot.json`.

## Overnight default

- Task: `docs/autopilot/overnight/repo-health.json`
- Logs: `docs/autopilot/overnight/logs/`
- Notes: `docs/autopilot/overnight/overnight-notes.md`
- Branch: `cursor/overnight-YYYYMMDD`

See [overnight/README.md](overnight/README.md).

## Stop

```bash
tmux attach -t autopilot-overnight   # then Ctrl+C
# or
@autopilot stop
```

## File layout

```
autopilot.json
docs/autopilot/
  overnight/repo-health.json    # default @loop queue
  user-login/                   # feature example
  walmart-login/
.cursor/commands/
  it.md loop.md autopilot.md prd.md tasks.md
.cursor/skills/
  senior-singulr-dev/ autopilot-cursor/
orchestrator/                   # python -m orchestrator autopilot
scripts/verify.sh verify.ps1
tasks/NEXT_TASK.md
scripts/
  loop.sh                       # tonight entry point
  autopilot-overnight.sh
  autopilot-cursor/run.sh
```
