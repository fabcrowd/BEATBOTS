import React from 'react'

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
}

const variants = {
  primary:   'bg-brand-600 hover:bg-brand-500 text-white border border-brand-700',
  secondary: 'bg-surface-raised hover:bg-surface-border text-zinc-200 border border-surface-border',
  danger:    'bg-red-800 hover:bg-red-700 text-white border border-red-700',
  ghost:     'bg-transparent hover:bg-surface-border text-zinc-400 hover:text-zinc-100',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

export default function Button({ variant = 'secondary', size = 'md', className = '', children, ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50 disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
