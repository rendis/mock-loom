import type { HTMLAttributes } from 'react'

import { cn } from '../lib/cn'

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'success' | 'warning' | 'error' | 'info'
}

export function Alert({ className, tone = 'info', ...props }: AlertProps): JSX.Element {
  const toneClass = {
    success: 'border-success/30 bg-success/10 text-success-dark',
    warning: 'border-warning/30 bg-warning/10 text-warning-dark',
    error: 'border-error/30 bg-error/10 text-error-dark',
    info: 'border-info/30 bg-info/10 text-info-dark',
  }[tone]

  return <div className={cn('rounded-xl border px-4 py-3 text-sm', toneClass, className)} role="status" {...props} />
}
