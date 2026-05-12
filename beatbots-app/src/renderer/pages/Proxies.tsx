import React, { useState } from 'react'
import { useStore } from '../store'
import { bridge } from '../bridge'
import { ProxyList } from '../../shared/types'
import PageHeader from '../components/PageHeader'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { Input, Select, Textarea } from '../components/Input'

const DEFAULT: Omit<ProxyList, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', type: 'isp', proxies: [],
}

export default function Proxies() {
  const { proxies, setProxies, addToast } = useStore()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<ProxyList>>(DEFAULT)
  const [rawText, setRawText] = useState('')
  const [testing, setTesting] = useState<Record<number, string>>({})

  const openNew = () => { setForm(DEFAULT); setRawText(''); setOpen(true) }
  const openEdit = (p: ProxyList) => { setForm(p); setRawText(p.proxies.join('\n')); setOpen(true) }

  const save = async () => {
    if (!form.name) { addToast('Name required', 'error'); return }
    const parsed = rawText.split('\n').map((l) => l.trim()).filter(Boolean)
    const toSave = { ...form, proxies: parsed }
    await bridge.invoke('proxies:save', toSave)
    setProxies(await bridge.invoke('proxies:getAll'))
    addToast('Proxy list saved', 'success')
    setOpen(false)
  }

  const remove = async (id: number) => {
    await bridge.invoke('proxies:delete', id)
    setProxies(proxies.filter((p) => p.id !== id))
    addToast('Proxy list deleted', 'info')
  }

  const testList = async (pl: ProxyList) => {
    if (!pl.proxies.length) { addToast('No proxies to test', 'warning'); return }
    const proxy = pl.proxies[0]
    setTesting((t) => ({ ...t, [pl.id]: 'testing...' }))
    const result = await bridge.invoke('proxies:test', proxy)
    setTesting((t) => ({ ...t, [pl.id]: result.ok ? `✓ ${result.ip}` : `✗ ${result.error}` }))
    setTimeout(() => setTesting((t) => { const n = { ...t }; delete n[pl.id]; return n }), 5000)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Proxies"
        subtitle="ISP/residential proxy lists for monitor and checkout"
        action={<Button variant="primary" onClick={openNew}>+ New List</Button>}
      />

      <div className="flex-1 overflow-auto p-6">
        {proxies.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">No proxy lists. Add ISP or residential proxies.</div>
        ) : (
          <div className="grid gap-3">
            {proxies.map((pl) => (
              <div key={pl.id} className="flex items-center justify-between bg-surface-raised border border-surface-border rounded-xl px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-200">{pl.name}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                      {pl.type.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">{pl.proxies.length} proxies</div>
                  {testing[pl.id] && (
                    <div className={`text-xs mt-1 font-mono ${testing[pl.id].startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                      {testing[pl.id]}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => testList(pl)}>Test</Button>
                  <Button size="sm" onClick={() => openEdit(pl)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => remove(pl.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal title={form.id ? 'Edit Proxy List' : 'New Proxy List'} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Input
            label="List Name"
            value={form.name ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
          <Select
            label="Type"
            value={form.type ?? 'isp'}
            onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as any }))}
            options={[
              { value: 'isp',         label: 'ISP' },
              { value: 'residential', label: 'Residential' },
              { value: 'datacenter',  label: 'Datacenter' },
            ]}
          />
          <Textarea
            label="Proxies (one per line: ip:port:user:pass)"
            placeholder={'1.2.3.4:8080:user:pass\nprotocol://user:pass@1.2.3.4:8080'}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={10}
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
