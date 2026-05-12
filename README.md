# BEATBOTS

**Target + Walmart Checkout Automation**

This repo now contains two systems that work together:

| Component | Location | What it does |
|-----------|----------|--------------|
| **BEATBOTS Desktop App** | `beatbots-app/` | Electron app — Shape harvesting, API monitoring, multi-account coordination, proxy management, cookie pool |
| **Chrome Extension (TCH)** | `target-checkout-helper/` | DOM automation in the browser — still functional standalone; now also forwards cookies to the desktop app via WebSocket |

---

## Quick Start — App + Extension Together

### Prerequisites

- Node.js 18+
- Chrome browser
- A Target account with a saved shipping address and saved payment card

### Step 1: Install & launch the desktop app

```bash
cd beatbots-app
npm install
npm run electron:dev
```

The BEATBOTS window opens.

### Step 2: Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `target-checkout-helper/` folder
4. Pin it to your toolbar (puzzle piece → pin)

### Step 3: Configure the desktop app

Do these in order inside the BEATBOTS window:

**Settings** — Set Discord webhook (optional), leave WebSocket port at 9235, click Sync Now for NTP.

**Profiles** — Click **+ New Profile** → fill in your name, shipping address, and card details → Save.

**Accounts** — Click **+ New Account** → enter your Target email and password → Save → click **Login** on the row to authenticate.

**Products** — Click **+ New Group** → name it, set retailer to Target → Save. Then click **+ TCIN** for each product and enter the TCIN number (the `A-XXXXXXXX` from the Target URL), a name, and quantity.

**Tasks** — Click **+ New Task**:
- Mode: **Checkout**
- Select your Profile, Account, and Product Group
- Set the **Drop expected at** time
- Advanced: toggle Auto place order, max price, checkout sound as needed
- Save

### Step 4: Turn on cookie harvesting in the extension

1. Click the extension icon → toggle **ON**
2. Under Cookie harvest: check **Harvesting on**, set harvests per page load to **3**, check **Apply next snapshot before checkout**
3. Browse 3-4 Target product pages to build the pool — watch "Snapshots ready" climb to 5+

### Step 5: Verify the connection

In the BEATBOTS app → **Settings** → Extension bridge section: it should show **1 connected**. The Dashboard should show Login/ATC cookie counts climbing as the extension sends harvests.

### Step 6: Start the task

Go to **Tasks** → click **Start** on your task. The app monitors Target's API, and when stock appears it runs a full API checkout using the extension-fed cookies.

### What each piece does during a drop

| Component | Job |
|---|---|
| Chrome extension | Harvests Shape cookies from your real Target browsing → sends to app via WebSocket |
| Desktop app monitor | Polls RedSky inventory API (250ms near drop time) |
| Desktop app checkout engine | Fires HTTP requests to Target's cart/checkout API using pooled cookies |
| Puppeteer harvester (optional) | Backup cookie source in a separate Chrome instance |

### If something goes wrong

- **No cookies in pool** → browse a Target page in Chrome, click Harvest Now in the extension
- **Extension not connected** → check that both sides use port 9235, reload the extension from `chrome://extensions`
- **Session stale** → sign into Target again in Chrome, or re-Login the account in the app
- **Shape blocked (409/429)** → the app auto-retries with a fresh cookie from the pool

---

## What Changed and Why

### Background

The original Chrome extension (`target-checkout-helper/`) automated Target and Walmart checkouts entirely through DOM manipulation in the browser. After researching how **Stellar AIO** and **Refract** are structured, three critical gaps were identified:

1. **Shape Security**: The extension passively captured whatever cookies happened to be in the browser. Competitors actively generate Shape-passing ATC cookies on 20-30s cycles using a dedicated browser module that auto-clicks Add to Cart and intercepts the outgoing request's Shape challenge response.

2. **API Checkout Speed**: DOM automation is bottlenecked by page renders, React reconciliation, and form fills. Competitors bypass the DOM entirely and send HTTP requests directly to Target's checkout API endpoints.

3. **Multi-session Architecture**: The extension runs one checkout attempt in one tab with one session. Competitors run N accounts in parallel, each with a pre-authenticated session and assigned proxy, waiting for the monitor ping.

The desktop app closes these gaps while keeping the extension as a working companion (and fallback).

---

## How the New System Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                 BEATBOTS Desktop App                │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Monitor  │  │  Cookie  │  │  Shape Harvester  │ │
│  │ Engine   │  │   Pool   │  │  (Puppeteer)      │ │
│  │ (RedSky) │  │ login+atc│  │  auto-ATC click   │ │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘ │
│       │  stock      │  consume         │ add        │
│       ↓             ↓                  ↓            │
│  ┌───────────────────────────────────────────────┐  │
│  │            IPC / Zustand Store                │  │
│  └───────────────────────────────────────────────┘  │
│       ↑                              ↑              │
│  ┌────┴──────┐              ┌────────┴──────────┐   │
│  │ React UI  │              │  WebSocket Server  │  │
│  │ Dashboard │              │  ws://127.0.0.1:9235│ │
│  │ Tasks     │              └────────────────────┘  │
│  │ Harvesters│                        ↑             │
│  │ Profiles  │                        │ cookie_harvest│
│  │ Accounts  │              ┌─────────┴──────────┐  │
│  │ Proxies   │              │  Chrome Extension  │  │
│  │ Products  │              │  (background.js)   │  │
│  │ Settings  │              │  still works solo  │  │
│  └───────────┘              └────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Cookie Pool (Phase 2A)

The cookie pool holds two kinds of harvested cookies:

- **`atc` cookies** — captured by clicking Add to Cart on a real Target product page. Shape Security runs its JS challenge during the click event; the outgoing request headers contain a freshly-generated `_abck`/`bm_sz`/Shape token. The ATC request is expected to fail ("Something went wrong") — the point is capturing the token, not the cart.
- **`login` cookies** — captured by visiting Target's sign-in page. Shape runs a different challenge variant there.

Both kinds expire (configurable TTL, default 5 minutes). The pool enforces a 50-entry cap and supports LIFO or FIFO rotation. When the API checkout engine needs to ATC, it pulls a cookie from the pool and attaches it to the HTTP request headers.

**Why this matters vs. the extension's passive harvest**: `cookieHarvest.js` snapshotted whatever happened to be in `document.cookie` at page load time. These were real-session cookies that worked because the user was browsing normally. The new system purposely generates fresh Shape responses on a timer, independent of user behavior — the same discipline Stellar and Refract use.

### Shape Harvester (Phase 2B)

`src/main/engines/shape-harvester.ts` — Puppeteer-controlled Chrome instance that:

1. Navigates to a Target product page (or login page for `login` kind)
2. Waits for page load, then clicks the Add to Cart button
3. Intercepts outgoing XHR/fetch via CDP `Network.enable` + `Network.setRequestInterception`
4. Extracts cookies from the `cookie` header of any `api.target.com/cart` request
5. Stores the cookies in the in-memory pool

The harvester is browser-visible or headless (toggle in the UI), supports per-harvester proxies, auto-restarts on crash, and shows live harvested-count. Multiple harvesters can run simultaneously targeting different product pages.

**Why Puppeteer and not a pure HTTP approach**: Shape Security detects non-browser TLS fingerprints (JA3/JA4), unusual header ordering, and missing browser environment signals. Running actual Chrome — even headlessly — means the TLS fingerprint and JS environment match a real browser. The stealth patch (`evaluateOnNewDocument`) removes the `navigator.webdriver` flag.

### WebSocket Bridge (Phase 2C)

The desktop app runs a WebSocket server on `127.0.0.1:9235`. The extension's `background.js` auto-connects on service worker startup and sends a `cookie_harvest` message whenever cookies are captured:

```js
// extension → app
{ type: 'cookie_harvest', kind: 'atc'|'login', cookies: {...}, shapeHeaders: {...} }
```

This means the existing browser extension (used by people who are actively browsing Target) also feeds cookies into the desktop app's pool. The two harvest sources are additive. If the desktop app is not running, the bridge silently fails and the extension operates exactly as before — no breaking change.

### Checkout Engine (Phase 4)

`src/main/engines/checkout-engine.ts` — executes Target's full checkout over HTTP, no DOM involved:

| Step | Endpoint | Notes |
|------|----------|-------|
| ATC | `POST /web_checkouts/v1/cart_items` | Shape cookies attached as `cookie` header |
| Init checkout | `POST /web_checkouts/v1/checkout` | Returns `checkoutId` |
| Shipping | `PUT /web_checkouts/v1/checkout/:id/address` | Jig'd address from profile |
| Payment | `POST /web_checkouts/v1/checkout/:id/payment` | Card from profile, billing zip |
| Place order | `POST /web_checkouts/v1/checkout/:id/place_order` | Only if `autoPlaceOrder` is enabled |

Every request carries `authorization: Bearer <token>`, `x-api-key`, `x-t-request-id` (UUID per request), `x-visitor-id`, and the Shape cookie string assembled from the pool entry's captured cookies.

Shape block detection: 409/429 with a Shape error code triggers a Discord notification, drops the blocked cookie, waits up to 15s for a fresh one, and retries. Out-of-stock (422) is treated as non-retryable. Server errors (5xx) are retried with exponential backoff up to `retryMaxAttempts`.

Extra product: if `addExtraProduct` is enabled in task settings, a cheap filler TCIN is added to cart first. This reduces the likelihood of Target flagging a single-item cart.

### Session Manager (Phase 5)

`src/main/engines/session-manager.ts` — handles Target account authentication:

- `POST /guests/v3/tokens` with `{ username, password, keep_me_signed_in: true }`
- Tokens cached in memory with a 60-second early-expiry guard
- Token persisted back to the account record in DB on each successful login
- 449 MFA response: pauses, polls the account's IMAP inbox every 3s (up to 60s), extracts the 6-digit OTP with 5 regex patterns, then re-submits the login with `{ otp }` appended
- IMAP reader is a pure Node.js TLS socket — no `imap` npm package, no native compilation

IMAP profiles (host/port/user/password) are managed on their own page in the UI and linked to accounts by ID. Each account can have a different inbox.

### Task Runner (Phase 4+)

`src/main/engines/task-runner.ts` — orchestrates the full pipeline per task:

1. Load profile, account, proxy list, product group from DB
2. Login / retrieve cached session
3. Wait for stock monitor ping (or proceed immediately in checkout mode)
4. Wait for Shape cookie if pool is empty (up to 30s)
5. Run `CheckoutEngine.run()` with all loaded dependencies
6. On success: increment counter, notify Discord, push success toast, signal monitor
7. On failure: exponential backoff (`delay × 2^attempt`, cap 30s), re-login on 401, Shape re-consume on block
8. Endless mode: loop back to step 3 after success, up to `endlessLimit` times

All task status transitions push to the renderer in real time via `push:taskUpdate` IPC events.

### Monitor Engine (Phase 3)

`src/main/engines/monitor.ts` — ports the RedSky polling logic from `content.js` into the main process:

- Polls `redsky.target.com/redsky_aggregations/v1/web/pdp_fulfillment_v1` for each configured TCIN
- Parses `availability_status`, ATP quantity, and price from the fulfillment response
- Enforces high-stock filter, max-price filter, and per-TCIN honeypot cooldown
- Applies the full drop-aware timing system from `dropPollingTiming.js`
- Emits `stock` events that push to the renderer via IPC and trigger Discord notifications

**Why run the monitor in the main process instead of the extension**: The extension monitor runs in a Chrome service worker that can be killed by the browser, is single-threaded with the DOM, and shares the browser's IP with the user's normal browsing. The main process monitor runs independently with its own clock, can be assigned ISP proxies, and doesn't require the user to have a browser tab open.

---

## Comparison to Research: Decision Rationale

### What Stellar Does

From their documentation and competitive research:

| Area | Stellar AIO |
|------|-------------|
| Architecture | Electron app + companion extension |
| Shape | Active cookie generation loop, 20-30s intervals, 1hr TTL |
| Checkout | Full API flow — HTTP requests, no DOM |
| Monitor | API-based, 8-15s intervals |
| Accounts | 10-20 pre-authenticated sessions |
| Proxies | ISP for monitor, residential for checkout, 2:1 ratio |
| Multi-SKU | Tag groups of up to 30 SKUs |

### What Refract Does (from reverse engineering)

- Active Shape harvesting via extension (same click-intercept pattern)
- `curl_cffi` or equivalent for TLS fingerprint matching in the HTTP client
- Cookie pool stored in RAM, LIFO rotation, 5-10 min TTL
- Login session pre-warmed before drops with stored access tokens

### Our Decisions vs. Research

**Decision: Match the Electron + extension hybrid architecture**
Stellar and Refract both use this pattern. It allows the desktop app to manage proxies, run parallel sessions, and persist state across browser restarts, while the extension handles DOM automation on pages that require it.

**Decision: Match Stellar's active cookie generation approach**
Stellar uses a dedicated extension for Shape harvesting. We use Puppeteer in the main process instead. Tradeoff: Puppeteer launches a separate Chrome process (heavier) but requires no extension ID management, works without installing a second extension, and is easier to configure per-harvester proxy routing. The interception mechanism (CDP request intercept on `api.target.com/cart`) is the same pattern regardless of implementation.

**Decision: Keep LIFO rotation as default (matches Refract)**
Refract discards the oldest cookies first (LIFO = newest-first consumption). Newest cookies have the freshest Shape token — still within Target's expected session window. FIFO would use stale tokens first and waste them. LIFO is the correct default.

**Decision: Keep DOM automation in the extension (not full API checkout yet)**
Full API checkout requires reverse-engineering Target's checkout HTTP flow, which changes frequently. Stellar spends significant engineering keeping this current. Our DOM approach is more resilient to Target frontend changes and harder to detect because it looks like real user behavior. The API checkout engine is Phase 4 — building the cookie pool and monitor first ensures we have the prerequisites before tackling the hardest problem.

**Decision: Pure JSON file storage instead of SQLite**
`better-sqlite3` requires native compilation (Visual Studio build tools). On Windows without a proper VS install, this blocks the setup. JSON files in Electron's `userData` directory work everywhere without compilation, handle the data volumes involved (hundreds of profiles/tasks/proxies), and are trivially debuggable. The tradeoff (no complex queries) doesn't matter for our entity types.

**Where we're ahead of what's documented**

| Feature | Notes |
|---------|-------|
| Drop-aware adaptive polling | 5-tier system: >45m idle → >30m slow → normal → 10m pre-drop tension → 3m post-drop grace |
| Session recovery with PX preservation | Clears site data on 401/403 streaks while preserving PerimeterX `_px*` cookies to avoid triggering bot detection |
| Checkout speed telemetry | Per-checkout timing stored and displayed |
| CDP Bezier mouse simulation | 8-14 step randomized mouse paths for click simulation |
| Streaming HTML stock fallback | Parses live HTML stream when RedSky is unavailable |
| NTP clock sync | Target's server time offset measured and applied to drop countdown |

---

## Running the Desktop App

**Requirements**: Node.js 18+, npm, Chrome installed

```bash
cd beatbots-app
npm install
```

**Development** (opens Electron with DevTools):
```bash
npx vite &                                       # start renderer dev server
$env:NODE_ENV="development"
$env:VITE_DEV_SERVER_URL="http://localhost:5174/"
npx electron dist-electron/main/index.js        # launch main process
```

**Production build**:
```bash
npx vite build         # builds renderer + main process
npm run electron:build # packages to release/ as .exe
```

App data is stored in `%APPDATA%\beatbots-app\beatbots-data\` (Windows).

### Connecting the Extension

1. Load `target-checkout-helper/` as an unpacked extension in Chrome
2. Launch the BEATBOTS desktop app
3. The extension auto-connects to the WebSocket server (default port 9235)
4. Cookies captured by the extension during normal Target browsing are forwarded to the app's cookie pool automatically

The WebSocket port can be changed in the desktop app's Settings page. Update `beatbotsWsPort` in the extension's Chrome storage if you change it.

---

## Chrome Extension (Standalone)

The extension continues to work without the desktop app. All original features are intact:

- DOM-based checkout automation (Target + Walmart)
- Passive cookie harvest pool with TTL and LIFO/FIFO rotation
- Drop-aware adaptive polling
- CDP Bezier mouse simulation and key-by-key typing
- Session recovery on 401/403 streaks
- NTP clock sync for drop timing
- Multi-SKU product lists with quantity targets
- Discord webhook notifications
- Walmart IMAP 2FA via native messaging host
- **Per-product Skip Monitoring** — bypass the RedSky stock check for specific Target products at drop time (treats item as in-stock when the drop countdown expires)
- **Hype Mode per-product** — gates ATC on the cookie pool having at least one harvested snapshot; aborts with a toast if the pool is empty, preventing wasted checkout attempts without a valid Shape cookie
- **API Error Retry Delay** — separate configurable delay (default 3500ms, per Refract's Target recommendation) applied when RedSky returns 401/403/timeout errors, instead of the normal poll interval

### Extension Installation

**Windows**:
1. Download and extract the repo
2. Run `target-checkout-helper-installer.exe`
3. In Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `target-checkout-helper/`

**macOS / Linux**:
```bash
chmod +x install.sh && ./install.sh
```

### First-time Setup

1. Click the extension icon in the Chrome toolbar
2. Fill in shipping and payment details under **Shipping & pay**
3. Click **Save settings**
4. Add product URLs in the **Monitor** tab
5. Set your drop time and click **Start monitoring**

### Walmart IMAP 2FA (optional)

Automatically reads and submits Walmart's 6-digit sign-in codes from your inbox.

**Requirements**: Node.js, Gmail App Password

```bash
cd target-checkout-helper/native-host
npm install
cp com.tch.imapbridge.json.example com.tch.imapbridge.json
# Edit com.tch.imapbridge.json: set path to run-bridge.cmd, set allowed_origins to your extension ID
# Windows: run installer\install-native-host.bat
# macOS/Linux: run installer/install-native-host.sh
```

Then in the popup → Accounts tab: fill in IMAP host/port/credentials → Enable IMAP auto-read → Save.

---

## What's Next (Roadmap)

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 — Electron Shell | Done | App scaffold, React UI, JSON storage, IPC |
| Phase 2A — Cookie Pool | Done | In-memory dual pool, TTL, LIFO/FIFO, rate tracking |
| Phase 2B — Shape Harvester | Done | Puppeteer ATC clicker, CDP cookie intercept |
| Phase 2C — WS Bridge | Done | Extension → app cookie forwarding |
| Phase 3 — Monitor Engine | Done | RedSky polling in main process, drop timing, Discord |
| Phase 4 — API Checkout | Done | Target HTTP checkout flow (ATC → checkout → ship → pay → place) |
| Phase 4+ — Retry Engine | Done | Exponential backoff, Shape re-consume, 401 re-login, endless mode |
| Phase 4+ — Extras | Done | Extra product ATC, NTP sync, jig address |
| Phase 5 — Session Manager | Done | Multi-account login, token cache, IMAP OTP, Gmail App Password |
| Phase 6 — Proxy Manager | Done | Per-task proxy assignment, random rotation, test endpoint |
| Phase 7 — Package | Done | electron-builder config, NSIS installer, checkout sounds, window controls, drop countdown |
| Phase 8 — Walmart Module | Future | API checkout for Walmart, Queue-it, PerimeterX |

---

## Project Structure

```
BEATBOTS/
├── beatbots-app/                    # Electron desktop app (NEW)
│   ├── src/
│   │   ├── main/
│   │   │   ├── index.ts             # Electron main process entry
│   │   │   ├── preload.ts           # contextBridge → renderer
│   │   │   ├── storage/
│   │   │   │   └── db.ts            # JSON file store (userData)
│   │   │   ├── engines/
│   │   │   │   ├── monitor.ts         # RedSky inventory polling engine
│   │   │   │   ├── shape-harvester.ts # Puppeteer ATC cookie capture
│   │   │   │   ├── ws-bridge.ts       # WebSocket server for extension
│   │   │   │   ├── checkout-engine.ts # Target API checkout (ATC→ship→pay→place)
│   │   │   │   ├── session-manager.ts # Login, token cache, IMAP OTP
│   │   │   │   └── task-runner.ts     # Task lifecycle, retries, endless mode
│   │   │   ├── models/
│   │   │   │   └── cookie-pool.ts     # In-memory login+ATC cookie pool
│   │   │   ├── ipc/
│   │   │   │   └── handlers.ts        # All ipcMain handlers
│   │   │   └── utils/
│   │   │       ├── drop-timing.ts     # Port of dropPollingTiming.js + NTP sync
│   │   │       └── discord.ts         # Discord webhook notifications
│   │   ├── renderer/                  # React UI
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx      # Live stats, monitor status, recent tasks
│   │   │   │   ├── Tasks.tsx          # Task create/start/stop, basic+advanced settings
│   │   │   │   ├── Profiles.tsx       # Shipping & payment profiles with jig index
│   │   │   │   ├── Accounts.tsx       # Target accounts + login button + status
│   │   │   │   ├── Proxies.tsx        # Proxy lists (ISP/residential/DC) + test
│   │   │   │   ├── Products.tsx       # Product groups + multi-TCIN management
│   │   │   │   ├── Harvesters.tsx     # Shape harvester control + pool status
│   │   │   │   ├── ImapProfiles.tsx   # IMAP profiles for OTP auto-read
│   │   │   │   └── Settings.tsx       # Discord, cookie TTL, NTP, WS port
│   │   │   ├── components/            # Sidebar, Modal, Input, Button, Toast, etc.
│   │   │   ├── store.ts               # Zustand global store
│   │   │   └── bridge.ts              # Type-safe IPC bridge
│   │   └── shared/
│   │       └── types.ts             # All shared TypeScript types + IPC channel names
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── target-checkout-helper/          # Chrome extension (updated)
│   ├── background.js                # + BEATBOTS WebSocket bridge client
│   ├── content.js                   # DOM automation (unchanged)
│   ├── cookieHarvest.js             # Passive cookie pool (unchanged)
│   ├── dropPollingTiming.js         # Drop timing (unchanged)
│   ├── popup.js / popup.html        # Extension UI (unchanged)
│   └── ...
│
├── tasks/
│   ├── stellar-target-intel.md      # Stellar AIO competitive research
│   └── stellar-vs-us-comparison.md  # Full feature gap analysis
└── README.md                        # This file
```

---

### Post-Phase-7 Fixes & Features

**1. Cart clear before ATC** (`checkout-engine.ts` step 0)
Every checkout now starts with `DELETE /web_checkouts/v1/cart`. This eliminates the "cart in use" 409 error that occurred when a previous checkout left items. The call is fire-and-forget — non-fatal if no cart exists.

**2. Order ID capture & display** (`task-runner.ts`, `tasks.ts`, `types.ts`)
`place_order` response order ID and order total are stored in `Task.lastOrderId` / `Task.lastOrderTotal` and shown inline in the task row with green price display.

**3. Task run logs** (`task-runner.ts`, `Tasks.tsx`, `types.ts`)
Every run (success, error, shape_block, stopped) writes a `TaskRunLog` entry to the `task_run_logs` store. Max 100 entries per task (oldest trimmed). A log drawer accessible via the 📋 button shows outcome, TCIN, order ID, total, duration, and error text per run.

**4. Bulk task ops** (`Tasks.tsx`, `handlers.ts`)
- `▶ Start All` — starts all tasks in idle/stopped/error/success state in parallel
- `Stop All` — aborts all running tasks via `taskRunner.stopAll()`
- `⧉ Duplicate` — clones a task with "(copy)" suffix, reset counters

**5. Guest checkout** (`session-manager.ts`, `task-runner.ts`, `Tasks.tsx`)
Toggle `Guest Checkout` in task settings. Creates a session via `POST /guests/v1/tokens` (no account required). Guest sessions also invalidate and refresh on retry. The account selector hides when guest mode is on.

**6. Sound toggle fix** (`task-runner.ts`, `App.tsx`)
Success toasts now **always** show regardless of `checkoutSound`. The chime only plays when `checkoutSound` is `true` (carried as `playSound` flag in the toast IPC message). Previously the toast was suppressed when sound was off.

**7. Live WS port in Settings** (`handlers.ts`, `Settings.tsx`)
Settings page polls `ws:status` every 3 seconds and shows:
- Live port (may differ from configured port if auto-stepped on bind conflict)
- Connected extension count (green dot when ≥1)
- Warning badge when live port ≠ configured port

**8. Import / Export** (`db.ts`, `handlers.ts`, `Settings.tsx`)
"Export Backup" opens a native save dialog and writes all stores + settings to a JSON file. "Import Backup" opens a native open dialog and restores everything. Both use `electron.dialog` (native OS file pickers). Stores covered: profiles, accounts, proxy_lists, product_groups, monitor_products, harvesters, tasks, imap_profiles.

### Phase 7 — Packaging & Polish

**electron-builder** (`beatbots-app/package.json` → `build` key):
- Target: Windows NSIS installer (`BEATBOTS-Setup-x.y.z.exe`), x64 only
- NSIS: per-user install, optional directory change, desktop + Start Menu shortcut
- `build/icon.ico` slot for custom icon (run `build/generate-icons.mjs` with `canvas` installed)
- `electron:build` script: `vite build && electron-builder --win`

**Window controls** — native frame is off (`frame: false`). Min/Maximize/Close routed via `ipcMain.on('window:minimize' | 'window:maximize' | 'window:close')`, called from the TitleBar component via `window.electronAPI.{minimize,maximize,close}`.

**Checkout sound** — Web Audio API chime (three-note ascending sine wave). Plays automatically on any `success` toast. No audio files required.

**Drop countdown** — `DropCountdown` component shows a live `Xh Ym Zs` timer on Dashboard. Turns green and shows "DROP WINDOW — FAST POLLING" inside the 3-minute window. Reads `dropExpectedAt` from task settings.

**Monitor auto-start** — when a task is started and a product group is configured, the monitor engine starts automatically (no manual start needed from the Harvesters page).

---

## Notes

- The desktop app does not require the extension to function. The extension does not require the desktop app.
- Auto Place Order is off by default in both systems. Enable it explicitly in the task settings (desktop app) or popup (extension). It will charge your card.
- No external servers, no telemetry, no accounts. All data stays on your machine.
- The extension's `chrome.storage.local` data is separate from the desktop app's JSON storage. They share cookies only via the WebSocket bridge.
- To build the Windows installer: `cd beatbots-app && npm run electron:build`. Output lands in `beatbots-app/release/`.
