# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

This is **Target Checkout Helper**, a Chrome extension (Manifest V3) that automates the checkout flow on Target.com. It is a pure client-side extension with no backend, no build step, no package manager, and no external dependencies. All files are vanilla HTML/CSS/JS.

### Extension files

All extension source lives in `target-checkout-helper/`:
- `manifest.json` — Chrome MV3 manifest
- `background.js` — Service worker for message relay
- `dropPollingTiming.js` — shared drop-window poll intervals (loaded by background + content)
- `content.js` — Content script injected on target.com pages
- `popup.html`, `popup.js`, `popup.css` — Extension popup UI
- `icons/` — Extension icons

### Linting / syntax checks

There is no ESLint or other linter configured. Use `node --check` to validate JS syntax:
```
node --check target-checkout-helper/popup.js
node --check target-checkout-helper/background.js
node --check target-checkout-helper/content.js
node --check target-checkout-helper/dropPollingTiming.js
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
