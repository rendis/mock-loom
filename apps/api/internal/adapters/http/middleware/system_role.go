package middleware

import (
	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
)

// RequireSystemRole allows only specified global roles.
func RequireSystemRole(roles ...entity.SystemRole) fiber.Handler {
	allowed := make(map[entity.SystemRole]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}

	return func(c *fiber.Ctx) error {
		systemRole := GetSystemRole(c)
		if systemRole == nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "system role required"})
		}
		if _, ok := allowed[systemRole.Role]; !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "insufficient system role"})
		}
		return c.Next()
	}
}
