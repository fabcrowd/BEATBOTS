# Stellar AIO vs Our Extension: Side-by-Side Comparison

## Architecture

| Aspect | Stellar AIO | Our Extension (TCH) |
|--------|------------|---------------------|
| Runtime | Desktop Electron app + companion Chrome extension | Chrome extension only (MV3) |
| Monitor/Checkout split | **Completely separate processes** — monitor tasks and checkout tasks are independent with IPC pings | **Same content script** in the same tab handles both monitoring and checkout |
| Parallelism | N accounts × 1 checkout task each = N parallel checkout attempts | 1 browser tab = 1 checkout attempt |
| Multi-SKU | Tag groups of up to 30 SKUs, monitor watches all, first to drop gets carted | Multi-product list in `monitor.products[]` with per-item qty — **we have this** |
| Background poll | Service worker `runBackgroundPoll` with `computeBackgroundPollSleepMs` (250ms-2s) | Service worker `runBackgroundPoll` does RedSky checks — **we have this** |

**Verdict**: Our background poll architecture is actually similar to Stellar's monitor concept. The big gap is that Stellar's checkout tasks are **separate processes** with their own sessions and proxies, while our checkout runs in the same tab that was monitoring.

---

## Anti-Bot / Shape Security

| Aspect | Stellar AIO | Our Extension (TCH) |
|--------|------------|---------------------|
| Cookie strategy | **Active generation** — dedicated extension or Shape Module continuously runs Shape JS challenges to produce "ATC cookies" in a loop (20-30s intervals, 1hr expiry) | **Passive capture** — `cookieHarvest.js` snapshots existing browser cookies via `chrome.cookies.getAll` on page loads/ticks |
| Cookie pool | Generated on demand, account-independent, consumed by checkout tasks | Pool of up to **48 entries**, 8min default TTL, ATC-kind preferred for replay, LIFO/FIFO configurable |
| Shape bypass | Browser extension renders real browser to solve Shape JS; bot consumes resulting cookies | No Shape solving — relies on cookies from the user's normal browsing session |
| Replay | Cookies injected into bot's HTTP client per-request | `tchApplyNextSnapshot` replays via `chrome.cookies.set` before checkout navigation |
| Device fingerprint | Aware of device-level bans; 24-48hr cooldown protocol | No explicit device ban detection; `humanChallengeDelayMs: 12000` backoff on captcha text |

**Verdict**: This is the **biggest gap**. Stellar actively solves Shape Security challenges to generate valid ATC cookies. We passively capture whatever the browser already has. Their cookies are purpose-built for carting; ours are whatever happened to be in the cookie jar. However, our approach is simpler and less likely to trigger device bans since we're not hammering Shape.

---

## Session & Authentication

| Aspect | Stellar AIO | Our Extension (TCH) |
|--------|------------|---------------------|
| Login | Pre-authenticated via access token (weeks-long) or Request Login + IMAP OTP | Optional `autoSignIn` with stored `targetEmail`/`targetPassword` + CDP typing; Gmail OAuth OTP or IMAP native host |
| Session warmth | Sessions logged in and waiting **before** drop; no auth at checkout time | Must authenticate during checkout if not already signed in; content script detects `signin` step |
| Multi-account | 10-20 accounts, each with own session, own proxy | Single browser session, single account |
| OTP handling | IMAP integration auto-pulls Target verification codes | Gmail OAuth polling (`watchForOtp`) or IMAP native messaging bridge — **we have this** |
| Session recovery | Not documented (session per account, presumably re-login) | `maybeAutoRecoverTargetSession`: 3-error streak → clears site data via `browsingData.removeDataFromOrigins`, preserves PX cookies, reloads tabs, 12min cooldown — **we have this, they don't mention it** |

**Verdict**: Roughly comparable on OTP handling. Our session recovery (clearing cookies on 401/403 streaks) is actually something Stellar doesn't document. But their pre-authenticated multi-account approach means they don't need it — they just have many clean sessions ready.

---

## Monitoring / Inventory Detection

| Aspect | Stellar AIO | Our Extension (TCH) |
|--------|------------|---------------------|
| Method | "API" mode (recommended) = backend inventory calls; "ATC" mode = frontend add-to-cart attempts | **RedSky fulfillment API** (`product_fulfillment_v1`) as primary, **streaming HTML parse** as fallback |
| API key | Not documented (likely hardcoded or extracted) | Extracted from `window.__CONFIG__.services` via `main_world.js` MAIN world injection |
| Poll intervals | Monitor: 8-15s; no drop-aware tightening documented | **Drop-aware**: far (>30m): `max(base, 3s)`; normal: `base`; tension (10m pre / 3m post): `min(base, 1s)`; background sleep: 250ms-2s — **we're more sophisticated** |
| High stock filter | "Monitor High Stock (10+) Only" toggle | `highStockOnly` + `highStockThreshold` (1-999, configurable) — **we have this and it's more flexible** |
| Max price filter | Not documented | `targetMaxPrice` checked against API price and HTML fallback — **we have this** |
| Stock parsing | Not documented (opaque) | `parseFulfillmentStockStatus`: shipping availability, ATP qty, sold_out flags, `FULFILLMENT_SELLABLE_STATUSES` regex — **more transparent** |

**Verdict**: Our monitoring is actually **more sophisticated** than what Stellar documents. Drop-aware polling, configurable thresholds, max price gates, streaming HTML fallback. Their 8-15s recommended interval is conservative compared to our 1s tension-window polling.

---

## Checkout Flow

| Aspect | Stellar AIO | Our Extension (TCH) |
|--------|------------|---------------------|
| Method | **API-based checkout** — bot sends HTTP requests directly (login, ATC, set shipping, set payment, place order) | **DOM automation** — content script fills forms, clicks buttons, navigates between checkout steps |
| ATC | API call with Shape cookie attached | `debuggerClick(addBtn)` on Ship It / Pickup / Preorder button with CDP mouse simulation |
| Shipping | Profile data sent via API (auto-matched or auto-added to account) | `fillInput` / `fillSelect` on shipping form fields with `jigAddressLine1` randomization |
| Payment | Profile card injected via API or uses saved payment on account | Fill `cardNumber`/`expMonth`/`expYear`/`cvv` inputs, or skip if `useSavedPayment` |
| Place order | API call (auto or manual depending on setting) | `debuggerClick` on Place Order button if `autoPlaceOrder` enabled |
| Checkout delay | ≤3000ms between steps | `T.checkoutProbeInterval: 25ms` DOM polling, `waitAndClickContinue(5000)`, step transitions as fast as DOM allows |
| Step detection | N/A (API flow) | `getCheckoutStep` reads DOM: Place Order → review; card inputs → payment; name inputs → shipping; auth modal → signin |
| Prefetch | Not documented | `<link rel="prefetch" href="/checkout">` injected on product page — **we have this** |
| Speed telemetry | Not documented | `markCheckoutStart` / `recordCheckoutSpeed` with `sessionStorage` + `chrome.storage.local` — **we have this** |

**Verdict**: Fundamentally different approaches. Stellar's API checkout is **faster** because it skips the DOM entirely — no page loads, no form rendering, no button clicks. Our DOM automation is limited by browser rendering speed. However, our approach is **harder to detect** since we look like a real user interacting with the page, and we don't need to reverse-engineer Target's checkout API contracts.

---

## Proxy / Network

| Aspect | Stellar AIO | Our Extension (TCH) |
|--------|------------|---------------------|
| Proxy support | Full proxy management: ISP for monitoring, residential for checkout, 2:1 ratio recommended | **None** — uses browser's native connection |
| IP rotation | 25-50+ IPs across tasks | Single IP |
| IP separation | Different proxies for monitor vs checkout | Same IP for everything |
| Server support | Warned against (datacenter IPs flagged) | N/A (browser extension) |

**Verdict**: Massive gap, but fundamentally architectural — a Chrome extension can't route traffic through arbitrary proxies the way a desktop app can. We'd need a proxy extension integration or `chrome.proxy` API usage.

---

## Input Simulation

| Aspect | Stellar AIO | Our Extension (TCH) |
|--------|------------|---------------------|
| Click simulation | N/A (API-based, no DOM) | **CDP `Input.dispatchMouseEvent`** with Bezier curve mouse movement (8-14 steps, random control points) via `debuggerBridge.js` |
| Typing simulation | N/A | **CDP `Input.dispatchKeyEvent`** with 30-80ms random per-character delay |
| Sign-in | API request with credentials | `debuggerClick` + `debuggerType` with randomized delays (200-300ms between steps) |

**Verdict**: Our CDP-based input simulation is actually quite advanced for a browser extension. Stellar doesn't need this because they bypass the DOM entirely.

---

## Drop Timing

| Aspect | Stellar AIO | Our Extension (TCH) |
|--------|------------|---------------------|
| Drop time input | Not documented as a feature | `dropExpectedAt` ISO datetime with countdown UI |
| Adaptive polling | Not documented | **5-tier system**: >45m: 2s sleep, >30m: 3s poll floor, normal: base, tension (10m pre/3m post): 250ms sleep + 1s poll cap |
| Harvest tightening | Not documented | Keepalive interval tightens: 5m → 3m → 2m as drop approaches; burst dedup: 120s → 45s → 20s |
| NTP sync | Not documented | `syncServerClock()` + NTP offset for accurate timing |

**Verdict**: Our drop timing system is **significantly more sophisticated** than anything Stellar documents. The 5-tier adaptive polling with harvest tightening is industry-aligned.

---

## Unique Features We Have That Stellar Doesn't

1. **Session recovery with PX cookie preservation** — auto-clears Target site data on 401/403 streaks while keeping PerimeterX cookies
2. **Drop-aware adaptive polling** — 5-tier system that tightens automatically
3. **CDP Bezier mouse simulation** — realistic mouse paths with random curves
4. **Streaming HTML stock fallback** — incremental parse of product page when API is unavailable
5. **Max price filter** — skip checkout if price exceeds threshold
6. **Configurable high stock threshold** (1-999) vs Stellar's fixed 10+
7. **Checkout speed telemetry** — tracks and stores timing for each checkout
8. **Checkout prefetch** — `<link rel="prefetch">` for `/checkout`
9. **Declarative Net Request blocking rules** — `rules/blocking.json`
10. **Extra product add** — can add an additional item before checkout

## Unique Features Stellar Has That We Don't

1. **Active Shape cookie generation** — solves Shape JS challenges to produce ATC-ready cookies
2. **API-based checkout** — bypasses DOM entirely for faster step completion
3. **Multi-account parallel checkout** — N accounts = N simultaneous attempts
4. **Full proxy support** — ISP/residential/DC with per-task assignment
5. **Account generation** — creates new Target accounts
6. **Password reset mode** — automated account password resets
7. **Pickup mode with ZIP/radius** — store-level inventory monitoring
8. **Cashback integrations** — Rakuten/TopCashback
9. **Endless mode with limits** — auto-repeat checkout up to N times (we have endless mode concept in monitor but theirs is more structured)

---

## Priority Gap Analysis (What Would Move the Needle Most)

### 1. Shape Cookie Generation (HIGH IMPACT)
Our passive harvest captures whatever's in the jar. Stellar actively generates Shape-passing cookies. This is likely why their ATC succeeds more often on hyped drops. **However**: implementing this means running a real browser context that solves Shape challenges, which is complex and risks device bans.

### 2. API Checkout (HIGH IMPACT, HIGH RISK)
Stellar sends HTTP requests directly — no DOM rendering, no form fills. Faster by orders of magnitude. **However**: requires reverse-engineering Target's checkout API, which changes frequently and is actively defended.

### 3. Monitor/Checkout Session Separation (MEDIUM IMPACT)
Even within our single-extension architecture, we could isolate the monitoring session from the checkout session. Background worker monitors via API (clean IP, burned cookies are fine). Content script only activates for checkout with a fresh session + replayed harvest cookies. We're **partially there** with background polling — the gap is that checkout still runs in the same context.

### 4. Proxy Integration (MEDIUM IMPACT, ARCHITECTURAL)
A Chrome extension fundamentally can't do per-request proxy routing. Options: integrate with `chrome.proxy` API for extension-level proxy, or pair with a companion proxy extension. This is architecturally limited by the browser model.

### 5. Multi-Account (LOW-MEDIUM, OPERATIONAL)
Multiple Chrome profiles with our extension = similar effect. Not a code gap, more of an operational guide.
