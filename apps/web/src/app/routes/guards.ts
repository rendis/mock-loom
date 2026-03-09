import { APP_ROUTES } from './paths'

export function resolveRootRedirect(token: string | null): string {
  return token ? APP_ROUTES.workspace : APP_ROUTES.login
}

export function resolveLoginRedirect(token: string | null): string {
  return token ? APP_ROUTES.workspace : APP_ROUTES.login
}

export function resolveFallbackRedirect(token: string | null): string {
  return token ? APP_ROUTES.workspace : APP_ROUTES.login
}
