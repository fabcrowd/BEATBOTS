import React, { useEffect, useState } from 'react'

interface Props {
  dropExpectedAt: string | null
  className?: string
}

function formatCountdown(dropAt: string | null): { text: string; inWindow: boolean; passed: boolean } {
  if (!dropAt) return { text: '', inWindow: false, passed: false }
  const t = Date.parse(dropAt)
  if (!isFinite(t)) return { text: 'Invalid date', inWindow: false, passed: false }

  const now = Date.now()
  const until = t - now
  const afterDrop = now - t

  if (until < 0 && afterDrop <= 3 * 60 * 1000) {
    return { text: 'DROP WINDOW — FAST POLLING', inWindow: true, passed: false }
  }
  if (until < 0) {
    return { text: 'Drop passed', inWindow: false, passed: true }
  }

  const h = Math.floor(until / 3_600_000)
  const m = Math.floor((until % 3_600_000) / 60_000)
  const s = Math.floor((until % 60_000) / 1000)

  const timeStr = h > 0
    ? `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`
    : m > 0
      ? `${m}m ${s.toString().padStart(2, '0')}s`
      : `${s}s`

  const inWindow = until > 0 && until <= 10 * 60 * 1000
  return { text: timeStr, inWindow, passed: false }
}

export default function DropCountdown({ dropExpectedAt, className = '' }: Props) {
  const [state, setState] = useState(() => formatCountdown(dropExpectedAt))

  useEffect(() => {
    setState(formatCountdown(dropExpectedAt))
    if (!dropExpectedAt) return

    const interval = setInterval(() => {
      setState(formatCountdown(dropExpectedAt))
    }, 500)

    return () => clearInterval(interval)
  }, [dropExpectedAt])

  if (!dropExpectedAt || state.passed) return null

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span
        className={`w-2 h-2 rounded-full ${state.inWindow ? 'bg-green-400 pulse-dot' : 'bg-brand-500'}`}
      />
      <span className={`text-xs font-mono font-semibold ${
        state.inWindow ? 'text-green-400' : 'text-zinc-300'
      }`}>
        {state.inWindow ? state.text : `DROP: ${state.text}`}
      </span>
    </div>
  )
}
