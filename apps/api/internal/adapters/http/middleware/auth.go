package middleware

import (
	"context"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	"github.com/rendis/mock-loom/apps/api/internal/config"
)

// AuthMiddleware validates OIDC bearer tokens.
type AuthMiddleware struct {
	cfg  *config.Config
	jwks keyfunc.Keyfunc
}

// OIDCClaims represents token claims expected by the API.
type OIDCClaims struct {
	jwt.RegisteredClaims
	Email         string `json:"email,omitempty"`
	EmailVerified *bool  `json:"email_verified,omitempty"`
	Name          string `json:"name,omitempty"`
	PreferredUser string `json:"preferred_username,omitempty"`
}

// NewAuthMiddleware creates token validator middleware.
func NewAuthMiddleware(cfg *config.Config) (*AuthMiddleware, error) {
	m := &AuthMiddleware{cfg: cfg}
	if cfg.Auth.IsDummyAuth() {
		return m, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	jwks, err := keyfunc.NewDefaultCtx(ctx, []string{cfg.Auth.Provider.JWKSURL})
	if err != nil {
		return nil, err
	}
	m.jwks = jwks
	return m, nil
}

// Authenticate validates auth token and injects token principal.
func (m *AuthMiddleware) Authenticate(c *fiber.Ctx) error {
	if c.Method() == fiber.MethodOptions {
		return c.Next()
	}

	if m.cfg.Auth.IsDummyAuth() {
		verified := true
		SetPrincipal(c, &Principal{
			Subject:       m.cfg.Auth.DummyAuthSubject,
			Email:         strings.ToLower(strings.TrimSpace(m.cfg.Auth.DummyAuthEmail)),
			FullName:      "Dummy Admin",
			EmailVerified: &verified,
		})
		return c.Next()
	}

	authHeader := strings.TrimSpace(c.Get("Authorization"))
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing bearer token"})
	}
	tokenString := strings.TrimSpace(parts[1])
	if tokenString == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing bearer token"})
	}

	claims := &OIDCClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, m.jwks.Keyfunc,
		jwt.WithExpirationRequired(),
	)
	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid token"})
	}

	if strings.TrimSpace(m.cfg.Auth.Provider.Issuer) != "" {
		if claims.Issuer != m.cfg.Auth.Provider.Issuer {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "issuer mismatch"})
		}
	}

	if aud := strings.TrimSpace(m.cfg.Auth.Provider.Audience); aud != "" {
		if !containsAudience(claims.Audience, aud) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "audience mismatch"})
		}
	}

	email := strings.ToLower(strings.TrimSpace(claims.Email))
	if email == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing email claim"})
	}
	if claims.EmailVerified != nil && !*claims.EmailVerified {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "email is not verified"})
	}

	fullName := strings.TrimSpace(claims.Name)
	if fullName == "" {
		fullName = strings.TrimSpace(claims.PreferredUser)
	}
	if fullName == "" {
		fullName = email
	}

	SetPrincipal(c, &Principal{
		Subject:       claims.Subject,
		Email:         email,
		FullName:      fullName,
		EmailVerified: claims.EmailVerified,
	})
	return c.Next()
}

func containsAudience(values jwt.ClaimStrings, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
