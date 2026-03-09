import type { TextareaHTMLAttributes } from 'react'

import { cn } from '../lib/cn'

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return (
    <textarea
      className={cn(
        'min-h-28 w-full rounded-xl border border-border/90 bg-surface-inset px-3 py-2 text-sm text-text placeholder:text-muted shadow-inset transition-all focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-focus/25',
        className
      )}
      {...props}
    />
  )
}
