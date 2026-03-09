package usecase

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// WorkspaceService handles workspace use cases.
type WorkspaceService struct {
	workspaces ports.WorkspaceRepository
	members    ports.WorkspaceMemberRepository
}

// NewWorkspaceService returns workspace service.
func NewWorkspaceService(workspaces ports.WorkspaceRepository, members ports.WorkspaceMemberRepository) *WorkspaceService {
	return &WorkspaceService{workspaces: workspaces, members: members}
}

// ListWorkspaces returns accessible workspaces.
func (s *WorkspaceService) ListWorkspaces(ctx context.Context, userID string, role *entity.SystemRoleAssignment) ([]*entity.Workspace, error) {
	if role != nil && (role.Role == entity.SystemRoleSuperAdmin || role.Role == entity.SystemRolePlatformAdmin) {
		return s.workspaces.ListAllActive(ctx)
	}
	return s.workspaces.ListByUser(ctx, userID)
}

// CreateWorkspace creates a workspace and assigns creator as owner member.
func (s *WorkspaceService) CreateWorkspace(ctx context.Context, userID string, name, slug, description, metadata string) (*entity.Workspace, error) {
	name = strings.TrimSpace(name)
	slug = strings.TrimSpace(strings.ToLower(slug))
	if name == "" || slug == "" {
		return nil, ErrInvalidInput
	}

	now := time.Now().UTC()
	workspace := &entity.Workspace{
		ID:           uuid.NewString(),
		Name:         name,
		Slug:         slug,
		Description:  strings.TrimSpace(description),
		MetadataJSON: strings.TrimSpace(metadata),
		Status:       entity.WorkspaceStatusActive,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if workspace.MetadataJSON == "" {
		workspace.MetadataJSON = "{}"
	}
	if err := s.workspaces.Create(ctx, workspace); err != nil {
		if errors.Is(err, ports.ErrConflict) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}

	joinedAt := now
	member := &entity.WorkspaceMember{
		ID:               uuid.NewString(),
		WorkspaceID:      workspace.ID,
		UserID:           userID,
		Role:             entity.WorkspaceRoleOwner,
		MembershipStatus: entity.MembershipStatusActive,
		InvitedBy:        nil,
		JoinedAt:         &joinedAt,
		CreatedAt:        now,
	}
	_ = s.members.Create(ctx, member)

	return workspace, nil
}

// GetWorkspace returns workspace by ID.
func (s *WorkspaceService) GetWorkspace(ctx context.Context, workspaceID string) (*entity.Workspace, error) {
	return s.workspaces.FindByID(ctx, workspaceID)
}

// UpdateWorkspace updates mutable fields.
func (s *WorkspaceService) UpdateWorkspace(ctx context.Context, workspace *entity.Workspace) error {
	workspace.UpdatedAt = time.Now().UTC()
	return s.workspaces.Update(ctx, workspace)
}

// ArchiveWorkspace archives workspace.
func (s *WorkspaceService) ArchiveWorkspace(ctx context.Context, workspaceID string) error {
	return s.workspaces.Archive(ctx, workspaceID, time.Now().UTC())
}
