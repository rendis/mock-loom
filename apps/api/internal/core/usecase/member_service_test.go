package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

func TestInviteMemberCreatesShadowUser(t *testing.T) {
	t.Parallel()

	users := newUserRepoStub()
	members := newMemberRepoStub()
	service := NewMemberService(users, members)

	member, err := service.InviteMember(context.Background(), "ws-1", "admin-1", "new@example.com", "", entity.WorkspaceRoleViewer)
	if err != nil {
		t.Fatalf("invite member: %v", err)
	}
	if member.MembershipStatus != entity.MembershipStatusPending {
		t.Fatalf("expected pending membership, got %s", member.MembershipStatus)
	}
	if member.Role != entity.WorkspaceRoleViewer {
		t.Fatalf("expected viewer role, got %s", member.Role)
	}
	if member.InvitedBy == nil || *member.InvitedBy != "admin-1" {
		t.Fatalf("expected invited_by to be admin-1, got %v", member.InvitedBy)
	}

	user, err := users.FindByEmail(context.Background(), "new@example.com")
	if err != nil {
		t.Fatalf("find user by email: %v", err)
	}
	if user.Status != entity.UserStatusInvited {
		t.Fatalf("expected invited user status, got %s", user.Status)
	}
	if user.ExternalIdentityID != nil {
		t.Fatalf("expected external identity to be nil, got %v", user.ExternalIdentityID)
	}
	if user.FullName != "new@example.com" {
		t.Fatalf("expected default full name to email, got %q", user.FullName)
	}
}

func TestInviteMemberDuplicateReturnsAlreadyExists(t *testing.T) {
	t.Parallel()

	users := newUserRepoStub()
	members := newMemberRepoStub()
	service := NewMemberService(users, members)

	_, err := service.InviteMember(context.Background(), "ws-1", "admin-1", "dupe@example.com", "", entity.WorkspaceRoleViewer)
	if err != nil {
		t.Fatalf("initial invite member: %v", err)
	}

	_, err = service.InviteMember(context.Background(), "ws-1", "admin-1", "dupe@example.com", "", entity.WorkspaceRoleViewer)
	if !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("expected ErrAlreadyExists, got %v", err)
	}
}

func TestInviteMemberRejectsOwnerRole(t *testing.T) {
	t.Parallel()

	users := newUserRepoStub()
	members := newMemberRepoStub()
	service := NewMemberService(users, members)

	_, err := service.InviteMember(context.Background(), "ws-1", "admin-1", "owner@example.com", "Owner", entity.WorkspaceRoleOwner)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestUpdateMemberStatusRejectsInvalid(t *testing.T) {
	t.Parallel()

	users := newUserRepoStub()
	members := newMemberRepoStub()
	service := NewMemberService(users, members)

	err := service.UpdateMemberStatus(context.Background(), "member-1", entity.MembershipStatus("INVALID"))
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

type userRepoStub struct {
	byID    map[string]*entity.User
	byEmail map[string]*entity.User
}

func newUserRepoStub() *userRepoStub {
	return &userRepoStub{
		byID:    map[string]*entity.User{},
		byEmail: map[string]*entity.User{},
	}
}

func (r *userRepoStub) Count(_ context.Context) (int, error) {
	return len(r.byID), nil
}

func (r *userRepoStub) FindByEmail(_ context.Context, email string) (*entity.User, error) {
	key := strings.ToLower(strings.TrimSpace(email))
	user, ok := r.byEmail[key]
	if !ok {
		return nil, ports.ErrNotFound
	}
	return cloneUser(user), nil
}

func (r *userRepoStub) FindByID(_ context.Context, id string) (*entity.User, error) {
	user, ok := r.byID[id]
	if !ok {
		return nil, ports.ErrNotFound
	}
	return cloneUser(user), nil
}

func (r *userRepoStub) Create(_ context.Context, user *entity.User) error {
	key := strings.ToLower(strings.TrimSpace(user.Email))
	if _, exists := r.byEmail[key]; exists {
		return ports.ErrConflict
	}
	stored := cloneUser(user)
	r.byID[stored.ID] = stored
	r.byEmail[key] = stored
	return nil
}

func (r *userRepoStub) ActivateAndLink(_ context.Context, userID, externalID string, activatedAt time.Time) error {
	user, ok := r.byID[userID]
	if !ok {
		return ports.ErrNotFound
	}
	user.Status = entity.UserStatusActive
	user.ExternalIdentityID = &externalID
	user.UpdatedAt = activatedAt
	return nil
}

type memberRepoStub struct {
	byID            map[string]*entity.WorkspaceMember
	byUserWorkspace map[string]string
}

func newMemberRepoStub() *memberRepoStub {
	return &memberRepoStub{
		byID:            map[string]*entity.WorkspaceMember{},
		byUserWorkspace: map[string]string{},
	}
}

func (r *memberRepoStub) ListByWorkspace(_ context.Context, workspaceID string) ([]*entity.WorkspaceMember, error) {
	items := make([]*entity.WorkspaceMember, 0)
	for _, member := range r.byID {
		if member.WorkspaceID == workspaceID {
			items = append(items, cloneMember(member))
		}
	}
	return items, nil
}

func (r *memberRepoStub) FindByID(_ context.Context, id string) (*entity.WorkspaceMember, error) {
	member, ok := r.byID[id]
	if !ok {
		return nil, ports.ErrNotFound
	}
	return cloneMember(member), nil
}

func (r *memberRepoStub) FindByUserAndWorkspace(_ context.Context, userID, workspaceID string) (*entity.WorkspaceMember, error) {
	memberID, ok := r.byUserWorkspace[userWorkspaceKey(userID, workspaceID)]
	if !ok {
		return nil, ports.ErrNotFound
	}
	return cloneMember(r.byID[memberID]), nil
}

func (r *memberRepoStub) FindActiveByUserAndWorkspace(ctx context.Context, userID, workspaceID string) (*entity.WorkspaceMember, error) {
	member, err := r.FindByUserAndWorkspace(ctx, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	if member.MembershipStatus != entity.MembershipStatusActive {
		return nil, ports.ErrNotFound
	}
	return member, nil
}

func (r *memberRepoStub) Create(_ context.Context, member *entity.WorkspaceMember) error {
	key := userWorkspaceKey(member.UserID, member.WorkspaceID)
	if _, exists := r.byUserWorkspace[key]; exists {
		return ports.ErrConflict
	}
	stored := cloneMember(member)
	r.byID[stored.ID] = stored
	r.byUserWorkspace[key] = stored.ID
	return nil
}

func (r *memberRepoStub) ActivatePendingByUser(_ context.Context, userID string, joinedAt time.Time) error {
	for _, member := range r.byID {
		if member.UserID == userID && member.MembershipStatus == entity.MembershipStatusPending {
			member.MembershipStatus = entity.MembershipStatusActive
			member.JoinedAt = &joinedAt
		}
	}
	return nil
}

func (r *memberRepoStub) UpdateRole(_ context.Context, memberID string, role entity.WorkspaceRole) error {
	member, ok := r.byID[memberID]
	if !ok {
		return ports.ErrNotFound
	}
	member.Role = role
	return nil
}

func (r *memberRepoStub) UpdateStatus(_ context.Context, memberID string, status entity.MembershipStatus, joinedAt *time.Time) error {
	member, ok := r.byID[memberID]
	if !ok {
		return ports.ErrNotFound
	}
	member.MembershipStatus = status
	if joinedAt != nil {
		member.JoinedAt = joinedAt
	}
	return nil
}

func userWorkspaceKey(userID string, workspaceID string) string {
	return fmt.Sprintf("%s:%s", userID, workspaceID)
}

func cloneUser(user *entity.User) *entity.User {
	cloned := *user
	return &cloned
}

func cloneMember(member *entity.WorkspaceMember) *entity.WorkspaceMember {
	cloned := *member
	return &cloned
}
