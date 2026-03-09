package usecase

import (
	"bytes"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
)

type baselineParseOptions struct {
	CSVDelimiter string
}

func parseBaselinePayload(
	kind entity.DataSourceKind,
	filename string,
	payload []byte,
	options baselineParseOptions,
) ([]map[string]any, string, error) {
	resolvedKind, err := resolveDataSourceKind(kind, filename)
	if err != nil {
		return nil, "", err
	}

	switch resolvedKind {
	case entity.DataSourceKindCSV:
		delimiter, delimiterErr := resolveCSVDelimiter(options.CSVDelimiter)
		if delimiterErr != nil {
			return nil, "", delimiterErr
		}
		return parseCSVBaseline(payload, delimiter)
	case entity.DataSourceKindJSON:
		return parseJSONBaseline(payload)
	default:
		return nil, "", newValidationError(ErrSemanticValidation, "unsupported baseline kind")
	}
}

func resolveDataSourceKind(kind entity.DataSourceKind, filename string) (entity.DataSourceKind, error) {
	normalized := entity.DataSourceKind(strings.ToUpper(strings.TrimSpace(string(kind))))
	if normalized == entity.DataSourceKindCSV || normalized == entity.DataSourceKindJSON {
		return normalized, nil
	}
	lower := strings.ToLower(strings.TrimSpace(filename))
	switch {
	case strings.HasSuffix(lower, ".csv"):
		return entity.DataSourceKindCSV, nil
	case strings.HasSuffix(lower, ".json"):
		return entity.DataSourceKindJSON, nil
	default:
		return "", newValidationError(ErrSemanticValidation, "unable to infer baseline kind from payload")
	}
}

func resolveCSVDelimiter(raw string) (rune, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ',', nil
	}

	switch strings.ToLower(value) {
	case ",", "comma":
		return ',', nil
	case ";", "semicolon":
		return ';', nil
	case "|", "pipe":
		return '|', nil
	case "\t", "\\t", "tab":
		return '\t', nil
	}

	runes := []rune(value)
	if len(runes) == 1 && runes[0] != '\n' && runes[0] != '\r' {
		return runes[0], nil
	}
	return 0, newValidationError(
		ErrInvalidInput,
		"invalid csv delimiter; use comma, semicolon, tab, pipe, or a single character",
	)
}

func parseCSVBaseline(payload []byte, delimiter rune) ([]map[string]any, string, error) {
	reader := csv.NewReader(bytes.NewReader(payload))
	reader.FieldsPerRecord = -1
	reader.Comma = delimiter

	headers, err := reader.Read()
	if err != nil {
		if err == io.EOF {
			return nil, "", newValidationError(ErrSemanticValidation, "csv payload is empty")
		}
		return nil, "", newValidationError(ErrSemanticValidation, "failed to read csv header", err.Error())
	}
	if len(headers) == 0 {
		return nil, "", newValidationError(ErrSemanticValidation, "csv payload must include header row")
	}

	normalizedHeaders := make([]string, 0, len(headers))
	seenHeaders := map[string]struct{}{}
	for _, header := range headers {
		value := strings.TrimSpace(header)
		if value == "" {
			return nil, "", newValidationError(ErrSemanticValidation, "csv header contains empty column name")
		}
		if _, exists := seenHeaders[value]; exists {
			return nil, "", newValidationError(ErrSemanticValidation, "csv header contains duplicated column: "+value)
		}
		seenHeaders[value] = struct{}{}
		normalizedHeaders = append(normalizedHeaders, value)
	}

	rows := make([]map[string]any, 0)
	for rowIndex := 1; ; rowIndex++ {
		record, readErr := reader.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, "", newValidationError(ErrSemanticValidation, "failed to parse csv row", readErr.Error())
		}
		if len(record) != len(normalizedHeaders) {
			return nil, "", newValidationError(
				ErrSemanticValidation,
				fmt.Sprintf("csv row %d has %d fields but header has %d", rowIndex, len(record), len(normalizedHeaders)),
			)
		}

		item := make(map[string]any, len(normalizedHeaders))
		for idx, header := range normalizedHeaders {
			item[header] = strings.TrimSpace(record[idx])
		}
		rows = append(rows, item)
	}

	if len(rows) == 0 {
		return nil, "", newValidationError(ErrSemanticValidation, "csv payload does not include data rows")
	}

	schema := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties":           map[string]any{},
	}
	properties := schema["properties"].(map[string]any)
	for _, header := range normalizedHeaders {
		properties[header] = map[string]any{"type": "string"}
	}
	schemaJSON, marshalErr := marshalCanonicalJSON(schema)
	if marshalErr != nil {
		return nil, "", marshalErr
	}
	return rows, schemaJSON, nil
}

func parseJSONBaseline(payload []byte) ([]map[string]any, string, error) {
	var raw any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, "", newValidationError(ErrSemanticValidation, "baseline json payload is invalid", err.Error())
	}

	items, ok := raw.([]any)
	if !ok {
		return nil, "", newValidationError(ErrSemanticValidation, "baseline json payload must be an array of objects")
	}
	if len(items) == 0 {
		return nil, "", newValidationError(ErrSemanticValidation, "baseline json payload must include at least one row")
	}

	rows := make([]map[string]any, 0, len(items))
	var firstSchema map[string]string
	for idx, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, "", newValidationError(ErrSemanticValidation, fmt.Sprintf("row %d is not a json object", idx))
		}
		if len(object) == 0 {
			return nil, "", newValidationError(ErrSemanticValidation, fmt.Sprintf("row %d is an empty object", idx))
		}

		normalized := make(map[string]any, len(object))
		schemaRow := make(map[string]string, len(object))
		for key, value := range object {
			trimmed := strings.TrimSpace(key)
			if trimmed == "" {
				return nil, "", newValidationError(ErrSemanticValidation, fmt.Sprintf("row %d contains empty key", idx))
			}
			normalized[trimmed] = value
			schemaRow[trimmed] = resolveJSONType(value)
		}

		if idx == 0 {
			firstSchema = schemaRow
		} else if !sameSchema(firstSchema, schemaRow) {
			return nil, "", newValidationError(ErrSemanticValidation, "json payload rows must share the same shape and primitive types")
		}
		rows = append(rows, normalized)
	}

	schema := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties":           map[string]any{},
	}
	keys := make([]string, 0, len(firstSchema))
	for key := range firstSchema {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	properties := schema["properties"].(map[string]any)
	for _, key := range keys {
		properties[key] = map[string]any{"type": firstSchema[key]}
	}

	schemaJSON, err := marshalCanonicalJSON(schema)
	if err != nil {
		return nil, "", err
	}
	return rows, schemaJSON, nil
}

func sameSchema(left map[string]string, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, leftType := range left {
		rightType, ok := right[key]
		if !ok || rightType != leftType {
			return false
		}
	}
	return true
}

func resolveJSONType(value any) string {
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

func resolveEntityID(row map[string]any, sourceID string, index int) string {
	rawID := strings.TrimSpace(anyToString(row["id"]))
	if rawID != "" {
		return rawID
	}

	serialized, err := marshalCanonicalJSON(row)
	if err != nil {
		return fallbackEntityID(sourceID, index)
	}
	hash := sha256.Sum256([]byte(sourceID + "|" + serialized + "|" + strconv.Itoa(index)))
	return hex.EncodeToString(hash[:16])
}

func fallbackEntityID(sourceID string, index int) string {
	hash := sha256.Sum256([]byte(sourceID + "|" + strconv.Itoa(index)))
	return hex.EncodeToString(hash[:16])
}

func anyToString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case json.Number:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func marshalCanonicalJSON(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
