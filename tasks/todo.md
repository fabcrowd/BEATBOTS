# Anti-detection implementation

## Plan
- [x] A1 manifest `cookies` + `browsingData`
- [x] A2+A3 debugger lifecycle + native click ladder
- [x] A4 poll jitter + A5 Walmart backoff + tests
- [x] A6 popup pre-drop guards + A8 hype fresh-tab
- [x] B2 WS `checkout_request` fallback
- [x] verify.sh + extension smoke + hardening

## Review
- Extension **v2.3.0**: manifest permissions, debugger detach after ATC, native Continue clicks, poll jitter (mean ~250ms), Walmart ATC backoff, hype→fresh-tab, pre-drop guards.
- **B2**: `BB_CHECKOUT_REQUEST` → beatbots `checkout_request` with `from_cart` when DOM dead (opt-in Advanced).
- Tests: `scripts/anti-detection-test.mjs`, verify.sh 6/6, extension smoke PASS.
