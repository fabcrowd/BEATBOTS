# PRD: Walmart Account Login Flow

## Overview

Target sign-in helpers live in `core/signinStep.js` (user-login feature). Walmart has a parallel login gate in `walmart-content.js` when **Use Saved Session** is off: redirect to `/account/login`, show a persistent toast, and poll IMAP for 2FA. This feature extracts testable Walmart login helpers and wires them through the shared module.

## Goals

- Detect Walmart login pages via pathname (`/account/login`).
- Centralize “should redirect to login?” logic when saved session is off and user appears logged out.
- Reuse shared login status label patterns where applicable.
- Node tests for Walmart helpers (no live walmart.com).

## User Stories

1. **As a Walmart drop user with saved session off**, I get redirected to login when not authenticated.
2. **As a user on the login page**, I see a clear persistent toast about captcha and optional IMAP 2FA.
3. **As a developer**, I can test Walmart login path detection without a browser.

## Requirements

### Functional

1. `classifyWalmartLoginPath(path)` returns true for `/account/login`.
2. `shouldRedirectToWalmartLogin({ useSavedSession, isLoggedIn, path })` returns true only when saved session is off, not logged in, and not already on login page.
3. `walmart-content.js` uses shared helpers instead of inline `/account/login` regex.

### UI

4. Walmart login toast copy exported as `WALMART_LOGIN_WAIT_MESSAGE` for consistency.

### Testing

5. Extend `scripts/signin-step-test.mjs` with Walmart cases.
6. Load `signinStep.js` in Walmart content script bundle (manifest).

## Non-Goals

- Target login changes (already done).
- Automating Walmart captcha or new credential storage.
- Popup Walmart login status row (future).

## Technical Considerations

- Add `core/signinStep.js` to Walmart `content_scripts` in `manifest.json`.
- Keep IMAP 2FA polling in `walmart-content.js` (needs DOM/chrome APIs).

## Success Metrics

- All Node sign-in tests pass including Walmart cases.
- `node --check` on touched files passes.
