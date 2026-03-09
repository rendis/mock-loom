package middleware

import (
	"crypto/rsa"
	"encoding/base64"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"

	"github.com/rendis/mock-loom/apps/api/internal/config"
)

func TestAuthMiddlewareMissingBearer(t *testing.T) {
	t.Parallel()

	authMiddleware, _, _ := newAuthMiddlewareForTest(t, "https://issuer.example.com", "mock-loom-api")
	status, body := runAuthRequest(t, authMiddleware, "")
	if status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", status, body)
	}
	if !strings.Contains(body, "missing bearer token") {
		t.Fatalf("expected missing bearer token error, got %s", body)
	}
}

func TestAuthMiddlewareValidTokenPasses(t *testing.T) {
	t.Parallel()

	authMiddleware, privateKey, kid := newAuthMiddlewareForTest(t, "https://issuer.example.com", "mock-loom-api")
	token := signTestToken(t, privateKey, kid, tokenClaims{
		issuer:        "https://issuer.example.com",
		audience:      "mock-loom-api",
		email:         "admin@example.com",
		emailVerified: boolPtr(true),
	})

	status, body := runAuthRequest(t, authMiddleware, "Bearer "+token)
	if status != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", status, body)
	}
}

func TestAuthMiddlewareIssuerMismatch(t *testing.T) {
	t.Parallel()

	authMiddleware, privateKey, kid := newAuthMiddlewareForTest(t, "https://issuer.example.com", "mock-loom-api")
	token := signTestToken(t, privateKey, kid, tokenClaims{
		issuer:        "https://other-issuer.example.com",
		audience:      "mock-loom-api",
		email:         "admin@example.com",
		emailVerified: boolPtr(true),
	})

	status, body := runAuthRequest(t, authMiddleware, "Bearer "+token)
	if status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", status, body)
	}
	if !strings.Contains(body, "issuer mismatch") {
		t.Fatalf("expected issuer mismatch error, got %s", body)
	}
}

func TestAuthMiddlewareAudienceMismatch(t *testing.T) {
	t.Parallel()

	authMiddleware, privateKey, kid := newAuthMiddlewareForTest(t, "https://issuer.example.com", "mock-loom-api")
	token := signTestToken(t, privateKey, kid, tokenClaims{
		issuer:        "https://issuer.example.com",
		audience:      "unexpected-audience",
		email:         "admin@example.com",
		emailVerified: boolPtr(true),
	})

	status, body := runAuthRequest(t, authMiddleware, "Bearer "+token)
	if status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", status, body)
	}
	if !strings.Contains(body, "audience mismatch") {
		t.Fatalf("expected audience mismatch error, got %s", body)
	}
}

func TestAuthMiddlewareMissingEmailClaim(t *testing.T) {
	t.Parallel()

	authMiddleware, privateKey, kid := newAuthMiddlewareForTest(t, "https://issuer.example.com", "mock-loom-api")
	token := signTestToken(t, privateKey, kid, tokenClaims{
		issuer:        "https://issuer.example.com",
		audience:      "mock-loom-api",
		email:         "",
		emailVerified: boolPtr(true),
	})

	status, body := runAuthRequest(t, authMiddleware, "Bearer "+token)
	if status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", status, body)
	}
	if !strings.Contains(body, "missing email claim") {
		t.Fatalf("expected missing email claim error, got %s", body)
	}
}

func TestAuthMiddlewareEmailNotVerified(t *testing.T) {
	t.Parallel()

	authMiddleware, privateKey, kid := newAuthMiddlewareForTest(t, "https://issuer.example.com", "mock-loom-api")
	token := signTestToken(t, privateKey, kid, tokenClaims{
		issuer:        "https://issuer.example.com",
		audience:      "mock-loom-api",
		email:         "admin@example.com",
		emailVerified: boolPtr(false),
	})

	status, body := runAuthRequest(t, authMiddleware, "Bearer "+token)
	if status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", status, body)
	}
	if !strings.Contains(body, "email is not verified") {
		t.Fatalf("expected email is not verified error, got %s", body)
	}
}

type tokenClaims struct {
	issuer        string
	audience      string
	email         string
	emailVerified *bool
}

func newAuthMiddlewareForTest(t *testing.T, issuer string, audience string) (*AuthMiddleware, *rsa.PrivateKey, string) {
	t.Helper()

	privateKey, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(testRSAPrivateKeyPEM))
	if err != nil {
		t.Fatalf("parse rsa private key: %v", err)
	}

	const kid = "test-kid"
	jwks, err := keyfunc.NewJWKSetJSON(mustBuildJWKSetJSON(kid, privateKey.PublicKey.N.Bytes(), big.NewInt(int64(privateKey.PublicKey.E)).Bytes()))
	if err != nil {
		t.Fatalf("build keyfunc from jwks: %v", err)
	}

	cfg := &config.Config{
		Auth: config.AuthConfig{
			Provider: config.OIDCProviderConfig{
				Issuer:   issuer,
				JWKSURL:  "https://issuer.example.com/.well-known/jwks.json",
				Audience: audience,
			},
		},
	}

	return &AuthMiddleware{cfg: cfg, jwks: jwks}, privateKey, kid
}

func signTestToken(t *testing.T, privateKey *rsa.PrivateKey, kid string, claims tokenClaims) string {
	t.Helper()

	registered := jwt.RegisteredClaims{
		Subject:   "subject-1",
		Issuer:    claims.issuer,
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
	}
	if claims.audience != "" {
		registered.Audience = jwt.ClaimStrings{claims.audience}
	}

	c := &OIDCClaims{
		RegisteredClaims: registered,
		Email:            claims.email,
		EmailVerified:    claims.emailVerified,
		Name:             "Admin User",
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
	token.Header["kid"] = kid
	tokenString, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return tokenString
}

func runAuthRequest(t *testing.T, authMiddleware *AuthMiddleware, authorizationHeader string) (int, string) {
	t.Helper()

	app := fiber.New()
	app.Get("/protected", authMiddleware.Authenticate, func(c *fiber.Ctx) error {
		if _, ok := GetPrincipal(c); !ok {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "missing principal"})
		}
		return c.SendStatus(fiber.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	if authorizationHeader != "" {
		req.Header.Set("Authorization", authorizationHeader)
	}
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("execute request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	return resp.StatusCode, string(body)
}

func mustBuildJWKSetJSON(kid string, modulus []byte, exponent []byte) []byte {
	return []byte(fmt.Sprintf(
		`{"keys":[{"kty":"RSA","kid":"%s","use":"sig","alg":"RS256","n":"%s","e":"%s"}]}`,
		kid,
		base64.RawURLEncoding.EncodeToString(modulus),
		base64.RawURLEncoding.EncodeToString(exponent),
	))
}

func boolPtr(v bool) *bool {
	return &v
}

const testRSAPrivateKeyPEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDI9YAh0VhSClJu
ZtAVNPUg1yGtOJvVnTBDe7Gy2w+WZzj51aBwB8SK7KvRKZDhfybKflCeZ/epim5Y
meFiCpdQ4BymojUAfWZfwsEH0owGCvncZFmM+OgBv1QPcJxptG5GG1CRYMMOBNeL
OiRsCQ7VbFYUTJdiEEnSVVEePRzoXJyxq4Lfi38KW/8JaJiMsUXUd5NMtOCwuan1
y5QKdLOIATa+lev2FGjhypbyL5XzHbbb30Sl7eLalt8z+7Mx58vMF/8Lw3RjFKhx
M8XNtqNXP6tysyK52sVIE/DfhvfpegoW9g5vdGANorxI2RtC6688qd8OvQNmAQ2L
BH6opiZ9AgMBAAECggEAAgIqIKxl9JPz1PSkGcIovQZJaODK9eyXQeVnlkEIO9mW
QTD4ZIY/WaAZ64I913Mc4SM4DQ0+9WvTxIDtNryiXIWQ4711SCb4sfZRVZGuIpVT
f/dkybrnHrVZ0rmuZoQOIhc9y+YqrOYxfUu8d3PzuQBXL+bAEJPXGQoPQH0d39ig
jRLSffjDIbfy/JLA/hds6fcZ0KxzoO8xIBlB81KbwygpIxWJPjwpV7lrHzkGETvH
9ezVWdOX8VV3Ryp9YhulHW7vmmmxd5AyQrI5Yy86eKR0GTehaU60TbfGf7HVax/I
G6YxJRmng5o9UhPvZVh9xTogoo8U65d34r0rNt0BIQKBgQD8PPf+Q9yK60izI3b+
8zJt96uSYLvIXRaKyfFl7NJrPq8xnte6CZBVdwY5Q8xiOlPIug98lCTyFWMLr9Zr
j3e9g/C3+Y7tmx7tgF42XwX0ZYNpfeQPHCXC4Orr3TQvNKG/FgL7SI59rgXNd4N9
eFFgUc9cxZc9LKzDKAJR7PxHeQKBgQDL9MAx1KWIc9she7ydkYPsCJCuivDE7U6t
Usla1eRNEXXcxZYzk6MeA63B4Fupp6atwiLsKN2+xW7+pwVoOz65DFXF9SrNbD5+
yx/Jgf3QN1WRbOcQH2uu/TY5MqhVbNooDPLDsoGW105ndo9Ghj/6mymDMKKn3biM
v52/SQ/iJQKBgCQCYDUAYx/B7yMD0R0cgvqH/QpsnOJBx9IQelHeuTtuO3yN/KYm
b2CEGXNbZnYvdX6WcVeLnqqguv8UHzxDwwhfKaJaEjmBh6zIQqrobeUyCMyqmEA/
+HQVv/PkJGsIzH6HGe3dsdnnWhS3FyJ2ZselZkEMREcLda52q74eYvWhAoGBALWc
ggudM602pPjCyuhv682grtyNYemo+jcCEcQt0/YARzhIRQA2RbhzRCTwWA7Q922g
AiLSHOpDuhtNtFXk82wpnLMCJZP4AAo9a1euxcjDjRFKrNHBeMzAMqlp/1TZ8cRa
C03RRO2BWRJuExSUdKH9ylBEXYImv6+s7JWpRFh1AoGBAOF6oaTC5D+Ra+ZVPcZL
pn4LmJryZHEVz9OfF0oziXzxSEjM9AMZZtBSbzt9igaw9kT/ZFN/a5pjo8F7oRpm
dU8PmRmx+D9oEsJqOIT13a2Q3uUfb63V2+0UVNNNTq8erPjVfWhc8afqhM84oPMo
Zgt0mfgse9G+D82e8I1WIrRa
-----END PRIVATE KEY-----`
