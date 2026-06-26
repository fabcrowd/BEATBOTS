import { WebSocketServer, WebSocket } from 'ws'
import { addCookie, consumeCookie, getPoolStatus, onPoolChange } from '../models/cookie-pool'
import { CookieKind } from '../../shared/types'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import { readOtpFromConfiguredImap, createGuestSession, sessionFromTargetCookies } from './session-manager'
import { checkoutEngine } from './checkout-engine'
import { Profile, TaskSettings } from '../../shared/types'

// ─── WebSocket bridge between the Chrome extension and Electron ───────────────
// Extension connects, sends harvested cookies with a simple JSON protocol.

export class WsBridge {
  private wss: WebSocketServer | null = null
  private clients = new Set<WebSocket>()
  private port: number
  private mainWindow: BrowserWindow | null = null
  private poolListenerRegistered = false

  constructor(port = 9235) {
    this.port = port
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  start(): void {
    if (this.wss) return

    if (!this.poolListenerRegistered) {
      onPoolChange(() => this.broadcastPoolStatus())
      this.poolListenerRegistered = true
    }

    this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port })

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WSBridge] extension connected')
      this.clients.add(ws)

      ws.on('message', (raw) => {
        this.handleMessage(ws, raw.toString())
      })

      ws.on('close', () => {
        console.log('[WSBridge] extension disconnected')
        this.clients.delete(ws)
      })

      ws.on('error', (err) => {
        console.error('[WSBridge] client error:', err.message)
        this.clients.delete(ws)
      })

      ws.send(JSON.stringify({
        type: 'hello',
        source: 'beatbots',
        version: '1.0.0',
        port: this.port,
      }))
      this.sendPoolStatus(ws)
    })

    this.wss.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn('[WSBridge] port in use, retrying on', this.port + 1)
        this.port++
        this.wss = null
        setTimeout(() => this.start(), 1000)
      } else {
        console.error('[WSBridge] server error:', err)
      }
    })

    this.wss.on('listening', () => {
      console.log('[WSBridge] listening on ws://127.0.0.1:' + this.port)
    })
  }

  stop(): void {
    this.wss?.close()
    this.wss = null
    this.clients.clear()
  }

  get activePort(): number {
    return this.port
  }

  get connectedCount(): number {
    return this.clients.size
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      console.warn('[WSBridge] invalid JSON from extension')
      return
    }

    switch (msg.type) {
      case 'cookie_harvest': {
        const kind: CookieKind = msg.kind === 'login' ? 'login' : 'atc'
        if (msg.cookies && typeof msg.cookies === 'object') {
          addCookie(kind, msg.cookies, msg.shapeHeaders ?? {}, {
            harvesterId: 'extension',
            proxyUsed: msg.proxy ?? undefined,
          })
          console.log('[WSBridge] received', kind, 'cookie harvest from extension')
          this.pushPoolUpdate()
        }
        break
      }

      case 'pool_status_request': {
        this.sendPoolStatus(ws, msg.requestId)
        break
      }

      case 'consume_atc_request': {
        const cookie = consumeCookie('atc')
        ws.send(JSON.stringify({
          type: 'consume_atc',
          requestId: msg.requestId ?? null,
          ok: !!cookie,
          cookies: cookie?.cookies ?? {},
          shapeHeaders: cookie?.shapeHeaders ?? {},
        }))
        break
      }

      case 'otp_watch_request': {
        const requestId = msg.requestId ?? null
        const targetEmail = typeof msg.targetEmail === 'string' ? msg.targetEmail : undefined
        void this.handleOtpWatch(ws, requestId, targetEmail)
        break
      }

      case 'checkout_request': {
        void this.handleCheckoutRequest(ws, msg)
        break
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', requestId: msg.requestId ?? null }))
        break
      }

      default:
        console.log('[WSBridge] unknown message type:', msg.type)
    }
  }

  broadcast(msg: object): void {
    const json = JSON.stringify(msg)
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json)
      }
    }
  }

  private sendPoolStatus(ws: WebSocket, requestId?: string): void {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'pool_status',
      requestId: requestId ?? null,
      ...getPoolStatus(),
    }))
  }

  broadcastPoolStatus(): void {
    const status = getPoolStatus()
    this.broadcast({ type: 'pool_status', requestId: null, ...status })
  }

  private pushPoolUpdate(): void {
    this.broadcastPoolStatus()
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC.PUSH_POOL_UPDATE)
    }
  }

  private async handleOtpWatch(ws: WebSocket, requestId: string | null, targetEmail?: string): Promise<void> {
    const send = (payload: object) => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ requestId, ...payload }))
    }
    try {
      const code = await readOtpFromConfiguredImap({ targetEmail, timeoutMs: 90_000 })
      if (code) {
        console.log('[WSBridge] OTP found via IMAP for extension')
        send({ type: 'otp_found', ok: true, code })
      } else {
        send({ type: 'otp_found', ok: false, reason: 'timeout' })
      }
    } catch (e: any) {
      send({ type: 'otp_found', ok: false, reason: e?.message || 'error' })
    }
  }

  private async handleCheckoutRequest(ws: WebSocket, msg: any): Promise<void> {
    const requestId = msg.requestId ?? null
    const send = (payload: object) => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'checkout_result', requestId, ...payload }))
    }

    try {
      const cookies = (msg.cookies && typeof msg.cookies === 'object') ? msg.cookies as Record<string, string> : {}
      const apiKey = typeof msg.apiKey === 'string' && msg.apiKey ? msg.apiKey : undefined
      let session = sessionFromTargetCookies(cookies, apiKey)
      if (!session) {
        session = await createGuestSession(apiKey)
      }

      const p = msg.profile || {}
      const now = new Date().toISOString()
      const profile: Profile = {
        id: 0,
        name: 'extension',
        email: String(p.email || ''),
        firstName: String(p.firstName || ''),
        lastName: String(p.lastName || ''),
        address1: String(p.address1 || ''),
        address2: String(p.address2 || ''),
        city: String(p.city || ''),
        state: String(p.state || ''),
        zip: String(p.zip || ''),
        phone: String(p.phone || ''),
        cardNumber: String(p.cardNumber || ''),
        expMonth: String(p.expMonth || ''),
        expYear: String(p.expYear || ''),
        cvv: String(p.cvv || ''),
        billingZip: String(p.billingZip || p.zip || ''),
        jigIndex: Number(p.jigIndex) || 0,
        createdAt: now,
        updatedAt: now,
      }

      const settings = msg.settings || {}
      const cartId = String(msg.cartId || '')
      const fromCart = msg.mode === 'from_cart' && cartId.length > 0

      const taskSettings: TaskSettings = {
        autoPlaceOrder: !!settings.autoPlaceOrder,
        useGuestCheckout: !!settings.useGuestCheckout,
        addExtraProduct: !!settings.addExtraProduct,
        extraProductTcin: String(settings.extraProductTcin || ''),
        useSavedPayment: false,
        preferPickup: false,
        endlessMode: false,
        endlessLimit: 0,
        highStockOnly: false,
        highStockThreshold: 10,
        maxPrice: null,
        checkoutDelayMs: 0,
        retryMaxAttempts: 0,
        retryDelayMs: 1000,
        checkoutSound: false,
        dropExpectedAt: null,
        monitorCooldownMs: 0,
      }

      const result = await checkoutEngine.run({
        session,
        profile,
        tcin: String(msg.tcin || ''),
        qty: Number(msg.qty) || 1,
        settings: taskSettings,
        taskId: 0,
        existingCartId: fromCart ? cartId : undefined,
        onStatus: (text) => console.log('[WSBridge checkout]', text),
        abortSignal: AbortSignal.timeout(110_000),
      })

      send({ ok: result.ok, ...result })
    } catch (e: any) {
      send({ ok: false, error: e?.message || 'checkout_request failed', retryable: true })
    }
  }
}

export const wsBridge = new WsBridge()
