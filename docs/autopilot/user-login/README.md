# Autopilot: user-login feature

Setup for [Gens-ai/autopilot](https://github.com/Gens-ai/autopilot) on this repo.

## Installed (one-time)

```bash
git clone https://github.com/Gens-ai/autopilot.git /tmp/autopilot-repo
/tmp/autopilot-repo/install.sh
export PATH="$HOME/.local/bin:$PATH"
npm install -g @anthropic-ai/claude-code --prefix ~/.local   # if needed
```

## Project config

- `autopilot.json` — feedback loops: `node scripts/checkout-speed-test.mjs`, `bash scripts/autopilot-syntax-check.sh`
- PRD: `user-login.md`
- Tasks: `user-login.json` (4 requirements, TDD)

## Run (local machine with Claude Code login)

```bash
export PATH="$HOME/.local/bin:$PATH"
claude login                                    # one-time
claude --dangerously-skip-permissions
/sandbox                                        # optional, inside Claude Code
autopilot docs/autopilot/user-login/user-login.json
```

Dry-run (no Claude sessions):

```bash
autopilot docs/autopilot/user-login/user-login.json --dry-run
```

## Cloud agent note

This environment has Autopilot and Claude Code CLI installed, but `claude login` is not configured, so the wrapper cannot invoke `/autopilot` sessions until credentials are added on a trusted machine.
