import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let useSessionStore: (typeof import('./use-session-store'))['useSessionStore']

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createMemoryStorage(): Storage {
  const state = new Map<string, string>()
  return {
    length: 0,
    clear() {
      state.clear()
    },
    getItem(key: string) {
      return state.has(key) ? state.get(key)! : null
    },
    key(index: number) {
      return Array.from(state.keys())[index] ?? null
    },
    removeItem(key: string) {
      state.delete(key)
    },
    setItem(key: string, value: string) {
      state.set(key, value)
    },
  }
}

describe('useSessionStore', () => {
  beforeAll(async () => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    const module = await import('./use-session-store')
    useSessionStore = module.useSessionStore
  })

  beforeEach(() => {
    localStorage.clear()
    useSessionStore.setState({
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
      creatingIntegration: false,
      error: '',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('setAuthState persists token and sets me', () => {
    const me = { id: 'u1', email: 'a@b.com', fullName: 'A B', status: 'ACTIVE' }
    useSessionStore.getState().setAuthState('tok-1', me)
    const state = useSessionStore.getState()

    expect(state.token).toBe('tok-1')
    expect(state.me).toEqual(me)
    expect(localStorage.getItem('mock_loom_access_token')).toBe('tok-1')
  })

  it('clearAuthState removes token, me, and resets collections', () => {
    useSessionStore.setState({
      token: 'tok-1',
      me: { id: 'u1', email: 'a@b.com', fullName: 'A B', status: 'ACTIVE' },
      selectedWorkspaceId: 'ws-1',
      selectedIntegrationId: 'int-1',
      error: 'boom',
    })
    localStorage.setItem('mock_loom_access_token', 'tok-1')

    useSessionStore.getState().clearAuthState()
    const state = useSessionStore.getState()

    expect(state.token).toBeNull()
    expect(state.me).toBeNull()
    expect(state.selectedWorkspaceId).toBe('')
    expect(state.selectedIntegrationId).toBe('')
    expect(state.error).toBe('')
    expect(localStorage.getItem('mock_loom_access_token')).toBeNull()
  })

  it('refreshWorkspaces keeps current selection when still available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/workspaces')) {
          return Promise.resolve(
            jsonResponse({
              items: [
                { id: 'ws-1', name: 'Workspace 1', slug: 'ws-1', description: '', status: 'ACTIVE' },
                { id: 'ws-2', name: 'Workspace 2', slug: 'ws-2', description: '', status: 'ACTIVE' },
              ],
            })
          )
        }
        if (url.includes('/workspaces/ws-2/members')) {
          return Promise.resolve(jsonResponse({ items: [] }))
        }
        if (url.includes('/workspaces/ws-2/integrations')) {
          return Promise.resolve(jsonResponse({ items: [] }))
        }
        return Promise.resolve(jsonResponse({ items: [] }))
      })
    )

    useSessionStore.setState({
      token: 'token-1',
      selectedWorkspaceId: 'ws-2',
    })

    await useSessionStore.getState().refreshWorkspaces()
    const state = useSessionStore.getState()

    expect(state.selectedWorkspaceId).toBe('ws-2')
    expect(state.workspaces).toHaveLength(2)
    expect(state.workspaceState).toBe('ready')
  })

  it('createWorkspaceIntegration reports error when no workspace is selected', async () => {
    useSessionStore.setState({
      token: 'token-1',
      selectedWorkspaceId: '',
      creatingIntegration: false,
      error: '',
    })

    await useSessionStore.getState().createWorkspaceIntegration({
      name: 'Payments',
      slug: 'payments',
    })

    expect(useSessionStore.getState().error).toBe('Select or create a workspace before creating an integration.')
  })
})
