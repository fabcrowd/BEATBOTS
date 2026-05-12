import puppeteer, { Browser, Page } from 'puppeteer-core'
import { addCookie } from '../models/cookie-pool'
import { CookieKind, HarvesterConfig, HarvesterStatus } from '../../shared/types'
import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'

// ─── In-bot Shape Cookie Harvester ───────────────────────────────────────────
// Launches a Puppeteer-controlled Chrome instance to a Target product page,
// auto-clicks Add to Cart, intercepts the outgoing ATC request cookies
// (which contain Shape's JS-generated challenge cookies), and stores them
// in the cookie pool.
//
// Key insight: Shape runs its JS challenge when ATC is clicked. We capture
// the cookies from the OUTGOING request headers (not the response), which
// contain the freshly-generated Shape token. The ATC itself will likely fail
// ("Something went wrong") — that is expected and safe.

export class ShapeHarvester extends EventEmitter {
  private config: HarvesterConfig
  private browser: Browser | null = null
  private page: Page | null = null
  private running = false
  private loopHandle: NodeJS.Timeout | null = null
  private harvestedCount = 0
  private status: HarvesterStatus = 'idle'
  private statusText = ''
  private mainWindow: BrowserWindow | null = null

  constructor(config: HarvesterConfig) {
    super()
    this.config = config
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.setStatus('starting', 'Launching browser...')

    try {
      await this.launchBrowser()
      this.setStatus('running', 'Harvesting...')
      this.scheduleNext()
    } catch (e: any) {
      console.error('[ShapeHarvester] start error:', e)
      this.setStatus('error', `Start failed: ${e.message}`)
      this.running = false
    }
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.loopHandle) clearTimeout(this.loopHandle)
    this.loopHandle = null

    try {
      await this.browser?.close()
    } catch { /* ignore */ }

    this.browser = null
    this.page = null
    this.setStatus('stopped', 'Stopped')
  }

  private async launchBrowser(): Promise<void> {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ]

    // Add proxy if configured
    const proxy = this.config.proxyEntry
    if (proxy) {
      const formatted = this.formatProxy(proxy)
      if (formatted) args.push(`--proxy-server=${formatted}`)
    }

    // Use system Chrome
    const executablePath = this.findChromePath()

    this.browser = await puppeteer.launch({
      executablePath,
      headless: !this.config.visible,
      args,
      defaultViewport: { width: 1280, height: 800 },
    }) as unknown as Browser

    this.page = await this.browser.newPage()

    // Stealth: remove webdriver flags (runs in browser context)
    await this.page.evaluateOnNewDocument(`
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      if (!window.chrome) window.chrome = { runtime: {} };
    `)

    // Set proxy auth if needed
    if (proxy && proxy.includes(':')) {
      const parts = proxy.split(':')
      if (parts.length >= 4) {
        await this.page.authenticate({ username: parts[2], password: parts[3] })
      }
    }
  }

  private scheduleNext(): void {
    if (!this.running) return
    this.loopHandle = setTimeout(() => this.runHarvestCycle(), this.config.intervalMs)
  }

  private async runHarvestCycle(): Promise<void> {
    if (!this.running || !this.page || !this.browser) return

    try {
      await this.harvestOnce()
    } catch (e: any) {
      console.error('[ShapeHarvester]', this.config.id, 'cycle error:', e.message)
      this.setStatus('error', `Error: ${e.message}`)

      // Relaunch browser on crash
      if (!this.running) return
      try {
        await this.browser?.close()
      } catch { /* ignore */ }

      await sleep(3000)
      if (!this.running) return

      try {
        await this.launchBrowser()
        this.setStatus('running', 'Harvesting (restarted)...')
      } catch (re: any) {
        this.setStatus('error', `Relaunch failed: ${re.message}`)
      }
    }

    this.scheduleNext()
  }

  private async harvestOnce(): Promise<void> {
    if (!this.page) throw new Error('No page')

    const kind: CookieKind = this.config.kind

    // Set up request interception to capture outgoing cookies
    const capturedCookies: Record<string, string> = {}
    const capturedHeaders: Record<string, string> = {}
    let captured = false

    // Use CDP to intercept at network layer
    const client = await this.page.createCDPSession()
    await client.send('Network.enable')
    await client.send('Network.setRequestInterception', {
      patterns: [
        { urlPattern: '*api.target.com*cart*', interceptionStage: 'HeadersReceived' },
        { urlPattern: '*api.target.com*guests/carts*', interceptionStage: 'Request' },
      ],
    })

    const requestHandler = (params: any) => {
      try {
        const cookieHeader = params.request?.headers?.cookie ?? ''
        if (cookieHeader && params.request?.url?.includes('api.target.com')) {
          const cookies: Record<string, string> = {}
          for (const part of cookieHeader.split(';')) {
            const [k, ...v] = part.trim().split('=')
            if (k) cookies[k.trim()] = v.join('=').trim()
          }

          const shapeHeaders: Record<string, string> = {}
          const SHAPE_KEYS = ['x-api-key', 'x-t-request-id', 'x-application-name', 'user-agent', 'accept-language']
          for (const key of SHAPE_KEYS) {
            const val = params.request?.headers?.[key]
            if (val) shapeHeaders[key] = val
          }

          // Check for Shape cookies
          const hasShape = Object.keys(cookies).some(k =>
            k.toLowerCase().includes('shape') ||
            k.toLowerCase().includes('ts') ||
            k === '__utmz' ||
            k.startsWith('_abck') ||
            k === 'bm_sz' ||
            k === 'ak_bmsc'
          )

          if (hasShape || Object.keys(cookies).length > 3) {
            Object.assign(capturedCookies, cookies)
            Object.assign(capturedHeaders, shapeHeaders)
            captured = true
          }
        }
      } catch { /* ignore */ }

      client.send('Network.continueInterceptedRequest', {
        interceptionId: params.interceptionId,
      }).catch(() => {})
    }

    client.on('Network.requestIntercepted', requestHandler)

    try {
      // Navigate to the harvest URL (product page or login page)
      this.setStatus('running', `Navigating to ${this.config.kind} page...`)
      await this.page.goto(this.config.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      })

      await sleep(1500)

      if (kind === 'atc') {
        // Click Add to Cart button — Shape JS runs during this interaction
        this.setStatus('running', 'Clicking ATC...')
        await this.clickAddToCart()
        await sleep(2000)  // Wait for Shape to generate cookies and ATC request to fire
      } else {
        // Login page: just loading it triggers Shape's login challenge
        // Fill and attempt login (will fail with wrong password, triggering Shape)
        this.setStatus('running', 'Triggering login Shape challenge...')
        await this.triggerLoginChallenge()
        await sleep(2000)
      }
    } finally {
      client.removeAllListeners()
      await client.detach().catch(() => {})
    }

    if (captured && Object.keys(capturedCookies).length > 0) {
      addCookie(kind, capturedCookies, capturedHeaders, {
        harvesterId: this.config.id,
        proxyUsed: this.config.proxyEntry ?? undefined,
      })
      this.harvestedCount++
      this.setStatus('running', `Harvested (${this.harvestedCount} total)`)
      console.log('[ShapeHarvester]', this.config.id, 'captured', kind, 'cookie')
      this.pushHarvesterUpdate()
    } else {
      this.setStatus('running', 'No Shape cookies captured this cycle')
    }
  }

  private async clickAddToCart(): Promise<void> {
    if (!this.page) return

    const ATC_SELECTORS = [
      'button[data-test="orderPickupButton"]',
      'button[data-test="shippingButton"]',
      '[data-test="addToCartButton"] button',
      'button[aria-label*="Add to cart" i]',
      'button[class*="AddToCart" i]',
    ]

    for (const sel of ATC_SELECTORS) {
      try {
        const btn = await this.page.$(sel)
        if (btn) {
          await btn.click()
          return
        }
      } catch { /* try next */ }
    }

    // Fallback: simulate keyboard + screen coordinates
    await this.page.keyboard.press('Tab')
  }

  private async triggerLoginChallenge(): Promise<void> {
    if (!this.page) return

    // If already on login page, just simulate some interaction to trigger Shape
    await this.page.evaluate(`(function() {
      var el = document.querySelector('input[type="email"], input[id="username"]');
      if (el) el.value = 'harvest@example.com';
    })()`)

    await sleep(500)

    const submitBtn = await this.page.$('button[type="submit"], button[data-test="continue-button"]')
    if (submitBtn) {
      await submitBtn.click()
      await sleep(500)
    }
  }

  private formatProxy(proxy: string): string {
    // Supports: ip:port:user:pass or protocol://user:pass@ip:port
    if (proxy.includes('://')) return proxy
    const parts = proxy.split(':')
    if (parts.length === 2) return `http://${parts[0]}:${parts[1]}`
    if (parts.length >= 4) return `http://${parts[0]}:${parts[1]}`
    return proxy
  }

  private findChromePath(): string {
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : '',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
    ].filter(Boolean)

    for (const p of paths) {
      try {
        require('fs').accessSync(p)
        return p
      } catch { /* not found */ }
    }

    // Fallback to puppeteer bundled Chromium if available
    try {
      const pup = require('puppeteer')
      return pup.executablePath()
    } catch { /* ignore */ }

    throw new Error('Chrome executable not found. Please install Chrome.')
  }

  private setStatus(status: HarvesterStatus, text: string): void {
    this.status = status
    this.statusText = text
    this.emit('status', { id: this.config.id, status, statusText: text, harvestedCount: this.harvestedCount })
    this.pushHarvesterUpdate()
  }

  getStatus(): { status: HarvesterStatus; statusText: string; harvestedCount: number } {
    return { status: this.status, statusText: this.statusText, harvestedCount: this.harvestedCount }
  }

  private pushHarvesterUpdate(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC.PUSH_HARVESTER_UPDATE, {
        id: this.config.id,
        status: this.status,
        statusText: this.statusText,
        harvestedCount: this.harvestedCount,
      })
    }
  }
}

// ─── Harvester Manager ────────────────────────────────────────────────────────

const harvesters = new Map<string, ShapeHarvester>()

export function createHarvester(config: HarvesterConfig, win: BrowserWindow): ShapeHarvester {
  const h = new ShapeHarvester(config)
  h.setMainWindow(win)
  harvesters.set(config.id, h)
  return h
}

export function getHarvester(id: string): ShapeHarvester | undefined {
  return harvesters.get(id)
}

export async function stopAllHarvesters(): Promise<void> {
  for (const h of harvesters.values()) {
    await h.stop().catch(() => {})
  }
  harvesters.clear()
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
