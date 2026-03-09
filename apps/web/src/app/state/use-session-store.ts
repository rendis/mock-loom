import { create } from 'zustand'

import { createPkcePair } from '../../lib/pkce'
import { finalizeSlugInput } from '../../shared/lib/slug'
import {
  createIntegration,
  exchangeCode,
  formatAPIError,
  getAuthConfig,
  getIntegrations,
  getMe,
  getWorkspaceMembers,
  getWorkspaces,
  inviteMember,
} from '../../lib/api'
import type {
  AuthConfig,
  Integration,
  Me,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '../../types/api'

const STORAGE_TOKEN = 'mock_loom_access_token'
const STORAGE_VERIFIER = 'mock_loom_pkce_verifier'
const STORAGE_STATE = 'mock_loom_pkce_state'
const DUMMY_AUTH_TOKEN = 'dummy-token'

type AuthState = 'idle' | 'redirecting' | 'callback_processing' | 'authenticated' | 'error'
type CollectionState = 'loading' | 'empty' | 'ready' | 'error'

interface IntegrationDraft {
  name: string
  slug: string
}

interface SessionStore {
  initialized: boolean
  config: AuthConfig | null
  token: string | null
  authState: AuthState
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

  bootstrap: (redirectUri: string) => Promise<void>
  startLogin: (redirectUri: string) => Promise<void>
  logout: () => void
  refreshWorkspaces: () => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
  selectIntegration: (integrationId: string) => void
  refreshWorkspaceScope: () => Promise<void>
  inviteWorkspaceMember: (email: string, role: Exclude<WorkspaceRole, 'OWNER'>) => Promise<void>
  createWorkspaceIntegration: (draft: IntegrationDraft) => Promise<void>
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  initialized: false,
  config: null,
  token: localStorage.getItem(STORAGE_TOKEN),
  authState: 'idle',
  me: null,
  workspaces: [],
  workspaceState: 'loading',
  selectedWorkspaceId: '',
  members: [],
  membersState: 'loading',
  integrations: [],
  integrationsState: 'loading',
  selectedIntegrationId: '',
  creatingIntegration: false,
  error: '',

  async bootstrap(redirectUri: string): Promise<void> {
    set({ error: '', workspaceState: 'loading' })

    try {
      const config = await getAuthConfig()
      set({ config })

      const url = new URL(window.location.href)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      if (code && state && config.panelProvider?.tokenEndpoint && config.panelProvider.clientId) {
        set({ authState: 'callback_processing' })
        const storedState = sessionStorage.getItem(STORAGE_STATE)
        const verifier = sessionStorage.getItem(STORAGE_VERIFIER)

        if (!storedState || storedState !== state || !verifier) {
          throw new Error('OIDC state mismatch')
        }

        const tokenPayload = await exchangeCode(
          config.panelProvider.tokenEndpoint,
          code,
          redirectUri,
          config.panelProvider.clientId,
          verifier
        )

        sessionStorage.removeItem(STORAGE_STATE)
        sessionStorage.removeItem(STORAGE_VERIFIER)
        localStorage.setItem(STORAGE_TOKEN, tokenPayload.access_token)
        set({ token: tokenPayload.access_token })

        url.searchParams.delete('code')
        url.searchParams.delete('state')
        window.history.replaceState({}, '', url.toString())
      }

      const currentToken = localStorage.getItem(STORAGE_TOKEN)
      if (!currentToken) {
        set({
          initialized: true,
          token: null,
          authState: 'idle',
          workspaceState: 'empty',
          members: [],
          membersState: 'empty',
          integrations: [],
          integrationsState: 'empty',
          selectedWorkspaceId: '',
          selectedIntegrationId: '',
        })
        return
      }

      const me = await getMe(currentToken)

      set({
        initialized: true,
        token: currentToken,
        me,
        authState: 'authenticated',
      })

      await get().refreshWorkspaces()
    } catch (error) {
      localStorage.removeItem(STORAGE_TOKEN)
      set({
        initialized: true,
        token: null,
        authState: 'error',
        workspaceState: 'error',
        error: formatAPIError(error),
      })
    }
  },

  async startLogin(redirectUri: string): Promise<void> {
    const config = get().config
    if (!config) {
      set({ error: 'OIDC login is not configured' })
      return
    }

    if (config.dummyAuth) {
      localStorage.setItem(STORAGE_TOKEN, DUMMY_AUTH_TOKEN)
      set({ token: DUMMY_AUTH_TOKEN })
      await get().bootstrap(redirectUri)
      return
    }

    const provider = config.panelProvider
    if (!provider?.authorizationEndpoint || !provider.clientId) {
      set({ error: 'OIDC authorization endpoint/client_id missing' })
      return
    }

    try {
      set({ authState: 'redirecting', error: '' })
      const { challenge, verifier, state } = await createPkcePair()
      sessionStorage.setItem(STORAGE_VERIFIER, verifier)
      sessionStorage.setItem(STORAGE_STATE, state)

      const authURL = new URL(provider.authorizationEndpoint)
      authURL.searchParams.set('response_type', 'code')
      authURL.searchParams.set('client_id', provider.clientId)
      authURL.searchParams.set('redirect_uri', redirectUri)
      authURL.searchParams.set('scope', provider.scopes || 'openid profile email')
      authURL.searchParams.set('code_challenge', challenge)
      authURL.searchParams.set('code_challenge_method', 'S256')
      authURL.searchParams.set('state', state)

      window.location.assign(authURL.toString())
    } catch (error) {
      set({ authState: 'error', error: formatAPIError(error) })
    }
  },

  logout(): void {
    localStorage.removeItem(STORAGE_TOKEN)
    set({
      token: null,
      authState: 'idle',
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
