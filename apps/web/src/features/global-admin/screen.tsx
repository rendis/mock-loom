import { useMemo, useState } from 'react'
import { ArrowUpRight, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { APP_ROUTES } from '../../app/routes/paths'
import { useSessionStore } from '../../app/state/use-session-store'
import { createWorkspace, formatAPIError } from '../../lib/api'
import { finalizeSlugInput, formatSlugInput } from '../../shared/lib/slug'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { IconActionButton } from '../../shared/ui/icon-action-button'
import { Input } from '../../shared/ui/input'
import { Textarea } from '../../shared/ui/textarea'

interface WorkspaceCreateDraft {
  name: string
  slug: string
  description: string
  metadata: string
}

function canCreateWorkspace(systemRole?: string): boolean {
  return systemRole === 'SUPERADMIN' || systemRole === 'PLATFORM_ADMIN'
}

export function GlobalWorkspaceAdminScreen(): JSX.Element {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<WorkspaceCreateDraft>({
    name: '',
    slug: '',
    description: '',
    metadata: '',
  })
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [workspaceSearch, setWorkspaceSearch] = useState('')

  const { token, me, workspaces, selectedWorkspaceId, selectWorkspace, refreshWorkspaces } = useSessionStore(
    useShallow((state) => ({
      token: state.token,
      me: state.me,
      workspaces: state.workspaces,
      selectedWorkspaceId: state.selectedWorkspaceId,
      selectWorkspace: state.selectWorkspace,
      refreshWorkspaces: state.refreshWorkspaces,
    }))
  )

  const canCreate = canCreateWorkspace(me?.systemRole)

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces]
  )
  const filteredWorkspaces = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase()
    if (query === '') {
      return workspaces
    }
    return workspaces.filter((workspace) =>
      [workspace.name, workspace.slug, workspace.id].some((value) => value.toLowerCase().includes(query))
    )
  }, [workspaceSearch, workspaces])

  async function handleCreateWorkspace(): Promise<void> {
    if (!token || !canCreate || busyAction !== '') {
      return
    }

    const name = draft.name.trim()
    const slug = finalizeSlugInput(draft.slug)
    if (name === '' || slug === '') {
      setError('Workspace name and slug are required.')
      setNotice('')
      return
    }

    try {
      setBusyAction('create-workspace')
      setError('')
      setNotice('')

      const createdWorkspace = await createWorkspace(token, {
        name,
        slug,
        description: draft.description.trim() || undefined,
        metadata: draft.metadata.trim() || undefined,
      })

      await refreshWorkspaces()
      await selectWorkspace(createdWorkspace.id)
      navigate(APP_ROUTES.workspace)

      setDraft({
        name: '',
        slug: '',
        description: '',
        metadata: '',
      })
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function openWorkspaceAdmin(workspaceId: string): Promise<void> {
    if (busyAction !== '') {
      return
    }
    try {
      setBusyAction(`workspace-admin-${workspaceId}`)
      await selectWorkspace(workspaceId)
      navigate(APP_ROUTES.workspaceAdmin)
    } finally {
      setBusyAction('')
    }
  }

  async function openWorkspaceHome(workspaceId: string): Promise<void> {
    if (busyAction !== '') {
      return
    }
    try {
      setBusyAction(`workspace-home-${workspaceId}`)
      await selectWorkspace(workspaceId)
      navigate(APP_ROUTES.workspace)
    } finally {
      setBusyAction('')
    }
  }

  return (
    <section className="min-h-screen bg-surface-base px-4 py-6 md:px-6">
      <div className="w-full space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-text">Global Workspace Administration</h1>
            <p className="text-sm text-muted">Create new workspaces and switch context to workspace-scoped administration.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral">System role: {me?.systemRole || 'WORKSPACE_MEMBER'}</Badge>
            <Button size="sm" variant="secondary" onClick={() => navigate(APP_ROUTES.workspace)}>
              Back to Workspace
            </Button>
          </div>
        </header>

        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Card>
          <CardHeader>
            <CardTitle>Create Workspace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Workspace name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
            <Input
              placeholder="Workspace slug"
              value={draft.slug}
              onChange={(event) => setDraft((current) => ({ ...current, slug: formatSlugInput(event.target.value) }))}
              onBlur={(event) => setDraft((current) => ({ ...current, slug: finalizeSlugInput(event.target.value) }))}
            />
            <Input
              placeholder="Description"
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
            <Textarea
              className="min-h-24 font-mono text-xs"
              placeholder='Optional metadata JSON (example: {"environment":"staging","team":"payments"})'
              value={draft.metadata}
              onChange={(event) => setDraft((current) => ({ ...current, metadata: event.target.value }))}
            />
            <p className="text-xs text-muted">
              Optional. Use JSON metadata for tags, environment, owner, or operational notes associated with this workspace.
            </p>
            <Button
              onClick={() => void handleCreateWorkspace()}
              disabled={!canCreate || busyAction !== ''}
            >
              {busyAction === 'create-workspace' ? 'Creating...' : 'Create Workspace'}
            </Button>
            {!canCreate ? (
              <p className="text-xs text-muted">Only `SUPERADMIN` or `PLATFORM_ADMIN` can create workspaces.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workspaces List</CardTitle>
            <p className="text-sm text-muted">
              All workspaces in your access scope. Use this list to open workspace home or workspace administration.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              placeholder="Search workspaces by name, slug, or ID"
              value={workspaceSearch}
              onChange={(event) => setWorkspaceSearch(event.target.value)}
            />
            {workspaces.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface-soft p-4 text-sm text-muted">No workspaces available.</p>
            ) : filteredWorkspaces.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface-soft p-4 text-sm text-muted">No workspaces match your search.</p>
            ) : (
              <div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
                {filteredWorkspaces.map((workspace) => {
                  const isSelected = workspace.id === selectedWorkspaceId
                  return (
                    <div
                      key={workspace.id}
                      className="grid min-h-[88px] gap-3 rounded-xl border border-border bg-surface-soft p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                    >
                      <div>
                        <p className="text-sm font-semibold text-text">{workspace.name}</p>
                        <p className="text-xs text-muted">{workspace.slug}</p>
                        <p className="text-xs text-muted">Status: {workspace.status}</p>
                        <p className="text-xs text-muted">Updated: {workspace.updatedAt || '-'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        {isSelected ? <Badge variant="info">Selected</Badge> : null}
                        <IconActionButton
                          label="Open workspace home"
                          icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
                          onClick={() => void openWorkspaceHome(workspace.id)}
                          disabled={busyAction !== ''}
                          disabledReason="Finish the current workspace action first."
                        />
                        <IconActionButton
                          label="Open workspace admin"
                          icon={<Settings2 className="h-4 w-4" aria-hidden />}
                          onClick={() => void openWorkspaceAdmin(workspace.id)}
                          disabled={busyAction !== ''}
                          disabledReason="Finish the current workspace action first."
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {selectedWorkspace ? (
              <p className="text-xs text-muted">Current selection: {selectedWorkspace.name}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
