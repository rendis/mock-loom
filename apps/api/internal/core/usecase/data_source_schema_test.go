package usecase

import (
	"strings"
	"testing"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
)

func TestParseTopLevelSchemaTypes(t *testing.T) {
	schemaJSON := `{
		"type": "object",
		"additionalProperties": false,
		"properties": {
			"id": {"type": "string"},
			"active": {"type": "boolean"},
			"score": {"type": "number"}
		}
	}`

	types, err := parseTopLevelSchemaTypes(schemaJSON)
	if err != nil {
		t.Fatalf("parse schema types: %v", err)
	}
	if len(types) != 3 {
		t.Fatalf("expected 3 inferred types, got %d", len(types))
	}
	if types["id"] != "string" || types["active"] != "boolean" || types["score"] != "number" {
		t.Fatalf("unexpected inferred types: %+v", types)
	}
}

func TestBuildTopLevelSchemaJSONDeterministic(t *testing.T) {
	fieldTypes := map[string]string{
		"zeta":  "number",
		"alpha": "string",
	}

	left, err := buildTopLevelSchemaJSON(fieldTypes)
	if err != nil {
		t.Fatalf("build schema left: %v", err)
	}
	right, err := buildTopLevelSchemaJSON(fieldTypes)
	if err != nil {
		t.Fatalf("build schema right: %v", err)
	}
	if left != right {
		t.Fatalf("expected deterministic schema output; left=%s right=%s", left, right)
	}
	if !strings.Contains(left, `"alpha":{"type":"string"}`) || !strings.Contains(left, `"zeta":{"type":"number"}`) {
		t.Fatalf("expected top-level fields encoded in schema output: %s", left)
	}
}

func TestValidateSchemaFieldOverridesAndPrune(t *testing.T) {
	inferred := map[string]string{
		"id":     "string",
		"active": "boolean",
	}

	overrides, err := validateSchemaFieldOverrides(
		[]DataSourceSchemaFieldInput{
			{Key: "id", Type: "number"},
			{Key: "active", Type: "boolean"},
		},
		inferred,
	)
	if err != nil {
		t.Fatalf("validate schema overrides: %v", err)
	}

	if len(overrides) != 1 || overrides["id"] != "number" {
		t.Fatalf("expected only explicit override for id, got %+v", overrides)
	}
}

func TestValidateSchemaFieldOverridesRejectsInvalidPayload(t *testing.T) {
	inferred := map[string]string{"id": "string"}

	if _, err := validateSchemaFieldOverrides(nil, inferred); err == nil {
		t.Fatal("expected empty override payload to fail")
	}

	if _, err := validateSchemaFieldOverrides(
		[]DataSourceSchemaFieldInput{{Key: "id", Type: "uuid"}},
		inferred,
	); err == nil {
		t.Fatal("expected unsupported type to fail")
	}

	if _, err := validateSchemaFieldOverrides(
		[]DataSourceSchemaFieldInput{{Key: "missing", Type: "string"}},
		inferred,
	); err == nil {
		t.Fatal("expected unknown key to fail")
	}

	if _, err := validateSchemaFieldOverrides(
		[]DataSourceSchemaFieldInput{{Key: "id", Type: "string"}, {Key: "id", Type: "number"}},
		inferred,
	); err == nil {
		t.Fatal("expected duplicated key to fail")
	}
}

func TestPruneSchemaOverrides(t *testing.T) {
	inferred := map[string]string{
		"id":    "string",
		"name":  "string",
		"score": "number",
	}
	overrides := map[string]string{
		"id":       "string",
		"score":    "string",
		"obsolete": "number",
	}

	pruned := pruneSchemaOverrides(overrides, inferred)
	if len(pruned) != 1 {
		t.Fatalf("expected one pruned override, got %+v", pruned)
	}
	if pruned["score"] != "string" {
		t.Fatalf("expected score override to remain, got %+v", pruned)
	}
}

func TestBuildSchemaWarningsFromEntities(t *testing.T) {
	items := []*entity.DataDebuggerEntity{
		{CurrentDataJSON: `{"id":"usr-1","age":"40","active":true}`},
		{CurrentDataJSON: `{"id":"usr-2","age":22,"active":"yes"}`},
		{CurrentDataJSON: `not-json`},
	}
	effectiveTypes := map[string]string{
		"id":     "string",
		"age":    "number",
		"active": "boolean",
	}

	warnings := buildSchemaWarningsFromEntities(items, effectiveTypes)
	if len(warnings) != 2 {
		t.Fatalf("expected 2 warnings, got %+v", warnings)
	}
	if warnings[0].Key != "active" || warnings[0].MismatchCount != 1 {
		t.Fatalf("unexpected active warning: %+v", warnings[0])
	}
	if warnings[1].Key != "age" || warnings[1].MismatchCount != 1 {
		t.Fatalf("unexpected age warning: %+v", warnings[1])
	}
}
