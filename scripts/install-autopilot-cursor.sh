#!/usr/bin/env bash
# Install Cursor-native Autopilot for this repo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$HOME/.local/bin"
ln -sf "$ROOT/scripts/autopilot-cursor/run.sh" "$HOME/.local/bin/autopilot-cursor"
ln -sf "$ROOT/scripts/autopilot-cursor/cleanup.sh" "$HOME/.local/bin/autopilot-cursor-cleanup"
chmod +x "$ROOT/scripts/autopilot-cursor/run.sh" "$ROOT/scripts/autopilot-cursor/cleanup.sh"
echo "Linked autopilot-cursor -> $HOME/.local/bin/autopilot-cursor"
echo "Cursor commands: $ROOT/.cursor/commands/{autopilot,prd,tasks,autopilot-init}.md"
echo ""
echo "Ensure PATH includes ~/.local/bin and authenticate:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
echo "  export CURSOR_API_KEY=...   # or: agent login"
echo ""
echo "Run:"
echo "  autopilot-cursor docs/autopilot/user-login/user-login.json"
