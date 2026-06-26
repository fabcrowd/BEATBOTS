# DIY toolstack — notes

## Current State

- **Concept complete:** `TARGET-DIY-TOOLSTACK.md`
- **Phase 1 complete:** WS pool depth in popup + app Shape cookie inject before monitor ATC
- **Phase 2 complete:** OTP via app IMAP when WS connected
- **Next build:** Phase 3 profile sync (or use popup export/import)

## Phase 2 — OTP via app IMAP (shipped)

Extension `START_OTP_WATCH` → background tries `otp_watch_request` on BEATBOTS WS when connected → app polls first IMAP profile in `imap_profiles` → `otp_found` with 6-digit code → tab fills OTP. Falls back to Gmail OAuth when app offline.

Setup: beatbots-app → IMAP Profiles → add Gmail app-password profile → keep app running during drop.

## Phase 1 — manual test

1. Start `beatbots-app` and run a **Shape harvester** (ATC mode) until the app pool shows cookies.
2. Load the extension; open popup → **Cookie harvest** section.
3. Confirm **BEATBOTS app: connected — ATC N, login M** updates when harvester adds cookies.
4. Add a product with **Hype mode** ON; start monitor on a stocked SKU.
5. With app pool > 0, monitor ATC should log `[TCH] applied BEATBOTS Shape cookie before ATC` in the tab console.
6. With app offline, hype mode still accepts extension **Snapshots ready** pool.

## WS protocol (extension ↔ app)

| Direction | Type | Purpose |
|-----------|------|---------|
| App → Ext | `hello` | Handshake + `port` |
| App → Ext | `pool_status` | Unsolicited on pool change or reply to request |
| Ext → App | `pool_status_request` | Pull current counts |
| Ext → App | `consume_atc_request` | LIFO/FIFO consume one ATC cookie map |
| App → Ext | `consume_atc` | `{ ok, cookies, shapeHeaders }` |
| Ext → App | `cookie_harvest` | Forward extension passive harvest (unchanged) |

## Key insight

~70% of AYCD Ultimate is already sketched in `beatbots-app/` (ShapeHarvester, session-manager, checkout-engine, Profiles, ImapProfiles, Proxies). The work is **integration**, not a new product.

## Session Log

- 2026-06-27 — @it conceptualized free Target toolstack; pivoted from AYCD wire to DIY build phases
- 2026-06-27 — Phase 1: `ws-bridge.ts` pool_status/consume_atc; extension popup pool line; `BB_APPLY_ATC_COOKIE` before monitor ATC
