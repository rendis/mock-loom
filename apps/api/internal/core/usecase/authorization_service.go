package usecase

import (
	"context"
	"errors"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// AuthorizationService handles role-based checks.
type AuthorizationService struct {
	workspaces   ports.WorkspaceRepository
	members      ports.WorkspaceMemberRepository
	integrations ports.IntegrationRepository
}

// NewAuthorizationService returns authorization service.
func NewAuthorizationService(workspaces ports.WorkspaceRepository, members ports.WorkspaceMemberRepository, integrations ports.IntegrationRepository) *AuthorizationService {
	return &AuthorizationService{workspaces: workspaces, members: members, integrations: integrations}
}

// WorkspaceAccess returns effective workspace role when allowed.
func (s *AuthorizationService) WorkspaceAccess(ctx context.Context, userID, workspaceID string, globalRole *entity.SystemRoleAssignment, required entity.WorkspaceRole) (entity.WorkspaceRole, error) {
	if globalRole != nil {
		switch globalRole.Role {
		case entity.SystemRoleSuperAdmin:
			if entity.WorkspaceRoleOwner.HasPermission(required) {
				return entity.WorkspaceRoleOwner, nil
			}
		case entity.SystemRolePlatformAdmin:
			if entity.WorkspaceRoleAdmin.HasPermission(required) {
				return entity.WorkspaceRoleAdmin, nil
			}
		}
	}

	workspace, err := s.workspaces.FindByID(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	if workspace.Status != entity.WorkspaceStatusActive {
		return "", ErrForbidden
	}

	member, err := s.members.FindActiveByUserAndWorkspace(ctx, userID, workspaceID)
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return "", ErrForbidden
		}
		return "", err
	}
	if !member.Role.HasPermission(required) {
		return "", ErrForbidden
	}
	return member.Role, nil
}

// IntegrationAccess validates integration access and returns integration.
func (s *AuthorizationService) IntegrationAccess(ctx context.Context, userID, integrationID string, globalRole *entity.SystemRoleAssignment, required entity.WorkspaceRole) (*entity.Integration, error) {
	integration, err := s.integrations.FindByID(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	if _, err := s.WorkspaceAccess(ctx, userID, integration.WorkspaceID, globalRole, required); err != nil {
		return nil, err
	}
	return integration, nil
}
