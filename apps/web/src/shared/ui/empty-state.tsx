import type { ReactNode } from 'react'

import { Button } from './button'
import { Card, CardContent } from './card'

interface EmptyStateProps {
  title: string
  description: string
  ctaLabel?: string
  onCta?: () => void
  icon?: ReactNode
}

export function EmptyState({ title, description, ctaLabel, onCta, icon }: EmptyStateProps): JSX.Element {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 py-8">
        {icon}
        <h3 className="text-lg font-semibold text-text">{title}</h3>
        <p className="max-w-xl text-sm text-muted">{description}</p>
        {ctaLabel && onCta ? (
          <Button className="mt-1" onClick={onCta} type="button">
            {ctaLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
