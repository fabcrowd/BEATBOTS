import React, { useState } from 'react'
import { useStore } from '../store'
import { bridge } from '../bridge'
import { ProductGroup, MonitorProduct } from '../../shared/types'
import PageHeader from '../components/PageHeader'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { Input, Select } from '../components/Input'

export default function Products() {
  const { groups, setGroups, addToast } = useStore()
  const [openGroup, setOpenGroup] = useState(false)
  const [openProduct, setOpenProduct] = useState(false)
  const [groupForm, setGroupForm] = useState<Partial<ProductGroup>>({ name: '', retailer: 'target' })
  const [productForm, setProductForm] = useState<Partial<MonitorProduct>>({ tcin: '', name: '', qty: 1 })
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)

  const reload = async () => setGroups(await bridge.invoke('groups:getAll'))

  const saveGroup = async () => {
    if (!groupForm.name) { addToast('Group name required', 'error'); return }
    await bridge.invoke('groups:save', groupForm)
    await reload()
    addToast('Group saved', 'success')
    setOpenGroup(false)
  }

  const deleteGroup = async (id: number) => {
    await bridge.invoke('groups:delete', id)
    await reload()
    addToast('Group deleted', 'info')
  }

  const saveProduct = async () => {
    if (!productForm.tcin) { addToast('TCIN required', 'error'); return }
    await bridge.invoke('products:save', { ...productForm, groupId: selectedGroupId })
    await reload()
    addToast('Product saved', 'success')
    setOpenProduct(false)
  }

  const deleteProduct = async (id: number) => {
    await bridge.invoke('products:delete', id)
    await reload()
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Product Groups"
        subtitle="Tag groups of TCINs to monitor (multi-SKU support)"
        action={
          <Button variant="primary" onClick={() => { setGroupForm({ name: '', retailer: 'target' }); setOpenGroup(true) }}>
            + New Group
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {groups.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">No product groups. Create a group and add TCINs.</div>
        ) : (
          groups.map((g) => (
            <div key={g.id} className="bg-surface-raised border border-surface-border rounded-xl overflow-hidden">
              {/* Group header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">{g.name}</span>
                  <span className="text-xs text-zinc-500 uppercase">{g.retailer}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => {
                    setSelectedGroupId(g.id)
                    setProductForm({ tcin: '', name: '', qty: 1 })
                    setOpenProduct(true)
                  }}>
                    + TCIN
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => deleteGroup(g.id)}>Delete</Button>
                </div>
              </div>

              {/* Products */}
              {(!g.products || g.products.length === 0) ? (
                <div className="px-5 py-3 text-xs text-zinc-600">No TCINs. Click + TCIN to add.</div>
              ) : (
                <div className="divide-y divide-surface-border">
                  {g.products!.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-5 py-2.5">
                      <div>
                        <span className="text-sm font-mono text-brand-400">{p.tcin}</span>
                        {p.name && <span className="text-xs text-zinc-400 ml-2">{p.name}</span>}
                        <span className="text-xs text-zinc-600 ml-2">qty: {p.qty}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => deleteProduct(p.id)}>✕</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <Modal title="New Product Group" open={openGroup} onClose={() => setOpenGroup(false)}>
        <div className="space-y-4">
          <Input label="Group Name" value={groupForm.name ?? ''} onChange={(e) => setGroupForm((g) => ({ ...g, name: e.target.value }))} />
          <Select
            label="Retailer"
            value={groupForm.retailer ?? 'target'}
            onChange={(e) => setGroupForm((g) => ({ ...g, retailer: e.target.value as any }))}
            options={[{ value: 'target', label: 'Target' }, { value: 'walmart', label: 'Walmart' }]}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpenGroup(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveGroup}>Save</Button>
          </div>
        </div>
      </Modal>

      <Modal title="Add TCIN" open={openProduct} onClose={() => setOpenProduct(false)}>
        <div className="space-y-4">
          <Input label="TCIN" placeholder="12345678" value={productForm.tcin ?? ''} onChange={(e) => setProductForm((p) => ({ ...p, tcin: e.target.value }))} />
          <Input label="Product Name (optional)" value={productForm.name ?? ''} onChange={(e) => setProductForm((p) => ({ ...p, name: e.target.value }))} />
          <Input label="Quantity" type="number" min={1} value={String(productForm.qty ?? 1)} onChange={(e) => setProductForm((p) => ({ ...p, qty: Number(e.target.value) }))} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpenProduct(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveProduct}>Add</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
