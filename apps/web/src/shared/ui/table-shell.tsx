import type { HTMLAttributes } from 'react'

import { cn } from '../lib/cn'

export function TableShell({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('overflow-hidden rounded-2xl border border-border', className)} {...props} />
}

export function TableHeaderRow({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('grid grid-cols-4 gap-3 border-b border-border bg-surface-soft px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted', className)}
      {...props}
    />
  )
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('grid grid-cols-4 gap-3 border-b border-border/70 px-4 py-3 text-sm text-text last:border-b-0', className)} {...props} />
}
