import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'

import { APP_ROUTES } from '../../app/routes/paths'
import { useAuth } from './auth-context'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'

export function LoginScreen(): JSX.Element {
  const navigate = useNavigate()
  const { isAuthenticated, isDummyAuth, providerName, error, login } = useAuth()

  useEffect(() => {
    if (isAuthenticated) {
      navigate(APP_ROUTES.workspace, { replace: true })
    }
  }, [navigate, isAuthenticated])

  return (
    <section className="min-h-screen bg-surface-base text-text">
      <div className="mx-auto flex min-h-screen w-full max-w-[540px] flex-col items-center justify-center px-6 py-8">
        <div className="w-full rounded-2xl border border-border bg-surface-raised p-8 shadow-card">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-base font-bold text-white shadow-card">::</div>
            <div>
              <p className="text-2xl font-semibold text-text">MockEngine System</p>
              <p className="text-xs font-mono text-muted">Developer Control Plane</p>
            </div>
          </div>

          <p className="mb-6 text-sm leading-relaxed text-muted">
            Sign in to manage workspaces and mock integrations.
          </p>

          <Button
            className="h-11 w-full text-base"
            onClick={login}
          >
            <LogIn className="mr-2 h-4 w-4" aria-hidden />
            Sign In
          </Button>

          <div className="mt-5 flex items-center gap-3">
            <Badge variant="success">Operational</Badge>
            <Badge variant="info">provider: {providerName || (isDummyAuth ? 'dummy-auth' : 'oidc')}</Badge>
          </div>

          {error ? <Alert tone="error" className="mt-4">{error}</Alert> : null}

          <p className="mt-5 text-xs text-muted">
            This login is for developers configuring mocks. It is not used by simulated APIs.
          </p>
        </div>
      </div>
    </section>
  )
}
