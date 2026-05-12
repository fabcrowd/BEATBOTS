import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { getAll, getById, getWhere, upsert, remove, getSetting, setSetting, exportAllData, importAllData, getDataDir } from '../storage/db'
import {
  Profile, Account, ProxyList, ProductGroup, MonitorProduct,
  Task, HarvesterConfig, AppSettings, TaskRunLog, IPC,
} from '../../shared/types'
import { getPoolStatus, clearPool, setCookiePoolConfig } from '../models/cookie-pool'
import { monitorEngine } from '../engines/monitor'
import { wsBridge } from '../engines/ws-bridge'
import {
  createHarvester, getHarvester,
} from '../engines/shape-harvester'
import { taskRunner } from '../engines/task-runner'
import { sessionManager } from '../engines/session-manager'
import { sendDiscordEmbed } from '../utils/discord'
import { syncNtpClock, getNtpOffset } from '../utils/drop-timing'

// ─── Settings helpers ─────────────────────────────────────────────────────────

function readAllSettings(): AppSettings {
  return {
    discordWebhook:       getSetting('discordWebhook', ''),
    webhookSendFailures:  getSetting('webhookSendFailures', 'false') === 'true',
    defaultRetryAttempts: Number(getSetting('defaultRetryAttempts', '3')),
    defaultRetryDelayMs:  Number(getSetting('defaultRetryDelayMs', '1000')),
    cookieTtlMinutes:     Number(getSetting('cookieTtlMinutes', '5')),
    cookieRemovalOrder:   getSetting('cookieRemovalOrder', 'lifo') as 'lifo' | 'fifo',
    ntpServer:            getSetting('ntpServer', 'https://lm-clock.vercel.app/api/time'),
    ntpOffsetMs:          Number(getSetting('ntpOffsetMs', '0')),
    checkoutSound:        getSetting('checkoutSound', 'true') === 'true',
    extensionWsPort:      Number(getSetting('extensionWsPort', '9235')),
  }
}

// ─── Register all IPC handlers ────────────────────────────────────────────────

export function registerHandlers(mainWindow: BrowserWindow): void {

  // ── Profiles ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.PROFILES_GET_ALL, () => getAll<Profile>('profiles'))

  ipcMain.handle(IPC.PROFILES_SAVE, (_, profile: Partial<Profile>) => {
    upsert('profiles', profile as Profile)
    return true
  })

  ipcMain.handle(IPC.PROFILES_DELETE, (_, id: number) => {
    remove('profiles', id)
    return true
  })

  // ── Accounts ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.ACCOUNTS_GET_ALL, () => getAll<Account>('accounts'))

  ipcMain.handle(IPC.ACCOUNTS_SAVE, (_, account: Partial<Account>) => {
    upsert('accounts', { status: 'idle', lastLoginAt: null, ...account } as Account)
    return true
  })

  ipcMain.handle(IPC.ACCOUNTS_DELETE, (_, id: number) => {
    remove('accounts', id)
    return true
  })

  // ── Proxies ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.PROXIES_GET_ALL, () => getAll<ProxyList>('proxy_lists'))

  ipcMain.handle(IPC.PROXIES_SAVE, (_, pl: Partial<ProxyList>) => {
    upsert('proxy_lists', { ...pl, proxies: pl.proxies ?? [] } as ProxyList)
    return true
  })

  ipcMain.handle(IPC.PROXIES_DELETE, (_, id: number) => {
    remove('proxy_lists', id)
    return true
  })

  ipcMain.handle(IPC.PROXIES_TEST, async (_, proxy: string) => {
    try {
      const res = await fetch('https://api.ipify.org?format=json', {
        signal: AbortSignal.timeout(5000),
      })
      const data = await res.json() as { ip: string }
      return { ok: true, ip: data.ip }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ── Product Groups ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GROUPS_GET_ALL, () => {
    const groups = getAll<ProductGroup>('product_groups')
    return groups.map((g) => ({
      ...g,
      products: getWhere<MonitorProduct>('monitor_products', (p) => p.groupId === g.id),
    }))
  })

  ipcMain.handle(IPC.GROUPS_SAVE, (_, group: Partial<ProductGroup>) => {
    const result = upsert('product_groups', { retailer: 'target', ...group } as ProductGroup)
    return { id: result.id }
  })

  ipcMain.handle(IPC.GROUPS_DELETE, (_, id: number) => {
    remove('product_groups', id)
    // Also remove related products
    const products = getWhere<MonitorProduct>('monitor_products', (p) => p.groupId === id)
    for (const p of products) remove('monitor_products', p.id)
    return true
  })

  ipcMain.handle(IPC.PRODUCTS_SAVE, (_, product: Partial<MonitorProduct>) => {
    upsert('monitor_products', { qty: 1, name: '', ...product } as MonitorProduct)
    return true
  })

  ipcMain.handle(IPC.PRODUCTS_DELETE, (_, id: number) => {
    remove('monitor_products', id)
    return true
  })

  // ── Tasks ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.TASKS_GET_ALL, () => getAll<Task>('tasks'))

  ipcMain.handle(IPC.TASKS_SAVE, (_, task: Partial<Task>) => {
    const result = upsert('tasks', {
      status: 'idle', statusText: '', successCount: 0, retryCount: 0, errorText: null,
      mode: 'checkout', retailer: 'target', settings: {},
      ...task,
    } as Task)
    return { id: result.id }
  })

  ipcMain.handle(IPC.TASKS_DELETE, (_, id: number) => {
    remove('tasks', id)
    return true
  })

  ipcMain.handle(IPC.TASKS_START, async (_, id: number) => {
    const result = await taskRunner.startTask(id)
    return result
  })

  ipcMain.handle(IPC.TASKS_STOP, (_, id: number) => {
    taskRunner.stopTask(id)
    return { ok: true }
  })

  ipcMain.handle(IPC.TASKS_START_ALL, async () => {
    const tasks = getAll<Task>('tasks')
    const idle = tasks.filter((t) => ['idle', 'stopped', 'error', 'success'].includes(t.status))
    const results = await Promise.all(idle.map((t) => taskRunner.startTask(t.id)))
    return { started: results.filter((r) => r.ok).length }
  })

  ipcMain.handle(IPC.TASKS_STOP_ALL, () => {
    taskRunner.stopAll()
    return { ok: true }
  })

  ipcMain.handle(IPC.TASKS_DUPLICATE, (_, id: number) => {
    const task = getById<Task>('tasks', id)
    if (!task) return { ok: false, error: 'Task not found' }
    const { id: _id, createdAt, updatedAt, status, statusText, successCount, retryCount, errorText, lastOrderId, lastOrderTotal, ...rest } = task as any
    const copy = upsert('tasks', {
      ...rest,
      name: `${task.name} (copy)`,
      status: 'idle', statusText: '', successCount: 0, retryCount: 0,
      errorText: null, lastOrderId: null, lastOrderTotal: null,
    })
    return { ok: true, id: copy.id }
  })

  ipcMain.handle(IPC.TASKS_GET_LOGS, (_, taskId?: number) => {
    const logs = getAll<TaskRunLog>('task_run_logs')
    if (taskId != null) return logs.filter((l) => l.taskId === taskId)
    return logs
  })

  // ── Account login (standalone) ─────────────────────────────────────────

  ipcMain.handle(IPC.ACCOUNTS_LOGIN, async (_, accountId: number) => {
    const account = getById<Account>('accounts', accountId)
    if (!account) return { ok: false, error: 'Account not found' }
    const result = await sessionManager.login(account)
    return result
  })

  // ── IMAP Profiles ─────────────────────────────────────────────────────

  ipcMain.handle('imap:getAll', () => {
    return getAll('imap_profiles')
  })

  ipcMain.handle('imap:save', (_, profile: any) => {
    upsert('imap_profiles', {
      name: '', host: 'imap.gmail.com', port: 993, user_name: '', password: '',
      ...profile,
    })
    return true
  })

  ipcMain.handle('imap:delete', (_, id: number) => {
    remove('imap_profiles', id)
    return true
  })

  // ── Cookie Pool ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC.POOL_STATUS, () => getPoolStatus())

  ipcMain.handle(IPC.POOL_CLEAR, (_, kind?: 'login' | 'atc') => {
    clearPool(kind)
    return true
  })

  // ── Harvesters ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.HARVESTERS_GET_ALL, () => {
    const rows = getAll<HarvesterConfig>('harvesters')
    return rows.map((r) => {
      const live = getHarvester(r.id)?.getStatus()
      if (!live) return r
      const merged = { ...r }
      merged.status = live.status
      merged.statusText = live.statusText
      merged.harvestedCount = live.harvestedCount
      return merged
    })
  })

  ipcMain.handle(IPC.HARVESTERS_SAVE, (_, config: HarvesterConfig) => {
    const toSave = { ...config }
    if (!toSave.status) toSave.status = 'idle'
    if (!toSave.statusText) toSave.statusText = ''
    if (!toSave.harvestedCount) toSave.harvestedCount = 0
    upsert('harvesters', toSave)
    return true
  })

  ipcMain.handle(IPC.HARVESTERS_DELETE, async (_, id: string) => {
    const h = getHarvester(id)
    if (h) await h.stop().catch(() => {})
    remove('harvesters', id)
    return true
  })

  ipcMain.handle(IPC.HARVESTERS_START, async (_, id: string) => {
    const config = getById<HarvesterConfig>('harvesters', id)
    if (!config) return { ok: false, error: 'Not found' }

    let h = getHarvester(id)
    if (!h) {
      h = createHarvester(config, mainWindow)
    }
    await h.start()
    return { ok: true }
  })

  ipcMain.handle(IPC.HARVESTERS_STOP, async (_, id: string) => {
    const h = getHarvester(id)
    if (h) await h.stop()
    return { ok: true }
  })

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SETTINGS_GET, () => readAllSettings())

  ipcMain.handle(IPC.SETTINGS_SAVE, (_, settings: Partial<AppSettings>) => {
    for (const [key, value] of Object.entries(settings)) {
      setSetting(key, String(value))
    }
    setCookiePoolConfig({
      ttlMinutes: settings.cookieTtlMinutes,
      removalOrder: settings.cookieRemovalOrder,
    })
    return true
  })

  // ── Monitor ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.MONITOR_START, (_, config: any) => {
    monitorEngine.start(config)
    return { ok: true }
  })

  ipcMain.handle(IPC.MONITOR_STOP, () => {
    monitorEngine.stop()
    return { ok: true }
  })

  ipcMain.handle(IPC.MONITOR_STATUS, () => ({
    active: monitorEngine.isRunning(),
  }))

  // ── Discord test ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC.DISCORD_TEST, async () => {
    try {
      await sendDiscordEmbed({
        title: 'BEATBOTS — Test Webhook',
        description: 'Webhook configured correctly!',
        color: 0x22c55e,
        footer: 'BEATBOTS',
      })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ── WS Bridge status ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.WS_STATUS, () => ({
    port: wsBridge.activePort,
    connected: wsBridge.connectedCount,
  }))

  // ── Data Export / Import ──────────────────────────────────────────────────

  ipcMain.handle(IPC.DATA_EXPORT, async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export BEATBOTS Data',
      defaultPath: `beatbots-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return { ok: false, reason: 'cancelled' }
    try {
      const data = exportAllData()
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
      return { ok: true, filePath }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle(IPC.DATA_IMPORT, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import BEATBOTS Data',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return { ok: false, reason: 'cancelled' }
    try {
      const raw = fs.readFileSync(filePaths[0], 'utf-8')
      const snapshot = JSON.parse(raw)
      if (!snapshot.version) return { ok: false, error: 'Invalid backup file' }
      importAllData(snapshot)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // ── App Update Check ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.UPDATE_CHECK, async () => {
    // Without a publish server configured, we return a placeholder.
    // Wire electron-updater here once a GitHub release pipeline is set up.
    return { upToDate: true, current: '1.0.0' }
  })

  // ── NTP ───────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.NTP_OFFSET, async () => {
    const ntpServer = getSetting('ntpServer', 'https://lm-clock.vercel.app/api/time')
    await syncNtpClock(ntpServer)
    const offset = getNtpOffset()
    setSetting('ntpOffsetMs', String(offset))
    return { offsetMs: offset }
  })

  // ─── Push monitor events → renderer ──────────────────────────────────────

  monitorEngine.on('stock', (ev) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.PUSH_TASK_UPDATE, { event: 'stock', ...ev })
    }
  })

  monitorEngine.on('status', (ev) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.PUSH_TASK_UPDATE, { event: 'monitorStatus', ...ev })
    }
  })

  console.log('[IPC] all handlers registered')
}
