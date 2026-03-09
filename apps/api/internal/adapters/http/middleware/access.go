package middleware

import (
	"errors"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// WorkspaceAccess verifies workspace authorization.
func WorkspaceAccess(authz *usecase.AuthorizationService, required entity.WorkspaceRole) fiber.Handler {
	return func(c *fiber.Ctx) error {
		workspaceID := c.Params("workspaceId")
		if workspaceID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "workspaceId is required"})
		}
		userID, ok := GetUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing user context"})
		}
		role, err := authz.WorkspaceAccess(c.UserContext(), userID, workspaceID, GetSystemRole(c), required)
		if err != nil {
			switch {
			case errors.Is(err, ports.ErrNotFound):
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "workspace not found"})
			case errors.Is(err, usecase.ErrForbidden):
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "workspace access denied"})
			default:
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "workspace authorization failed"})
			}
		}
		SetWorkspaceRole(c, role)
		return c.Next()
	}
}

// IntegrationAccess verifies access through integration ownership workspace.
func IntegrationAccess(authz *usecase.AuthorizationService, required entity.WorkspaceRole) fiber.Handler {
	return func(c *fiber.Ctx) error {
		integrationID := c.Params("integrationId")
		if integrationID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "integrationId is required"})
		}
		userID, ok := GetUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing user context"})
		}
		_, err := authz.IntegrationAccess(c.UserContext(), userID, integrationID, GetSystemRole(c), required)
		if err != nil {
			switch {
			case errors.Is(err, ports.ErrNotFound):
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
			case errors.Is(err, usecase.ErrForbidden):
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "integration access denied"})
			default:
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "integration authorization failed"})
			}
		}
		SetIntegrationID(c, integrationID)
		return c.Next()
	}
}
