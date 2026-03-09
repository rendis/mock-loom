import { describe, expect, it } from 'vitest'

import { deriveWorkspaceViewState } from './state'

describe('deriveWorkspaceViewState', () => {
  it('returns ready when authenticated and integrations are available', () => {
    expect(
      deriveWorkspaceViewState({
        token: 'token',
        workspaceState: 'ready',
        selectedWorkspaceId: 'ws-1',
        integrationsState: 'ready',
        membersState: 'ready',
        error: '',
        qaState: null,
      })
    ).toBe('ready')
  })

  it('returns access-error when session token is missing', () => {
    expect(
      deriveWorkspaceViewState({
        token: null,
        workspaceState: 'ready',
        selectedWorkspaceId: 'ws-1',
        integrationsState: 'ready',
        membersState: 'ready',
        error: '',
        qaState: null,
      })
    ).toBe('access-error')
  })

  it('returns empty when authenticated and no integrations exist', () => {
    expect(
      deriveWorkspaceViewState({
        token: 'token',
        workspaceState: 'ready',
        selectedWorkspaceId: 'ws-1',
        integrationsState: 'empty',
        membersState: 'ready',
        error: '',
        qaState: null,
      })
    ).toBe('empty')
  })

  it('returns access-error when backend returns access denied signals', () => {
    expect(
      deriveWorkspaceViewState({
        token: 'token',
        workspaceState: 'ready',
        selectedWorkspaceId: 'ws-1',
        integrationsState: 'error',
        membersState: 'error',
        error: 'workspace access denied',
        qaState: null,
      })
    ).toBe('access-error')
  })

  it('returns qaState override when provided', () => {
    expect(
      deriveWorkspaceViewState({
        token: 'token',
        workspaceState: 'ready',
        selectedWorkspaceId: 'ws-1',
        integrationsState: 'ready',
        membersState: 'ready',
        error: '',
        qaState: 'empty',
      })
    ).toBe('empty')
  })

  it('returns no-workspace when workspace collection is empty', () => {
    expect(
      deriveWorkspaceViewState({
        token: 'token',
        workspaceState: 'empty',
        selectedWorkspaceId: '',
        integrationsState: 'empty',
        membersState: 'empty',
        error: '',
        qaState: null,
      })
    ).toBe('no-workspace')
  })

  it('returns no-workspace when selected workspace is missing', () => {
    expect(
      deriveWorkspaceViewState({
        token: 'token',
        workspaceState: 'ready',
        selectedWorkspaceId: '',
        integrationsState: 'ready',
        membersState: 'ready',
        error: '',
        qaState: null,
      })
    ).toBe('no-workspace')
  })
})
