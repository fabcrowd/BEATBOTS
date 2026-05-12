import React from 'react'
import { NavLink } from 'react-router-dom'
import { useStore } from '../store'

const NAV = [
  { to: '/',           label: 'Dashboard',  icon: '⊞' },
  { to: '/tasks',      label: 'Tasks',      icon: '▶' },
  { to: '/harvesters', label: 'Harvesters', icon: '◎' },
  { to: '/products',   label: 'Products',   icon: '⊡' },
  { to: '/profiles',   label: 'Profiles',   icon: '◻' },
  { to: '/accounts',   label: 'Accounts',   icon: '◇' },
  { to: '/proxies',    label: 'Proxies',    icon: '⟳' },
  { to: '/settings',   label: 'Settings',   icon: '⚙' },
]

export default function Sidebar() {
  const { poolStatus } = useStore()

  return (
    <nav className="w-44 shrink-0 bg-surface-raised border-r border-surface-border flex flex-col select-none">
      <div className="flex-1 py-2">
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                isActive
                  ? 'text-brand-400 bg-brand-900/20 border-r-2 border-brand-500'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-surface-border/50'
              }`
            }
          >
            <span className="text-base leading-none">{icon}</span>
            <span className="font-medium">{label}</span>
          </NavLink>
        ))}
      </div>

      {/* Cookie pool status indicator */}
      <div className="border-t border-surface-border p-3 space-y-1">
        <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Cookie Pool</div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Login</span>
          <span className={`text-xs font-mono font-semibold ${poolStatus && poolStatus.loginCount > 0 ? 'text-green-400' : 'text-zinc-500'}`}>
            {poolStatus?.loginCount ?? 0}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">ATC</span>
          <span className={`text-xs font-mono font-semibold ${poolStatus && poolStatus.atcCount > 0 ? 'text-green-400' : 'text-zinc-500'}`}>
            {poolStatus?.atcCount ?? 0}
          </span>
        </div>
        {poolStatus && poolStatus.generationRate > 0 && (
          <div className="text-xs text-zinc-500">
            ~{poolStatus.generationRate}/min
          </div>
        )}
      </div>
    </nav>
  )
}
