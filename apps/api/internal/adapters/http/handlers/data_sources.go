package handlers

import (
	"errors"
	"io"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// DataSourceHandler handles data source endpoints.
type DataSourceHandler struct {
	service *usecase.DataSourceService
}

// NewDataSourceHandler creates DataSourceHandler.
func NewDataSourceHandler(service *usecase.DataSourceService) *DataSourceHandler {
	return &DataSourceHandler{service: service}
}

// ListByIntegration lists data sources in integration.
func (h *DataSourceHandler) ListByIntegration(c *fiber.Ctx) error {
	items, err := h.service.ListByIntegration(c.UserContext(), strings.TrimSpace(c.Params("integrationId")))
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
		}
		if errors.Is(err, usecase.ErrInvalidInput) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid integration id"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list data sources"})
	}
	return c.JSON(fiber.Map{"items": items})
}

// Create creates one data source.
func (h *DataSourceHandler) Create(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	var body struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
		Kind string `json:"kind"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	item, err := h.service.Create(c.UserContext(), integrationID, body.Name, body.Slug, body.Kind)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid data source payload"})
		case errors.Is(err, usecase.ErrAlreadyExists):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "data source slug already exists"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "integration not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create data source"})
		}
	}
	return c.Status(fiber.StatusCreated).JSON(item)
}

// Update updates one data source metadata.
func (h *DataSourceHandler) Update(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	sourceID := strings.TrimSpace(c.Params("sourceId"))
	var body struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	item, err := h.service.Update(c.UserContext(), integrationID, sourceID, body.Name, body.Slug)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid data source payload"})
		case errors.Is(err, usecase.ErrAlreadyExists):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "data source slug already exists"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "data source not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update data source"})
		}
	}
	return c.JSON(item)
}

// Delete removes one data source metadata and associated baseline state.
func (h *DataSourceHandler) Delete(c *fiber.Ctx) error {
	if err := h.service.Delete(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("sourceId")),
	); err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid data source context"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "data source not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to delete data source"})
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// UploadBaseline uploads and ingests a baseline file.
func (h *DataSourceHandler) UploadBaseline(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	sourceID := strings.TrimSpace(c.Params("sourceId"))

	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "baseline file is required"})
	}
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "failed to read baseline file"})
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "failed to read baseline content"})
	}

	csvDelimiter := strings.TrimSpace(c.FormValue("csvDelimiter"))
	if csvDelimiter == "" {
		csvDelimiter = strings.TrimSpace(c.FormValue("csv_delimiter"))
	}

	result, err := h.service.UploadBaseline(
		c.UserContext(),
		integrationID,
		sourceID,
		fileHeader.Filename,
		content,
		csvDelimiter,
	)
	if err != nil {
		switch {
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "data source not found"})
		case errors.Is(err, usecase.ErrInvalidInput), errors.Is(err, usecase.ErrMalformedRequest):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid baseline payload"})
		case errors.Is(err, usecase.ErrPayloadTooLarge):
			return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"error": "baseline payload exceeds configured max bytes"})
		case errors.Is(err, usecase.ErrSemanticValidation):
			return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
				"error":   "baseline payload failed semantic validation",
				"details": usecase.ValidationMessages(err),
			})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to ingest baseline"})
		}
	}
	return c.JSON(result)
}

// SyncNow refreshes source sync metadata.
func (h *DataSourceHandler) SyncNow(c *fiber.Ctx) error {
	result, err := h.service.SyncNow(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("sourceId")),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid source context"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "data source not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to sync data source"})
		}
	}
	return c.JSON(fiber.Map{
		"sourceId":    result.SourceID,
		"status":      result.Status,
		"lastSyncAt":  result.LastSyncAt,
		"recordCount": result.RecordCount,
	})
}

// GetSchema returns active source schema JSON.
func (h *DataSourceHandler) GetSchema(c *fiber.Ctx) error {
	schema, err := h.service.GetSchema(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("sourceId")),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid source context"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "source schema not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch schema"})
		}
	}
	return c.JSON(schemaResponse(schema))
}

// UpdateSchema updates top-level source schema type overrides.
func (h *DataSourceHandler) UpdateSchema(c *fiber.Ctx) error {
	integrationID := strings.TrimSpace(c.Params("integrationId"))
	sourceID := strings.TrimSpace(c.Params("sourceId"))
	var body struct {
		Fields []struct {
			Key  string `json:"key"`
			Type string `json:"type"`
		} `json:"fields"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	fields := make([]usecase.DataSourceSchemaFieldInput, 0, len(body.Fields))
	for _, field := range body.Fields {
		fields = append(fields, usecase.DataSourceSchemaFieldInput{
			Key:  field.Key,
			Type: field.Type,
		})
	}

	schema, err := h.service.UpdateSchema(c.UserContext(), integrationID, sourceID, fields)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid schema payload"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "source schema not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update schema"})
		}
	}

	return c.JSON(schemaResponse(schema))
}

// GetHistory returns source-scoped immutable history.
func (h *DataSourceHandler) GetHistory(c *fiber.Ctx) error {
	limit := 0
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "limit must be a positive integer"})
		}
		limit = parsed
	}

	result, err := h.service.ListHistory(
		c.UserContext(),
		strings.TrimSpace(c.Params("integrationId")),
		strings.TrimSpace(c.Params("sourceId")),
		limit,
		strings.TrimSpace(c.Query("cursor")),
	)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid source context"})
		case errors.Is(err, ports.ErrNotFound):
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "data source not found"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch source history"})
		}
	}

	response := fiber.Map{"items": result.Items}
	if result.NextCursor != nil {
		response["nextCursor"] = *result.NextCursor
	}
	return c.JSON(response)
}

func schemaResponse(schema *entity.DataSourceSchema) fiber.Map {
	return fiber.Map{
		"sourceId":   schema.SourceID,
		"schemaJson": schema.SchemaJSON,
		"fields":     schema.Fields,
		"warnings":   schema.Warnings,
	}
}
