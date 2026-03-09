import { useEffect, useId } from 'react'
import { X } from 'lucide-react'

import { PathTemplateInput } from '../endpoint-editor/path-template-input'
import type { AuthMockPolicyMode } from '../../types/api'
import { Alert } from '../../shared/ui/alert'
import { Button } from '../../shared/ui/button'
import { IconActionButton } from '../../shared/ui/icon-action-button'
import { Input } from '../../shared/ui/input'
import { SegmentedControl } from '../../shared/ui/segmented-control'
import { Switch } from '../../shared/ui/switch'

export type PackModalMode = 'create' | 'edit'

export interface PackFormValues {
  name: string
  slug: string
  basePath: string
  status: string
  authEnabled: boolean
  authMode: AuthMockPolicyMode
  customExpr: string
}

interface PackModalProps {
  mode: PackModalMode
  isOpen: boolean
  submitting: boolean
  error: string
  values: PackFormValues
  onClose: () => void
  onSubmit: () => void
  onChange: (patch: Partial<PackFormValues>) => void
}

export function PackModal({ mode, isOpen, submitting, error, values, onClose, onSubmit, onChange }: PackModalProps): JSX.Element | null {
  const titleID = useId()
  const descriptionID = useId()
  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !submitting) {
        onClose()
      }
      if (event.key === 'Enter' && !submitting) {
        const target = event.target
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
          return
        }
        if (target instanceof HTMLElement && (target.isContentEditable || target.closest('[role="listbox"], [role="combobox"]'))) {
          return
        }
        event.preventDefault()
        onSubmit()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onSubmit, submitting])

  if (!isOpen) {
    return null
  }

  const title = mode === 'create' ? 'New Pack' : 'Edit Pack'
  const submitLabel = mode === 'create' ? (submitting ? 'Creating...' : 'Create Pack') : submitting ? 'Saving...' : 'Save Pack'

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
        className="w-full max-w-[760px] rounded-2xl border border-border bg-surface-raised p-5 shadow-card"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleID} className="text-xl font-semibold text-text">
              {title}
            </h2>
            <p id={descriptionID} className="mt-1 text-sm text-muted">
              Configure base path, status, and pack-level auth defaults for endpoints.
            </p>
          </div>
          <IconActionButton
            label="Close modal"
            icon={<X className="h-4 w-4" aria-hidden />}
            onClick={onClose}
            disabled={submitting}
            disabledReason="Wait for the current save operation to finish."
          />
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (submitting) {
              return
            }
            onSubmit()
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Name</p>
              <Input
                aria-label="Pack name"
                placeholder="Core API Pack"
                value={values.name}
                onChange={(event) => onChange({ name: event.target.value })}
                disabled={submitting}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Slug</p>
              <Input
                aria-label="Pack slug"
                placeholder="core-api-pack"
                value={values.slug}
                onChange={(event) => onChange({ slug: event.target.value })}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Base Path</p>
            <PathTemplateInput
              value={values.basePath}
              onChange={(next) => onChange({ basePath: next })}
              placeholder="/api/:version"
              ariaLabel="Pack base path"
              disabled={submitting}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Status</p>
              <div className="flex items-center justify-between rounded-xl border border-border bg-surface-soft px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-text">{values.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'}</p>
                  <p className="text-xs text-muted">Control pack availability.</p>
                </div>
                <Switch
                  checked={values.status === 'ACTIVE'}
                  onCheckedChange={(checked) => onChange({ status: checked ? 'ACTIVE' : 'INACTIVE' })}
                  aria-label="Pack status"
                  disabled={submitting}
                />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Pack auth</p>
              <div className="flex items-center justify-between rounded-xl border border-border bg-surface-soft px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-text">{values.authEnabled ? 'Enabled' : 'Disabled'}</p>
                  <p className="text-xs text-muted">Apply auth policy at pack level.</p>
                </div>
                <Switch
                  checked={values.authEnabled}
                  onCheckedChange={(checked) => onChange({ authEnabled: checked })}
                  aria-label="Pack auth enabled"
                  disabled={submitting}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Auth mode</p>
              <SegmentedControl
                value={values.authMode}
                onChange={(next) => onChange({ authMode: next as AuthMockPolicyMode })}
                options={[
                  { value: 'PREBUILT', label: 'Prebuilt' },
                  { value: 'CUSTOM_EXPR', label: 'Custom Expr' },
                ]}
                ariaLabel="Pack auth mode"
                disabled={submitting || !values.authEnabled}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Custom expression</p>
              <Input
                aria-label="Pack custom auth expression"
                placeholder="auth.email == 'dev@example.com'"
                value={values.customExpr}
                onChange={(event) => onChange({ customExpr: event.target.value })}
                disabled={submitting || !values.authEnabled || values.authMode !== 'CUSTOM_EXPR'}
              />
            </div>
          </div>

          {error !== '' ? <Alert tone="error">{error}</Alert> : null}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
