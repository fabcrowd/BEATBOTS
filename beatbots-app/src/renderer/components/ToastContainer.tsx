import React from 'react'
import { useStore } from '../store'

export default function ToastContainer() {
  const { toasts, removeToast } = useStore()

  const colorMap = {
    success: 'bg-green-900 border-green-700 text-green-200',
    error:   'bg-red-900 border-red-700 text-red-200',
    warning: 'bg-yellow-900 border-yellow-700 text-yellow-200',
    info:    'bg-blue-900 border-blue-700 text-blue-200',
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border text-sm font-medium shadow-xl pointer-events-auto transition-all ${colorMap[t.kind]}`}
          style={{ minWidth: 240, maxWidth: 400 }}
        >
          <span>{t.message}</span>
          <button
            className="opacity-60 hover:opacity-100 text-xs"
            onClick={() => removeToast(t.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
