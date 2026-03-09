import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from '../lib/cn'

const badgeVariants = cva('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold', {
  variants: {
    variant: {
      neutral: 'border-border bg-surface-soft text-muted',
      success: 'border-success/30 bg-success/10 text-success-dark',
      warning: 'border-warning/30 bg-warning/10 text-warning-dark',
      error: 'border-error/30 bg-error/10 text-error-dark',
      info: 'border-info/30 bg-info/10 text-info-dark',
    },
  },
  defaultVariants: {
    variant: 'neutral',
  },
})

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
