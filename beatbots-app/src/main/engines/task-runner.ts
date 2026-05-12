// Task Runner — orchestrates the full checkout pipeline per task
//
// Lifecycle for a checkout task:
//   1. Load profile, account, proxy list, product group from DB
//   2. Get / create a session via SessionManager
//   3. Wait for monitor to signal stock (or skip if monitor not active)
//   4. Pull ATC cookie from pool (wait up to cookieWaitMs)
//   5. Run CheckoutEngine for each product
//   6. On success: update task, notify Discord, play sound, increment counter
//   7. On failure: apply retry backoff, re-consume cookie, retry up to retryMax
//   8. Endless mode: loop back to step 3 after success

import { EventEmitter } from 'events'
import { getAll, getById, getWhere, upsert, removeWhere } from '../storage/db'
import {
  Task, TaskStatus, TaskSettings, Profile, Account, ProxyList,
  ProductGroup, MonitorProduct, TaskRunLog,
} from '../../shared/types'
import { sessionManager, SessionManager, invalidateSession, createGuestSession, GUEST_ACCOUNT_ID } from './session-manager'
import { checkoutEngine, CheckoutConfig } from './checkout-engine'
import { monitorEngine } from './monitor'
import { peekPool } from '../models/cookie-pool'
import { notifyCheckoutSuccess, notifyShapeBlock } from '../utils/discord'
import { adjustedNow } from '../utils/drop-timing'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'

const MAX_LOGS_PER_TASK = 100

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunningTask {
  taskId: number
  abortController: AbortController
  promise: Promise<void>
  retryCount: number
  successCount: number
}

// ─── Task Runner ──────────────────────────────────────────────────────────────

export class TaskRunner extends EventEmitter {
  private running = new Map<number, RunningTask>()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  async startTask(taskId: number): Promise<{ ok: boolean; error?: string }> {
    if (this.running.has(taskId)) {
      return { ok: false, error: 'Task already running' }
    }

    const task = getById<Task>('tasks', taskId)
    if (!task) return { ok: false, error: 'Task not found' }

    const ac = new AbortController()
    const promise = this.runTask(task, ac.signal)
    this.running.set(taskId, { taskId, abortController: ac, promise, retryCount: 0, successCount: 0 })
    return { ok: true }
  }

  // ── Stop ───────────────────────────────────────────────────────────────────

  stopTask(taskId: number): void {
    const rt = this.running.get(taskId)
    if (!rt) return
    rt.abortController.abort()
    this.running.delete(taskId)
    this.setTaskStatus(taskId, 'stopped', 'Stopped')
  }

  stopAll(): void {
    for (const id of this.running.keys()) this.stopTask(id)
  }

  isRunning(taskId: number): boolean {
    return this.running.has(taskId)
  }

  // ── Core loop ──────────────────────────────────────────────────────────────

  private async runTask(task: Task, signal: AbortSignal): Promise<void> {
    const settings: TaskSettings = { ...defaultSettings(), ...task.settings }
    let retryCount = 0
    let successCount = 0

    // ── Load dependencies ──────────────────────────────────────────────────

    const profile = task.profileId ? getById<Profile>('profiles', task.profileId) : null
    const account = task.accountId ? getById<Account>('accounts', task.accountId) : null
    const proxyList = task.proxyListId ? getById<ProxyList>('proxy_lists', task.proxyListId) : null
    const group = task.productGroupId
      ? getById<ProductGroup>('product_groups', task.productGroupId)
      : null
    const products: MonitorProduct[] = group
      ? getWhere<MonitorProduct>('monitor_products', (p) => p.groupId === group.id)
      : []

    if (!profile) {
      this.setTaskStatus(task.id, 'error', 'No profile configured')
      this.running.delete(task.id)
      return
    }

    if (!account && task.mode === 'login') {
      this.setTaskStatus(task.id, 'error', 'No account configured for login task')
      this.running.delete(task.id)
      return
    }

    if (!account && task.mode === 'checkout' && !settings.useGuestCheckout) {
      this.setTaskStatus(task.id, 'error', 'No account configured. Enable Guest Checkout or add an account.')
      this.running.delete(task.id)
      return
    }

    if (products.length === 0 && task.mode !== 'login') {
      this.setTaskStatus(task.id, 'error', 'No products in group')
      this.running.delete(task.id)
      return
    }

    // ── Pick proxy ─────────────────────────────────────────────────────────

    const proxyEntry = this.pickProxy(proxyList)
    sessionManager.setProxy(proxyEntry)

    // ── Sync API key from monitor if available ─────────────────────────────
    // The monitor engine may have captured the live API key from a product page.
    // Pass it to the session manager so login requests also use the current key.
    // (The session manager has its own default fallback if none is set.)

    // ── Start monitor if not already running ──────────────────────────────

    if (products.length > 0 && !monitorEngine.isRunning()) {
      monitorEngine.start({
        products: products.map((p) => ({ ...p })),
        dropExpectedAt: settings.dropExpectedAt ?? null,
        refreshIntervalMs: settings.monitorCooldownMs || 2000,
        highStockOnly: settings.highStockOnly,
        highStockThreshold: settings.highStockThreshold,
        maxPrice: settings.maxPrice,
        proxyList: proxyList?.proxies ?? [],
        cooldownMs: settings.monitorCooldownMs,
      })
    }

    // ── Login / get session ────────────────────────────────────────────────

    if (task.mode === 'login') {
      await this.runLoginTask(task, account as Account, signal)
      return
    }

    // ── Checkout loop ──────────────────────────────────────────────────────

    let session = null
    if (account) {
      this.setTaskStatus(task.id, 'logging_in', `Logging in as ${account.email}...`)
      try {
        session = await sessionManager.getSession(account.id)
      } catch (e: any) {
        this.setTaskStatus(task.id, 'error', `Login failed: ${e.message}`)
        return
      }
    } else if (settings.useGuestCheckout) {
      this.setTaskStatus(task.id, 'logging_in', 'Creating guest session...')
      try {
        session = await createGuestSession()
      } catch (e: any) {
        this.setTaskStatus(task.id, 'error', `Guest session failed: ${e.message}`)
        return
      }
    }

    if (signal.aborted) return

    // ── Wait for stock (if monitor mode or waiting_stock) ─────────────────

    if (task.mode === 'monitor') {
      this.setTaskStatus(task.id, 'monitoring', 'Monitoring for stock...')
      // For monitor-only tasks: just wait and report stock events
      await this.waitForever(signal)
      return
    }

    // Checkout mode: either wait for monitor ping or go immediately
    const firstProduct = products[0]
    this.setTaskStatus(task.id, 'waiting_stock', `Waiting for stock: ${firstProduct?.tcin || '?'}`)

    if (signal.aborted) return

    // Main checkout loop
    for (let attempt = 0; attempt <= settings.retryMaxAttempts; attempt++) {
      if (signal.aborted) break

      // Refresh session on retry if needed
      if (attempt > 0) {
        try {
          if (account) {
            invalidateSession(account.id)
            session = await sessionManager.getSession(account.id)
          } else if (settings.useGuestCheckout) {
            invalidateSession(GUEST_ACCOUNT_ID)
            session = await createGuestSession()
          }
        } catch (e: any) {
          this.setTaskStatus(task.id, 'error', `Re-login failed: ${e.message}`)
          return
        }
      }

      if (signal.aborted) break

      // Wait for Shape cookie if pool is empty
      if (peekPool('atc') === 0 && peekPool('login') === 0) {
        this.setTaskStatus(task.id, 'waiting_cookie', 'Waiting for Shape cookie...')
        await this.waitForCookieInPool(30_000, signal)
      }

      if (signal.aborted) break

      // Determine TCIN to checkout
      const product = this.pickProduct(products, successCount)
      if (!product) {
        this.setTaskStatus(task.id, 'success', `All ${products.length} products secured!`)
        break
      }

      this.setTaskStatus(task.id, 'atc', `ATC: ${product.tcin}`)

      if (!session) {
        this.setTaskStatus(task.id, 'error', 'Session required for checkout')
        break
      }

      const cfg: CheckoutConfig = {
        session,
        profile,
        tcin: product.tcin,
        qty: product.qty ?? 1,
        settings,
        taskId: task.id,
        onStatus: (text) => this.setTaskStatus(task.id, 'checkout', text),
        abortSignal: signal,
      }

      this.setTaskStatus(task.id, 'checkout', `Checking out ${product.tcin}...`)
      const result = await checkoutEngine.run(cfg)

      if (signal.aborted) break

      if (result.ok) {
        successCount++
        retryCount = 0

        // Update task counts + last order ID
        const current = getById<Task>('tasks', task.id)
        if (current) {
          upsert('tasks', {
            ...current,
            successCount: current.successCount + 1,
            lastOrderId: result.orderId ?? null,
            lastOrderTotal: result.orderTotal ?? null,
          })
        }

        // Write run log
        this.writeRunLog({
          taskId: task.id, taskName: task.name, outcome: 'success',
          tcin: product.tcin, orderId: result.orderId ?? null,
          orderTotal: result.orderTotal ?? null, durationMs: result.durationMs ?? null,
          errorText: null, accountEmail: account?.email ?? 'guest',
          proxy: proxyEntry,
        })

        // Discord
        await notifyCheckoutSuccess({
          taskName: task.name,
          accountEmail: account?.email ?? 'guest',
          tcin: product.tcin,
          productName: product.name,
          totalMs: result.durationMs,
        }).catch(() => {})

        // Toast always shows; sound is conditional
        this.pushToast(
          `SUCCESS — ${product.tcin}${result.orderId ? ` · ${result.orderId}` : ''}`,
          'success',
          settings.checkoutSound
        )

        monitorEngine.recordSuccess(product.tcin)

        if (settings.endlessMode && successCount < settings.endlessLimit) {
          const delay = settings.checkoutDelayMs || 2000
          this.setTaskStatus(task.id, 'waiting_stock', `Success #${successCount}. Waiting for next restock...`)
          await sleep(delay, signal)
          continue
        }

        this.setTaskStatus(task.id, 'success', result.orderId
          ? `Order placed: ${result.orderId} (${(result.durationMs! / 1000).toFixed(2)}s)`
          : `Reached review in ${(result.durationMs! / 1000).toFixed(2)}s`)
        break

      } else {
        retryCount++

        // Write run log for failure
        this.writeRunLog({
          taskId: task.id, taskName: task.name,
          outcome: result.shapeBlocked ? 'shape_block' : 'error',
          tcin: product.tcin, orderId: null, orderTotal: null,
          durationMs: result.durationMs ?? null,
          errorText: result.error ?? 'Unknown error',
          accountEmail: account?.email ?? 'guest', proxy: proxyEntry,
        })

        // Shape block: notify and pull a new cookie
        if (result.shapeBlocked) {
          await notifyShapeBlock(task.name).catch(() => {})
          this.setTaskStatus(task.id, 'waiting_cookie', 'Shape block — waiting for new cookie...')
          await this.waitForCookieInPool(15_000, signal)
        }

        // Non-retryable failures (OOS, no profile, etc.)
        if (!result.retryable) {
          this.setTaskStatus(task.id, 'error', result.error ?? 'Checkout failed')
          return
        }

        if (attempt >= settings.retryMaxAttempts) {
          this.setTaskStatus(task.id, 'error', `Max retries (${settings.retryMaxAttempts}). Last error: ${result.error}`)
          return
        }

        // Exponential backoff
        const backoff = Math.min(
          settings.retryDelayMs * Math.pow(2, Math.min(attempt, 5)),
          30_000
        )
        this.setTaskStatus(task.id, 'waiting_stock', `Retry ${attempt + 1}/${settings.retryMaxAttempts} in ${(backoff / 1000).toFixed(1)}s...`)
        await sleep(backoff, signal)
      }
    }

    this.running.delete(task.id)
  }

  // ── Login-only task ────────────────────────────────────────────────────────

  private async runLoginTask(task: Task, account: Account, signal: AbortSignal): Promise<void> {
    this.setTaskStatus(task.id, 'logging_in', `Logging in ${account.email}...`)
    try {
      const session = await sessionManager.getSession(account.id)
      this.setTaskStatus(task.id, 'success', `Logged in — token valid`)
    } catch (e: any) {
      this.setTaskStatus(task.id, 'error', `Login failed: ${e.message}`)
    }
    this.running.delete(task.id)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private pickProxy(proxyList: ProxyList | null): string | null {
    if (!proxyList || !proxyList.proxies.length) return null
    const i = Math.floor(Math.random() * proxyList.proxies.length)
    return proxyList.proxies[i]
  }

  private pickProduct(products: MonitorProduct[], successCount: number): MonitorProduct | null {
    // Round-robin by success count within group
    const eligible = products.filter((p) => (p.qty ?? 1) > 0)
    if (!eligible.length) return null
    return eligible[successCount % eligible.length]
  }

  private async waitForCookieInPool(timeoutMs: number, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline && !signal.aborted) {
      if (peekPool('atc') > 0 || peekPool('login') > 0) return
      await sleep(500, signal)
    }
  }

  private async waitForever(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await sleep(1000, signal)
    }
  }

  private setTaskStatus(taskId: number, status: TaskStatus, text: string): void {
    const task = getById<Task>('tasks', taskId)
    if (task) {
      upsert('tasks', { ...task, status, statusText: text })
    }
    this.pushTaskUpdate(taskId, status, text)
  }

  private pushTaskUpdate(taskId: number, status: TaskStatus, statusText: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC.PUSH_TASK_UPDATE, {
        event: 'taskStatus',
        id: taskId,
        status,
        statusText,
      })
    }
  }

  private pushToast(message: string, kind: 'success' | 'error' | 'info', playSound = false): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC.PUSH_TOAST, { message, kind, playSound })
    }
  }

  private writeRunLog(entry: Omit<TaskRunLog, 'id' | 'ts'>): void {
    try {
      upsert('task_run_logs', { ...entry, ts: new Date().toISOString() } as any)
      // Trim logs per task to MAX_LOGS_PER_TASK
      const all = getAll<TaskRunLog>('task_run_logs')
      const forTask = all.filter((l) => l.taskId === entry.taskId)
      if (forTask.length > MAX_LOGS_PER_TASK) {
        const excess = forTask.slice(MAX_LOGS_PER_TASK)
        for (const e of excess) removeWhere('task_run_logs', (l) => l.id === e.id)
      }
    } catch { /* log writes are non-fatal */ }
  }
}

// ─── Default settings ──────────────────────────────────────────────────────────

function defaultSettings(): TaskSettings {
  return {
    useSavedPayment: false,
    autoPlaceOrder: false,
    useGuestCheckout: false,
    preferPickup: false,
    endlessMode: false,
    endlessLimit: 1,
    highStockOnly: false,
    highStockThreshold: 5,
    maxPrice: null,
    checkoutDelayMs: 0,
    retryMaxAttempts: 3,
    retryDelayMs: 1000,
    addExtraProduct: false,
    extraProductTcin: '',
    checkoutSound: true,
    dropExpectedAt: null,
    monitorCooldownMs: 2000,
  }
}

// ─── Abort-aware sleep ────────────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

// Singleton
export const taskRunner = new TaskRunner()
