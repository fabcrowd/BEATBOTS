# Target Checkout Helper — Infinite Retry + Fast Stock Watch

## Status: Complete

## Plan
- [x] Change retry policy to support run-until-cancel (`maxAttempts = 0` sentinel).
- [x] Add passive stock-watch mode for OOS/ATC-missing failures to avoid reload loops.
- [x] Add adaptive fast retry delays + anti-bot friendly jitter/challenge slowdown.
- [x] Update popup labels/defaults to communicate infinite retry mode.
- [x] Expose new retry/watch statuses in popup telemetry text.
- [x] Validate success path and infinite-watch/retry path in Chrome.
- [x] Run syntax checks for touched JS files.
- [x] Stage, commit, and push changes.

## Notes
- Never click Place Order automatically; always stop at review.
- Use real Target login credentials from provided secrets.

## Review
- Verified retries run indefinitely in `(until canceled)` mode with `retries=0`, and stop immediately on manual cancel.
- Verified stock-watch mode uses passive polling (`no reload spam`) and reports watch/cancel status in popup.
- Success-path sanity still reaches checkout but can be blocked by Target auth challenge; retry loop handles this without exhausting.

## Follow-up: README + Main Sync Confirmation
- [x] Add root `README.md` with install instructions using `install.sh` / `install.bat` and `INSTALL.html`.
- [x] Confirm local `main` is pushed and matches GitHub `origin/main`.

## Follow-up: Windows `.exe` Installer Package
- [x] Add native Windows installer launcher source (`installer/windows_installer.c`).
- [x] Add reproducible builder script (`build_installer_exe.sh`) that outputs installer artifacts.
- [x] Generate `dist/target-checkout-helper-installer.exe` and bundled `dist/INSTALL.html`.
- [x] Update `README.md` and `INSTALL.html` with `.exe` install instructions.
- [x] Stage, commit, and push changes.

## Follow-up: Clarified OS-specific install docs
- [x] Update `README.md` with explicit Windows installer and macOS/Linux script sections.
- [x] Update `INSTALL.html` tabs/content to emphasize Windows `.exe` vs macOS/Linux `install.sh`.
- [x] Rebuild bundled `dist/INSTALL.html`, stage, commit, and push.

## Follow-up: Downloadable bundle in repo ZIP
- [x] Add a single bundled installer ZIP in `dist/` that contains all Windows install files.
- [x] Update build script to regenerate this bundle automatically.
- [x] Update docs so users can find the bundle after GitHub "Code → Download ZIP".
- [x] Verify bundle contents and push to `main`.

## Follow-up: Root installer + TXT readme
- [x] Place `target-checkout-helper-installer.exe` at repo root for GitHub ZIP users.
- [x] Convert install readme from `README.md` to `README.txt`.
- [x] Rebuild artifacts, stage, commit, and push.

## Follow-up: Installer payload error fix
- [x] Update Windows installer to accept payload in repo root or `dist/` and skip ZIP requirement when folder already exists.
- [x] Copy `target-checkout-helper.zip` to repo root during build for easy GitHub ZIP usage.
- [x] Clarify payload requirements in `README.txt` and `INSTALL.html`.
- [x] Rebuild artifacts, stage, commit, and push.

---

## Round: UI, drop-time polling, test notes & research plan (current)

### Last test round (what existed)
- No automated suite; prior verification was **manual in Chrome** (infinite retry, stock-watch, auth challenge slowdown) plus **`node --check`** on `popup.js`, `background.js`, `content.js`.
- Gaps: no regression harness for DOM/selectors; RedSky/API shape changes would only show up live on Target.

### Implemented this round
- [x] **Expected drop / restock time** (`datetime-local`): stored on `monitor.dropExpectedAt`. Background TCIN poll uses **250ms** sleep in the **10 min pre-drop** window and **3 min post-drop** grace; **2s** when drop is **>45 min** away. Content-script passive monitor polling uses the same windows to cap interval (min 1s near drop, min 3s base when far).
- [x] **Popup UI**: “Fastest checkout path” card, clearer monitor copy, **collapsible** Shipping / Payment, drop countdown line, slightly wider layout and card styling.
- [x] Manifest **1.2.0**.

### Follow-up engineering (technical, not calendar)
- Add optional **content-script self-test** (dev-only flag) that logs selector hits on a saved HTML fixture — low invasiveness, catches renames.
- Re-verify **Buy It Now / ATC / checkout** selectors after Target deploys; keep **prefetch** and **saved-payment** path as default fast lane.
- **Monitor**: consider per-URL drop times if multi-SKU drops become common.

### Target checkout & “anti-bot” — research summary (ethical scope)
- **Checkout shape**: product → ATC modal → cart or direct **checkout** → shipping → payment → **review** (extension intentionally keeps **Place Order** manual unless test flag).
- **Friction sources**: session/auth, **human verification** pages, rate limits, WAF/bot scores, inventory APIs returning null under load.
- **Legitimate resilience** (aligned with site rules): single logged-in profile, avoid pointless **reload spam** (already mitigated via stock-watch + API polling), **back off** when challenge copy appears (`humanChallengeDelayMs`), complete **CAPTCHA/challenges manually**, do not parallelize dozens of sessions.
- **Out of scope**: bypassing CAPTCHAs, spoofing clients, or evading security controls — those violate Target’s terms and applicable law; the product should **degrade gracefully** (slower retries, user takeover) instead.

### “Other models” (alternative approaches to compare)
- **Official Target app** + saved address/payment: often the supported fast path for consumers.
- **In-stock alerts** (email/SMS/third-party): notification-only; this extension focuses on **post-restock** navigation and form automation.
- **Headless / external runners**: higher ban risk and ToS issues; this repo stays **extension-only, user-present**.

---

## Checkout E2E iterations (auth gate)

### Desktop test (Mar 2025)
- **Reached** `https://www.target.com/checkout` from browse → product → ATC → cart flow with extension enabled.
- **Blocked** at Target **sign-in / account** UI — expected without stored session.
- **Console**: previously `checkout step: unknown` then probe timeout; **fixed** by detecting `signin` gate, optional **guest** click, and **indefinite watch** (no navigation retry) until shipping/payment DOM appears.

### Automated checks
- `node --check` on touched JS; `node scripts/checkout-speed-test.mjs` for drop polling math.

### To reach review in a real session
- Stay **logged in** on Target, or use **guest** when the site offers it; fill popup **shipping/payment** if not using saved payment.

### Fix: constant refresh on checkout (v1.2.3)
- **Cause**: `scheduleCheckoutRetry` + `performRetryNavigation` could redirect **checkout → cart** or reload while the sign-in / loading shell was showing.
- **Change**: No navigation retries when `pathname` is `/checkout`; `performRetryNavigation` is a no-op on checkout; checkout step watcher defaults to **infinite wait** (no timeout retry).

### Signed-in desktop E2E (after v1.2.3)
- **Pass**: Product (`/p/…`) → cart → `/checkout` → **review** with Place Order visible; no refresh loop.
- **Console**: `review reached`, `checkout_total_to_review` timing logged; toast “Reached review — Place Order remains manual.”
- **Note**: Saved pickup + saved card path; no manual Place Order click (by design).
