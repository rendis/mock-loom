package usecase

import (
	"net/url"
	"testing"
)

func TestExtractPathParams(t *testing.T) {
	params := extractPathParams("/users/{userId}/orders/:orderId", "/users/u-1/orders/o-9")
	if params["userId"] != "u-1" {
		t.Fatalf("expected userId path param, got %v", params)
	}
	if params["orderId"] != "o-9" {
		t.Fatalf("expected orderId path param, got %v", params)
	}
}

func TestBuildRuntimeRequestEnvIncludesParamsAliases(t *testing.T) {
	query := url.Values{}
	query.Set("status", "active")
	env := buildRuntimeRequestEnv(
		"GET",
		"/users/u-1",
		map[string]string{"authorization": "Bearer token"},
		query,
		map[string]any{"id": "u-1"},
		map[string]string{"userId": "u-1"},
	)

	params, ok := env["params"].(map[string]any)
	if !ok {
		t.Fatalf("expected params map in env, got %T", env["params"])
	}

	pathParams, ok := params["path"].(map[string]any)
	if !ok {
		t.Fatalf("expected params.path map in env, got %T", params["path"])
	}
	if pathParams["userId"] != "u-1" {
		t.Fatalf("expected params.path.userId=u-1, got %v", pathParams)
	}

	queryParams, ok := params["query"].(map[string]any)
	if !ok || queryParams["status"] != "active" {
		t.Fatalf("expected params.query.status=active, got %v", params["query"])
	}

	headers, ok := params["headers"].(map[string]string)
	if !ok || headers["authorization"] != "Bearer token" {
		t.Fatalf("expected params.headers.authorization, got %v", params["headers"])
	}
}
