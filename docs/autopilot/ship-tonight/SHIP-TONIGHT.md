# Ship tonight — Target drop playbook

**Extension-only minimum** · **beatbots-app optional** for Shape + IMAP OTP

## Before you sleep (setup once)

1. `chrome://extensions` → Load unpacked → `target-checkout-helper/` → **Reload** after any update
2. Popup → **ON** → **Save settings**
3. Sign in to Target (`target.com`) — finish by **2:30 AM ET**
4. Clear cart · one Target tab

## Extension settings (Monitor tab)

| Setting | Value | Why |
|---------|-------|-----|
| **Saved payment** | ON | Skips cart form fill; uses wallet |
| **Fresh tab checkout** | ON | Monitor tab stays on PDP; checkout opens clean |
| **High stock gate** | ON (threshold 10) | Avoids low-qty ghost stock |
| **Auto place order** | OFF | You click Place Order |
| **Apply before checkout** | ON for passive harvest only | Extension **skips** harvest swap after fresh ATC automatically |
| **Expected drop time** | Your window (e.g. 3:00 AM) | Tightens polling T-10 min |

## Optional: beatbots-app (Shape + OTP)

1. Run beatbots-app → start **Shape harvester** (ATC mode)
2. Popup shows **BEATBOTS app: connected — ATC N**
3. Add IMAP profile in app → OTP auto-fills when WS connected (falls back to Gmail OAuth)

## Product list (Tier A SKUs — high stock)

- `94300072` · `95267143` · `95120834` · `1011209279` · `93803457`

Enable **Hype mode** per SKU if Shape blocks ATC.

## During the drop

1. Start monitor **30 min before** drop window
2. Do **not** toggle extension or change settings in the last minute
3. Watch popout for **Snapshots ready** and **BEATBOTS ATC** counts
4. If toast says **high volume** — stay on page, do not reload checkout
5. If **Kicked to empty cart** — extension re-ATCs automatically

## What shipped in this build

- Cart API confirm before checkout navigation
- High-volume / empty-cart detection
- Checkout bounce recovery
- BEATBOTS WS: Shape pool + IMAP OTP
- Session recovery blocked on cart/checkout tabs

## Verify locally

```bash
bash scripts/verify.sh
cd scripts/browser-smoke && xvfb-run -a npm run test:extension
```

## PRs

- [#23](https://github.com/fabcrowd/BEATBOTS/pull/23) — checkout reliability + ship bundle
- [#22](https://github.com/fabcrowd/BEATBOTS/pull/22) — DIY toolstack Phase 1
