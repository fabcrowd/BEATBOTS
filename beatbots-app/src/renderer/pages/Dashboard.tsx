import React, { useEffect, useState } from 'react'
import { useStore } from '../store'
import { bridge } from '../bridge'
import DropCountdown from '../components/DropCountdown'

export default function Dashboard() {
  const { tasks, poolStatus, harvesters } = useStore()
  const [monitorStatus, setMonitorStatus] = useState(false)

  // Collect drop times from all tasks that have one configured
  const nextDrop = tasks
    .map((t) => t.settings?.dropExpectedAt)
    .filter(Boolean)
    .sort()[0] ?? null

  const activeTasks = tasks.filter((t) => t.status !== 'idle' && t.status !== 'stopped').length
  const successToday = tasks.reduce((acc, t) => acc + t.successCount, 0)
  const activeHarvesters = harvesters.filter((h) => h.status === 'running').length

  // Refresh monitor status
  useEffect(() => {
    bridge.invoke('monitor:status').then((s: any) => setMonitorStatus(s?.active ?? false))
  }, [])

  const stat = (label: string, value: string | number, color = 'text-zinc-100') => (
    <div className="bg-surface-raised border border-surface-border rounded-xl p-4">
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Dashboard</h1>
          <p className="text-sm text-zinc-400 mt-1">BEATBOTS — Target Checkout Automation</p>
        </div>
        <DropCountdown dropExpectedAt={nextDrop} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat('Active Tasks', activeTasks, activeTasks > 0 ? 'text-brand-400' : 'text-zinc-100')}
        {stat('Success Today', successToday, successToday > 0 ? 'text-green-400' : 'text-zinc-100')}
        {stat('Login Cookies', poolStatus?.loginCount ?? 0, (poolStatus?.loginCount ?? 0) > 0 ? 'text-green-400' : 'text-red-400')}
        {stat('ATC Cookies',   poolStatus?.atcCount ?? 0,   (poolStatus?.atcCount ?? 0) > 0 ? 'text-green-400' : 'text-red-400')}
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Monitor */}
        <div className="bg-surface-raised border border-surface-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-zinc-300">Monitor</span>
            <span className={`flex items-center gap-1.5 text-xs font-medium ${monitorStatus ? 'text-green-400' : 'text-zinc-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${monitorStatus ? 'bg-green-400 pulse-dot' : 'bg-zinc-600'}`} />
              {monitorStatus ? 'Active' : 'Stopped'}
            </span>
          </div>
          <div className="text-xs text-zinc-500">
            {monitorStatus ? 'Polling RedSky for inventory changes...' : 'No monitor running. Create a task to start.'}
          </div>
        </div>

        {/* Harvesters */}
        <div className="bg-surface-raised border border-surface-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-zinc-300">Shape Harvesters</span>
            <span className={`flex items-center gap-1.5 text-xs font-medium ${activeHarvesters > 0 ? 'text-green-400' : 'text-zinc-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${activeHarvesters > 0 ? 'bg-green-400 pulse-dot' : 'bg-zinc-600'}`} />
              {activeHarvesters}/{harvesters.length} running
            </span>
          </div>
          <div className="text-xs text-zinc-500">
            {poolStatus?.generationRate
              ? `~${poolStatus.generationRate} cookies/min`
              : 'No active harvesters'
            }
          </div>
        </div>
      </div>

      {/* Recent tasks */}
      <div className="bg-surface-raised border border-surface-border rounded-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <span className="text-sm font-semibold text-zinc-300">Recent Tasks</span>
        </div>
        {tasks.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            No tasks yet. Go to Tasks to create your first task.
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {tasks.slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-zinc-200">{t.name}</div>
                  <div className="text-xs text-zinc-500">{t.statusText || t.status}</div>
                </div>
                <div className="flex items-center gap-3">
                  {t.successCount > 0 && (
                    <span className="text-xs text-green-400 font-mono">{t.successCount}x</span>
                  )}
                  <StatusBadge status={t.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    idle:          'badge-idle',
    running:       'badge-info',
    monitoring:    'badge-info',
    atc:           'badge-warning',
    checkout:      'badge-warning',
    success:       'badge-success',
    error:         'badge-error',
    stopped:       'badge-idle',
    waiting_stock: 'badge-idle',
    waiting_cookie:'badge-warning',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'badge-idle'}`}>
      {status}
    </span>
  )
}
