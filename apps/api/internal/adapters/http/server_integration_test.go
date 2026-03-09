package http_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	httpserver "github.com/rendis/mock-loom/apps/api/internal/adapters/http"
	"github.com/rendis/mock-loom/apps/api/internal/adapters/http/middleware"
	"github.com/rendis/mock-loom/apps/api/internal/adapters/sqlite"
	"github.com/rendis/mock-loom/apps/api/internal/config"
	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/usecase"
)

type testHarness struct {
	t           *testing.T
	cfg         *config.Config
	app         httpApp
	userRepo    *sqlite.UserRepository
	systemRoles *sqlite.SystemRoleRepository
	defaultPack map[string]string
}

type httpApp interface {
	Test(req *http.Request, timeout ...int) (*http.Response, error)
}

func newTestHarness(t *testing.T, maxImportBytes int) *testHarness {
	t.Helper()

	if maxImportBytes <= 0 {
		maxImportBytes = 5242880
	}

	tempDir := t.TempDir()
	postmanCLI := createPostmanFakeCLI(t, tempDir)
	curlCLI := createCurlFakeCLI(t, tempDir)
	dbPath := filepath.Join(tempDir, "mock-loom-test.db")
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)", dbPath)

	cfg := &config.Config{
		Database: config.DatabaseConfig{
			DSN:           dsn,
			MigrationsDir: migrationDir(t),
		},
		Auth: config.AuthConfig{
			BootstrapEnabled: true,
			BootstrapEmails:  []string{"admin@example.com"},
			DummyAuthEnabled: true,
			DummyAuthEmail:   "admin@example.com",
			DummyAuthSubject: "sub-admin",
		},
		Import: config.ImportConfig{
			MaxBytes:       maxImportBytes,
			TimeoutSeconds: 5,
			MaxRoutes:      500,
			PostmanCLIPath: postmanCLI,
			CurlCLIPath:    curlCLI,
		},
		DataSources: config.DataSourcesConfig{
			BaselineMaxBytes: 10 * 1024 * 1024,
		},
	}

	db, err := sqlite.Open(cfg.Database.DSN)
	if err != nil {
		t.Fatalf("open sqlite db: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	if err := sqlite.RunMigrations(db, cfg.Database.MigrationsDir); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	dbRef := sqlite.NewDBRef(db)
	txManager := sqlite.NewTxManager(dbRef)
	userRepo := sqlite.NewUserRepository(dbRef)
	systemRoleRepo := sqlite.NewSystemRoleRepository(dbRef)
	workspaceRepo := sqlite.NewWorkspaceRepository(dbRef)
	memberRepo := sqlite.NewWorkspaceMemberRepository(dbRef)
	integrationRepo := sqlite.NewIntegrationRepository(dbRef)
	endpointRepo := sqlite.NewEndpointRepository(dbRef)
	dataSourceRepo := sqlite.NewDataSourceRepository(dbRef)

	authService := usecase.NewAuthService(cfg, txManager, userRepo, systemRoleRepo, memberRepo)
	authzService := usecase.NewAuthorizationService(workspaceRepo, memberRepo, integrationRepo)
	workspaceService := usecase.NewWorkspaceService(workspaceRepo, memberRepo)
	memberService := usecase.NewMemberService(userRepo, memberRepo)
	integrationService := usecase.NewIntegrationService(txManager, integrationRepo, endpointRepo, dataSourceRepo, cfg.Import)
	authMockService := usecase.NewAuthMockService(integrationRepo)
	dataSourceService := usecase.NewDataSourceService(txManager, integrationRepo, dataSourceRepo, cfg.DataSources)
	dataDebuggerService := usecase.NewDataDebuggerService(txManager, integrationRepo, dataSourceRepo)
	runtimeGatewayService := usecase.NewRuntimeGatewayService(txManager, integrationRepo, endpointRepo, dataSourceRepo, authMockService)

	authMiddleware, err := middleware.NewAuthMiddleware(cfg)
	if err != nil {
		t.Fatalf("new auth middleware: %v", err)
	}

	app := httpserver.NewServer(httpserver.Dependencies{
		AuthMiddleware:     authMiddleware,
		AuthService:        authService,
		AuthzService:       authzService,
		AuthMockService:    authMockService,
		WorkspaceService:   workspaceService,
		MemberService:      memberService,
		IntegrationService: integrationService,
		DataSourceService:  dataSourceService,
		DataDebugger:       dataDebuggerService,
		RuntimeGateway:     runtimeGatewayService,
		ImportMaxBytes:     cfg.Import.MaxBytes,
		DataSourceMaxBytes: cfg.DataSources.BaselineMaxBytes,
	})
	t.Cleanup(func() {
		_ = app.Shutdown()
	})

	return &testHarness{
		t:           t,
		cfg:         cfg,
		app:         app,
		userRepo:    userRepo,
		systemRoles: systemRoleRepo,
		defaultPack: map[string]string{},
	}
}

func (h *testHarness) setIdentity(email, subject string) {
	h.cfg.Auth.DummyAuthEmail = email
	h.cfg.Auth.DummyAuthSubject = subject
}

func (h *testHarness) request(method, path string, payload any) (int, map[string]any, []byte) {
	h.t.Helper()

	var body io.Reader
	if payload != nil {
		bytesPayload, err := json.Marshal(payload)
		if err != nil {
			h.t.Fatalf("marshal payload: %v", err)
		}
		body = bytes.NewReader(bytesPayload)
	}

	req := httptest.NewRequest(method, path, body)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return h.execute(req)
}

func (h *testHarness) requestWithHeaders(method, path string, payload any, headers map[string]string) (int, map[string]any, []byte) {
	h.t.Helper()

	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			h.t.Fatalf("marshal payload: %v", err)
		}
		body = bytes.NewReader(encoded)
	}
	req := httptest.NewRequest(method, path, body)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	return h.execute(req)
}

func (h *testHarness) requestRaw(method, path string, rawBody []byte, headers map[string]string) (int, map[string]any, []byte) {
	h.t.Helper()

	req := httptest.NewRequest(method, path, bytes.NewReader(rawBody))
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	return h.execute(req)
}

func (h *testHarness) execute(req *http.Request) (int, map[string]any, []byte) {
	h.t.Helper()

	resp, err := h.app.Test(req, -1)
	if err != nil {
		h.t.Fatalf("execute request %s %s: %v", req.Method, req.URL.Path, err)
	}
	defer resp.Body.Close()

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		h.t.Fatalf("read response body: %v", err)
	}
	var decoded map[string]any
	if len(rawBody) > 0 {
		_ = json.Unmarshal(rawBody, &decoded)
	}
	return resp.StatusCode, decoded, rawBody
}

func (h *testHarness) multipartRequest(
	method string,
	path string,
	fieldName string,
	filename string,
	content []byte,
	extraFields map[string]string,
) (int, map[string]any, []byte) {
	h.t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fileWriter, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		h.t.Fatalf("create multipart file part: %v", err)
	}
	buffered := bufio.NewWriter(fileWriter)
	if _, err := buffered.Write(content); err != nil {
		h.t.Fatalf("write multipart file content: %v", err)
	}
	if err := buffered.Flush(); err != nil {
		h.t.Fatalf("flush multipart file content: %v", err)
	}
	for key, value := range extraFields {
		if err := writer.WriteField(key, value); err != nil {
			h.t.Fatalf("write multipart field %q: %v", key, err)
		}
	}
	if err := writer.Close(); err != nil {
		h.t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(method, path, bytes.NewReader(body.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := h.app.Test(req, -1)
	if err != nil {
		h.t.Fatalf("execute multipart request %s %s: %v", method, path, err)
	}
	defer resp.Body.Close()

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		h.t.Fatalf("read multipart response body: %v", err)
	}
	var decoded map[string]any
	if len(rawBody) > 0 {
		_ = json.Unmarshal(rawBody, &decoded)
	}
	return resp.StatusCode, decoded, rawBody
}

func (h *testHarness) bootstrapAdmin() {
	h.t.Helper()
	h.setIdentity("admin@example.com", "sub-admin")
	status, payload, _ := h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		h.t.Fatalf("bootstrap admin expected 200, got %d with payload %v", status, payload)
	}
}

func (h *testHarness) createWorkspace() string {
	h.t.Helper()
	status, payload, _ := h.request(http.MethodPost, "/api/v1/workspaces", map[string]any{
		"name": "Workspace A",
		"slug": "workspace-a",
	})
	if status != http.StatusCreated {
		h.t.Fatalf("create workspace expected 201, got %d with payload %v", status, payload)
	}
	id := getString(payload, "id", "ID")
	if id == "" {
		h.t.Fatal("workspace id missing")
	}
	return id
}

func (h *testHarness) createIntegration(workspaceID string) string {
	h.t.Helper()
	status, payload, _ := h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/integrations", map[string]any{
		"name":    "Payments Mock",
		"slug":    "payments-mock",
		"baseUrl": "https://mock.example.com/payments",
	})
	if status != http.StatusCreated {
		h.t.Fatalf("create integration expected 201, got %d with payload %v", status, payload)
	}
	id := getString(payload, "id", "ID")
	if id == "" {
		h.t.Fatal("integration id missing")
	}
	h.defaultPack[id] = h.createPack(id)
	return id
}

func (h *testHarness) defaultPackID(integrationID string) string {
	h.t.Helper()
	packID, ok := h.defaultPack[integrationID]
	if !ok || strings.TrimSpace(packID) == "" {
		h.t.Fatalf("default pack missing for integration %s", integrationID)
	}
	return packID
}

func (h *testHarness) createPack(integrationID string) string {
	h.t.Helper()
	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs", map[string]any{
		"name":     "Core Pack",
		"slug":     "core-pack",
		"basePath": "/",
	})
	if status != http.StatusCreated {
		h.t.Fatalf("create pack expected 201, got %d with payload %v", status, payload)
	}
	id := getString(payload, "id", "ID")
	if id == "" {
		h.t.Fatal("pack id missing")
	}
	return id
}

func (h *testHarness) grantSystemRoleByEmail(email string, role entity.SystemRole) {
	h.t.Helper()
	user, err := h.userRepo.FindByEmail(context.Background(), email)
	if err != nil {
		h.t.Fatalf("find user by email for role grant: %v", err)
	}
	if err := h.systemRoles.Upsert(context.Background(), &entity.SystemRoleAssignment{
		UserID:    user.ID,
		Role:      role,
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		h.t.Fatalf("grant system role: %v", err)
	}
}

func createPostmanFakeCLI(t *testing.T, dir string) string {
	t.Helper()
	scriptPath := filepath.Join(dir, "fake-p2o.sh")
	content := `#!/usr/bin/env sh
set -eu
OUTPUT=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-f" ]; then
    OUTPUT="$2"
    shift 2
    continue
  fi
  shift
done
cat > "$OUTPUT" <<'EOF'
openapi: 3.0.3
info:
  title: postman-import
  version: 1.0.0
paths:
  /from-postman:
    get:
      responses:
        "200":
          description: ok
EOF
`
	if err := os.WriteFile(scriptPath, []byte(content), 0o700); err != nil {
		t.Fatalf("write fake postman cli: %v", err)
	}
	return scriptPath
}

func createCurlFakeCLI(t *testing.T, dir string) string {
	t.Helper()
	scriptPath := filepath.Join(dir, "fake-curlconverter.sh")
	content := `#!/usr/bin/env sh
set -eu
cat >/dev/null
echo '{"url":"https://api.example.com/from-curl","method":"get"}'
`
	if err := os.WriteFile(scriptPath, []byte(content), 0o700); err != nil {
		t.Fatalf("write fake curl cli: %v", err)
	}
	return scriptPath
}

func migrationDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller lookup failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "../../../db/migrations"))
}

func getString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func getNumber(payload map[string]any, keys ...string) float64 {
	for _, key := range keys {
		value, exists := payload[key]
		if !exists {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed
		case float32:
			return float64(typed)
		case int:
			return float64(typed)
		case int64:
			return float64(typed)
		case json.Number:
			parsed, err := typed.Float64()
			if err == nil {
				return parsed
			}
		case string:
			parsed, err := strconv.ParseFloat(typed, 64)
			if err == nil {
				return parsed
			}
		}
	}
	return 0
}

func getStringSlice(payload map[string]any, key string) []string {
	raw, exists := payload[key]
	if !exists {
		return []string{}
	}
	items, ok := raw.([]any)
	if !ok {
		return []string{}
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		value, ok := item.(string)
		if ok && value != "" {
			result = append(result, value)
		}
	}
	return result
}

func getObjectSlice(payload map[string]any, key string) []map[string]any {
	raw, exists := payload[key]
	if !exists {
		return []map[string]any{}
	}
	items, ok := raw.([]any)
	if !ok {
		return []map[string]any{}
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		object, ok := item.(map[string]any)
		if ok {
			result = append(result, object)
		}
	}
	return result
}

func buildTestJWT(claims map[string]any, signature string) string {
	header := map[string]any{
		"alg": "HS256",
		"typ": "JWT",
	}
	headerRaw, _ := json.Marshal(header)
	claimsRaw, _ := json.Marshal(claims)
	sig := signature
	if strings.TrimSpace(sig) == "" {
		sig = "sig"
	}
	return base64.RawURLEncoding.EncodeToString(headerRaw) +
		"." +
		base64.RawURLEncoding.EncodeToString(claimsRaw) +
		"." +
		sig
}

func TestAuthBootstrapAndNonInvitedForbidden(t *testing.T) {
	h := newTestHarness(t, 0)

	h.setIdentity("admin@example.com", "sub-admin")
	status, payload, _ := h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("expected 200 for bootstrap login, got %d payload=%v", status, payload)
	}
	if payload["systemRole"] != "SUPERADMIN" {
		t.Fatalf("expected SUPERADMIN, got %v", payload["systemRole"])
	}

	h.setIdentity("noninvited@example.com", "sub-guest")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusForbidden {
		t.Fatalf("expected 403 for non-invited user, got %d payload=%v", status, payload)
	}
}

func TestFirstLoginNotAllowlistedDoesNotBootstrap(t *testing.T) {
	h := newTestHarness(t, 0)

	h.setIdentity("intruder@example.com", "sub-intruder")
	status, payload, _ := h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusForbidden {
		t.Fatalf("expected 403 for non-allowlisted first login, got %d payload=%v", status, payload)
	}
}

func TestAuthRegisterEndpointIsNotAvailable(t *testing.T) {
	h := newTestHarness(t, 0)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email":    "ghost@example.com",
		"password": "not-used",
	})
	if status != http.StatusNotFound {
		t.Fatalf("expected 404 for missing registration endpoint, got %d payload=%v", status, payload)
	}
}

func TestWorkspaceInviteDeniedForNonAdmin(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()

	status, payload, _ := h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "viewer@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite viewer expected 201, got %d payload=%v", status, payload)
	}

	h.setIdentity("viewer@example.com", "sub-viewer")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("viewer first login expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "another@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusForbidden {
		t.Fatalf("non-admin invite expected 403, got %d payload=%v", status, payload)
	}
}

func TestWorkspaceInviteDuplicateReturnsConflict(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()

	status, payload, _ := h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "duplicate@example.com",
		"role":  "EDITOR",
	})
	if status != http.StatusCreated {
		t.Fatalf("first invite expected 201, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "duplicate@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusConflict {
		t.Fatalf("duplicate invite expected 409, got %d payload=%v", status, payload)
	}
}

func TestSuperadminOverrideAcrossWorkspaceWithoutMembership(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()

	status, payload, _ := h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "operator@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite operator expected 201, got %d payload=%v", status, payload)
	}

	h.setIdentity("operator@example.com", "sub-operator")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("operator first login expected 200, got %d payload=%v", status, payload)
	}
	h.grantSystemRoleByEmail("operator@example.com", entity.SystemRolePlatformAdmin)

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces", map[string]any{
		"name": "Workspace B",
		"slug": "workspace-b",
	})
	if status != http.StatusCreated {
		t.Fatalf("operator workspace create expected 201, got %d payload=%v", status, payload)
	}
	workspaceBID := getString(payload, "id", "ID")
	if workspaceBID == "" {
		t.Fatal("workspace B id missing")
	}

	superadminUser, err := h.userRepo.FindByEmail(context.Background(), "admin@example.com")
	if err != nil {
		t.Fatalf("find superadmin user: %v", err)
	}

	h.setIdentity("admin@example.com", "sub-admin")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/workspaces/"+workspaceBID+"/members", nil)
	if status != http.StatusOK {
		t.Fatalf("superadmin list members expected 200, got %d payload=%v", status, payload)
	}

	items, _ := payload["items"].([]any)
	for _, item := range items {
		member, _ := item.(map[string]any)
		if getString(member, "UserID", "user_id") == superadminUser.ID {
			t.Fatalf("expected superadmin user not to be workspace member, got payload=%v", payload)
		}
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceBID+"/integrations", map[string]any{
		"name":    "Superadmin Override",
		"slug":    "superadmin-override",
		"baseUrl": "https://mock.example.com/superadmin-override",
	})
	if status != http.StatusCreated {
		t.Fatalf("superadmin create integration expected 201, got %d payload=%v", status, payload)
	}
}

func TestWorkspaceRBACAcrossRoles(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "editor@example.com",
		"role":  "EDITOR",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite member expected 201, got %d payload=%v", status, payload)
	}

	h.setIdentity("editor@example.com", "sub-editor")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("editor login expected 200, got %d payload=%v", status, payload)
	}

	h.setIdentity("admin@example.com", "sub-admin")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/members", nil)
	if status != http.StatusOK {
		t.Fatalf("list members expected 200, got %d payload=%v", status, payload)
	}
	editorUser, err := h.userRepo.FindByEmail(context.Background(), "editor@example.com")
	if err != nil {
		t.Fatalf("find invited editor user: %v", err)
	}
	items, _ := payload["items"].([]any)
	editorActive := false
	for _, item := range items {
		member, _ := item.(map[string]any)
		if getString(member, "UserID", "user_id") == editorUser.ID && getString(member, "MembershipStatus", "membership_status") == "ACTIVE" {
			editorActive = true
		}
	}
	if !editorActive {
		t.Fatal("expected invited member to be activated after first login")
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/integrations", nil)
	if status != http.StatusOK {
		t.Fatalf("editor list integrations expected 200, got %d payload=%v", status, payload)
	}

	h.setIdentity("editor@example.com", "sub-editor")
	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: denied
  version: 1.0.0
paths:
  /denied:
    get:
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusForbidden {
		t.Fatalf("editor import expected 403, got %d payload=%v", status, payload)
	}
}

func TestPlatformAdminOverrideAcrossWorkspaces(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "platform@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite platform member expected 201, got %d payload=%v", status, payload)
	}

	h.setIdentity("platform@example.com", "sub-platform")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("platform user first login expected 200, got %d payload=%v", status, payload)
	}

	h.grantSystemRoleByEmail("platform@example.com", entity.SystemRolePlatformAdmin)

	h.setIdentity("platform@example.com", "sub-platform")
	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: override
  version: 1.0.0
paths:
  /override:
    get:
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("platform admin import expected 200, got %d payload=%v", status, payload)
	}
}

func TestImportOpenAPIAndDuplicateUpsertCounters(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	openapiPayload := `openapi: 3.0.3
info:
  title: routes
  version: 1.0.0
paths:
  /orders:
    get:
      responses:
        "200":
          description: ok
    post:
      responses:
        "201":
          description: created
`
	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload":    openapiPayload,
	})
	if status != http.StatusOK {
		t.Fatalf("openapi import expected 200, got %d payload=%v", status, payload)
	}
	if payload["createdRoutes"] != float64(2) || payload["updatedRoutes"] != float64(0) {
		t.Fatalf("unexpected first import counters: %v", payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload":    openapiPayload,
	})
	if status != http.StatusOK {
		t.Fatalf("second openapi import expected 200, got %d payload=%v", status, payload)
	}
	if payload["createdRoutes"] != float64(0) || payload["updatedRoutes"] != float64(2) {
		t.Fatalf("unexpected second import counters: %v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("list routes expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(items))
	}
}

func TestPackBasePathIsRequiredAndAppliedToImportedRoutes(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs", map[string]any{
		"name": "Missing Base Path",
		"slug": "missing-base-path",
	})
	if status != http.StatusBadRequest {
		t.Fatalf("create pack without basePath expected 400, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs", map[string]any{
		"name":     "Internal Pack",
		"slug":     "internal-pack",
		"basePath": "/internal",
	})
	if status != http.StatusCreated {
		t.Fatalf("create pack with basePath expected 201, got %d payload=%v", status, payload)
	}
	internalPackID := getString(payload, "id", "ID")
	if internalPackID == "" {
		t.Fatalf("created pack id missing payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+internalPackID+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: internal-routes
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("import into basePath pack expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+internalPackID+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("list internal pack routes expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one imported route, got %d payload=%v", len(items), payload)
	}
	first, _ := items[0].(map[string]any)
	path := getString(first, "path", "Path")
	if path != "/internal/users" {
		t.Fatalf("expected imported route path to include pack base path, got %q payload=%v", path, first)
	}
}

func TestUpdateEndpointRouteAndPackBasePathRebase(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs", map[string]any{
		"name":     "Tenant Pack",
		"slug":     "tenant-pack",
		"basePath": "/tenant/:tenantId",
	})
	if status != http.StatusCreated {
		t.Fatalf("create pack expected 201, got %d payload=%v", status, payload)
	}
	packID := getString(payload, "id", "ID")
	if packID == "" {
		t.Fatalf("created pack id missing payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+packID+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: tenant-pack
  version: 1.0.0
paths:
  /users/{userId}:
    get:
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("import endpoint expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+packID+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("list routes expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one route, got %d payload=%v", len(items), payload)
	}
	first, _ := items[0].(map[string]any)
	endpointID := getString(first, "id", "ID")
	if endpointID == "" {
		t.Fatalf("endpoint id missing payload=%v", first)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/packs/"+packID+"/endpoints/"+endpointID+"/route", map[string]any{
		"method":       "PATCH",
		"relativePath": "/orders/:orderId",
	})
	if status != http.StatusOK {
		t.Fatalf("update endpoint route expected 200, got %d payload=%v", status, payload)
	}
	if gotMethod := strings.ToUpper(getString(payload, "method", "Method")); gotMethod != "PATCH" {
		t.Fatalf("expected method PATCH after route update, got %q payload=%v", gotMethod, payload)
	}
	if gotPath := getString(payload, "path", "Path"); gotPath != "/tenant/:tenantId/orders/:orderId" {
		t.Fatalf("unexpected updated path %q payload=%v", gotPath, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/packs/"+packID+"/endpoints/"+endpointID+"/route", map[string]any{
		"method":       "PATCH",
		"relativePath": "/orders/:orderId?status=active",
	})
	if status != http.StatusBadRequest {
		t.Fatalf("endpoint route with query string expected 400, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/packs/"+packID, map[string]any{
		"basePath": "/accounts/:accountId",
	})
	if status != http.StatusOK {
		t.Fatalf("pack basePath rebase expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+packID+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("list routes after rebase expected 200, got %d payload=%v", status, payload)
	}
	items, _ = payload["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one route after rebase, got %d payload=%v", len(items), payload)
	}
	rebasedRoute, _ := items[0].(map[string]any)
	if rebasedPath := getString(rebasedRoute, "path", "Path"); rebasedPath != "/accounts/:accountId/orders/:orderId" {
		t.Fatalf("unexpected rebased path %q payload=%v", rebasedPath, rebasedRoute)
	}
}

func TestPackBasePathRebaseConflictReturns409(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs", map[string]any{
		"name":     "Pack One",
		"slug":     "pack-one",
		"basePath": "/v1",
	})
	if status != http.StatusCreated {
		t.Fatalf("create first pack expected 201, got %d payload=%v", status, payload)
	}
	packOneID := getString(payload, "id", "ID")

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs", map[string]any{
		"name":     "Pack Two",
		"slug":     "pack-two",
		"basePath": "/v2",
	})
	if status != http.StatusCreated {
		t.Fatalf("create second pack expected 201, got %d payload=%v", status, payload)
	}
	packTwoID := getString(payload, "id", "ID")

	importPayload := `openapi: 3.0.3
info:
  title: conflict-check
  version: 1.0.0
paths:
  /orders:
    get:
      responses:
        "200":
          description: ok
`

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+packOneID+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload":    importPayload,
	})
	if status != http.StatusOK {
		t.Fatalf("import in first pack expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+packTwoID+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload":    importPayload,
	})
	if status != http.StatusOK {
		t.Fatalf("import in second pack expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/packs/"+packTwoID, map[string]any{
		"basePath": "/v1",
	})
	if status != http.StatusConflict {
		t.Fatalf("pack rebase conflict expected 409, got %d payload=%v", status, payload)
	}
}

func TestImportPostmanAndCurlHappyPath(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "POSTMAN",
		"payload":    `{"info":{"name":"Demo"}}`,
	})
	if status != http.StatusOK {
		t.Fatalf("postman import expected 200, got %d payload=%v", status, payload)
	}
	if payload["createdRoutes"] != float64(1) {
		t.Fatalf("expected postman import to create one route, payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "CURL",
		"payload":    `curl -X GET https://api.example.com/from-curl`,
	})
	if status != http.StatusOK {
		t.Fatalf("curl import expected 200, got %d payload=%v", status, payload)
	}
	if payload["createdRoutes"] != float64(1) {
		t.Fatalf("expected curl import to create one route, payload=%v", payload)
	}
}

func TestImportOversizedPayloadReturns413(t *testing.T) {
	h := newTestHarness(t, 20)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload":    "0123456789012345678901234567890123456789",
	})
	if status != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for oversized payload, got %d payload=%v", status, payload)
	}
}

func TestInvalidScenarioUpdateReturns422(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: one
  version: 1.0.0
paths:
  /one:
    get:
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("openapi import expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("list routes expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) == 0 {
		t.Fatal("expected at least one route")
	}
	first, _ := items[0].(map[string]any)
	endpointID, _ := first["id"].(string)
	if endpointID == "" {
		t.Fatal("endpoint id missing")
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/scenarios", map[string]any{
		"scenarios": `[{"priority":1,"conditionExpr":"request..invalid","response":{}}]`,
	})
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("invalid scenarios expected 422, got %d payload=%v", status, payload)
	}
}

func TestInvalidContractUpdateReturns422(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: one
  version: 1.0.0
paths:
  /one:
    get:
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("openapi import expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("list routes expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) == 0 {
		t.Fatal("expected at least one route")
	}
	first, _ := items[0].(map[string]any)
	endpointID, _ := first["id"].(string)
	if endpointID == "" {
		t.Fatal("endpoint id missing")
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/contract", map[string]any{
		"contract": `{"type":"wat"}`,
	})
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("invalid contract expected 422, got %d payload=%v", status, payload)
	}
}

func TestEndpointAutocompleteContextFlow(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: autocomplete
  version: 1.0.0
paths:
  /charges/{chargeId}:
    post:
      parameters:
        - name: chargeId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                chargeId:
                  type: string
                customer:
                  type: object
                  properties:
                    email:
                      type: string
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("openapi import expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Users Source",
		"slug": "users",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create data source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")
	if sourceID == "" {
		t.Fatal("source id missing")
	}

	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"users.json",
		[]byte(`[{"id":"u-1","email":"alpha@example.com","profile":{"tier":"gold"}}]`),
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("upload baseline expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("list routes expected 200, got %d payload=%v", status, payload)
	}
	routeItems, _ := payload["items"].([]any)
	if len(routeItems) == 0 {
		t.Fatal("expected at least one route")
	}
	firstRoute, _ := routeItems[0].(map[string]any)
	endpointID := getString(firstRoute, "id", "ID")
	if endpointID == "" {
		t.Fatalf("endpoint id missing from route payload=%v", firstRoute)
	}

	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/autocomplete-context",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("autocomplete context expected 200, got %d payload=%v", status, payload)
	}

	requestPaths := getStringSlice(payload, "RequestPaths")
	if len(requestPaths) == 0 {
		requestPaths = getStringSlice(payload, "requestPaths")
	}
	if len(requestPaths) == 0 {
		t.Fatalf("request paths missing in payload=%v", payload)
	}
	if !slices.Contains(requestPaths, "request.body.chargeId") {
		t.Fatalf("expected request.body.chargeId in requestPaths=%v", requestPaths)
	}
	if !slices.Contains(requestPaths, "request.params.path.chargeId") {
		t.Fatalf("expected request.params.path.chargeId in requestPaths=%v", requestPaths)
	}

	sourcePaths := getStringSlice(payload, "SourcePaths")
	if len(sourcePaths) == 0 {
		sourcePaths = getStringSlice(payload, "sourcePaths")
	}
	if len(sourcePaths) == 0 {
		t.Fatalf("source paths missing in payload=%v", payload)
	}
	if !slices.Contains(sourcePaths, "source.users.id") {
		t.Fatalf("expected source.users.id in sourcePaths=%v", sourcePaths)
	}

	functions := getStringSlice(payload, "Functions")
	if len(functions) == 0 {
		functions = getStringSlice(payload, "functions")
	}
	if len(functions) == 0 {
		t.Fatalf("functions missing in payload=%v", payload)
	}

	templates := getStringSlice(payload, "TemplatePaths")
	if len(templates) == 0 {
		templates = getStringSlice(payload, "templatePaths")
	}
	if !slices.Contains(templates, "{{request.body.chargeId}}") {
		t.Fatalf("expected request template token in templatePaths=%v", templates)
	}
	if !slices.Contains(templates, "{{request.params.path.chargeId}}") {
		t.Fatalf("expected path param template token in templatePaths=%v", templates)
	}
}

func TestEndpointAutocompleteContextErrorsAndRBAC(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: one
  version: 1.0.0
paths:
  /one:
    get:
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("openapi import expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("list routes expected 200, got %d payload=%v", status, payload)
	}
	routeItems, _ := payload["items"].([]any)
	if len(routeItems) == 0 {
		t.Fatal("expected at least one route")
	}
	firstRoute, _ := routeItems[0].(map[string]any)
	endpointID := getString(firstRoute, "id", "ID")

	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/missing-endpoint/autocomplete-context",
		nil,
	)
	if status != http.StatusNotFound {
		t.Fatalf("missing endpoint expected 404, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "viewer-autocomplete@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite viewer expected 201, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "outsider-autocomplete@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite outsider expected 201, got %d payload=%v", status, payload)
	}

	h.setIdentity("viewer-autocomplete@example.com", "sub-viewer-autocomplete")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("viewer first login expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/autocomplete-context",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("viewer autocomplete expected 200, got %d payload=%v", status, payload)
	}
}

func TestDataSourceCreateListConflictAndBaselineLifecycle(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Users Source",
		"slug": "users",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create data source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")
	if sourceID == "" {
		t.Fatalf("data source id missing: %v", payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Users Source Duplicate",
		"slug": "users",
		"kind": "JSON",
	})
	if status != http.StatusConflict {
		t.Fatalf("duplicate data source slug expected 409, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources", nil)
	if status != http.StatusOK {
		t.Fatalf("list data sources expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 data source, got %d payload=%v", len(items), payload)
	}

	initialBaseline := []byte(`[
  {"id":"1","name":"alice"},
  {"id":"2","name":"bob"}
]`)
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"users.json",
		initialBaseline,
		map[string]string{"parser": "json"},
	)
	if status != http.StatusOK {
		t.Fatalf("upload baseline expected 200, got %d payload=%v", status, payload)
	}
	if payload["recordCount"] != float64(2) {
		t.Fatalf("expected baseline recordCount=2, got payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources", nil)
	if status != http.StatusOK {
		t.Fatalf("list data sources after baseline expected 200, got %d payload=%v", status, payload)
	}
	items, _ = payload["items"].([]any)
	first, _ := items[0].(map[string]any)
	if getString(first, "status", "Status") != "ACTIVE" {
		t.Fatalf("expected source status ACTIVE after baseline, got payload=%v", first)
	}
	if getNumber(first, "record_count", "RecordCount") != float64(2) {
		t.Fatalf("expected source record_count=2 after first baseline, got payload=%v", first)
	}

	replacementBaseline := []byte(`[{"id":"9","name":"zoe"}]`)
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"users.json",
		replacementBaseline,
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("replace baseline expected 200, got %d payload=%v", status, payload)
	}
	if payload["recordCount"] != float64(1) {
		t.Fatalf("expected replacement recordCount=1, got payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources", nil)
	if status != http.StatusOK {
		t.Fatalf("list data sources after replacement expected 200, got %d payload=%v", status, payload)
	}
	items, _ = payload["items"].([]any)
	first, _ = items[0].(map[string]any)
	if getNumber(first, "record_count", "RecordCount") != float64(1) {
		t.Fatalf("expected source record_count=1 after replacement baseline, got payload=%v", first)
	}
}

func TestDataSourceCSVBaselineSupportsCustomDelimiter(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Ledger Source",
		"slug": "ledger",
		"kind": "CSV",
	})
	if status != http.StatusCreated {
		t.Fatalf("create csv data source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")
	if sourceID == "" {
		t.Fatalf("csv data source id missing: %v", payload)
	}

	csvBaseline := []byte("id;name;status\nent-1;alice;active\nent-2;bob;blocked\n")
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"ledger.csv",
		csvBaseline,
		map[string]string{"csvDelimiter": "semicolon"},
	)
	if status != http.StatusOK {
		t.Fatalf("csv baseline upload expected 200, got %d payload=%v", status, payload)
	}
	if getNumber(payload, "recordCount", "record_count") != float64(2) {
		t.Fatalf("expected csv baseline recordCount=2, got payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities?sort=entity_asc", nil)
	if status != http.StatusOK {
		t.Fatalf("entities after custom delimiter upload expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("expected 2 entities after custom delimiter upload, got %d payload=%v", len(items), payload)
	}

	firstEntity, _ := items[0].(map[string]any)
	currentData := getString(firstEntity, "current_data_json", "currentDataJson", "CurrentDataJSON")
	if !strings.Contains(currentData, `"status":"active"`) {
		t.Fatalf("expected parsed semicolon csv status field, got %q", currentData)
	}
}

func TestDataSourceUpdateDeleteAndSlugRenamePreservesDebuggerLinkage(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Users Source",
		"slug": "users",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create users source expected 201, got %d payload=%v", status, payload)
	}
	usersSourceID := getString(payload, "id", "ID")
	if usersSourceID == "" {
		t.Fatalf("users source id missing: %v", payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Orders Source",
		"slug": "orders",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create orders source expected 201, got %d payload=%v", status, payload)
	}
	ordersSourceID := getString(payload, "id", "ID")
	if ordersSourceID == "" {
		t.Fatalf("orders source id missing: %v", payload)
	}

	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+usersSourceID+"/baseline",
		"file",
		"users.json",
		[]byte(`[{"id":"ent-1","name":"alpha"}]`),
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("upload baseline expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: slug-propagation
  version: 1.0.0
paths:
  /users/apply:
    post:
      responses:
        "201":
          description: created
`,
	})
	if status != http.StatusOK {
		t.Fatalf("import expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("routes expected 200, got %d payload=%v", status, payload)
	}
	routes, _ := payload["items"].([]any)
	if len(routes) == 0 {
		t.Fatalf("expected at least one route, payload=%v", payload)
	}
	endpoint, _ := routes[0].(map[string]any)
	endpointID := getString(endpoint, "id", "ID")
	if endpointID == "" {
		t.Fatalf("endpoint id missing, payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/scenarios", map[string]any{
		"scenarios": `[{
			"name":"Apply User",
			"priority":10,
			"conditionExpr":"true",
			"response":{"statusCode":201,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}},
			"mutations":[{"type":"UPSERT","sourceSlug":"users","entityIdExpr":"request.body.id","payloadExpr":"request.body"}]
		}]`,
	})
	if status != http.StatusNoContent {
		t.Fatalf("update scenarios expected 204, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/data-sources/"+usersSourceID, map[string]any{
		"name": "Users Source v2",
		"slug": "users-v2",
	})
	if status != http.StatusOK {
		t.Fatalf("update source expected 200, got %d payload=%v", status, payload)
	}
	if getString(payload, "slug", "Slug") != "users-v2" {
		t.Fatalf("expected updated slug users-v2, got payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/data-sources/"+usersSourceID, map[string]any{
		"name": "Users Source conflict",
		"slug": "orders",
	})
	if status != http.StatusConflict {
		t.Fatalf("duplicate slug update expected 409, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+usersSourceID+"/entities", nil)
	if status != http.StatusOK {
		t.Fatalf("entities after slug rename expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 entity after slug rename, got %d payload=%v", len(items), payload)
	}

	status, payload, _ = h.requestRaw(
		http.MethodPost,
		"/mock/"+workspaceID+"/"+integrationID+"/users/apply",
		[]byte(`{"id":"ent-2","name":"beta"}`),
		map[string]string{"Content-Type": "application/json"},
	)
	if status != http.StatusCreated {
		t.Fatalf("runtime after slug rename expected 201, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+usersSourceID+"/entities?search=ent-2", nil)
	if status != http.StatusOK {
		t.Fatalf("entities lookup after runtime expected 200, got %d payload=%v", status, payload)
	}
	items, _ = payload["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected propagated runtime entity after slug rename, got %d payload=%v", len(items), payload)
	}

	status, payload, _ = h.request(http.MethodDelete, "/api/v1/integrations/"+integrationID+"/data-sources/"+usersSourceID, nil)
	if status != http.StatusNoContent {
		t.Fatalf("delete source expected 204, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources", nil)
	if status != http.StatusOK {
		t.Fatalf("list after delete expected 200, got %d payload=%v", status, payload)
	}
	items, _ = payload["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 source after delete, got %d payload=%v", len(items), payload)
	}
	remaining, _ := items[0].(map[string]any)
	if getString(remaining, "id", "ID") != ordersSourceID {
		t.Fatalf("expected remaining source to be orders source, got payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+usersSourceID+"/entities", nil)
	if status != http.StatusNotFound {
		t.Fatalf("entities for deleted source expected 404, got %d payload=%v", status, payload)
	}
}

func TestDataSourceBaselineFailureDoesNotDropLastRecordCount(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Payments Source",
		"slug": "payments",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create data source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")
	if sourceID == "" {
		t.Fatal("source id missing")
	}

	validBaseline := []byte(`[{"id":"a-1","amount":100.5}]`)
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"payments.json",
		validBaseline,
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("first baseline expected 200, got %d payload=%v", status, payload)
	}

	invalidBaseline := []byte(`[
  {"id":"a-1","amount":100.5},
  {"id":"a-2","amount":"broken"}
]`)
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"payments.json",
		invalidBaseline,
		nil,
	)
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("invalid baseline expected 422, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources", nil)
	if status != http.StatusOK {
		t.Fatalf("list data sources expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	first, _ := items[0].(map[string]any)
	if getString(first, "status", "Status") != "ERROR" {
		t.Fatalf("expected source status ERROR after failed baseline, got payload=%v", first)
	}
	if getNumber(first, "record_count", "RecordCount") != float64(1) {
		t.Fatalf("expected source record_count to remain 1 after failed baseline, got payload=%v", first)
	}
}

func TestDataDebuggerEntitiesTimelineRollbackFlow(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Users Source",
		"slug": "users",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create data source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")
	if sourceID == "" {
		t.Fatal("source id missing")
	}

	baselineV1 := []byte(`[{"id":"ent-1","name":"alpha-v1","status":"active"}]`)
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"users-v1.json",
		baselineV1,
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("upload baseline v1 expected 200, got %d payload=%v", status, payload)
	}

	baselineV2 := []byte(`[{"id":"ent-1","name":"alpha-v2","status":"locked"}]`)
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"users-v2.json",
		baselineV2,
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("upload baseline v2 expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities", nil)
	if status != http.StatusOK {
		t.Fatalf("entities expected 200, got %d payload=%v", status, payload)
	}
	entityItems, _ := payload["items"].([]any)
	if len(entityItems) != 1 {
		t.Fatalf("expected one entity row, got %d payload=%v", len(entityItems), payload)
	}
	entityRow, _ := entityItems[0].(map[string]any)
	currentData := getString(entityRow, "current_data_json", "currentDataJson", "CurrentDataJSON")
	if !strings.Contains(currentData, `"alpha-v2"`) {
		t.Fatalf("expected latest working state to be v2, got %q", currentData)
	}

	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/timeline",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("timeline expected 200, got %d payload=%v", status, payload)
	}
	timelineItems, _ := payload["items"].([]any)
	if len(timelineItems) < 2 {
		t.Fatalf("expected timeline >= 2 events after baseline replacement, got %d payload=%v", len(timelineItems), payload)
	}

	targetEventID := ""
	for _, raw := range timelineItems {
		event, _ := raw.(map[string]any)
		diff := getString(event, "diff_payload_json", "diffPayloadJson", "DiffPayloadJSON")
		if strings.Contains(diff, `"alpha-v1"`) {
			targetEventID = getString(event, "id", "ID")
			break
		}
	}
	if targetEventID == "" {
		t.Fatalf("expected rollback target event from v1 baseline, got payload=%v", payload)
	}

	status, payload, _ = h.request(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/rollback",
		map[string]any{"targetEventId": targetEventID},
	)
	if status != http.StatusOK {
		t.Fatalf("rollback expected 200, got %d payload=%v", status, payload)
	}
	if getString(payload, "entityId", "entity_id") != "ent-1" {
		t.Fatalf("expected rollback response entityId=ent-1, got %v", payload)
	}
	rollbackEventID := getString(payload, "rollbackEventId", "rollback_event_id")
	if rollbackEventID == "" {
		t.Fatalf("rollback event id missing in payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities", nil)
	if status != http.StatusOK {
		t.Fatalf("entities after rollback expected 200, got %d payload=%v", status, payload)
	}
	entityItems, _ = payload["items"].([]any)
	entityRow, _ = entityItems[0].(map[string]any)
	currentData = getString(entityRow, "current_data_json", "currentDataJson", "CurrentDataJSON")
	if !strings.Contains(currentData, `"alpha-v1"`) {
		t.Fatalf("expected working state restored to v1, got %q", currentData)
	}

	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/timeline",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("timeline after rollback expected 200, got %d payload=%v", status, payload)
	}
	timelineItems, _ = payload["items"].([]any)
	foundCompensation := false
	for _, raw := range timelineItems {
		event, _ := raw.(map[string]any)
		if getString(event, "id", "ID") == rollbackEventID && getString(event, "action", "Action") == "ROLLBACK_COMPENSATION" {
			foundCompensation = true
			break
		}
	}
	if !foundCompensation {
		t.Fatalf("expected compensation event %s in timeline payload=%v", rollbackEventID, payload)
	}
}

func TestDataDebuggerRollbackErrors(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Users Source",
		"slug": "users",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create data source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")
	if sourceID == "" {
		t.Fatal("source id missing")
	}

	baseline := []byte(`[{"id":"ent-1","name":"alpha-v1"}]`)
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"users.json",
		baseline,
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("upload baseline expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/rollback",
		map[string]any{"targetEventId": ""},
	)
	if status != http.StatusBadRequest {
		t.Fatalf("empty targetEventId expected 400, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/rollback",
		map[string]any{"targetEventId": "missing-event"},
	)
	if status != http.StatusNotFound {
		t.Fatalf("missing target event expected 404, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/integrations", map[string]any{
		"name":    "Payments Mock Secondary",
		"slug":    "payments-mock-secondary",
		"baseUrl": "https://mock.example.com/payments-secondary",
	})
	if status != http.StatusCreated {
		t.Fatalf("create secondary integration expected 201, got %d payload=%v", status, payload)
	}
	otherIntegrationID := getString(payload, "id", "ID")
	if otherIntegrationID == "" {
		t.Fatal("secondary integration id missing")
	}
	status, payload, _ = h.request(
		http.MethodPost,
		"/api/v1/integrations/"+otherIntegrationID+"/data-sources/"+sourceID+"/entities/ent-1/rollback",
		map[string]any{"targetEventId": "missing-event"},
	)
	if status != http.StatusNotFound {
		t.Fatalf("source from another integration expected 404, got %d payload=%v", status, payload)
	}
}

func TestDataDebuggerRollbackRBAC(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Users Source",
		"slug": "users",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create data source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")
	if sourceID == "" {
		t.Fatal("source id missing")
	}

	baseline := []byte(`[{"id":"ent-1","name":"alpha-v1"}]`)
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"users.json",
		baseline,
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("upload baseline expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "viewer-debugger@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite viewer expected 201, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "editor-debugger@example.com",
		"role":  "EDITOR",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite editor expected 201, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/timeline",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("admin timeline expected 200, got %d payload=%v", status, payload)
	}
	timelineItems, _ := payload["items"].([]any)
	if len(timelineItems) == 0 {
		t.Fatalf("expected at least one event in timeline payload=%v", payload)
	}
	firstEvent, _ := timelineItems[0].(map[string]any)
	targetEventID := getString(firstEvent, "id", "ID")
	if targetEventID == "" {
		t.Fatalf("target event id missing from payload=%v", firstEvent)
	}

	h.setIdentity("viewer-debugger@example.com", "sub-viewer-debugger")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("viewer first login expected 200, got %d payload=%v", status, payload)
	}
	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities", nil)
	if status != http.StatusOK {
		t.Fatalf("viewer entities expected 200, got %d payload=%v", status, payload)
	}
	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/timeline",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("viewer timeline expected 200, got %d payload=%v", status, payload)
	}
	status, payload, _ = h.request(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/rollback",
		map[string]any{"targetEventId": targetEventID},
	)
	if status != http.StatusForbidden {
		t.Fatalf("viewer rollback expected 403, got %d payload=%v", status, payload)
	}

	h.setIdentity("editor-debugger@example.com", "sub-editor-debugger")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("editor first login expected 200, got %d payload=%v", status, payload)
	}
	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities", nil)
	if status != http.StatusOK {
		t.Fatalf("editor entities expected 200, got %d payload=%v", status, payload)
	}
	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/timeline",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("editor timeline expected 200, got %d payload=%v", status, payload)
	}
	status, payload, _ = h.request(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/rollback",
		map[string]any{"targetEventId": targetEventID},
	)
	if status != http.StatusForbidden {
		t.Fatalf("editor rollback expected 403, got %d payload=%v", status, payload)
	}

	h.setIdentity("admin@example.com", "sub-admin")
	status, payload, _ = h.request(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-1/rollback",
		map[string]any{"targetEventId": targetEventID},
	)
	if status != http.StatusOK {
		t.Fatalf("admin rollback expected 200, got %d payload=%v", status, payload)
	}
}

func TestDataSourceRuntimeActionsAndEntityCreation(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Runtime Source",
		"slug": "runtime-source",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")

	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"runtime.json",
		[]byte(`[{"id":"ent-1","name":"alpha"},{"id":"ent-2","name":"beta"}]`),
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("baseline upload expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/sync", nil)
	if status != http.StatusOK {
		t.Fatalf("sync now expected 200, got %d payload=%v", status, payload)
	}
	if getNumber(payload, "recordCount", "record_count") != float64(2) {
		t.Fatalf("expected recordCount=2 after sync, got payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/schema", nil)
	if status != http.StatusOK {
		t.Fatalf("schema expected 200, got %d payload=%v", status, payload)
	}
	schemaJSON := getString(payload, "schemaJson", "schema_json")
	if !strings.Contains(schemaJSON, "name") {
		t.Fatalf("schema payload missing expected fields: %s", schemaJSON)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/history", nil)
	if status != http.StatusOK {
		t.Fatalf("history expected 200, got %d payload=%v", status, payload)
	}
	historyItems, _ := payload["items"].([]any)
	if len(historyItems) == 0 {
		t.Fatalf("expected history events, got payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities", map[string]any{
		"entityId": "ent-3",
		"payload": map[string]any{
			"id":   "ent-3",
			"name": "gamma",
		},
	})
	if status != http.StatusOK {
		t.Fatalf("create entity expected 200, got %d payload=%v", status, payload)
	}
	eventID := getString(payload, "eventId", "event_id")
	if eventID == "" {
		t.Fatalf("create entity response missing event id payload=%v", payload)
	}

	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities?search=ent-3&limit=1&sort=entity_asc",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("filtered entities expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected exactly one filtered entity, got %d payload=%v", len(items), payload)
	}
	row, _ := items[0].(map[string]any)
	if getString(row, "entity_id", "entityId", "EntityID") != "ent-3" {
		t.Fatalf("expected entity ent-3, got payload=%v", row)
	}

	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-3/timeline",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("timeline expected 200, got %d payload=%v", status, payload)
	}
	timelineItems, _ := payload["items"].([]any)
	foundUpsert := false
	for _, raw := range timelineItems {
		event, _ := raw.(map[string]any)
		if getString(event, "action", "Action") == "ENTITY_UPSERT" {
			foundUpsert = true
			break
		}
	}
	if !foundUpsert {
		t.Fatalf("expected ENTITY_UPSERT in timeline payload=%v", payload)
	}
}

func TestDataSourceSchemaOverridesPersistWarningsAndPrune(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Schema Source",
		"slug": "schema-source",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")

	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"schema-source.json",
		[]byte(`[{"id":"ent-1","age":"40","active":"true"},{"id":"ent-2","age":"41","active":"false"}]`),
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("baseline upload expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/schema", nil)
	if status != http.StatusOK {
		t.Fatalf("get schema expected 200, got %d payload=%v", status, payload)
	}
	initialFields := getObjectSlice(payload, "fields")
	if len(initialFields) != 3 {
		t.Fatalf("expected 3 schema fields, got %d payload=%v", len(initialFields), payload)
	}
	if len(getObjectSlice(payload, "warnings")) != 0 {
		t.Fatalf("expected no warnings on inferred schema payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/schema", map[string]any{
		"fields": []map[string]any{
			{"key": "active", "type": "boolean"},
			{"key": "age", "type": "number"},
			{"key": "id", "type": "string"},
		},
	})
	if status != http.StatusOK {
		t.Fatalf("update schema expected 200, got %d payload=%v", status, payload)
	}
	warnings := getObjectSlice(payload, "warnings")
	if len(warnings) != 2 {
		t.Fatalf("expected 2 mismatch warnings, got %d payload=%v", len(warnings), payload)
	}
	updatedSchemaJSON := getString(payload, "schemaJson", "schema_json")
	if !strings.Contains(updatedSchemaJSON, `"active":{"type":"boolean"}`) {
		t.Fatalf("expected backward-compatible schemaJson with active override payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/schema", nil)
	if status != http.StatusOK {
		t.Fatalf("get schema after update expected 200, got %d payload=%v", status, payload)
	}
	persistedFields := getObjectSlice(payload, "fields")
	foundAgeOverride := false
	for _, field := range persistedFields {
		if getString(field, "key") != "age" {
			continue
		}
		foundAgeOverride = true
		if getString(field, "effectiveType", "effective_type") != "number" {
			t.Fatalf("expected age effective type number, got payload=%v", field)
		}
		if overridden, _ := field["overridden"].(bool); !overridden {
			t.Fatalf("expected age field to be marked overridden payload=%v", field)
		}
	}
	if !foundAgeOverride {
		t.Fatalf("expected age field in persisted schema payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/schema", map[string]any{
		"fields": []map[string]any{
			{"key": "active", "type": "boolean"},
			{"key": "age", "type": "uuid"},
			{"key": "id", "type": "string"},
		},
	})
	if status != http.StatusBadRequest {
		t.Fatalf("invalid schema update expected 400, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "viewer-schema@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite viewer expected 201, got %d payload=%v", status, payload)
	}
	h.setIdentity("viewer-schema@example.com", "sub-viewer-schema")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("viewer login expected 200, got %d payload=%v", status, payload)
	}
	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/schema", map[string]any{
		"fields": []map[string]any{
			{"key": "active", "type": "string"},
			{"key": "age", "type": "string"},
			{"key": "id", "type": "string"},
		},
	})
	if status != http.StatusForbidden {
		t.Fatalf("viewer update schema expected 403, got %d payload=%v", status, payload)
	}

	h.setIdentity("admin@example.com", "sub-admin")
	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"schema-source-v2.json",
		[]byte(`[{"id":"ent-1","active":"true"},{"id":"ent-3","active":"false"}]`),
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("second baseline upload expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/schema", nil)
	if status != http.StatusOK {
		t.Fatalf("get schema after second baseline expected 200, got %d payload=%v", status, payload)
	}
	finalFields := getObjectSlice(payload, "fields")
	if len(finalFields) != 2 {
		t.Fatalf("expected 2 fields after schema prune, got %d payload=%v", len(finalFields), payload)
	}
	for _, field := range finalFields {
		key := getString(field, "key")
		if key == "age" {
			t.Fatalf("age override should be pruned after baseline key removal payload=%v", payload)
		}
		if key == "active" {
			if getString(field, "effectiveType", "effective_type") != "boolean" {
				t.Fatalf("active override should remain after baseline update payload=%v", field)
			}
		}
	}
}

func TestAuthMockPolicyEndpointsAndRBAC(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/auth-mock", nil)
	if status != http.StatusOK {
		t.Fatalf("get auth-mock default expected 200, got %d payload=%v", status, payload)
	}
	if getString(payload, "mode") != "PREBUILT" {
		t.Fatalf("expected default mode PREBUILT, got payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "viewer-auth-mock@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite viewer expected 201, got %d payload=%v", status, payload)
	}

	h.setIdentity("viewer-auth-mock@example.com", "sub-viewer-auth-mock")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("viewer login expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/auth-mock", nil)
	if status != http.StatusForbidden {
		t.Fatalf("viewer auth-mock get expected 403, got %d payload=%v", status, payload)
	}

	h.setIdentity("admin@example.com", "sub-admin")
	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/auth-mock", map[string]any{
		"mode": "UNSUPPORTED",
	})
	if status != http.StatusBadRequest {
		t.Fatalf("invalid mode expected 400, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/auth-mock", map[string]any{
		"mode":       "CUSTOM_EXPR",
		"customExpr": "auth..email",
	})
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("invalid custom expr expected 422, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/auth-mock", map[string]any{
		"mode": "PREBUILT",
		"prebuilt": map[string]any{
			"denyAll":       false,
			"emailContains": "@example.com",
			"emailInList":   []string{"dev@example.com"},
			"requiredHeaders": []map[string]any{
				{
					"name":     "x-api-key",
					"operator": "EQUALS",
					"value":    "abc",
				},
			},
		},
	})
	if status != http.StatusOK {
		t.Fatalf("update auth-mock expected 200, got %d payload=%v", status, payload)
	}
	if getString(payload, "mode") != "PREBUILT" {
		t.Fatalf("updated auth-mock mode mismatch payload=%v", payload)
	}
}

func TestRuntimeNoMatchWithoutFallbackReturns500AndTraffic(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)
	packID := h.defaultPackID(integrationID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+packID+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: runtime-no-match
  version: 1.0.0
paths:
  /orders:
    get:
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("import expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+packID+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("routes expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) == 0 {
		t.Fatalf("expected imported route, payload=%v", payload)
	}
	route, _ := items[0].(map[string]any)
	endpointID := getString(route, "id", "ID")

	status, payload, _ = h.requestRaw(http.MethodGet, "/mock/"+workspaceID+"/"+integrationID+"/orders", nil, nil)
	if status != http.StatusInternalServerError {
		t.Fatalf("runtime no-match expected 500, got %d payload=%v", status, payload)
	}
	if getString(payload, "code", "code") != "NO_MATCH_NO_FALLBACK" {
		t.Fatalf("runtime no-match expected code NO_MATCH_NO_FALLBACK, payload=%v", payload)
	}
	if getString(payload, "matchedScenario", "matched_scenario") != "__no_match__" {
		t.Fatalf("runtime no-match expected matchedScenario __no_match__, payload=%v", payload)
	}
	if getString(payload, "method", "method") != http.MethodGet {
		t.Fatalf("runtime no-match expected method GET, payload=%v", payload)
	}
	if getString(payload, "path", "path") != "/orders" {
		t.Fatalf("runtime no-match expected path /orders, payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+packID+"/endpoints/"+endpointID+"/traffic", nil)
	if status != http.StatusOK {
		t.Fatalf("traffic expected 200, got %d payload=%v", status, payload)
	}
	trafficItems, _ := payload["items"].([]any)
	if len(trafficItems) == 0 {
		t.Fatalf("expected traffic item for no-match request, payload=%v", payload)
	}
	first, _ := trafficItems[0].(map[string]any)
	if getString(first, "matchedScenario", "matched_scenario", "MatchedScenario") != "__no_match__" {
		t.Fatalf("traffic expected matched_scenario __no_match__, payload=%v", first)
	}
	requestSummary := getString(first, "requestSummaryJson", "request_summary_json", "RequestSummaryJSON")
	var summary map[string]any
	if err := json.Unmarshal([]byte(requestSummary), &summary); err != nil {
		t.Fatalf("decode request_summary_json: %v summary=%s", err, requestSummary)
	}
	if summary["status"] != "500 Internal Server Error" {
		t.Fatalf("expected summary status 500 Internal Server Error, summary=%v", summary)
	}
	if summary["scenario"] != "__no_match__" {
		t.Fatalf("expected summary scenario __no_match__, summary=%v", summary)
	}
}

func TestRuntimeMockExecutionAuthAndMutationsFlow(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Runtime Users",
		"slug": "runtime-users",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")

	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"runtime-users.json",
		[]byte(`[{"id":"usr-1","email":"alpha@example.com","status":"ACTIVE"}]`),
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("baseline expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: runtime-e2e
  version: 1.0.0
paths:
  /users/apply:
    post:
      responses:
        "201":
          description: created
`,
	})
	if status != http.StatusOK {
		t.Fatalf("import expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("routes expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	if len(items) == 0 {
		t.Fatalf("expected imported route, payload=%v", payload)
	}
	route, _ := items[0].(map[string]any)
	endpointID := getString(route, "id", "ID")

	scenariosJSON := `[{
		"name": "Apply User",
		"priority": 10,
		"conditionExpr": "true",
		"response": {
			"statusCode": 201,
			"delayMs": 0,
			"headers": {"Content-Type":"application/json"},
			"body": {"ok": true}
		},
		"mutations": [{
			"type": "UPSERT",
			"sourceSlug": "runtime-users",
			"entityIdExpr": "request.body.id",
			"payloadExpr": "request.body"
		}]
	}]`
	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/scenarios", map[string]any{
		"scenarios": scenariosJSON,
	})
	if status != http.StatusNoContent {
		t.Fatalf("update scenarios expected 204, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID), map[string]any{
		"authEnabled": true,
		"authPolicy": map[string]any{
			"mode": "PREBUILT",
			"prebuilt": map[string]any{
				"emailInList": []string{"dev@example.com"},
				"requiredHeaders": []map[string]any{
					{"name": "x-api-key", "operator": "EQUALS", "value": "abc"},
				},
			},
		},
	})
	if status != http.StatusOK {
		t.Fatalf("pack auth update expected 200, got %d payload=%v", status, payload)
	}

	allowToken := buildTestJWT(map[string]any{
		"email": "dev@example.com",
		"iss":   "https://mock-issuer.local",
	}, "sig")

	status, payload, _ = h.requestRaw(http.MethodPost, "/mock/"+workspaceID+"/"+integrationID+"/users/apply", []byte(`{"id":"usr-2","email":"dev@example.com","status":"PENDING"}`), map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + allowToken,
		"x-api-key":     "abc",
	})
	if status != http.StatusCreated {
		t.Fatalf("runtime allow expected 201, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.requestRaw(http.MethodPost, "/mock/"+workspaceID+"/"+integrationID+"/users/apply", []byte(`{"id":"usr-3","email":"dev@example.com"}`), map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + allowToken,
	})
	if status != http.StatusForbidden {
		t.Fatalf("runtime missing header expected 403, got %d payload=%v", status, payload)
	}

	denyToken := buildTestJWT(map[string]any{"email": "blocked@example.com"}, "sig")
	status, payload, _ = h.requestRaw(http.MethodPost, "/mock/"+workspaceID+"/"+integrationID+"/users/apply", []byte(`{"id":"usr-4","email":"blocked@example.com"}`), map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + denyToken,
		"x-api-key":     "abc",
	})
	if status != http.StatusForbidden {
		t.Fatalf("runtime email deny expected 403, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities?search=usr-2", nil)
	if status != http.StatusOK {
		t.Fatalf("entities expected 200, got %d payload=%v", status, payload)
	}
	filtered, _ := payload["items"].([]any)
	if len(filtered) != 1 {
		t.Fatalf("expected mutated entity in projection, payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/usr-2/timeline", nil)
	if status != http.StatusOK {
		t.Fatalf("timeline expected 200, got %d payload=%v", status, payload)
	}
	timelineItems, _ := payload["items"].([]any)
	foundRuntimeUpsert := false
	for _, raw := range timelineItems {
		event, _ := raw.(map[string]any)
		if getString(event, "action", "Action") == "RUNTIME_UPSERT" {
			foundRuntimeUpsert = true
			break
		}
	}
	if !foundRuntimeUpsert {
		t.Fatalf("expected RUNTIME_UPSERT event in timeline payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/scenarios", map[string]any{
		"scenarios": `[{
			"name":"Invalid Mutation",
			"priority":10,
			"conditionExpr":"true",
			"response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}},
			"mutations":[{"type":"UPSERT","sourceSlug":"runtime-users","entityIdExpr":"request.body.id","payloadExpr":"'invalid'"}]
		}]`,
	})
	if status != http.StatusNoContent {
		t.Fatalf("update invalid mutation scenario expected 204, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.requestRaw(http.MethodPost, "/mock/"+workspaceID+"/"+integrationID+"/users/apply", []byte(`{"id":"usr-5","email":"dev@example.com"}`), map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + allowToken,
		"x-api-key":     "abc",
	})
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("runtime invalid mutation expected 422, got %d payload=%v", status, payload)
	}
}

func TestRuntimeAuthMockCustomExprAndOIDCSignatureDenial(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: runtime-auth
  version: 1.0.0
paths:
  /auth/check:
    get:
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("import expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("routes expected 200, got %d payload=%v", status, payload)
	}
	items, _ := payload["items"].([]any)
	route, _ := items[0].(map[string]any)
	endpointID := getString(route, "id", "ID")

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/scenarios", map[string]any{
		"scenarios": `[{"name":"ok","priority":10,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}}}]`,
	})
	if status != http.StatusNoContent {
		t.Fatalf("update scenarios expected 204, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID), map[string]any{
		"authEnabled": true,
		"authPolicy": map[string]any{
			"mode":       "CUSTOM_EXPR",
			"customExpr": "auth.email == 'expr@example.com' && request.header['x-api-key'] == 'abc'",
		},
	})
	if status != http.StatusOK {
		t.Fatalf("custom expr pack auth update expected 200, got %d payload=%v", status, payload)
	}

	exprToken := buildTestJWT(map[string]any{"email": "expr@example.com"}, "sig")
	status, payload, _ = h.requestRaw(http.MethodGet, "/mock/"+workspaceID+"/"+integrationID+"/auth/check", nil, map[string]string{
		"Authorization": "Bearer " + exprToken,
		"x-api-key":     "abc",
	})
	if status != http.StatusOK {
		t.Fatalf("custom expr allow expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.requestRaw(http.MethodGet, "/mock/"+workspaceID+"/"+integrationID+"/auth/check", nil, map[string]string{
		"Authorization": "Bearer " + exprToken,
		"x-api-key":     "wrong",
	})
	if status != http.StatusForbidden {
		t.Fatalf("custom expr deny expected 403, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID), map[string]any{
		"authEnabled": true,
		"authPolicy": map[string]any{
			"mode": "PREBUILT",
			"prebuilt": map[string]any{
				"oidc": map[string]any{
					"issuer":     "https://mock-issuer.local",
					"emailClaim": "email",
				},
			},
		},
	})
	if status != http.StatusOK {
		t.Fatalf("oidc prebuilt pack auth update expected 200, got %d payload=%v", status, payload)
	}

	invalidSignatureToken := buildTestJWT(map[string]any{
		"email": "expr@example.com",
		"iss":   "https://mock-issuer.local",
	}, "invalid")
	status, payload, _ = h.requestRaw(http.MethodGet, "/mock/"+workspaceID+"/"+integrationID+"/auth/check", nil, map[string]string{
		"Authorization": "Bearer " + invalidSignatureToken,
	})
	if status != http.StatusUnauthorized {
		t.Fatalf("invalid oidc signature expected 401, got %d payload=%v", status, payload)
	}
}

func TestDataSourceRollbackCompleteFlowAndRBAC(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Rollback Source",
		"slug": "rollback-source",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")

	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"rollback-source.json",
		[]byte(`[{"id":"ent-1","name":"alpha","status":"ACTIVE"},{"id":"ent-2","name":"beta","status":"ACTIVE"}]`),
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("baseline expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities", map[string]any{
		"entityId": "ent-1",
		"payload": map[string]any{
			"id":     "ent-1",
			"name":   "alpha-updated",
			"status": "LOCKED",
		},
	})
	if status != http.StatusOK {
		t.Fatalf("update entity expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities", map[string]any{
		"entityId": "ent-3",
		"payload": map[string]any{
			"id":     "ent-3",
			"name":   "gamma",
			"status": "ACTIVE",
		},
	})
	if status != http.StatusOK {
		t.Fatalf("create entity expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "viewer-rollback-complete@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite viewer expected 201, got %d payload=%v", status, payload)
	}
	h.setIdentity("viewer-rollback-complete@example.com", "sub-viewer-rollback-complete")
	status, payload, _ = h.request(http.MethodGet, "/api/v1/auth/me", nil)
	if status != http.StatusOK {
		t.Fatalf("viewer login expected 200, got %d payload=%v", status, payload)
	}
	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/rollback-complete", nil)
	if status != http.StatusForbidden {
		t.Fatalf("viewer rollback-complete expected 403, got %d payload=%v", status, payload)
	}

	h.setIdentity("admin@example.com", "sub-admin")
	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/rollback-complete", nil)
	if status != http.StatusOK {
		t.Fatalf("rollback-complete expected 200, got %d payload=%v", status, payload)
	}
	if getNumber(payload, "removedEntities", "removed_entities") < 1 {
		t.Fatalf("rollback-complete expected removed entities, payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities?sort=entity_asc", nil)
	if status != http.StatusOK {
		t.Fatalf("entities expected 200, got %d payload=%v", status, payload)
	}
	entityRows, _ := payload["items"].([]any)
	if len(entityRows) != 2 {
		t.Fatalf("expected baseline entity count after rollback complete, got %d payload=%v", len(entityRows), payload)
	}

	status, payload, _ = h.request(
		http.MethodGet,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities/ent-3/timeline",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("ent-3 timeline expected 200, got %d payload=%v", status, payload)
	}
	timelineItems, _ := payload["items"].([]any)
	foundDeleteCompensation := false
	for _, raw := range timelineItems {
		event, _ := raw.(map[string]any)
		if getString(event, "action", "Action") == "ROLLBACK_DELETE_COMPENSATION" {
			foundDeleteCompensation = true
			break
		}
	}
	if !foundDeleteCompensation {
		t.Fatalf("expected delete compensation event payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "No Baseline",
		"slug": "no-baseline",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create no-baseline source expected 201, got %d payload=%v", status, payload)
	}
	noBaselineSourceID := getString(payload, "id", "ID")

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources/"+noBaselineSourceID+"/rollback-complete", nil)
	if status != http.StatusNotFound {
		t.Fatalf("rollback-complete without baseline expected 404, got %d payload=%v", status, payload)
	}
}

func TestObservabilityAuditAndEntityMapEndpoints(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources", map[string]any{
		"name": "Audit Source",
		"slug": "audit-source",
		"kind": "JSON",
	})
	if status != http.StatusCreated {
		t.Fatalf("create source expected 201, got %d payload=%v", status, payload)
	}
	sourceID := getString(payload, "id", "ID")

	status, payload, _ = h.multipartRequest(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/baseline",
		"file",
		"audit.json",
		[]byte(`[{"id":"map-1","status":"ACTIVE"}]`),
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("baseline upload expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/data-sources/"+sourceID+"/entities", map[string]any{
		"entityId": "map-2",
		"payload": map[string]any{
			"id":     "map-2",
			"status": "LOCKED",
		},
	})
	if status != http.StatusOK {
		t.Fatalf("create entity expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/entity-map?search=map", nil)
	if status != http.StatusOK {
		t.Fatalf("entity-map expected 200, got %d payload=%v", status, payload)
	}
	mapItems, _ := payload["items"].([]any)
	if len(mapItems) == 0 {
		t.Fatalf("expected entity-map rows, got payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/audit-events?resourceType=DATA_SOURCE", nil)
	if status != http.StatusOK {
		t.Fatalf("audit-events expected 200, got %d payload=%v", status, payload)
	}
	auditItems, _ := payload["items"].([]any)
	if len(auditItems) == 0 {
		t.Fatalf("expected audit events for DATA_SOURCE, got payload=%v", payload)
	}
}

func TestEndpointValidateRevisionsAndRestoreFlow(t *testing.T) {
	h := newTestHarness(t, 0)
	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()
	integrationID := h.createIntegration(workspaceID)

	status, payload, _ := h.request(http.MethodPost, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/imports", map[string]any{
		"sourceType": "OPENAPI",
		"payload": `openapi: 3.0.3
info:
  title: revisions
  version: 1.0.0
paths:
  /orders:
    get:
      responses:
        "200":
          description: ok
`,
	})
	if status != http.StatusOK {
		t.Fatalf("import expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("routes expected 200, got %d payload=%v", status, payload)
	}
	routeItems, _ := payload["items"].([]any)
	firstRoute, _ := routeItems[0].(map[string]any)
	endpointID := getString(firstRoute, "id", "ID")
	if endpointID == "" {
		t.Fatalf("endpoint id missing in payload=%v", firstRoute)
	}

	status, payload, _ = h.request(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/validate",
		map[string]any{
			"contract": `{"type":"wat"}`,
		},
	)
	if status != http.StatusOK {
		t.Fatalf("validate expected 200, got %d payload=%v", status, payload)
	}
	if valid, _ := payload["valid"].(bool); valid {
		t.Fatalf("expected invalid validation result payload=%v", payload)
	}
	validateIssues, _ := payload["issues"].([]any)
	if len(validateIssues) == 0 {
		t.Fatalf("expected validation issues payload=%v", payload)
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/contract", map[string]any{
		"contract": `{"type":"object","properties":{"id":{"type":"string"}}}`,
	})
	if status != http.StatusNoContent {
		t.Fatalf("update contract expected 204, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPut, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/scenarios", map[string]any{
		"scenarios": `[{"name":"ok","priority":10,"conditionExpr":"true","response":{"statusCode":200,"delayMs":0,"headers":{"Content-Type":"application/json"},"body":{"ok":true}}}]`,
	})
	if status != http.StatusNoContent {
		t.Fatalf("update scenarios expected 204, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/revisions?limit=20", nil)
	if status != http.StatusOK {
		t.Fatalf("revisions expected 200, got %d payload=%v", status, payload)
	}
	revisionItems, _ := payload["items"].([]any)
	if len(revisionItems) == 0 {
		t.Fatalf("expected revisions after updates, got payload=%v", payload)
	}
	firstRevision, _ := revisionItems[0].(map[string]any)
	revisionID := getString(firstRevision, "id", "ID")
	if revisionID == "" {
		t.Fatalf("revision id missing payload=%v", firstRevision)
	}

	status, payload, _ = h.request(
		http.MethodPost,
		"/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/endpoints/"+endpointID+"/revisions/"+revisionID+"/restore",
		nil,
	)
	if status != http.StatusOK {
		t.Fatalf("restore revision expected 200, got %d payload=%v", status, payload)
	}
	if getString(payload, "endpointId", "endpoint_id") != endpointID {
		t.Fatalf("restore payload endpoint id mismatch payload=%v", payload)
	}
	if getString(payload, "revisionId", "revision_id") == "" {
		t.Fatalf("restore payload revision id missing payload=%v", payload)
	}
}

func TestRegressionCorePathsRemainFunctional(t *testing.T) {
	h := newTestHarness(t, 0)

	status, payload, _ := h.request(http.MethodGet, "/api/v1/auth/config", nil)
	if status != http.StatusOK {
		t.Fatalf("auth config expected 200, got %d payload=%v", status, payload)
	}

	h.bootstrapAdmin()
	workspaceID := h.createWorkspace()

	status, payload, _ = h.request(http.MethodGet, "/api/v1/workspaces", nil)
	if status != http.StatusOK {
		t.Fatalf("list workspaces expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/workspaces/"+workspaceID, nil)
	if status != http.StatusOK {
		t.Fatalf("get workspace expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/workspaces/"+workspaceID, map[string]any{
		"name": "Workspace B",
	})
	if status != http.StatusOK {
		t.Fatalf("patch workspace expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/members/invitations", map[string]any{
		"email": "viewer@example.com",
		"role":  "VIEWER",
	})
	if status != http.StatusCreated {
		t.Fatalf("invite member expected 201, got %d payload=%v", status, payload)
	}
	memberID := getString(payload, "id", "ID")
	if memberID == "" {
		t.Fatal("member id missing")
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/members", nil)
	if status != http.StatusOK {
		t.Fatalf("list members expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/workspaces/"+workspaceID+"/members/"+memberID+"/role", map[string]any{
		"role": "ADMIN",
	})
	if status != http.StatusNoContent {
		t.Fatalf("update member role expected 204, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/workspaces/"+workspaceID+"/members/"+memberID+"/status", map[string]any{
		"status": "ACTIVE",
	})
	if status != http.StatusNoContent {
		t.Fatalf("update member status expected 204, got %d payload=%v", status, payload)
	}

	integrationID := h.createIntegration(workspaceID)

	status, payload, _ = h.request(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/integrations", nil)
	if status != http.StatusOK {
		t.Fatalf("list integrations expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/overview", nil)
	if status != http.StatusOK {
		t.Fatalf("get overview expected 200, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodPatch, "/api/v1/integrations/"+integrationID+"/auth", map[string]any{
		"authMode": "API_KEY",
	})
	if status != http.StatusNoContent {
		t.Fatalf("patch integration auth expected 204, got %d payload=%v", status, payload)
	}

	status, payload, _ = h.request(http.MethodGet, "/api/v1/integrations/"+integrationID+"/packs/"+h.defaultPackID(integrationID)+"/routes", nil)
	if status != http.StatusOK {
		t.Fatalf("get routes expected 200, got %d payload=%v", status, payload)
	}
}
