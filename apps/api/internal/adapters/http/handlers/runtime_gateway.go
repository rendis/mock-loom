package handlers

import (
	"errors"
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// RuntimeGatewayHandler handles `/mock/:workspaceId/:integrationId/*path` execution.
type RuntimeGatewayHandler struct {
	service *usecase.RuntimeGatewayService
}

// NewRuntimeGatewayHandler returns RuntimeGatewayHandler.
func NewRuntimeGatewayHandler(service *usecase.RuntimeGatewayService) *RuntimeGatewayHandler {
	return &RuntimeGatewayHandler{service: service}
}

// Execute resolves endpoint, evaluates auth/scenarios, and returns runtime mock response.
func (h *RuntimeGatewayHandler) Execute(c *fiber.Ctx) error {
	path := strings.TrimSpace(c.Params("*"))
	if path == "" {
		path = "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	headers := map[string]string{}
	for key, values := range c.GetReqHeaders() {
		if len(values) == 0 {
			continue
		}
		headers[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(values[0])
	}
	queryValues := url.Values{}
	for key, value := range c.Queries() {
		queryValues.Set(strings.TrimSpace(key), value)
	}

	result, err := h.service.Execute(c.UserContext(), usecase.RuntimeExecuteInput{
		WorkspaceID:   strings.TrimSpace(c.Params("workspaceId")),
		IntegrationID: strings.TrimSpace(c.Params("integrationId")),
		Method:        c.Method(),
		Path:          path,
		Headers:       headers,
		Query:         queryValues,
		BodyRaw:       c.BodyRaw(),
	})
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid runtime request"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "runtime endpoint not found"})
		case errors.Is(err, usecase.ErrUnauthorized):
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "runtime auth denied"})
		case errors.Is(err, usecase.ErrForbidden):
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "runtime auth denied"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "runtime mutation payload is invalid",
				"details": usecase.ValidationMessages(err),
			})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "runtime execution failed"})
		}
	}

	for key, value := range result.Headers {
		if strings.TrimSpace(key) == "" {
			continue
		}
		c.Set(key, value)
	}
	c.Status(result.StatusCode)
	if len(result.BodyRaw) == 0 {
		return c.SendStatus(result.StatusCode)
	}
	return c.Send(result.BodyRaw)
}
