# Drop prep — ~4am Target drop

Boss agent: **@it**. Automated cycles while user is offline.

## Drop time

Set before starting (ISO UTC recommended):

```bash
export TCH_DROP_EXPECTED_AT="2026-06-26T08:00:00.000Z"   # 4:00 AM US Eastern (example)
```

## Start tonight (no PC babysitting)

```bash
./scripts/drop-prep-tonight.sh --detach
tmux attach -t drop-prep-tonight   # optional watch
```

Each **~20 min** cycle runs:

- `bash scripts/verify.sh`
- `xvfb-run npm run test:extension`
- `node scripts/browser-smoke/untested-areas-test.mjs`
- Optional `checkout-rehearsal` if `scripts/browser-smoke/.env.rehearsal` exists
- Agent batch if `CURSOR_API_KEY` set

## Live checkout rehearsal (optional)

On the machine that has your Target login, create **before you leave**:

```bash
cp scripts/browser-smoke/.env.rehearsal.example scripts/browser-smoke/.env.rehearsal
# fill TCH_TARGET_EMAIL + TCH_TARGET_PASSWORD
```

Cloud VM without this file: rehearsal stays `stuck: missing_credentials` (expected).

## Before drop checklist (for user at ~3:50 AM)

- One Target tab only; clear cart
- Extension ON; drop time set in popup monitor
- Do not toggle extension in the last minute
- **Auto place order OFF** unless you intend to charge

## Cycle log

<!-- append-only below -->

### Bug hunt 2026-06-25 (req 4–5)

**Req 4 — checkout sign-in + drop tension (`content.js`)**
- Fixed: drop-window toast never shown on monitored product pages — extracted `maybeShowDropWindowTip()` and call from `handleMonitoredATC` + `handleProductPage` (`content.js:1136-1146`, `2044`).
- Deferred (needs integration test): one-shot sign-in/guest on `signin`/`unknown` without watcher retry (`content.js:1399`).

**Update 2026-06-25:** Implemented throttled pending retry — `shouldRetryCheckoutPending` in `signinStep.js`, watcher re-runs `runCheckoutPendingActions` every 3s (max 15) while step stays `signin`/`unknown`.

**Req 5 — background monitor + harvest (`background.js`, `dropPollingTiming.js`)**
- Fixed: batch RedSky 401/403 no longer fans out per-TCIN fallbacks that inflated `redskyErrorStreak` (`background.js:557-560`).
- Fixed: keep aggressive poll sleep in drop tension even when `hadApiError` (`background.js:877-880`).
- Fixed: harvest keepalive timestamp only after successful fetch (`background.js:1453-1472`).
- Fixed: `redskyErrorStreak` reset on `stopMonitor()` (`background.js:1564`).
- Fixed: drop instant (`until === 0`) included in tension band (`dropPollingTiming.js`).

### Cycle 2026-06-25T23:00:14.556Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** (set TCH_DROP_EXPECTED_AT)
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:03:35.000Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** (set TCH_DROP_EXPECTED_AT)
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:04:33.549Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:07.992Z
- **cycle:** ALL GATES GREEN
