# Checkout sandbox — Autopilot notes

Append-only log for `checkout-sandbox` task runs.

## One-time setup

```bash
cd scripts/browser-smoke
npm install
npx playwright install chromium
```

## CI tier (required)

```bash
cd scripts/browser-smoke && npm run test:extension
```

## Rehearsal tier (optional / local)

```bash
export TCH_PRODUCT_URL="https://www.target.com/p/…"
export TCH_MANUAL_WAIT_SECS=60   # sign in + check popup if profile is new
cd scripts/browser-smoke && npm run checkout-rehearsal
```

**Safety:** extension ON, Use saved payment ON, **Auto place order OFF**.

## blockedReason codes

| Code | Meaning |
|------|---------|
| `missing_product_url` | `TCH_PRODUCT_URL` not set |
| `no_chromium` | Playwright Chromium not installed |
| `no_display` | Headed Chrome unavailable (cloud VM) |
| `review_timeout` | Did not see `[TCH] review reached` in time |
| `signin_timeout` | Stuck on sign-in / guest gate |
| `oos_or_atc_failed` | Product OOS or ATC did not proceed |

## Run log

### Template (agent fills per session)

- **Date:**
- **Branch:**
- **Req:**
- **test:extension:**
- **rehearsal:**
- **blockedReason:**
- **Fixes:**

---
