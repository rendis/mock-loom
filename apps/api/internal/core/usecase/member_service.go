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

// MemberService handles workspace membership flows.
type MemberService struct {
	users   ports.UserRepository
	members ports.WorkspaceMemberRepository
}

// NewMemberService returns member service.
func NewMemberService(users ports.UserRepository, members ports.WorkspaceMemberRepository) *MemberService {
	return &MemberService{users: users, members: members}
}

// ListMembers returns members for workspace.
func (s *MemberService) ListMembers(ctx context.Context, workspaceID string) ([]*entity.WorkspaceMemberView, error) {
	members, err := s.members.ListByWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	items := make([]*entity.WorkspaceMemberView, 0, len(members))
	for _, member := range members {
		userEmail := ""
		userFullName := ""

		user, userErr := s.users.FindByID(ctx, member.UserID)
		if userErr == nil {
			userEmail = user.Email
			userFullName = user.FullName
		} else if !errors.Is(userErr, ports.ErrNotFound) {
			return nil, userErr
		}

		items = append(items, &entity.WorkspaceMemberView{
			ID:               member.ID,
			WorkspaceID:      member.WorkspaceID,
			UserID:           member.UserID,
			Role:             member.Role,
			MembershipStatus: member.MembershipStatus,
			InvitedBy:        member.InvitedBy,
			JoinedAt:         member.JoinedAt,
			CreatedAt:        member.CreatedAt,
			UserEmail:        userEmail,
			UserFullName:     userFullName,
		})
	}

	return items, nil
}

// InviteMember invites user by email.
func (s *MemberService) InviteMember(ctx context.Context, workspaceID, invitedBy, email, fullName string, role entity.WorkspaceRole) (*entity.WorkspaceMember, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	fullName = strings.TrimSpace(fullName)
	if email == "" || role == "" {
		return nil, ErrInvalidInput
	}
	if !entity.ValidWorkspaceRole(role) {
		return nil, ErrInvalidInput
	}
	if role == entity.WorkspaceRoleOwner {
		return nil, ErrForbidden
	}

	user, err := s.users.FindByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, ports.ErrNotFound) {
			return nil, err
		}
		now := time.Now().UTC()
		user = &entity.User{
			ID:        uuid.NewString(),
			Email:     email,
			FullName:  chooseFullName(fullName, email),
			Status:    entity.UserStatusInvited,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := s.users.Create(ctx, user); err != nil {
			if !errors.Is(err, ports.ErrConflict) {
				return nil, err
			}
			user, err = s.users.FindByEmail(ctx, email)
			if err != nil {
				return nil, err
			}
		}
	}

	if _, err := s.members.FindByUserAndWorkspace(ctx, user.ID, workspaceID); err == nil {
		return nil, ErrAlreadyExists
	} else if !errors.Is(err, ports.ErrNotFound) {
		return nil, err
	}

	now := time.Now().UTC()
	membershipStatus := entity.MembershipStatusPending
	var joinedAt *time.Time
	if user.Status == entity.UserStatusActive && user.ExternalIdentityID != nil {
		membershipStatus = entity.MembershipStatusActive
		joinedAt = &now
	}

	member := &entity.WorkspaceMember{
		ID:               uuid.NewString(),
		WorkspaceID:      workspaceID,
		UserID:           user.ID,
		Role:             role,
		MembershipStatus: membershipStatus,
		InvitedBy:        &invitedBy,
		JoinedAt:         joinedAt,
		CreatedAt:        now,
	}
	if err := s.members.Create(ctx, member); err != nil {
		if errors.Is(err, ports.ErrConflict) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}
	return member, nil
}

// UpdateMemberRole updates a workspace member role.
func (s *MemberService) UpdateMemberRole(ctx context.Context, memberID string, role entity.WorkspaceRole) error {
	if role == "" {
		return ErrInvalidInput
	}
	if !entity.ValidWorkspaceRole(role) {
		return ErrInvalidInput
	}
	if role == entity.WorkspaceRoleOwner {
		return ErrForbidden
	}
	return s.members.UpdateRole(ctx, memberID, role)
}

// UpdateMemberStatus updates membership status.
func (s *MemberService) UpdateMemberStatus(ctx context.Context, memberID string, status entity.MembershipStatus) error {
	if status != entity.MembershipStatusActive && status != entity.MembershipStatusPending {
		return ErrInvalidInput
	}
	var joinedAt *time.Time
	if status == entity.MembershipStatusActive {
		now := time.Now().UTC()
		joinedAt = &now
	}
	return s.members.UpdateStatus(ctx, memberID, status, joinedAt)
}

func chooseFullName(fullName, email string) string {
	if strings.TrimSpace(fullName) != "" {
		return fullName
	}
	return email
}
