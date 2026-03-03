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
