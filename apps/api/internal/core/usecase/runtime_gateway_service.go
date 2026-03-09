package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/expr-lang/expr"
	"github.com/google/uuid"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// RuntimeGatewayService executes runtime mock requests through endpoint scenarios.
type RuntimeGatewayService struct {
	tx           ports.TxManager
	integrations ports.IntegrationRepository
	endpoints    ports.EndpointRepository
	dataSources  ports.DataSourceRepository
	authMock     *AuthMockService
}

// RuntimeExecuteInput defines runtime request context.
type RuntimeExecuteInput struct {
	WorkspaceID   string
	IntegrationID string
	Method        string
	Path          string
	Headers       map[string]string
	Query         url.Values
	BodyRaw       []byte
}

// RuntimeExecuteResult contains status, headers, and response payload.
type RuntimeExecuteResult struct {
	StatusCode int
	Headers    map[string]string
	BodyRaw    []byte
}

type runtimeScenario struct {
	Name          string            `json:"name"`
	Priority      int               `json:"priority"`
	ConditionExpr string            `json:"conditionExpr"`
	Response      runtimeResponse   `json:"response"`
	Mutations     []runtimeMutation `json:"mutations"`
}

type runtimeResponse struct {
	StatusCode int               `json:"statusCode"`
	Headers    map[string]string `json:"headers"`
	Body       any               `json:"body"`
	DelayMS    int               `json:"delayMs"`
}

type runtimeMutation struct {
	Type         string `json:"type"`
	SourceSlug   string `json:"sourceSlug"`
	EntityIDExpr string `json:"entityIdExpr"`
	PayloadExpr  string `json:"payloadExpr"`
}

const runtimeNoMatchScenario = "__no_match__"
const runtimeNoMatchCode = "NO_MATCH_NO_FALLBACK"
const runtimeNoMatchError = "No matching scenario and no fallback configured"

// NewRuntimeGatewayService returns RuntimeGatewayService.
func NewRuntimeGatewayService(
	tx ports.TxManager,
	integrations ports.IntegrationRepository,
	endpoints ports.EndpointRepository,
	dataSources ports.DataSourceRepository,
	authMock *AuthMockService,
) *RuntimeGatewayService {
	return &RuntimeGatewayService{
		tx:           tx,
		integrations: integrations,
		endpoints:    endpoints,
		dataSources:  dataSources,
		authMock:     authMock,
	}
}

// Execute processes one runtime mock request from `/mock/:workspaceId/:integrationId/*path`.
func (s *RuntimeGatewayService) Execute(ctx context.Context, input RuntimeExecuteInput) (*RuntimeExecuteResult, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.IntegrationID = strings.TrimSpace(input.IntegrationID)
	input.Method = strings.ToUpper(strings.TrimSpace(input.Method))
	input.Path = normalizeRuntimePath(input.Path)
	if input.WorkspaceID == "" || input.IntegrationID == "" || input.Method == "" {
		return nil, ErrInvalidInput
	}

	integration, err := s.integrations.FindByID(ctx, input.IntegrationID)
	if err != nil {
		return nil, err
	}
	if integration.WorkspaceID != input.WorkspaceID {
		return nil, ports.ErrNotFound
	}

	endpoint, err := s.resolveRuntimeEndpoint(ctx, input.IntegrationID, input.Method, input.Path)
	if err != nil {
		return nil, err
	}

	requestBody := decodeRuntimeRequestBody(input.BodyRaw, input.Headers["content-type"])
	sourceEnv, err := s.buildRuntimeSourceEnv(ctx, input.IntegrationID)
	if err != nil {
		return nil, err
	}
	pathParams := extractPathParams(endpoint.Path, input.Path)
	requestEnv := buildRuntimeRequestEnv(input.Method, input.Path, input.Headers, input.Query, requestBody, pathParams)

	enforced, policy, err := s.resolveEndpointAuthPolicy(ctx, input.IntegrationID, endpoint)
	if err != nil {
		return nil, err
	}
	authResult := AuthEvaluationResult{
		Allowed: true,
		Status:  200,
		Context: RuntimeAuthContext{
			Token:   "",
			Email:   "",
			Claims:  map[string]any{},
			Headers: input.Headers,
		},
	}
	if enforced && policy != nil {
		authResult, err = evaluateAuthMockPolicy(policy, requestEnv, input.Headers)
		if err != nil {
			return nil, err
		}
		if !authResult.Allowed {
			responseBody := map[string]any{"error": authResult.Reason}
			encoded, _ := json.Marshal(responseBody)
			return &RuntimeExecuteResult{
				StatusCode: authResult.Status,
				Headers: map[string]string{
					"Content-Type": "application/json",
				},
				BodyRaw: encoded,
			}, nil
		}
	}

	scenarios, err := parseRuntimeScenarios(endpoint.ScenariosJSON)
	if err != nil {
		return nil, err
	}
	selected, err := selectRuntimeScenario(scenarios, requestEnv, sourceEnv, authResult.Context)
	if err != nil {
		return nil, err
	}
	if selected == nil {
		statusCode := http.StatusInternalServerError
		responseBody := map[string]any{
			"error":           runtimeNoMatchError,
			"code":            runtimeNoMatchCode,
			"matchedScenario": runtimeNoMatchScenario,
			"method":          input.Method,
			"path":            input.Path,
		}
		encodedBody, marshalErr := json.Marshal(responseBody)
		if marshalErr != nil {
			return nil, marshalErr
		}

		if err := s.appendRuntimeTraffic(
			ctx,
			input.IntegrationID,
			endpoint.ID,
			input.Method,
			input.Path,
			mapRuntimeQuery(input.Query),
			requestBody,
			statusCode,
			runtimeNoMatchScenario,
		); err != nil {
			return nil, err
		}

		return &RuntimeExecuteResult{
			StatusCode: statusCode,
			Headers: map[string]string{
				"Content-Type": "application/json",
			},
			BodyRaw: encodedBody,
		}, nil
	}

	env := map[string]any{
		"request": requestEnv,
		"source":  sourceEnv,
		"auth": map[string]any{
			"token":   authResult.Context.Token,
			"email":   authResult.Context.Email,
			"claims":  authResult.Context.Claims,
			"headers": authResult.Context.Headers,
		},
	}

	statusCode := selected.Response.StatusCode
	if statusCode <= 0 {
		statusCode = 200
	}
	matchedScenario := strings.TrimSpace(selected.Name)
	if matchedScenario == "" {
		matchedScenario = strings.TrimSpace(selected.ConditionExpr)
	}
	if matchedScenario == "" {
		matchedScenario = "anonymous-scenario"
	}

	if err := s.tx.WithTx(ctx, func(txCtx context.Context) error {
		if err := s.applyRuntimeMutations(txCtx, input.IntegrationID, selected.Mutations, env, selected.Name); err != nil {
			return err
		}
		return s.appendRuntimeTrafficInTx(
			txCtx,
			input.IntegrationID,
			endpoint.ID,
			input.Method,
			input.Path,
			mapRuntimeQuery(input.Query),
			requestBody,
			statusCode,
			matchedScenario,
		)
	}); err != nil {
		return nil, err
	}

	headers := map[string]string{}
	for key, value := range selected.Response.Headers {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		headers[trimmedKey] = strings.TrimSpace(value)
	}
	bodyRaw, contentType, err := encodeRuntimeResponseBody(selected.Response.Body)
	if err != nil {
		return nil, err
	}
	if _, exists := headers["Content-Type"]; !exists && contentType != "" {
		headers["Content-Type"] = contentType
	}

	if selected.Response.DelayMS > 0 {
		time.Sleep(time.Duration(selected.Response.DelayMS) * time.Millisecond)
	}

	return &RuntimeExecuteResult{
		StatusCode: statusCode,
		Headers:    headers,
		BodyRaw:    bodyRaw,
	}, nil
}

func (s *RuntimeGatewayService) appendRuntimeTraffic(
	ctx context.Context,
	integrationID string,
	endpointID string,
	method string,
	path string,
	query map[string]any,
	body any,
	statusCode int,
	matchedScenario string,
) error {
	return s.tx.WithTx(ctx, func(txCtx context.Context) error {
		return s.appendRuntimeTrafficInTx(txCtx, integrationID, endpointID, method, path, query, body, statusCode, matchedScenario)
	})
}

func (s *RuntimeGatewayService) appendRuntimeTrafficInTx(
	txCtx context.Context,
	integrationID string,
	endpointID string,
	method string,
	path string,
	query map[string]any,
	body any,
	statusCode int,
	matchedScenario string,
) error {
	trafficID := uuid.NewString()
	statusLine := fmt.Sprintf("%d %s", statusCode, http.StatusText(statusCode))
	requestSummary, marshalErr := marshalCanonicalJSON(map[string]any{
		"method":   method,
		"path":     path,
		"query":    query,
		"body":     body,
		"status":   statusLine,
		"scenario": matchedScenario,
	})
	if marshalErr != nil {
		return marshalErr
	}

	return s.endpoints.AppendTraffic(txCtx, &entity.TrafficEvent{
		ID:                 trafficID,
		IntegrationID:      integrationID,
		EndpointID:         &endpointID,
		RequestSummaryJSON: requestSummary,
		MatchedScenario:    &matchedScenario,
		CreatedAt:          time.Now().UTC(),
	})
}

func (s *RuntimeGatewayService) resolveRuntimeEndpoint(
	ctx context.Context,
	integrationID string,
	method string,
	requestPath string,
) (*entity.IntegrationEndpoint, error) {
	routes, err := s.endpoints.ListRoutes(ctx, integrationID)
	if err != nil {
		return nil, err
	}

	candidates := make([]*entity.IntegrationEndpoint, 0)
	for _, route := range routes {
		if strings.ToUpper(strings.TrimSpace(route.Method)) != method {
			continue
		}
		if normalizeRuntimePath(route.Path) == requestPath {
			return route, nil
		}
		if matchesPathTemplate(route.Path, requestPath) {
			candidates = append(candidates, route)
		}
	}
	if len(candidates) == 0 {
		return nil, ports.ErrNotFound
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return routeSpecificityScore(candidates[i].Path) > routeSpecificityScore(candidates[j].Path)
	})
	return candidates[0], nil
}

func (s *RuntimeGatewayService) resolveEndpointAuthPolicy(
	ctx context.Context,
	integrationID string,
	endpoint *entity.IntegrationEndpoint,
) (bool, *entity.AuthMockPolicy, error) {
	if endpoint == nil {
		return false, nil, ErrInvalidInput
	}

	mode := endpoint.AuthMode
	if mode == "" {
		mode = entity.EndpointAuthModeInherit
	}

	switch mode {
	case entity.EndpointAuthModeNone:
		return false, nil, nil
	case entity.EndpointAuthModeOverride:
		payload, err := parseStoredAuthPolicy(endpoint.AuthOverridePolicyJSON)
		if err != nil {
			return false, nil, newValidationError(ErrSemanticValidation, "invalid endpoint auth override policy")
		}
		return true, &entity.AuthMockPolicy{
			IntegrationID: integrationID,
			Mode:          entity.AuthMockPolicyMode(payload.Mode),
			Prebuilt:      payload.Prebuilt,
			CustomExpr:    payload.CustomExpr,
			UpdatedAt:     time.Now().UTC(),
		}, nil
	default:
		pack, err := s.integrations.FindPackByID(ctx, integrationID, endpoint.PackID)
		if err != nil {
			return false, nil, err
		}
		if !pack.AuthEnabled {
			return false, nil, nil
		}
		payload, err := parseStoredAuthPolicy(pack.AuthPolicyJSON)
		if err != nil {
			return false, nil, newValidationError(ErrSemanticValidation, "invalid pack auth policy")
		}
		return true, &entity.AuthMockPolicy{
			IntegrationID: integrationID,
			Mode:          entity.AuthMockPolicyMode(payload.Mode),
			Prebuilt:      payload.Prebuilt,
			CustomExpr:    payload.CustomExpr,
			UpdatedAt:     time.Now().UTC(),
		}, nil
	}
}

func (s *RuntimeGatewayService) buildRuntimeSourceEnv(ctx context.Context, integrationID string) (map[string]any, error) {
	result := map[string]any{}
	sources, err := s.dataSources.ListByIntegration(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	for _, source := range sources {
		snapshotID, snapshotErr := s.dataSources.FindLatestSnapshotID(ctx, integrationID, source.Slug)
		if snapshotErr != nil {
			if errors.Is(snapshotErr, ports.ErrNotFound) {
				result[source.Slug] = []any{}
				continue
			}
			return nil, snapshotErr
		}
		entities, entitiesErr := s.dataSources.ListDebuggerEntities(ctx, source.ID, snapshotID)
		if entitiesErr != nil {
			return nil, entitiesErr
		}
		values := make([]any, 0, len(entities))
		byID := map[string]any{}
		for _, item := range entities {
			row := map[string]any{}
			if err := json.Unmarshal([]byte(item.CurrentDataJSON), &row); err != nil {
				row = map[string]any{"_raw": item.CurrentDataJSON}
			}
			values = append(values, row)
			byID[item.EntityID] = row
		}
		result[source.Slug] = values
		result[source.Slug+"_by_id"] = byID
	}
	return result, nil
}

func (s *RuntimeGatewayService) applyRuntimeMutations(
	ctx context.Context,
	integrationID string,
	mutations []runtimeMutation,
	env map[string]any,
	scenarioName string,
) error {
	if len(mutations) == 0 {
		return nil
	}

	touchedSources := map[string]struct{}{}
	now := time.Now().UTC()
	for _, mutation := range mutations {
		mutationType := strings.ToUpper(strings.TrimSpace(mutation.Type))
		sourceSlug := strings.ToLower(strings.TrimSpace(mutation.SourceSlug))
		if mutationType == "" || sourceSlug == "" {
			return newValidationError(ErrSemanticValidation, "mutation type and sourceSlug are required")
		}

		source, err := s.dataSources.FindByIntegrationAndSlug(ctx, integrationID, sourceSlug)
		if err != nil {
			if errors.Is(err, ports.ErrNotFound) {
				return ports.ErrNotFound
			}
			return err
		}
		snapshotID, err := s.dataSources.FindLatestSnapshotID(ctx, integrationID, sourceSlug)
		if err != nil {
			return err
		}

		entityID, err := evaluateStringExpr(mutation.EntityIDExpr, env)
		if err != nil {
			return newValidationError(ErrSemanticValidation, "mutation entityIdExpr is invalid", err.Error())
		}
		entityID = strings.TrimSpace(entityID)
		if entityID == "" {
			return newValidationError(ErrSemanticValidation, "mutation entityIdExpr resolved empty entity id")
		}

		switch mutationType {
		case "UPSERT":
			payloadValue, payloadErr := evaluateAnyExpr(mutation.PayloadExpr, env)
			if payloadErr != nil {
				return newValidationError(ErrSemanticValidation, "mutation payloadExpr is invalid", payloadErr.Error())
			}
			payloadObject, ok := payloadValue.(map[string]any)
			if !ok || payloadObject == nil {
				return newValidationError(ErrSemanticValidation, "UPSERT payloadExpr must resolve to a JSON object")
			}
			if idValue := strings.TrimSpace(anyToString(payloadObject["id"])); idValue != "" && entityID == "" {
				entityID = idValue
			}
			afterJSON, err := marshalCanonicalJSON(payloadObject)
			if err != nil {
				return err
			}

			beforeJSON := "null"
			current, findErr := s.dataSources.FindWorkingEntity(ctx, source.ID, snapshotID, entityID)
			if findErr == nil {
				beforeJSON = current.CurrentDataJSON
			} else if !errors.Is(findErr, ports.ErrNotFound) {
				return findErr
			}

			if err := s.dataSources.UpsertWorkingEntity(ctx, source.ID, snapshotID, entityID, afterJSON, now); err != nil {
				return err
			}
			diffPayload, err := buildRuntimeMutationPayload(beforeJSON, afterJSON, mutationType, scenarioName)
			if err != nil {
				return err
			}
			if err := s.dataSources.AppendEntityEvent(ctx, &entity.DataEvent{
				EventID:     uuid.NewString(),
				SnapshotID:  snapshotID,
				EntityID:    entityID,
				Action:      "RUNTIME_UPSERT",
				DiffPayload: diffPayload,
				Timestamp:   now,
			}); err != nil {
				return err
			}
			touchedSources[source.ID] = struct{}{}

		case "DELETE":
			beforeJSON := "null"
			current, findErr := s.dataSources.FindWorkingEntity(ctx, source.ID, snapshotID, entityID)
			if findErr == nil {
				beforeJSON = current.CurrentDataJSON
			} else if !errors.Is(findErr, ports.ErrNotFound) {
				return findErr
			}

			if err := s.dataSources.DeleteWorkingEntity(ctx, source.ID, snapshotID, entityID); err != nil {
				return err
			}
			diffPayload, err := buildRuntimeMutationPayload(beforeJSON, "null", mutationType, scenarioName)
			if err != nil {
				return err
			}
			if err := s.dataSources.AppendEntityEvent(ctx, &entity.DataEvent{
				EventID:     uuid.NewString(),
				SnapshotID:  snapshotID,
				EntityID:    entityID,
				Action:      "RUNTIME_DELETE",
				DiffPayload: diffPayload,
				Timestamp:   now,
			}); err != nil {
				return err
			}
			touchedSources[source.ID] = struct{}{}
		default:
			return newValidationError(ErrSemanticValidation, "mutation type must be UPSERT or DELETE")
		}
	}

	for sourceID := range touchedSources {
		source, err := s.dataSources.FindByID(ctx, sourceID)
		if err != nil {
			return err
		}
		snapshotID, err := s.dataSources.FindLatestSnapshotID(ctx, integrationID, source.Slug)
		if err != nil {
			return err
		}
		count, err := s.dataSources.CountWorkingEntities(ctx, source.ID, snapshotID)
		if err != nil {
			return err
		}
		if err := s.dataSources.UpdateSyncStats(ctx, source.ID, count, now); err != nil {
			return err
		}
	}
	return nil
}

func parseRuntimeScenarios(payload string) ([]runtimeScenario, error) {
	items := make([]runtimeScenario, 0)
	if err := json.Unmarshal([]byte(strings.TrimSpace(payload)), &items); err != nil {
		return nil, newValidationError(ErrSemanticValidation, "scenarios payload is invalid JSON", err.Error())
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].Priority < items[j].Priority
	})
	return items, nil
}

func selectRuntimeScenario(
	scenarios []runtimeScenario,
	requestEnv map[string]any,
	sourceEnv map[string]any,
	authContext RuntimeAuthContext,
) (*runtimeScenario, error) {
	if len(scenarios) == 0 {
		return nil, nil
	}
	env := map[string]any{
		"request": requestEnv,
		"source":  sourceEnv,
		"auth": map[string]any{
			"token":   authContext.Token,
			"email":   authContext.Email,
			"claims":  authContext.Claims,
			"headers": authContext.Headers,
		},
	}

	for index := range scenarios {
		item := scenarios[index]
		condition := strings.TrimSpace(item.ConditionExpr)
		if condition == "" {
			continue
		}
		program, err := expr.Compile(
			condition,
			expr.AsBool(),
			expr.AllowUndefinedVariables(),
			expr.Env(map[string]any{
				"request": map[string]any{},
				"source":  map[string]any{},
				"auth":    map[string]any{},
			}),
		)
		if err != nil {
			return nil, fmt.Errorf("compile scenario condition: %w", err)
		}
		result, err := expr.Run(program, env)
		if err != nil {
			return nil, fmt.Errorf("evaluate scenario condition: %w", err)
		}
		matched, ok := result.(bool)
		if !ok {
			return nil, errors.New("scenario condition must return boolean")
		}
		if matched {
			return &item, nil
		}
	}
	return nil, nil
}

func evaluateAnyExpr(expression string, env map[string]any) (any, error) {
	expression = strings.TrimSpace(expression)
	if expression == "" {
		return nil, nil
	}
	program, err := expr.Compile(
		expression,
		expr.AllowUndefinedVariables(),
		expr.Env(map[string]any{
			"request": map[string]any{},
			"source":  map[string]any{},
			"auth":    map[string]any{},
		}),
	)
	if err != nil {
		return nil, err
	}
	return expr.Run(program, env)
}

func evaluateStringExpr(expression string, env map[string]any) (string, error) {
	value, err := evaluateAnyExpr(expression, env)
	if err != nil {
		return "", err
	}
	return anyToString(value), nil
}

func buildRuntimeMutationPayload(beforeJSON, afterJSON, mutationType, scenarioName string) (string, error) {
	beforeState, err := decodeJSONObjectOrNull(beforeJSON)
	if err != nil {
		return "", err
	}
	afterState, err := decodeJSONObjectOrNull(afterJSON)
	if err != nil {
		return "", err
	}
	payload := map[string]any{
		"mutationType": strings.ToUpper(strings.TrimSpace(mutationType)),
		"scenario":     strings.TrimSpace(scenarioName),
		"before":       beforeState,
		"after":        afterState,
	}
	if afterState != nil {
		payload["restoredState"] = afterState
	}
	return marshalCanonicalJSON(payload)
}

func buildRuntimeRequestEnv(
	method string,
	path string,
	headers map[string]string,
	query url.Values,
	body any,
	pathParams map[string]string,
) map[string]any {
	queryMap := mapRuntimeQuery(query)
	pathParamMap := map[string]any{}
	for key, value := range pathParams {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		pathParamMap[trimmedKey] = strings.TrimSpace(value)
	}
	return map[string]any{
		"method": method,
		"path":   path,
		"header": headers,
		"query":  queryMap,
		"body":   body,
		"params": map[string]any{
			"path":    pathParamMap,
			"query":   queryMap,
			"headers": headers,
			"body":    body,
		},
	}
}

func mapRuntimeQuery(values url.Values) map[string]any {
	result := map[string]any{}
	for key, rawValues := range values {
		if len(rawValues) == 0 {
			continue
		}
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		if len(rawValues) == 1 {
			result[trimmedKey] = rawValues[0]
			continue
		}
		items := make([]string, 0, len(rawValues))
		for _, value := range rawValues {
			items = append(items, value)
		}
		result[trimmedKey] = items
	}
	return result
}

func decodeRuntimeRequestBody(raw []byte, contentType string) any {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return map[string]any{}
	}
	if isFormURLEncoded(contentType) {
		return decodeFormBody(trimmed)
	}
	var parsed any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return trimmed
	}
	return parsed
}

func isFormURLEncoded(contentType string) bool {
	mediaType := strings.SplitN(strings.TrimSpace(strings.ToLower(contentType)), ";", 2)[0]
	return strings.TrimSpace(mediaType) == "application/x-www-form-urlencoded"
}

func decodeFormBody(body string) map[string]any {
	values, err := url.ParseQuery(body)
	if err != nil {
		return map[string]any{}
	}
	result := make(map[string]any, len(values))
	for key, vals := range values {
		if len(vals) > 0 {
			result[key] = vals[0]
		} else {
			result[key] = ""
		}
	}
	return result
}

func encodeRuntimeResponseBody(value any) ([]byte, string, error) {
	if value == nil {
		return []byte{}, "", nil
	}
	switch typed := value.(type) {
	case string:
		return []byte(typed), "text/plain; charset=utf-8", nil
	case []byte:
		return typed, "application/octet-stream", nil
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, "", err
		}
		return encoded, "application/json", nil
	}
}

func normalizeRuntimePath(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "/"
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}
	for strings.Contains(trimmed, "//") {
		trimmed = strings.ReplaceAll(trimmed, "//", "/")
	}
	if trimmed != "/" && strings.HasSuffix(trimmed, "/") {
		trimmed = strings.TrimSuffix(trimmed, "/")
	}
	return trimmed
}

func matchesPathTemplate(templatePath, requestPath string) bool {
	templateSegments := splitPathSegments(normalizeRuntimePath(templatePath))
	requestSegments := splitPathSegments(normalizeRuntimePath(requestPath))
	if len(templateSegments) != len(requestSegments) {
		return false
	}
	for i := range templateSegments {
		left := templateSegments[i]
		right := requestSegments[i]
		if left == right {
			continue
		}
		if isTemplateSegment(left) {
			continue
		}
		return false
	}
	return true
}

func extractPathParams(templatePath, requestPath string) map[string]string {
	templateSegments := splitPathSegments(normalizeRuntimePath(templatePath))
	requestSegments := splitPathSegments(normalizeRuntimePath(requestPath))
	params := map[string]string{}
	if len(templateSegments) != len(requestSegments) {
		return params
	}
	for i := range templateSegments {
		paramName := pathTemplateParamName(templateSegments[i])
		if paramName == "" {
			continue
		}
		params[paramName] = requestSegments[i]
	}
	return params
}

func splitPathSegments(path string) []string {
	if path == "/" {
		return []string{}
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		result = append(result, trimmed)
	}
	return result
}

func pathTemplateParamName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, ":") {
		return strings.TrimSpace(strings.TrimPrefix(trimmed, ":"))
	}
	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		return strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(trimmed, "{"), "}"))
	}
	return ""
}

func isTemplateSegment(value string) bool {
	return pathTemplateParamName(value) != ""
}

func routeSpecificityScore(path string) int {
	segments := splitPathSegments(normalizeRuntimePath(path))
	score := 0
	for _, segment := range segments {
		if isTemplateSegment(segment) {
			continue
		}
		score += 10
	}
	score += len(segments)
	return score
}

func parseInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}
