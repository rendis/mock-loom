package middleware

import (
	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
)

const (
	principalKey     = "principal"
	userIDKey        = "user_id"
	systemRoleKey    = "system_role"
	workspaceRoleKey = "workspace_role"
	integrationIDKey = "integration_id"
)

// Principal is the validated identity extracted from token.
type Principal struct {
	Subject       string
	Email         string
	FullName      string
	EmailVerified *bool
}

// SetPrincipal stores principal in context.
func SetPrincipal(c *fiber.Ctx, principal *Principal) {
	c.Locals(principalKey, principal)
}

// GetPrincipal reads principal from context.
func GetPrincipal(c *fiber.Ctx) (*Principal, bool) {
	value, ok := c.Locals(principalKey).(*Principal)
	return value, ok
}

// SetUserID stores internal user id.
func SetUserID(c *fiber.Ctx, userID string) {
	c.Locals(userIDKey, userID)
}

// GetUserID reads internal user id.
func GetUserID(c *fiber.Ctx) (string, bool) {
	value, ok := c.Locals(userIDKey).(string)
	return value, ok && value != ""
}

// SetSystemRole stores global role.
func SetSystemRole(c *fiber.Ctx, role *entity.SystemRoleAssignment) {
	if role != nil {
		c.Locals(systemRoleKey, role)
	}
}

// GetSystemRole reads global role.
func GetSystemRole(c *fiber.Ctx) *entity.SystemRoleAssignment {
	value, _ := c.Locals(systemRoleKey).(*entity.SystemRoleAssignment)
	return value
}

// SetWorkspaceRole stores effective workspace role.
func SetWorkspaceRole(c *fiber.Ctx, role entity.WorkspaceRole) {
	c.Locals(workspaceRoleKey, role)
}

// SetIntegrationID stores integration ID validated by access middleware.
func SetIntegrationID(c *fiber.Ctx, integrationID string) {
	c.Locals(integrationIDKey, integrationID)
}
