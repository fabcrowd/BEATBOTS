import React, { useEffect, useRef } from 'react'

interface Props {
  title: string
  open: boolean
  onClose: () => void
  children: React.ReactNode
  width?: string
}

export default function Modal({ title, open, onClose, children, width = 'max-w-lg' }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className={`relative w-full ${width} mx-4 bg-surface-raised border border-surface-border rounded-xl shadow-2xl`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          <button
            className="text-zinc-500 hover:text-zinc-100 transition-colors text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-4 overflow-auto max-h-[80vh]">
          {children}
        </div>
      </div>
    </div>
  )
}
