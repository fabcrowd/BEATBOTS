#!/usr/bin/env bash
# Target Checkout Helper — Local Installer (macOS / Linux)
# Extracts the extension and opens Chrome to the install page.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_ZIP="$SCRIPT_DIR/dist/target-checkout-helper.zip"
EXT_DIR="$SCRIPT_DIR/target-checkout-helper"
INSTALL_HTML="$SCRIPT_DIR/INSTALL.html"

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${RED}${BOLD}  ⊕  Target Checkout Helper — Installer${NC}"
echo "  ─────────────────────────────────────────"
echo ""

# If the unpacked directory already exists, skip extraction
if [ -d "$EXT_DIR" ]; then
  echo -e "  ${GREEN}✓${NC} Extension folder found at:"
  echo "    $EXT_DIR"
else
  if [ ! -f "$EXT_ZIP" ]; then
    echo "  ✗ Could not find $EXT_ZIP"
    echo "    Make sure you're running this from the repo root."
    exit 1
  fi
  echo "  Extracting extension..."
  unzip -qo "$EXT_ZIP" -d "$SCRIPT_DIR"
  echo -e "  ${GREEN}✓${NC} Extracted to $EXT_DIR"
fi

echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo ""
echo "  1. Chrome will open to the Extensions page."
echo "  2. Make sure ${BOLD}Developer mode${NC} is ON (top-right toggle)."
echo "  3. Click ${BOLD}Load unpacked${NC} → select this folder:"
echo ""
echo -e "     ${GREEN}${EXT_DIR}${NC}"
echo ""
echo "  4. Pin the extension and open the popup to configure."
echo ""

# Detect Chrome and open extensions page
open_chrome() {
  local url="chrome://extensions"
  if command -v xdg-open &>/dev/null; then
    # Linux — try to launch Chrome directly for chrome:// URLs
    for bin in google-chrome google-chrome-stable chromium-browser chromium; do
      if command -v "$bin" &>/dev/null; then
        "$bin" "$url" &>/dev/null &
        return 0
      fi
    done
    echo "  ⚠ Could not find Chrome. Open chrome://extensions manually."
    return 1
  elif command -v open &>/dev/null; then
    # macOS
    open -a "Google Chrome" "$url" 2>/dev/null || open "$url"
    return 0
  fi
  echo "  ⚠ Could not detect OS. Open chrome://extensions manually."
  return 1
}

read -rp "  Open Chrome now? [Y/n] " yn
case "${yn:-Y}" in
  [Nn]*) echo "  Skipped. Open chrome://extensions when you're ready." ;;
  *)     open_chrome && echo -e "  ${GREEN}✓${NC} Chrome opened." || true ;;
esac

# Also open the HTML guide if available
if [ -f "$INSTALL_HTML" ]; then
  echo ""
  echo "  Tip: Open INSTALL.html for a visual step-by-step guide."
fi

echo ""
echo -e "  ${GREEN}Done!${NC} Enjoy fast checkouts."
echo ""
