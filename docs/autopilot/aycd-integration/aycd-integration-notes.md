# AYCD integration — progress notes

## Current State

- **Complete:** req 1 (baseline), req 2 (brainstorm + PRD)
- **Next:** req 3 — TabSentry runbook
- **Blockers:** none for Tier 0 (operational); Inbox API needs user API key for req 4 spike

## Research traceability

- [aycd.io](https://aycd.io/) product pages (Inbox, TabSentry, Profile Builder)
- Zendesk: TabSentry unpacked extensions, AutoSolve AI extension, Inbox Mail Tasks API
- Discord pass screenshots (Resell / Queue / Ultimate / Captcha / Traffic)
- WM+ Refract setup notes (saved session, qty 99, 30 min early)
- Codebase: Gmail OTP, IMAP native host, Discord webhook, beatbots WS :9235

## Tier 0 recommendation (tonight)

If user has **Ultimate Pass** ($65/mo):

1. Profile Builder → Target profile + jig
2. TabSentry → load `target-checkout-helper` + AutoSolve AI extension (Chrome task)
3. Sign in to Target in task → copy with browser data if cloning
4. Extension monitor: 2–3 zephyr SKUs, 3 AM drop, saved payment ON

No extension code changes required.

## Session Log

- 2026-06-27 — @it scoped AYCD integration; brainstorm + autopilot task JSON created
- 2026-06-27 — **Pivot:** user will not pay for AYCD → see `docs/autopilot/target-toolstack/TARGET-DIY-TOOLSTACK.md` for free build concept (`beatbots-app` + extension)
