# Overnight Autopilot

Unattended **debug & improve** runs using Cursor Agent + the autopilot skill.

## One-time setup

```bash
curl https://cursor.com/install -fsS | bash
export PATH="$HOME/.local/bin:$PATH"
export CURSOR_API_KEY=your_key_from_cursor_settings   # or: agent login
./scripts/install-autopilot-cursor.sh
```

Get an API key: [Cursor Settings → API](https://cursor.com/settings).

## Start tonight

**One command:**

```bash
cd /path/to/BEATBOTS
export CURSOR_API_KEY=...
./scripts/loop.sh --detach
```

Or in Cursor: **`@loop`**

Attach in the morning:

```bash
tmux attach -t autopilot-overnight
```

**Foreground:**

```bash
./scripts/loop.sh --foreground
```

## What it does

1. Refreshes `repo-health.json` (resets recurring audits, verifies tests)
2. Creates branch `cursor/overnight-YYYYMMDD`
3. Loops `autopilot-cursor` with the **overnight prompt** (debug/improve focus)
4. One fresh `agent` session per requirement, up to 8 hours
5. Logs to `docs/autopilot/overnight/logs/`
6. Commits fixes locally (does not push)

## Task file

`repo-health.json` — 8 requirements: baseline tests, integration test, bug hunts (Target, background, Walmart), entropy, browser-smoke, summary.

## Schedule (optional)

macOS `launchd` or Linux cron at 11pm:

```cron
0 23 * * * cd /path/to/BEATBOTS && CURSOR_API_KEY=... ./scripts/autopilot-overnight.sh --detach >> ~/autopilot-cron.log 2>&1
```

## Requirements

- Computer **on** and **not sleeping** (or use a server/VM)
- `CURSOR_API_KEY` or `agent login` valid for the night
- tmux installed for `--detach` (optional)

## Dry run

```bash
./scripts/autopilot-overnight.sh --dry-run
```
