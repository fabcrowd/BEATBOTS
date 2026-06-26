#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILES=(
  "$ROOT/target-checkout-helper/popup.js"
  "$ROOT/target-checkout-helper/background.js"
  "$ROOT/target-checkout-helper/content.js"
  "$ROOT/target-checkout-helper/walmart-content.js"
  "$ROOT/target-checkout-helper/dropPollingTiming.js"
  "$ROOT/target-checkout-helper/cookieHarvest.js"
  "$ROOT/target-checkout-helper/core/hosts.js"
  "$ROOT/target-checkout-helper/core/signinStep.js"
  "$ROOT/target-checkout-helper/core/checkoutReliability.js"
  "$ROOT/target-checkout-helper/core/debuggerBridge.js"
)
for f in "${FILES[@]}"; do
  node --check "$f"
done
