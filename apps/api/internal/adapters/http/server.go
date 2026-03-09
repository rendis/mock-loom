package http

import (
	"math"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"

	"github.com/rendis/mock-loom/apps/api/internal/adapters/http/handlers"
	"github.com/rendis/mock-loom/apps/api/internal/adapters/http/middleware"
	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// Dependencies bundles services and middleware for route wiring.
type Dependencies struct {
	AuthMiddleware     *middleware.AuthMiddleware
	AuthService        *usecase.AuthService
	AuthzService       *usecase.AuthorizationService
	AuthMockService    *usecase.AuthMockService
	WorkspaceService   *usecase.WorkspaceService
	MemberService      *usecase.MemberService
	IntegrationService *usecase.IntegrationService
	DataSourceService  *usecase.DataSourceService
	DataDebugger       *usecase.DataDebuggerService
	RuntimeGateway     *usecase.RuntimeGatewayService
	BackupService      *usecase.BackupService
	ImportMaxBytes     int
	DataSourceMaxBytes int
}

// NewServer builds Fiber app with all routes.
func NewServer(deps Dependencies) *fiber.App {
	bodyLimit := 8 * 1024 * 1024
	if deps.ImportMaxBytes > 0 {
		// Keep body parser limit above import limit so usecase can return explicit 413 payload.
		computed := deps.ImportMaxBytes + 1024*1024
		if computed > bodyLimit {
			bodyLimit = computed
		}
	}
	if deps.DataSourceMaxBytes > 0 {
		// Keep body parser limit above baseline upload max so usecase can return explicit 413 payload.
		computed := deps.DataSourceMaxBytes + 1024*1024
		if computed > bodyLimit {
			bodyLimit = computed
		}
	}
	bodyLimit = int(math.Max(float64(bodyLimit), 1024*1024))

	app := fiber.New(fiber.Config{
		BodyLimit: bodyLimit,
	})
	app.Use(logger.New())
	app.Use(cors.New())

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "healthy", "service": "mock-loom-api"})
	})

	api := app.Group("/api/v1")
	authHandler := handlers.NewAuthHandler(deps.AuthService)
	workspaceHandler := handlers.NewWorkspaceHandler(deps.WorkspaceService)
	memberHandler := handlers.NewMemberHandler(deps.MemberService)
	integrationHandler := handlers.NewIntegrationHandler(deps.IntegrationService)
	dataSourceHandler := handlers.NewDataSourceHandler(deps.DataSourceService)
	dataDebuggerHandler := handlers.NewDataDebuggerHandler(deps.DataDebugger)
	authMockHandler := handlers.NewAuthMockHandler(deps.AuthMockService)
	runtimeGatewayHandler := handlers.NewRuntimeGatewayHandler(deps.RuntimeGateway)

	app.All("/mock/:workspaceId/:integrationId", runtimeGatewayHandler.Execute)
	app.All("/mock/:workspaceId/:integrationId/*", runtimeGatewayHandler.Execute)

	api.Get("/auth/config", authHandler.GetConfig)

	protected := api.Group("", deps.AuthMiddleware.Authenticate, middleware.IdentityContext(deps.AuthService))
	protected.Get("/auth/me", authHandler.GetMe)
	protected.Post("/auth/logout", authHandler.Logout)

	protected.Get("/workspaces", workspaceHandler.ListWorkspaces)
	protected.Post("/workspaces", middleware.RequireSystemRole(entity.SystemRoleSuperAdmin, entity.SystemRolePlatformAdmin), workspaceHandler.CreateWorkspace)
	protected.Get("/workspaces/:workspaceId", middleware.WorkspaceAccess(deps.AuthzService, entity.WorkspaceRoleViewer), workspaceHandler.GetWorkspace)
	protected.Patch("/workspaces/:workspaceId", middleware.WorkspaceAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), workspaceHandler.UpdateWorkspace)
	protected.Delete("/workspaces/:workspaceId", middleware.WorkspaceAccess(deps.AuthzService, entity.WorkspaceRoleOwner), workspaceHandler.ArchiveWorkspace)

	protected.Get("/workspaces/:workspaceId/members", middleware.WorkspaceAccess(deps.AuthzService, entity.WorkspaceRoleViewer), memberHandler.ListMembers)
	protected.Post("/workspaces/:workspaceId/members/invitations", middleware.WorkspaceAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), memberHandler.InviteMember)
	protected.Patch("/workspaces/:workspaceId/members/:memberId/role", middleware.WorkspaceAccess(deps.AuthzService, entity.WorkspaceRoleOwner), memberHandler.UpdateMemberRole)
	protected.Patch("/workspaces/:workspaceId/members/:memberId/status", middleware.WorkspaceAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), memberHandler.UpdateMemberStatus)

	protected.Get("/workspaces/:workspaceId/integrations", middleware.WorkspaceAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.ListByWorkspace)
	protected.Post("/workspaces/:workspaceId/integrations", middleware.WorkspaceAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), integrationHandler.Create)

	protected.Get("/integrations/:integrationId/overview", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.GetOverview)
	protected.Patch("/integrations/:integrationId/auth", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), integrationHandler.UpdateAuth)
	protected.Get("/integrations/:integrationId/auth-mock", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), authMockHandler.GetPolicy)
	protected.Put("/integrations/:integrationId/auth-mock", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), authMockHandler.UpdatePolicy)
	protected.Get("/integrations/:integrationId/packs", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.GetPacks)
	protected.Post("/integrations/:integrationId/packs", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), integrationHandler.CreatePack)
	protected.Patch("/integrations/:integrationId/packs/:packId", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), integrationHandler.UpdatePack)
	protected.Get("/integrations/:integrationId/packs/:packId/routes", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.GetRoutes)
	protected.Post("/integrations/:integrationId/packs/:packId/imports", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), integrationHandler.ImportRoutes)
	protected.Get("/integrations/:integrationId/data-sources", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), dataSourceHandler.ListByIntegration)
	protected.Post("/integrations/:integrationId/data-sources", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), dataSourceHandler.Create)
	protected.Patch("/integrations/:integrationId/data-sources/:sourceId", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), dataSourceHandler.Update)
	protected.Delete("/integrations/:integrationId/data-sources/:sourceId", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), dataSourceHandler.Delete)
	protected.Post("/integrations/:integrationId/data-sources/:sourceId/baseline", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), dataSourceHandler.UploadBaseline)
	protected.Post("/integrations/:integrationId/data-sources/:sourceId/sync", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), dataSourceHandler.SyncNow)
	protected.Get("/integrations/:integrationId/data-sources/:sourceId/schema", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), dataSourceHandler.GetSchema)
	protected.Put("/integrations/:integrationId/data-sources/:sourceId/schema", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), dataSourceHandler.UpdateSchema)
	protected.Get("/integrations/:integrationId/data-sources/:sourceId/history", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), dataSourceHandler.GetHistory)
	protected.Get("/integrations/:integrationId/data-sources/:sourceId/entities", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), dataDebuggerHandler.ListEntities)
	protected.Post("/integrations/:integrationId/data-sources/:sourceId/entities", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), dataDebuggerHandler.CreateEntity)
	protected.Get("/integrations/:integrationId/data-sources/:sourceId/entities/:entityId/timeline", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), dataDebuggerHandler.ListTimeline)
	protected.Post("/integrations/:integrationId/data-sources/:sourceId/entities/:entityId/rollback", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), dataDebuggerHandler.Rollback)
	protected.Post("/integrations/:integrationId/data-sources/:sourceId/rollback-complete", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleAdmin), dataDebuggerHandler.RollbackComplete)
	protected.Get("/integrations/:integrationId/packs/:packId/endpoints/:endpointId", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.GetEndpoint)
	protected.Get("/integrations/:integrationId/packs/:packId/endpoints/:endpointId/autocomplete-context", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.GetAutocompleteContext)
	protected.Post("/integrations/:integrationId/packs/:packId/endpoints/:endpointId/validate", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.ValidateEndpoint)
	protected.Get("/integrations/:integrationId/packs/:packId/endpoints/:endpointId/revisions", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.GetEndpointRevisions)
	protected.Post("/integrations/:integrationId/packs/:packId/endpoints/:endpointId/revisions/:revisionId/restore", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), integrationHandler.RestoreEndpointRevision)
	protected.Patch("/integrations/:integrationId/packs/:packId/endpoints/:endpointId/route", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), integrationHandler.UpdateEndpointRoute)
	protected.Put("/integrations/:integrationId/packs/:packId/endpoints/:endpointId/contract", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), integrationHandler.UpdateContract)
	protected.Put("/integrations/:integrationId/packs/:packId/endpoints/:endpointId/scenarios", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), integrationHandler.UpdateScenarios)
	protected.Patch("/integrations/:integrationId/packs/:packId/endpoints/:endpointId/auth", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleEditor), integrationHandler.UpdateEndpointAuth)
	protected.Get("/integrations/:integrationId/packs/:packId/endpoints/:endpointId/traffic", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.GetTraffic)
	protected.Get("/integrations/:integrationId/audit-events", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.GetAuditEvents)
	protected.Get("/integrations/:integrationId/entity-map", middleware.IntegrationAccess(deps.AuthzService, entity.WorkspaceRoleViewer), integrationHandler.GetEntityMap)

	if deps.BackupService != nil {
		backupHandler := handlers.NewBackupHandler(deps.BackupService)
		protected.Get("/admin/backup/config", middleware.RequireSystemRole(entity.SystemRoleSuperAdmin), backupHandler.GetConfig)
		protected.Put("/admin/backup/config", middleware.RequireSystemRole(entity.SystemRoleSuperAdmin), backupHandler.UpdateConfig)
		protected.Post("/admin/backup", middleware.RequireSystemRole(entity.SystemRoleSuperAdmin), backupHandler.TriggerBackup)
		protected.Post("/admin/backup/restore", middleware.RequireSystemRole(entity.SystemRoleSuperAdmin), backupHandler.TriggerRestore)
		protected.Get("/admin/backup/download", middleware.RequireSystemRole(entity.SystemRoleSuperAdmin), backupHandler.DownloadDB)
	}

	return app
}
