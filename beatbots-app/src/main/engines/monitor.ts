import { MonitorProduct, ProductGroup } from '../../shared/types'
import {
  computeBackgroundPollSleepMs,
  getDropAwarePollSeconds,
  isInDropTensionWindow,
  DropMonitor,
  adjustedNow,
} from '../utils/drop-timing'
import { notifyStockDetected } from '../utils/discord'
import { EventEmitter } from 'events'

// ─── Monitor Engine ───────────────────────────────────────────────────────────
// Polls Target's RedSky fulfillment API for inventory changes.
// Emits 'stock' events to trigger checkout tasks.

export interface MonitorConfig {
  products: Array<MonitorProduct & { groupName?: string }>
  dropExpectedAt: string | null
  refreshIntervalMs: number
  highStockOnly: boolean
  highStockThreshold: number
  maxPrice: number | null
  proxyList?: string[]
  cooldownMs: number  // honeypot protection: min time between pings per TCIN
}

interface TcinState {
  tcin: string
  inStock: boolean
  lastPingAt: number
  count: number
  target: number
}

export class MonitorEngine extends EventEmitter {
  private config: MonitorConfig | null = null
  private running = false
  private loopHandle: NodeJS.Timeout | null = null
  private tcinStates = new Map<string, TcinState>()
  private cachedApiKey = ''
  private cachedRedskyBase = 'https://redsky.target.com'
  private dropMonitor: DropMonitor = {}
  private proxyIndex = 0
  private watchdogHandle: NodeJS.Timeout | null = null

  constructor() {
    super()
  }

  start(config: MonitorConfig): void {
    this.config = config
    this.dropMonitor = { dropExpectedAt: config.dropExpectedAt }
    this.running = true

    // Initialize per-TCIN state
    for (const p of config.products) {
      if (!this.tcinStates.has(p.tcin)) {
        this.tcinStates.set(p.tcin, {
          tcin: p.tcin,
          inStock: false,
          lastPingAt: 0,
          count: 0,
          target: p.qty,
        })
      }
    }

    this.scheduleNextPoll()
    this.startWatchdog()
    console.log('[Monitor] started, TCINs:', config.products.map(p => p.tcin))
    this.emit('status', { active: true, message: `Monitoring ${config.products.length} SKUs` })
  }

  stop(): void {
    this.running = false
    if (this.loopHandle) clearTimeout(this.loopHandle)
    if (this.watchdogHandle) clearInterval(this.watchdogHandle)
    this.loopHandle = null
    this.watchdogHandle = null
    console.log('[Monitor] stopped')
    this.emit('status', { active: false, message: 'Monitor stopped' })
  }

  updateDropTime(dropExpectedAt: string | null): void {
    this.dropMonitor = { dropExpectedAt }
    if (this.config) this.config.dropExpectedAt = dropExpectedAt
  }

  isRunning(): boolean {
    return this.running
  }

  setApiKey(key: string, base?: string): void {
    this.cachedApiKey = key
    if (base) this.cachedRedskyBase = base
  }

  private scheduleNextPoll(): void {
    if (!this.running) return
    const sleepMs = computeBackgroundPollSleepMs(this.dropMonitor)
    this.loopHandle = setTimeout(() => this.runPollCycle(), sleepMs)
  }

  private async runPollCycle(): Promise<void> {
    if (!this.running || !this.config) return

    try {
      await this.pollAllProducts()
    } catch (e) {
      console.error('[Monitor] poll cycle error:', e)
    }

    this.scheduleNextPoll()
  }

  private async pollAllProducts(): Promise<void> {
    if (!this.config) return

    for (const product of this.config.products) {
      if (!this.running) break

      const state = this.tcinStates.get(product.tcin)
      if (!state) continue

      // Skip if count already reached target
      if (state.count >= state.target) continue

      try {
        const result = await this.checkStock(product.tcin)

        if (result.inStock) {
          if (!this.passesFilters(result)) continue

          // Honeypot cooldown check
          const now = adjustedNow()
          if (now - state.lastPingAt < this.config.cooldownMs) {
            console.log('[Monitor] cooldown active for', product.tcin)
            continue
          }

          state.inStock = true
          state.lastPingAt = now

          console.log('[Monitor] stock detected:', product.tcin, result)
          this.emit('stock', { tcin: product.tcin, product, state })
          notifyStockDetected(product.tcin, product.name).catch(() => {})
        } else {
          state.inStock = false
        }
      } catch (e: any) {
        if (e?.code === 401 || e?.code === 403) {
          this.emit('sessionStale', {})
        }
      }

      // Stagger requests slightly to avoid flooding
      await sleep(150)
    }
  }

  private passesFilters(result: StockResult): boolean {
    if (!this.config) return true

    // High stock filter
    if (this.config.highStockOnly) {
      const qty = result.availableQty ?? 0
      if (qty < this.config.highStockThreshold) return false
    }

    // Max price filter
    if (this.config.maxPrice != null && result.price != null) {
      if (result.price > this.config.maxPrice) return false
    }

    return true
  }

  private async checkStock(tcin: string): Promise<StockResult> {
    const url = this.buildFulfillmentUrl(tcin)
    if (!url) return { inStock: false }

    const proxy = this.getNextProxy()
    const headers: Record<string, string> = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'accept': 'application/json',
    }
    if (this.cachedApiKey) headers['x-api-key'] = this.cachedApiKey

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (res.status === 401 || res.status === 403) {
        const err = new Error('Auth error') as any
        err.code = res.status
        throw err
      }

      if (!res.ok) return { inStock: false }

      const data = await res.json() as any
      return this.parseStockStatus(data)
    } catch (e: any) {
      clearTimeout(timeout)
      if (e?.code === 401 || e?.code === 403) throw e
      return { inStock: false }
    }
  }

  private buildFulfillmentUrl(tcin: string): string | null {
    if (!this.cachedApiKey) return null
    return `${this.cachedRedskyBase}/redsky_aggregations/v1/web/pdp_fulfillment_v1?key=${this.cachedApiKey}&tcin=${tcin}&store_id=&pricing_store_id=&has_required_response_fields=true&visitor_id=&channel=WEB&page=%2Fp%2F${tcin}`
  }

  private parseStockStatus(data: any): StockResult {
    try {
      const fulfillment = data?.data?.product?.fulfillment
      if (!fulfillment) return { inStock: false }

      const shippingOpts = fulfillment.shipping_options
      const storeOpts = fulfillment.store_options?.[0]

      const SELLABLE = /^(IN_STOCK|LIMITED_STOCK|AVAILABLE|PRE_ORDER_SELLABLE)$/i
      const BLOCKED = /^(OUT_OF_STOCK|UNAVAILABLE|NOT_AVAILABLE|SOLD_OUT)$/i

      const shippingStatus = shippingOpts?.availability_status ?? ''
      const inStock = SELLABLE.test(shippingStatus) && !BLOCKED.test(shippingStatus)

      const qty = shippingOpts?.available_to_promise_quantity ?? null
      const price = data?.data?.product?.price?.current_retail ?? null

      return { inStock, availableQty: qty, price }
    } catch {
      return { inStock: false }
    }
  }

  private getNextProxy(): string | null {
    const proxies = this.config?.proxyList ?? []
    if (!proxies.length) return null
    const proxy = proxies[this.proxyIndex % proxies.length]
    this.proxyIndex++
    return proxy
  }

  private startWatchdog(): void {
    this.watchdogHandle = setInterval(() => {
      if (this.running && !this.loopHandle) {
        console.warn('[Monitor] watchdog: restarting stalled poll')
        this.scheduleNextPoll()
      }
    }, 30_000)
  }

  // Allow checkout tasks to signal completion for a TCIN
  recordSuccess(tcin: string): void {
    const state = this.tcinStates.get(tcin)
    if (state) {
      state.count++
      console.log(`[Monitor] success recorded for ${tcin}: ${state.count}/${state.target}`)
    }
  }
}

interface StockResult {
  inStock: boolean
  availableQty?: number | null
  price?: number | null
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Singleton instance
export const monitorEngine = new MonitorEngine()
