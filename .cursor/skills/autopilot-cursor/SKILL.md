# Autopilot (Cursor)

Run the Gens-ai Autopilot TDD loop using **Cursor Agent**, not Claude Code.

## When to use

- User asks to run autopilot, `@autopilot`, or `autopilot-cursor`
- A task file exists under `docs/autopilot/**/*.json`
- `autopilot.json` is in the project root

## Terminal loop (fresh context per requirement)

```bash
./scripts/install-autopilot-cursor.sh
export PATH="$HOME/.local/bin:$PATH"
export CURSOR_API_KEY=...   # or: agent login
autopilot-cursor docs/autopilot/user-login/user-login.json
```

## Overnight unattended (debug & improve while you sleep)

```bash
export CURSOR_API_KEY=...
./scripts/loop.sh --detach          # one command — recommended
# equivalent: ./scripts/autopilot-overnight.sh --detach
tmux attach -t autopilot-overnight
```

In Cursor chat: **`@loop`**

Foreground:

```bash
./scripts/loop.sh --foreground
```

Before each run, `scripts/refresh-overnight-tasks.mjs` resets recurring audit requirements and verifies baselines. Task file: `docs/autopilot/overnight/repo-health.json`.

**Requirements:** machine stays on, terminal/tmux open, `CURSOR_API_KEY` or `agent login`, Cursor CLI installed.

## In Cursor chat

1. Read `.cursor/commands/autopilot.md` for the full TDD spec
2. Read `autopilot.json` for feedback loops
3. Execute the task file with TDD (red → green → refactor), one batch at a time
4. Update `*-notes.md` and mark `passes: true` in the task JSON when done

## Feedback loops (this repo)

```bash
node scripts/checkout-speed-test.mjs
bash scripts/autopilot-syntax-check.sh
./scripts/test-autopilot-cursor.sh
```

## Commands

| Cursor | Purpose |
|--------|---------|
| `@autopilot-init` | Initialize `autopilot.json` |
| `@prd` | Write PRD markdown |
| `@tasks` | PRD → task JSON |
| `@autopilot` | Execute task file (in-chat loop) |
| `@loop` | **Tonight's overnight loop** (repo debug/improve) |

Files live in `.cursor/commands/`.
