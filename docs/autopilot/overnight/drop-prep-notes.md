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

### Bug hunt 2026-06-26 (@it full orchestration)

**Subagents:** `debug` (sign-in race), `explore` (DOM map), `generalPurpose` (checkout auth selectors).

**Shipped:** `autoSignInInFlight`, checkout modal Continue/password-only/signed-in paths, rehearsal DOM probe + screenshots.

**Req 6:** stuck `target_checkout_auth_modal` — login PASS; checkout email+Continue modal; password step blocked on cloud (Target "Something went wrong").

**Before drop:** manual sign-in on your PC recommended.

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

### Cycle 2026-06-25T23:07:49.569Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:09:08.549Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:10:26.322Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:11:44.152Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:13:01.703Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:14:19.132Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:15:36.615Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:16:54.387Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:18:11.789Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** SKIP (no .env.rehearsal on host)
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:24:26.907Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
> checkout-rehearsal
> node checkout-rehearsal.mjs


CHECKOUT REHEARSAL FAIL
blockedReason: no_display
Failed to launch the browser process! undefined
[1755634:1755634:0625/232426.889137:ERROR:process_singleton_posix.cc(340)] Failed to create /home/ubuntu/.tch-rehearsal-chrome/SingletonLock: File exists (17)
[1755634:1755634:0625/232426.889433:ERROR:chrome_main_delegate.cc(559)] Failed to create a ProcessSingleton for your profile directory. This means that running multiple instances would start multiple browser processes rather than opening a new window in the existing process. Aborting now to avoid profile corruption.


TROUBLESHOOTING: https://pptr.dev/troubleshooting
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:27:49.991Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
: d***@outlook.com

Auto sign-in: opening Target login (extension fills credentials)...

Auto sign-in: detected signed-in account UI.

Navigating to product (extension drives toward review)...


CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:31:11.529Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
: d***@outlook.com

Auto sign-in: opening Target login (extension fills credentials)...

Auto sign-in: detected signed-in account UI.

Navigating to product (extension drives toward review)...


CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:34:32.775Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
: d***@outlook.com

Auto sign-in: opening Target login (extension fills credentials)...

Auto sign-in: detected signed-in account UI.

Navigating to product (extension drives toward review)...


CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:37:54.423Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
: d***@outlook.com

Auto sign-in: opening Target login (extension fills credentials)...

Auto sign-in: detected signed-in account UI.

Navigating to product (extension drives toward review)...


CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:41:16.152Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
: d***@outlook.com

Auto sign-in: opening Target login (extension fills credentials)...

Auto sign-in: detected signed-in account UI.

Navigating to product (extension drives toward review)...


CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] auto sign-in: timed out waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:44:40.586Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
ign-in: opening Target login (extension fills credentials)...

Auto sign-in: detected signed-in account UI.

Navigating to product (extension drives toward review)...


CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:48:02.714Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
etected signed-in account UI.

Navigating to product (extension drives toward review)...


CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 18596ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:51:24.066Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
etected signed-in account UI.

Navigating to product (extension drives toward review)...


CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 18893ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:54:51.448Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
rehearsal-chrome/rehearsal-failures/review_timeout-1782431691224.png

CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 25815ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-25T23:58:18.226Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
d: /home/ubuntu/.tch-rehearsal-chrome/rehearsal-failures/review_timeout-1782431898029.png

CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 18708ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-26T00:01:44.988Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
d: /home/ubuntu/.tch-rehearsal-chrome/rehearsal-failures/review_timeout-1782432104785.png

CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 18827ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-26T00:05:12.419Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
d: /home/ubuntu/.tch-rehearsal-chrome/rehearsal-failures/review_timeout-1782432312237.png

CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 18777ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-26T00:08:39.497Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
d: /home/ubuntu/.tch-rehearsal-chrome/rehearsal-failures/review_timeout-1782432519302.png

CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 18573ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-26T00:12:08.986Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
d: /home/ubuntu/.tch-rehearsal-chrome/rehearsal-failures/review_timeout-1782432728764.png

CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 18679ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-26T00:15:38.719Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
d: /home/ubuntu/.tch-rehearsal-chrome/rehearsal-failures/review_timeout-1782432938508.png

CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 18544ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN

### Cycle 2026-06-26T00:31:48.130Z

- **verify.sh:** PASS
- **test:extension:** PASS
- **untested-areas:** PASS
- **checkout-rehearsal:** FAIL (see log)
```
uing, you agree to Target's terms and privacy policy\n\nEmail or mobile phone\nContinue\nor\nSign in with passkey\nWhat's a passkey?\nKeep me signed in\nClose"
  ]
}
Screenshot saved: /home/ubuntu/.tch-rehearsal-chrome/rehearsal-failures/review_timeout-1782433907732.png

CHECKOUT REHEARSAL FAIL
blockedReason: review_timeout
Timed out waiting for [TCH] review reached (120000ms).
Last [TCH] lines:
[TCH] timing start init_total: /checkout
[TCH] init: checkout enabled: true monitor: false
[TCH] API key received from main world, caching for SW
[TCH] timing nav_product_to_checkout: 101ms
[TCH] timing checkout_flow_start: 0ms
[TCH] timing checkout_page_ready: 0ms
[TCH] checkout step: unknown
[TCH] checkout pending: unknown — waiting for shipping/payment (no reload)
[TCH] auto sign-in: step 1 — filling email via CDP
[TCH] auto sign-in: timed out waiting for password step
[TCH] timing init_total: 18547ms (done:checkout)
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
[TCH] auto sign-in: email already submitted — waiting for password step
[TCH] auto sign-in: timed out waiting for password step
[TCH] checkout pending: signin — waiting for shipping/payment (no reload)
```
- **dropExpectedAt env:** 2026-06-26T08:00:23.891Z
- **cycle:** ALL GATES GREEN
