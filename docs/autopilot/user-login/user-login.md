# PRD: Target Checkout User Login

## Introduction / Overview

The Target Checkout Helper extension already detects checkout sign-in gates and can auto-fill Target.com credentials when **Auto sign-in** is enabled in the popup. This feature hardens that flow: clearer status in the popup, safer credential handling signals, reliable guest-checkout fallback, and automated tests so sign-in no longer blocks unattended checkout runs.

**Problem:** During high-speed drops, users get stuck on Target’s sign-in or guest-choice step. The extension sometimes waits indefinitely, shows unclear status, or does not attempt guest checkout when credentials are absent.

**Goal:** Make Target retailer login during checkout predictable, visible, and testable without manual babysitting.

## Goals

- Detect Target sign-in / guest-checkout gates reliably on `/checkout` and standalone login pages.
- Surface login state in the popup (logged in / not logged in / unknown).
- Auto-fill email/password only when the user explicitly enabled **Auto sign-in** and saved credentials.
- Click **Continue as guest** when auto sign-in is off or credentials are missing, if Target shows that option.
- Never interrupt an in-progress manual sign-in (no reload loops on `/checkout`).
- Add Node-level tests for sign-in detection helpers and guest-button matching logic.

## User Stories

1. **As a drop user with saved credentials**, I want the extension to fill Target sign-in during checkout so I reach shipping without typing.
2. **As a guest checkout user**, I want the extension to choose guest checkout when offered so I am not blocked on sign-in.
3. **As any user**, I want the popup to show whether Target thinks I am logged in before a drop.
4. **As a developer**, I want automated tests for sign-in step detection so regressions are caught without live Target.com.

## Requirements

### Functional

1. `detectCheckoutStep()` (or equivalent) returns `signin` when Target shows sign-in or guest-choice UI on checkout.
2. Guest checkout button detection matches common Target copy (`continue as guest`, `checkout as guest`, etc.).
3. `tryAutoSignIn()` no-ops when `autoSignIn` is false or credentials are empty.
4. When on sign-in step without auto sign-in, attempt guest continue once per page load (no spam).
5. Popup **Accounts** / status row reflects login probe result from background (`loggedIn` true/false/unknown).

### UI

6. Toasts during auto sign-in use short, distinct messages (email → password → submit).
7. Persistent toast on checkout sign-in when waiting for manual action and auto sign-in is off.

### Integration

8. Settings `autoSignIn`, `targetEmail`, `targetPassword` persist via `chrome.storage.local` and load in `content.js`.
9. Login probe uses existing Target API/cookie checks in `background.js` without new host permissions.

### Testing

10. Add `scripts/signin-step-test.mjs` covering guest-button needle matching and sign-in step classification helpers extracted or mirrored from `content.js`.
11. Wire `scripts/signin-step-test.mjs` into `checkout-speed-test.mjs` or document as separate npm script; all must pass in CI-less Node runs.

## Non-Goals (Out of Scope)

- Storing Target passwords outside `chrome.storage.local` or adding encryption beyond Chrome profile security.
- Automating CAPTCHA, SMS 2FA, or email OTP (except existing Gmail OTP path).
- Walmart account login changes (separate retailer flow).
- Backend user accounts for the extension itself.

## Technical Considerations

- Extension is vanilla JS, Manifest V3, no bundler — follow existing patterns in `content.js` and `popup.js`.
- Avoid new dependencies; use Node `vm` tests like `checkout-speed-test.mjs`.
- Do not auto-reload `/checkout` during sign-in (existing guard in `performRetryNavigation`).
- Syntax validation via `node --check`; functional tests via new `.mjs` scripts only.

## Success Metrics

- All Node sign-in helper tests pass.
- `node --check` passes on touched extension files.
- Manual smoke: on a mocked DOM fixture, guest button is found and sign-in step is classified correctly.

## Resolved Decisions

- **Retailer scope:** Target.com only for this feature.
- **Credential storage:** Keep existing plain-text local storage with UI warning (no new crypto layer).
- **Guest fallback:** Attempt once per page load when auto sign-in unavailable.
- **Test strategy:** Extract or duplicate pure helper logic into testable functions in a small shared module under `target-checkout-helper/core/`.
