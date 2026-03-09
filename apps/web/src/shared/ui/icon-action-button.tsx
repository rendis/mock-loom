import type { ReactNode } from 'react'

import { cn } from '../lib/cn'
import { Button, type ButtonProps } from './button'
import { Tooltip } from './tooltip'

interface IconActionButtonProps extends Omit<ButtonProps, 'children' | 'aria-label'> {
  label: string
  icon: ReactNode
  disabledReason?: string
  destructive?: boolean
  active?: boolean
}

export function IconActionButton({
  label,
  icon,
  disabledReason,
  className,
  variant = 'secondary',
  size = 'sm',
  disabled,
  destructive = false,
  active = false,
  ...props
}: IconActionButtonProps): JSX.Element {
  const tooltipLabel = disabled ? (disabledReason ?? label) : label

  return (
    <Tooltip content={tooltipLabel}>
      <span>
        <Button
          variant={variant}
          size={size}
          className={cn(
            'h-9 w-9 rounded-xl p-0 shadow-neo-soft',
            destructive
              ? 'text-muted hover:text-error'
              : active
                ? 'border-primary/40 bg-primary/10 text-primary-dark'
                : 'text-muted hover:text-primary-dark',
            className
          )}
          aria-label={label}
          disabled={disabled}
          {...props}
        >
          {icon}
        </Button>
      </span>
    </Tooltip>
  )
}
