import { useEffect, type ReactNode } from 'react'

import { useSessionStore } from '../state/use-session-store'

interface AppBootstrapProps {
  children: ReactNode
}

export function AppBootstrap({ children }: AppBootstrapProps): JSX.Element {
  const initialized = useSessionStore((state) => state.initialized)
  const bootstrap = useSessionStore((state) => state.bootstrap)

  useEffect(() => {
    const redirectUri = window.location.origin + window.location.pathname
    void bootstrap(redirectUri)
  }, [bootstrap])

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-base text-text">
        <div className="rounded-2xl border border-border bg-surface-raised px-6 py-4 shadow-card">
          <p className="text-sm font-medium">Bootstrapping session...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
