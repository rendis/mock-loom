package handlers

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// DataDebuggerHandler handles entities, timeline, and rollback endpoints.
type DataDebuggerHandler struct {
	service *usecase.DataDebuggerService
}

// NewDataDebuggerHandler creates DataDebuggerHandler.
func NewDataDebuggerHandler(service *usecase.DataDebuggerService) *DataDebuggerHandler {
	return &DataDebuggerHandler{service: service}
}

// ListEntities returns debugger entity rows for one source.
func (h *DataDebuggerHandler) ListEntities(c *fiber.Ctx) error {
	limit := 0
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "limit must be a positive integer"})
		}
		limit = parsed
	}

	result, err := h.service.ListEntities(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("sourceId")),
		usecase.ListEntitiesInput{
			Search: strings.TrimSpace(c.Query("search")),
			Sort:   strings.TrimSpace(c.Query("sort")),
			Limit:  limit,
			Cursor: strings.TrimSpace(c.Query("cursor")),
		},
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid source context"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "data source not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch entities"})
		}
	}
	response := fiber.Map{
		"items": result.Items,
		"total": result.Total,
	}
	if result.NextCursor != nil {
		response["nextCursor"] = *result.NextCursor
	}
	return c.JSON(response)
}

// CreateEntity appends one entity mutation and projection update.
func (h *DataDebuggerHandler) CreateEntity(c *fiber.Ctx) error {
	var body struct {
		EntityID string          `json:"entityId"`
		Payload  json.RawMessage `json:"payload"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if strings.TrimSpace(body.EntityID) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "entityId is required"})
	}
	if len(body.Payload) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "payload is required"})
	}

	var payload map[string]any
	if err := json.Unmarshal(body.Payload, &payload); err != nil || payload == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "payload must be a JSON object"})
	}

	result, err := h.service.CreateEntity(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("sourceId")),
		strings.TrimSpace(body.EntityID),
		payload,
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid create entity payload"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "data source snapshot not found"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "entity payload is not valid",
				"details": usecase.ValidationMessages(err),
			})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create entity"})
		}
	}

	return c.JSON(fiber.Map{
		"entityId":  result.EntityID,
		"eventId":   result.EventID,
		"createdAt": result.CreatedAt,
	})
}

// ListTimeline returns immutable timeline events for one entity.
func (h *DataDebuggerHandler) ListTimeline(c *fiber.Ctx) error {
	items, err := h.service.ListTimeline(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("sourceId")),
		strings.TrimSpace(c.Params("entityId")),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid timeline context"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "data source not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch timeline"})
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// Rollback executes one compensation rollback mutation.
func (h *DataDebuggerHandler) Rollback(c *fiber.Ctx) error {
	var body struct {
		TargetEventID string `json:"targetEventId"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	result, err := h.service.RollbackEntity(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("sourceId")),
		strings.TrimSpace(c.Params("entityId")),
		strings.TrimSpace(body.TargetEventID),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "targetEventId is required"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "rollback target not found"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "rollback payload is not restorable",
				"details": usecase.ValidationMessages(err),
			})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to rollback entity"})
		}
	}

	return c.JSON(fiber.Map{
		"entityId":        result.EntityID,
		"rollbackEventId": result.RollbackEventID,
		"restoredAt":      result.RestoredAt,
	})
}

// RollbackComplete restores source projection to initial baseline snapshot.
func (h *DataDebuggerHandler) RollbackComplete(c *fiber.Ctx) error {
	result, err := h.service.RollbackComplete(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("sourceId")),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid rollback-complete context"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "rollback baseline not found"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "rollback-complete payload is invalid",
				"details": usecase.ValidationMessages(err),
			})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to rollback data source"})
		}
	}

	return c.JSON(fiber.Map{
		"sourceId":           result.SourceID,
		"restoredSnapshotId": result.RestoredSnapshotID,
		"restoredAt":         result.RestoredAt,
		"upsertedEntities":   result.UpsertedEntities,
		"removedEntities":    result.RemovedEntities,
		"compensationEvents": result.CompensationEvents,
	})
}
