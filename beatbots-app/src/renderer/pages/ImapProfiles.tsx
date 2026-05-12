import React, { useState, useEffect } from 'react'
import { bridge } from '../bridge'
import { ImapProfile } from '../../shared/types'
import PageHeader from '../components/PageHeader'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { Input } from '../components/Input'
import { useStore } from '../store'

const DEFAULT: Omit<ImapProfile, 'id' | 'createdAt'> = {
  name: '', host: 'imap.gmail.com', port: 993, user: '', password: '',
}

export default function ImapProfiles() {
  const { addToast } = useStore()
  const [profiles, setProfiles] = useState<ImapProfile[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<ImapProfile>>(DEFAULT)

  useEffect(() => {
    bridge.invoke('imap:getAll').then(setProfiles)
  }, [])

  const save = async () => {
    if (!form.name || !form.host || !form.user) { addToast('Name, host and user required', 'error'); return }
    await bridge.invoke('imap:save', form)
    setProfiles(await bridge.invoke('imap:getAll'))
    addToast('IMAP profile saved', 'success')
    setOpen(false)
  }

  const remove = async (id: number) => {
    await bridge.invoke('imap:delete', id)
    setProfiles(profiles.filter((p) => p.id !== id))
    addToast('IMAP profile deleted', 'info')
  }

  const f = (key: keyof ImapProfile) => ({
    value: String(form[key] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [key]: e.target.value })),
  })

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="IMAP Profiles"
        subtitle="Email credentials for auto-reading Target OTP verification codes"
        action={<Button variant="primary" onClick={() => { setForm(DEFAULT); setOpen(true) }}>+ New Profile</Button>}
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 bg-blue-950 border border-blue-800 rounded-xl px-4 py-3 text-xs text-blue-300">
          Assign an IMAP profile to an account so that when Target sends a 6-digit verification code,
          BEATBOTS reads it automatically and completes login without you needing to intervene.
          Use Gmail App Passwords — your regular password won't work.
        </div>

        {profiles.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-sm">No IMAP profiles. Add a Gmail or Outlook IMAP profile.</div>
        ) : (
          <div className="grid gap-3">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-surface-raised border border-surface-border rounded-xl px-5 py-4">
                <div>
                  <div className="font-medium text-zinc-200">{p.name}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{p.user} · {p.host}:{p.port}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => { setForm(p); setOpen(true) }}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => remove(p.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal title={form.id ? 'Edit IMAP Profile' : 'New IMAP Profile'} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Input label="Name" placeholder="Gmail" {...f('name')} />
          <Input label="IMAP Host" placeholder="imap.gmail.com" {...f('host')} />
          <Input label="Port" type="number" {...f('port')} />
          <Input label="Username (email)" type="email" {...f('user')} />
          <Input label="Password / App Password" type="password" {...f('password')} />
          <div className="text-xs text-zinc-500 bg-zinc-900 rounded-lg p-3">
            Gmail users: go to <span className="text-zinc-300">myaccount.google.com/apppasswords</span>,
            create a new App Password, and paste it here.
            Do NOT use your regular Gmail password.
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
