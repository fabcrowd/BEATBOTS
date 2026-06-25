# Autopilot (Cursor)

This project uses **[Gens-ai/autopilot](https://github.com/Gens-ai/autopilot)** with the **Cursor Agent** runtime — not Claude Code.

## Install

```bash
./scripts/install-autopilot-cursor.sh
export PATH="$HOME/.local/bin:$PATH"
curl -fsS https://cursor.com/install | bash   # if agent CLI missing
export CURSOR_API_KEY=...                      # or: agent login
```

## Workflow

| Step | Cursor |
|------|--------|
| Init | `@autopilot-init` or edit `autopilot.json` |
| PRD | `@prd add feature description` |
| Tasks | `@tasks docs/autopilot/feature/feature.md` |
| Run loop | `autopilot-cursor docs/autopilot/feature/feature.json` |
| In-chat TDD | `@autopilot docs/autopilot/feature/feature.json` |

## Files

- `.cursor/commands/` — `@autopilot`, `@prd`, `@tasks` prompts (from Gens-ai/autopilot)
- `scripts/autopilot-cursor/run.sh` — fresh `agent -p --force` session per requirement
- `autopilot.json` — feedback loops + `"runtime": { "provider": "cursor" }`

## user-login feature

```bash
autopilot-cursor docs/autopilot/user-login/user-login.json
autopilot-cursor docs/autopilot/user-login/user-login.json --dry-run
```

Feedback loops:

```bash
node scripts/checkout-speed-test.mjs
bash scripts/autopilot-syntax-check.sh
```

## Claude Code (not used here)

The upstream `autopilot` command targets Claude Code (`claude` CLI + `~/.claude/hooks`). This repo uses `autopilot-cursor` instead.
