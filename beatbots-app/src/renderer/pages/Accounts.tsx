import React, { useState } from 'react'
import { useStore } from '../store'
import { bridge } from '../bridge'
import { Account } from '../../shared/types'
import PageHeader from '../components/PageHeader'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { Input, Select } from '../components/Input'

const DEFAULT: Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'lastLoginAt' | 'status'> = {
  name: '', email: '', password: '', accessToken: '', loginMethod: 'request', imapProfileId: null,
}

export default function Accounts() {
  const { accounts, setAccounts, addToast } = useStore()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<Account>>(DEFAULT)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.email) { addToast('Email required', 'error'); return }
    setSaving(true)
    try {
      await bridge.invoke('accounts:save', form)
      setAccounts(await bridge.invoke('accounts:getAll'))
      addToast('Account saved', 'success')
      setOpen(false)
    } catch (e: any) {
      addToast(`Save failed: ${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    await bridge.invoke('accounts:delete', id)
    setAccounts(accounts.filter((a) => a.id !== id))
    addToast('Account deleted', 'info')
  }

  const loginAccount = async (id: number) => {
    const a = accounts.find((a) => a.id === id)
    if (!a) return
    addToast(`Logging in ${a.email}...`, 'info')
    const result = await bridge.invoke('accounts:login', id)
    if (result?.ok) {
      addToast(`${a.email} logged in`, 'success')
      setAccounts(await bridge.invoke('accounts:getAll'))
    } else {
      addToast(`Login failed: ${result?.error ?? 'unknown'}`, 'error')
    }
  }

  const f = (key: keyof Account) => ({
    value: (form[key] ?? '') as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [key]: e.target.value })),
  })

  const statusColor: Record<string, string> = {
    idle:       'text-zinc-500',
    logged_in:  'text-green-400',
    logging_in: 'text-yellow-400',
    error:      'text-red-400',
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Accounts"
        subtitle="Target account credentials for API-based checkout"
        action={<Button variant="primary" onClick={() => { setForm(DEFAULT); setOpen(true) }}>+ New Account</Button>}
      />

      <div className="flex-1 overflow-auto p-6">
        {accounts.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">No accounts. Add Target.com accounts here.</div>
        ) : (
          <div className="grid gap-3">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between bg-surface-raised border border-surface-border rounded-xl px-5 py-4">
                <div>
                  <div className="font-medium text-zinc-200">{a.name || a.email}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{a.email} · {a.loginMethod}</div>
                  <div className={`text-xs mt-0.5 ${statusColor[a.status] ?? 'text-zinc-500'}`}>
                    {a.status}{a.lastLoginAt ? ` · Last login: ${new Date(a.lastLoginAt).toLocaleString()}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => loginAccount(a.id)}>Login</Button>
                  <Button size="sm" onClick={() => { setForm(a); setOpen(true) }}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => remove(a.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal title={form.id ? 'Edit Account' : 'New Account'} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Input label="Name (optional)" placeholder="Main account" {...f('name')} />
          <Input label="Email" type="email" {...f('email')} />
          <Input label="Password" type="password" {...f('password')} />
          <Input label="Access Token (optional, overrides password)" placeholder="target access token" {...f('accessToken')} />
          <Select
            label="Login Method"
            value={form.loginMethod ?? 'request'}
            onChange={(e) => setForm((p) => ({ ...p, loginMethod: e.target.value as any }))}
            options={[
              { value: 'request', label: 'Request Login (API)' },
              { value: 'token',   label: 'Access Token' },
            ]}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
