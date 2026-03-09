package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
	"github.com/rendis/mock-loom/apps/api/internal/core/ports"
)

type txContextKey struct{}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// TxManager manages SQL transactions.
type TxManager struct {
	db *DBRef
}

// NewTxManager returns TxManager.
func NewTxManager(db *DBRef) *TxManager {
	return &TxManager{db: db}
}

// WithTx executes fn in transaction context.
func (m *TxManager) WithTx(ctx context.Context, fn func(ctx context.Context) error) error {
	tx, err := m.db.Get().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	txCtx := context.WithValue(ctx, txContextKey{}, tx)
	if err := fn(txCtx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// UserRepository implements user persistence.
type UserRepository struct {
	db *DBRef
}

// NewUserRepository returns UserRepository.
func NewUserRepository(db *DBRef) *UserRepository {
	return &UserRepository{db: db}
}

// Count returns total user count.
func (r *UserRepository) Count(ctx context.Context) (int, error) {
	var count int
	err := executor(ctx, r.db).QueryRowContext(ctx, `SELECT COUNT(1) FROM identity_users`).Scan(&count)
	return count, err
}

// FindByEmail returns user by email.
func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*entity.User, error) {
	q := `
		SELECT id, email, external_identity_id, full_name, status, created_at, updated_at
		FROM identity_users
		WHERE email = ?
	`
	return scanSingleUser(executor(ctx, r.db).QueryRowContext(ctx, q, strings.ToLower(strings.TrimSpace(email))))
}

// FindByID returns user by ID.
func (r *UserRepository) FindByID(ctx context.Context, id string) (*entity.User, error) {
	q := `
		SELECT id, email, external_identity_id, full_name, status, created_at, updated_at
		FROM identity_users
		WHERE id = ?
	`
	return scanSingleUser(executor(ctx, r.db).QueryRowContext(ctx, q, id))
}

// Create inserts user.
func (r *UserRepository) Create(ctx context.Context, user *entity.User) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO identity_users (id, email, external_identity_id, full_name, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, user.ID, strings.ToLower(strings.TrimSpace(user.Email)), nullableString(user.ExternalIdentityID), user.FullName, user.Status, toRFC3339(user.CreatedAt), toRFC3339(user.UpdatedAt))
	return mapSQLError(err)
}

// ActivateAndLink updates invited user as active and links external identity.
func (r *UserRepository) ActivateAndLink(ctx context.Context, userID, externalID string, activatedAt time.Time) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE identity_users
		SET external_identity_id = ?, status = 'ACTIVE', updated_at = ?
		WHERE id = ?
	`, externalID, toRFC3339(activatedAt), userID)
	return err
}

// SystemRoleRepository implements system role persistence.
type SystemRoleRepository struct {
	db *DBRef
}

// NewSystemRoleRepository returns SystemRoleRepository.
func NewSystemRoleRepository(db *DBRef) *SystemRoleRepository {
	return &SystemRoleRepository{db: db}
}

// FindByUserID returns role assignment by user.
func (r *SystemRoleRepository) FindByUserID(ctx context.Context, userID string) (*entity.SystemRoleAssignment, error) {
	var role entity.SystemRoleAssignment
	var grantedBy sql.NullString
	var createdAt string
	err := executor(ctx, r.db).QueryRowContext(ctx, `
		SELECT user_id, role, granted_by, created_at
		FROM identity_system_roles
		WHERE user_id = ?
	`, userID).Scan(&role.UserID, &role.Role, &grantedBy, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ports.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if grantedBy.Valid {
		v := grantedBy.String
		role.GrantedBy = &v
	}
	role.CreatedAt = parseTime(createdAt)
	return &role, nil
}

// Upsert creates or updates assignment.
func (r *SystemRoleRepository) Upsert(ctx context.Context, role *entity.SystemRoleAssignment) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO identity_system_roles (user_id, role, granted_by, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by
	`, role.UserID, role.Role, nullableString(role.GrantedBy), toRFC3339(role.CreatedAt))
	return err
}

// WorkspaceRepository implements workspace persistence.
type WorkspaceRepository struct {
	db *DBRef
}

// NewWorkspaceRepository returns WorkspaceRepository.
func NewWorkspaceRepository(db *DBRef) *WorkspaceRepository {
	return &WorkspaceRepository{db: db}
}

// ListAllActive returns active workspaces.
func (r *WorkspaceRepository) ListAllActive(ctx context.Context) ([]*entity.Workspace, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, name, slug, description, metadata_json, status, created_at, updated_at
		FROM core_workspaces
		WHERE status = 'ACTIVE'
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanWorkspaces(rows)
}

// ListByUser returns active workspaces where user has active membership.
func (r *WorkspaceRepository) ListByUser(ctx context.Context, userID string) ([]*entity.Workspace, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT w.id, w.name, w.slug, w.description, w.metadata_json, w.status, w.created_at, w.updated_at
		FROM core_workspaces w
		JOIN identity_workspace_members m ON m.workspace_id = w.id
		WHERE m.user_id = ? AND m.membership_status = 'ACTIVE' AND w.status = 'ACTIVE'
		ORDER BY w.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanWorkspaces(rows)
}

// FindByID returns workspace by ID.
func (r *WorkspaceRepository) FindByID(ctx context.Context, id string) (*entity.Workspace, error) {
	var workspace entity.Workspace
	var createdAt string
	var updatedAt string
	err := executor(ctx, r.db).QueryRowContext(ctx, `
		SELECT id, name, slug, description, metadata_json, status, created_at, updated_at
		FROM core_workspaces
		WHERE id = ?
	`, id).Scan(&workspace.ID, &workspace.Name, &workspace.Slug, &workspace.Description, &workspace.MetadataJSON, &workspace.Status, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ports.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	workspace.CreatedAt = parseTime(createdAt)
	workspace.UpdatedAt = parseTime(updatedAt)
	return &workspace, nil
}

// Create inserts workspace.
func (r *WorkspaceRepository) Create(ctx context.Context, workspace *entity.Workspace) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO core_workspaces (id, name, slug, description, metadata_json, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, workspace.ID, workspace.Name, workspace.Slug, workspace.Description, workspace.MetadataJSON, workspace.Status, toRFC3339(workspace.CreatedAt), toRFC3339(workspace.UpdatedAt))
	return mapSQLError(err)
}

// Update updates workspace mutable fields.
func (r *WorkspaceRepository) Update(ctx context.Context, workspace *entity.Workspace) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE core_workspaces
		SET name = ?, slug = ?, description = ?, metadata_json = ?, updated_at = ?
		WHERE id = ?
	`, workspace.Name, workspace.Slug, workspace.Description, workspace.MetadataJSON, toRFC3339(workspace.UpdatedAt), workspace.ID)
	return mapSQLError(err)
}

// Archive sets workspace archived.
func (r *WorkspaceRepository) Archive(ctx context.Context, workspaceID string, updatedAt time.Time) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE core_workspaces
		SET status = 'ARCHIVED', updated_at = ?
		WHERE id = ?
	`, toRFC3339(updatedAt), workspaceID)
	return err
}

// WorkspaceMemberRepository implements workspace member persistence.
type WorkspaceMemberRepository struct {
	db *DBRef
}

// NewWorkspaceMemberRepository returns WorkspaceMemberRepository.
func NewWorkspaceMemberRepository(db *DBRef) *WorkspaceMemberRepository {
	return &WorkspaceMemberRepository{db: db}
}

// ListByWorkspace lists members for workspace.
func (r *WorkspaceMemberRepository) ListByWorkspace(ctx context.Context, workspaceID string) ([]*entity.WorkspaceMember, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, workspace_id, user_id, role, membership_status, invited_by, joined_at, created_at
		FROM identity_workspace_members
		WHERE workspace_id = ?
		ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMembers(rows)
}

// FindByID returns member by id.
func (r *WorkspaceMemberRepository) FindByID(ctx context.Context, id string) (*entity.WorkspaceMember, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, workspace_id, user_id, role, membership_status, invited_by, joined_at, created_at
		FROM identity_workspace_members
		WHERE id = ?
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members, err := scanMembers(rows)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, ports.ErrNotFound
	}
	return members[0], nil
}

// FindByUserAndWorkspace returns membership by user/workspace.
func (r *WorkspaceMemberRepository) FindByUserAndWorkspace(ctx context.Context, userID, workspaceID string) (*entity.WorkspaceMember, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, workspace_id, user_id, role, membership_status, invited_by, joined_at, created_at
		FROM identity_workspace_members
		WHERE user_id = ? AND workspace_id = ?
	`, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members, err := scanMembers(rows)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, ports.ErrNotFound
	}
	return members[0], nil
}

// FindActiveByUserAndWorkspace returns active membership by user/workspace.
func (r *WorkspaceMemberRepository) FindActiveByUserAndWorkspace(ctx context.Context, userID, workspaceID string) (*entity.WorkspaceMember, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, workspace_id, user_id, role, membership_status, invited_by, joined_at, created_at
		FROM identity_workspace_members
		WHERE user_id = ? AND workspace_id = ? AND membership_status = 'ACTIVE'
	`, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members, err := scanMembers(rows)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, ports.ErrNotFound
	}
	return members[0], nil
}

// Create inserts member.
func (r *WorkspaceMemberRepository) Create(ctx context.Context, member *entity.WorkspaceMember) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO identity_workspace_members (id, workspace_id, user_id, role, membership_status, invited_by, joined_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, member.ID, member.WorkspaceID, member.UserID, member.Role, member.MembershipStatus, nullableString(member.InvitedBy), nullableTime(member.JoinedAt), toRFC3339(member.CreatedAt))
	return mapSQLError(err)
}

// ActivatePendingByUser sets all pending memberships active for user.
func (r *WorkspaceMemberRepository) ActivatePendingByUser(ctx context.Context, userID string, joinedAt time.Time) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE identity_workspace_members
		SET membership_status = 'ACTIVE', joined_at = ?
		WHERE user_id = ? AND membership_status = 'PENDING'
	`, toRFC3339(joinedAt), userID)
	return err
}

// UpdateRole updates member role.
func (r *WorkspaceMemberRepository) UpdateRole(ctx context.Context, memberID string, role entity.WorkspaceRole) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `UPDATE identity_workspace_members SET role = ? WHERE id = ?`, role, memberID)
	return err
}

// UpdateStatus updates member status.
func (r *WorkspaceMemberRepository) UpdateStatus(ctx context.Context, memberID string, status entity.MembershipStatus, joinedAt *time.Time) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE identity_workspace_members
		SET membership_status = ?, joined_at = COALESCE(?, joined_at)
		WHERE id = ?
	`, status, nullableTime(joinedAt), memberID)
	return err
}

// IntegrationRepository implements integration persistence.
type IntegrationRepository struct {
	db *DBRef
}

// NewIntegrationRepository returns IntegrationRepository.
func NewIntegrationRepository(db *DBRef) *IntegrationRepository {
	return &IntegrationRepository{db: db}
}

// ListByWorkspace lists integrations for workspace.
func (r *IntegrationRepository) ListByWorkspace(ctx context.Context, workspaceID string) ([]*entity.Integration, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, workspace_id, name, slug, base_url, auth_mode, status, created_at, updated_at
		FROM core_integrations
		WHERE workspace_id = ?
		ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanIntegrations(rows)
}

// FindByID returns integration by id.
func (r *IntegrationRepository) FindByID(ctx context.Context, id string) (*entity.Integration, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, workspace_id, name, slug, base_url, auth_mode, status, created_at, updated_at
		FROM core_integrations
		WHERE id = ?
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanIntegrations(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ports.ErrNotFound
	}
	return items[0], nil
}

// Create inserts integration.
func (r *IntegrationRepository) Create(ctx context.Context, integration *entity.Integration) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO core_integrations (id, workspace_id, name, slug, base_url, auth_mode, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, integration.ID, integration.WorkspaceID, integration.Name, integration.Slug, integration.BaseURL, integration.AuthMode, integration.Status, toRFC3339(integration.CreatedAt), toRFC3339(integration.UpdatedAt))
	return mapSQLError(err)
}

// UpdateAuthMode updates auth mode.
func (r *IntegrationRepository) UpdateAuthMode(ctx context.Context, integrationID, authMode string, updatedAt time.Time) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE core_integrations
		SET auth_mode = ?, updated_at = ?
		WHERE id = ?
	`, authMode, toRFC3339(updatedAt), integrationID)
	return err
}

// ListPacksByIntegration lists packs for one integration.
func (r *IntegrationRepository) ListPacksByIntegration(ctx context.Context, integrationID string) ([]*entity.IntegrationPack, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, name, slug, base_path, status, auth_enabled, auth_policy_json, created_at, updated_at
		FROM core_integration_packs
		WHERE integration_id = ?
		ORDER BY created_at DESC
	`, integrationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanIntegrationPacks(rows)
}

// FindPackByID returns one pack by integration and id.
func (r *IntegrationRepository) FindPackByID(ctx context.Context, integrationID, packID string) (*entity.IntegrationPack, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, name, slug, base_path, status, auth_enabled, auth_policy_json, created_at, updated_at
		FROM core_integration_packs
		WHERE integration_id = ? AND id = ?
		LIMIT 1
	`, integrationID, packID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanIntegrationPacks(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ports.ErrNotFound
	}
	return items[0], nil
}

// CreatePack creates one integration pack.
func (r *IntegrationRepository) CreatePack(ctx context.Context, pack *entity.IntegrationPack) error {
	authEnabled := 0
	if pack.AuthEnabled {
		authEnabled = 1
	}
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO core_integration_packs (
			id,
			integration_id,
			name,
			slug,
			base_path,
			status,
			auth_enabled,
			auth_policy_json,
			created_at,
			updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		pack.ID,
		pack.IntegrationID,
		pack.Name,
		pack.Slug,
		pack.BasePath,
		pack.Status,
		authEnabled,
		pack.AuthPolicyJSON,
		toRFC3339(pack.CreatedAt),
		toRFC3339(pack.UpdatedAt),
	)
	return mapSQLError(err)
}

// UpdatePack updates one integration pack.
func (r *IntegrationRepository) UpdatePack(ctx context.Context, pack *entity.IntegrationPack) error {
	authEnabled := 0
	if pack.AuthEnabled {
		authEnabled = 1
	}
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE core_integration_packs
		SET
			name = ?,
			slug = ?,
			base_path = ?,
			status = ?,
			auth_enabled = ?,
			auth_policy_json = ?,
			updated_at = ?
		WHERE integration_id = ? AND id = ?
	`,
		pack.Name,
		pack.Slug,
		pack.BasePath,
		pack.Status,
		authEnabled,
		pack.AuthPolicyJSON,
		toRFC3339(pack.UpdatedAt),
		pack.IntegrationID,
		pack.ID,
	)
	return mapSQLError(err)
}

// FindAuthMockPolicy returns persisted auth mock policy for one integration.
func (r *IntegrationRepository) FindAuthMockPolicy(ctx context.Context, integrationID string) (*entity.AuthMockPolicy, error) {
	var mode string
	var prebuiltJSON string
	var customExpr string
	var updatedAt string
	err := executor(ctx, r.db).QueryRowContext(ctx, `
		SELECT mode, prebuilt_json, custom_expr, updated_at
		FROM core_integration_auth_mock_policies
		WHERE integration_id = ?
		LIMIT 1
	`, integrationID).Scan(&mode, &prebuiltJSON, &customExpr, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ports.ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	policy := &entity.AuthMockPolicy{
		IntegrationID: integrationID,
		Mode:          entity.AuthMockPolicyMode(strings.ToUpper(strings.TrimSpace(mode))),
		CustomExpr:    strings.TrimSpace(customExpr),
		UpdatedAt:     parseTime(updatedAt),
	}
	if policy.Mode == "" {
		policy.Mode = entity.AuthMockPolicyModePrebuilt
	}

	if strings.TrimSpace(prebuiltJSON) != "" {
		if err := json.Unmarshal([]byte(prebuiltJSON), &policy.Prebuilt); err != nil {
			return nil, err
		}
	}

	return policy, nil
}

// UpsertAuthMockPolicy stores or updates integration auth mock policy.
func (r *IntegrationRepository) UpsertAuthMockPolicy(ctx context.Context, policy *entity.AuthMockPolicy) error {
	prebuiltJSON, err := json.Marshal(policy.Prebuilt)
	if err != nil {
		return err
	}
	_, err = executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO core_integration_auth_mock_policies (
			integration_id,
			mode,
			prebuilt_json,
			custom_expr,
			updated_at
		)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(integration_id) DO UPDATE SET
			mode = excluded.mode,
			prebuilt_json = excluded.prebuilt_json,
			custom_expr = excluded.custom_expr,
			updated_at = excluded.updated_at
	`,
		policy.IntegrationID,
		policy.Mode,
		string(prebuiltJSON),
		strings.TrimSpace(policy.CustomExpr),
		toRFC3339(policy.UpdatedAt),
	)
	return err
}

// EndpointRepository implements endpoint persistence.
type EndpointRepository struct {
	db *DBRef
}

// NewEndpointRepository returns EndpointRepository.
func NewEndpointRepository(db *DBRef) *EndpointRepository {
	return &EndpointRepository{db: db}
}

// FindByID returns endpoint by integration/id.
func (r *EndpointRepository) FindByID(ctx context.Context, integrationID, endpointID string) (*entity.IntegrationEndpoint, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, pack_id, method, path, auth_mode, auth_override_policy_json, contract_json, scenarios_json, created_at, updated_at
		FROM core_integration_endpoints
		WHERE integration_id = ? AND id = ?
		LIMIT 1
	`, integrationID, endpointID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanEndpoints(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ports.ErrNotFound
	}
	return items[0], nil
}

// FindByMethodPath returns endpoint.
func (r *EndpointRepository) FindByMethodPath(ctx context.Context, integrationID, method, path string) (*entity.IntegrationEndpoint, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, pack_id, method, path, auth_mode, auth_override_policy_json, contract_json, scenarios_json, created_at, updated_at
		FROM core_integration_endpoints
		WHERE integration_id = ? AND method = ? AND path = ?
	`, integrationID, method, path)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanEndpoints(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ports.ErrNotFound
	}
	return items[0], nil
}

// UpsertEndpoint inserts or updates endpoint.
func (r *EndpointRepository) UpsertEndpoint(ctx context.Context, endpoint *entity.IntegrationEndpoint) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO core_integration_endpoints (
			id,
			integration_id,
			pack_id,
			method,
			path,
			auth_mode,
			auth_override_policy_json,
			contract_json,
			scenarios_json,
			created_at,
			updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(integration_id, method, path) DO UPDATE SET
			pack_id = excluded.pack_id,
			auth_mode = excluded.auth_mode,
			auth_override_policy_json = excluded.auth_override_policy_json,
			contract_json = excluded.contract_json,
			scenarios_json = excluded.scenarios_json,
			updated_at = excluded.updated_at
	`,
		endpoint.ID,
		endpoint.IntegrationID,
		endpoint.PackID,
		endpoint.Method,
		endpoint.Path,
		endpoint.AuthMode,
		endpoint.AuthOverridePolicyJSON,
		endpoint.ContractJSON,
		endpoint.ScenariosJSON,
		toRFC3339(endpoint.CreatedAt),
		toRFC3339(endpoint.UpdatedAt),
	)
	return err
}

// UpdateEndpointRoute updates endpoint method/path identity by endpoint id.
func (r *EndpointRepository) UpdateEndpointRoute(ctx context.Context, endpoint *entity.IntegrationEndpoint) error {
	result, err := executor(ctx, r.db).ExecContext(ctx, `
		UPDATE core_integration_endpoints
		SET
			method = ?,
			path = ?,
			updated_at = ?
		WHERE integration_id = ? AND pack_id = ? AND id = ?
	`,
		endpoint.Method,
		endpoint.Path,
		toRFC3339(endpoint.UpdatedAt),
		endpoint.IntegrationID,
		endpoint.PackID,
		endpoint.ID,
	)
	if err != nil {
		return mapSQLError(err)
	}
	affected, affectedErr := result.RowsAffected()
	if affectedErr == nil && affected == 0 {
		return ports.ErrNotFound
	}
	return nil
}

// ListRoutes returns all endpoints for integration.
func (r *EndpointRepository) ListRoutes(ctx context.Context, integrationID string) ([]*entity.IntegrationEndpoint, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, pack_id, method, path, auth_mode, auth_override_policy_json, contract_json, scenarios_json, created_at, updated_at
		FROM core_integration_endpoints
		WHERE integration_id = ?
		ORDER BY pack_id, method, path
	`, integrationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEndpoints(rows)
}

// ListRoutesByPack returns all endpoints for one integration pack.
func (r *EndpointRepository) ListRoutesByPack(ctx context.Context, integrationID, packID string) ([]*entity.IntegrationEndpoint, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, pack_id, method, path, auth_mode, auth_override_policy_json, contract_json, scenarios_json, created_at, updated_at
		FROM core_integration_endpoints
		WHERE integration_id = ? AND pack_id = ?
		ORDER BY method, path
	`, integrationID, packID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEndpoints(rows)
}

// ListTraffic returns recent traffic records.
func (r *EndpointRepository) ListTraffic(ctx context.Context, integrationID string, limit int) ([]*entity.TrafficEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, endpoint_id, request_summary_json, matched_scenario, created_at
		FROM core_integration_traffic
		WHERE integration_id = ?
		ORDER BY created_at DESC
		LIMIT ?
	`, integrationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTraffic(rows)
}

// AppendTraffic stores one runtime traffic event.
func (r *EndpointRepository) AppendTraffic(ctx context.Context, traffic *entity.TrafficEvent) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO core_integration_traffic (id, integration_id, endpoint_id, request_summary_json, matched_scenario, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`,
		traffic.ID,
		traffic.IntegrationID,
		nullableString(traffic.EndpointID),
		traffic.RequestSummaryJSON,
		nullableString(traffic.MatchedScenario),
		toRFC3339(traffic.CreatedAt),
	)
	return err
}

// AppendRevision appends one endpoint revision.
func (r *EndpointRepository) AppendRevision(ctx context.Context, revision *entity.EndpointRevision) error {
	_, err := executor(ctx, r.db).ExecContext(ctx, `
		INSERT INTO core_integration_endpoint_revisions (
			id,
			integration_id,
			endpoint_id,
			contract_json,
			scenarios_json,
			restored_from_revision_id,
			created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`,
		revision.ID,
		revision.IntegrationID,
		revision.EndpointID,
		revision.ContractJSON,
		revision.ScenariosJSON,
		nullableString(revision.RestoredFromRevisionID),
		toRFC3339(revision.CreatedAt),
	)
	return err
}

// ListRevisions returns endpoint revisions sorted by newest first.
func (r *EndpointRepository) ListRevisions(
	ctx context.Context,
	integrationID string,
	endpointID string,
	limit int,
	offset int,
) ([]*entity.EndpointRevision, error) {
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, endpoint_id, contract_json, scenarios_json, restored_from_revision_id, created_at
		FROM core_integration_endpoint_revisions
		WHERE integration_id = ? AND endpoint_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT ? OFFSET ?
	`, integrationID, endpointID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEndpointRevisions(rows)
}

// FindRevisionByID returns one endpoint revision scoped by integration/endpoint.
func (r *EndpointRepository) FindRevisionByID(
	ctx context.Context,
	integrationID string,
	endpointID string,
	revisionID string,
) (*entity.EndpointRevision, error) {
	rows, err := executor(ctx, r.db).QueryContext(ctx, `
		SELECT id, integration_id, endpoint_id, contract_json, scenarios_json, restored_from_revision_id, created_at
		FROM core_integration_endpoint_revisions
		WHERE integration_id = ? AND endpoint_id = ? AND id = ?
		LIMIT 1
	`, integrationID, endpointID, revisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanEndpointRevisions(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ports.ErrNotFound
	}
	return items[0], nil
}

func executor(ctx context.Context, db *DBRef) execer {
	if tx, ok := ctx.Value(txContextKey{}).(*sql.Tx); ok {
		return tx
	}
	return db.Get()
}

func toRFC3339(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

func parseTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed
	}
	return time.Time{}
}

func mapSQLError(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "unique constraint failed") {
		return fmt.Errorf("%w: %v", ports.ErrConflict, err)
	}
	return err
}

func scanSingleUser(row *sql.Row) (*entity.User, error) {
	var user entity.User
	var externalID sql.NullString
	var createdAt string
	var updatedAt string
	err := row.Scan(&user.ID, &user.Email, &externalID, &user.FullName, &user.Status, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ports.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if externalID.Valid {
		v := externalID.String
		user.ExternalIdentityID = &v
	}
	user.CreatedAt = parseTime(createdAt)
	user.UpdatedAt = parseTime(updatedAt)
	return &user, nil
}

func scanWorkspaces(rows *sql.Rows) ([]*entity.Workspace, error) {
	result := make([]*entity.Workspace, 0)
	for rows.Next() {
		item := &entity.Workspace{}
		var createdAt string
		var updatedAt string
		if err := rows.Scan(&item.ID, &item.Name, &item.Slug, &item.Description, &item.MetadataJSON, &item.Status, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		item.CreatedAt = parseTime(createdAt)
		item.UpdatedAt = parseTime(updatedAt)
		result = append(result, item)
	}
	return result, rows.Err()
}

func scanMembers(rows *sql.Rows) ([]*entity.WorkspaceMember, error) {
	result := make([]*entity.WorkspaceMember, 0)
	for rows.Next() {
		item := &entity.WorkspaceMember{}
		var invitedBy sql.NullString
		var joinedAt sql.NullString
		var createdAt string
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.UserID, &item.Role, &item.MembershipStatus, &invitedBy, &joinedAt, &createdAt); err != nil {
			return nil, err
		}
		if invitedBy.Valid {
			v := invitedBy.String
			item.InvitedBy = &v
		}
		if joinedAt.Valid {
			t := parseTime(joinedAt.String)
			item.JoinedAt = &t
		}
		item.CreatedAt = parseTime(createdAt)
		result = append(result, item)
	}
	return result, rows.Err()
}

func scanIntegrations(rows *sql.Rows) ([]*entity.Integration, error) {
	result := make([]*entity.Integration, 0)
	for rows.Next() {
		item := &entity.Integration{}
		var createdAt string
		var updatedAt string
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.Slug, &item.BaseURL, &item.AuthMode, &item.Status, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		item.CreatedAt = parseTime(createdAt)
		item.UpdatedAt = parseTime(updatedAt)
		result = append(result, item)
	}
	return result, rows.Err()
}

func scanIntegrationPacks(rows *sql.Rows) ([]*entity.IntegrationPack, error) {
	result := make([]*entity.IntegrationPack, 0)
	for rows.Next() {
		item := &entity.IntegrationPack{}
		var authEnabled int
		var createdAt string
		var updatedAt string
		if err := rows.Scan(
			&item.ID,
			&item.IntegrationID,
			&item.Name,
			&item.Slug,
			&item.BasePath,
			&item.Status,
			&authEnabled,
			&item.AuthPolicyJSON,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}
		item.AuthEnabled = authEnabled == 1
		item.CreatedAt = parseTime(createdAt)
		item.UpdatedAt = parseTime(updatedAt)
		result = append(result, item)
	}
	return result, rows.Err()
}

func scanEndpoints(rows *sql.Rows) ([]*entity.IntegrationEndpoint, error) {
	result := make([]*entity.IntegrationEndpoint, 0)
	for rows.Next() {
		item := &entity.IntegrationEndpoint{}
		var authMode string
		var createdAt string
		var updatedAt string
		if err := rows.Scan(
			&item.ID,
			&item.IntegrationID,
			&item.PackID,
			&item.Method,
			&item.Path,
			&authMode,
			&item.AuthOverridePolicyJSON,
			&item.ContractJSON,
			&item.ScenariosJSON,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}
		item.AuthMode = entity.EndpointAuthMode(strings.ToUpper(strings.TrimSpace(authMode)))
		if item.AuthMode == "" {
			item.AuthMode = entity.EndpointAuthModeInherit
		}
		item.CreatedAt = parseTime(createdAt)
		item.UpdatedAt = parseTime(updatedAt)
		result = append(result, item)
	}
	return result, rows.Err()
}

func scanTraffic(rows *sql.Rows) ([]*entity.TrafficEvent, error) {
	result := make([]*entity.TrafficEvent, 0)
	for rows.Next() {
		item := &entity.TrafficEvent{}
		var endpointID sql.NullString
		var matched sql.NullString
		var createdAt string
		if err := rows.Scan(&item.ID, &item.IntegrationID, &endpointID, &item.RequestSummaryJSON, &matched, &createdAt); err != nil {
			return nil, err
		}
		if endpointID.Valid {
			v := endpointID.String
			item.EndpointID = &v
		}
		if matched.Valid {
			v := matched.String
			item.MatchedScenario = &v
		}
		item.CreatedAt = parseTime(createdAt)
		result = append(result, item)
	}
	return result, rows.Err()
}

func scanEndpointRevisions(rows *sql.Rows) ([]*entity.EndpointRevision, error) {
	result := make([]*entity.EndpointRevision, 0)
	for rows.Next() {
		item := &entity.EndpointRevision{}
		var restoredFrom sql.NullString
		var createdAt string
		if err := rows.Scan(
			&item.ID,
			&item.IntegrationID,
			&item.EndpointID,
			&item.ContractJSON,
			&item.ScenariosJSON,
			&restoredFrom,
			&createdAt,
		); err != nil {
			return nil, err
		}
		if restoredFrom.Valid {
			value := restoredFrom.String
			item.RestoredFromRevisionID = &value
		}
		item.CreatedAt = parseTime(createdAt)
		result = append(result, item)
	}
	return result, rows.Err()
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return toRFC3339(*value)
}
