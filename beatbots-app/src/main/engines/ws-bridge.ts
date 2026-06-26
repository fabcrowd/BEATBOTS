import { WebSocketServer, WebSocket } from 'ws'
import { addCookie, consumeCookie, getPoolStatus, onPoolChange } from '../models/cookie-pool'
import { CookieKind } from '../../shared/types'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'

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
}

export const wsBridge = new WsBridge()
