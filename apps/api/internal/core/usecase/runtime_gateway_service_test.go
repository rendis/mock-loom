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

func TestDecodeRuntimeRequestBody(t *testing.T) {
	tests := []struct {
		name        string
		raw         []byte
		contentType string
		check       func(t *testing.T, result any)
	}{
		{
			name:        "form-urlencoded parses fields",
			raw:         []byte("accion=buscarAlumno&txtRun=26075524&txtSexo=M"),
			contentType: "application/x-www-form-urlencoded",
			check: func(t *testing.T, result any) {
				m, ok := result.(map[string]any)
				if !ok {
					t.Fatalf("expected map, got %T", result)
				}
				if m["accion"] != "buscarAlumno" {
					t.Fatalf("expected accion=buscarAlumno, got %v", m["accion"])
				}
				if m["txtRun"] != "26075524" {
					t.Fatalf("expected txtRun=26075524, got %v", m["txtRun"])
				}
				if m["txtSexo"] != "M" {
					t.Fatalf("expected txtSexo=M, got %v", m["txtSexo"])
				}
			},
		},
		{
			name:        "form-urlencoded multi-value uses first",
			raw:         []byte("foo=first&foo=second"),
			contentType: "application/x-www-form-urlencoded",
			check: func(t *testing.T, result any) {
				m := result.(map[string]any)
				if m["foo"] != "first" {
					t.Fatalf("expected foo=first, got %v", m["foo"])
				}
			},
		},
		{
			name:        "form-urlencoded empty value",
			raw:         []byte("foo="),
			contentType: "application/x-www-form-urlencoded",
			check: func(t *testing.T, result any) {
				m := result.(map[string]any)
				if m["foo"] != "" {
					t.Fatalf("expected foo='', got %v", m["foo"])
				}
			},
		},
		{
			name:        "form-urlencoded empty body returns empty map",
			raw:         []byte(""),
			contentType: "application/x-www-form-urlencoded",
			check: func(t *testing.T, result any) {
				m, ok := result.(map[string]any)
				if !ok || len(m) != 0 {
					t.Fatalf("expected empty map, got %v", result)
				}
			},
		},
		{
			name:        "form-urlencoded with charset param",
			raw:         []byte("key=value"),
			contentType: "application/x-www-form-urlencoded; charset=utf-8",
			check: func(t *testing.T, result any) {
				m := result.(map[string]any)
				if m["key"] != "value" {
					t.Fatalf("expected key=value, got %v", m["key"])
				}
			},
		},
		{
			name:        "form-urlencoded decodes percent-encoded chars",
			raw:         []byte("name=Juan+P%C3%A9rez&city=Vi%C3%B1a+del+Mar"),
			contentType: "application/x-www-form-urlencoded",
			check: func(t *testing.T, result any) {
				m := result.(map[string]any)
				if m["name"] != "Juan Pérez" {
					t.Fatalf("expected decoded name, got %v", m["name"])
				}
				if m["city"] != "Viña del Mar" {
					t.Fatalf("expected decoded city, got %v", m["city"])
				}
			},
		},
		{
			name:        "json content-type parses as json",
			raw:         []byte(`{"id":"u-1"}`),
			contentType: "application/json",
			check: func(t *testing.T, result any) {
				m, ok := result.(map[string]any)
				if !ok {
					t.Fatalf("expected map, got %T", result)
				}
				if m["id"] != "u-1" {
					t.Fatalf("expected id=u-1, got %v", m["id"])
				}
			},
		},
		{
			name:        "no content-type parses json by default",
			raw:         []byte(`{"ok":true}`),
			contentType: "",
			check: func(t *testing.T, result any) {
				m, ok := result.(map[string]any)
				if !ok {
					t.Fatalf("expected map, got %T", result)
				}
				if m["ok"] != true {
					t.Fatalf("expected ok=true, got %v", m["ok"])
				}
			},
		},
		{
			name:        "no content-type with non-json falls back to string",
			raw:         []byte("plain text body"),
			contentType: "",
			check: func(t *testing.T, result any) {
				s, ok := result.(string)
				if !ok || s != "plain text body" {
					t.Fatalf("expected raw string, got %v (%T)", result, result)
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := decodeRuntimeRequestBody(tc.raw, tc.contentType)
			tc.check(t, result)
		})
	}
}
