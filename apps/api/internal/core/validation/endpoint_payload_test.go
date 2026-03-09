package validation

import "testing"

func TestValidateContractJSON(t *testing.T) {
	t.Run("valid schema", func(t *testing.T) {
		payload := `{"type":"object","properties":{"id":{"type":"string"}}}`
		normalized, err := ValidateContractJSON(payload)
		if err != nil {
			t.Fatalf("expected valid contract, got error: %v", err)
		}
		if normalized == "" {
			t.Fatal("expected normalized payload")
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		_, err := ValidateContractJSON(`{"type":`)
		if err == nil {
			t.Fatal("expected JSON parse failure")
		}
	})

	t.Run("non object root", func(t *testing.T) {
		_, err := ValidateContractJSON(`[]`)
		if err == nil {
			t.Fatal("expected root object validation failure")
		}
	})

	t.Run("schema compile error", func(t *testing.T) {
		_, err := ValidateContractJSON(`{"type":"wat"}`)
		if err == nil {
			t.Fatal("expected schema compile failure")
		}
	})
}

func TestValidateScenariosJSON(t *testing.T) {
	valid := `[{"name":"ok","priority":10,"conditionExpr":"request.params.path.id != \"\"","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}}}]`
	normalized, err := ValidateScenariosJSON(valid)
	if err != nil {
		t.Fatalf("expected valid scenarios, got error: %v", err)
	}
	if normalized == "" {
		t.Fatal("expected normalized scenarios payload")
	}

	t.Run("accepts empty array", func(t *testing.T) {
		normalized, err := ValidateScenariosJSON(`[]`)
		if err != nil {
			t.Fatalf("expected empty array to be valid, got error: %v", err)
		}
		if normalized != "[]" {
			t.Fatalf("expected normalized empty array, got %s", normalized)
		}
	})

	tests := []struct {
		name    string
		payload string
	}{
		{
			name:    "duplicate priorities",
			payload: `[{"priority":1,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}}},{"priority":1,"conditionExpr":"request.params.path.id != \"\"","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}}}]`,
		},
		{
			name:    "multiple fallback",
			payload: `[{"priority":1,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}}},{"priority":2,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}}}]`,
		},
		{
			name:    "invalid expression",
			payload: `[{"priority":1,"conditionExpr":"request..id","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}}}]`,
		},
		{
			name:    "missing response",
			payload: `[{"priority":1,"conditionExpr":"true"}]`,
		},
		{
			name:    "unknown field",
			payload: `[{"priority":1,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}},"legacy":"x"}]`,
		},
		{
			name:    "response body must be object",
			payload: `[{"priority":1,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":[1,2,3]}}]`,
		},
		{
			name:    "response headers must be string map",
			payload: `[{"priority":1,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"X-Rate-Limit":10},"body":{"ok":true}}}]`,
		},
		{
			name:    "upsert requires payload expression",
			payload: `[{"priority":1,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}},"mutations":[{"type":"UPSERT","sourceSlug":"users","entityIdExpr":"request.params.path.id"}]}]`,
		},
		{
			name:    "delete must omit payload expression",
			payload: `[{"priority":1,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}},"mutations":[{"type":"DELETE","sourceSlug":"users","entityIdExpr":"request.params.path.id","payloadExpr":"request.body"}]}]`,
		},
		{
			name:    "status code range",
			payload: `[{"priority":1,"conditionExpr":"true","response":{"statusCode":99,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}}}]`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ValidateScenariosJSON(tc.payload); err == nil {
				t.Fatalf("expected validation error for case %s", tc.name)
			}
		})
	}
}

func TestValidateScenariosJSONWithOptionsRequiresKnownSourceSlug(t *testing.T) {
	options := ScenarioValidationOptions{
		ActiveSourceSlugs: map[string]struct{}{
			"users": {},
		},
		RequireKnownSourceSlugs: true,
	}
	valid := `[{"priority":1,"conditionExpr":"request.params.path.id != \"\"","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}},"mutations":[{"type":"UPSERT","sourceSlug":"users","entityIdExpr":"request.params.path.id","payloadExpr":"request.params.body"}]}]`
	if _, err := ValidateScenariosJSONWithOptions(valid, options); err != nil {
		t.Fatalf("expected valid options payload, got error: %v", err)
	}

	invalid := `[{"priority":1,"conditionExpr":"request.params.path.id != \"\"","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}},"mutations":[{"type":"UPSERT","sourceSlug":"wallets","entityIdExpr":"request.params.path.id","payloadExpr":"request.params.body"}]}]`
	if _, err := ValidateScenariosJSONWithOptions(invalid, options); err == nil {
		t.Fatal("expected unknown source slug validation error")
	}
}
