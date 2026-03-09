import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '../layout/app-shell'
import { resolveFallbackRedirect, resolveLoginRedirect, resolveRootRedirect } from './guards'
import { APP_ROUTES } from './paths'
import { DataDebuggerScreen } from '../../features/data-debugger/screen'
import { DataSourcesScreen } from '../../features/data-sources/screen'
import { EndpointEditorScreen } from '../../features/endpoint-editor/screen'
import { PacksScreen } from '../../features/packs/screen'
import { OverviewRoutingScreen } from '../../features/overview-routing/screen'
import { LoginScreen } from '../../features/auth/screen'
import { WorkspaceScreen } from '../../features/workspace/screen'
import { WorkspaceAdminScreen } from '../../features/workspace-admin/screen'
import { GlobalWorkspaceAdminScreen } from '../../features/global-admin/screen'
import { AuditHistoryScreen, EntityMapScreen, SessionLogsScreen } from '../../features/observability/screen'
import { EmptyState } from '../../shared/ui/empty-state'
import { useSessionStore } from '../state/use-session-store'

export function AppRoutes(): JSX.Element {
  const token = useSessionStore((state) => state.token)

  if (!token) {
    return (
      <Routes>
        <Route path={APP_ROUTES.root} element={<Navigate replace to={resolveRootRedirect(token)} />} />
        <Route path={APP_ROUTES.login} element={<LoginScreen />} />
        <Route path="*" element={<Navigate replace to={resolveFallbackRedirect(token)} />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path={APP_ROUTES.root} element={<Navigate replace to={resolveRootRedirect(token)} />} />
      <Route path={APP_ROUTES.login} element={<Navigate replace to={resolveLoginRedirect(token)} />} />
      <Route element={<AppShell />}>
        <Route path={APP_ROUTES.workspace} element={<WorkspaceScreen />} />
        <Route path={APP_ROUTES.workspaceAdmin} element={<WorkspaceAdminScreen />} />
        <Route path={APP_ROUTES.globalWorkspaceAdmin} element={<GlobalWorkspaceAdminScreen />} />
        <Route path={APP_ROUTES.overview} element={<OverviewRoutingScreen />} />
        <Route path={APP_ROUTES.packs} element={<PacksScreen />} />
        <Route path={APP_ROUTES.pack} element={<EndpointEditorScreen />} />
        <Route path={APP_ROUTES.packEndpoint} element={<EndpointEditorScreen />} />
        <Route path={APP_ROUTES.dataSources} element={<DataSourcesScreen />} />
        <Route path={APP_ROUTES.dataDebugger} element={<DataDebuggerScreen />} />
        <Route path={APP_ROUTES.sessionLogs} element={<SessionLogsScreen />} />
        <Route path={APP_ROUTES.entityMap} element={<EntityMapScreen />} />
        <Route path={APP_ROUTES.auditHistory} element={<AuditHistoryScreen />} />
        <Route
          path="*"
          element={<EmptyState title="Route not found" description="The requested route does not exist in the UI v2 router." />}
        />
      </Route>
    </Routes>
  )
}
