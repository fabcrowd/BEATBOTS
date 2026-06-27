# Checkout reliability — notes

**Focus:** Cart won't load / kicked out of checkout during high-volume drops.

## Root causes (from code audit)

1. **Optimistic `markCartReady`** — ATC click navigated to checkout before cart API confirmed item.
2. **Harvest cookie swap after fresh ATC** — `applyNextBeforeCheckout` could invalidate the cart session.
3. **Blind cart → checkout fallback** — 6s timeout on cart page redirected even when cart was empty.
4. **Session recovery on `/cart`** — site data wipe mid-flow could clear cart during drops.
5. **No high-volume detection** — Target error pages retried as normal navigation failures.

## Changes (this branch)

| Area | Fix |
|------|-----|
| `probeTargetCart()` | Returns `cartId` + item count from GET cart API |
| `warmInitTargetCheckout()` | POST `/web_checkouts/v1/checkout` before DOM nav |
| `goToCheckoutViaApiBypass()` | API-confirmed path — no cart reload loop |
| `handleCartPage` | High volume: API poll first; reload only with backoff (max 3) |
| `OPEN_FRESH_CHECKOUT_TAB` | Fresh checkout tab when cart blocked or sign-in stuck |
| `CHECKOUT-BYPASS-RESEARCH.md` | Reload alternatives documented |

## Drop-night checklist

1. **Sign in by ~2:30 AM** — avoid auth modal at checkout under load.
2. **Clear cart** before drop; **one Target tab**.
3. **Saved payment ON** if account has wallet card + address.
4. **Fresh tab checkout** ON for monitor (light session separation).
5. **Apply before checkout OFF** during monitor ATC (extension skips harvest after fresh ATC automatically).
6. If kicked to cart: extension should toast **"Kicked to empty cart — re-adding"** and return to PDP.
7. If stuck at sign-in: finish manually — extension will **not** reload checkout.

## Verification

```bash
bash scripts/verify.sh
cd scripts/browser-smoke && xvfb-run -a npm run test:extension
```

Manual: ATC on stocked SKU → confirm cart API has items before `/checkout` in Network tab.
