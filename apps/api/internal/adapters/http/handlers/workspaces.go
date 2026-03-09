package handlers

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/adapters/http/middleware"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// WorkspaceHandler handles workspace APIs.
type WorkspaceHandler struct {
	service *usecase.WorkspaceService
}

// NewWorkspaceHandler returns handler.
func NewWorkspaceHandler(service *usecase.WorkspaceService) *WorkspaceHandler {
	return &WorkspaceHandler{service: service}
}

// ListWorkspaces returns accessible workspaces for current user.
func (h *WorkspaceHandler) ListWorkspaces(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing user context"})
	}
	items, err := h.service.ListWorkspaces(c.UserContext(), userID, middleware.GetSystemRole(c))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list workspaces"})
	}
	return c.JSON(fiber.Map{"items": items})
}

// CreateWorkspace creates a new workspace.
func (h *WorkspaceHandler) CreateWorkspace(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing user context"})
	}

	var body struct {
		Name        string `json:"name"`
		Slug        string `json:"slug"`
		Description string `json:"description"`
		Metadata    string `json:"metadata"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	item, err := h.service.CreateWorkspace(c.UserContext(), userID, body.Name, body.Slug, body.Description, body.Metadata)
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name and slug are required"})
		case errors.Is(err, usecase.ErrAlreadyExists):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "workspace slug already exists"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create workspace"})
		}
	}
	return c.Status(fiber.StatusCreated).JSON(item)
}

// GetWorkspace returns workspace details.
func (h *WorkspaceHandler) GetWorkspace(c *fiber.Ctx) error {
	item, err := h.service.GetWorkspace(c.UserContext(), strings.TrimSpace(c.Params("workspaceId")))
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "workspace not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch workspace"})
	}
	return c.JSON(item)
}

// UpdateWorkspace updates workspace fields.
func (h *WorkspaceHandler) UpdateWorkspace(c *fiber.Ctx) error {
	workspaceID := strings.TrimSpace(c.Params("workspaceId"))
	workspace, err := h.service.GetWorkspace(c.UserContext(), workspaceID)
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "workspace not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch workspace"})
	}

	var body struct {
		Name        *string `json:"name"`
		Slug        *string `json:"slug"`
		Description *string `json:"description"`
		Metadata    *string `json:"metadata"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	if body.Name != nil {
		workspace.Name = strings.TrimSpace(*body.Name)
	}
	if body.Slug != nil {
		workspace.Slug = strings.TrimSpace(strings.ToLower(*body.Slug))
	}
	if body.Description != nil {
		workspace.Description = strings.TrimSpace(*body.Description)
	}
	if body.Metadata != nil {
		workspace.MetadataJSON = strings.TrimSpace(*body.Metadata)
	}

	if err := h.service.UpdateWorkspace(c.UserContext(), workspace); err != nil {
		if errors.Is(err, ports.ErrConflict) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "workspace slug already exists"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update workspace"})
	}
	return c.JSON(workspace)
}

// ArchiveWorkspace archives workspace.
func (h *WorkspaceHandler) ArchiveWorkspace(c *fiber.Ctx) error {
	if err := h.service.ArchiveWorkspace(c.UserContext(), strings.TrimSpace(c.Params("workspaceId"))); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to archive workspace"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}
