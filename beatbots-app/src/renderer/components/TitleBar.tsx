import React from 'react'

export default function TitleBar() {
  return (
    <div className="titlebar-drag flex items-center justify-between h-9 bg-surface-raised border-b border-surface-border px-4 select-none shrink-0">
      <div className="titlebar-no-drag flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-brand-500" />
        <span className="text-xs font-bold tracking-widest text-zinc-300 uppercase">BEATBOTS</span>
      </div>
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors"
          title="Minimize"
          onClick={() => (window as any).electronAPI?.minimize?.()}
        />
        <button
          className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 transition-colors"
          title="Maximize"
          onClick={() => (window as any).electronAPI?.maximize?.()}
        />
        <button
          className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors"
          title="Close"
          onClick={() => (window as any).electronAPI?.close?.()}
        />
      </div>
    </div>
  )
}
