import React, { useState, useEffect } from 'react'
import { useStore } from '../store'
import { bridge } from '../bridge'
import { Task, TaskSettings, TaskRunLog } from '../../shared/types'
import PageHeader from '../components/PageHeader'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { Input, Select, Toggle } from '../components/Input'

const DEFAULT_SETTINGS: TaskSettings = {
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

const DEFAULT_TASK: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'statusText' | 'successCount' | 'retryCount' | 'errorText' | 'lastOrderId' | 'lastOrderTotal'> = {
  name: '',
  mode: 'checkout',
  retailer: 'target',
  profileId: null,
  accountId: null,
  proxyListId: null,
  productGroupId: null,
  settings: DEFAULT_SETTINGS,
}

const STATUS_BADGE: Record<string, string> = {
  idle:          'badge-idle',
  starting:      'badge-info',
  waiting_cookie:'badge-warning',
  waiting_stock: 'badge-idle',
  logging_in:    'badge-warning',
  monitoring:    'badge-info',
  atc:           'badge-warning',
  checkout:      'badge-warning',
  success:       'badge-success',
  error:         'badge-error',
  stopped:       'badge-idle',
}

function isRunning(t: Task): boolean {
  return !['idle', 'stopped', 'error', 'success'].includes(t.status)
}

// ─── Log drawer ───────────────────────────────────────────────────────────────

function LogDrawer({ task, onClose }: { task: Task; onClose: () => void }) {
  const [logs, setLogs] = useState<TaskRunLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    bridge.invoke('tasks:getLogs', task.id)
      .then((res: TaskRunLog[]) => setLogs(res))
      .finally(() => setLoading(false))
  }, [task.id])

  const outcomeColor: Record<string, string> = {
    success: 'text-green-400',
    error: 'text-red-400',
    shape_block: 'text-yellow-400',
    stopped: 'text-zinc-500',
  }

  return (
    <Modal title={`Run Log — ${task.name}`} open onClose={onClose} width="max-w-3xl">
      {loading ? (
        <div className="py-8 text-center text-zinc-500 text-sm">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="py-8 text-center text-zinc-500 text-sm">No runs logged yet for this task.</div>
      ) : (
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-xs text-left">
            <thead className="text-zinc-500 border-b border-surface-border">
              <tr>
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Outcome</th>
                <th className="pb-2 pr-4">TCIN</th>
                <th className="pb-2 pr-4">Order ID</th>
                <th className="pb-2 pr-4">Total</th>
                <th className="pb-2 pr-4">Duration</th>
                <th className="pb-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-surface-border/40 hover:bg-surface-border/20">
                  <td className="py-2 pr-4 font-mono text-zinc-400 whitespace-nowrap">
                    {new Date(l.ts).toLocaleTimeString()}
                  </td>
                  <td className={`py-2 pr-4 font-semibold uppercase ${outcomeColor[l.outcome] ?? 'text-zinc-300'}`}>
                    {l.outcome.replace('_', ' ')}
                  </td>
                  <td className="py-2 pr-4 font-mono text-zinc-300">{l.tcin}</td>
                  <td className="py-2 pr-4 font-mono text-zinc-200">{l.orderId ?? '—'}</td>
                  <td className="py-2 pr-4 text-zinc-300">{l.orderTotal ? `$${l.orderTotal.toFixed(2)}` : '—'}</td>
                  <td className="py-2 pr-4 font-mono text-zinc-400">
                    {l.durationMs ? `${(l.durationMs / 1000).toFixed(2)}s` : '—'}
                  </td>
                  <td className="py-2 text-zinc-500 truncate max-w-[200px]">{l.errorText ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Tasks() {
  const { tasks, setTasks, profiles, accounts, proxies, groups, addToast } = useStore()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<Task>>(DEFAULT_TASK)
  const [busy, setBusy] = useState<Record<number, boolean>>({})
  const [bulkBusy, setBulkBusy] = useState(false)
  const [tab, setTab] = useState<'basic' | 'advanced'>('basic')
  const [logTask, setLogTask] = useState<Task | null>(null)

  const reload = async () => setTasks(await bridge.invoke('tasks:getAll'))

  const openNew = () => {
    setForm({ ...DEFAULT_TASK, settings: { ...DEFAULT_SETTINGS } })
    setTab('basic')
    setOpen(true)
  }

  const save = async () => {
    if (!form.name) { addToast('Task name required', 'error'); return }
    await bridge.invoke('tasks:save', form)
    await reload()
    addToast('Task saved', 'success')
    setOpen(false)
  }

  const remove = async (id: number) => {
    await bridge.invoke('tasks:delete', id)
    setTasks(tasks.filter((t) => t.id !== id))
    addToast('Task deleted', 'info')
  }

  const duplicate = async (id: number) => {
    const res = await bridge.invoke('tasks:duplicate', id) as { ok: boolean }
    if (res.ok) { await reload(); addToast('Task duplicated', 'info') }
  }

  const startStop = async (t: Task) => {
    setBusy((b) => ({ ...b, [t.id]: true }))
    try {
      if (isRunning(t)) {
        await bridge.invoke('tasks:stop', t.id)
        addToast(`${t.name} stopped`, 'info')
      } else {
        const res = await bridge.invoke('tasks:start', t.id) as { ok: boolean; error?: string }
        if (!res.ok) { addToast(`Start failed: ${res.error}`, 'error') }
        else addToast(`${t.name} started`, 'info')
      }
      await reload()
    } catch (e: any) {
      addToast(`Error: ${e.message}`, 'error')
    } finally {
      setBusy((b) => ({ ...b, [t.id]: false }))
    }
  }

  const startAll = async () => {
    setBulkBusy(true)
    try {
      const res = await bridge.invoke('tasks:startAll') as { started: number }
      addToast(`Started ${res.started} tasks`, 'info')
      await reload()
    } finally {
      setBulkBusy(false)
    }
  }

  const stopAll = async () => {
    setBulkBusy(true)
    try {
      await bridge.invoke('tasks:stopAll')
      addToast('All tasks stopped', 'info')
      await reload()
    } finally {
      setBulkBusy(false)
    }
  }

  const setS = (key: keyof TaskSettings, value: any) => {
    setForm((f) => ({ ...f, settings: { ...DEFAULT_SETTINGS, ...f.settings, [key]: value } }))
  }

  const s = form.settings ?? DEFAULT_SETTINGS

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Tasks"
        subtitle="Checkout automation tasks"
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={stopAll} disabled={bulkBusy}>Stop All</Button>
            <Button variant="secondary" onClick={startAll} disabled={bulkBusy}>▶ Start All</Button>
            <Button variant="primary" onClick={openNew}>+ New Task</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {tasks.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">No tasks. Create a task to start automating checkouts.</div>
        ) : (
          <div className="grid gap-2">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between bg-surface-raised border border-surface-border rounded-xl px-5 py-3.5 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-zinc-200">{t.name}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[t.status] ?? 'badge-idle'}`}>
                      {t.status}
                    </span>
                    {isRunning(t) && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 pulse-dot" />}
                    {t.successCount > 0 && (
                      <span className="text-xs text-green-400 font-medium">{t.successCount}× success</span>
                    )}
                    {t.lastOrderId && (
                      <span className="text-xs font-mono text-zinc-500">
                        Order: <span className="text-zinc-300">{t.lastOrderId}</span>
                        {t.lastOrderTotal ? <span className="text-green-400 ml-1">${t.lastOrderTotal.toFixed(2)}</span> : null}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 truncate">{t.statusText || `${t.mode} · ${t.retailer}`}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant={isRunning(t) ? 'danger' : 'primary'}
                    onClick={() => startStop(t)}
                    disabled={busy[t.id]}
                  >
                    {busy[t.id] ? '...' : isRunning(t) ? 'Stop' : 'Start'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setLogTask(t)} title="Run log">📋</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setForm(t); setTab('basic'); setOpen(true) }}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => duplicate(t.id)} title="Duplicate">⧉</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>✕</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Task edit/create modal */}
      <Modal title={form.id ? 'Edit Task' : 'New Task'} open={open} onClose={() => setOpen(false)} width="max-w-2xl">
        <div className="flex gap-2 mb-4 border-b border-surface-border pb-3">
          {(['basic', 'advanced'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-sm px-3 py-1 rounded-lg font-medium transition-colors ${tab === t ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'basic' && (
          <div className="space-y-4">
            <Input label="Task Name" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Mode"
                value={form.mode ?? 'checkout'}
                onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as any }))}
                options={[
                  { value: 'checkout', label: 'Checkout' },
                  { value: 'monitor',  label: 'Monitor Only' },
                  { value: 'login',    label: 'Login' },
                ]}
              />
              <Select
                label="Retailer"
                value={form.retailer ?? 'target'}
                onChange={(e) => setForm((f) => ({ ...f, retailer: e.target.value as any }))}
                options={[{ value: 'target', label: 'Target' }, { value: 'walmart', label: 'Walmart' }]}
              />
            </div>

            <Select
              label="Profile"
              value={String(form.profileId ?? '')}
              onChange={(e) => setForm((f) => ({ ...f, profileId: e.target.value ? Number(e.target.value) : null }))}
              options={[{ value: '', label: '— None —' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]}
            />

            <div className="space-y-2">
              <Toggle
                label="Guest Checkout"
                checked={s.useGuestCheckout}
                onChange={(v) => setS('useGuestCheckout', v)}
                description="Checkout without a Target account (no login required)"
              />
              {!s.useGuestCheckout && (
                <Select
                  label="Account"
                  value={String(form.accountId ?? '')}
                  onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value ? Number(e.target.value) : null }))}
                  options={[{ value: '', label: '— None —' }, ...accounts.map((a) => ({ value: a.id, label: a.email }))]}
                />
              )}
            </div>

            <Select
              label="Proxy List"
              value={String(form.proxyListId ?? '')}
              onChange={(e) => setForm((f) => ({ ...f, proxyListId: e.target.value ? Number(e.target.value) : null }))}
              options={[{ value: '', label: '— None —' }, ...proxies.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Select
              label="Product Group"
              value={String(form.productGroupId ?? '')}
              onChange={(e) => setForm((f) => ({ ...f, productGroupId: e.target.value ? Number(e.target.value) : null }))}
              options={[{ value: '', label: '— None —' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            />

            <Input
              label="Drop Expected At (optional)"
              type="datetime-local"
              value={s.dropExpectedAt?.slice(0, 16) ?? ''}
              onChange={(e) => setS('dropExpectedAt', e.target.value ? new Date(e.target.value).toISOString() : null)}
            />
          </div>
        )}

        {tab === 'advanced' && (
          <div className="space-y-4">
            <Toggle label="Auto Place Order" checked={s.autoPlaceOrder} onChange={(v) => setS('autoPlaceOrder', v)}
              description="⚠️ WARNING: This will charge your card." />
            <Toggle label="Endless Mode" checked={s.endlessMode} onChange={(v) => setS('endlessMode', v)}
              description="Keep running after a successful checkout" />
            {s.endlessMode && (
              <Input label="Endless Limit" type="number" min={1} value={String(s.endlessLimit)}
                onChange={(e) => setS('endlessLimit', Number(e.target.value))} />
            )}
            <Toggle label="High Stock Only" checked={s.highStockOnly} onChange={(v) => setS('highStockOnly', v)}
              description="Only attempt checkout when qty is above threshold" />
            {s.highStockOnly && (
              <Input label="High Stock Threshold" type="number" min={1} value={String(s.highStockThreshold)}
                onChange={(e) => setS('highStockThreshold', Number(e.target.value))} />
            )}
            <Input label="Max Price ($, optional)" type="number" min={0}
              value={s.maxPrice != null ? String(s.maxPrice) : ''}
              onChange={(e) => setS('maxPrice', e.target.value ? Number(e.target.value) : null)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Retry Max Attempts" type="number" min={0} value={String(s.retryMaxAttempts)}
                onChange={(e) => setS('retryMaxAttempts', Number(e.target.value))} />
              <Input label="Retry Delay (ms)" type="number" min={0} value={String(s.retryDelayMs)}
                onChange={(e) => setS('retryDelayMs', Number(e.target.value))} />
            </div>
            <Input label="Monitor Cooldown (ms)" type="number" min={500} value={String(s.monitorCooldownMs)}
              onChange={(e) => setS('monitorCooldownMs', Number(e.target.value))} />
            <Toggle label="Add Extra Product (filler)" checked={s.addExtraProduct} onChange={(v) => setS('addExtraProduct', v)}
              description="Add a cheap filler item to cart before checkout" />
            {s.addExtraProduct && (
              <Input label="Extra Product TCIN" value={s.extraProductTcin}
                onChange={(e) => setS('extraProductTcin', e.target.value)} />
            )}
            <Toggle label="Prefer Pickup" checked={s.preferPickup} onChange={(v) => setS('preferPickup', v)} />
            <Toggle label="Checkout Sound" checked={s.checkoutSound} onChange={(v) => setS('checkoutSound', v)}
              description="Play a chime on successful checkout" />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-surface-border mt-4">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </div>
      </Modal>

      {/* Log drawer */}
      {logTask && <LogDrawer task={logTask} onClose={() => setLogTask(null)} />}
    </div>
  )
}
