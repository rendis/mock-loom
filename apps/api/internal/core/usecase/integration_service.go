package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/rendis/mock-loom/apps/api/internal/config"
	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
	"github.com/rendis/mock-loom/apps/api/internal/core/validation"
)

// IntegrationService handles integration use cases.
type IntegrationService struct {
	tx           ports.TxManager
	integrations ports.IntegrationRepository
	endpoints    ports.EndpointRepository
	dataSources  ports.DataSourceRepository
	importCfg    config.ImportConfig
	runner       commandRunner
}

// EndpointRevisionsPage is a paged endpoint revision response.
type EndpointRevisionsPage struct {
	Items      []*entity.EndpointRevision
	NextCursor *string
}

// AuditEventsPage is a paged integration audit response.
type AuditEventsPage struct {
	Items      []*entity.AuditEvent
	NextCursor *string
}

// EntityMapPage is a paged integration entity map response.
type EntityMapPage struct {
	Items      []*entity.EntityMapNode
	NextCursor *string
}

// AuthPolicyInput stores one runtime auth policy payload.
type AuthPolicyInput struct {
	Mode       string                        `json:"mode"`
	Prebuilt   entity.AuthMockPrebuiltPolicy `json:"prebuilt"`
	CustomExpr string                        `json:"customExpr"`
}

// UpdatePackInput stores mutable pack fields.
type UpdatePackInput struct {
	Name        *string
	Slug        *string
	BasePath    *string
	Status      *string
	AuthEnabled *bool
	AuthPolicy  *AuthPolicyInput
}

// UpdateEndpointAuthInput stores endpoint auth update payload.
type UpdateEndpointAuthInput struct {
	AuthMode       entity.EndpointAuthMode
	OverridePolicy *AuthPolicyInput
}

// UpdateEndpointRouteInput stores endpoint route-identity update payload.
type UpdateEndpointRouteInput struct {
	Method       string
	RelativePath string
}

// NewIntegrationService returns integration service.
func NewIntegrationService(
	tx ports.TxManager,
	integrations ports.IntegrationRepository,
	endpoints ports.EndpointRepository,
	dataSources ports.DataSourceRepository,
	importCfg config.ImportConfig,
) *IntegrationService {
	return &IntegrationService{
		tx:           tx,
		integrations: integrations,
		endpoints:    endpoints,
		dataSources:  dataSources,
		importCfg:    importCfg,
		runner:       &execCommandRunner{},
	}
}

// ListByWorkspace lists integrations in workspace.
func (s *IntegrationService) ListByWorkspace(ctx context.Context, workspaceID string) ([]*entity.Integration, error) {
	return s.integrations.ListByWorkspace(ctx, workspaceID)
}

// Create creates integration.
func (s *IntegrationService) Create(ctx context.Context, workspaceID, name, slug, baseURL string) (*entity.Integration, error) {
	name = strings.TrimSpace(name)
	slug = strings.ToLower(strings.TrimSpace(slug))
	baseURL = strings.TrimSpace(baseURL)
	if name == "" || slug == "" {
		return nil, ErrInvalidInput
	}

	now := time.Now().UTC()
	integration := &entity.Integration{
		ID:          uuid.NewString(),
		WorkspaceID: workspaceID,
		Name:        name,
		Slug:        slug,
		BaseURL:     baseURL,
		AuthMode:    "NONE",
		Status:      "ACTIVE",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.integrations.Create(ctx, integration); err != nil {
		if errors.Is(err, ports.ErrConflict) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}
	return integration, nil
}

// Overview returns integration summary payload.
func (s *IntegrationService) Overview(ctx context.Context, integrationID string) (map[string]any, error) {
	integration, err := s.integrations.FindByID(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	routes, err := s.endpoints.ListRoutes(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"integration":     integration,
		"routeCount":      len(routes),
		"last24hRequests": 0,
		"errorRate":       0,
	}, nil
}

// UpdateAuthMode updates integration auth mode.
func (s *IntegrationService) UpdateAuthMode(ctx context.Context, integrationID, authMode string) error {
	authMode = strings.TrimSpace(strings.ToUpper(authMode))
	if authMode == "" {
		return ErrInvalidInput
	}
	if !entity.ValidIntegrationAuthMode(authMode) {
		return ErrInvalidInput
	}
	return s.integrations.UpdateAuthMode(ctx, integrationID, authMode, time.Now().UTC())
}

// Packs returns integration packs with route and auth summaries.
func (s *IntegrationService) Packs(ctx context.Context, integrationID string) ([]map[string]any, error) {
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}
	packs, err := s.integrations.ListPacksByIntegration(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	routes, err := s.endpoints.ListRoutes(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	routeCountByPack := map[string]int{}
	for _, route := range routes {
		routeCountByPack[route.PackID]++
	}

	result := make([]map[string]any, 0, len(packs))
	for _, pack := range packs {
		policy, _ := parseStoredAuthPolicy(pack.AuthPolicyJSON)
		authType := strings.ToUpper(strings.TrimSpace(policy.Mode))
		if authType == "" {
			authType = string(entity.AuthMockPolicyModePrebuilt)
		}
		result = append(result, map[string]any{
			"id":            pack.ID,
			"integrationId": pack.IntegrationID,
			"name":          pack.Name,
			"slug":          pack.Slug,
			"basePath":      pack.BasePath,
			"status":        pack.Status,
			"routeCount":    routeCountByPack[pack.ID],
			"authEnabled":   pack.AuthEnabled,
			"authType":      authType,
			"authPolicy":    policy,
			"updatedAt":     pack.UpdatedAt,
			"createdAt":     pack.CreatedAt,
		})
	}
	return result, nil
}

// CreatePack creates one integration pack.
func (s *IntegrationService) CreatePack(ctx context.Context, integrationID, name, slug, basePath string) (*entity.IntegrationPack, error) {
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}
	trimmedName := strings.TrimSpace(name)
	trimmedSlug := strings.ToLower(strings.TrimSpace(slug))
	normalizedBasePath, pathErr := normalizePackBasePath(basePath)
	if trimmedName == "" || trimmedSlug == "" || pathErr != nil {
		return nil, ErrInvalidInput
	}

	policyJSON, err := serializeAuthPolicy(AuthPolicyInput{
		Mode:       string(entity.AuthMockPolicyModePrebuilt),
		Prebuilt:   entity.AuthMockPrebuiltPolicy{},
		CustomExpr: "",
	})
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	pack := &entity.IntegrationPack{
		ID:             uuid.NewString(),
		IntegrationID:  integrationID,
		Name:           trimmedName,
		Slug:           trimmedSlug,
		BasePath:       normalizedBasePath,
		Status:         "ACTIVE",
		AuthEnabled:    false,
		AuthPolicyJSON: policyJSON,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.integrations.CreatePack(ctx, pack); err != nil {
		if errors.Is(err, ports.ErrConflict) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}
	return pack, nil
}

// UpdatePack updates one integration pack.
func (s *IntegrationService) UpdatePack(
	ctx context.Context,
	integrationID string,
	packID string,
	input UpdatePackInput,
) (*entity.IntegrationPack, error) {
	pack, err := s.integrations.FindPackByID(ctx, integrationID, packID)
	if err != nil {
		return nil, err
	}
	previousBasePath := pack.BasePath
	basePathChanged := false

	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return nil, ErrInvalidInput
		}
		pack.Name = name
	}
	if input.Slug != nil {
		slug := strings.ToLower(strings.TrimSpace(*input.Slug))
		if slug == "" {
			return nil, ErrInvalidInput
		}
		pack.Slug = slug
	}
	if input.BasePath != nil {
		normalizedBasePath, pathErr := normalizePackBasePath(*input.BasePath)
		if pathErr != nil {
			return nil, ErrInvalidInput
		}
		basePathChanged = normalizedBasePath != previousBasePath
		pack.BasePath = normalizedBasePath
	}
	if input.Status != nil {
		status := strings.ToUpper(strings.TrimSpace(*input.Status))
		if status == "" {
			return nil, ErrInvalidInput
		}
		pack.Status = status
	}
	if input.AuthEnabled != nil {
		pack.AuthEnabled = *input.AuthEnabled
	}
	if input.AuthPolicy != nil {
		policyJSON, policyErr := serializeAuthPolicy(*input.AuthPolicy)
		if policyErr != nil {
			return nil, policyErr
		}
		pack.AuthPolicyJSON = policyJSON
	}
	now := time.Now().UTC()
	pack.UpdatedAt = now

	if !basePathChanged {
		if err := s.integrations.UpdatePack(ctx, pack); err != nil {
			if errors.Is(err, ports.ErrConflict) {
				return nil, ErrAlreadyExists
			}
			return nil, err
		}
		return pack, nil
	}

	routesInPack, err := s.endpoints.ListRoutesByPack(ctx, integrationID, packID)
	if err != nil {
		return nil, err
	}
	allRoutes, err := s.endpoints.ListRoutes(ctx, integrationID)
	if err != nil {
		return nil, err
	}

	ownerByRouteKey := make(map[string]string, len(allRoutes))
	for _, route := range allRoutes {
		key := routeKey(route.Method, route.Path)
		if strings.TrimSpace(key) == "" {
			continue
		}
		ownerByRouteKey[key] = route.ID
	}

	rebasedByKey := make(map[string]string, len(routesInPack))
	rebasedRoutes := make([]*entity.IntegrationEndpoint, 0, len(routesInPack))
	for _, route := range routesInPack {
		relativePath, relErr := toRelativeEndpointPath(route.Path, previousBasePath)
		if relErr != nil {
			return nil, relErr
		}
		nextPath, composeErr := composePackEndpointPath(pack.BasePath, relativePath)
		if composeErr != nil {
			return nil, ErrInvalidInput
		}
		nextMethod := normalizeMethod(route.Method)
		if strings.TrimSpace(nextMethod) == "" {
			return nil, ErrInvalidInput
		}

		nextKey := routeKey(nextMethod, nextPath)
		if ownerID, exists := ownerByRouteKey[nextKey]; exists && ownerID != route.ID {
			return nil, ErrAlreadyExists
		}
		if ownerID, exists := rebasedByKey[nextKey]; exists && ownerID != route.ID {
			return nil, ErrAlreadyExists
		}
		rebasedByKey[nextKey] = route.ID

		cloned := *route
		cloned.Method = nextMethod
		cloned.Path = nextPath
		cloned.UpdatedAt = now
		rebasedRoutes = append(rebasedRoutes, &cloned)
	}

	if s.tx == nil {
		return nil, errors.New("pack basePath rebase requires transaction manager")
	}

	if err := s.tx.WithTx(ctx, func(txCtx context.Context) error {
		if updateErr := s.integrations.UpdatePack(txCtx, pack); updateErr != nil {
			return updateErr
		}
		for _, route := range rebasedRoutes {
			if updateErr := s.endpoints.UpdateEndpointRoute(txCtx, route); updateErr != nil {
				return updateErr
			}
		}
		return nil
	}); err != nil {
		if errors.Is(err, ports.ErrConflict) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}
	return pack, nil
}

// Routes returns route tree list.
func (s *IntegrationService) Routes(ctx context.Context, integrationID string) ([]map[string]any, error) {
	routes, err := s.endpoints.ListRoutes(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(routes))
	for _, route := range routes {
		result = append(result, map[string]any{
			"id":     route.ID,
			"packId": route.PackID,
			"method": route.Method,
			"path":   route.Path,
		})
	}
	return result, nil
}

// PackRoutes returns pack-scoped route list.
func (s *IntegrationService) PackRoutes(ctx context.Context, integrationID, packID string) ([]map[string]any, error) {
	if _, err := s.integrations.FindPackByID(ctx, integrationID, packID); err != nil {
		return nil, err
	}
	routes, err := s.endpoints.ListRoutesByPack(ctx, integrationID, packID)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(routes))
	for _, route := range routes {
		result = append(result, map[string]any{
			"id":       route.ID,
			"packId":   route.PackID,
			"method":   route.Method,
			"path":     route.Path,
			"authMode": route.AuthMode,
		})
	}
	return result, nil
}

// ImportPackRoutes imports pack routes and upserts endpoints by method+path.
func (s *IntegrationService) ImportPackRoutes(ctx context.Context, integrationID, packID, sourceType, payload string) (map[string]any, error) {
	pack, err := s.integrations.FindPackByID(ctx, integrationID, packID)
	if err != nil {
		return nil, err
	}
	activeSourceSlugs, err := s.activeSourceSlugSet(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	sourceType = strings.TrimSpace(strings.ToUpper(sourceType))
	payload = strings.TrimSpace(payload)
	if sourceType == "" || payload == "" {
		return nil, ErrInvalidInput
	}
	if s.importCfg.MaxBytes > 0 && len(payload) > s.importCfg.MaxBytes {
		return nil, ErrPayloadTooLarge
	}

	routes, warnings, err := s.convertImportPayload(ctx, sourceType, payload)
	if err != nil {
		return nil, err
	}
	if warnings == nil {
		warnings = make([]string, 0)
	}
	if s.importCfg.MaxRoutes > 0 && len(routes) > s.importCfg.MaxRoutes {
		return nil, newValidationError(
			ErrSemanticValidation,
			"imported routes exceed configured maximum",
			"maximum routes allowed: "+strconv.Itoa(s.importCfg.MaxRoutes),
		)
	}

	existingList, err := s.endpoints.ListRoutesByPack(ctx, integrationID, packID)
	if err != nil {
		return nil, err
	}
	existingGlobalList, err := s.endpoints.ListRoutes(ctx, integrationID)
	if err != nil {
		return nil, err
	}

	existing := make(map[string]*entity.IntegrationEndpoint, len(existingList))
	for _, endpoint := range existingList {
		existing[routeKey(endpoint.Method, endpoint.Path)] = endpoint
	}
	existingGlobal := make(map[string]*entity.IntegrationEndpoint, len(existingGlobalList))
	for _, endpoint := range existingGlobalList {
		existingGlobal[routeKey(endpoint.Method, endpoint.Path)] = endpoint
	}

	seen := make(map[string]struct{}, len(routes))
	createdRoutes := 0
	updatedRoutes := 0
	skippedRoutes := 0

	for _, route := range routes {
		normalizedPath, pathErr := composePackEndpointPath(pack.BasePath, route.Path)
		if pathErr != nil {
			return nil, ErrInvalidInput
		}
		route.Path = normalizedPath

		key := routeKey(route.Method, route.Path)
		if _, duplicate := seen[key]; duplicate {
			skippedRoutes++
			warnings = append(warnings, "duplicate route in source skipped: "+strings.ToUpper(route.Method)+" "+route.Path)
			continue
		}
		seen[key] = struct{}{}

		now := time.Now().UTC()
		current, found := existing[key]
		globalRoute, globalFound := existingGlobal[key]
		if globalFound && globalRoute.PackID != packID {
			return nil, newValidationError(
				ErrSemanticValidation,
				"route already exists in a different pack",
				strings.ToUpper(route.Method)+" "+route.Path,
			)
		}
		if found {
			updatedRoutes++
		} else {
			createdRoutes++
			current = &entity.IntegrationEndpoint{
				ID:                     uuid.NewString(),
				IntegrationID:          integrationID,
				PackID:                 packID,
				Method:                 route.Method,
				Path:                   route.Path,
				AuthMode:               entity.EndpointAuthModeInherit,
				AuthOverridePolicyJSON: "{}",
				CreatedAt:              now,
			}
		}

		contractJSON := route.ContractJSON
		if contractJSON == "" {
			contractJSON = validation.DefaultImportedContractJSON()
		}
		normalizedContract, contractErr := validation.ValidateContractJSON(contractJSON)
		if contractErr != nil {
			return nil, wrapValidationError(contractErr)
		}

		scenariosJSON := current.ScenariosJSON
		if !found {
			scenariosJSON = validation.DefaultImportedScenariosJSON(route.Method, route.Path)
		}
		normalizedScenarios, scenariosErr := validation.ValidateScenariosJSONWithOptions(scenariosJSON, validation.ScenarioValidationOptions{
			ActiveSourceSlugs:       activeSourceSlugs,
			RequireKnownSourceSlugs: true,
		})
		if scenariosErr != nil {
			scenariosJSON = validation.DefaultImportedScenariosJSON(route.Method, route.Path)
			normalizedScenarios, scenariosErr = validation.ValidateScenariosJSONWithOptions(scenariosJSON, validation.ScenarioValidationOptions{
				ActiveSourceSlugs:       activeSourceSlugs,
				RequireKnownSourceSlugs: true,
			})
			if scenariosErr != nil {
				return nil, wrapValidationError(scenariosErr)
			}
			warnings = append(warnings, "existing scenarios reset to empty list for route "+strings.ToUpper(route.Method)+" "+route.Path)
		}

		current.Method = route.Method
		current.Path = route.Path
		current.PackID = packID
		if current.AuthMode == "" {
			current.AuthMode = entity.EndpointAuthModeInherit
		}
		if strings.TrimSpace(current.AuthOverridePolicyJSON) == "" {
			current.AuthOverridePolicyJSON = "{}"
		}
		current.ContractJSON = normalizedContract
		current.ScenariosJSON = normalizedScenarios
		current.UpdatedAt = now
		if err := s.endpoints.UpsertEndpoint(ctx, current); err != nil {
			return nil, err
		}
	}

	return map[string]any{
		"sourceType":    sourceType,
		"createdRoutes": createdRoutes,
		"updatedRoutes": updatedRoutes,
		"skippedRoutes": skippedRoutes,
		"warnings":      warnings,
		"errors":        []string{},
	}, nil
}

// ImportRoutes remains for non-pack legacy callers and returns invalid-input in pack-first mode.
func (s *IntegrationService) ImportRoutes(ctx context.Context, integrationID, sourceType, payload string) (map[string]any, error) {
	return nil, ErrInvalidInput
}

// Endpoint returns one pack-scoped endpoint editor payload.
func (s *IntegrationService) Endpoint(ctx context.Context, integrationID, packID, endpointID string) (*entity.IntegrationEndpoint, error) {
	integrationID = strings.TrimSpace(integrationID)
	packID = strings.TrimSpace(packID)
	endpointID = strings.TrimSpace(endpointID)
	if integrationID == "" || packID == "" || endpointID == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}
	if _, err := s.integrations.FindPackByID(ctx, integrationID, packID); err != nil {
		return nil, err
	}
	endpoint, err := s.endpoints.FindByID(ctx, integrationID, endpointID)
	if err != nil {
		return nil, err
	}
	if endpoint.PackID != packID {
		return nil, ports.ErrNotFound
	}
	if endpoint.AuthMode == "" {
		endpoint.AuthMode = entity.EndpointAuthModeInherit
	}
	if strings.TrimSpace(endpoint.AuthOverridePolicyJSON) == "" {
		endpoint.AuthOverridePolicyJSON = "{}"
	}
	return endpoint, nil
}

// AutocompleteContext builds editor suggestions from endpoint contract and active source schemas.
func (s *IntegrationService) AutocompleteContext(
	ctx context.Context,
	integrationID string,
	packID string,
	endpointID string,
) (*entity.EndpointAutocompleteContext, error) {
	integrationID = strings.TrimSpace(integrationID)
	packID = strings.TrimSpace(packID)
	endpointID = strings.TrimSpace(endpointID)
	if integrationID == "" || packID == "" || endpointID == "" {
		return nil, ErrInvalidInput
	}

	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}

	endpoint, err := s.Endpoint(ctx, integrationID, packID, endpointID)
	if err != nil {
		return nil, err
	}

	requestPaths := extractRequestPaths(endpoint.ContractJSON)
	requestPaths = append(requestPaths, extractPathParamRequestPaths(endpoint.Path)...)
	sourcePaths := make([]string, 0)
	if s.dataSources != nil {
		sources, err := s.dataSources.ListByIntegration(ctx, integrationID)
		if err != nil {
			return nil, err
		}

		for _, source := range sources {
			snapshotID, err := s.dataSources.FindLatestSnapshotID(ctx, integrationID, source.Slug)
			if err != nil {
				if errors.Is(err, ports.ErrNotFound) {
					continue
				}
				return nil, err
			}

			schemaJSON, err := s.dataSources.FindSnapshotSchema(ctx, snapshotID)
			if err != nil {
				if errors.Is(err, ports.ErrNotFound) {
					continue
				}
				return nil, err
			}
			inferredTypes, err := parseTopLevelSchemaTypes(schemaJSON)
			if err != nil {
				return nil, wrapValidationError(err)
			}
			overrides, err := s.dataSources.FindSchemaOverrides(ctx, source.ID)
			if err != nil {
				return nil, err
			}
			_, effectiveTypes := buildSchemaFields(inferredTypes, pruneSchemaOverrides(overrides, inferredTypes))
			schemaJSON, err = buildTopLevelSchemaJSON(effectiveTypes)
			if err != nil {
				return nil, err
			}

			sourcePaths = append(sourcePaths, extractSourcePaths(source.Slug, schemaJSON)...)
		}
	}

	requestPaths = uniqueSortedStrings(requestPaths)
	sourcePaths = uniqueSortedStrings(sourcePaths)
	functions := defaultAutocompleteFunctions()
	templatePaths := buildTemplatePaths(requestPaths, sourcePaths)

	return &entity.EndpointAutocompleteContext{
		RequestPaths:  requestPaths,
		SourcePaths:   sourcePaths,
		Functions:     functions,
		TemplatePaths: templatePaths,
	}, nil
}

// ValidateEndpoint validates contract and scenarios payloads (provided or persisted).
func (s *IntegrationService) ValidateEndpoint(
	ctx context.Context,
	integrationID string,
	packID string,
	endpointID string,
	contractJSON string,
	scenariosJSON string,
) (bool, []entity.ValidationIssue, error) {
	endpoint, err := s.Endpoint(ctx, integrationID, packID, endpointID)
	if err != nil {
		return false, nil, err
	}

	resolvedContract := strings.TrimSpace(contractJSON)
	if resolvedContract == "" {
		resolvedContract = endpoint.ContractJSON
	}
	resolvedScenarios := strings.TrimSpace(scenariosJSON)
	if resolvedScenarios == "" {
		resolvedScenarios = endpoint.ScenariosJSON
	}
	activeSourceSlugs, err := s.activeSourceSlugSet(ctx, integrationID)
	if err != nil {
		return false, nil, err
	}

	issues := make([]entity.ValidationIssue, 0)
	if _, err := validation.ValidateContractJSON(resolvedContract); err != nil {
		issues = append(issues, validationIssuesFromError("contract", "CONTRACT_INVALID", err)...)
	}
	if _, err := validation.ValidateScenariosJSONWithOptions(resolvedScenarios, validation.ScenarioValidationOptions{
		ActiveSourceSlugs:       activeSourceSlugs,
		RequireKnownSourceSlugs: true,
	}); err != nil {
		issues = append(issues, validationIssuesFromError("scenarios", "SCENARIOS_INVALID", err)...)
	}

	return len(issues) == 0, issues, nil
}

// ListEndpointRevisions returns endpoint artifact revisions.
func (s *IntegrationService) ListEndpointRevisions(
	ctx context.Context,
	integrationID string,
	packID string,
	endpointID string,
	limit int,
	cursor string,
) (*EndpointRevisionsPage, error) {
	if _, err := s.Endpoint(ctx, integrationID, packID, endpointID); err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}
	offset := decodeCursor(cursor)

	items, err := s.endpoints.ListRevisions(ctx, integrationID, endpointID, limit+1, offset)
	if err != nil {
		return nil, err
	}

	var nextCursor *string
	if len(items) > limit {
		value := strconv.Itoa(offset + limit)
		nextCursor = &value
		items = items[:limit]
	}
	return &EndpointRevisionsPage{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

// RestoreEndpointRevision restores one endpoint revision and appends a new revision entry.
func (s *IntegrationService) RestoreEndpointRevision(
	ctx context.Context,
	integrationID string,
	packID string,
	endpointID string,
	revisionID string,
) (*entity.EndpointRevision, error) {
	revisionID = strings.TrimSpace(revisionID)
	if revisionID == "" {
		return nil, ErrInvalidInput
	}
	endpoint, err := s.Endpoint(ctx, integrationID, packID, endpointID)
	if err != nil {
		return nil, err
	}
	revision, err := s.endpoints.FindRevisionByID(ctx, integrationID, endpointID, revisionID)
	if err != nil {
		return nil, err
	}
	normalizedContract, err := validation.ValidateContractJSON(revision.ContractJSON)
	if err != nil {
		return nil, wrapValidationError(err)
	}
	activeSourceSlugs, err := s.activeSourceSlugSet(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	normalizedScenarios, err := validation.ValidateScenariosJSONWithOptions(revision.ScenariosJSON, validation.ScenarioValidationOptions{
		ActiveSourceSlugs:       activeSourceSlugs,
		RequireKnownSourceSlugs: true,
	})
	if err != nil {
		return nil, wrapValidationError(err)
	}

	now := time.Now().UTC()
	endpoint.ContractJSON = normalizedContract
	endpoint.ScenariosJSON = normalizedScenarios
	endpoint.UpdatedAt = now
	if err := s.endpoints.UpsertEndpoint(ctx, endpoint); err != nil {
		return nil, err
	}

	restoredRevision := &entity.EndpointRevision{
		ID:                     uuid.NewString(),
		IntegrationID:          integrationID,
		EndpointID:             endpointID,
		ContractJSON:           normalizedContract,
		ScenariosJSON:          normalizedScenarios,
		CreatedAt:              now,
		RestoredFromRevisionID: &revisionID,
	}
	if err := s.endpoints.AppendRevision(ctx, restoredRevision); err != nil {
		return nil, err
	}
	return restoredRevision, nil
}

// AuditEvents returns synthesized integration audit events.
func (s *IntegrationService) AuditEvents(
	ctx context.Context,
	integrationID string,
	limit int,
	cursor string,
	resourceType string,
	actor string,
) (*AuditEventsPage, error) {
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	offset := decodeCursor(cursor)
	filteredResourceType := strings.ToLower(strings.TrimSpace(resourceType))
	filteredActor := strings.ToLower(strings.TrimSpace(actor))

	events := make([]*entity.AuditEvent, 0)

	traffic, err := s.endpoints.ListTraffic(ctx, integrationID, 500)
	if err != nil {
		return nil, err
	}
	for _, item := range traffic {
		resourceID := "integration"
		if item.EndpointID != nil {
			resourceID = *item.EndpointID
		}
		events = append(events, &entity.AuditEvent{
			ID:            "traffic:" + item.ID,
			IntegrationID: integrationID,
			ResourceType:  "TRAFFIC",
			ResourceID:    resourceID,
			Action:        "REQUEST_CAPTURED",
			Actor:         "runtime",
			Summary:       "Traffic event captured",
			CreatedAt:     item.CreatedAt,
		})
	}

	if s.dataSources != nil {
		sources, err := s.dataSources.ListByIntegration(ctx, integrationID)
		if err != nil {
			return nil, err
		}
		for _, source := range sources {
			historyItems, err := s.dataSources.ListSourceHistory(ctx, integrationID, source.Slug, 100, 0)
			if err != nil {
				return nil, err
			}
			for _, history := range historyItems {
				actorName := "runtime"
				if history.TriggeredByRequestID != nil {
					actorName = "request:" + *history.TriggeredByRequestID
				}
				events = append(events, &entity.AuditEvent{
					ID:            "event:" + history.ID,
					IntegrationID: integrationID,
					ResourceType:  "DATA_SOURCE",
					ResourceID:    source.ID,
					Action:        history.Action,
					Actor:         actorName,
					Summary:       "Entity " + history.EntityID + " mutation",
					CreatedAt:     history.CreatedAt,
				})
			}
		}
	}

	sort.SliceStable(events, func(left, right int) bool {
		if events[left].CreatedAt.Equal(events[right].CreatedAt) {
			return events[left].ID > events[right].ID
		}
		return events[left].CreatedAt.After(events[right].CreatedAt)
	})

	filtered := make([]*entity.AuditEvent, 0, len(events))
	for _, item := range events {
		if filteredResourceType != "" && strings.ToLower(item.ResourceType) != filteredResourceType {
			continue
		}
		if filteredActor != "" && !strings.Contains(strings.ToLower(item.Actor), filteredActor) {
			continue
		}
		filtered = append(filtered, item)
	}

	if offset > len(filtered) {
		offset = len(filtered)
	}
	end := offset + limit
	if end > len(filtered) {
		end = len(filtered)
	}
	pageItems := filtered[offset:end]

	var nextCursor *string
	if end < len(filtered) {
		value := strconv.Itoa(end)
		nextCursor = &value
	}

	return &AuditEventsPage{
		Items:      pageItems,
		NextCursor: nextCursor,
	}, nil
}

// EntityMap returns integration entity map nodes.
func (s *IntegrationService) EntityMap(
	ctx context.Context,
	integrationID string,
	sourceID string,
	search string,
	limit int,
	cursor string,
) (*EntityMapPage, error) {
	if _, err := s.integrations.FindByID(ctx, integrationID); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	offset := decodeCursor(cursor)
	filteredSourceID := strings.TrimSpace(sourceID)
	filteredSearch := strings.ToLower(strings.TrimSpace(search))

	nodes := make([]*entity.EntityMapNode, 0)
	sources, err := s.dataSources.ListByIntegration(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	for _, source := range sources {
		if filteredSourceID != "" && source.ID != filteredSourceID {
			continue
		}
		snapshotID, err := s.dataSources.FindLatestSnapshotID(ctx, integrationID, source.Slug)
		if err != nil {
			if errors.Is(err, ports.ErrNotFound) {
				continue
			}
			return nil, err
		}
		entities, err := s.dataSources.ListDebuggerEntities(ctx, source.ID, snapshotID)
		if err != nil {
			return nil, err
		}
		for _, item := range entities {
			if filteredSearch != "" {
				if !strings.Contains(strings.ToLower(item.EntityID), filteredSearch) && !strings.Contains(strings.ToLower(item.CurrentDataJSON), filteredSearch) {
					continue
				}
			}
			nodes = append(nodes, &entity.EntityMapNode{
				SourceID:   source.ID,
				SourceName: source.Name,
				EntityID:   item.EntityID,
				UpdatedAt:  item.UpdatedAt,
			})
		}
	}

	sort.SliceStable(nodes, func(left, right int) bool {
		if nodes[left].UpdatedAt.Equal(nodes[right].UpdatedAt) {
			if nodes[left].SourceName == nodes[right].SourceName {
				return nodes[left].EntityID < nodes[right].EntityID
			}
			return nodes[left].SourceName < nodes[right].SourceName
		}
		return nodes[left].UpdatedAt.After(nodes[right].UpdatedAt)
	})

	if offset > len(nodes) {
		offset = len(nodes)
	}
	end := offset + limit
	if end > len(nodes) {
		end = len(nodes)
	}

	items := nodes[offset:end]
	var nextCursor *string
	if end < len(nodes) {
		value := strconv.Itoa(end)
		nextCursor = &value
	}
	return &EntityMapPage{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

// UpdateContract updates endpoint contract json.
func (s *IntegrationService) UpdateContract(ctx context.Context, integrationID, packID, endpointID, contractJSON string) error {
	route, err := s.Endpoint(ctx, integrationID, packID, endpointID)
	if err != nil {
		return err
	}
	normalized, err := validation.ValidateContractJSON(contractJSON)
	if err != nil {
		return wrapValidationError(err)
	}
	now := time.Now().UTC()
	route.ContractJSON = normalized
	route.UpdatedAt = now
	if err := s.endpoints.UpsertEndpoint(ctx, route); err != nil {
		return err
	}
	return s.appendEndpointRevision(ctx, route, nil, now)
}

// UpdateScenarios updates endpoint scenarios json.
func (s *IntegrationService) UpdateScenarios(ctx context.Context, integrationID, packID, endpointID, scenariosJSON string) error {
	route, err := s.Endpoint(ctx, integrationID, packID, endpointID)
	if err != nil {
		return err
	}
	activeSourceSlugs, err := s.activeSourceSlugSet(ctx, integrationID)
	if err != nil {
		return err
	}
	normalized, err := validation.ValidateScenariosJSONWithOptions(scenariosJSON, validation.ScenarioValidationOptions{
		ActiveSourceSlugs:       activeSourceSlugs,
		RequireKnownSourceSlugs: true,
	})
	if err != nil {
		return wrapValidationError(err)
	}
	now := time.Now().UTC()
	route.ScenariosJSON = normalized
	route.UpdatedAt = now
	if err := s.endpoints.UpsertEndpoint(ctx, route); err != nil {
		return err
	}
	return s.appendEndpointRevision(ctx, route, nil, now)
}

// UpdateEndpointRoute updates endpoint method/path inside one pack.
func (s *IntegrationService) UpdateEndpointRoute(
	ctx context.Context,
	integrationID string,
	packID string,
	endpointID string,
	input UpdateEndpointRouteInput,
) (*entity.IntegrationEndpoint, error) {
	route, err := s.Endpoint(ctx, integrationID, packID, endpointID)
	if err != nil {
		return nil, err
	}
	pack, err := s.integrations.FindPackByID(ctx, integrationID, packID)
	if err != nil {
		return nil, err
	}

	method := normalizeMethod(input.Method)
	if strings.TrimSpace(method) == "" {
		return nil, ErrInvalidInput
	}

	relativePath, relErr := normalizeEndpointPath(input.RelativePath)
	if relErr != nil {
		return nil, ErrInvalidInput
	}
	if includesPackBasePath(relativePath, pack.BasePath) {
		return nil, ErrInvalidInput
	}

	path, pathErr := composePackEndpointPath(pack.BasePath, relativePath)
	if pathErr != nil {
		return nil, ErrInvalidInput
	}
	existing, existingErr := s.endpoints.FindByMethodPath(ctx, integrationID, method, path)
	switch {
	case existingErr == nil && existing.ID != route.ID:
		return nil, ErrAlreadyExists
	case existingErr != nil && !errors.Is(existingErr, ports.ErrNotFound):
		return nil, existingErr
	}

	route.Method = method
	route.Path = path
	route.UpdatedAt = time.Now().UTC()
	if err := s.endpoints.UpdateEndpointRoute(ctx, route); err != nil {
		if errors.Is(err, ports.ErrConflict) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}
	return route, nil
}

// UpdateEndpointAuth updates endpoint auth behavior (inherit/custom/none).
func (s *IntegrationService) UpdateEndpointAuth(
	ctx context.Context,
	integrationID string,
	packID string,
	endpointID string,
	input UpdateEndpointAuthInput,
) (*entity.IntegrationEndpoint, error) {
	route, err := s.Endpoint(ctx, integrationID, packID, endpointID)
	if err != nil {
		return nil, err
	}

	mode := entity.EndpointAuthMode(strings.ToUpper(strings.TrimSpace(string(input.AuthMode))))
	switch mode {
	case entity.EndpointAuthModeInherit, entity.EndpointAuthModeOverride, entity.EndpointAuthModeNone:
	default:
		return nil, ErrInvalidInput
	}

	route.AuthMode = mode
	if mode == entity.EndpointAuthModeOverride {
		if input.OverridePolicy == nil {
			return nil, ErrInvalidInput
		}
		policyJSON, policyErr := serializeAuthPolicy(*input.OverridePolicy)
		if policyErr != nil {
			return nil, policyErr
		}
		route.AuthOverridePolicyJSON = policyJSON
	} else {
		route.AuthOverridePolicyJSON = "{}"
	}
	route.UpdatedAt = time.Now().UTC()
	if err := s.endpoints.UpsertEndpoint(ctx, route); err != nil {
		return nil, err
	}
	return route, nil
}

// Traffic returns recent traffic for integration, optionally filtered by endpoint id.
func (s *IntegrationService) Traffic(ctx context.Context, integrationID string, packID string, endpointID string) ([]*entity.TrafficEvent, error) {
	items, err := s.endpoints.ListTraffic(ctx, integrationID, 100)
	if err != nil {
		return nil, err
	}

	trimmedPackID := strings.TrimSpace(packID)
	if trimmedPackID == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.integrations.FindPackByID(ctx, integrationID, trimmedPackID); err != nil {
		return nil, err
	}

	trimmedEndpointID := strings.TrimSpace(endpointID)
	if trimmedEndpointID != "" && !strings.EqualFold(trimmedEndpointID, "all") {
		if _, err := s.Endpoint(ctx, integrationID, trimmedPackID, trimmedEndpointID); err != nil {
			return nil, err
		}
	}

	allowedEndpointIDs := map[string]struct{}{}
	if trimmedEndpointID == "" || strings.EqualFold(trimmedEndpointID, "all") {
		routes, err := s.endpoints.ListRoutesByPack(ctx, integrationID, trimmedPackID)
		if err != nil {
			return nil, err
		}
		for _, route := range routes {
			allowedEndpointIDs[route.ID] = struct{}{}
		}
	} else {
		allowedEndpointIDs[trimmedEndpointID] = struct{}{}
	}

	filtered := make([]*entity.TrafficEvent, 0, len(items))
	for _, item := range items {
		if item.EndpointID == nil {
			continue
		}
		if _, ok := allowedEndpointIDs[*item.EndpointID]; ok {
			filtered = append(filtered, item)
		}
	}
	return filtered, nil
}

func wrapValidationError(err error) error {
	if err == nil {
		return nil
	}
	if validationErr, ok := asValidationError(err); ok {
		return newValidationError(validationErr.Cause, validationErr.Messages...)
	}
	if validatorErr, ok := err.(*validation.Error); ok {
		return newValidationError(ErrSemanticValidation, validatorErr.Messages...)
	}
	return newValidationError(ErrSemanticValidation, err.Error())
}

func routeKey(method, path string) string {
	return strings.ToUpper(strings.TrimSpace(method)) + " " + strings.TrimSpace(path)
}

func normalizePackBasePath(value string) (string, error) {
	return normalizePathTemplate(value)
}

func normalizeEndpointPath(value string) (string, error) {
	return normalizePathTemplate(value)
}

func normalizePathTemplate(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", ErrInvalidInput
	}
	if strings.Contains(trimmed, "?") {
		return "", ErrInvalidInput
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}
	for strings.Contains(trimmed, "//") {
		trimmed = strings.ReplaceAll(trimmed, "//", "/")
	}
	if len(trimmed) > 1 {
		trimmed = strings.TrimRight(trimmed, "/")
	}
	if trimmed == "" {
		return "", ErrInvalidInput
	}
	if trimmed == "/" {
		return "/", nil
	}

	segments := strings.Split(strings.TrimPrefix(trimmed, "/"), "/")
	normalized := make([]string, 0, len(segments))
	for _, segment := range segments {
		nextSegment, err := normalizePathTemplateSegment(segment)
		if err != nil {
			return "", err
		}
		normalized = append(normalized, nextSegment)
	}
	if len(normalized) == 0 {
		return "/", nil
	}
	return "/" + strings.Join(normalized, "/"), nil
}

func composePackEndpointPath(basePath, endpointPath string) (string, error) {
	normalizedBasePath, err := normalizePackBasePath(basePath)
	if err != nil {
		return "", err
	}
	normalizedEndpointPath, err := normalizeEndpointPath(endpointPath)
	if err != nil {
		return "", err
	}

	if normalizedBasePath == "/" {
		return normalizedEndpointPath, nil
	}
	if normalizedEndpointPath == normalizedBasePath || strings.HasPrefix(normalizedEndpointPath, normalizedBasePath+"/") {
		return normalizedEndpointPath, nil
	}

	relative := strings.TrimPrefix(normalizedEndpointPath, "/")
	if relative == "" {
		return normalizedBasePath, nil
	}
	return normalizedBasePath + "/" + relative, nil
}

func includesPackBasePath(relativePath string, basePath string) bool {
	normalizedBasePath, baseErr := normalizePackBasePath(basePath)
	if baseErr != nil || normalizedBasePath == "/" {
		return false
	}
	normalizedRelativePath, relativeErr := normalizeEndpointPath(relativePath)
	if relativeErr != nil {
		return false
	}
	return normalizedRelativePath == normalizedBasePath || strings.HasPrefix(normalizedRelativePath, normalizedBasePath+"/")
}

func toRelativeEndpointPath(fullPath string, basePath string) (string, error) {
	normalizedBasePath, baseErr := normalizePackBasePath(basePath)
	if baseErr != nil {
		return "", baseErr
	}
	normalizedFullPath, fullErr := normalizeEndpointPath(fullPath)
	if fullErr != nil {
		return "", fullErr
	}
	if normalizedBasePath == "/" {
		return normalizedFullPath, nil
	}
	if normalizedFullPath == normalizedBasePath {
		return "/", nil
	}
	basePrefix := normalizedBasePath + "/"
	if strings.HasPrefix(normalizedFullPath, basePrefix) {
		return "/" + strings.TrimPrefix(normalizedFullPath, basePrefix), nil
	}
	return normalizedFullPath, nil
}

func normalizePathTemplateSegment(segment string) (string, error) {
	trimmed := strings.TrimSpace(segment)
	if trimmed == "" {
		return "", ErrInvalidInput
	}
	if strings.HasPrefix(trimmed, ":") {
		name := normalizePathParamName(strings.TrimPrefix(trimmed, ":"))
		if name == "" {
			return "", ErrInvalidInput
		}
		return ":" + name, nil
	}
	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		name := normalizePathParamName(strings.TrimSuffix(strings.TrimPrefix(trimmed, "{"), "}"))
		if name == "" {
			return "", ErrInvalidInput
		}
		return ":" + name, nil
	}
	if strings.Contains(trimmed, "{") || strings.Contains(trimmed, "}") {
		return "", ErrInvalidInput
	}
	return trimmed, nil
}

func normalizePathParamName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	var builder strings.Builder
	lastUnderscore := false
	for _, character := range trimmed {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') {
			builder.WriteRune(character)
			lastUnderscore = false
			continue
		}
		if character == '_' {
			if !lastUnderscore {
				builder.WriteRune('_')
				lastUnderscore = true
			}
			continue
		}
		if !lastUnderscore {
			builder.WriteRune('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(builder.String(), "_")
}

func serializeAuthPolicy(input AuthPolicyInput) (string, error) {
	mode := entity.AuthMockPolicyMode(strings.ToUpper(strings.TrimSpace(input.Mode)))
	switch mode {
	case entity.AuthMockPolicyModePrebuilt, entity.AuthMockPolicyModeCustomExpr:
	default:
		return "", ErrInvalidInput
	}
	customExpr := strings.TrimSpace(input.CustomExpr)
	if mode == entity.AuthMockPolicyModeCustomExpr && customExpr == "" {
		return "", ErrInvalidInput
	}
	if mode == entity.AuthMockPolicyModeCustomExpr {
		if err := compileAuthExpr(customExpr); err != nil {
			return "", newValidationError(ErrSemanticValidation, "customExpr compile error", err.Error())
		}
	}

	payload := AuthPolicyInput{
		Mode:       string(mode),
		Prebuilt:   input.Prebuilt,
		CustomExpr: customExpr,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func parseStoredAuthPolicy(raw string) (AuthPolicyInput, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "{}" {
		return AuthPolicyInput{
			Mode:       string(entity.AuthMockPolicyModePrebuilt),
			Prebuilt:   entity.AuthMockPrebuiltPolicy{},
			CustomExpr: "",
		}, nil
	}
	var payload AuthPolicyInput
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return AuthPolicyInput{}, err
	}
	if strings.TrimSpace(payload.Mode) == "" {
		payload.Mode = string(entity.AuthMockPolicyModePrebuilt)
	}
	payload.Mode = strings.ToUpper(strings.TrimSpace(payload.Mode))
	payload.CustomExpr = strings.TrimSpace(payload.CustomExpr)
	return payload, nil
}

func (s *IntegrationService) appendEndpointRevision(
	ctx context.Context,
	endpoint *entity.IntegrationEndpoint,
	restoredFromRevisionID *string,
	now time.Time,
) error {
	revision := &entity.EndpointRevision{
		ID:                     uuid.NewString(),
		IntegrationID:          endpoint.IntegrationID,
		EndpointID:             endpoint.ID,
		ContractJSON:           endpoint.ContractJSON,
		ScenariosJSON:          endpoint.ScenariosJSON,
		CreatedAt:              now,
		RestoredFromRevisionID: restoredFromRevisionID,
	}
	return s.endpoints.AppendRevision(ctx, revision)
}

func (s *IntegrationService) activeSourceSlugSet(ctx context.Context, integrationID string) (map[string]struct{}, error) {
	result := map[string]struct{}{}
	if s.dataSources == nil {
		return result, nil
	}
	sources, err := s.dataSources.ListByIntegration(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	for _, source := range sources {
		if source == nil {
			continue
		}
		if source.Status != entity.DataSourceStatusActive {
			continue
		}
		slug := strings.TrimSpace(source.Slug)
		if slug == "" {
			continue
		}
		result[slug] = struct{}{}
	}
	return result, nil
}

func validationIssuesFromError(path string, code string, err error) []entity.ValidationIssue {
	if err == nil {
		return nil
	}
	if validatorErr, ok := err.(*validation.Error); ok {
		issues := make([]entity.ValidationIssue, 0, len(validatorErr.Messages))
		for _, message := range validatorErr.Messages {
			issues = append(issues, entity.ValidationIssue{
				Code:     code,
				Message:  message,
				Path:     path,
				Severity: "error",
			})
		}
		return issues
	}
	return []entity.ValidationIssue{
		{
			Code:     code,
			Message:  err.Error(),
			Path:     path,
			Severity: "error",
		},
	}
}

func decodeCursor(cursor string) int {
	cursor = strings.TrimSpace(cursor)
	if cursor == "" {
		return 0
	}
	offset, err := strconv.Atoi(cursor)
	if err != nil || offset < 0 {
		return 0
	}
	return offset
}
