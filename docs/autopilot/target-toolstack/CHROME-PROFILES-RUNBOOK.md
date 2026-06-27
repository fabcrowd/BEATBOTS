# Chrome multi-profile runbook (free TabSentry)

Use **separate Chrome profiles** instead of paid multi-browser session tools. Each profile has its own cookies, extensions, and login — no bleed between accounts.

## Setup (one-time per account)

1. Open Chrome → avatar (top-right) → **Add** → name it `Target-Account-A` (or similar).
2. In that profile: load the extension (**Load unpacked** → `target-checkout-helper/`).
3. Sign in to Target in that profile only.
4. Repeat for `Target-Account-B` on a second profile.

## Drop-night rules

| Rule | Why |
|------|-----|
| **One Target tab per profile** | Multiple tabs compete for the same cart session |
| **Never copy cookies between profiles** | Shape/PX scores are per-profile; mixing breaks trust |
| **Run beatbots-app once per machine** | WS bridge is shared; use one Shape harvester feeding the active profile’s extension |
| **Clear cart in each profile before drop** | Stale cart lines cause 409 / empty checkout |
| **Do not sync Chrome with Google account for bot profiles** | Sync can restore cookies you tried to isolate |

## Two-account example (no cookie bleed)

```
Profile "Target-A"                    Profile "Target-B"
├── Extension ON                      ├── Extension ON
├── target.com signed in as A         ├── target.com signed in as B
├── Monitor: SKU 94300072 qty 1       ├── Monitor: SKU 95267143 qty 1
└── beatbots-app Shape → extension    └── (optional second machine or staggered drop)
```

**Wrong:** Same profile, two Target logins in different windows — last login wins.

**Right:** Two profiles, two extension popups, two independent sessions.

## Optional: portable Chrome on USB

For “wipe each session” hygiene:

1. Install [Chrome Portable](https://portableapps.com/apps/internet/google_chrome_portable) or a dedicated Chromium build on a fast USB drive.
2. One portable install = one profile directory.
3. Eject drive after session — cookies gone at OS level.

The extension’s **session storage** harvest pool still clears when you quit Chrome; portable install adds OS-level separation.

## beatbots-app + multi-profile

- WS bridge listens on `127.0.0.1:9235` — only the **active** Chrome profile’s extension connects.
- Switch profiles → extension in new profile reconnects automatically.
- Shape cookies consumed via `BB_APPLY_ATC_COOKIE` apply to **that profile’s** cookie jar only.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Account B shows A’s cart | You’re in the wrong profile — check avatar name |
| Extension settings differ per profile | Expected — **Save settings** in each profile’s popup |
| OTP goes to wrong inbox | Configure IMAP in beatbots-app for the email tied to that profile’s Target login |
