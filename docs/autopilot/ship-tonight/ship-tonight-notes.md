# Ship tonight — session notes

## Shipped (this branch)

- **Checkout reliability** — cart API probe, high-volume handling, bounce recovery, monitor cart confirm
- **DIY Phase 1** — BEATBOTS WS Shape pool in popup + `BB_APPLY_ATC_COOKIE`
- **DIY Phase 2** — `otp_watch_request` → app IMAP; Gmail fallback
- **Tests** — `scripts/checkout-reliability-test.mjs` in verify.sh
- **Docs** — `SHIP-TONIGHT.md`, `CHROME-PROFILES-RUNBOOK.md`

## Deferred (post-ship)

- Profile sync app → extension IPC (use popup Export/Import settings today)
- API checkout path in beatbots-app for DOM-degraded drops

## Verification

```bash
bash scripts/verify.sh
cd scripts/browser-smoke && xvfb-run -a npm run test:extension
```

## PR

[#23](https://github.com/fabcrowd/BEATBOTS/pull/23) — ship bundle (checkout + DIY + OTP)
