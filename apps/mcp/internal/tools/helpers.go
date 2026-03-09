package tools

import (
	"encoding/json"
	"fmt"
)

// extractItems extracts the "items" array from a typical API list response.
func extractItems(v any) ([]any, bool) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, false
	}
	items, ok := m["items"].([]any)
	return items, ok
}

// rawJSON wraps a JSON string so it marshals as raw JSON (not double-encoded).
type rawJSON string

func (r rawJSON) MarshalJSON() ([]byte, error) {
	if r == "" {
		return []byte("null"), nil
	}
	if !json.Valid([]byte(r)) {
		return nil, fmt.Errorf("rawJSON: value is not valid JSON")
	}
	return []byte(r), nil
}
