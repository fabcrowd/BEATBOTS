import React, { useState } from 'react'
import { useStore } from '../store'
import { bridge } from '../bridge'
import { HarvesterConfig } from '../../shared/types'
import PageHeader from '../components/PageHeader'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { Input, Select, Toggle } from '../components/Input'

let harvesterSeq = Date.now()

const DEFAULT: HarvesterConfig = {
  id: '',
  name: '',
  kind: 'atc',
  targetUrl: 'https://www.target.com/p/-/A-12345678',
  intervalMs: 25000,
  maxPoolSize: 50,
  proxyListId: null,
  proxyEntry: null,
  visible: false,
  autoStart: false,
  status: 'idle',
  statusText: '',
  harvestedCount: 0,
  createdAt: '',
}

export default function Harvesters() {
  const { harvesters, setHarvesters, proxies, poolStatus, addToast } = useStore()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<HarvesterConfig>(DEFAULT)
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const reload = async () => setHarvesters(await bridge.invoke('harvesters:getAll'))

  const openNew = () => {
    setForm({ ...DEFAULT, id: `h_${++harvesterSeq}`, createdAt: new Date().toISOString() })
    setOpen(true)
  }

  const save = async () => {
    if (!form.name) { addToast('Name required', 'error'); return }
    await bridge.invoke('harvesters:save', form)
    await reload()
    addToast('Harvester saved', 'success')
    setOpen(false)
  }

  const remove = async (id: string) => {
    await bridge.invoke('harvesters:delete', id)
    await reload()
    addToast('Harvester deleted', 'info')
  }

  const startStop = async (h: HarvesterConfig) => {
    setBusy((b) => ({ ...b, [h.id]: true }))
    try {
      if (h.status === 'running') {
        await bridge.invoke('harvesters:stop', h.id)
        addToast(`${h.name} stopped`, 'info')
      } else {
        await bridge.invoke('harvesters:start', h.id)
        addToast(`${h.name} starting...`, 'info')
      }
      await reload()
    } catch (e: any) {
      addToast(`Error: ${e.message}`, 'error')
    } finally {
      setBusy((b) => ({ ...b, [h.id]: false }))
    }
  }

  const statusColor: Record<string, string> = {
    idle:     'text-zinc-500',
    starting: 'text-yellow-400',
    running:  'text-green-400',
    error:    'text-red-400',
    stopped:  'text-zinc-500',
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Shape Harvesters"
        subtitle="Automated cookie generation for Target Shape Security bypass"
        action={<Button variant="primary" onClick={openNew}>+ New Harvester</Button>}
      />

      {/* Pool status banner */}
      {poolStatus && (
        <div className="mx-6 mt-4 flex items-center gap-6 bg-surface-raised border border-surface-border rounded-xl px-5 py-3 text-sm">
          <div>
            <span className="text-zinc-500">Login cookies: </span>
            <span className={`font-mono font-semibold ${poolStatus.loginCount > 0 ? 'text-green-400' : 'text-red-400'}`}>{poolStatus.loginCount}</span>
          </div>
          <div>
            <span className="text-zinc-500">ATC cookies: </span>
            <span className={`font-mono font-semibold ${poolStatus.atcCount > 0 ? 'text-green-400' : 'text-red-400'}`}>{poolStatus.atcCount}</span>
          </div>
          {poolStatus.generationRate > 0 && (
            <div className="text-zinc-500">~{poolStatus.generationRate}/min</div>
          )}
          <Button size="sm" variant="danger" onClick={() => bridge.invoke('pool:clear').then(() => addToast('Pool cleared', 'info'))}>
            Clear Pool
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6 space-y-3">
        {harvesters.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">
            No harvesters. Shape harvesters auto-click ATC to capture Shape cookies for API checkout.
          </div>
        ) : (
          harvesters.map((h) => (
            <div key={h.id} className="flex items-center justify-between bg-surface-raised border border-surface-border rounded-xl px-5 py-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-200">{h.name}</span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase">
                    {h.kind}
                  </span>
                  {h.status === 'running' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 pulse-dot" />
                  )}
                </div>
                <div className={`text-xs mt-0.5 ${statusColor[h.status]}`}>
                  {h.statusText || h.status}
                </div>
                <div className="text-xs text-zinc-600 mt-0.5 font-mono truncate max-w-sm">{h.targetUrl}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-zinc-500">Harvested</div>
                  <div className="text-sm font-mono font-semibold text-zinc-300">{h.harvestedCount}</div>
                </div>
                <Button
                  size="sm"
                  variant={h.status === 'running' ? 'danger' : 'primary'}
                  onClick={() => startStop(h)}
                  disabled={busy[h.id]}
                >
                  {busy[h.id] ? '...' : h.status === 'running' ? 'Stop' : 'Start'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setForm(h); setOpen(true) }}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(h.id)}>✕</Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal title={form.id ? 'Edit Harvester' : 'New Harvester'} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Select
            label="Cookie Kind"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as any }))}
            options={[{ value: 'atc', label: 'ATC (product page)' }, { value: 'login', label: 'Login (sign-in page)' }]}
          />
          <Input
            label="Target URL"
            value={form.targetUrl}
            onChange={(e) => setForm((f) => ({ ...f, targetUrl: e.target.value }))}
            placeholder="https://www.target.com/p/-/A-12345678"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Interval (ms)"
              type="number"
              min={5000}
              value={String(form.intervalMs)}
              onChange={(e) => setForm((f) => ({ ...f, intervalMs: Number(e.target.value) }))}
            />
            <Input
              label="Max Pool Size"
              type="number"
              min={1}
              max={100}
              value={String(form.maxPoolSize)}
              onChange={(e) => setForm((f) => ({ ...f, maxPoolSize: Number(e.target.value) }))}
            />
          </div>
          {proxies.length > 0 && (
            <Select
              label="Proxy List (optional)"
              value={String(form.proxyListId ?? '')}
              onChange={(e) => setForm((f) => ({ ...f, proxyListId: e.target.value ? Number(e.target.value) : null }))}
              options={[{ value: '', label: 'None' }, ...proxies.map((p) => ({ value: p.id, label: p.name }))]}
            />
          )}
          <Input
            label="Specific Proxy Entry (optional)"
            value={form.proxyEntry ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, proxyEntry: e.target.value || null }))}
            placeholder="ip:port:user:pass"
          />
          <Toggle
            label="Show Browser Window"
            checked={form.visible}
            onChange={(v) => setForm((f) => ({ ...f, visible: v }))}
            description="Useful for debugging. Disable for production."
          />
          <Toggle
            label="Auto-start on app launch"
            checked={form.autoStart}
            onChange={(v) => setForm((f) => ({ ...f, autoStart: v }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
