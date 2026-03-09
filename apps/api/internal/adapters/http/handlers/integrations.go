package handlers

import (
	"errors"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// IntegrationHandler handles integration endpoints.
type IntegrationHandler struct {
	service *usecase.IntegrationService
}

// NewIntegrationHandler creates IntegrationHandler.
func NewIntegrationHandler(service *usecase.IntegrationService) *IntegrationHandler {
	return &IntegrationHandler{service: service}
}

// ListByWorkspace lists integrations in workspace.
func (h *IntegrationHandler) ListByWorkspace(c *fiber.Ctx) error {
	items, err := h.service.ListByWorkspace(c.UserContext(), strings.TrimSpace(c.Params("workspaceId")))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list integrations"})
	}
	return c.JSON(fiber.Map{"items": items})
}

// Create creates integration in workspace.
func (h *IntegrationHandler) Create(c *fiber.Ctx) error {
	workspaceID := strings.TrimSpace(c.Params("workspaceId"))
	var body struct {
		Name    string `json:"name"`
		Slug    string `json:"slug"`
		BaseURL string `json:"baseUrl"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	item, err := h.service.Create(c.UserContext(), workspaceID, body.Name, body.Slug, body.BaseURL)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid integration payload"})
		case errors.Is(err, usecase.ErrAlreadyExists):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "integration slug already exists"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create integration"})
		}
	}
	return c.Status(fiber.StatusCreated).JSON(item)
}

// GetOverview returns integration overview payload.
func (h *IntegrationHandler) GetOverview(c *fiber.Ctx) error {
	overview, err := h.service.Overview(c.UserContext(), strings.TrimSpace(c.Params("integrationId")))
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch overview"})
	}
	return c.JSON(overview)
}

// UpdateAuth updates integration auth mode.
func (h *IntegrationHandler) UpdateAuth(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	var body struct {
		AuthMode string `json:"authMode"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if err := h.service.UpdateAuthMode(c.UserContext(), integrationID, body.AuthMode); err != nil {
		if errors.Is(err, usecase.ErrInvalidInput) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid auth mode"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update auth mode"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// GetPacks returns integration packs.
func (h *IntegrationHandler) GetPacks(c *fiber.Ctx) error {
	payload, err := h.service.Packs(c.UserContext(), strings.TrimSpace(c.Params("integrationId")))
	if err != nil {
		switch {
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch packs"})
		}
	}
	return c.JSON(fiber.Map{"items": payload})
}

// CreatePack creates integration pack.
func (h *IntegrationHandler) CreatePack(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	var body struct {
		Name     string `json:"name"`
		Slug     string `json:"slug"`
		BasePath string `json:"basePath"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	pack, err := h.service.CreatePack(c.UserContext(), integrationID, body.Name, body.Slug, body.BasePath)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid pack payload"})
		case errors.Is(err, usecase.ErrAlreadyExists):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "pack slug already exists"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create pack"})
		}
	}
	return c.Status(fiber.StatusCreated).JSON(pack)
}

// UpdatePack updates one integration pack.
func (h *IntegrationHandler) UpdatePack(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	packID := strings.TrimSpace(c.Params("packId"))
	var body struct {
		Name        *string                  `json:"name"`
		Slug        *string                  `json:"slug"`
		BasePath    *string                  `json:"basePath"`
		Status      *string                  `json:"status"`
		AuthEnabled *bool                    `json:"authEnabled"`
		AuthPolicy  *usecase.AuthPolicyInput `json:"authPolicy"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	pack, err := h.service.UpdatePack(c.UserContext(), integrationID, packID, usecase.UpdatePackInput{
		Name:        body.Name,
		Slug:        body.Slug,
		BasePath:    body.BasePath,
		Status:      body.Status,
		AuthEnabled: body.AuthEnabled,
		AuthPolicy:  body.AuthPolicy,
	})
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid pack payload"})
		case errors.Is(err, usecase.ErrAlreadyExists):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "pack update conflicts with existing slug or route"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "invalid pack auth policy",
				"details": usecase.ValidationMessages(err),
			})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "pack not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update pack"})
		}
	}
	return c.JSON(pack)
}

// GetRoutes returns pack routes.
func (h *IntegrationHandler) GetRoutes(c *fiber.Ctx) error {
	payload, err := h.service.PackRoutes(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("packId")),
	)
	if err != nil {
		switch {
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "pack not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch routes"})
		}
	}
	return c.JSON(fiber.Map{"items": payload})
}

// ImportRoutes imports routes from OpenAPI/Postman/cURL.
func (h *IntegrationHandler) ImportRoutes(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	packID := strings.TrimSpace(c.Params("packId"))
	var body struct {
		SourceType string `json:"sourceType"`
		Payload    string `json:"payload"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	payload, err := h.service.ImportPackRoutes(c.UserContext(), integrationID, packID, body.SourceType, body.Payload)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput), errors.Is(err, usecase.ErrMalformedRequest):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "sourceType and payload are required"})
		case errors.Is(err, usecase.ErrPayloadTooLarge):
			return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
				"error": "import payload exceeds configured max bytes",
			})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "import payload failed semantic validation",
				"details": usecase.ValidationMessages(err),
			})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "pack not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to import routes"})
		}
	}
	return c.JSON(payload)
}

// GetEndpoint returns endpoint editor payload.
func (h *IntegrationHandler) GetEndpoint(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	packID := strings.TrimSpace(c.Params("packId"))
	endpointID := strings.TrimSpace(c.Params("endpointId"))
	endpoint, err := h.service.Endpoint(c.UserContext(), integrationID, packID, endpointID)
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "endpoint not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch endpoint"})
	}
	return c.JSON(endpoint)
}

// GetAutocompleteContext returns editor autocomplete runtime context.
func (h *IntegrationHandler) GetAutocompleteContext(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	packID := strings.TrimSpace(c.Params("packId"))
	endpointID := strings.TrimSpace(c.Params("endpointId"))
	contextPayload, err := h.service.AutocompleteContext(c.UserContext(), integrationID, packID, endpointID)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid autocomplete context"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "endpoint not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch autocomplete context"})
		}
	}
	return c.JSON(contextPayload)
}

// UpdateContract updates endpoint contract payload.
func (h *IntegrationHandler) UpdateContract(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	packID := strings.TrimSpace(c.Params("packId"))
	endpointID := strings.TrimSpace(c.Params("endpointId"))
	var body struct {
		Contract string `json:"contract"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if err := h.service.UpdateContract(c.UserContext(), integrationID, packID, endpointID, body.Contract); err != nil {
		switch {
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "endpoint not found"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "invalid contract payload",
				"details": usecase.ValidationMessages(err),
			})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update contract"})
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// UpdateScenarios updates endpoint scenarios payload.
func (h *IntegrationHandler) UpdateScenarios(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	packID := strings.TrimSpace(c.Params("packId"))
	endpointID := strings.TrimSpace(c.Params("endpointId"))
	var body struct {
		Scenarios string `json:"scenarios"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if err := h.service.UpdateScenarios(c.UserContext(), integrationID, packID, endpointID, body.Scenarios); err != nil {
		switch {
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "endpoint not found"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "invalid scenarios payload",
				"details": usecase.ValidationMessages(err),
			})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update scenarios"})
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// UpdateEndpointRoute updates endpoint method/path identity inside one pack.
func (h *IntegrationHandler) UpdateEndpointRoute(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	packID := strings.TrimSpace(c.Params("packId"))
	endpointID := strings.TrimSpace(c.Params("endpointId"))
	var body struct {
		Method       string `json:"method"`
		RelativePath string `json:"relativePath"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	route, err := h.service.UpdateEndpointRoute(c.UserContext(), integrationID, packID, endpointID, usecase.UpdateEndpointRouteInput{
		Method:       body.Method,
		RelativePath: body.RelativePath,
	})
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid endpoint route payload"})
		case errors.Is(err, usecase.ErrAlreadyExists):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "endpoint route already exists"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "invalid endpoint route payload",
				"details": usecase.ValidationMessages(err),
			})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "endpoint not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update endpoint route"})
		}
	}

	return c.JSON(fiber.Map{
		"id":       route.ID,
		"packId":   route.PackID,
		"method":   route.Method,
		"path":     route.Path,
		"authMode": route.AuthMode,
	})
}

// GetTraffic returns integration traffic list.
func (h *IntegrationHandler) GetTraffic(c *fiber.Ctx) error {
	items, err := h.service.Traffic(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("packId")),
		strings.TrimSpace(c.Params("endpointId")),
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch traffic"})
	}
	return c.JSON(fiber.Map{"items": items})
}

// UpdateEndpointAuth updates one endpoint auth mode and optional override policy.
func (h *IntegrationHandler) UpdateEndpointAuth(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	packID := strings.TrimSpace(c.Params("packId"))
	endpointID := strings.TrimSpace(c.Params("endpointId"))
	var body struct {
		AuthMode       string                   `json:"authMode"`
		OverridePolicy *usecase.AuthPolicyInput `json:"overridePolicy"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	route, err := h.service.UpdateEndpointAuth(c.UserContext(), integrationID, packID, endpointID, usecase.UpdateEndpointAuthInput{
		AuthMode:       entity.EndpointAuthMode(strings.ToUpper(strings.TrimSpace(body.AuthMode))),
		OverridePolicy: body.OverridePolicy,
	})
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid endpoint auth payload"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "invalid endpoint auth override policy",
				"details": usecase.ValidationMessages(err),
			})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "endpoint not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update endpoint auth"})
		}
	}

	return c.JSON(fiber.Map{
		"id":                     route.ID,
		"packId":                 route.PackID,
		"authMode":               route.AuthMode,
		"authOverridePolicyJson": route.AuthOverridePolicyJSON,
	})
}

// GetAuditEvents returns integration audit events list.
func (h *IntegrationHandler) GetAuditEvents(c *fiber.Ctx) error {
	limit := 0
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "limit must be a positive integer"})
		}
		limit = parsed
	}

	result, err := h.service.AuditEvents(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		limit,
		strings.TrimSpace(c.Query("cursor")),
		strings.TrimSpace(c.Query("resourceType")),
		strings.TrimSpace(c.Query("actor")),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid audit query"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch audit events"})
		}
	}

	response := fiber.Map{"items": result.Items}
	if result.NextCursor != nil {
		response["nextCursor"] = *result.NextCursor
	}
	return c.JSON(response)
}

// GetEntityMap returns integration entity-map nodes.
func (h *IntegrationHandler) GetEntityMap(c *fiber.Ctx) error {
	limit := 0
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "limit must be a positive integer"})
		}
		limit = parsed
	}

	result, err := h.service.EntityMap(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Query("sourceId")),
		strings.TrimSpace(c.Query("search")),
		limit,
		strings.TrimSpace(c.Query("cursor")),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid entity-map query"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch entity map"})
		}
	}

	response := fiber.Map{"items": result.Items}
	if result.NextCursor != nil {
		response["nextCursor"] = *result.NextCursor
	}
	return c.JSON(response)
}

// ValidateEndpoint validates contract/scenarios payloads against runtime rules.
func (h *IntegrationHandler) ValidateEndpoint(c *fiber.Ctx) error {
	var body struct {
		Contract  string `json:"contract"`
		Scenarios string `json:"scenarios"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	valid, issues, err := h.service.ValidateEndpoint(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("packId")),
		strings.TrimSpace(c.Params("endpointId")),
		body.Contract,
		body.Scenarios,
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid validate request"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "endpoint not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to validate endpoint"})
		}
	}

	return c.JSON(fiber.Map{
		"valid":  valid,
		"issues": issues,
	})
}

// GetEndpointRevisions returns endpoint revision history.
func (h *IntegrationHandler) GetEndpointRevisions(c *fiber.Ctx) error {
	limit := 0
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "limit must be a positive integer"})
		}
		limit = parsed
	}

	result, err := h.service.ListEndpointRevisions(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("packId")),
		strings.TrimSpace(c.Params("endpointId")),
		limit,
		strings.TrimSpace(c.Query("cursor")),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid revisions query"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "endpoint not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch revisions"})
		}
	}

	response := fiber.Map{"items": result.Items}
	if result.NextCursor != nil {
		response["nextCursor"] = *result.NextCursor
	}
	return c.JSON(response)
}

// RestoreEndpointRevision restores one endpoint revision.
func (h *IntegrationHandler) RestoreEndpointRevision(c *fiber.Ctx) error {
	revision, err := h.service.RestoreEndpointRevision(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("packId")),
		strings.TrimSpace(c.Params("endpointId")),
		strings.TrimSpace(c.Params("revisionId")),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid restore request"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "invalid revision payload",
				"details": usecase.ValidationMessages(err),
			})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "revision not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to restore revision"})
		}
	}
	return c.JSON(fiber.Map{
		"endpointId": revision.EndpointID,
		"revisionId": revision.ID,
		"restoredAt": revision.CreatedAt,
	})
}
