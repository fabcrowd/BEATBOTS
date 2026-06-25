# Quality gate — run before claiming any batch done.
# Usage: powershell -File scripts/verify.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "=== verify.ps1 — BEATBOTS quality gate ==="
Write-Host ""

Write-Host "[1/4] syntax-check"
bash scripts/autopilot-syntax-check.sh
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "[2/4] signin-step-test"
node scripts/signin-step-test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "[3/4] checkout-speed-test"
node scripts/checkout-speed-test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "[4/4] autopilot-cursor integration"
bash scripts/test-autopilot-cursor.sh
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "verify.ps1: ALL PASSED"
