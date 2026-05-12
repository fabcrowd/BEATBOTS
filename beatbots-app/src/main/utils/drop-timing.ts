// Port of dropPollingTiming.js from the Chrome extension
// All timing logic keyed off monitor.dropExpectedAt as an ISO date string

export interface DropMonitor {
  dropExpectedAt?: string | null
}

const MIN_BASE_SEC = 0.25

/** Background poll sleep interval in ms (shorter = more responsive to stock) */
export function computeBackgroundPollSleepMs(monitor: DropMonitor): number {
  const base = 500
  const t = parseDrop(monitor)
  if (t === null) return base

  const now = Date.now()
  const until = t - now
  const afterDrop = now - t
  const inPrewindow = until > 0 && until <= 10 * 60 * 1000
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000

  if (inPrewindow || inGrace) return 250
  if (until > 45 * 60 * 1000) return 2000
  return base
}

/** Drop-aware poll interval in seconds for per-product checks */
export function getDropAwarePollSeconds(monitor: DropMonitor, baseSec: number): number {
  const b = Math.max(MIN_BASE_SEC, Number(baseSec) || 1)
  const t = parseDrop(monitor)
  if (t === null) return b

  const now = Date.now()
  const until = t - now
  const afterDrop = now - t
  const inPrewindow = until > 0 && until <= 10 * 60 * 1000
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000

  if (inPrewindow || inGrace) return Math.min(b, 1)
  if (until > 30 * 60 * 1000) return Math.max(b, 3)
  return b
}

/** Whether we're currently inside the drop tension window (10 min pre / 3 min post) */
export function isInDropTensionWindow(monitor: DropMonitor): boolean {
  const t = parseDrop(monitor)
  if (t === null) return false
  const now = Date.now()
  const until = t - now
  const afterDrop = now - t
  return (until > 0 && until <= 10 * 60 * 1000) || (until < 0 && afterDrop <= 3 * 60 * 1000)
}

/** Harvest keepalive minimum interval in ms */
export function getHarvestKeepaliveMinIntervalMs(monitor: DropMonitor): number {
  const t = parseDrop(monitor)
  if (t === null) return 5 * 60 * 1000

  const now = Date.now()
  const until = t - now
  const afterDrop = now - t
  const inPrewindow = until > 0 && until <= 10 * 60 * 1000
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000

  if (inPrewindow || inGrace) return 2 * 60 * 1000
  if (until > 0 && until <= 45 * 60 * 1000) return 3 * 60 * 1000
  if (until > 45 * 60 * 1000) return 5 * 60 * 1000
  if (afterDrop > 3 * 60 * 1000) return 15 * 60 * 1000
  return 5 * 60 * 1000
}

/** Same-URL harvest burst dedup window in ms */
export function getHarvestBurstSameUrlDedupMs(monitor: DropMonitor): number {
  const t = parseDrop(monitor)
  if (t === null) return 120_000

  const now = Date.now()
  const until = t - now
  const afterDrop = now - t
  const inPrewindow = until > 0 && until <= 10 * 60 * 1000
  const inGrace = until < 0 && afterDrop <= 3 * 60 * 1000

  if (inPrewindow || inGrace) return 20_000
  if (until > 0 && until <= 45 * 60 * 1000) return 45_000
  return 120_000
}

/** Format a countdown string for UI display */
export function formatDropCountdown(monitor: DropMonitor): string {
  const t = parseDrop(monitor)
  if (t === null) return ''
  const now = Date.now()
  const until = t - now
  if (until <= 0 && t - now > -3 * 60 * 1000) return 'In drop window — fast polling'
  if (until <= 0) return 'Drop passed'
  const h = Math.floor(until / 3_600_000)
  const m = Math.floor((until % 3_600_000) / 60_000)
  const s = Math.floor((until % 60_000) / 1000)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ─── NTP sync ─────────────────────────────────────────────────────────────────

let ntpOffsetMs = 0
let lastNtpSyncMs = 0

export function getNtpOffset(): number {
  return ntpOffsetMs
}

export async function syncNtpClock(server = 'https://lm-clock.vercel.app/api/time'): Promise<void> {
  try {
    const localBefore = Date.now()
    const res = await fetch(server)
    const localAfter = Date.now()
    const rtt = localAfter - localBefore
    const data = await res.json() as { unixMs: number }
    const serverTime = data.unixMs + rtt / 2
    ntpOffsetMs = serverTime - localAfter
    lastNtpSyncMs = localAfter
    console.log('[NTP] offset:', ntpOffsetMs, 'ms')
  } catch (e) {
    // Try Date header fallback
    try {
      const localBefore = Date.now()
      const res = await fetch('https://www.target.com/robots.txt')
      const localAfter = Date.now()
      const rtt = localAfter - localBefore
      const dateHeader = res.headers.get('date')
      if (dateHeader) {
        const serverTime = new Date(dateHeader).getTime() + rtt / 2
        ntpOffsetMs = serverTime - localAfter
        lastNtpSyncMs = localAfter
        console.log('[NTP] fallback offset:', ntpOffsetMs, 'ms')
      }
    } catch { /* ignore */ }
  }
}

export function adjustedNow(): number {
  return Date.now() + ntpOffsetMs
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDrop(monitor: DropMonitor): number | null {
  if (!monitor.dropExpectedAt) return null
  const t = Date.parse(monitor.dropExpectedAt)
  return isFinite(t) ? t : null
}
