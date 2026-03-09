import type { ReactNode } from 'react'

import { cn } from '../lib/cn'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  disabled?: boolean
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: SegmentedControlOption<T>[]
  onChange: (next: T) => void
  ariaLabel: string
  className?: string
  disabled?: boolean
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled = false,
}: SegmentedControlProps<T>): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-grid h-10 w-full grid-flow-col auto-cols-fr gap-1 rounded-xl border border-border/90 bg-surface-inset p-1 shadow-inset',
        className
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value
        const optionDisabled = disabled || Boolean(option.disabled)
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={option.label}
            disabled={optionDisabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1 rounded-lg border text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30',
              isActive
                ? 'border-border/70 bg-surface-raised text-text shadow-neo-soft'
                : 'border-transparent bg-transparent text-muted hover:text-text',
              optionDisabled ? 'cursor-not-allowed opacity-55' : ''
            )}
          >
            {option.icon ? <span className="inline-flex h-3.5 w-3.5 items-center justify-center">{option.icon}</span> : null}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
