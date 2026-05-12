# Stellar AIO Target Module - Competitive Intelligence

## Why Stellar Succeeds at Target Checkouts

### 1. Architecture: Separated Monitor → Checkout Pipeline

Stellar's core design splits work into **independent task types** that communicate via internal pings:

- **Monitor tasks** poll Target's backend API for inventory changes (8-15s intervals)
- **Checkout tasks** sit idle in "Watch" mode doing nothing until a monitor pings them
- When monitor detects stock → pings checkout → checkout fires ATC + full checkout

**Key insight**: Checkout tasks never poll. They only wake on a monitor ping. This means:
- Zero wasted requests on the checkout session
- Session stays "cold" and clean until the exact moment it's needed
- No risk of triggering rate limits before the item even drops

**What we're missing**: Our extension does monitoring AND checkout in the same content script / tab. The monitor loop and checkout flow share the same session, same IP, same request cadence. Stellar's separation means the monitor can burn through proxies aggressively while the checkout session stays pristine.

---

### 2. Shape Security Cookie Bypass (The Real Secret Sauce)

Target uses **Shape Security** (now F5 Shape) for bot protection. Stellar's approach:

- **Dedicated browser extension** OR **Shape Module** generates "ATC cookies" continuously in a real browser
- These cookies are **account-independent** — generated on any Target page, used by any checkout task
- The bot consumes cookies **on demand** when it needs to add to cart
- Cookies are generated through actual browser rendering (passing Shape's JS challenges)
- Cookie expiration is configurable (default recommendation: 3,600,000ms = 1 hour)
- Shape intervals: 20-30 second generation cadence

**Two generation methods**:
1. **Browser Extension** (recommended) — runs in a real Chrome tab, handles proxy rotation internally, generates cookies while you browse Target
2. **Shape Module** (in-bot) — spawns browser windows (visible or "invisible" headless mode), runs Shape JS challenges, outputs cookies

**Critical detail**: Shape does **device-level fingerprinting**. If you get device-banned:
- 24-48 hour cooldown required
- Device bans are permanent if you keep hitting
- Extension and Shape module cannot run simultaneously with other proxy extensions

**What we're missing**: Our cookie harvest is simpler — we capture existing browser cookies from Target pages the user visits. Stellar is **actively generating** Shape-passing cookies in a loop, creating a pool of valid ATC tokens before the drop even starts. This is a fundamentally different approach: passive capture vs. active generation.

---

### 3. Account-Based Checkout (Not Guest)

Stellar uses **logged-in Target accounts**, not guest checkout:

- Each account gets exactly 1 checkout task (hard rule)
- Login via **Access Token** (harvested from browser, lasts days/weeks) or **Request Login** (email+password with IMAP for OTP)
- IMAP integration auto-pulls Target's 2FA/OTP codes from email
- Accounts don't need pre-saved payment or address — Stellar handles adding them via API
- Scaling = more accounts (10-20 accounts is the recommended sweet spot)

**Why this matters**: Account-based checkout is faster because:
- Payment/address already stored or auto-matched
- Session is pre-authenticated before the drop
- No guest checkout address/payment form-fill latency
- Target's account checkout path has fewer steps than guest

---

### 4. Proxy Strategy

Stellar recommends a **mixed proxy approach**:

- **ISP proxies** for monitoring (fast, stable, low ban rate)
- **Residential proxies** for checkout (rotating IPs, harder to detect)
- **1:1 minimum** proxy-to-task ratio, **2:1 recommended**
- Local PC only — servers are explicitly warned against (datacenter IPs are flagged)
- Separate proxy pools for monitor vs checkout tasks

**What we're missing**: Our extension runs on the user's single IP. No proxy rotation, no IP separation between monitoring and checkout. Stellar users literally have 25-50+ IPs rotating through their tasks.

---

### 5. Monitoring: API-First, Not Frontend

Two monitor modes:
- **API** (recommended) — direct backend inventory API calls (likely RedSky or similar)
- **ATC** — frontend-based checking (actually trying to add to cart to detect stock)

Additional filter: **"Monitor High Stock (10+) Only"** — only triggers checkout when 10+ units are available. This avoids false positives from flickering 1-2 unit restocks that sell out instantly.

**What we're missing**: This high-stock threshold is smart. We trigger on any positive inventory signal. Stellar lets users avoid wasting checkout attempts on phantom stock.

---

### 6. Timing & Task Discipline

- Monitors start **5-15 minutes before** a known drop and run 24/7 for random restocks
- Checkout tasks start AFTER monitors and sit in Watch mode
- Checkout delay: **≤3000ms** (this is the time between checkout steps, NOT monitoring interval)
- Monitoring delay: 8000-15000ms
- **Endless Mode** allows repeated checkout attempts after success (with configurable limit)

---

### 7. Tag Groups for Multi-SKU Targeting

- SKUs are grouped into "Tag Groups" (up to 30 SKUs per group)
- 1 monitor watches the entire group
- When ANY SKU in the group goes live, the checkout task fires
- Bot only purchases ONE SKU per checkout (not multiple items in cart)

**What we're missing**: We target a single product page. Stellar can watch 30 SKUs simultaneously and checkout whichever one drops first.

---

### 8. Payment Handling

- **Override Payment**: inject card details from Stellar's profile (bypasses Target's saved payment)
- **Saved Payment**: use whatever's on the Target account
- **Red Card support**: Target's own debit/credit card, CVV = 4-digit PIN
- Auto-matches billing/shipping from profile to account

---

## Key Differences: Stellar vs Our Extension

| Aspect | Stellar AIO | Our Extension |
|--------|------------|---------------|
| Architecture | Desktop app with separated monitor/checkout tasks | Browser extension, single tab |
| Anti-bot bypass | Active Shape cookie generation via browser extension + Shape module | Passive cookie capture from user browsing |
| Checkout type | Account-based (pre-authenticated) | Supports guest and account |
| Proxies | 25-50+ rotating ISP/residential IPs | User's single IP |
| Monitoring | Backend API calls, 30 SKUs simultaneously | Single product page, RedSky API |
| Checkout speed | ≤3000ms checkout delay, pre-warmed session | Limited by DOM interaction speed |
| Session mgmt | Pre-logged-in, token/IMAP auth, sessions survive restarts | Session depends on browser cookies |
| Scale | 10-20 accounts × 1 checkout each = parallel attempts | 1 browser = 1 attempt |
| Inventory filter | High stock (10+) threshold to avoid phantom stock | Any positive signal triggers |
| Device safety | 24-48h cooldown protocols, device ban awareness | No explicit device ban detection |

## Actionable Takeaways for Our Extension

1. **Separate monitoring from checkout session** — don't burn the checkout session with monitoring requests
2. **Active cookie generation** — pre-generate Shape-passing cookies before the drop, not passive capture
3. **High stock threshold** — add option to only trigger when inventory > N units
4. **Multi-SKU monitoring** — watch multiple products and checkout whichever drops first
5. **Pre-authenticated sessions** — prioritize account-based checkout with saved credentials
6. **Checkout step delays ≤3s** — their recommended ceiling for time between checkout API calls
7. **Monitor-to-checkout ping architecture** — even within a single extension, separate the polling loop from the checkout execution path
