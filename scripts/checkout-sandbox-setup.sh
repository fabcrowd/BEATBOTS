#!/usr/bin/env bash
# One-time setup for checkout sandbox (browser-smoke + Playwright Chromium).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SMOKE="$ROOT/scripts/browser-smoke"
cd "$SMOKE"
echo "Installing browser-smoke dependencies..."
npm install
echo "Installing Playwright Chromium..."
npx playwright install chromium
node -e "const { chromium } = require('playwright'); const p = chromium.executablePath(); console.log('Chromium:', p); require('fs').accessSync(p);"
echo "Done. Run: cd scripts/browser-smoke && npm run test:extension"
