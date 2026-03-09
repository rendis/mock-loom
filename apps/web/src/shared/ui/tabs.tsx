import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'

import { cn } from '../lib/cn'

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('inline-flex rounded-xl border border-border bg-surface-soft p-1', className)} {...props} />
}

interface TabTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function TabTrigger({ className, active, ...props }: TabTriggerProps): JSX.Element {
  return (
    <button
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        active ? 'bg-surface-raised text-text shadow-card' : 'hover:bg-surface-raised/60',
        className
      )}
      type="button"
      {...props}
    />
  )
}
