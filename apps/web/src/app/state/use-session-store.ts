import { create } from 'zustand'

import { finalizeSlugInput } from '../../shared/lib/slug'
import {
  createIntegration,
  formatAPIError,
  getIntegrations,
  getWorkspaceMembers,
  getWorkspaces,
  inviteMember,
} from '../../lib/api'
import type {
  Integration,
  Me,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '../../types/api'

const STORAGE_TOKEN = 'mock_loom_access_token'

type CollectionState = 'loading' | 'empty' | 'ready' | 'error'

interface IntegrationDraft {
  name: string
  slug: string
}

interface SessionStore {
  token: string | null
  me: Me | null
  workspaces: Workspace[]
  workspaceState: CollectionState
  selectedWorkspaceId: string
  members: WorkspaceMember[]
  membersState: CollectionState
  integrations: Integration[]
  integrationsState: CollectionState
  selectedIntegrationId: string
  creatingIntegration: boolean
  error: string

  setAuthState: (token: string, me: Me) => void
  clearAuthState: () => void
  refreshWorkspaces: () => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
  selectIntegration: (integrationId: string) => void
  refreshWorkspaceScope: () => Promise<void>
  inviteWorkspaceMember: (email: string, role: Exclude<WorkspaceRole, 'OWNER'>) => Promise<void>
  createWorkspaceIntegration: (draft: IntegrationDraft) => Promise<void>
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  token: localStorage.getItem(STORAGE_TOKEN),
  me: null,
  workspaces: [],
  workspaceState: 'empty',
  selectedWorkspaceId: '',
  members: [],
  membersState: 'empty',
  integrations: [],
  integrationsState: 'empty',
  selectedIntegrationId: '',
  creatingIntegration: false,
  error: '',

  setAuthState(token: string, me: Me): void {
    localStorage.setItem(STORAGE_TOKEN, token)
    set({ token, me })
  },

  clearAuthState(): void {
    localStorage.removeItem(STORAGE_TOKEN)
    set({
      token: null,
      me: null,
      workspaces: [],
      workspaceState: 'empty',
      selectedWorkspaceId: '',
      members: [],
      membersState: 'empty',
      integrations: [],
      integrationsState: 'empty',
      selectedIntegrationId: '',
      error: '',
    })
  },

  async refreshWorkspaces(): Promise<void> {
    const token = get().token
    if (!token) {
      set({
        workspaces: [],
        workspaceState: 'empty',
        selectedWorkspaceId: '',
        members: [],
        membersState: 'empty',
        integrations: [],
        integrationsState: 'empty',
        selectedIntegrationId: '',
      })
      return
    }

    set({ error: '', workspaceState: 'loading' })

    try {
      const workspaces = await getWorkspaces(token)
      const previousWorkspaceID = get().selectedWorkspaceId
      const selectedWorkspaceId = workspaces.some((item) => item.id === previousWorkspaceID)
        ? previousWorkspaceID
        : (workspaces[0]?.id ?? '')

      set({
        workspaces,
        workspaceState: workspaces.length > 0 ? 'ready' : 'empty',
        selectedWorkspaceId,
      })

      if (selectedWorkspaceId) {
        await get().refreshWorkspaceScope()
        return
      }

      set({
        members: [],
        membersState: 'empty',
        integrations: [],
        integrationsState: 'empty',
        selectedIntegrationId: '',
      })
    } catch (error) {
      set({
        workspaces: [],
        workspaceState: 'error',
        selectedWorkspaceId: '',
        members: [],
        membersState: 'error',
        integrations: [],
        integrationsState: 'error',
        selectedIntegrationId: '',
        error: formatAPIError(error),
      })
    }
  },

  async selectWorkspace(workspaceId: string): Promise<void> {
    set({ selectedWorkspaceId: workspaceId, selectedIntegrationId: '' })
    await get().refreshWorkspaceScope()
  },

  selectIntegration(integrationId: string): void {
    set({ selectedIntegrationId: integrationId })
  },

  async refreshWorkspaceScope(): Promise<void> {
    const token = get().token
    const workspaceId = get().selectedWorkspaceId

    if (!token || !workspaceId) {
      set({
        members: [],
        membersState: 'empty',
        integrations: [],
        integrationsState: 'empty',
        selectedIntegrationId: '',
      })
      return
    }

    set({ error: '', membersState: 'loading', integrationsState: 'loading' })

    try {
      const [members, integrations] = await Promise.all([
        getWorkspaceMembers(token, workspaceId),
        getIntegrations(token, workspaceId),
      ])

      const selectedIntegrationId = integrations.some((item) => item.id === get().selectedIntegrationId)
        ? get().selectedIntegrationId
        : (integrations[0]?.id ?? '')

      set({
        members,
        membersState: members.length > 0 ? 'ready' : 'empty',
        integrations,
        integrationsState: integrations.length > 0 ? 'ready' : 'empty',
        selectedIntegrationId,
      })
    } catch (error) {
      set({
        membersState: 'error',
        integrationsState: 'error',
        error: formatAPIError(error),
      })
    }
  },

  async inviteWorkspaceMember(email: string, role: Exclude<WorkspaceRole, 'OWNER'>): Promise<void> {
    const token = get().token
    const workspaceId = get().selectedWorkspaceId

    if (!token || !workspaceId || email.trim() === '') {
      return
    }

    try {
      set({ error: '' })
      await inviteMember(token, workspaceId, email.trim(), role)
      await get().refreshWorkspaceScope()
    } catch (error) {
      set({ error: formatAPIError(error) })
    }
  },

  async createWorkspaceIntegration(draft: IntegrationDraft): Promise<void> {
    const token = get().token
    const workspaceId = get().selectedWorkspaceId

    if (!token || get().creatingIntegration) {
      return
    }

    if (!workspaceId) {
      set({ error: 'Select or create a workspace before creating an integration.' })
      return
    }

    const cleanedSlug = finalizeSlugInput(draft.slug)

    if (draft.name.trim() === '' || cleanedSlug === '') {
      set({ error: 'name and slug are required' })
      return
    }

    try {
      set({ creatingIntegration: true, error: '' })
      const created = await createIntegration(token, workspaceId, {
        name: draft.name.trim(),
        slug: cleanedSlug,
        baseUrl: cleanedSlug,
      })
      await get().refreshWorkspaceScope()
      set({ selectedIntegrationId: created.id })
    } catch (error) {
      set({ error: formatAPIError(error) })
    } finally {
      set({ creatingIntegration: false })
    }
  },
}))
