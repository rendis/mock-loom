package config

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildDiscoveryURL(t *testing.T) {
	cases := []struct {
		in  string
		out string
	}{
		{in: "https://auth.example.com/realms/main", out: "https://auth.example.com/realms/main/.well-known/openid-configuration"},
		{in: "https://auth.example.com/realms/main/", out: "https://auth.example.com/realms/main/.well-known/openid-configuration"},
		{in: "https://auth.example.com/.well-known/openid-configuration", out: "https://auth.example.com/.well-known/openid-configuration"},
	}

	for _, tc := range cases {
		if got := buildDiscoveryURL(tc.in); got != tc.out {
			t.Fatalf("buildDiscoveryURL(%q) = %q, want %q", tc.in, got, tc.out)
		}
	}
}

func TestDiscoverOIDCPopulatesMissingFields(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/.well-known/openid-configuration") {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"issuer": "https://issuer.example.com",
			"jwks_uri": "https://issuer.example.com/.well-known/jwks.json",
			"authorization_endpoint": "https://issuer.example.com/authorize",
			"token_endpoint": "https://issuer.example.com/token",
			"userinfo_endpoint": "https://issuer.example.com/userinfo",
			"end_session_endpoint": "https://issuer.example.com/logout"
		}`))
	}))
	defer server.Close()

	auth := AuthConfig{
		Provider: OIDCProviderConfig{
			DiscoveryURL: server.URL + "/realms/main",
		},
	}

	if err := auth.DiscoverOIDC(context.Background()); err != nil {
		t.Fatalf("discover oidc: %v", err)
	}

	if auth.Provider.Issuer != "https://issuer.example.com" {
		t.Fatalf("issuer mismatch: %q", auth.Provider.Issuer)
	}
	if auth.Provider.JWKSURL != "https://issuer.example.com/.well-known/jwks.json" {
		t.Fatalf("jwks mismatch: %q", auth.Provider.JWKSURL)
	}
	if auth.Provider.AuthorizationEndpoint != "https://issuer.example.com/authorize" {
		t.Fatalf("authorization endpoint mismatch: %q", auth.Provider.AuthorizationEndpoint)
	}
	if auth.Provider.TokenEndpoint != "https://issuer.example.com/token" {
		t.Fatalf("token endpoint mismatch: %q", auth.Provider.TokenEndpoint)
	}
	if auth.Provider.UserinfoEndpoint != "https://issuer.example.com/userinfo" {
		t.Fatalf("userinfo endpoint mismatch: %q", auth.Provider.UserinfoEndpoint)
	}
	if auth.Provider.EndSessionEndpoint != "https://issuer.example.com/logout" {
		t.Fatalf("end session endpoint mismatch: %q", auth.Provider.EndSessionEndpoint)
	}
}

func TestDiscoverOIDCDoesNotOverrideExplicitValues(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"issuer": "https://discovered-issuer.example.com",
			"jwks_uri": "https://discovered-issuer.example.com/jwks",
			"authorization_endpoint": "https://discovered-issuer.example.com/authz",
			"token_endpoint": "https://discovered-issuer.example.com/token",
			"userinfo_endpoint": "https://discovered-issuer.example.com/userinfo",
			"end_session_endpoint": "https://discovered-issuer.example.com/logout"
		}`))
	}))
	defer server.Close()

	auth := AuthConfig{
		Provider: OIDCProviderConfig{
			DiscoveryURL:          server.URL,
			Issuer:                "https://explicit-issuer.example.com",
			JWKSURL:               "https://explicit-issuer.example.com/jwks",
			AuthorizationEndpoint: "https://explicit-issuer.example.com/authz",
			TokenEndpoint:         "https://explicit-issuer.example.com/token",
			UserinfoEndpoint:      "https://explicit-issuer.example.com/userinfo",
			EndSessionEndpoint:    "https://explicit-issuer.example.com/logout",
		},
	}

	if err := auth.DiscoverOIDC(context.Background()); err != nil {
		t.Fatalf("discover oidc: %v", err)
	}

	if auth.Provider.Issuer != "https://explicit-issuer.example.com" {
		t.Fatalf("issuer was overridden: %q", auth.Provider.Issuer)
	}
	if auth.Provider.JWKSURL != "https://explicit-issuer.example.com/jwks" {
		t.Fatalf("jwks url was overridden: %q", auth.Provider.JWKSURL)
	}
	if auth.Provider.AuthorizationEndpoint != "https://explicit-issuer.example.com/authz" {
		t.Fatalf("authorization endpoint was overridden: %q", auth.Provider.AuthorizationEndpoint)
	}
	if auth.Provider.TokenEndpoint != "https://explicit-issuer.example.com/token" {
		t.Fatalf("token endpoint was overridden: %q", auth.Provider.TokenEndpoint)
	}
	if auth.Provider.UserinfoEndpoint != "https://explicit-issuer.example.com/userinfo" {
		t.Fatalf("userinfo endpoint was overridden: %q", auth.Provider.UserinfoEndpoint)
	}
	if auth.Provider.EndSessionEndpoint != "https://explicit-issuer.example.com/logout" {
		t.Fatalf("end session endpoint was overridden: %q", auth.Provider.EndSessionEndpoint)
	}
}

func TestFetchDiscoveryDocumentMissingIssuer(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jwks_uri":"https://issuer.example.com/jwks.json"}`))
	}))
	defer server.Close()

	_, err := fetchDiscoveryDocument(context.Background(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "missing issuer") {
		t.Fatalf("expected missing issuer error, got %v", err)
	}
}

func TestFetchDiscoveryDocumentMissingJWKSURI(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"issuer":"https://issuer.example.com"}`))
	}))
	defer server.Close()

	_, err := fetchDiscoveryDocument(context.Background(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "missing jwks_uri") {
		t.Fatalf("expected missing jwks_uri error, got %v", err)
	}
}

func TestFetchDiscoveryDocumentNon200(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	_, err := fetchDiscoveryDocument(context.Background(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "unexpected discovery status") {
		t.Fatalf("expected unexpected discovery status error, got %v", err)
	}
}
