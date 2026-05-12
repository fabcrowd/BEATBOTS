import { app, BrowserWindow, shell, ipcMain } from 'electron'
import path from 'path'
import { initDb, close, getSetting } from './storage/db'
import { registerHandlers } from './ipc/handlers'
import { wsBridge } from './engines/ws-bridge'
import { monitorEngine } from './engines/monitor'
import { stopAllHarvesters } from './engines/shape-harvester'
import { taskRunner } from './engines/task-runner'
import { syncNtpClock } from './utils/drop-timing'
import { setCookiePoolConfig } from './models/cookie-pool'

const isDev = process.env.NODE_ENV === 'development'
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0f0f10',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '../../build/icon.png'),
    show: false,
    titleBarStyle: 'hidden',
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function registerWindowControls(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
}

async function boot(): Promise<void> {
  // 1. Initialize DB
  initDb()

  // 2. Apply saved settings to cookie pool config
  try {
    const ttl = getSetting('cookieTtlMinutes', '5')
    const order = getSetting('cookieRemovalOrder', 'lifo')
    setCookiePoolConfig({
      ttlMinutes: Number(ttl),
      removalOrder: order === 'fifo' ? 'fifo' : 'lifo',
    })
  } catch { /* use defaults */ }

  // 3. Create window
  createWindow()
  if (!mainWindow) throw new Error('Window creation failed')

  // 4. Register IPC handlers
  registerHandlers(mainWindow)
  registerWindowControls()

  // 5. Wire task runner to main window (for push updates)
  taskRunner.setMainWindow(mainWindow)

  // 6. Start WebSocket bridge for extension
  wsBridge.setMainWindow(mainWindow)
  wsBridge.start()

  // 6. Sync NTP in background
  syncNtpClock().catch((e) => console.warn('[NTP] sync failed:', e))

  // 7. Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(boot)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})

app.on('before-quit', async () => {
  taskRunner.stopAll()
  monitorEngine.stop()
  await stopAllHarvesters()
  wsBridge.stop()
  close()
})

// Security: prevent new windows from loading external content
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    if (parsedUrl.origin !== 'http://localhost:5173' && !navigationUrl.startsWith('file://')) {
      event.preventDefault()
    }
  })
})
