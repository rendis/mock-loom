package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/getkin/kin-openapi/openapi3"

	"github.com/rendis/mock-loom/apps/api/internal/core/validation"
)

const maxCommandOutputBytes = 4096

type importedRoute struct {
	Method       string
	Path         string
	ContractJSON string
}

type commandRunner interface {
	Run(ctx context.Context, name string, args []string, stdin []byte) (stdout string, stderr string, err error)
}

type execCommandRunner struct{}

func (r *execCommandRunner) Run(ctx context.Context, name string, args []string, stdin []byte) (stdout string, stderr string, err error) {
	cmd := exec.CommandContext(ctx, name, args...)
	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}

	var out bytes.Buffer
	var errOut bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errOut
	err = cmd.Run()
	return out.String(), errOut.String(), err
}

func (s *IntegrationService) convertImportPayload(ctx context.Context, sourceType, payload string) ([]importedRoute, []string, error) {
	switch sourceType {
	case "OPENAPI":
		return s.parseOpenAPIRoutes(ctx, []byte(payload))
	case "POSTMAN":
		openapiPayload, err := s.convertPostmanToOpenAPI(ctx, payload)
		if err != nil {
			return nil, nil, err
		}
		return s.parseOpenAPIRoutes(ctx, openapiPayload)
	case "CURL":
		routes, warnings, err := s.convertCurlToRoute(ctx, payload)
		if err != nil {
			return nil, nil, err
		}
		return routes, warnings, nil
	default:
		return nil, nil, ErrInvalidInput
	}
}

func (s *IntegrationService) parseOpenAPIRoutes(ctx context.Context, payload []byte) ([]importedRoute, []string, error) {
	loader := openapi3.NewLoader()
	loader.IsExternalRefsAllowed = false
	doc, err := loader.LoadFromData(payload)
	if err != nil {
		return nil, nil, newValidationError(ErrSemanticValidation, "invalid OpenAPI payload", err.Error())
	}
	if err := doc.Validate(ctx); err != nil {
		return nil, nil, newValidationError(ErrSemanticValidation, "invalid OpenAPI document", err.Error())
	}

	routes := make([]importedRoute, 0)
	warnings := make([]string, 0)
	for path, pathItem := range doc.Paths.Map() {
		normalizedPath := normalizePath(path)
		if normalizedPath == "" {
			continue
		}
		appendRoute := func(method string, op *openapi3.Operation) {
			if op == nil {
				return
			}
			contractJSON, opWarnings := contractFromOperation(op)
			warnings = append(warnings, opWarnings...)
			routes = append(routes, importedRoute{
				Method:       normalizeMethod(method),
				Path:         normalizedPath,
				ContractJSON: contractJSON,
			})
		}

		appendRoute("GET", pathItem.Get)
		appendRoute("POST", pathItem.Post)
		appendRoute("PUT", pathItem.Put)
		appendRoute("PATCH", pathItem.Patch)
		appendRoute("DELETE", pathItem.Delete)
		appendRoute("HEAD", pathItem.Head)
		appendRoute("OPTIONS", pathItem.Options)
	}

	if len(routes) == 0 {
		return nil, nil, newValidationError(ErrSemanticValidation, "OpenAPI document does not define importable operations")
	}
	return routes, warnings, nil
}

func (s *IntegrationService) convertPostmanToOpenAPI(ctx context.Context, payload string) ([]byte, error) {
	tempDir, err := os.MkdirTemp("", "mock-loom-postman-import-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempDir)

	inputPath := filepath.Join(tempDir, "collection.json")
	outputPath := filepath.Join(tempDir, "openapi.yaml")
	if err := os.WriteFile(inputPath, []byte(payload), 0o600); err != nil {
		return nil, err
	}

	_, stderr, err := s.runCommandWithTimeout(
		ctx,
		s.importCfg.PostmanCLIPath,
		[]string{inputPath, "-f", outputPath},
		nil,
	)
	if err != nil {
		if validationErr, ok := asValidationError(err); ok {
			return nil, validationErr
		}
		return nil, newValidationError(ErrSemanticValidation, "failed to convert Postman collection", err.Error(), truncateText(stderr, maxCommandOutputBytes))
	}

	converted, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, newValidationError(ErrSemanticValidation, "postman converter did not generate output file", err.Error())
	}
	if strings.TrimSpace(string(converted)) == "" {
		return nil, newValidationError(ErrSemanticValidation, "postman converter returned empty output")
	}
	return converted, nil
}

func (s *IntegrationService) convertCurlToRoute(ctx context.Context, payload string) ([]importedRoute, []string, error) {
	stdout, stderr, err := s.runCommandWithTimeout(
		ctx,
		s.importCfg.CurlCLIPath,
		[]string{"--language", "json", "-"},
		[]byte(payload),
	)
	if err != nil {
		if validationErr, ok := asValidationError(err); ok {
			return nil, nil, validationErr
		}
		return nil, nil, newValidationError(ErrSemanticValidation, "failed to convert cURL command", err.Error(), truncateText(stderr, maxCommandOutputBytes))
	}

	type curlConverted struct {
		URL    string `json:"url"`
		RawURL string `json:"raw_url"`
		Method string `json:"method"`
	}
	var converted curlConverted
	if err := json.Unmarshal([]byte(stdout), &converted); err != nil {
		return nil, nil, newValidationError(
			ErrSemanticValidation,
			"curl converter produced invalid JSON output",
			err.Error(),
			"converter output: "+truncateText(stdout, maxCommandOutputBytes),
		)
	}

	rawURL := strings.TrimSpace(converted.URL)
	if rawURL == "" {
		rawURL = strings.TrimSpace(converted.RawURL)
	}
	if rawURL == "" {
		return nil, nil, newValidationError(ErrSemanticValidation, "cURL command must include a request URL")
	}
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, nil, newValidationError(ErrSemanticValidation, "cURL URL parsing failed", err.Error())
	}

	path := normalizePath(parsedURL.EscapedPath())
	if path == "" {
		path = "/"
	}

	method := normalizeMethod(converted.Method)
	if method == "" {
		method = "GET"
	}

	return []importedRoute{
		{
			Method:       method,
			Path:         path,
			ContractJSON: validation.DefaultImportedContractJSON(),
		},
	}, nil, nil
}

func (s *IntegrationService) runCommandWithTimeout(ctx context.Context, command string, args []string, stdin []byte) (stdout string, stderr string, err error) {
	timeout := time.Duration(s.importCfg.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	stdout, stderr, err = s.runner.Run(cmdCtx, command, args, stdin)
	stdout = truncateText(stdout, maxCommandOutputBytes)
	stderr = truncateText(stderr, maxCommandOutputBytes)

	if errors.Is(cmdCtx.Err(), context.DeadlineExceeded) {
		return stdout, stderr, newValidationError(ErrSemanticValidation, fmt.Sprintf("converter execution timed out after %ds", int(timeout.Seconds())))
	}
	if err != nil {
		return stdout, stderr, newValidationError(
			ErrSemanticValidation,
			"converter execution failed",
			fmt.Sprintf("command: %s %s", command, strings.Join(args, " ")),
			"stderr: "+stderr,
		)
	}
	return stdout, stderr, nil
}

func contractFromOperation(operation *openapi3.Operation) (string, []string) {
	contract := map[string]any{
		"type":                 "object",
		"additionalProperties": true,
	}
	warnings := make([]string, 0)

	if operation == nil || operation.RequestBody == nil || operation.RequestBody.Value == nil {
		payload, _ := json.Marshal(contract)
		return string(payload), warnings
	}

	bodySchemaRef, mediaType := pickOperationSchema(operation.RequestBody.Value.Content)
	if bodySchemaRef == nil || bodySchemaRef.Value == nil {
		if mediaType != "" {
			warnings = append(warnings, "request body schema not embedded for media type "+mediaType)
		}
		payload, _ := json.Marshal(contract)
		return string(payload), warnings
	}

	rawSchema, err := json.Marshal(bodySchemaRef.Value)
	if err != nil {
		warnings = append(warnings, "request body schema serialization failed: "+err.Error())
		payload, _ := json.Marshal(contract)
		return string(payload), warnings
	}
	var schema any
	if err := json.Unmarshal(rawSchema, &schema); err != nil {
		warnings = append(warnings, "request body schema normalization failed: "+err.Error())
		payload, _ := json.Marshal(contract)
		return string(payload), warnings
	}

	contract["properties"] = map[string]any{
		"body": schema,
	}
	payload, _ := json.Marshal(contract)
	return string(payload), warnings
}

func pickOperationSchema(content openapi3.Content) (*openapi3.SchemaRef, string) {
	if content == nil {
		return nil, ""
	}
	if media := content.Get("application/json"); media != nil {
		return media.Schema, "application/json"
	}

	keys := make([]string, 0, len(content))
	for key := range content {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		media := content.Get(key)
		if media != nil && media.Schema != nil {
			return media.Schema, key
		}
	}
	return nil, ""
}

func normalizeMethod(method string) string {
	method = strings.ToUpper(strings.TrimSpace(method))
	switch method {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD":
		return method
	default:
		return method
	}
}

func normalizePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return path
}

func truncateText(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "...(truncated)"
}
