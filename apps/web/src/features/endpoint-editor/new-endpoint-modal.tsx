import { useEffect, useId } from 'react'
import { X } from 'lucide-react'

import { Alert } from '../../shared/ui/alert'
import { Button } from '../../shared/ui/button'
import { IconActionButton } from '../../shared/ui/icon-action-button'
import { Select } from '../../shared/ui/select'
import { Textarea } from '../../shared/ui/textarea'
import { PathTemplateInput } from './path-template-input'

export type EndpointMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface NewEndpointModalProps {
  basePath: string
  error: string
  finalPathPreview: string
  isOpen: boolean
  method: EndpointMethod
  relativePath: string
  requestBodyExample: string
  submitting: boolean
  onClose: () => void
  onMethodChange: (value: EndpointMethod) => void
  onRelativePathChange: (value: string) => void
  onRequestBodyExampleChange: (value: string) => void
  onSubmit: () => void
}

const METHOD_OPTIONS: EndpointMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export function NewEndpointModal({
  basePath,
  error,
  finalPathPreview,
  isOpen,
  method,
  relativePath,
  requestBodyExample,
  submitting,
  onClose,
  onMethodChange,
  onRelativePathChange,
  onRequestBodyExampleChange,
  onSubmit,
}: NewEndpointModalProps): JSX.Element | null {
  const titleID = useId()
  const descriptionID = useId()

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || submitting) {
        return
      }
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose, submitting])

  if (!isOpen) {
    return null
  }

  const canSubmit = !submitting
  const supportsBodyExample = method === 'POST' || method === 'PUT' || method === 'PATCH'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target !== event.currentTarget || submitting) {
          return
        }
        onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
        aria-describedby={descriptionID}
        className="w-full max-w-[560px] rounded-2xl border border-border bg-surface-raised p-5 shadow-card"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleID} className="text-xl font-semibold text-text">
              New Endpoint
            </h2>
            <p id={descriptionID} className="mt-1 text-sm text-muted">
              Base path is fixed by pack configuration. Add method and relative path.
            </p>
          </div>
          <IconActionButton
            label="Close new endpoint modal"
            icon={<X className="h-4 w-4" aria-hidden />}
            onClick={onClose}
            disabled={submitting}
            disabledReason="Wait for endpoint creation to finish."
          />
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) {
              return
            }
            onSubmit()
          }}
        >
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Method</p>
            <Select value={method} onChange={(event) => onMethodChange(event.target.value as EndpointMethod)} aria-label="Endpoint method">
              {METHOD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Path</p>
            <div className="flex items-stretch overflow-hidden rounded-xl border border-border/90 bg-surface-inset shadow-inset">
              <span
                className="inline-flex min-h-10 items-center self-stretch border-r border-border px-3 text-sm font-mono font-semibold text-primary-dark"
                aria-label="Pack base path prefix"
              >
                {basePath}
              </span>
              <PathTemplateInput
                value={relativePath}
                onChange={onRelativePathChange}
                placeholder="/resource/:id"
                ariaLabel="Endpoint relative path"
                autoFocus
                disabled={submitting}
                className="min-h-10 flex-1 rounded-none border-0 bg-transparent shadow-none focus-within:border-0 focus-within:ring-0"
              />
            </div>
            <p className="text-xs text-muted">
              Final path: <span className="font-mono text-text">{finalPathPreview}</span>
            </p>
          </div>

          {supportsBodyExample ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Request Body Example (JSON)</p>
              <Textarea
                value={requestBodyExample}
                onChange={(event) => onRequestBodyExampleChange(event.target.value)}
                placeholder={'{\n  "id": "ord_1",\n  "amount": 1200,\n  "metadata": {\n    "source": "web"\n  }\n}'}
                aria-label="Request body example JSON"
                disabled={submitting}
                className="min-h-36 font-mono text-xs"
              />
              <p className="text-xs text-muted">Optional. If provided, schema and body autocomplete are inferred from this JSON.</p>
            </div>
          ) : null}

          {error !== '' ? <Alert tone="error">{error}</Alert> : null}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? 'Creating...' : 'Create Endpoint'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
