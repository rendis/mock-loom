package validation

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"

	"github.com/expr-lang/expr"
	jsonschema "github.com/santhosh-tekuri/jsonschema/v6"
)

// Error represents strict semantic validation failures.
type Error struct {
	Messages []string
}

// ScenarioValidationOptions defines strict validation behavior for scenarios.
type ScenarioValidationOptions struct {
	ActiveSourceSlugs       map[string]struct{}
	RequireKnownSourceSlugs bool
}

// Error returns a generic message for semantic validation failures.
func (e *Error) Error() string {
	return "validation failed"
}

// ValidateContractJSON ensures payload is a JSON object and valid JSON Schema.
func ValidateContractJSON(contractJSON string) (string, error) {
	parsed, err := decodeJSONObject(strings.TrimSpace(contractJSON))
	if err != nil {
		return "", &Error{Messages: []string{fmt.Sprintf("contract must be a valid JSON object: %v", err)}}
	}

	normalized, err := normalizeJSON(parsed)
	if err != nil {
		return "", err
	}

	compiler := jsonschema.NewCompiler()
	const resource = "mem://contract.schema.json"
	if err := compiler.AddResource(resource, parsed); err != nil {
		return "", &Error{Messages: []string{fmt.Sprintf("failed to register contract schema: %v", err)}}
	}
	if _, err := compiler.Compile(resource); err != nil {
		return "", &Error{Messages: []string{fmt.Sprintf("contract JSON Schema compile error: %v", err)}}
	}

	return string(normalized), nil
}

// ValidateScenariosJSON ensures scenarios satisfy strict editor/import rules.
func ValidateScenariosJSON(scenariosJSON string) (string, error) {
	return ValidateScenariosJSONWithOptions(scenariosJSON, ScenarioValidationOptions{})
}

// ValidateScenariosJSONWithOptions ensures scenarios satisfy strict editor/import rules
// with runtime-aware options.
func ValidateScenariosJSONWithOptions(scenariosJSON string, options ScenarioValidationOptions) (string, error) {
	payload := strings.TrimSpace(scenariosJSON)
	if payload == "" {
		return "", &Error{Messages: []string{"scenarios are required"}}
	}

	decoder := json.NewDecoder(strings.NewReader(payload))
	decoder.UseNumber()
	var parsed any
	if err := decoder.Decode(&parsed); err != nil {
		return "", &Error{Messages: []string{fmt.Sprintf("scenarios must be valid JSON: %v", err)}}
	}
	if err := ensureSingleDocument(decoder); err != nil {
		return "", &Error{Messages: []string{fmt.Sprintf("scenarios must contain exactly one JSON document: %v", err)}}
	}

	items, ok := parsed.([]any)
	if !ok {
		return "", &Error{Messages: []string{"scenarios root must be an array"}}
	}

	messages := make([]string, 0)
	priorities := map[int]int{}
	fallbackCount := 0

	for idx, raw := range items {
		entry, ok := raw.(map[string]any)
		if !ok {
			messages = append(messages, fmt.Sprintf("scenario[%d] must be an object", idx))
			continue
		}

		for key := range entry {
			if _, allowed := allowedScenarioKeys[key]; !allowed {
				messages = append(messages, fmt.Sprintf("scenario[%d].%s is not supported", idx, key))
			}
		}

		if rawName, exists := entry["name"]; exists {
			if _, ok := rawName.(string); !ok {
				messages = append(messages, fmt.Sprintf("scenario[%d].name must be a string", idx))
			}
		}

		priority, ok := readInteger(entry["priority"])
		if !ok || priority <= 0 {
			messages = append(messages, fmt.Sprintf("scenario[%d].priority must be a positive integer", idx))
		} else {
			if previous, exists := priorities[priority]; exists {
				messages = append(messages, fmt.Sprintf("scenario[%d].priority duplicates scenario[%d] with value %d", idx, previous, priority))
			} else {
				priorities[priority] = idx
			}
		}

		condition, ok := entry["conditionExpr"].(string)
		condition = strings.TrimSpace(condition)
		if !ok || condition == "" {
			messages = append(messages, fmt.Sprintf("scenario[%d].conditionExpr is required", idx))
		} else {
			if err := compileConditionExpr(condition); err != nil {
				messages = append(messages, fmt.Sprintf("scenario[%d].conditionExpr compile error: %v", idx, err))
			}
			if condition == "true" {
				fallbackCount++
			}
		}

		response, exists := entry["response"]
		if !exists {
			messages = append(messages, fmt.Sprintf("scenario[%d].response is required", idx))
			continue
		}
		responseObject, ok := response.(map[string]any)
		if !ok {
			messages = append(messages, fmt.Sprintf("scenario[%d].response must be an object", idx))
			continue
		}
		for key := range responseObject {
			if _, allowed := allowedResponseKeys[key]; !allowed {
				messages = append(messages, fmt.Sprintf("scenario[%d].response.%s is not supported", idx, key))
			}
		}
		statusCode, ok := readInteger(responseObject["statusCode"])
		if !ok || statusCode < 100 || statusCode > 599 {
			messages = append(messages, fmt.Sprintf("scenario[%d].response.statusCode must be an integer between 100 and 599", idx))
		}
		delayMS, ok := readInteger(responseObject["delayMs"])
		if !ok || delayMS < 0 {
			messages = append(messages, fmt.Sprintf("scenario[%d].response.delayMs must be an integer greater than or equal to 0", idx))
		}
		headersRaw, headersExists := responseObject["headers"]
		if !headersExists {
			messages = append(messages, fmt.Sprintf("scenario[%d].response.headers is required", idx))
		} else {
			headersMap, ok := headersRaw.(map[string]any)
			if !ok {
				messages = append(messages, fmt.Sprintf("scenario[%d].response.headers must be an object", idx))
			} else {
				for key, value := range headersMap {
					if strings.TrimSpace(key) == "" {
						messages = append(messages, fmt.Sprintf("scenario[%d].response.headers contains an empty key", idx))
						continue
					}
					if _, ok := value.(string); !ok {
						messages = append(messages, fmt.Sprintf("scenario[%d].response.headers.%s must be a string", idx, key))
					}
				}
			}
		}
		bodyRaw, bodyExists := responseObject["body"]
		if !bodyExists {
			messages = append(messages, fmt.Sprintf("scenario[%d].response.body is required", idx))
		} else {
			switch bodyRaw.(type) {
			case map[string]any, string:
				// valid: JSON object or raw string
			default:
				messages = append(messages, fmt.Sprintf("scenario[%d].response.body must be a JSON object or a string", idx))
			}
		}

		mutationsRaw, mutationsExists := entry["mutations"]
		if !mutationsExists {
			continue
		}
		mutations, ok := mutationsRaw.([]any)
		if !ok {
			messages = append(messages, fmt.Sprintf("scenario[%d].mutations must be an array", idx))
			continue
		}
		for mutationIndex, rawMutation := range mutations {
			mutation, ok := rawMutation.(map[string]any)
			if !ok {
				messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d] must be an object", idx, mutationIndex))
				continue
			}
			for key := range mutation {
				if _, allowed := allowedMutationKeys[key]; !allowed {
					messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d].%s is not supported", idx, mutationIndex, key))
				}
			}

			mutationType, ok := mutation["type"].(string)
			mutationType = strings.ToUpper(strings.TrimSpace(mutationType))
			if !ok || (mutationType != "UPSERT" && mutationType != "DELETE") {
				messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d].type must be UPSERT or DELETE", idx, mutationIndex))
				continue
			}

			sourceSlug, ok := mutation["sourceSlug"].(string)
			sourceSlug = strings.TrimSpace(sourceSlug)
			if !ok || sourceSlug == "" {
				messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d].sourceSlug is required", idx, mutationIndex))
			} else if options.RequireKnownSourceSlugs && !sourceSlugExists(sourceSlug, options.ActiveSourceSlugs) {
				messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d].sourceSlug \"%s\" is not active in runtime context", idx, mutationIndex, sourceSlug))
			}

			entityIDExpr, ok := mutation["entityIdExpr"].(string)
			entityIDExpr = strings.TrimSpace(entityIDExpr)
			if !ok || entityIDExpr == "" {
				messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d].entityIdExpr is required", idx, mutationIndex))
			} else if err := compileAnyExpr(entityIDExpr); err != nil {
				messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d].entityIdExpr compile error: %v", idx, mutationIndex, err))
			}

			payloadRaw, payloadExists := mutation["payloadExpr"]
			switch mutationType {
			case "UPSERT":
				payloadExpr, ok := payloadRaw.(string)
				payloadExpr = strings.TrimSpace(payloadExpr)
				if !payloadExists || !ok || payloadExpr == "" {
					messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d].payloadExpr is required for UPSERT", idx, mutationIndex))
				} else if err := compileAnyExpr(payloadExpr); err != nil {
					messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d].payloadExpr compile error: %v", idx, mutationIndex, err))
				}
			case "DELETE":
				if payloadExists {
					messages = append(messages, fmt.Sprintf("scenario[%d].mutations[%d].payloadExpr must be omitted for DELETE", idx, mutationIndex))
				}
			}
		}
	}

	if fallbackCount > 1 {
		messages = append(messages, "at most one fallback scenario with conditionExpr \"true\" is allowed")
	}

	if len(messages) > 0 {
		sort.Strings(messages)
		return "", &Error{Messages: messages}
	}

	normalized, err := normalizeJSON(parsed)
	if err != nil {
		return "", err
	}
	return string(normalized), nil
}

// DefaultImportedContractJSON returns a generic request contract schema for imports.
func DefaultImportedContractJSON() string {
	payload := map[string]any{
		"type":                 "object",
		"additionalProperties": true,
	}
	bytes, _ := json.Marshal(payload)
	return string(bytes)
}

// DefaultImportedScenariosJSON returns deterministic empty scenario list.
func DefaultImportedScenariosJSON(method, path string) string {
	_ = method
	_ = path
	bytes, _ := json.Marshal([]map[string]any{})
	return string(bytes)
}

func decodeJSONObject(payload string) (map[string]any, error) {
	if payload == "" {
		return nil, fmt.Errorf("payload is empty")
	}

	decoder := json.NewDecoder(strings.NewReader(payload))
	decoder.UseNumber()
	var parsed any
	if err := decoder.Decode(&parsed); err != nil {
		return nil, err
	}
	if err := ensureSingleDocument(decoder); err != nil {
		return nil, err
	}

	root, ok := parsed.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("root must be a JSON object")
	}
	return root, nil
}

func ensureSingleDocument(decoder *json.Decoder) error {
	var trailing any
	err := decoder.Decode(&trailing)
	if err == io.EOF {
		return nil
	}
	if err != nil {
		return err
	}
	return fmt.Errorf("trailing content detected")
}

func normalizeJSON(payload any) ([]byte, error) {
	bytes, err := json.Marshal(payload)
	if err != nil {
		return nil, &Error{Messages: []string{fmt.Sprintf("failed to normalize JSON payload: %v", err)}}
	}
	return bytes, nil
}

func compileConditionExpr(expression string) error {
	_, err := expr.Compile(
		expression,
		expr.AsBool(),
		expr.AllowUndefinedVariables(),
		expr.Env(map[string]any{
			"request": map[string]any{},
			"source":  map[string]any{},
			"auth":    map[string]any{},
		}),
	)
	return err
}

func compileAnyExpr(expression string) error {
	_, err := expr.Compile(
		expression,
		expr.AllowUndefinedVariables(),
		expr.Env(map[string]any{
			"request": map[string]any{},
			"source":  map[string]any{},
			"auth":    map[string]any{},
		}),
	)
	return err
}

func sourceSlugExists(slug string, active map[string]struct{}) bool {
	if len(active) == 0 {
		return false
	}
	_, ok := active[slug]
	return ok
}

var allowedScenarioKeys = map[string]struct{}{
	"name":          {},
	"priority":      {},
	"conditionExpr": {},
	"response":      {},
	"mutations":     {},
}

var allowedResponseKeys = map[string]struct{}{
	"statusCode": {},
	"delayMs":    {},
	"headers":    {},
	"body":       {},
}

var allowedMutationKeys = map[string]struct{}{
	"type":         {},
	"sourceSlug":   {},
	"entityIdExpr": {},
	"payloadExpr":  {},
}

func readInteger(raw any) (int, bool) {
	switch value := raw.(type) {
	case json.Number:
		parsed, err := value.Int64()
		if err != nil {
			return 0, false
		}
		return int(parsed), true
	case float64:
		parsed := int(value)
		return parsed, float64(parsed) == value
	case int:
		return value, true
	case int64:
		return int(value), true
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}
