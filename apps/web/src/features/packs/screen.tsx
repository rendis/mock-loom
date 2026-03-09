import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Pencil } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

import { packRoute } from '../../app/routes/paths'
import { useSessionStore } from '../../app/state/use-session-store'
import { createIntegrationPack, formatAPIError, getIntegrationPacks, updateIntegrationPack } from '../../lib/api'
import type { AuthMockPolicyMode, IntegrationPack } from '../../types/api'
import { serializePathTemplate, tokenizePathTemplate, validatePathTemplate } from '../endpoint-editor/path-template'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { EmptyState } from '../../shared/ui/empty-state'
import { IconActionButton } from '../../shared/ui/icon-action-button'
import { applyPackFormPatch, normalizePackSlug } from './form'
import { PackModal, type PackFormValues, type PackModalMode } from './pack-modal'

type ViewState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export function PacksScreen(): JSX.Element {
  const navigate = useNavigate()
  const { integrationId = '' } = useParams()
  const token = useSessionStore((state) => state.token)
  const selectIntegration = useSessionStore((state) => state.selectIntegration)

  const [viewState, setViewState] = useState<ViewState>('idle')
  const [packs, setPacks] = useState<IntegrationPack[]>([])
  const [error, setError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<PackModalMode>('create')
  const [editingPackID, setEditingPackID] = useState('')
  const [modalValues, setModalValues] = useState<PackFormValues>(emptyPackForm())
  const [modalSubmitting, setModalSubmitting] = useState(false)
  const [modalError, setModalError] = useState('')

  useEffect(() => {
    if (integrationId !== '') {
      selectIntegration(integrationId)
    }
  }, [integrationId, selectIntegration])

  async function load(): Promise<void> {
    if (!token || integrationId === '') {
      setViewState('empty')
      setPacks([])
      return
    }
    setViewState('loading')
    setError('')
    try {
      const items = await getIntegrationPacks(token, integrationId)
      setPacks(items)
      setViewState(items.length === 0 ? 'empty' : 'ready')
    } catch (loadError) {
      setError(formatAPIError(loadError))
      setViewState('error')
    }
  }

  useEffect(() => {
    void load()
  }, [token, integrationId])

  const editingPack = useMemo(() => packs.find((item) => item.id === editingPackID) ?? null, [packs, editingPackID])

  function openCreateModal(): void {
    setModalMode('create')
    setEditingPackID('')
    setModalValues(emptyPackForm())
    setModalError('')
    setModalOpen(true)
  }

  function openEditModal(pack: IntegrationPack): void {
    setModalMode('edit')
    setEditingPackID(pack.id)
    setModalValues(fromPack(pack))
    setModalError('')
    setModalOpen(true)
  }

  function closeModal(): void {
    if (modalSubmitting) {
      return
    }
    setModalOpen(false)
    setModalError('')
    setModalValues(emptyPackForm())
    setEditingPackID('')
    setModalMode('create')
  }

  async function submitPackModal(): Promise<void> {
    if (!token || integrationId === '' || modalSubmitting) {
      return
    }

    const nextName = modalValues.name.trim()
    const nextSlug = normalizePackSlug(modalValues.slug)
    const nextBasePath = normalizeBasePath(modalValues.basePath)
    const nextStatus = modalValues.status.trim().toUpperCase()
    const customExpr = modalValues.customExpr.trim()

    if (nextName === '' || nextSlug === '' || nextBasePath === '') {
      setModalError('Pack name, slug, and base path are required.')
      return
    }
    if (nextStatus === '') {
      setModalError('Pack status is required.')
      return
    }
    const basePathIssues = validatePathTemplate(nextBasePath)
    if (basePathIssues.length > 0) {
      setModalError(basePathIssues.join(' '))
      return
    }
    if (modalValues.authEnabled && modalValues.authMode === 'CUSTOM_EXPR' && customExpr === '') {
      setModalError('Custom auth mode requires an expression.')
      return
    }

    try {
      setModalSubmitting(true)
      setModalError('')

      if (modalMode === 'create') {
        const created = await createIntegrationPack(token, integrationId, {
          name: nextName,
          slug: nextSlug,
          basePath: nextBasePath,
        })

        const needsFollowUpPatch =
          nextStatus !== 'ACTIVE' ||
          modalValues.authEnabled ||
          modalValues.authMode !== 'PREBUILT' ||
          customExpr !== ''

        if (needsFollowUpPatch) {
          await updateIntegrationPack(token, integrationId, created.id, {
            status: nextStatus,
            authEnabled: modalValues.authEnabled,
            authPolicy: {
              mode: modalValues.authMode,
              prebuilt: defaultPrebuiltAuthPolicy(),
              customExpr: modalValues.authMode === 'CUSTOM_EXPR' ? customExpr : undefined,
            },
          })
        }

        await load()
        closeModal()
        navigate(packRoute(integrationId, created.id))
        return
      }

      if (!editingPack) {
        setModalError('Pack to edit was not found. Refresh and retry.')
        return
      }

      await updateIntegrationPack(token, integrationId, editingPack.id, {
        name: nextName,
        slug: nextSlug,
        basePath: nextBasePath,
        status: nextStatus,
        authEnabled: modalValues.authEnabled,
        authPolicy: {
          mode: modalValues.authMode,
          prebuilt: defaultPrebuiltAuthPolicy(),
          customExpr: modalValues.authMode === 'CUSTOM_EXPR' ? customExpr : undefined,
        },
      })

      await load()
      closeModal()
      selectIntegration(integrationId)
    } catch (submitError) {
      setModalError(formatAPIError(submitError))
    } finally {
      setModalSubmitting(false)
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-text">Packs</h1>
          <p className="mt-2 text-base text-muted">Group routes by pack, configure base auth, then edit each endpoint in the pack workspace.</p>
        </div>
        <Button variant="secondary" onClick={openCreateModal}>
          + New Pack
        </Button>
      </header>

      {error !== '' ? <Alert tone="error">{error}</Alert> : null}

      {viewState === 'loading' ? <p className="text-sm text-muted">Loading packs...</p> : null}
      {viewState === 'empty' ? (
        <EmptyState title="No packs in this integration" description="Create a pack to start grouping and editing endpoints." />
      ) : null}
      {viewState === 'ready' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {packs.map((pack) => (
            <article key={pack.id} className="rounded-2xl border border-border bg-surface-raised p-5 shadow-card">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-text">{pack.name}</p>
                  <p className="truncate text-xs text-muted">{pack.slug}</p>
                </div>
                <Badge variant={pack.status === 'ACTIVE' ? 'success' : 'warning'}>{pack.status}</Badge>
              </div>

              <div className="space-y-1 text-sm">
                <p className="text-muted">
                  Routes: <span className="font-semibold text-text">{pack.routeCount}</span>
                </p>
                <p className="text-muted">
                  Base path: <span className="font-semibold font-mono text-text">{pack.basePath}</span>
                </p>
                <p className="text-muted">
                  Auth: <span className="font-semibold text-text">{pack.auth.enabled ? `Enabled (${pack.auth.type})` : 'Disabled'}</span>
                </p>
                <p className="text-muted">
                  Updated: <span className="font-semibold text-text">{pack.updatedAt || '-'}</span>
                </p>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <IconActionButton
                  label="Edit pack"
                  icon={<Pencil className="h-4 w-4" aria-hidden />}
                  onClick={(event) => {
                    event.stopPropagation()
                    openEditModal(pack)
                  }}
                />
                <IconActionButton
                  label="Open pack"
                  icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!integrationId || !pack.id) return
                    navigate(packRoute(integrationId, pack.id))
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <PackModal
        mode={modalMode}
        isOpen={modalOpen}
        submitting={modalSubmitting}
        error={modalError}
        values={modalValues}
        onClose={closeModal}
        onSubmit={() => void submitPackModal()}
        onChange={(patch) => setModalValues((current) => applyPackFormPatch(current, patch, modalMode))}
      />
    </section>
  )
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    return ''
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const canonicalTemplate = serializePathTemplate(tokenizePathTemplate(withLeadingSlash))
  if (canonicalTemplate === '' || canonicalTemplate === '/') {
    return '/'
  }
  return canonicalTemplate.replace(/\/+$/, '') || '/'
}

function emptyPackForm(): PackFormValues {
  return {
    name: '',
    slug: '',
    basePath: '/',
    status: 'ACTIVE',
    authEnabled: false,
    authMode: 'PREBUILT',
    customExpr: '',
  }
}

function fromPack(pack: IntegrationPack): PackFormValues {
  const policy = pack.authPolicy
  const resolvedAuthMode = policy?.mode ?? (pack.auth.type === 'CUSTOM_EXPR' ? 'CUSTOM_EXPR' : 'PREBUILT')
  return {
    name: pack.name,
    slug: pack.slug,
    basePath: pack.basePath,
    status: pack.status,
    authEnabled: pack.auth.enabled,
    authMode: resolvedAuthMode,
    customExpr: policy?.customExpr ?? '',
  }
}

function defaultPrebuiltAuthPolicy(): {
  denyAll: boolean
  tokenEquals?: string
  emailEquals?: string
  emailContains?: string
  emailInList?: string[]
  requiredHeaders?: Array<{ name: string; operator: 'EXISTS' | 'EQUALS' | 'CONTAINS'; value?: string }>
  oidc?: { issuer?: string; jwksUrl?: string; audience?: string; emailClaim?: string }
} {
  return {
    denyAll: false,
    emailInList: [],
    requiredHeaders: [],
  }
}
