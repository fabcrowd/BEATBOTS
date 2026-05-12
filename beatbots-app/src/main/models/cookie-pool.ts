import { CookieKind, HarvestedCookie, CookiePoolStatus } from '../../shared/types'
import crypto from 'crypto'

// ─── In-memory cookie pool with dual login/atc buckets ───────────────────────

const pools: Record<CookieKind, HarvestedCookie[]> = {
  login: [],
  atc: [],
}

let harvestTimestamps: number[] = []

const DEFAULT_TTL_MS = 5 * 60 * 1000  // 5 min default
const MAX_POOL_SIZE = 50

let ttlMs = DEFAULT_TTL_MS
let removalOrder: 'lifo' | 'fifo' = 'lifo'

// ─── Config ───────────────────────────────────────────────────────────────────

export function setCookiePoolConfig(opts: {
  ttlMinutes?: number
  removalOrder?: 'lifo' | 'fifo'
  maxPoolSize?: number
}): void {
  if (opts.ttlMinutes) ttlMs = Math.max(1, opts.ttlMinutes) * 60 * 1000
  if (opts.removalOrder) removalOrder = opts.removalOrder
}

// ─── Add ──────────────────────────────────────────────────────────────────────

export function addCookie(
  kind: CookieKind,
  cookies: Record<string, string>,
  shapeHeaders: Record<string, string> = {},
  opts: { harvesterId?: string; proxyUsed?: string } = {}
): void {
  const now = Date.now()
  const cookie: HarvestedCookie = {
    id: crypto.randomUUID(),
    kind,
    cookies,
    shapeHeaders,
    ts: now,
    expiresAt: now + ttlMs,
    harvesterId: opts.harvesterId ?? null,
    proxyUsed: opts.proxyUsed ?? null,
  }

  pools[kind].push(cookie)
  harvestTimestamps.push(now)

  // Trim timestamps older than 1 min for rate calc
  const oneMinAgo = now - 60_000
  harvestTimestamps = harvestTimestamps.filter(t => t > oneMinAgo)

  // Enforce pool size cap
  while (pools[kind].length > MAX_POOL_SIZE) {
    if (removalOrder === 'fifo') {
      pools[kind].pop()   // drop newest
    } else {
      pools[kind].shift() // drop oldest
    }
  }
}

// ─── Consume ──────────────────────────────────────────────────────────────────

export function consumeCookie(kind: CookieKind, preferProxyMatch?: string): HarvestedCookie | null {
  pruneExpired()
  const pool = pools[kind]
  if (pool.length === 0) return null

  // Prefer cookies from same proxy if specified
  if (preferProxyMatch) {
    const idx = pool.findIndex(c => c.proxyUsed === preferProxyMatch)
    if (idx !== -1) {
      const [cookie] = pool.splice(idx, 1)
      return cookie
    }
  }

  // LIFO: take newest (end of array)
  // FIFO: take oldest (start of array)
  if (removalOrder === 'lifo') {
    return pool.pop() ?? null
  } else {
    return pool.shift() ?? null
  }
}

// ─── Prune ────────────────────────────────────────────────────────────────────

function pruneExpired(): void {
  const now = Date.now()
  for (const kind of ['login', 'atc'] as CookieKind[]) {
    pools[kind] = pools[kind].filter(c => c.expiresAt > now)
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function getPoolStatus(): CookiePoolStatus {
  pruneExpired()
  const now = Date.now()
  const oneMinAgo = now - 60_000
  const recentHarvests = harvestTimestamps.filter(t => t > oneMinAgo).length

  return {
    loginCount: pools.login.length,
    atcCount: pools.atc.length,
    totalCount: pools.login.length + pools.atc.length,
    lastHarvestAt: harvestTimestamps.length > 0
      ? harvestTimestamps[harvestTimestamps.length - 1]
      : null,
    generationRate: recentHarvests,
  }
}

// ─── Clear ────────────────────────────────────────────────────────────────────

export function clearPool(kind?: CookieKind): void {
  if (kind) {
    pools[kind] = []
  } else {
    pools.login = []
    pools.atc = []
  }
  harvestTimestamps = []
}

// ─── Peek (for UI display) ────────────────────────────────────────────────────

export function peekPool(kind: CookieKind): number {
  pruneExpired()
  return pools[kind].length
}
