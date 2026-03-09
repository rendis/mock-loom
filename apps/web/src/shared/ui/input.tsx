import type { InputHTMLAttributes } from 'react'

import { cn } from '../lib/cn'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-xl border border-border/90 bg-surface-inset px-3 text-sm text-text placeholder:text-muted shadow-inset transition-all focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-focus/25',
        className
      )}
      {...props}
    />
  )
}
