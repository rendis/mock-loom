package usecase

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/expr-lang/expr"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

// AuthMockService handles integration-level runtime auth mock policies.
type AuthMockService struct {
	integrations ports.IntegrationRepository
}

// NewAuthMockService returns AuthMockService.
func NewAuthMockService(integrations ports.IntegrationRepository) *AuthMockService {
	return &AuthMockService{integrations: integrations}
}

// UpdateAuthMockPolicyInput defines update payload for runtime auth simulation.
type UpdateAuthMockPolicyInput struct {
	Mode       string
	Prebuilt   entity.AuthMockPrebuiltPolicy
	CustomExpr string
}

// RuntimeAuthContext contains request-derived auth context for runtime evaluation.
type RuntimeAuthContext struct {
	Token   string
	Email   string
	Claims  map[string]any
	Headers map[string]string
}

// AuthEvaluationResult reports runtime auth evaluation decision.
type AuthEvaluationResult struct {
	Allowed bool
	Status  int
	Reason  string
	Context RuntimeAuthContext
}

// GetPolicy returns current integration auth-mock policy or default policy when not configured.
func (s *AuthMockService) GetPolicy(ctx context.Context, integrationID string) (*entity.AuthMockPolicy, error) {
	integrationID = strings.TrimSpace(integrationID)
	if integrationID == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}

	policy, err := s.integrations.FindAuthMockPolicy(ctx, integrationID)
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return defaultAuthMockPolicy(integrationID), nil
		}
		return nil, err
	}
	normalized, err := normalizeAuthMockPolicy(policy)
	if err != nil {
		return nil, err
	}
	return normalized, nil
}

// UpdatePolicy validates and stores integration auth-mock policy.
func (s *AuthMockService) UpdatePolicy(
	ctx context.Context,
	integrationID string,
	input UpdateAuthMockPolicyInput,
) (*entity.AuthMockPolicy, error) {
	integrationID = strings.TrimSpace(integrationID)
	if integrationID == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}

	mode := entity.AuthMockPolicyMode(strings.ToUpper(strings.TrimSpace(input.Mode)))
	switch mode {
	case entity.AuthMockPolicyModePrebuilt, entity.AuthMockPolicyModeCustomExpr:
	default:
		return nil, ErrInvalidInput
	}

	policy := &entity.AuthMockPolicy{
		IntegrationID: integrationID,
		Mode:          mode,
		Prebuilt:      input.Prebuilt,
		CustomExpr:    strings.TrimSpace(input.CustomExpr),
		UpdatedAt:     time.Now().UTC(),
	}
	normalized, err := normalizeAuthMockPolicy(policy)
	if err != nil {
		return nil, err
	}
	if normalized.Mode == entity.AuthMockPolicyModeCustomExpr {
		if normalized.CustomExpr == "" {
			return nil, newValidationError(ErrSemanticValidation, "customExpr is required when mode is CUSTOM_EXPR")
		}
		if err := compileAuthExpr(normalized.CustomExpr); err != nil {
			return nil, newValidationError(ErrSemanticValidation, "customExpr compile error", err.Error())
		}
	}

	if err := s.integrations.UpsertAuthMockPolicy(ctx, normalized); err != nil {
		return nil, err
	}
	return normalized, nil
}

func defaultAuthMockPolicy(integrationID string) *entity.AuthMockPolicy {
	return &entity.AuthMockPolicy{
		IntegrationID: integrationID,
		Mode:          entity.AuthMockPolicyModePrebuilt,
		Prebuilt: entity.AuthMockPrebuiltPolicy{
			DenyAll: false,
		},
		UpdatedAt: time.Now().UTC(),
	}
}

func normalizeAuthMockPolicy(policy *entity.AuthMockPolicy) (*entity.AuthMockPolicy, error) {
	if policy == nil {
		return nil, ErrInvalidInput
	}

	normalized := *policy
	normalized.CustomExpr = strings.TrimSpace(normalized.CustomExpr)
	if normalized.Mode == "" {
		normalized.Mode = entity.AuthMockPolicyModePrebuilt
	}
	if normalized.UpdatedAt.IsZero() {
		normalized.UpdatedAt = time.Now().UTC()
	}

	normalized.Prebuilt.TokenEquals = strings.TrimSpace(normalized.Prebuilt.TokenEquals)
	normalized.Prebuilt.EmailEquals = strings.TrimSpace(normalized.Prebuilt.EmailEquals)
	normalized.Prebuilt.EmailContains = strings.TrimSpace(normalized.Prebuilt.EmailContains)
	normalized.Prebuilt.EmailInList = uniqueNormalizedEmails(normalized.Prebuilt.EmailInList)

	normalizedHeaders := make([]entity.AuthMockHeaderRule, 0, len(normalized.Prebuilt.RequiredHeaders))
	for _, rule := range normalized.Prebuilt.RequiredHeaders {
		name := strings.ToLower(strings.TrimSpace(rule.Name))
		if name == "" {
			return nil, newValidationError(ErrSemanticValidation, "requiredHeaders.name is required")
		}
		operator := entity.AuthMockHeaderOperator(strings.ToUpper(strings.TrimSpace(string(rule.Operator))))
		switch operator {
		case entity.AuthMockHeaderOperatorExists, entity.AuthMockHeaderOperatorEquals, entity.AuthMockHeaderOperatorContains:
		default:
			return nil, newValidationError(ErrSemanticValidation, "requiredHeaders.operator must be EXISTS, EQUALS, or CONTAINS")
		}
		value := strings.TrimSpace(rule.Value)
		if operator != entity.AuthMockHeaderOperatorExists && value == "" {
			return nil, newValidationError(ErrSemanticValidation, "requiredHeaders.value is required for EQUALS and CONTAINS")
		}
		normalizedHeaders = append(normalizedHeaders, entity.AuthMockHeaderRule{
			Name:     name,
			Operator: operator,
			Value:    value,
		})
	}
	normalized.Prebuilt.RequiredHeaders = normalizedHeaders

	normalized.Prebuilt.OIDC.Issuer = strings.TrimSpace(normalized.Prebuilt.OIDC.Issuer)
	normalized.Prebuilt.OIDC.JWKSURL = strings.TrimSpace(normalized.Prebuilt.OIDC.JWKSURL)
	normalized.Prebuilt.OIDC.Audience = strings.TrimSpace(normalized.Prebuilt.OIDC.Audience)
	normalized.Prebuilt.OIDC.EmailClaim = strings.TrimSpace(normalized.Prebuilt.OIDC.EmailClaim)
	if normalized.Prebuilt.OIDC.EmailClaim == "" {
		normalized.Prebuilt.OIDC.EmailClaim = "email"
	}

	if normalized.Mode == entity.AuthMockPolicyModePrebuilt {
		normalized.CustomExpr = ""
	}
	return &normalized, nil
}

func uniqueNormalizedEmails(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		email := strings.ToLower(strings.TrimSpace(value))
		if email == "" {
			continue
		}
		if _, ok := seen[email]; ok {
			continue
		}
		seen[email] = struct{}{}
		result = append(result, email)
	}
	slices.Sort(result)
	return result
}

func compileAuthExpr(expression string) error {
	_, err := expr.Compile(
		expression,
		expr.AsBool(),
		expr.AllowUndefinedVariables(),
		expr.Env(map[string]any{
			"request": map[string]any{},
			"auth": map[string]any{
				"token":   "",
				"email":   "",
				"claims":  map[string]any{},
				"headers": map[string]any{},
			},
		}),
	)
	return err
}

func evaluateAuthMockPolicy(
	policy *entity.AuthMockPolicy,
	requestEnv map[string]any,
	requestHeaders map[string]string,
) (AuthEvaluationResult, error) {
	normalizedPolicy, err := normalizeAuthMockPolicy(policy)
	if err != nil {
		return AuthEvaluationResult{}, err
	}

	token := extractBearerToken(requestHeaders)
	authContext := RuntimeAuthContext{
		Token:   token,
		Email:   "",
		Claims:  map[string]any{},
		Headers: requestHeaders,
	}

	switch normalizedPolicy.Mode {
	case entity.AuthMockPolicyModeCustomExpr:
		claims, _ := decodeJWTClaims(token)
		authContext.Claims = claims
		authContext.Email = extractEmailFromClaims(claims, "email")
		allowed, evalErr := evaluateCustomAuthExpr(normalizedPolicy.CustomExpr, requestEnv, authContext)
		if evalErr != nil {
			return AuthEvaluationResult{}, evalErr
		}
		if !allowed {
			return AuthEvaluationResult{
				Allowed: false,
				Status:  403,
				Reason:  "auth-mock custom expression denied request",
				Context: authContext,
			}, nil
		}
		return AuthEvaluationResult{Allowed: true, Status: 200, Context: authContext}, nil
	default:
		return evaluatePrebuiltAuthPolicy(normalizedPolicy.Prebuilt, authContext)
	}
}

func evaluateCustomAuthExpr(
	customExpr string,
	requestEnv map[string]any,
	authContext RuntimeAuthContext,
) (bool, error) {
	program, err := expr.Compile(
		customExpr,
		expr.AsBool(),
		expr.AllowUndefinedVariables(),
		expr.Env(map[string]any{
			"request": map[string]any{},
			"auth": map[string]any{
				"token":   "",
				"email":   "",
				"claims":  map[string]any{},
				"headers": map[string]any{},
			},
		}),
	)
	if err != nil {
		return false, fmt.Errorf("compile custom auth expression: %w", err)
	}

	env := map[string]any{
		"request": requestEnv,
		"auth": map[string]any{
			"token":   authContext.Token,
			"email":   authContext.Email,
			"claims":  authContext.Claims,
			"headers": authContext.Headers,
		},
	}
	result, err := expr.Run(program, env)
	if err != nil {
		return false, fmt.Errorf("run custom auth expression: %w", err)
	}
	allowed, ok := result.(bool)
	if !ok {
		return false, errors.New("custom auth expression must return boolean")
	}
	return allowed, nil
}

func evaluatePrebuiltAuthPolicy(
	prebuilt entity.AuthMockPrebuiltPolicy,
	authContext RuntimeAuthContext,
) (AuthEvaluationResult, error) {
	if prebuilt.DenyAll {
		return AuthEvaluationResult{
			Allowed: false,
			Status:  403,
			Reason:  "auth-mock denyAll policy denied request",
			Context: authContext,
		}, nil
	}

	if prebuilt.TokenEquals != "" && authContext.Token != prebuilt.TokenEquals {
		return AuthEvaluationResult{
			Allowed: false,
			Status:  401,
			Reason:  "auth token mismatch",
			Context: authContext,
		}, nil
	}

	for _, rule := range prebuilt.RequiredHeaders {
		value, exists := authContext.Headers[strings.ToLower(rule.Name)]
		switch rule.Operator {
		case entity.AuthMockHeaderOperatorExists:
			if !exists {
				return AuthEvaluationResult{
					Allowed: false,
					Status:  403,
					Reason:  "required header missing: " + rule.Name,
					Context: authContext,
				}, nil
			}
		case entity.AuthMockHeaderOperatorEquals:
			if !exists || value != rule.Value {
				return AuthEvaluationResult{
					Allowed: false,
					Status:  403,
					Reason:  "required header mismatch: " + rule.Name,
					Context: authContext,
				}, nil
			}
		case entity.AuthMockHeaderOperatorContains:
			if !exists || !strings.Contains(value, rule.Value) {
				return AuthEvaluationResult{
					Allowed: false,
					Status:  403,
					Reason:  "required header does not contain expected value: " + rule.Name,
					Context: authContext,
				}, nil
			}
		}
	}

	if prebuilt.OIDC.Issuer != "" || prebuilt.OIDC.Audience != "" || prebuilt.OIDC.JWKSURL != "" {
		claims, decodeErr := decodeJWTClaims(authContext.Token)
		if decodeErr != nil {
			return AuthEvaluationResult{
				Allowed: false,
				Status:  401,
				Reason:  "oidc token parse failed",
				Context: authContext,
			}, nil
		}
		authContext.Claims = claims
		authContext.Email = extractEmailFromClaims(claims, prebuilt.OIDC.EmailClaim)

		if prebuilt.OIDC.Issuer != "" {
			issuer, _ := claims["iss"].(string)
			if strings.TrimSpace(issuer) != prebuilt.OIDC.Issuer {
				return AuthEvaluationResult{
					Allowed: false,
					Status:  401,
					Reason:  "oidc issuer mismatch",
					Context: authContext,
				}, nil
			}
		}
		if prebuilt.OIDC.Audience != "" {
			if !claimsContainAudience(claims, prebuilt.OIDC.Audience) {
				return AuthEvaluationResult{
					Allowed: false,
					Status:  401,
					Reason:  "oidc audience mismatch",
					Context: authContext,
				}, nil
			}
		}
	} else {
		claims, _ := decodeJWTClaims(authContext.Token)
		authContext.Claims = claims
		authContext.Email = extractEmailFromClaims(claims, "email")
	}

	if prebuilt.EmailEquals != "" && !strings.EqualFold(authContext.Email, prebuilt.EmailEquals) {
		return AuthEvaluationResult{
			Allowed: false,
			Status:  403,
			Reason:  "email mismatch",
			Context: authContext,
		}, nil
	}
	if prebuilt.EmailContains != "" && !strings.Contains(strings.ToLower(authContext.Email), strings.ToLower(prebuilt.EmailContains)) {
		return AuthEvaluationResult{
			Allowed: false,
			Status:  403,
			Reason:  "email does not contain required fragment",
			Context: authContext,
		}, nil
	}
	if len(prebuilt.EmailInList) > 0 {
		email := strings.ToLower(strings.TrimSpace(authContext.Email))
		matched := false
		for _, expected := range prebuilt.EmailInList {
			if email == strings.ToLower(strings.TrimSpace(expected)) {
				matched = true
				break
			}
		}
		if !matched {
			return AuthEvaluationResult{
				Allowed: false,
				Status:  403,
				Reason:  "email not allowed by policy list",
				Context: authContext,
			}, nil
		}
	}

	return AuthEvaluationResult{
		Allowed: true,
		Status:  200,
		Context: authContext,
	}, nil
}

func extractBearerToken(headers map[string]string) string {
	authHeader := strings.TrimSpace(headers["authorization"])
	if authHeader == "" {
		return ""
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 {
		return ""
	}
	if !strings.EqualFold(strings.TrimSpace(parts[0]), "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func decodeJWTClaims(token string) (map[string]any, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return map[string]any{}, nil
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("token must have 3 segments")
	}
	if strings.TrimSpace(parts[2]) == "" || strings.EqualFold(strings.TrimSpace(parts[2]), "invalid") {
		return nil, errors.New("token signature is invalid")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	claims := map[string]any{}
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, err
	}
	return claims, nil
}

func claimsContainAudience(claims map[string]any, audience string) bool {
	value, exists := claims["aud"]
	if !exists {
		return false
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed) == audience
	case []any:
		for _, item := range typed {
			if asString, ok := item.(string); ok && strings.TrimSpace(asString) == audience {
				return true
			}
		}
	}
	return false
}

func extractEmailFromClaims(claims map[string]any, claimName string) string {
	if len(claims) == 0 {
		return ""
	}
	name := strings.TrimSpace(claimName)
	if name == "" {
		name = "email"
	}
	value, _ := claims[name].(string)
	return strings.TrimSpace(value)
}
