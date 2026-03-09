package handlers

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// AuthMockHandler handles integration auth-mock policy endpoints.
type AuthMockHandler struct {
	service *usecase.AuthMockService
}

// NewAuthMockHandler returns AuthMockHandler.
func NewAuthMockHandler(service *usecase.AuthMockService) *AuthMockHandler {
	return &AuthMockHandler{service: service}
}

// GetPolicy returns the current integration auth-mock policy.
func (h *AuthMockHandler) GetPolicy(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	policy, err := h.service.GetPolicy(c.UserContext(), integrationID)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid auth-mock context"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch auth-mock policy"})
		}
	}
	return c.JSON(mapAuthMockPolicy(policy))
}

// UpdatePolicy validates and updates integration auth-mock policy.
func (h *AuthMockHandler) UpdatePolicy(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	var body struct {
		Mode       string                        `json:"mode"`
		Prebuilt   entity.AuthMockPrebuiltPolicy `json:"prebuilt"`
		CustomExpr string                        `json:"customExpr"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	policy, err := h.service.UpdatePolicy(c.UserContext(), integrationID, usecase.UpdateAuthMockPolicyInput{
		Mode:       body.Mode,
		Prebuilt:   body.Prebuilt,
		CustomExpr: body.CustomExpr,
	})
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid auth-mock payload"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "invalid auth-mock policy",
				"details": usecase.ValidationMessages(err),
			})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update auth-mock policy"})
		}
	}
	return c.JSON(mapAuthMockPolicy(policy))
}

func mapAuthMockPolicy(policy *entity.AuthMockPolicy) fiber.Map {
	if policy == nil {
		return fiber.Map{
			"mode":       entity.AuthMockPolicyModePrebuilt,
			"prebuilt":   fiber.Map{},
			"customExpr": "",
		}
	}
	return fiber.Map{
		"integrationId": policy.IntegrationID,
		"mode":          policy.Mode,
		"prebuilt":      policy.Prebuilt,
		"customExpr":    policy.CustomExpr,
		"updatedAt":     policy.UpdatedAt,
	}
}
