# BEATBOTS — Setup & Usage Guide

Two components work together: the **Chrome extension** (browser-based checkout helper) and the **Electron app** (API-based checkout engine). You can use either standalone or both together for maximum speed.

---

## Architecture Overview

```
Chrome + Extension ──WebSocket──▶ Electron App
  (cookie farm)        :9235       (API checkout)
       │                              │
  harvests Shape                 consumes cookies
  cookies from                   fires HTTP requests
  real browsing                  to Target cart/checkout
```

- **Extension**: clicks buttons in the browser (ATC → checkout → shipping → payment → review)
- **Electron app**: sends raw HTTP requests to Target's REST APIs — skips all page rendering, much faster
- **Together**: extension feeds Shape cookies (Akamai bot defense) to the Electron app over WebSocket

---

## Part 1: Chrome Extension (standalone or cookie feeder)

### Install

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `target-checkout-helper/` folder
4. Pin the extension to your toolbar (puzzle piece icon → pin)

### Configure (popup)

1. Click the extension icon → **toggle ON**
2. **Cookie harvest** section:
   - Harvesting on: checked
   - Harvests per page load: 1 (bump to 3 near drop time)
   - Data expiration: 8 min
   - Apply next snapshot before checkout: checked
   - Cookie order: LIFO (newest first)
3. **Checkout options**:
   - Use saved payment & address: checked (requires saved card/address on your Target account)
   - Beep on review: checked
   - Auto place order: your choice (on = fully automated, off = stops at review page)
4. Browse a few Target product pages to build the cookie pool (watch "Snapshots ready" count)

### Add Products to Monitor

Paste Target product URLs into the **Product monitor** section. URLs must be `/p/...` format:

```
https://www.target.com/p/product-name/-/A-XXXXXXXX
```

Short format also works:

```
https://www.target.com/p/zephyr/A-XXXXXXXX
```

The extension only needs the `/A-XXXXXXXX` TCIN — the slug doesn't matter.

### Set Drop Time

Enter the expected drop time in the **Expected drop / restock** field. This tightens the poll interval:

| Time relative to drop | Poll interval |
|---|---|
| > 45 min before | 2000ms |
| 45 min to 10 min before | 500ms (baseline) |
| 10 min before → 3 min after | 250ms (tension window) |

### Start Monitoring

Click **Start monitoring**. The extension opens a background tab per product and polls Target's RedSky API. When stock is detected, it navigates to the product page and runs ATC through checkout automatically.

### What's Automated vs Manual

| Automated | Manual |
|---|---|
| ATC click | Signing in / password / 2FA |
| Navigate to checkout | CAPTCHAs |
| Fill or click through shipping | Wallet-only payment (no card fields) |
| Fill or click through payment | Place Order (unless Auto place order is on) |
| Continue as guest | |

### Safety

- Stops at **review** by default — nothing is purchased without Auto place order
- No auto-reload on `/checkout` to avoid breaking sign-in flows
- Max price gate prevents ATC above your configured limit

---

## Part 2: Electron App (API checkout)

### Install & Launch

```bash
cd beatbots-app
npm install
npm run electron:dev
```

### Build a Standalone .exe (optional)

```bash
npm run electron:build
```

Outputs `BEATBOTS-Setup-X.X.X.exe` to `beatbots-app/release/`.

### Configure (in the BEATBOTS window)

Do these in order — each step depends on the previous.

#### 1. Settings

- **WebSocket port**: 9235 (default, must match extension)
- **Discord webhook**: paste URL for notifications
- **Cookie pool TTL**: 8 min
- **Cookie order**: LIFO
- **Sync Now** for NTP clock sync

#### 2. Proxies (optional)

- Create a named proxy list
- Paste proxies one per line: `ip:port:user:pass`
- Click Test to verify

#### 3. Profiles

- Click **+ New Profile**
- Fill shipping address + payment card details
- Set jig index (0-9) for address jigging

#### 4. Accounts

- Click **+ New Account**
- Enter Target email + password
- Login method: Request Login (API)
- Click **Login** to authenticate

#### 5. Product Groups

- Click **+ New Group** → name it, set retailer to Target
- Add TCINs: click **+ TCIN** → enter TCIN number, name, quantity

#### 6. Shape Harvesters (optional backup cookie source)

- Click **+ New Harvester**
- Kind: ATC, Target URL: any product page, interval: 30000ms
- Start the harvester — it launches Puppeteer Chrome to collect Shape cookies

#### 7. Tasks

- Click **+ New Task**
- **Basic**: name, Mode: Checkout, Retailer: Target, select Profile, Account, Product Group
- **Drop expected at**: set the drop time
- **Advanced**: Auto place order, max price, retry settings, checkout sound
- Save, then **Start**

### What Happens at Drop Time

1. Monitor polls RedSky API (250ms near drop)
2. Stock detected → consumes Shape cookie from pool
3. API checkout fires: clear cart → ATC → init checkout → address → payment → (place order)
4. All HTTP — no browser, no page loads

---

## Part 3: Using Both Together (Maximum Speed)

This is the recommended setup for competitive drops.

### The Flow

1. **Electron app** handles checkout via API (fast)
2. **Chrome extension** feeds Shape cookies from real browsing (legit-looking)
3. **Puppeteer harvester** (optional) provides backup cookies

### Setup

1. Launch the Electron app (`npm run electron:dev`)
2. Load the extension in Chrome
3. In the extension popup: turn on **Harvesting**, browse Target pages
4. Verify connection: Electron app → Settings → Extension bridge → should show "1 connected"
5. Watch Dashboard — Login/ATC cookie counts should climb as extension sends harvests
6. Set up Profiles, Accounts, Products, Tasks in the Electron app
7. Start the task — the Electron app monitors and checks out via API using extension-fed cookies

### Confirm WebSocket Link

The extension connects to `ws://127.0.0.1:9235` automatically. If you change the port in the Electron app Settings, update `beatbotsWsPort` in the extension's `chrome.storage.local` to match.

---

## Drop Day Checklist

**Hours before:**
- [ ] Sign into Target in Chrome (saved address + saved card on account)
- [ ] Extension loaded and toggled ON
- [ ] Harvesting on, pool building (5+ snapshots)
- [ ] Electron app running, account logged in
- [ ] Product group created with all TCINs
- [ ] Task created with correct drop time

**15 min before:**
- [ ] Extension bridge shows connected in Electron Settings
- [ ] Dashboard shows cookies in pool
- [ ] Browse one more Target page for a fresh harvest
- [ ] Start the task

**At drop:**
- [ ] Don't touch anything — monitor detects stock, checkout fires
- [ ] Watch Dashboard + task logs for status
- [ ] If Auto place order is off, be ready to confirm

**If something goes wrong:**
- Session stale toast → sign into Target again in Chrome
- Cart loop → clear cart manually, let monitor re-trigger
- Stuck at payment → change payment method on Target.com
- No cookies in pool → browse a Target page, click Harvest Now in extension
