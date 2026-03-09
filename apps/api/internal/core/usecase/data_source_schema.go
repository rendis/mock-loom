package usecase

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
)

var supportedDataSourceSchemaTypes = map[string]struct{}{
	"string":  {},
	"number":  {},
	"boolean": {},
	"object":  {},
	"array":   {},
	"null":    {},
}

// DataSourceSchemaFieldInput is one editable top-level schema field from API payload.
type DataSourceSchemaFieldInput struct {
	Key  string
	Type string
}

func normalizeDataSourceSchemaType(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func isSupportedDataSourceSchemaType(typ string) bool {
	_, ok := supportedDataSourceSchemaTypes[typ]
	return ok
}

func parseTopLevelSchemaTypes(schemaJSON string) (map[string]string, error) {
	trimmed := strings.TrimSpace(schemaJSON)
	if trimmed == "" {
		return nil, newValidationError(ErrSemanticValidation, "source schema payload is empty")
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		return nil, newValidationError(ErrSemanticValidation, "source schema payload is invalid json", err.Error())
	}

	rawProperties, ok := raw["properties"].(map[string]any)
	if !ok {
		return nil, newValidationError(ErrSemanticValidation, "source schema payload does not define object properties")
	}

	result := make(map[string]string, len(rawProperties))
	for rawKey, rawProperty := range rawProperties {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			continue
		}

		resolvedType := "string"
		if propertyObject, ok := rawProperty.(map[string]any); ok {
			if rawType, ok := propertyObject["type"].(string); ok {
				normalizedType := normalizeDataSourceSchemaType(rawType)
				if isSupportedDataSourceSchemaType(normalizedType) {
					resolvedType = normalizedType
				}
			}
		}
		result[key] = resolvedType
	}

	if len(result) == 0 {
		return nil, newValidationError(ErrSemanticValidation, "source schema payload has no editable top-level fields")
	}

	return result, nil
}

func buildTopLevelSchemaJSON(fieldTypes map[string]string) (string, error) {
	keys := make([]string, 0, len(fieldTypes))
	for key := range fieldTypes {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	builder := strings.Builder{}
	builder.WriteString(`{"type":"object","additionalProperties":false,"properties":{`)
	for index, key := range keys {
		typ := normalizeDataSourceSchemaType(fieldTypes[key])
		if !isSupportedDataSourceSchemaType(typ) {
			return "", fmt.Errorf("unsupported schema type for key %q: %q", key, fieldTypes[key])
		}

		encodedKey, err := json.Marshal(key)
		if err != nil {
			return "", err
		}
		encodedType, err := json.Marshal(typ)
		if err != nil {
			return "", err
		}

		if index > 0 {
			builder.WriteString(",")
		}
		builder.Write(encodedKey)
		builder.WriteString(`:{"type":`)
		builder.Write(encodedType)
		builder.WriteString("}")
	}
	builder.WriteString("}}")
	return builder.String(), nil
}

func pruneSchemaOverrides(overrides map[string]string, inferred map[string]string) map[string]string {
	result := make(map[string]string)
	for rawKey, rawType := range overrides {
		key := strings.TrimSpace(rawKey)
		typ := normalizeDataSourceSchemaType(rawType)
		if key == "" || !isSupportedDataSourceSchemaType(typ) {
			continue
		}

		inferredType, ok := inferred[key]
		if !ok {
			continue
		}
		if typ == inferredType {
			continue
		}
		result[key] = typ
	}
	return result
}

func validateSchemaFieldOverrides(
	fields []DataSourceSchemaFieldInput,
	inferred map[string]string,
) (map[string]string, error) {
	if len(fields) == 0 {
		return nil, ErrInvalidInput
	}

	resolved := make(map[string]string, len(fields))
	for _, item := range fields {
		key := strings.TrimSpace(item.Key)
		if key == "" {
			return nil, ErrInvalidInput
		}
		if _, exists := resolved[key]; exists {
			return nil, ErrInvalidInput
		}
		if _, exists := inferred[key]; !exists {
			return nil, ErrInvalidInput
		}

		typ := normalizeDataSourceSchemaType(item.Type)
		if !isSupportedDataSourceSchemaType(typ) {
			return nil, ErrInvalidInput
		}
		resolved[key] = typ
	}

	if len(resolved) != len(inferred) {
		return nil, ErrInvalidInput
	}

	return pruneSchemaOverrides(resolved, inferred), nil
}

func buildSchemaFields(
	inferred map[string]string,
	overrides map[string]string,
) ([]entity.DataSourceSchemaField, map[string]string) {
	keys := make([]string, 0, len(inferred))
	for key := range inferred {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	fields := make([]entity.DataSourceSchemaField, 0, len(keys))
	effectiveTypes := make(map[string]string, len(keys))
	for _, key := range keys {
		inferredType := normalizeDataSourceSchemaType(inferred[key])
		effectiveType := inferredType
		if overrideType, ok := overrides[key]; ok {
			normalizedOverride := normalizeDataSourceSchemaType(overrideType)
			if isSupportedDataSourceSchemaType(normalizedOverride) {
				effectiveType = normalizedOverride
			}
		}

		fields = append(fields, entity.DataSourceSchemaField{
			Key:           key,
			InferredType:  inferredType,
			EffectiveType: effectiveType,
			Overridden:    effectiveType != inferredType,
		})
		effectiveTypes[key] = effectiveType
	}

	return fields, effectiveTypes
}

func buildSchemaWarningsFromEntities(
	items []*entity.DataDebuggerEntity,
	effectiveTypes map[string]string,
) []entity.DataSourceSchemaWarning {
	if len(items) == 0 || len(effectiveTypes) == 0 {
		return []entity.DataSourceSchemaWarning{}
	}

	mismatchByKey := make(map[string]int, len(effectiveTypes))
	for _, row := range items {
		var payload any
		if err := json.Unmarshal([]byte(row.CurrentDataJSON), &payload); err != nil {
			continue
		}
		payloadObject, ok := payload.(map[string]any)
		if !ok {
			continue
		}

		for key, expectedType := range effectiveTypes {
			value, exists := payloadObject[key]
			if !exists {
				continue
			}
			if resolveSchemaRuntimeType(value) != expectedType {
				mismatchByKey[key] += 1
			}
		}
	}

	warnings := make([]entity.DataSourceSchemaWarning, 0)
	for key, mismatchCount := range mismatchByKey {
		if mismatchCount <= 0 {
			continue
		}
		warnings = append(warnings, entity.DataSourceSchemaWarning{
			Key:           key,
			ExpectedType:  effectiveTypes[key],
			MismatchCount: mismatchCount,
		})
	}

	sort.Slice(warnings, func(i, j int) bool {
		return warnings[i].Key < warnings[j].Key
	})
	return warnings
}

func resolveSchemaRuntimeType(value any) string {
	switch value.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64:
		return "number"
	case map[string]any:
		return "object"
	case []any:
		return "array"
	default:
		return "string"
	}
}
