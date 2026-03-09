import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Shield, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { useAuth } from '../../features/auth/auth-context'
import { useSessionStore } from '../state/use-session-store'
import {
  APP_ROUTES,
  auditHistoryRoute,
  dataDebuggerRoute,
  dataSourcesRoute,
  entityMapRoute,
  overviewRoute,
  packsRoute,
  sessionLogsRoute,
} from '../routes/paths'
import { Alert } from '../../shared/ui/alert'
import { Button } from '../../shared/ui/button'
import { IconActionButton } from '../../shared/ui/icon-action-button'
import { Input } from '../../shared/ui/input'
import { Tooltip } from '../../shared/ui/tooltip'
import { cn } from '../../shared/lib/cn'

interface AppShellProps {
  children?: ReactNode
}

const integrationTabs = [
  {
    id: 'overview',
    label: 'Overview',
    to: (integrationId: string) => overviewRoute(integrationId),
  },
  {
    id: 'packs',
    label: 'Packs',
    to: (integrationId: string) => packsRoute(integrationId),
  },
  {
    id: 'data-sources',
    label: 'Data Sources',
    to: (integrationId: string) => dataSourcesRoute(integrationId),
  },
  {
    id: 'debugger',
    label: 'Debugger',
    to: (integrationId: string) => dataDebuggerRoute(integrationId),
  },
  {
    id: 'session-logs',
    label: 'Session Logs',
    to: (integrationId: string) => sessionLogsRoute(integrationId),
  },
  {
    id: 'entity-map',
    label: 'Entity Map',
    to: (integrationId: string) => entityMapRoute(integrationId),
  },
  {
    id: 'audit-history',
    label: 'Audit',
    to: (integrationId: string) => auditHistoryRoute(integrationId),
  },
] as const

export function AppShell({ children }: AppShellProps): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false)
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const routeIntegrationId = useMemo(() => {
    const integrationRouteMatch = location.pathname.match(/^\/integrations\/([^/]+)/)
    return integrationRouteMatch?.[1] ? decodeURIComponent(integrationRouteMatch[1]) : ''
  }, [location.pathname])

  const { logout } = useAuth()

  const {
    me,
    workspaces,
    workspaceState,
    selectedWorkspaceId,
    integrations,
    integrationsState,
    selectedIntegrationId,
    selectWorkspace,
    selectIntegration,
  } = useSessionStore(
    useShallow((state) => ({
      me: state.me,
      workspaces: state.workspaces,
      workspaceState: state.workspaceState,
      selectedWorkspaceId: state.selectedWorkspaceId,
      integrations: state.integrations,
      integrationsState: state.integrationsState,
      selectedIntegrationId: state.selectedIntegrationId,
      selectWorkspace: state.selectWorkspace,
      selectIntegration: state.selectIntegration,
    }))
  )

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces]
  )
  const selectedIntegration = useMemo(
    () => integrations.find((integration) => integration.id === selectedIntegrationId) ?? null,
    [integrations, selectedIntegrationId]
  )

  const canAccessGlobalAdmin = me?.systemRole === 'SUPERADMIN' || me?.systemRole === 'PLATFORM_ADMIN'

  const filteredWorkspaces = useMemo(() => {
    const query = workspaceSearchQuery.trim().toLowerCase()
    if (query === '') {
      return workspaces
    }
    return workspaces.filter((workspace) =>
      [workspace.name, workspace.slug, workspace.id].some((value) => value.toLowerCase().includes(query))
    )
  }, [workspaceSearchQuery, workspaces])

  useEffect(() => {
    if (!userMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!userMenuRef.current) {
        return
      }
      if (event.target instanceof Node && userMenuRef.current.contains(event.target)) {
        return
      }
      setUserMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [userMenuOpen])

  useEffect(() => {
    if (routeIntegrationId === '') {
      return
    }
    if (routeIntegrationId !== selectedIntegrationId) {
      selectIntegration(routeIntegrationId)
    }
  }, [routeIntegrationId, selectedIntegrationId, selectIntegration])

  useEffect(() => {
    if (routeIntegrationId === '') {
      return
    }
    if (integrationsState === 'loading' || integrationsState === 'error') {
      return
    }
    if (integrations.some((integration) => integration.id === routeIntegrationId)) {
      return
    }
    navigate(APP_ROUTES.workspace, {
      replace: true,
      state: {
        contextError: 'Selected integration is not available in the current workspace.',
      },
    })
  }, [routeIntegrationId, integrations, integrationsState, navigate])

  const routeContextError =
    location.state && typeof location.state === 'object' && 'contextError' in location.state
      ? String(location.state.contextError || '')
      : ''

  function openWorkspaceModal(): void {
    setUserMenuOpen(false)
    setWorkspaceSearchQuery('')
    setWorkspaceModalOpen(true)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface-base text-text">
      <header className="sticky top-0 z-50 border-b border-border bg-surface-raised/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-card">
                <svg width="22" height="22" viewBox="6 4 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 12 L18 8 L26 12 L26 24 L18 28 L10 24 Z" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
                  <line x1="18" y1="8" x2="18" y2="28" stroke="#fff" strokeWidth="1" opacity="0.5"/>
                  <line x1="10" y1="12" x2="26" y2="24" stroke="#fff" strokeWidth="1" opacity="0.5"/>
                  <line x1="26" y1="12" x2="10" y2="24" stroke="#fff" strokeWidth="1" opacity="0.5"/>
                </svg>
              </div>
              <p className="text-xl font-semibold text-text">Mock Loom</p>
              <button
                className="ml-1 inline-flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface-soft px-3 py-2 text-left transition-colors hover:bg-surface-inset"
                onClick={openWorkspaceModal}
                disabled={workspaces.length === 0 && workspaceState !== 'loading'}
                type="button"
                aria-label="Open workspace switcher"
              >
                <span className="max-w-[260px] truncate text-sm font-medium text-text">
                  {selectedWorkspace?.name || (workspaceState === 'loading' ? 'Loading workspace…' : 'No workspace selected')}
                </span>
                <span className="text-xs text-muted" aria-hidden>
                  ▾
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {canAccessGlobalAdmin ? (
                <Tooltip content="Global admin" side="bottom">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-10 w-10 border-primary/35 bg-primary/15 p-0 text-primary-dark hover:bg-primary/25"
                    onClick={() => {
                      setUserMenuOpen(false)
                      navigate(APP_ROUTES.globalWorkspaceAdmin)
                    }}
                    aria-label="Open global admin"
                  >
                    <Shield className="h-4 w-4" aria-hidden />
                  </Button>
                </Tooltip>
              ) : null}

              <div className="relative" ref={userMenuRef}>
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-soft text-sm font-semibold text-primary transition-colors hover:bg-surface-inset"
                  onClick={() => setUserMenuOpen((current) => !current)}
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  aria-label="Open user menu"
                  type="button"
                >
                  {toInitials(me?.fullName || me?.email || 'NA')}
                </button>

                {userMenuOpen ? (
                  <div
                    className="absolute right-0 z-50 mt-2 w-44 rounded-xl border border-border bg-surface-raised p-1 shadow-card"
                    role="menu"
                    aria-label="User menu"
                  >
                    <button
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-soft"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false)
                        logout()
                      }}
                      type="button"
                    >
                      Log out
                      <span aria-hidden>↗</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {routeContextError ? <Alert tone="warning">{routeContextError}</Alert> : null}

          {routeIntegrationId !== '' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-soft px-2 py-1 text-muted transition-colors hover:bg-surface-inset hover:text-text"
                  onClick={() => navigate(APP_ROUTES.workspace)}
                  aria-label="Back to workspace home"
                  type="button"
                >
                  <span aria-hidden>←</span>
                  Workspace
                </button>
                <span className="text-muted">/</span>
                <span className="max-w-[40ch] truncate font-medium text-text">{selectedIntegration?.name || routeIntegrationId}</span>
              </div>

              <nav aria-label="Integration context tabs" className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1">
                {integrationTabs.map((tab) => (
                  <NavLink
                    key={tab.id}
                    to={tab.to(routeIntegrationId)}
                    className={({ isActive }) =>
                      cn(
                        'rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'border-primary/40 bg-primary/10 text-primary-dark'
                          : 'border-border bg-surface-soft text-muted hover:bg-surface-inset'
                      )
                    }
                  >
                    {tab.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          ) : null}
        </div>
      </header>

      <main className="min-w-0 min-h-0 flex flex-1 flex-col overflow-y-auto px-4 py-6 md:px-6">{children ?? <Outlet />}</main>

      {workspaceModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-[620px] rounded-2xl border border-border bg-surface-raised p-5 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-text">Switch Workspace</h2>
                <p className="text-sm text-muted">Choose a workspace to refresh integrations and member scope.</p>
              </div>
              <IconActionButton
                label="Close workspace switcher"
                icon={<X className="h-4 w-4" aria-hidden />}
                onClick={() => setWorkspaceModalOpen(false)}
              />
            </div>

            <Input
              className="mb-3"
              placeholder="Search workspaces..."
              value={workspaceSearchQuery}
              onChange={(event) => setWorkspaceSearchQuery(event.target.value)}
            />

            <div className="max-h-[380px] space-y-2 overflow-y-auto">
              {filteredWorkspaces.map((workspace) => {
                const active = workspace.id === selectedWorkspaceId
                return (
                  <button
                    key={workspace.id}
                    className={cn(
                      'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                      active ? 'border-primary/40 bg-primary/10' : 'border-border bg-surface-soft hover:bg-surface-inset'
                    )}
                    onClick={() => {
                      void selectWorkspace(workspace.id)
                      setWorkspaceModalOpen(false)
                      navigate(APP_ROUTES.workspace)
                    }}
                    type="button"
                  >
                    <p className="font-medium text-text">{workspace.name}</p>
                    <p className="text-xs text-muted">{workspace.slug}</p>
                  </button>
                )
              })}
              {workspaces.length === 0 ? (
                <p className="rounded-xl border border-border bg-surface-soft p-4 text-sm text-muted">No workspaces available.</p>
              ) : null}
              {workspaces.length > 0 && filteredWorkspaces.length === 0 ? (
                <p className="rounded-xl border border-border bg-surface-soft p-4 text-sm text-muted">No workspaces match your search.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function toInitials(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    return 'NA'
  }

  const words = trimmed.split(/\s+/).slice(0, 2)
  if (words.length === 1) {
    const firstWord = words[0] || ''
    return firstWord.slice(0, 2).toUpperCase()
  }

  return words.map((word) => word[0]?.toUpperCase() || '').join('')
}
