package middleware

import (
	"errors"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// IdentityContext resolves token principal against internal user registry.
func IdentityContext(auth *usecase.AuthService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		principal, ok := GetPrincipal(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing principal"})
		}

		resolved, err := auth.ResolveIdentity(c.UserContext(), usecase.AuthIdentityInput{
			Subject:       principal.Subject,
			Email:         principal.Email,
			FullName:      principal.FullName,
			EmailVerified: principal.EmailVerified,
		})
		if err != nil {
			switch {
			case errors.Is(err, usecase.ErrUnauthorized):
				return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
			case errors.Is(err, usecase.ErrNotInvited), errors.Is(err, usecase.ErrForbidden):
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
			default:
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "identity resolution failed"})
			}
		}

		SetUserID(c, resolved.User.ID)
		SetSystemRole(c, resolved.SystemRole)
		return c.Next()
	}
}
