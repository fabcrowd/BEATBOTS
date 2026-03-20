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

### Running / testing the extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `target-checkout-helper` directory
4. The extension appears in the extensions list and toolbar

To test the popup UI: click the puzzle-piece icon in the Chrome toolbar, then click "Target Checkout Helper". Toggle ON, fill shipping/payment fields, click **Save Settings**.

### Key caveats

- There is no build step, no `package.json`, and no dependency installation needed.
- `content.js` uses `chrome.storage.local` and Chrome Extension APIs that only work in a Chrome extension context (not in Node.js or a regular browser page).
- The extension intentionally never clicks the "Place Order" button — it stops at the review step.
- After editing any file, reload the extension from `chrome://extensions` (click the circular refresh icon on the extension card) for changes to take effect.
