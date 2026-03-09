package usecase

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/rendis/mock-loom/apps/api/internal/config"
	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// AuthIdentityInput is normalized identity data from validated token.
type AuthIdentityInput struct {
	Subject       string
	Email         string
	FullName      string
	EmailVerified *bool
}

// ResolvedIdentity is the internal identity context.
type ResolvedIdentity struct {
	User       *entity.User
	SystemRole *entity.SystemRoleAssignment
}

// AuthClientPanelProvider describes OIDC metadata exposed to frontend clients.
type AuthClientPanelProvider struct {
	Name                       string `json:"name"`
	Issuer                     string `json:"issuer"`
	DiscoveryURL               string `json:"discoveryUrl,omitempty"`
	DiscoveryURLAlias          string `json:"discovery_url,omitempty"`
	JWKSURL                    string `json:"jwksUrl,omitempty"`
	JWKSURLAlias               string `json:"jwks_url,omitempty"`
	AuthorizationEndpoint      string `json:"authorizationEndpoint,omitempty"`
	AuthorizationEndpointAlias string `json:"authorization_endpoint,omitempty"`
	TokenEndpoint              string `json:"tokenEndpoint,omitempty"`
	TokenEndpointAlias         string `json:"token_endpoint,omitempty"`
	UserinfoEndpoint           string `json:"userinfoEndpoint,omitempty"`
	UserinfoEndpointAlias      string `json:"userinfo_endpoint,omitempty"`
	EndSessionEndpoint         string `json:"endSessionEndpoint,omitempty"`
	EndSessionEndpointAlias    string `json:"end_session_endpoint,omitempty"`
	ClientID                   string `json:"clientId,omitempty"`
	ClientIDAlias              string `json:"client_id,omitempty"`
	Audience                   string `json:"audience,omitempty"`
	Scopes                     string `json:"scopes,omitempty"`
}

// AuthClientConfig is returned to frontend to start OIDC flow.
type AuthClientConfig struct {
	DummyAuth     bool                     `json:"dummyAuth"`
	PanelProvider *AuthClientPanelProvider `json:"panelProvider,omitempty"`
}

// AuthService handles token-backed identity resolution.
type AuthService struct {
	cfg              *config.Config
	tx               ports.TxManager
	users            ports.UserRepository
	systemRoles      ports.SystemRoleRepository
	workspaceMembers ports.WorkspaceMemberRepository
}

// NewAuthService returns AuthService.
func NewAuthService(cfg *config.Config, tx ports.TxManager, users ports.UserRepository, systemRoles ports.SystemRoleRepository, workspaceMembers ports.WorkspaceMemberRepository) *AuthService {
	return &AuthService{
		cfg:              cfg,
		tx:               tx,
		users:            users,
		systemRoles:      systemRoles,
		workspaceMembers: workspaceMembers,
	}
}

// ClientConfig returns runtime auth info for frontend.
func (s *AuthService) ClientConfig() *AuthClientConfig {
	if s.cfg.Auth.IsDummyAuth() {
		return &AuthClientConfig{DummyAuth: true}
	}

	p := s.cfg.Auth.Provider
	return &AuthClientConfig{
		DummyAuth: false,
		PanelProvider: &AuthClientPanelProvider{
			Name:                       p.Name,
			Issuer:                     p.Issuer,
			DiscoveryURL:               p.DiscoveryURL,
			DiscoveryURLAlias:          p.DiscoveryURL,
			JWKSURL:                    p.JWKSURL,
			JWKSURLAlias:               p.JWKSURL,
			AuthorizationEndpoint:      p.AuthorizationEndpoint,
			AuthorizationEndpointAlias: p.AuthorizationEndpoint,
			TokenEndpoint:              p.TokenEndpoint,
			TokenEndpointAlias:         p.TokenEndpoint,
			UserinfoEndpoint:           p.UserinfoEndpoint,
			UserinfoEndpointAlias:      p.UserinfoEndpoint,
			EndSessionEndpoint:         p.EndSessionEndpoint,
			EndSessionEndpointAlias:    p.EndSessionEndpoint,
			ClientID:                   p.ClientID,
			ClientIDAlias:              p.ClientID,
			Audience:                   p.Audience,
			Scopes:                     p.Scopes,
		},
	}
}

// ResolveIdentity ensures authenticated principal exists internally.
func (s *AuthService) ResolveIdentity(ctx context.Context, input AuthIdentityInput) (*ResolvedIdentity, error) {
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if email == "" {
		return nil, ErrUnauthorized
	}
	if input.EmailVerified != nil && !*input.EmailVerified {
		return nil, ErrUnauthorized
	}

	user, err := s.users.FindByEmail(ctx, email)
	if err == nil {
		if user.Status == entity.UserStatusSuspended {
			return nil, ErrForbidden
		}
		if user.Status == entity.UserStatusInvited {
			err := s.tx.WithTx(ctx, func(txCtx context.Context) error {
				if err := s.users.ActivateAndLink(txCtx, user.ID, input.Subject, time.Now().UTC()); err != nil {
					return err
				}
				return s.workspaceMembers.ActivatePendingByUser(txCtx, user.ID, time.Now().UTC())
			})
			if err != nil {
				return nil, err
			}
			user, err = s.users.FindByEmail(ctx, email)
			if err != nil {
				return nil, err
			}
		}

		sysRole, err := s.systemRoles.FindByUserID(ctx, user.ID)
		if err != nil && !errors.Is(err, ports.ErrNotFound) {
			return nil, err
		}
		return &ResolvedIdentity{User: user, SystemRole: sysRole}, nil
	}

	if !errors.Is(err, ports.ErrNotFound) {
		return nil, err
	}

	if !s.cfg.Auth.BootstrapEnabled {
		return nil, ErrNotInvited
	}
	count, err := s.users.Count(ctx)
	if err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, ErrNotInvited
	}
	if !allowedBootstrapEmail(email, s.cfg.Auth.BootstrapEmails, s.cfg.Auth.BootstrapDomains) {
		return nil, ErrForbidden
	}

	var created *entity.User
	err = s.tx.WithTx(ctx, func(txCtx context.Context) error {
		now := time.Now().UTC()
		extID := input.Subject
		fullName := strings.TrimSpace(input.FullName)
		if fullName == "" {
			fullName = email
		}
		created = &entity.User{
			ID:                 uuid.NewString(),
			Email:              email,
			ExternalIdentityID: &extID,
			FullName:           fullName,
			Status:             entity.UserStatusActive,
			CreatedAt:          now,
			UpdatedAt:          now,
		}
		if err := s.users.Create(txCtx, created); err != nil {
			return err
		}
		assignment := &entity.SystemRoleAssignment{
			UserID:    created.ID,
			Role:      entity.SystemRoleSuperAdmin,
			GrantedBy: nil,
			CreatedAt: now,
		}
		return s.systemRoles.Upsert(txCtx, assignment)
	})
	if err != nil {
		return nil, err
	}

	return &ResolvedIdentity{
		User:       created,
		SystemRole: &entity.SystemRoleAssignment{UserID: created.ID, Role: entity.SystemRoleSuperAdmin, CreatedAt: time.Now().UTC()},
	}, nil
}

// Me returns identity payload for frontend.
func (s *AuthService) Me(ctx context.Context, userID string) (map[string]any, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	role, err := s.systemRoles.FindByUserID(ctx, userID)
	if err != nil && !errors.Is(err, ports.ErrNotFound) {
		return nil, err
	}

	payload := map[string]any{
		"id":       user.ID,
		"email":    user.Email,
		"fullName": user.FullName,
		"status":   user.Status,
	}
	if role != nil {
		payload["systemRole"] = role.Role
	}
	return payload, nil
}

func allowedBootstrapEmail(email string, allowedEmails, allowedDomains []string) bool {
	if len(allowedEmails) == 0 && len(allowedDomains) == 0 {
		return false
	}
	for _, item := range allowedEmails {
		if email == strings.ToLower(strings.TrimSpace(item)) {
			return true
		}
	}
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return false
	}
	domain := parts[1]
	for _, item := range allowedDomains {
		if domain == strings.ToLower(strings.TrimSpace(item)) {
			return true
		}
	}
	return false
}
