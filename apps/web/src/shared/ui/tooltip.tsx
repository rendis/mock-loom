import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../lib/cn'

type TooltipSide = 'top' | 'bottom'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: TooltipSide
  className?: string
  contentClassName?: string
}

export function Tooltip({ content, children, side = 'top', className, contentClassName }: TooltipProps): JSX.Element {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const updatePosition = useCallback((): void => {
    const anchor = anchorRef.current
    if (!anchor) {
      return
    }
    const rect = anchor.getBoundingClientRect()
    const gap = 8
    const top = side === 'top' ? rect.top - gap : rect.bottom + gap
    setPosition({
      left: rect.left + rect.width / 2,
      top,
    })
  }, [side])

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  const handleOpen = (): void => {
    updatePosition()
    setOpen(true)
  }

  const handleClose = (): void => {
    setOpen(false)
    setPosition(null)
  }

  const tooltipNode =
    typeof document !== 'undefined' && open && position
      ? createPortal(
          <span
            role="tooltip"
            className={cn(
              'pointer-events-none fixed z-[220] w-max max-w-[240px] rounded-md border border-border/80 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-100 shadow-lg transition-all',
              side === 'top' ? '-translate-x-1/2 -translate-y-full' : '-translate-x-1/2',
              'scale-100 opacity-100',
              contentClassName
            )}
            style={{ left: `${position.left}px`, top: `${position.top}px` }}
          >
            {content}
          </span>,
          document.body
        )
      : null

  return (
    <span
      ref={anchorRef}
      className={cn('inline-flex', className)}
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      onFocusCapture={handleOpen}
      onBlurCapture={handleClose}
    >
      {children}
      {tooltipNode}
    </span>
  )
}
