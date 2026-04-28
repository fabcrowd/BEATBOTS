// Shared drop-window polling math. Loaded by:
// - background.js via importScripts (service worker)
// - content.js via manifest script order (before content.js)
// Keep Date usage to Date.now() only so Node vm tests can mock time.

function computeBackgroundPollSleepMs(monitor) {
  const base = 500;
  const raw = monitor?.dropExpectedAt;
  if (!raw || typeof raw !== 'string') return base;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return base;
  const now = Date.now();
  const until = t - now;
  const afterDrop = now - t;
  const inPrewindow = until > 0 && until <= 10 * 60 * 1000;
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
  if (inPrewindow || inGrace) return 250;
  if (until > 45 * 60 * 1000) return 2000;
  return base;
}

/** Same 10m pre-drop / 3m post-drop band as aggressive polling — for UX hints only. */
function isInDropTensionWindow(monitor) {
  const raw = monitor?.dropExpectedAt;
  if (!raw || typeof raw !== 'string') return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  const until = t - now;
  const afterDrop = now - t;
  const inPrewindow = until > 0 && until <= 10 * 60 * 1000;
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
  return inPrewindow || inGrace;
}

function getDropAwarePollSeconds(monitor, baseSec) {
  const b = Math.max(0.25, Number(baseSec) || 1);
  const raw = monitor?.dropExpectedAt;
  if (!raw || typeof raw !== 'string') return b;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return b;
  const now = Date.now();
  const until = t - now;
  const afterDrop = now - t;
  const inPrewindow = until > 0 && until <= 10 * 60 * 1000;
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000;
  if (inPrewindow || inGrace) return Math.min(b, 1);
  if (until > 30 * 60 * 1000) return Math.max(b, 3);
  return b;
}
