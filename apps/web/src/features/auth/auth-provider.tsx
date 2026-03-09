import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { UserManager, type UserManagerSettings } from 'oidc-client-ts'

import { formatAPIError, getAuthConfig, getMe } from '../../lib/api'
import type { AuthConfig } from '../../types/api'
import { useSessionStore } from '../../app/state/use-session-store'
import { AuthContext } from './auth-context'

const STORAGE_TOKEN = 'mock_loom_access_token'
const DUMMY_AUTH_TOKEN = 'dummy-token'

let sharedUserManager: UserManager | null = null

export function getUserManager(): UserManager | null {
  return sharedUserManager
}

function resolveBasePath(): string {
  return (import.meta.env.VITE_BASE_PATH as string | undefined) || ''
}

function buildOidcSettings(config: AuthConfig): UserManagerSettings | null {
  const provider = config.panelProvider
  if (!provider?.clientId) return null

  const basePath = resolveBasePath()
  const origin = window.location.origin

  return {
    authority: provider.issuer,
    client_id: provider.clientId,
    redirect_uri: origin + basePath + '/auth/callback',
    post_logout_redirect_uri: origin + basePath + '/login',
    scope: provider.scopes || 'openid profile email',
    response_type: 'code',
    automaticSilentRenew: false,
    metadata: {
      issuer: provider.issuer,
      authorization_endpoint: provider.authorizationEndpoint ?? '',
      token_endpoint: provider.tokenEndpoint ?? '',
      end_session_endpoint: provider.endSessionEndpoint,
      userinfo_endpoint: provider.userinfoEndpoint,
      jwks_uri: provider.jwksUrl,
    },
  }
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isDummyAuth, setIsDummyAuth] = useState(false)
  const [providerName, setProviderName] = useState('')
  const [error, setError] = useState('')
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    void initAuth()

    async function initAuth(): Promise<void> {
      try {
        const config = await getAuthConfig()
        const dummy = config.dummyAuth
        setIsDummyAuth(dummy)
        setProviderName(dummy ? 'dummy-auth' : (config.panelProvider?.name || 'oidc'))

        if (dummy) {
          await initDummyAuth()
        } else {
          await initOidcAuth(config)
        }
      } catch (err) {
        setError(formatAPIError(err))
      } finally {
        setIsLoading(false)
      }
    }

    async function initDummyAuth(): Promise<void> {
      const storedToken = localStorage.getItem(STORAGE_TOKEN)
      if (!storedToken) return

      try {
        const me = await getMe(storedToken)
        useSessionStore.getState().setAuthState(storedToken, me)
        setIsAuthenticated(true)
      } catch {
        localStorage.removeItem(STORAGE_TOKEN)
      }
    }

    async function initOidcAuth(config: AuthConfig): Promise<void> {
      const settings = buildOidcSettings(config)
      if (!settings) {
        setError('OIDC provider configuration is incomplete')
        return
      }

      const mgr = new UserManager(settings)
      sharedUserManager = mgr

      mgr.events.addUserLoaded(async (user) => {
        try {
          const me = await getMe(user.access_token)
          useSessionStore.getState().setAuthState(user.access_token, me)
          setIsAuthenticated(true)
          setError('')
          await useSessionStore.getState().refreshWorkspaces()
        } catch (err) {
          setError(formatAPIError(err))
        }
      })

      mgr.events.addUserUnloaded(() => {
        useSessionStore.getState().clearAuthState()
        setIsAuthenticated(false)
      })

      try {
        const user = await mgr.getUser()
        if (user && !user.expired) {
          const me = await getMe(user.access_token)
          useSessionStore.getState().setAuthState(user.access_token, me)
          setIsAuthenticated(true)
          await useSessionStore.getState().refreshWorkspaces()
        }
      } catch {
        // No existing session
      }
    }
  }, [])

  const login = useCallback(() => {
    setError('')

    if (isDummyAuth) {
      void (async () => {
        try {
          localStorage.setItem(STORAGE_TOKEN, DUMMY_AUTH_TOKEN)
          const me = await getMe(DUMMY_AUTH_TOKEN)
          useSessionStore.getState().setAuthState(DUMMY_AUTH_TOKEN, me)
          setIsAuthenticated(true)
          await useSessionStore.getState().refreshWorkspaces()
        } catch (err) {
          localStorage.removeItem(STORAGE_TOKEN)
          setError(formatAPIError(err))
        }
      })()
      return
    }

    const mgr = sharedUserManager
    if (!mgr) {
      setError('OIDC is not initialized')
      return
    }

    void mgr.signinRedirect().catch((err: unknown) => {
      setError(formatAPIError(err))
    })
  }, [isDummyAuth])

  const logout = useCallback(() => {
    if (isDummyAuth) {
      localStorage.removeItem(STORAGE_TOKEN)
      useSessionStore.getState().clearAuthState()
      setIsAuthenticated(false)
      return
    }

    const mgr = sharedUserManager
    if (!mgr) return

    useSessionStore.getState().clearAuthState()
    setIsAuthenticated(false)
    void mgr.signoutRedirect().catch(() => {
      // If signout redirect fails, we already cleared local state
    })
  }, [isDummyAuth])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-base text-text">
        <div className="rounded-2xl border border-border bg-surface-raised px-6 py-4 shadow-card">
          <p className="text-sm font-medium">Bootstrapping session...</p>
        </div>
      </div>
    )
  }

  return (
    <AuthContext.Provider
      value={{ isLoading, isAuthenticated, isDummyAuth, providerName, error, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}
