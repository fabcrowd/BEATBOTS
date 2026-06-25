#!/usr/bin/env bash
# Integration checks for Cursor-native Autopilot (no live agent sessions).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
FAIL=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

cd "$ROOT"

# Remove stale autopilot lock if the owning process is gone
if [[ -f .autopilot/command.pid ]]; then
  OLD_PID=$(cat .autopilot/command.pid 2>/dev/null || true)
  if [[ -z "$OLD_PID" ]] || ! kill -0 "$OLD_PID" 2>/dev/null; then
    rm -f .autopilot/command.pid
  fi
fi

# 1. Install + binaries
if "$ROOT/scripts/install-autopilot-cursor.sh" >/dev/null 2>&1 \
  && command -v autopilot-cursor >/dev/null \
  && command -v agent >/dev/null \
  && command -v jq >/dev/null; then
  pass "install script and binaries"
else
  fail "install script and binaries"
fi

# 2. Runtime config
if [[ "$(jq -r '.runtime.provider' autopilot.json)" == "cursor" ]]; then
  pass "autopilot.json runtime.provider=cursor"
else
  fail "autopilot.json runtime.provider"
fi

# 3. Cursor commands
for f in autopilot.md prd.md tasks.md autopilot-init.md it.md loop.md; do
  if [[ -f ".cursor/commands/$f" ]]; then
    pass ".cursor/commands/$f exists"
  else
    fail ".cursor/commands/$f missing"
  fi
done

# 4. Feedback loops
if bash scripts/autopilot-syntax-check.sh >/dev/null 2>&1; then
  pass "syntax-check feedback loop"
else
  fail "syntax-check feedback loop"
fi
if node scripts/signin-step-test.mjs >/dev/null 2>&1; then
  pass "signin-step-test"
else
  fail "signin-step-test"
fi
if node scripts/checkout-speed-test.mjs >/dev/null 2>&1; then
  pass "checkout-speed-test (includes signin)"
else
  fail "checkout-speed-test"
fi

# 5. Task file valid + complete
TOTAL=$(jq '.requirements | length' docs/autopilot/user-login/user-login.json)
DONE=$(jq '[.requirements[] | select(.passes == true)] | length' docs/autopilot/user-login/user-login.json)
if [[ "$TOTAL" == "4" && "$DONE" == "4" ]]; then
  pass "user-login task file (4/4 complete)"
else
  fail "user-login task file ($DONE/$TOTAL complete)"
fi

# 6. Dry-run sees completed tasks
OUT=$(autopilot-cursor docs/autopilot/user-login/user-login.json --dry-run 2>&1 || true)
if echo "$OUT" | grep -q "All requirements complete"; then
  pass "dry-run detects completed requirements"
else
  fail "dry-run completion detection"
fi

# 7. Dry-run would use agent (not claude) for incomplete work
mkdir -p .autopilot
TMP=".autopilot/test-incomplete-task.json"
jq '.requirements[0].passes = false' docs/autopilot/user-login/user-login.json > "$TMP"
OUT2=$(autopilot-cursor "$TMP" --dry-run 2>&1 || true)
rm -f "$TMP"
if echo "$OUT2" | grep -q 'agent -p --force' && ! echo "$OUT2" | grep -q 'claude '; then
  pass "dry-run invokes agent CLI for remaining work"
else
  fail "dry-run agent CLI invocation"
fi

# 8. Session prompt template placeholders
PROMPT_FILE="$ROOT/scripts/autopilot-cursor/session-prompt.md"
if grep -q '{{TASK_LINE}}' "$PROMPT_FILE" \
  && grep -q 'autopilot.md' "$PROMPT_FILE"; then
  pass "session prompt template"
else
  fail "session prompt template"
fi

# 9. Extension wiring
if grep -q 'signinStep.js' target-checkout-helper/manifest.json \
  && grep -q 'signinStep.js' target-checkout-helper/popup.html \
  && grep -q 'TCH_SIGNIN_STEP' target-checkout-helper/content.js; then
  pass "signinStep.js wired in extension"
else
  fail "signinStep.js extension wiring"
fi

# 10. Overnight automation (do not run refresh here — it verifies via test-autopilot-cursor)
if [[ -x scripts/loop.sh ]] \
  && [[ -x scripts/autopilot-overnight.sh ]] \
  && [[ -f .cursor/commands/loop.md ]] \
  && [[ -f docs/autopilot/overnight/repo-health.json ]] \
  && node --check scripts/refresh-overnight-tasks.mjs >/dev/null 2>&1; then
  pass "overnight /loop automation"
else
  fail "overnight /loop automation"
fi

# 11. Senior dev "it" + orchestrator
if [[ -f .cursor/skills/senior-singulr-dev/SKILL.md ]] \
  && [[ -f .cursor/commands/it.md ]] \
  && [[ -f tasks/NEXT_TASK.md ]] \
  && [[ -x scripts/verify.sh ]] \
  && [[ -f scripts/verify.ps1 ]] \
  && [[ -f orchestrator/autopilot.py ]]; then
  pass "senior dev it skill and orchestrator"
else
  fail "senior dev it skill and orchestrator"
fi

if python3 -m orchestrator autopilot use docs/autopilot/overnight/repo-health.json >/dev/null 2>&1 \
  && python3 -m orchestrator autopilot status >/dev/null 2>&1; then
  pass "orchestrator autopilot CLI"
else
  fail "orchestrator autopilot CLI"
fi

if grep -q 'senior-singulr-dev' scripts/autopilot-cursor/session-prompt-overnight.md; then
  pass "overnight prompt wired to it"
else
  fail "overnight prompt wired to it"
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "All autopilot-cursor integration checks passed."
  if [[ -z "${CURSOR_API_KEY:-}" ]]; then
    echo "NOTE: Live agent sessions skipped (set CURSOR_API_KEY or run 'agent login' to test end-to-end)."
  fi
  exit 0
fi
echo "Some checks failed."
exit 1
