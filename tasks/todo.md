# Target Checkout Helper — Build Plan

## Status: Complete

### All Files Built
- [x] `manifest.json` — Chrome MV3 manifest with permissions, content scripts, popup
- [x] `background.js` — Service worker relaying messages between popup and content scripts
- [x] `content.js` — Full checkout automation: product page → cart → shipping → payment → review stop
- [x] `popup.html` — Extension popup UI (enable toggle, shipping form, payment form)
- [x] `popup.css` — Clean, compact Target-branded styling
- [x] `popup.js` — Save/load settings via chrome.storage.local, broadcast to content script
- [x] `icons/icon{16,48,128}.png` — Target-style bullseye icons
- [x] Verified: all manifest references valid, field IDs match, message flow consistent

## How to Install
1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" → select the `target-checkout-helper` folder
4. Pin the extension, open popup, enter your info, toggle ON

## Architecture Notes
- All user data stored locally via `chrome.storage.local` — nothing leaves the browser
- Content script uses `MutationObserver` to handle Target's React SPA
- Place Order button is **never** auto-clicked — user always confirms
- React input filling uses native setter + synthetic events
