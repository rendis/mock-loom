package config

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	wellKnownSuffix  = "/.well-known/openid-configuration"
	discoveryTimeout = 10 * time.Second
)

type discoveryResponse struct {
	Issuer                string `json:"issuer"`
	JWKSURI               string `json:"jwks_uri"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
	EndSessionEndpoint    string `json:"end_session_endpoint"`
}

// DiscoverOIDC populates missing OIDC fields from discovery endpoint.
func (a *AuthConfig) DiscoverOIDC(ctx context.Context) error {
	if a.IsDummyAuth() {
		return nil
	}
	if strings.TrimSpace(a.Provider.DiscoveryURL) == "" {
		return nil
	}

	url := buildDiscoveryURL(a.Provider.DiscoveryURL)
	doc, err := fetchDiscoveryDocument(ctx, url)
	if err != nil {
		return err
	}

	if a.Provider.Issuer == "" {
		a.Provider.Issuer = doc.Issuer
	}
	if a.Provider.JWKSURL == "" {
		a.Provider.JWKSURL = doc.JWKSURI
	}
	if a.Provider.AuthorizationEndpoint == "" {
		a.Provider.AuthorizationEndpoint = doc.AuthorizationEndpoint
	}
	if a.Provider.TokenEndpoint == "" {
		a.Provider.TokenEndpoint = doc.TokenEndpoint
	}
	if a.Provider.UserinfoEndpoint == "" {
		a.Provider.UserinfoEndpoint = doc.UserinfoEndpoint
	}
	if a.Provider.EndSessionEndpoint == "" {
		a.Provider.EndSessionEndpoint = doc.EndSessionEndpoint
	}

	return nil
}

func buildDiscoveryURL(url string) string {
	url = strings.TrimSuffix(strings.TrimSpace(url), "/")
	if strings.HasSuffix(url, wellKnownSuffix) {
		return url
	}
	return url + wellKnownSuffix
}

func fetchDiscoveryDocument(ctx context.Context, url string) (*discoveryResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, discoveryTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create discovery request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch discovery document: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected discovery status: %d", resp.StatusCode)
	}

	var doc discoveryResponse
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, fmt.Errorf("decode discovery document: %w", err)
	}

	if strings.TrimSpace(doc.Issuer) == "" {
		return nil, fmt.Errorf("discovery document missing issuer")
	}
	if strings.TrimSpace(doc.JWKSURI) == "" {
		return nil, fmt.Errorf("discovery document missing jwks_uri")
	}

	return &doc, nil
}
