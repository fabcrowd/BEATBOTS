# Checkout bypass research — alternatives to reload loops

**Context:** During drops, users often **reload the cart page** until checkout loads. This doc maps bypass strategies and what we implemented.

## Why reload happened

| Stage | Old behavior | Root cause |
|-------|--------------|------------|
| `/cart` high volume | `location.reload()` every 6–8s | Cart SPA shell broken; checkout button never hydrates |
| `/checkout` | Reload **suppressed** (v1.2.3) | Reload interrupted sign-in |
| Optimistic ATC → checkout | Blind `/checkout` nav | Cart API not consulted |

Reload on **cart** was a reasonable fallback when the DOM is dead but the session may still be valid.

## Bypass strategies (ranked)

### 1. API cart probe → direct `/checkout` (extension — **implemented**)

```
GET https://api.target.com/web_checkouts/v1/cart
  → if cart_items.length > 0 → navigate to /checkout
```

Skips waiting for `[data-test="checkout-button"]` when Target’s cart UI is slow or shows error copy.

**Code:** `probeTargetCart()`, `goToCheckoutViaApiBypass()` in `content.js`

### 2. API warm-init checkout (extension — **implemented**)

Stellar/Refract use full API checkout in a companion app. The extension can do a **subset**:

```
POST https://api.target.com/web_checkouts/v1/checkout
  body: { cart_id }
  credentials: include + x-api-key from page __CONFIG__
```

Server creates checkout session **before** the browser loads `/checkout` SPA — often faster than DOM-only.

**Code:** `warmInitTargetCheckout()` — called from `navigateToCheckout()` and `goToCheckoutViaApiBypass()`

Full ship/pay/place remains in `beatbots-app/src/main/engines/checkout-engine.ts`.

### 3. API poll loop instead of reload (extension — **implemented**)

On high-volume cart page:

1. Poll GET cart every 2s (up to 6×)
2. If items → API bypass (no reload)
3. Else exponential reload backoff (max 3)
4. Else `OPEN_FRESH_CHECKOUT_TAB`

**Code:** `pollCartApiUntilReady()`, `handleCartPage` high-volume branch

### 4. Buy It Now (extension — already existed)

Fastest DOM path when `useSavedPayment` — skips cart entirely.

### 5. Fresh tab checkout (extension — enhanced)

Monitor opens new tab for checkout. Now also triggered when:

- Cart high-volume reloads exhausted
- Checkout sign-in stuck after 15 pending retries (`OPEN_FRESH_CHECKOUT_TAB`)

### 6. Prefetch (extension — already existed)

`<link rel="prefetch" href="/checkout">` on product/cart — warms assets only, not server session.

### 7. Full API checkout (beatbots-app — not in extension)

```
DELETE /cart → POST /cart_items → POST /checkout → PUT address → POST payment → place_order
```

Requires Shape cookies + session manager. Extension WS bridge today: Shape pool + OTP only.

**Future:** `checkout_request` WS message to trigger `CheckoutEngine.run()`.

### 8. URL tricks (`?cart_id=`)

**Not supported** — Target uses `cart_id` in POST body only (verified in `checkout-engine.ts`).

## Decision matrix

| Method | Needs reload? | Needs beatbots-app? | Drop-ready |
|--------|---------------|---------------------|------------|
| Cart API → `/checkout` | No | No | Yes |
| Warm-init POST checkout | No | No | Yes (experimental) |
| Cart reload backoff | Last resort | No | Yes |
| Fresh tab | No | No | Yes |
| Full API checkout | No | Yes | Phase 4 |

## Verification

```bash
bash scripts/verify.sh
node scripts/checkout-reliability-test.mjs
```

Manual: Network tab on `/cart` during drop — expect GET cart 200 → POST checkout → navigation without reload when DOM is broken.
