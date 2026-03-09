package usecase

import (
	"testing"

	"github.com/rendis/mock-loom/apps/api/internal/config"
)

func TestAllowedBootstrapEmail(t *testing.T) {
	if !allowedBootstrapEmail("admin@example.com", []string{"admin@example.com"}, nil) {
		t.Fatal("expected allowed email by explicit list")
	}
	if !allowedBootstrapEmail("owner@example.com", nil, []string{"example.com"}) {
		t.Fatal("expected allowed email by domain")
	}
	if allowedBootstrapEmail("owner@other.com", nil, []string{"example.com"}) {
		t.Fatal("expected disallowed email for unknown domain")
	}
	if allowedBootstrapEmail("owner@example.com", nil, nil) {
		t.Fatal("expected disallowed email without allowlist")
	}
}

func TestClientConfigDummyAuth(t *testing.T) {
	service := &AuthService{
		cfg: &config.Config{
			Auth: config.AuthConfig{},
		},
	}

	clientConfig := service.ClientConfig()
	if !clientConfig.DummyAuth {
		t.Fatal("expected dummy auth client config")
	}
	if clientConfig.PanelProvider != nil {
		t.Fatalf("expected nil panel provider, got %+v", clientConfig.PanelProvider)
	}
}

func TestClientConfigOIDCIncludesDualNamingFields(t *testing.T) {
	service := &AuthService{
		cfg: &config.Config{
			Auth: config.AuthConfig{
				Provider: config.OIDCProviderConfig{
					Name:                  "acme-idp",
					DiscoveryURL:          "https://issuer.example.com/.well-known/openid-configuration",
					Issuer:                "https://issuer.example.com",
					JWKSURL:               "https://issuer.example.com/.well-known/jwks.json",
					AuthorizationEndpoint: "https://issuer.example.com/authorize",
					TokenEndpoint:         "https://issuer.example.com/token",
					UserinfoEndpoint:      "https://issuer.example.com/userinfo",
					EndSessionEndpoint:    "https://issuer.example.com/logout",
					ClientID:              "mock-loom-panel",
					Audience:              "mock-loom-api",
					Scopes:                "openid profile email",
				},
			},
		},
	}

	clientConfig := service.ClientConfig()
	if clientConfig.DummyAuth {
		t.Fatal("expected oidc client config")
	}
	if clientConfig.PanelProvider == nil {
		t.Fatal("expected panel provider config")
	}
	if clientConfig.PanelProvider.DiscoveryURL != "https://issuer.example.com/.well-known/openid-configuration" {
		t.Fatalf("expected discoveryUrl field, got %q", clientConfig.PanelProvider.DiscoveryURL)
	}
	if clientConfig.PanelProvider.DiscoveryURLAlias != clientConfig.PanelProvider.DiscoveryURL {
		t.Fatalf("expected discovery_url alias to match discoveryUrl, got %q", clientConfig.PanelProvider.DiscoveryURLAlias)
	}
	if clientConfig.PanelProvider.JWKSURL != "https://issuer.example.com/.well-known/jwks.json" {
		t.Fatalf("expected jwksUrl field, got %q", clientConfig.PanelProvider.JWKSURL)
	}
	if clientConfig.PanelProvider.JWKSURLAlias != clientConfig.PanelProvider.JWKSURL {
		t.Fatalf("expected jwks_url alias to match jwksUrl, got %q", clientConfig.PanelProvider.JWKSURLAlias)
	}
	if clientConfig.PanelProvider.AuthorizationEndpointAlias != clientConfig.PanelProvider.AuthorizationEndpoint {
		t.Fatalf("expected authorization endpoint alias to match, got %q", clientConfig.PanelProvider.AuthorizationEndpointAlias)
	}
	if clientConfig.PanelProvider.TokenEndpointAlias != clientConfig.PanelProvider.TokenEndpoint {
		t.Fatalf("expected token endpoint alias to match, got %q", clientConfig.PanelProvider.TokenEndpointAlias)
	}
	if clientConfig.PanelProvider.UserinfoEndpointAlias != clientConfig.PanelProvider.UserinfoEndpoint {
		t.Fatalf("expected userinfo endpoint alias to match, got %q", clientConfig.PanelProvider.UserinfoEndpointAlias)
	}
	if clientConfig.PanelProvider.EndSessionEndpointAlias != clientConfig.PanelProvider.EndSessionEndpoint {
		t.Fatalf("expected end session endpoint alias to match, got %q", clientConfig.PanelProvider.EndSessionEndpointAlias)
	}
	if clientConfig.PanelProvider.ClientIDAlias != clientConfig.PanelProvider.ClientID {
		t.Fatalf("expected client_id alias to match clientId, got %q", clientConfig.PanelProvider.ClientIDAlias)
	}
	if clientConfig.PanelProvider.Audience != "mock-loom-api" {
		t.Fatalf("expected audience to be set, got %q", clientConfig.PanelProvider.Audience)
	}
}
