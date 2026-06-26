#!/usr/bin/env bash
# Quality gate — run before claiming any batch done.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== verify.sh — BEATBOTS quality gate ==="
echo ""

echo "[1/5] syntax-check"
bash scripts/autopilot-syntax-check.sh

echo ""
echo "[2/5] signin-step-test"
node scripts/signin-step-test.mjs

echo ""
echo "[3/5] checkout-reliability-test"
node scripts/checkout-reliability-test.mjs

echo ""
echo "[4/5] checkout-speed-test"
node scripts/checkout-speed-test.mjs

echo ""
echo "[5/5] autopilot-cursor integration"
bash scripts/test-autopilot-cursor.sh

echo ""
echo "verify.sh: ALL PASSED"
