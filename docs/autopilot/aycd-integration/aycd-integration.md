# AYCD integration — PRD (scope)

## Problem

Target overnight drops (3–5 AM EST) and Walmart WM+ flows need **account trust**, **OTP/2FA**, **captcha handling**, and **multi-session** discipline. Community setups (Refract + AYCD) pair a checkout bot with AYCD for infrastructure we do not ship in the extension alone.

[AYCD](https://aycd.io/) is a **companion platform** — not a replacement for our RedSky monitor / checkout automation.

## Goals

1. Document how BEATBOTS extension + AYCD stack together for Target drops
2. Identify **wireable** integrations (API, webhooks, TabSentry extension load)
3. Produce Tier A implementation tasks only where ROI is clear
4. Avoid rebuilding Inbox / TabSentry / Profile Builder inside our repo

## Non-goals

- Official "supported bot" status from AYCD AutoSolve (requires their bot list / partnership)
- Replacing TabSentry with extension-only multi-account
- Traffic Pass / SEO / OneClick farming in extension code
- Subscriptions or purchases on behalf of user

## Success criteria

- `AYCD-RESEARCH-BRAINSTORM.md` crosswalks every AYCD product vs our code
- TabSentry + extension deployment runbook exists
- Autopilot task JSON with phased reqs; Tier A items scoped with acceptance tests
- Decision on Inbox API vs existing Gmail/IMAP paths

## Recommended pass (from pricing)

| Use case | Pass | ~$/mo |
|----------|------|-------|
| Target only, 1 account, captcha at login | Resell + AutoSolve AI add-on | ~$30+ |
| Target + multi-tab / future Walmart queue | **Queue Pass** or **Ultimate** | $35–65 |
| Serious multi-account (Discord "cooking" setup) | **Ultimate Pass** | $65 |

Ultimate includes: Inbox, OneClick, TabSentry, Profile Builder, AutoSolve, AutoSolve AI.

## References

- [AYCD site](https://aycd.io/)
- [TabSentry — load unpacked extensions](https://aycd.zendesk.com/hc/en-us/articles/18257661017879)
- [AutoSolve AI extension](https://aycd.io/blog/how-to-automatically-solve-captchas-google-chrome)
- Our brainstorm: `AYCD-RESEARCH-BRAINSTORM.md`
