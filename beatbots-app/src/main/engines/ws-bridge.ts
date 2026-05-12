import { WebSocketServer, WebSocket } from 'ws'
import { addCookie } from '../models/cookie-pool'
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

  constructor(port = 9235) {
    this.port = port
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  start(): void {
    if (this.wss) return

    this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port })

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WSBridge] extension connected')
      this.clients.add(ws)

      ws.on('message', (raw) => {
        this.handleMessage(raw.toString())
      })

      ws.on('close', () => {
        console.log('[WSBridge] extension disconnected')
        this.clients.delete(ws)
      })

      ws.on('error', (err) => {
        console.error('[WSBridge] client error:', err.message)
        this.clients.delete(ws)
      })

      // Send initial handshake
      ws.send(JSON.stringify({ type: 'hello', source: 'beatbots', version: '1.0.0' }))
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

  private handleMessage(raw: string): void {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      console.warn('[WSBridge] invalid JSON from extension')
      return
    }

    switch (msg.type) {
      case 'cookie_harvest': {
        // Extension sends:
        // { type: 'cookie_harvest', kind: 'atc'|'login', cookies: {...}, shapeHeaders: {...}, proxy?: string }
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

      case 'ping': {
        this.broadcast({ type: 'pong' })
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

  private pushPoolUpdate(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC.PUSH_POOL_UPDATE)
    }
  }
}

export const wsBridge = new WsBridge()
