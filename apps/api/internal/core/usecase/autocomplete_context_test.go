package usecase

import (
	"slices"
	"testing"
)

func TestExtractRequestPathsFromContractSchema(t *testing.T) {
	contractJSON := `{
		"type": "object",
		"properties": {
			"body": {
				"type": "object",
				"properties": {
					"id": {"type": "string"},
					"profile": {
						"type": "object",
						"properties": {
							"tier": {"type": "string"}
						}
					},
					"tags": {
						"type": "array",
						"items": {
							"type": "object",
							"properties": {
								"code": {"type": "string"}
							}
						}
					}
				}
			}
		}
	}`

	paths := extractRequestPaths(contractJSON)

	for _, expected := range []string{
		"request.body.id",
		"request.body.profile.tier",
		"request.body.tags[]",
		"request.body.tags[].code",
		"request.params.body.id",
		"request.params.body.profile.tier",
		"request.params.body.tags[]",
		"request.params.body.tags[].code",
	} {
		if !slices.Contains(paths, expected) {
			t.Fatalf("expected request path %q in %v", expected, paths)
		}
	}
}

func TestExtractPathParamRequestPaths(t *testing.T) {
	paths := extractPathParamRequestPaths("/users/{userId}/orders/:orderId")
	for _, expected := range []string{
		"request.params.path",
		"request.params.path.userId",
		"request.params.path.orderId",
	} {
		if !slices.Contains(paths, expected) {
			t.Fatalf("expected path param request path %q in %v", expected, paths)
		}
	}
}

func TestExtractSourcePathsFromSnapshotSchema(t *testing.T) {
	schemaJSON := `{
		"type": "object",
		"properties": {
			"id": {"type": "string"},
			"profile": {
				"type": "object",
				"properties": {
					"tier": {"type": "string"}
				}
			}
		}
	}`

	paths := extractSourcePaths("users", schemaJSON)
	for _, expected := range []string{
		"source.users",
		"source.users.id",
		"source.users.profile",
		"source.users.profile.tier",
	} {
		if !slices.Contains(paths, expected) {
			t.Fatalf("expected source path %q in %v", expected, paths)
		}
	}
}

func TestBuildTemplatePaths(t *testing.T) {
	request := []string{"request.body.id"}
	source := []string{"source.users.id"}

	templates := buildTemplatePaths(request, source)
	if !slices.Contains(templates, "{{request.body.id}}") {
		t.Fatalf("expected request template token in %v", templates)
	}
	if !slices.Contains(templates, "{{source.users.id}}") {
		t.Fatalf("expected source template token in %v", templates)
	}
}

func TestDefaultRequestPathsAreStructuralOnly(t *testing.T) {
	paths := defaultRequestPaths()
	if slices.Contains(paths, "request.query.id") {
		t.Fatalf("unexpected concrete default path request.query.id in %v", paths)
	}
	if slices.Contains(paths, "request.header.authorization") {
		t.Fatalf("unexpected concrete default path request.header.authorization in %v", paths)
	}
}
