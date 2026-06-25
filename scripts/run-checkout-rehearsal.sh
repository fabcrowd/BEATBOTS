#!/usr/bin/env bash
# Automated checkout rehearsal — loads credentials from .env.rehearsal (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/scripts/browser-smoke/.env.rehearsal"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo "Loaded $ENV_FILE"
else
  echo "Missing $ENV_FILE"
  echo "Copy scripts/browser-smoke/.env.rehearsal.example → .env.rehearsal and add your Target credentials."
  exit 1
fi

if [[ -z "${TCH_TARGET_EMAIL:-}" || -z "${TCH_TARGET_PASSWORD:-}" ]]; then
  echo "Set TCH_TARGET_EMAIL and TCH_TARGET_PASSWORD in .env.rehearsal"
  exit 1
fi

export TCH_AUTO_SIGNIN=1
export PATH="$HOME/.local/bin:$PATH"

PROFILE="${TCH_PROFILE_DIR:-$HOME/.tch-rehearsal-chrome}"
rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie" 2>/dev/null || true

"$ROOT/scripts/checkout-sandbox-setup.sh"

cd "$ROOT/scripts/browser-smoke"
if command -v xvfb-run >/dev/null 2>&1 && [[ -z "${DISPLAY:-}" ]]; then
  exec xvfb-run -a npm run checkout-rehearsal
fi
exec npm run checkout-rehearsal
