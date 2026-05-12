import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  wrapperClass?: string
}

export function Input({ label, error, wrapperClass = '', className = '', ...props }: InputProps) {
  return (
    <div className={`flex flex-col gap-1 ${wrapperClass}`}>
      {label && <label className="text-xs font-medium text-zinc-400">{label}</label>}
      <input
        className={`bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors ${error ? 'border-red-600' : ''} ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: Array<{ value: string | number; label: string }>
  wrapperClass?: string
}

export function Select({ label, options, wrapperClass = '', className = '', ...props }: SelectProps) {
  return (
    <div className={`flex flex-col gap-1 ${wrapperClass}`}>
      {label && <label className="text-xs font-medium text-zinc-400">{label}</label>}
      <select
        className={`bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500 transition-colors ${className}`}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  wrapperClass?: string
}

export function Textarea({ label, wrapperClass = '', className = '', ...props }: TextareaProps) {
  return (
    <div className={`flex flex-col gap-1 ${wrapperClass}`}>
      {label && <label className="text-xs font-medium text-zinc-400">{label}</label>}
      <textarea
        className={`bg-surface border border-surface-border rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors font-mono resize-y ${className}`}
        {...props}
      />
    </div>
  )
}

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  description?: string
}

export function Toggle({ label, checked, onChange, description }: ToggleProps) {
  return (
    <div className="flex items-start gap-3">
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none mt-0.5 ${checked ? 'bg-brand-500' : 'bg-zinc-700'}`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
      <div>
        <div className="text-sm font-medium text-zinc-200">{label}</div>
        {description && <div className="text-xs text-zinc-500 mt-0.5">{description}</div>}
      </div>
    </div>
  )
}
