import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'

import { APP_ROUTES } from '../../app/routes/paths'
import { useSessionStore } from '../../app/state/use-session-store'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { Input } from '../../shared/ui/input'

export function LoginScreen(): JSX.Element {
  const navigate = useNavigate()
  const { token, authState, config, error, startLogin } = useSessionStore(
    useShallow((state) => ({
      token: state.token,
      authState: state.authState,
      config: state.config,
      error: state.error,
      startLogin: state.startLogin,
    }))
  )

  const redirectUri = useMemo(() => window.location.origin + APP_ROUTES.login, [])
  const providerLabel = config?.dummyAuth ? 'dummy-auth' : (config?.panelProvider?.name || 'oidc')

  useEffect(() => {
    if (token) {
      navigate(APP_ROUTES.workspace, { replace: true })
    }
  }, [navigate, token])

  return (
    <section className="min-h-screen bg-surface-base text-text">
      <div className="mx-auto grid min-h-screen w-full max-w-[1320px] grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,540px)]">
        <div className="flex flex-col justify-center">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-base font-bold text-white shadow-card">::</div>
            <div>
              <p className="text-2xl font-semibold text-text">MockEngine System</p>
              <p className="text-xs font-mono text-muted">Developer Control Plane</p>
            </div>
          </div>
          <h1 className="max-w-[560px] text-5xl font-bold leading-tight text-text">Sign in to manage workspaces and mock integrations.</h1>
          <p className="mt-5 max-w-[560px] text-lg leading-relaxed text-muted">
            Authentication is separated from workspace operations. After login you will enter the workspace dashboard.
          </p>
          <div className="mt-7 flex items-center gap-3">
            <Badge variant="success">Operational</Badge>
            <Badge variant="info">provider: {providerLabel}</Badge>
          </div>
        </div>

        <Card className="self-center">
          <CardHeader>
            <CardTitle className="text-3xl">Login</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Email
              <Input className="mt-2 h-11" readOnly value={config?.dummyAuth ? 'admin@example.com' : 'you@company.com'} />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Password
              <Input className="mt-2 h-11" readOnly type="password" value="************" />
            </label>
            <Button
              className="h-11 w-full text-base"
              disabled={authState === 'redirecting' || authState === 'callback_processing'}
              onClick={() => void startLogin(redirectUri)}
            >
              {authState === 'redirecting' ? 'Redirecting…' : authState === 'callback_processing' ? 'Processing callback…' : 'Continue to Workspace'}
            </Button>
            <p className="text-xs text-muted">
              This login is for developers configuring mocks. It is not used by simulated APIs.
            </p>
            {error ? <Alert tone="error">{error}</Alert> : null}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
