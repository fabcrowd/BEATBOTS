# Checkout improvements — progress notes

## Current State

- **Complete:** reqs 1–7 (Tier A loop)
- **Branch:** `cursor/checkout-improvements-loop-4bbd`
- **Research:** `CHECKOUT-RESEARCH-BRAINSTORM.md`

## Research traceability

- Subagents: implementation map, repo research inventory, sign-in race debug
- Web: Refract, Stellar, Divine, AMNotify, Shape/F5 2026
- Reddit: no substantive threads (API blocked; `findings_public_landscape.md` empty)
- Live evidence: rehearsal DOM probe — checkout modal email+Continue, Target error banner; `/login` auto sign-in PASS

## Implemented (Tier A)

| Req | Feature | Files |
|-----|---------|-------|
| 2 | Auth error banner backoff | `content.js` `hasCheckoutAuthError()` |
| 3 | Pre-auth warmup — `/login` → `/account`, `tch:authWarmupAt` | `content.js`, `signinStep.js` |
| 4 | Signed-in continue before email; no guest with `useSavedPayment` | `content.js`, `signinStep.js` |
| 5 | Fresh-tab checkout (`checkoutInNewTab` monitor flag) | `background.js`, `popup.*` |
| 6 | Pre-drop checklist in popup | `popup.html` |
| 7 | `verify.sh` + extension smoke | gates green |

## Pre-auth warmup path

1. User visits `target.com/login` with auto sign-in ON
2. After credentials submit + signed-in DOM, extension sets `sessionStorage.tch:authWarmupAt`
3. One-time nav to `/account` warms session cookies
4. At checkout, `shouldSkipCheckoutEmailFlow` + `tryCheckoutSignedInContinue` run before email automation

## Remaining gaps (Tier B — beatbots-app)

- Active Shape cookie generation
- API checkout path
- Login vs ATC pool separation

## Session Log

- 2026-06-26 — @it deep-dive + brainstorm; `/loop` task JSON created
- 2026-06-26 — Req 2: `hasCheckoutAuthError()` pauses auto sign-in when Target shows error banner
- 2026-06-26 — Reqs 3–7: warmup, modal continue, fresh-tab checkout, checklist, verify
