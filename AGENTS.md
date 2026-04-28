# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

This is **Target Checkout Helper**, a Chrome extension (Manifest V3) that automates the checkout flow on Target.com. It is a pure client-side extension with no backend, no build step, no package manager, and no external dependencies. All files are vanilla HTML/CSS/JS. Declares **`cookies`**, **`debugger`**, and **`host_permissions`: `<all_urls>`** so the content script can load on any tab while **automation runs only on Target** (Walmart is detected but not automated — see `tasks/todo.md`). **`cookies`** is used for optional snapshot/replay of **Target** cookies; **`debugger`** is optional CDP attach from the popup (Target-only by default, or any tab if you enable Advanced).

### Extension files

All extension source lives in `target-checkout-helper/`:
- `manifest.json` — Chrome MV3 manifest
- `background.js` — Service worker for message relay
- `core/hosts.js` — Retailer hostname detection + cookie domain lists (shared with content)
- `core/debuggerBridge.js` — `chrome.debugger` attach/detach (service worker only)
- `cookieHarvest.js` — Target cookie snapshot pool (imported by `background.js`; see Cookie harvest below)
- `dropPollingTiming.js` — shared drop-window poll intervals (loaded by background + content)
- `content.js` — Content script (injected on `<all_urls>`; **init exits immediately** unless the page is Target, except a one-time Walmart TODO log)
- `main_world.js` — Injected in **MAIN** world on `*.target.com` only (not on every site)
- `popup.html`, `popup.js`, `popup.css` — Extension popup UI
- `icons/` — Extension icons

**Cookie harvest (Refract-style workflow):** With **Harvesting on**, visiting Target **login** or **product** (`/p/…`) pages captures `target.com` cookies into a **pool** stored in `chrome.storage.session` (cleared when you **quit the browser**; falls back to service-worker RAM only if `storage.session` is unavailable). **Harvest now** captures from the current profile. **Clear harvested** wipes the pool. **Apply next snapshot before checkout** replays one pooled snapshot (LIFO/FIFO) into the browser cookie jar immediately before automated navigation to checkout. Preferences (`harvestConfig`) stay in `chrome.storage.local`. For an OS-level “secured drive wiped each session,” use a **dedicated Chrome profile or portable install** on that volume — the extension cannot mount drives itself.

### Linting / syntax checks

There is no ESLint or other linter configured. Use `node --check` to validate JS syntax:
```
node --check target-checkout-helper/popup.js
node --check target-checkout-helper/background.js
node --check target-checkout-helper/content.js
node --check target-checkout-helper/dropPollingTiming.js
node --check target-checkout-helper/cookieHarvest.js
node --check target-checkout-helper/core/hosts.js
node --check target-checkout-helper/core/debuggerBridge.js
```

### Checkout speed tests (Node, no Target.com)

Measures **polling-interval logic** and a tiny CPU benchmark; it does **not** drive a real checkout (that needs Chrome + Target).

```
node scripts/checkout-speed-test.mjs
```

End-to-end time from add-to-cart through **review** is logged on the page as `[TCH] timing checkout_total_to_review: …ms` and summarized in the popup from stored `checkoutSpeeds`.

Reaching **shipping/payment/review** requires completing Target’s sign-in or guest checkout in the tab when prompted — the extension detects that gate (`checkout step: signin`), waits without spamming retries, and can click **Continue as guest** when that control is present.

On **`/checkout`**, the extension **does not** auto-reload or send you back to cart (that used to interrupt sign-in). Turn the extension **off** in the popup if you need a manual full page reload.

**Charges**: Nothing is purchased unless **you** click Target’s **Place order** (or you enable **Auto place order**, which can charge a real card). With form-fill mode off saved payment, if Target shows **wallet-only** payment (no card inputs), the extension **will not** auto-click Continue on that step — change payment on Target first if you need a different card.

### Running / testing the extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `target-checkout-helper` directory
4. The extension appears in the extensions list and toolbar

To test the popup UI: click the puzzle-piece icon in the Chrome toolbar, then click "Target Checkout Helper". Toggle ON, fill shipping/payment fields, click **Save settings**. Do not open `popup.html` as a `file://` page — `chrome.storage` is unavailable there (tabs and save use the real popup).

Run `node scripts/checkout-speed-test.mjs` for drop-polling logic checks.

### Key caveats

- There is no build step, no `package.json`, and no dependency installation needed.
- `content.js` uses `chrome.storage.local` and Chrome Extension APIs that only work in a Chrome extension context (not in Node.js or a regular browser page).
- The extension intentionally never clicks the "Place Order" button — it stops at the review step.
- After editing any file, reload the extension from `chrome://extensions` (click the circular refresh icon on the extension card) for changes to take effect.

### Drop discipline & session hygiene (industry-aligned, no cookie farming)

Retail bots often **warm sessions early**, **avoid hot config changes seconds before go-time**, and **refresh credentials on 401**. This extension does **not** implement proxy lists, cookie jars, or auto-harvesting (different trust model and permissions). It **does** adopt the same *ideas* where they fit a single-browser helper:

- **Expected drop time** tightens polling only inside the pre-window (see `dropPollingTiming.js`). Far from drop, background polling stays slower to avoid needless API pressure.
- **Popup tips** and the drop field hint: one Target tab, clear cart, fresh cookies / network when checkout acts “sticky,” and avoid toggling the extension in the last minute before a drop (same spirit as “live edit tasks only right before go-time” elsewhere).
- **401/403 from RedSky** (inventory fetches in `content.js` / `background.js`): a throttled on-page toast tells you to clear **site data for target.com**, reload, and sign in again — parallel to “clear cookies on 401” playbooks.
- On a **monitored** product page inside the drop tension window, a **one-time** toast reminds you to clear cart and use one tab.
