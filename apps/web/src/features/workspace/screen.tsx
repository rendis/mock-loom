import { useMemo, useState } from 'react'
import { Plus, RefreshCw, Settings2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { APP_ROUTES, overviewRoute } from '../../app/routes/paths'
import { useSessionStore } from '../../app/state/use-session-store'
import { cn } from '../../shared/lib/cn'
import { parseBundleAQAState } from '../../shared/lib/qa-state'
import { finalizeSlugInput, formatSlugInput } from '../../shared/lib/slug'
import type { SystemRole } from '../../types/api'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { Input } from '../../shared/ui/input'
import { Tooltip } from '../../shared/ui/tooltip'
import { deriveWorkspaceViewState } from './state'

interface IntegrationDraft {
  name: string
  slug: string
}

interface IconActionButtonProps {
  label: string
  disabled?: boolean
  onClick: () => void
  icon: JSX.Element
}

function IconActionButton({ label, disabled, onClick, icon }: IconActionButtonProps): JSX.Element {
  return (
    <Tooltip content={label}>
      <Button
        variant="secondary"
        size="sm"
        className="h-11 w-11 p-0"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        type="button"
      >
        {icon}
      </Button>
    </Tooltip>
  )
}

const QA_PREVIEW_INTEGRATIONS = [
  {
    id: 'qa-github',
    name: 'Github',
    slug: '@mockengine-io',
    baseUrl: 'https://api.github.com/v3',
    status: 'ACTIVE',
  },
  {
    id: 'qa-postman',
    name: 'Postman',
    slug: 'team-alpha-sync',
    baseUrl: 'https://api.getpostman.com',
    status: 'ACTIVE',
  },
  {
    id: 'qa-slack',
    name: 'Slack',
    slug: '#dev-alerts',
    baseUrl: 'https://hooks.slack.com',
    status: 'SYNCING',
  },
]

export function WorkspaceScreen(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()

  const [integrationDraft, setIntegrationDraft] = useState<IntegrationDraft>({ name: '', slug: '' })
  const [showCreateIntegrationForm, setShowCreateIntegrationForm] = useState(false)
  const [integrationSearch, setIntegrationSearch] = useState('')

  const {
    token,
    me,
    workspaceState,
    selectedWorkspaceId,
    membersState,
    integrations,
    integrationsState,
    creatingIntegration,
    error,
    createWorkspaceIntegration,
    refreshWorkspaces,
    selectIntegration,
  } = useSessionStore(
    useShallow((state) => ({
      token: state.token,
      me: state.me,
      workspaceState: state.workspaceState,
      selectedWorkspaceId: state.selectedWorkspaceId,
      membersState: state.membersState,
      integrations: state.integrations,
      integrationsState: state.integrationsState,
      creatingIntegration: state.creatingIntegration,
      error: state.error,
      createWorkspaceIntegration: state.createWorkspaceIntegration,
      refreshWorkspaces: state.refreshWorkspaces,
      selectIntegration: state.selectIntegration,
    }))
  )
  const qaState = useMemo(() => parseBundleAQAState(location.search), [location.search])

  const viewState = deriveWorkspaceViewState({
    token,
    workspaceState,
    selectedWorkspaceId,
    integrationsState,
    membersState,
    error,
    qaState,
  })
  const canCreateWorkspace = hasWorkspaceCreatePermission(me?.systemRole)

  const filteredIntegrations = useMemo(() => {
    const query = integrationSearch.trim().toLowerCase()
    if (query === '') {
      return integrations
    }
    return integrations.filter((integration) =>
      [integration.name, integration.slug, integration.baseUrl].some((value) => value.toLowerCase().includes(query))
    )
  }, [integrationSearch, integrations])

  const presentationIntegrations = useMemo(() => {
    if (qaState === 'ready' && filteredIntegrations.length === 0) {
      return QA_PREVIEW_INTEGRATIONS
    }
    return filteredIntegrations
  }, [qaState, filteredIntegrations])

  async function handleCreateIntegration(): Promise<void> {
    await createWorkspaceIntegration(integrationDraft)
    setIntegrationDraft({ name: '', slug: '' })
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-surface-base text-text">
      <div
        className={cn(
          'flex min-h-0 flex-1 w-full flex-col gap-8 px-5 py-6 md:px-8 md:py-8',
          viewState === 'access-error' ? 'select-none blur-[2px] opacity-55' : ''
        )}
      >
        {viewState === 'empty' ? (
          <EmptyWorkspaceLayout
            token={token}
            showCreateIntegrationForm={showCreateIntegrationForm}
            setShowCreateIntegrationForm={setShowCreateIntegrationForm}
            integrationDraft={integrationDraft}
            setIntegrationDraft={setIntegrationDraft}
            onCreateIntegration={handleCreateIntegration}
            creatingIntegration={creatingIntegration}
            onOpenAdmin={() => navigate(APP_ROUTES.workspaceAdmin)}
          />
        ) : viewState === 'no-workspace' ? (
          <NoWorkspaceLayout
            canCreateWorkspace={canCreateWorkspace}
            refreshingWorkspaces={workspaceState === 'loading'}
            onCreateWorkspace={() => navigate(APP_ROUTES.globalWorkspaceAdmin)}
            onRefreshWorkspaces={() => void refreshWorkspaces()}
          />
        ) : (
          <ReadyWorkspaceLayout
            token={token}
            integrations={presentationIntegrations}
            integrationSearch={integrationSearch}
            setIntegrationSearch={setIntegrationSearch}
            showCreateIntegrationForm={showCreateIntegrationForm}
            setShowCreateIntegrationForm={setShowCreateIntegrationForm}
            integrationDraft={integrationDraft}
            setIntegrationDraft={setIntegrationDraft}
            onCreateIntegration={handleCreateIntegration}
            creatingIntegration={creatingIntegration}
            onOpenAdmin={() => navigate(APP_ROUTES.workspaceAdmin)}
            onOpenIntegration={(integrationId: string) => {
              selectIntegration(integrationId)
              navigate(overviewRoute(integrationId))
            }}
          />
        )}

        {error ? <Alert tone="error">{error}</Alert> : null}
        <FooterStrip />
      </div>

      {viewState === 'access-error' ? (
        <AccessDeniedOverlay onBack={() => navigate('/workspace')} onSwitchWorkspace={() => navigate('/workspace')} />
      ) : null}
    </div>
  )
}

function hasWorkspaceCreatePermission(systemRole?: SystemRole): boolean {
  return systemRole === 'SUPERADMIN' || systemRole === 'PLATFORM_ADMIN'
}

interface ReadyWorkspaceLayoutProps {
  token: string | null
  integrations: Array<{ id: string; name: string; slug: string; baseUrl: string; status: string }>
  integrationSearch: string
  setIntegrationSearch: (value: string) => void
  showCreateIntegrationForm: boolean
  setShowCreateIntegrationForm: (value: boolean) => void
  integrationDraft: IntegrationDraft
  setIntegrationDraft: (draft: IntegrationDraft) => void
  onCreateIntegration: () => Promise<void>
  creatingIntegration: boolean
  onOpenAdmin: () => void
  onOpenIntegration: (integrationId: string) => void
}

function ReadyWorkspaceLayout({
  token,
  integrations,
  integrationSearch,
  setIntegrationSearch,
  showCreateIntegrationForm,
  setShowCreateIntegrationForm,
  integrationDraft,
  setIntegrationDraft,
  onCreateIntegration,
  creatingIntegration,
  onOpenAdmin,
  onOpenIntegration,
}: ReadyWorkspaceLayoutProps): JSX.Element {
  return (
    <section className="grid flex-1 grid-cols-1 gap-6">
      <Card className="flex min-h-0 flex-1 flex-col overflow-visible">
        <CardHeader className="border-b border-border px-6 py-5">
          <div>
            <CardTitle className="text-4xl">Integrations</CardTitle>
            <p className="text-lg text-muted">Manage connected services for this workspace.</p>
          </div>
          <div className="flex items-center gap-2">
            <IconActionButton
              label={showCreateIntegrationForm ? 'Hide integration form' : 'Create integration'}
              onClick={() => setShowCreateIntegrationForm(!showCreateIntegrationForm)}
              disabled={!token}
              icon={<Plus className="h-4 w-4" aria-hidden />}
            />
            <IconActionButton
              label="Workspace admin"
              onClick={onOpenAdmin}
              icon={<Settings2 className="h-4 w-4" aria-hidden />}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-6 p-6">
          {showCreateIntegrationForm ? (
            <div className="grid gap-3 rounded-2xl border border-border bg-surface-soft p-4 md:grid-cols-3">
              <Input
                placeholder="Name"
                value={integrationDraft.name}
                onChange={(event) => setIntegrationDraft({ ...integrationDraft, name: event.target.value })}
              />
              <Input
                placeholder="Slug"
                value={integrationDraft.slug}
                onChange={(event) => setIntegrationDraft({ ...integrationDraft, slug: formatSlugInput(event.target.value) })}
                onBlur={(event) => setIntegrationDraft({ ...integrationDraft, slug: finalizeSlugInput(event.target.value) })}
              />
              <Button onClick={() => void onCreateIntegration()} disabled={creatingIntegration}>
                {creatingIntegration ? 'Creating...' : 'Create Integration'}
              </Button>
            </div>
          ) : null}

          <Input
            className="h-12"
            placeholder="Search integrations..."
            value={integrationSearch}
            onChange={(event) => setIntegrationSearch(event.target.value)}
          />

          {integrations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface-soft px-6 py-10 text-center">
              <p className="text-lg font-medium text-text">No integrations available in this view.</p>
              <p className="mt-2 text-sm text-muted">Use the empty variant or create a new integration.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {integrations.map((integration) => (
                <button
                  key={integration.id}
                  className="group rounded-2xl border border-border bg-surface-raised p-5 text-left shadow-card transition-transform hover:-translate-y-0.5"
                  onClick={() => onOpenIntegration(integration.id)}
                  type="button"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="h-10 w-1 rounded-full bg-primary/70 transition-colors group-hover:bg-primary" />
                    <Badge variant={integration.status === 'ACTIVE' ? 'success' : 'warning'}>{integration.status}</Badge>
                  </div>
                  <h3 className="text-3xl font-semibold text-text">{integration.name}</h3>
                  <p className="mt-2 text-sm font-mono text-muted">{integration.slug}</p>
                  <p className="mt-5 truncate rounded-xl bg-surface-soft px-3 py-2 text-sm text-muted">{integration.baseUrl}</p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

interface NoWorkspaceLayoutProps {
  canCreateWorkspace: boolean
  refreshingWorkspaces: boolean
  onCreateWorkspace: () => void
  onRefreshWorkspaces: () => void
}

function NoWorkspaceLayout({
  canCreateWorkspace,
  refreshingWorkspaces,
  onCreateWorkspace,
  onRefreshWorkspaces,
}: NoWorkspaceLayoutProps): JSX.Element {
  return (
    <section className="grid flex-1 grid-cols-1 gap-6">
      <Card className="flex min-h-[560px] flex-1 flex-col">
        <CardHeader className="px-6 py-5">
          <div>
            <CardTitle className="text-4xl">Workspace Home</CardTitle>
            <p className="text-lg text-muted">Select or create a workspace before managing integrations.</p>
          </div>
        </CardHeader>
        <CardContent className="flex h-full flex-col items-center justify-center px-6 pb-10 text-center">
          <div className="w-full max-w-[560px] rounded-3xl border border-border bg-surface-soft px-8 py-10">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface-raised text-2xl text-muted shadow-card">
              !
            </div>
            <h3 className="text-4xl font-semibold text-text">No Workspace Available</h3>
            <p className="mx-auto mt-4 max-w-[420px] text-lg leading-relaxed text-muted">
              You need a workspace context before creating or managing integrations.
            </p>
            {canCreateWorkspace ? (
              <div className="mt-8 flex items-center justify-center gap-8">
                <Button className="h-12 px-8 text-base" onClick={onCreateWorkspace}>
                  Create Workspace
                </Button>
                <IconActionButton
                  label={refreshingWorkspaces ? 'Refreshing workspaces' : 'Refresh workspaces'}
                  onClick={onRefreshWorkspaces}
                  disabled={refreshingWorkspaces}
                  icon={<RefreshCw className={cn('h-4 w-4', refreshingWorkspaces ? 'animate-spin' : '')} aria-hidden />}
                />
              </div>
            ) : (
              <>
                <p className="mx-auto mt-8 max-w-[420px] text-sm text-muted">
                  Ask an administrator to invite you to a workspace. Integration creation is available only after workspace access is granted.
                </p>
                <div className="mt-6 flex items-center justify-center">
                  <IconActionButton
                    label={refreshingWorkspaces ? 'Refreshing workspaces' : 'Refresh workspaces'}
                    onClick={onRefreshWorkspaces}
                    disabled={refreshingWorkspaces}
                    icon={<RefreshCw className={cn('h-4 w-4', refreshingWorkspaces ? 'animate-spin' : '')} aria-hidden />}
                  />
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

interface EmptyWorkspaceLayoutProps {
  token: string | null
  showCreateIntegrationForm: boolean
  setShowCreateIntegrationForm: (value: boolean) => void
  integrationDraft: IntegrationDraft
  setIntegrationDraft: (draft: IntegrationDraft) => void
  onCreateIntegration: () => Promise<void>
  creatingIntegration: boolean
  onOpenAdmin: () => void
}

function EmptyWorkspaceLayout({
  token,
  showCreateIntegrationForm,
  setShowCreateIntegrationForm,
  integrationDraft,
  setIntegrationDraft,
  onCreateIntegration,
  creatingIntegration,
  onOpenAdmin,
}: EmptyWorkspaceLayoutProps): JSX.Element {
  return (
    <section className="grid flex-1 grid-cols-1 gap-6">
      <Card className="flex min-h-[560px] flex-1 flex-col">
        <CardHeader className="px-6 py-5">
          <div>
            <CardTitle className="text-4xl">Integrations</CardTitle>
            <p className="text-lg text-muted">Manage external services connected to your mock engine.</p>
          </div>
          <div className="flex items-center gap-2">
            <IconActionButton
              label={showCreateIntegrationForm ? 'Hide integration form' : 'Create integration'}
              onClick={() => setShowCreateIntegrationForm(!showCreateIntegrationForm)}
              disabled={!token}
              icon={<Plus className="h-4 w-4" aria-hidden />}
            />
            <IconActionButton label="Workspace admin" onClick={onOpenAdmin} icon={<Settings2 className="h-4 w-4" aria-hidden />} />
          </div>
        </CardHeader>
        <CardContent className="flex h-full flex-col items-center justify-center px-6 pb-10 text-center">
          <div className="w-full max-w-[520px] rounded-3xl border border-border bg-surface-soft px-8 py-10">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface-raised text-2xl text-muted shadow-card">
              x
            </div>
            <h3 className="text-4xl font-semibold text-text">No Integrations Found</h3>
            <p className="mx-auto mt-4 max-w-[360px] text-lg leading-relaxed text-muted">
              Your workspace has not been connected to any external services yet. Add an integration to sync mock data automatically.
            </p>
            <Button className="mt-8 h-12 px-8 text-base" onClick={() => setShowCreateIntegrationForm(true)} disabled={!token}>
              Add Your First Integration
            </Button>

            {showCreateIntegrationForm ? (
              <div className="mt-6 grid gap-3 text-left">
                <Input
                  placeholder="Name"
                  value={integrationDraft.name}
                  onChange={(event) => setIntegrationDraft({ ...integrationDraft, name: event.target.value })}
                />
                <Input
                  placeholder="Slug"
                  value={integrationDraft.slug}
                  onChange={(event) => setIntegrationDraft({ ...integrationDraft, slug: formatSlugInput(event.target.value) })}
                  onBlur={(event) => setIntegrationDraft({ ...integrationDraft, slug: finalizeSlugInput(event.target.value) })}
                />
                <Button onClick={() => void onCreateIntegration()} disabled={creatingIntegration}>
                  {creatingIntegration ? 'Creating...' : 'Create Integration'}
                </Button>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

interface AccessDeniedOverlayProps {
  onBack: () => void
  onSwitchWorkspace: () => void
}

function AccessDeniedOverlay({ onBack, onSwitchWorkspace }: AccessDeniedOverlayProps): JSX.Element {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-900/20 p-4 backdrop-blur-sm">
      <Card className="max-h-[calc(100vh-2rem)] w-full max-w-[520px] overflow-y-auto">
        <CardContent className="space-y-6 p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-error/15 bg-error/10 text-2xl text-error">
            !
          </div>
          <div>
            <h2 className="text-5xl font-semibold text-text">Access Denied</h2>
            <p className="mx-auto mt-3 max-w-[360px] text-lg leading-relaxed text-muted">
              You do not have the required permissions to view workspace integrations. Please contact your administrator to request access.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface-soft p-3 text-left font-mono text-xs text-muted">
            Error: 403 Forbidden
            <br />
            Scope: read:workspace_integrations
          </div>
          <Button className="h-12 w-full text-base" onClick={onBack}>
            Go Back
          </Button>
          <button className="w-full text-sm font-medium text-muted hover:text-text" onClick={onSwitchWorkspace} type="button">
            Switch Workspace
          </button>
        </CardContent>
      </Card>
    </div>
  )
}

function FooterStrip(): JSX.Element {
  return (
    <footer className="mt-auto border-t border-border py-5 text-sm text-muted">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>© 2023 MockEngine System. All rights reserved.</p>
        <div className="flex items-center gap-6">
          <span>Documentation</span>
          <span>Status</span>
          <span>Support</span>
        </div>
      </div>
    </footer>
  )
}
