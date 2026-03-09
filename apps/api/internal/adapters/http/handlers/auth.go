package handlers

import (
	"errors"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/adapters/http/middleware"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// AuthHandler handles auth endpoints.
type AuthHandler struct {
	auth *usecase.AuthService
}

// NewAuthHandler returns AuthHandler.
func NewAuthHandler(auth *usecase.AuthService) *AuthHandler {
	return &AuthHandler{auth: auth}
}

// GetConfig returns frontend auth runtime config.
func (h *AuthHandler) GetConfig(c *fiber.Ctx) error {
	return c.JSON(h.auth.ClientConfig())
}

// GetMe returns authenticated identity context.
func (h *AuthHandler) GetMe(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing user context"})
	}
	payload, err := h.auth.Me(c.UserContext(), userID)
	if err != nil {
		if errors.Is(err, usecase.ErrUnauthorized) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch profile"})
	}
	return c.JSON(payload)
}

// Logout is no-op for stateless bearer mode.
func (h *AuthHandler) Logout(c *fiber.Ctx) error {
	return c.SendStatus(fiber.StatusNoContent)
}
