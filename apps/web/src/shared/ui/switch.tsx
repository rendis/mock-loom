import * as RadixSwitch from '@radix-ui/react-switch'
import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '../lib/cn'

export interface SwitchProps extends ComponentPropsWithoutRef<typeof RadixSwitch.Root> {}

export function Switch({ className, ...props }: SwitchProps): JSX.Element {
  return (
    <RadixSwitch.Root
      className={cn(
        'group relative inline-flex h-10 w-[76px] items-center rounded-xl border border-border/90 bg-surface-inset p-1 shadow-inset outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus/30 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55',
        className
      )}
      {...props}
    >
      <RadixSwitch.Thumb
        className={cn(
          'pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-6px)] rounded-lg border border-border/70 bg-surface-raised shadow-neo-soft transition-transform duration-200 will-change-transform data-[state=checked]:translate-x-[calc(100%+4px)]'
        )}
      />
      <span className="relative z-10 inline-flex w-1/2 items-center justify-center text-[11px] font-semibold text-muted transition-colors group-data-[state=unchecked]:text-text">
        Off
      </span>
      <span className="relative z-10 inline-flex w-1/2 items-center justify-center text-[11px] font-semibold text-muted transition-colors group-data-[state=checked]:text-text">
        On
      </span>
    </RadixSwitch.Root>
  )
}
