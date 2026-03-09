package handlers

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/rendis/mock-loom/apps/api/internal/adapters/http/middleware"
	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

// MemberHandler handles workspace member APIs.
type MemberHandler struct {
	service *usecase.MemberService
}

// NewMemberHandler returns member handler.
func NewMemberHandler(service *usecase.MemberService) *MemberHandler {
	return &MemberHandler{service: service}
}

// ListMembers lists workspace members.
func (h *MemberHandler) ListMembers(c *fiber.Ctx) error {
	workspaceID := strings.TrimSpace(c.Params("workspaceId"))
	items, err := h.service.ListMembers(c.UserContext(), workspaceID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list members"})
	}
	return c.JSON(fiber.Map{"items": items})
}

// InviteMember invites user by email.
func (h *MemberHandler) InviteMember(c *fiber.Ctx) error {
	workspaceID := strings.TrimSpace(c.Params("workspaceId"))
	userID, ok := middleware.GetUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing user context"})
	}

	var body struct {
		Email    string `json:"email"`
		FullName string `json:"fullName"`
		Role     string `json:"role"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	member, err := h.service.InviteMember(c.UserContext(), workspaceID, userID, body.Email, body.FullName, entity.WorkspaceRole(strings.ToUpper(strings.TrimSpace(body.Role))))
	if err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid invite payload"})
		case errors.Is(err, usecase.ErrAlreadyExists):
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "member already exists"})
		case errors.Is(err, usecase.ErrForbidden):
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "role not allowed"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to invite member"})
		}
	}

	return c.Status(fiber.StatusCreated).JSON(member)
}

// UpdateMemberRole updates member role.
func (h *MemberHandler) UpdateMemberRole(c *fiber.Ctx) error {
	memberID := strings.TrimSpace(c.Params("memberId"))
	var body struct {
		Role string `json:"role"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	if err := h.service.UpdateMemberRole(c.UserContext(), memberID, entity.WorkspaceRole(strings.ToUpper(strings.TrimSpace(body.Role)))); err != nil {
		switch {
		case errors.Is(err, usecase.ErrInvalidInput):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid role"})
		case errors.Is(err, usecase.ErrForbidden):
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "role update denied"})
		default:
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update role"})
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// UpdateMemberStatus updates membership status.
func (h *MemberHandler) UpdateMemberStatus(c *fiber.Ctx) error {
	memberID := strings.TrimSpace(c.Params("memberId"))
	var body struct {
		Status string `json:"status"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	if err := h.service.UpdateMemberStatus(c.UserContext(), memberID, entity.MembershipStatus(strings.ToUpper(strings.TrimSpace(body.Status)))); err != nil {
		if errors.Is(err, usecase.ErrInvalidInput) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid status"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update status"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}
