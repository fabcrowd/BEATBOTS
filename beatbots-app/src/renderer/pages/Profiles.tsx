import React, { useState } from 'react'
import { useStore } from '../store'
import { bridge } from '../bridge'
import { Profile } from '../../shared/types'
import PageHeader from '../components/PageHeader'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { Input, Toggle } from '../components/Input'

const DEFAULT: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', email: '', firstName: '', lastName: '',
  address1: '', address2: '', city: '', state: '', zip: '', phone: '',
  cardNumber: '', expMonth: '', expYear: '', cvv: '', billingZip: '',
  jigIndex: 0,
}

export default function Profiles() {
  const { profiles, setProfiles, addToast } = useStore()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<Profile>>(DEFAULT)
  const [saving, setSaving] = useState(false)

  const openNew = () => { setForm(DEFAULT); setOpen(true) }
  const openEdit = (p: Profile) => { setForm(p); setOpen(true) }

  const save = async () => {
    if (!form.name) { addToast('Name is required', 'error'); return }
    setSaving(true)
    try {
      await bridge.invoke('profiles:save', form)
      const updated = await bridge.invoke('profiles:getAll')
      setProfiles(updated)
      addToast('Profile saved', 'success')
      setOpen(false)
    } catch (e: any) {
      addToast(`Save failed: ${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    await bridge.invoke('profiles:delete', id)
    setProfiles(profiles.filter((p) => p.id !== id))
    addToast('Profile deleted', 'info')
  }

  const f = (key: keyof Profile) => ({
    value: (form[key] ?? '') as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [key]: e.target.value })),
  })

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Profiles"
        subtitle="Shipping & payment profiles for checkout"
        action={<Button variant="primary" onClick={openNew}>+ New Profile</Button>}
      />

      <div className="flex-1 overflow-auto p-6">
        {profiles.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">No profiles yet. Click + New Profile.</div>
        ) : (
          <div className="grid gap-3">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-surface-raised border border-surface-border rounded-xl px-5 py-4">
                <div>
                  <div className="font-medium text-zinc-200">{p.name}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {[p.firstName, p.lastName].filter(Boolean).join(' ')}
                    {p.address1 ? ` · ${p.address1}, ${p.city} ${p.state} ${p.zip}` : ''}
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5">
                    {p.cardNumber ? `••••${p.cardNumber.slice(-4)} ${p.expMonth}/${p.expYear}` : 'No card'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => openEdit(p)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => remove(p.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal title={form.id ? 'Edit Profile' : 'New Profile'} open={open} onClose={() => setOpen(false)} width="max-w-2xl">
        <div className="space-y-4">
          <Input label="Profile Name" placeholder="Main Profile" {...f('name')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name" {...f('firstName')} />
            <Input label="Last Name" {...f('lastName')} />
          </div>
          <Input label="Email" type="email" {...f('email')} />
          <Input label="Phone" {...f('phone')} />
          <hr className="border-surface-border" />
          <Input label="Address Line 1" {...f('address1')} />
          <Input label="Address Line 2 (optional)" {...f('address2')} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="City" {...f('city')} />
            <Input label="State" {...f('state')} />
            <Input label="Zip" {...f('zip')} />
          </div>
          <hr className="border-surface-border" />
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Payment</div>
          <Input label="Card Number" placeholder="4111111111111111" {...f('cardNumber')} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Exp Month" placeholder="01" {...f('expMonth')} />
            <Input label="Exp Year" placeholder="2028" {...f('expYear')} />
            <Input label="CVV" placeholder="123" {...f('cvv')} />
          </div>
          <Input label="Billing Zip" {...f('billingZip')} />
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-400">Jig Address Index</label>
            <input
              type="number"
              min={0} max={9}
              value={form.jigIndex ?? 0}
              onChange={(e) => setForm((p) => ({ ...p, jigIndex: Number(e.target.value) }))}
              className="w-20 bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-100"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
