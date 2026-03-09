import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { APP_ROUTES } from '../../app/routes/paths'
import {
  archiveWorkspace,
  formatAPIError,
  updateWorkspace,
  updateWorkspaceMemberRole,
  updateWorkspaceMemberStatus,
} from '../../lib/api'
import { useSessionStore } from '../../app/state/use-session-store'
import { cn } from '../../shared/lib/cn'
import { finalizeSlugInput, formatSlugInput } from '../../shared/lib/slug'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { Input } from '../../shared/ui/input'
import { SegmentedControl } from '../../shared/ui/segmented-control'
import { Select } from '../../shared/ui/select'
import { Textarea } from '../../shared/ui/textarea'
import type { MembershipStatus, WorkspaceMember, WorkspaceRole } from '../../types/api'

interface WorkspaceDraft {
  name: string
  slug: string
  description: string
  metadata: string
}

const inviteRoleOptions: Array<Exclude<WorkspaceRole, 'OWNER'>> = ['VIEWER', 'EDITOR', 'ADMIN']
const statusOptions: MembershipStatus[] = ['PENDING', 'ACTIVE']

function roleWeight(role: WorkspaceRole): number {
  if (role === 'OWNER') {
    return 40
  }
  if (role === 'ADMIN') {
    return 30
  }
  if (role === 'EDITOR') {
    return 20
  }
  return 10
}

export function WorkspaceAdminScreen(): JSX.Element {
  const navigate = useNavigate()
  const [editDraft, setEditDraft] = useState<WorkspaceDraft>({
    name: '',
    slug: '',
    description: '',
    metadata: '{}',
  })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, 'OWNER'>>('EDITOR')
  const [busyAction, setBusyAction] = useState<string>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [workspaceSectionOpen, setWorkspaceSectionOpen] = useState(true)
  const [membersSectionOpen, setMembersSectionOpen] = useState(true)
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)

  const {
    token,
    me,
    workspaces,
    selectedWorkspaceId,
    members,
    membersState,
    inviteWorkspaceMember,
    refreshWorkspaces,
    refreshWorkspaceScope,
  } = useSessionStore(
    useShallow((state) => ({
      token: state.token,
      me: state.me,
      workspaces: state.workspaces,
      selectedWorkspaceId: state.selectedWorkspaceId,
      members: state.members,
      membersState: state.membersState,
      inviteWorkspaceMember: state.inviteWorkspaceMember,
      refreshWorkspaces: state.refreshWorkspaces,
      refreshWorkspaceScope: state.refreshWorkspaceScope,
    }))
  )

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces]
  )

  useEffect(() => {
    if (!selectedWorkspace) {
      setEditDraft({ name: '', slug: '', description: '', metadata: '{}' })
      return
    }
    setEditDraft({
      name: selectedWorkspace.name,
      slug: selectedWorkspace.slug,
      description: selectedWorkspace.description,
      metadata: selectedWorkspace.metadataJson || '{}',
    })
  }, [selectedWorkspace])

  const effectiveRole = useMemo<WorkspaceRole>(() => {
    if (me?.systemRole === 'SUPERADMIN') {
      return 'OWNER'
    }
    if (me?.systemRole === 'PLATFORM_ADMIN') {
      return 'ADMIN'
    }
    const memberRole = members.find((member) => member.userId === me?.id)?.role
    return memberRole ?? 'VIEWER'
  }, [members, me])

  const canUpdateWorkspace = roleWeight(effectiveRole) >= roleWeight('ADMIN')
  const canArchiveWorkspace = effectiveRole === 'OWNER'
  const canAddMembers = roleWeight(effectiveRole) >= roleWeight('ADMIN')
  const canUpdateMemberRole = effectiveRole === 'OWNER'
  const canUpdateMemberStatus = roleWeight(effectiveRole) >= roleWeight('ADMIN')

  async function handleUpdateWorkspace(): Promise<void> {
    if (!token || !selectedWorkspace || !canUpdateWorkspace) {
      return
    }
    if (busyAction !== '') {
      return
    }
    try {
      setBusyAction('update-workspace')
      setError('')
      setNotice('')
      await updateWorkspace(token, selectedWorkspace.id, {
        name: editDraft.name.trim(),
        slug: finalizeSlugInput(editDraft.slug),
        description: editDraft.description.trim(),
        metadata: editDraft.metadata.trim(),
      })
      await refreshWorkspaces()
      setNotice('Workspace updated successfully.')
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  function openArchiveDialog(): void {
    if (!token || !selectedWorkspace || !canArchiveWorkspace || busyAction !== '') {
      return
    }
    setArchiveDialogOpen(true)
  }

  async function handleArchiveWorkspace(): Promise<void> {
    if (!token || !selectedWorkspace || !canArchiveWorkspace || busyAction !== '') {
      return
    }

    try {
      setBusyAction('archive-workspace')
      setError('')
      setNotice('')
      await archiveWorkspace(token, selectedWorkspace.id)
      await refreshWorkspaces()
      setArchiveDialogOpen(false)
      setNotice('Workspace archived.')
      navigate(APP_ROUTES.workspace)
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function handleAddMember(): Promise<void> {
    if (!canAddMembers || busyAction !== '') {
      return
    }
    try {
      setBusyAction('add-member')
      setError('')
      setNotice('')
      await inviteWorkspaceMember(inviteEmail, inviteRole)
      setInviteEmail('')
      setNotice('Member added to workspace.')
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function handleRoleChange(member: WorkspaceMember, nextRole: WorkspaceRole): Promise<void> {
    if (!token || !selectedWorkspaceId || !canUpdateMemberRole || busyAction !== '') {
      return
    }
    if (nextRole === member.role || nextRole === 'OWNER') {
      return
    }
    try {
      setBusyAction(`member-role-${member.id}`)
      setError('')
      setNotice('')
      await updateWorkspaceMemberRole(token, selectedWorkspaceId, member.id, nextRole as Exclude<WorkspaceRole, 'OWNER'>)
      await refreshWorkspaceScope()
      setNotice('Member role updated.')
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  async function handleStatusChange(member: WorkspaceMember, nextStatus: MembershipStatus): Promise<void> {
    if (!token || !selectedWorkspaceId || !canUpdateMemberStatus || busyAction !== '') {
      return
    }
    if (nextStatus === member.membershipStatus) {
      return
    }
    try {
      setBusyAction(`member-status-${member.id}`)
      setError('')
      setNotice('')
      await updateWorkspaceMemberStatus(token, selectedWorkspaceId, member.id, nextStatus)
      await refreshWorkspaceScope()
      setNotice('Member status updated.')
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setBusyAction('')
    }
  }

  return (
    <section className="min-h-screen bg-surface-base px-4 py-6 md:px-6">
      <div className="w-full space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-text">Workspace Administration</h1>
            <p className="text-sm text-muted">Manage selected workspace settings and membership policies.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigate(APP_ROUTES.workspace)}>
            Back to Workspace
          </Button>
        </header>

        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="grid gap-6">
          <Card>
            <CardHeader className="pb-3">
              <button
                className="flex w-full items-center justify-between gap-3 text-left"
                onClick={() => setWorkspaceSectionOpen((current) => !current)}
                aria-expanded={workspaceSectionOpen}
                aria-controls="workspace-settings-content"
                type="button"
              >
                <div>
                  <CardTitle>Workspace Settings</CardTitle>
                  <p className="mt-1 text-sm text-muted">Update workspace profile, slug, metadata, and lifecycle status.</p>
                </div>
                <ChevronDown
                  className={cn('h-5 w-5 shrink-0 text-muted transition-transform', workspaceSectionOpen ? 'rotate-180' : '')}
                  aria-hidden
                />
              </button>
            </CardHeader>
            <CardContent id="workspace-settings-content" className={cn('space-y-3', !workspaceSectionOpen && 'hidden')}>
              {selectedWorkspace ? (
                <>
                  <Input
                    placeholder="Workspace name"
                    value={editDraft.name}
                    onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                  <Input
                    placeholder="Workspace slug"
                    value={editDraft.slug}
                    onChange={(event) => setEditDraft((current) => ({ ...current, slug: formatSlugInput(event.target.value) }))}
                    onBlur={(event) => setEditDraft((current) => ({ ...current, slug: finalizeSlugInput(event.target.value) }))}
                  />
                  <Input
                    placeholder="Description"
                    value={editDraft.description}
                    onChange={(event) => setEditDraft((current) => ({ ...current, description: event.target.value }))}
                  />
                  <Textarea
                    className="min-h-24 font-mono text-xs"
                    placeholder="Metadata JSON"
                    value={editDraft.metadata}
                    onChange={(event) => setEditDraft((current) => ({ ...current, metadata: event.target.value }))}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="px-5"
                      onClick={() => void handleUpdateWorkspace()}
                      disabled={!canUpdateWorkspace || busyAction !== ''}
                    >
                      {busyAction === 'update-workspace' ? 'Saving...' : 'Save Workspace'}
                    </Button>
                    <Button
                      className="px-5"
                      variant="destructive"
                      onClick={openArchiveDialog}
                      disabled={!canArchiveWorkspace || busyAction !== ''}
                    >
                      {busyAction === 'archive-workspace' ? 'Archiving...' : 'Archive Workspace'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted">
                    Status: {selectedWorkspace.status} • Updated: {selectedWorkspace.updatedAt || '-'}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">No workspace selected.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <button
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setMembersSectionOpen((current) => !current)}
              aria-expanded={membersSectionOpen}
              aria-controls="workspace-members-content"
              type="button"
            >
              <div>
                <CardTitle>Members</CardTitle>
                <p className="mt-1 text-sm text-muted">Add members and manage membership roles and status.</p>
              </div>
              <ChevronDown
                className={cn('h-5 w-5 shrink-0 text-muted transition-transform', membersSectionOpen ? 'rotate-180' : '')}
                aria-hidden
              />
            </button>
          </CardHeader>
          <CardContent id="workspace-members-content" className={cn('space-y-4', !membersSectionOpen && 'hidden')}>
            <div className="flex w-full flex-wrap items-center gap-2">
              <Input
                className="w-full sm:w-[320px] md:w-[360px]"
                placeholder="member@company.com"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
              <Select
                className="w-full sm:w-[180px]"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as Exclude<WorkspaceRole, 'OWNER'>)}
              >
                {inviteRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                onClick={() => void handleAddMember()}
                disabled={!canAddMembers || busyAction !== '' || inviteEmail.trim() === ''}
              >
                {busyAction === 'add-member' ? 'Adding...' : 'Add member'}
              </Button>
            </div>
            {membersState === 'loading' ? <p className="text-sm text-muted">Loading members...</p> : null}
            {members.length === 0 && membersState !== 'loading' ? (
              <p className="rounded-xl border border-border bg-surface-soft p-4 text-sm text-muted">No members found in selected workspace.</p>
            ) : null}
            {members.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border/70 bg-surface-soft text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id} className="border-b border-border/50 last:border-b-0">
                        <td className="px-4 py-3 text-text">{member.userFullName || member.userId}</td>
                        <td className="px-4 py-3 text-muted">{member.userEmail || '-'}</td>
                        <td className="px-4 py-3">
                          {member.role === 'OWNER' ? (
                            <Badge variant="info">OWNER</Badge>
                          ) : (
                            <Select
                              value={member.role}
                              onChange={(event) => void handleRoleChange(member, event.target.value as WorkspaceRole)}
                              disabled={!canUpdateMemberRole || busyAction !== ''}
                            >
                              <option value="ADMIN">ADMIN</option>
                              <option value="EDITOR">EDITOR</option>
                              <option value="VIEWER">VIEWER</option>
                            </Select>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <SegmentedControl
                            value={member.membershipStatus}
                            onChange={(next) => void handleStatusChange(member, next)}
                            options={statusOptions.map((status) => ({
                              value: status,
                              label: status === 'ACTIVE' ? 'Active' : 'Pending',
                            }))}
                            ariaLabel={`Membership status for ${member.userEmail || member.userId}`}
                            disabled={!canUpdateMemberStatus || busyAction !== ''}
                            className="min-w-[220px]"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted">{member.joinedAt || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {archiveDialogOpen && selectedWorkspace ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <Card className="w-full max-w-[420px]">
            <CardHeader className="space-y-1">
              <CardTitle>Archive Workspace</CardTitle>
              <p className="text-sm text-muted">
                Archive <span className="font-semibold text-text">{selectedWorkspace.name}</span>? You can still audit history, but active
                workspace workflows will stop.
              </p>
            </CardHeader>
            <CardContent className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setArchiveDialogOpen(false)} disabled={busyAction !== ''}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void handleArchiveWorkspace()} disabled={busyAction !== ''}>
                {busyAction === 'archive-workspace' ? 'Archiving...' : 'Archive'}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  )
}
