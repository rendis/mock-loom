import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { APP_ROUTES } from '../../app/routes/paths'
import { getUserManager } from './auth-provider'

type CallbackState = 'processing' | 'error'

export function CallbackHandler(): JSX.Element {
  const navigate = useNavigate()
  const [state, setState] = useState<CallbackState>('processing')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    void processCallback()

    async function processCallback(): Promise<void> {
      const mgr = getUserManager()
      if (!mgr) {
        setState('error')
        setErrorMessage('OIDC is not initialized')
        return
      }

      try {
        await mgr.signinRedirectCallback()
        // onUserLoaded event in AuthProvider handles Zustand sync
        navigate(APP_ROUTES.workspace, { replace: true })
      } catch (err) {
        setState('error')
        setErrorMessage(err instanceof Error ? err.message : 'Authentication callback failed')
      }
    }
  }, [navigate])

  if (state === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-base text-text">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface-raised p-6 shadow-card">
          <h2 className="mb-2 text-lg font-semibold text-text">Authentication Error</h2>
          <p className="mb-4 text-sm text-muted">{errorMessage}</p>
          <Link
            to={APP_ROUTES.login}
            className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
          >
            Return to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base text-text">
      <div className="rounded-2xl border border-border bg-surface-raised px-6 py-4 shadow-card">
        <p className="text-sm font-medium">Processing authentication...</p>
      </div>
    </div>
  )
}
