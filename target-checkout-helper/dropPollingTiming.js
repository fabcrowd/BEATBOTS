// Shared drop-window polling math. Loaded by:
// - background.js via importScripts (service worker)
// - content.js via manifest script order (before content.js)
// Keep Date usage to Date.now() only so Node vm tests can mock time.
// Optional `nowMs` (e.g. background service worker NTP-corrected time) must match
// dropArmed / skip-monitoring so aggressive polling does not start before go-time.

function resolveDropNowMs(nowMs) {
  return typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
}

function computeBackgroundPollSleepMs(monitor, nowMs) {
  const base = 500;
  const raw = monitor?.dropExpectedAt;
  if (!raw || typeof raw !== 'string') return base;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return base;
  const now = resolveDropNowMs(nowMs);
  const until = t - now;
  const afterDrop = now - t;
  const inPrewindow = until >= 0 && until <= 10 * 60 * 1000;
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
  if (inPrewindow || inGrace) return 250;
  if (until > 45 * 60 * 1000) return 2000;
  return base;
}

/** Same 10m pre-drop / 3m post-drop band as aggressive polling — for UX hints only. */
function isInDropTensionWindow(monitor, nowMs) {
  const raw = monitor?.dropExpectedAt;
  if (!raw || typeof raw !== 'string') return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  const now = resolveDropNowMs(nowMs);
  const until = t - now;
  const afterDrop = now - t;
  const inPrewindow = until >= 0 && until <= 10 * 60 * 1000;
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
  return inPrewindow || inGrace;
}

function getDropAwarePollSeconds(monitor, baseSec, nowMs) {
  const b = Math.max(0.25, Number(baseSec) || 1);
  const raw = monitor?.dropExpectedAt;
  if (!raw || typeof raw !== 'string') return b;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return b;
  const now = resolveDropNowMs(nowMs);
  const until = t - now;
  const afterDrop = now - t;
  const inPrewindow = until >= 0 && until <= 10 * 60 * 1000;
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
  if (inPrewindow || inGrace) return Math.min(b, 1);
  if (until > 30 * 60 * 1000) return Math.max(b, 3);
  return b;
}

/**
 * Min ms between background session keep-alive (www.target.com fetch + cookie snapshot)
 * while monitoring. Cadence tightens monotonically as `monitor.dropExpectedAt`
 * approaches: cooldown > far > approach > tension. The 45-min approach band
 * previously returned 8 min (slower than the 5 min "far from drop" branch),
 * which inverted the curve — fixed to 3 min so cadence is strictly
 * non-increasing as `until -> 0`.
 */
function getHarvestKeepaliveMinIntervalMs(monitor, nowMs) {
  const raw = monitor?.dropExpectedAt;
  if (!raw || typeof raw !== 'string') return 5 * 60 * 1000;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return 5 * 60 * 1000;
  const now = resolveDropNowMs(nowMs);
  const until = t - now;
  const afterDrop = now - t;
  const inPrewindow = until >= 0 && until <= 10 * 60 * 1000;
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
  if (inPrewindow || inGrace) return 2 * 60 * 1000;
  if (until > 0 && until <= 45 * 60 * 1000) return 3 * 60 * 1000;
  if (until > 45 * 60 * 1000) return 5 * 60 * 1000;
  if (afterDrop > 3 * 60 * 1000) return 15 * 60 * 1000;
  return 5 * 60 * 1000;
}

/**
 * Min ms between auto harvest bursts on the same URL when "Don't stop harvesting" is on.
 *
 * Cadence is anchored on the rule "maintain ~3-5 fresh non-expired snapshots in
 * the rolling pool" (research_cookie_harvesting/report.md). With the default
 * `expirationMinutes = 8`, that puts the no-drop steady state at TTL / 4 = 120s.
 *
 * Steady-state spec when monitor is OFF and no drop time is set:
 *   - Page-load capture: once per new URL (any Target page when "Don't stop
 *     harvesting" is on; /p/ and login otherwise).
 *   - Recurring tick on the same URL: every 120s (this branch) while
 *     harvesting is enabled. Anchored on `expirationMinutes = 8` to keep ~4
 *     fresh snapshots in the rolling pool.
 *   - Background keepalive: NOT scheduled (intentionally). Keepalive runs only
 *     when monitoring is active to avoid an authenticated background fetch in
 *     idle mode.
 *
 * Cadence tightens monotonically as `monitor.dropExpectedAt` approaches.
 */
function getHarvestBurstSameUrlDedupMs(monitor, nowMs) {
  const raw = monitor?.dropExpectedAt;
  if (!raw || typeof raw !== 'string') return 120 * 1000;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return 120 * 1000;
  const now = resolveDropNowMs(nowMs);
  const until = t - now;
  const afterDrop = now - t;
  const inPrewindow = until >= 0 && until <= 10 * 60 * 1000;
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
  if (inPrewindow || inGrace) return 20 * 1000;
  if (until > 0 && until <= 45 * 60 * 1000) return 45 * 1000;
  return 120 * 1000;
}
