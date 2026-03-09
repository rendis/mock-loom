package config

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime configuration for API server.
type Config struct {
	Server      ServerConfig
	Database    DatabaseConfig
	Auth        AuthConfig
	Import      ImportConfig
	DataSources DataSourcesConfig
	Backup      BackupConfig
}

// ServerConfig contains HTTP server options.
type ServerConfig struct {
	Port string
}

// DatabaseConfig contains SQLite options.
type DatabaseConfig struct {
	DSN           string
	MigrationsDir string
}

// AuthConfig contains OIDC and bootstrap options.
type AuthConfig struct {
	Provider         OIDCProviderConfig
	BootstrapEnabled bool
	BootstrapEmails  []string
	BootstrapDomains []string
	DummyAuthEnabled bool
	DummyAuthEmail   string
	DummyAuthSubject string
}

// OIDCProviderConfig contains OIDC endpoints and validation settings.
type OIDCProviderConfig struct {
	Name                  string
	DiscoveryURL          string
	Issuer                string
	JWKSURL               string
	AuthorizationEndpoint string
	TokenEndpoint         string
	UserinfoEndpoint      string
	EndSessionEndpoint    string
	ClientID              string
	Audience              string
	Scopes                string
}

// ImportConfig contains runtime knobs and command paths for import pipeline.
type ImportConfig struct {
	MaxBytes       int
	TimeoutSeconds int
	MaxRoutes      int
	PostmanCLIPath string
	CurlCLIPath    string
}

// DataSourcesConfig contains runtime knobs for baseline ingestion.
type DataSourcesConfig struct {
	BaselineMaxBytes int
}

// BackupConfig contains cloud backup settings.
type BackupConfig struct {
	Enabled        bool
	Provider       string
	Bucket         string
	ObjectKey      string
	S3Region       string
	SyncInterval   time.Duration
	RestoreOnStart bool
}

// DefaultDataSourceBaselineMaxBytes is the default max baseline upload payload.
const DefaultDataSourceBaselineMaxBytes = 10 * 1024 * 1024

// Load returns config from environment variables.
func Load() *Config {
	cfg := &Config{
		Server: ServerConfig{
			Port: getenvDefault("MOCK_LOOM_SERVER_PORT", "8080"),
		},
		Database: DatabaseConfig{
			DSN:           getenvDefault("MOCK_LOOM_DB_DSN", "file:mock-loom.db?_pragma=foreign_keys(1)"),
			MigrationsDir: getenvDefault("MOCK_LOOM_MIGRATIONS_DIR", "db/migrations"),
		},
		Auth: AuthConfig{
			Provider: OIDCProviderConfig{
				Name:                  getenvDefault("MOCK_LOOM_AUTH_NAME", "oidc"),
				DiscoveryURL:          strings.TrimSpace(os.Getenv("MOCK_LOOM_AUTH_DISCOVERY_URL")),
				Issuer:                strings.TrimSpace(os.Getenv("MOCK_LOOM_AUTH_ISSUER")),
				JWKSURL:               strings.TrimSpace(os.Getenv("MOCK_LOOM_AUTH_JWKS_URL")),
				AuthorizationEndpoint: strings.TrimSpace(os.Getenv("MOCK_LOOM_AUTH_AUTHORIZATION_ENDPOINT")),
				TokenEndpoint:         strings.TrimSpace(os.Getenv("MOCK_LOOM_AUTH_TOKEN_ENDPOINT")),
				UserinfoEndpoint:      strings.TrimSpace(os.Getenv("MOCK_LOOM_AUTH_USERINFO_ENDPOINT")),
				EndSessionEndpoint:    strings.TrimSpace(os.Getenv("MOCK_LOOM_AUTH_END_SESSION_ENDPOINT")),
				ClientID:              strings.TrimSpace(os.Getenv("MOCK_LOOM_AUTH_CLIENT_ID")),
				Audience:              strings.TrimSpace(os.Getenv("MOCK_LOOM_AUTH_AUDIENCE")),
				Scopes:                getenvDefault("MOCK_LOOM_AUTH_SCOPES", "openid profile email"),
			},
			BootstrapEnabled: parseBool(getenvDefault("MOCK_LOOM_BOOTSTRAP_ENABLED", "true")),
			BootstrapEmails:  splitCSV(os.Getenv("MOCK_LOOM_BOOTSTRAP_ALLOWED_EMAILS")),
			BootstrapDomains: splitCSV(os.Getenv("MOCK_LOOM_BOOTSTRAP_ALLOWED_DOMAINS")),
			DummyAuthEnabled: parseBool(getenvDefault("MOCK_LOOM_DUMMY_AUTH_ENABLED", "true")),
			DummyAuthEmail:   getenvDefault("MOCK_LOOM_DUMMY_AUTH_EMAIL", "admin@mockloom.local"),
			DummyAuthSubject: getenvDefault("MOCK_LOOM_DUMMY_AUTH_SUBJECT", "dummy-admin"),
		},
		Import: ImportConfig{
			MaxBytes:       parseInt(getenvDefault("MOCK_LOOM_IMPORT_MAX_BYTES", "5242880"), 5242880),
			TimeoutSeconds: parseInt(getenvDefault("MOCK_LOOM_IMPORT_TIMEOUT_SECONDS", "15"), 15),
			MaxRoutes:      parseInt(getenvDefault("MOCK_LOOM_IMPORT_MAX_ROUTES", "500"), 500),
			PostmanCLIPath: getenvDefault("MOCK_LOOM_IMPORT_POSTMAN_CLI_PATH", "p2o"),
			CurlCLIPath:    getenvDefault("MOCK_LOOM_IMPORT_CURL_CLI_PATH", "curlconverter"),
		},
		DataSources: DataSourcesConfig{
			BaselineMaxBytes: DefaultDataSourceBaselineMaxBytes,
		},
	}

	if cfg.Auth.Provider.Scopes == "" {
		cfg.Auth.Provider.Scopes = "openid profile email"
	}
	if cfg.Import.MaxBytes <= 0 {
		cfg.Import.MaxBytes = 5242880
	}
	if cfg.Import.TimeoutSeconds <= 0 {
		cfg.Import.TimeoutSeconds = 15
	}
	if cfg.Import.MaxRoutes <= 0 {
		cfg.Import.MaxRoutes = 500
	}
	cfg.Import.PostmanCLIPath = strings.TrimSpace(cfg.Import.PostmanCLIPath)
	if cfg.Import.PostmanCLIPath == "" {
		cfg.Import.PostmanCLIPath = "p2o"
	}
	cfg.Import.CurlCLIPath = strings.TrimSpace(cfg.Import.CurlCLIPath)
	if cfg.Import.CurlCLIPath == "" {
		cfg.Import.CurlCLIPath = "curlconverter"
	}
	cfg.DataSources = loadDataSourcesConfig(cfg.DataSources)
	if cfg.DataSources.BaselineMaxBytes <= 0 {
		cfg.DataSources.BaselineMaxBytes = DefaultDataSourceBaselineMaxBytes
	}

	cfg.Backup = loadBackupConfig()

	return cfg
}

func loadBackupConfig() BackupConfig {
	cfg := BackupConfig{
		Enabled:        parseBool(getenvDefault("MOCK_LOOM_BACKUP_ENABLED", "false")),
		Provider:       strings.TrimSpace(os.Getenv("MOCK_LOOM_BACKUP_PROVIDER")),
		Bucket:         strings.TrimSpace(os.Getenv("MOCK_LOOM_BACKUP_BUCKET")),
		ObjectKey:      getenvDefault("MOCK_LOOM_BACKUP_OBJECT_KEY", "mock-loom.db"),
		S3Region:       getenvDefault("MOCK_LOOM_BACKUP_S3_REGION", "us-east-1"),
		RestoreOnStart: parseBool(getenvDefault("MOCK_LOOM_BACKUP_RESTORE_ON_START", "false")),
	}
	if raw := strings.TrimSpace(os.Getenv("MOCK_LOOM_BACKUP_SYNC_INTERVAL")); raw != "" && raw != "0" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			cfg.SyncInterval = d
		} else {
			log.Printf("warn: invalid MOCK_LOOM_BACKUP_SYNC_INTERVAL %q, periodic backup disabled", raw)
		}
	}
	return cfg
}

// DBFilePathFromDSN extracts the file path from a SQLite DSN like "file:path?params".
func DBFilePathFromDSN(dsn string) string {
	path := strings.TrimPrefix(dsn, "file:")
	if idx := strings.Index(path, "?"); idx != -1 {
		path = path[:idx]
	}
	return path
}

// ValidateAuth performs required auth validations.
func (c *Config) ValidateAuth() {
	if c.Auth.IsDummyAuth() {
		if !c.Auth.DummyAuthEnabled {
			log.Fatal("dummy auth is disabled and OIDC provider is not configured")
		}
		return
	}

	if c.Auth.Provider.ClientID == "" {
		log.Fatal("MOCK_LOOM_AUTH_CLIENT_ID is required when OIDC auth is enabled")
	}

	if c.Auth.Provider.DiscoveryURL == "" && (c.Auth.Provider.Issuer == "" || c.Auth.Provider.JWKSURL == "") {
		log.Fatal("provide MOCK_LOOM_AUTH_DISCOVERY_URL or both MOCK_LOOM_AUTH_ISSUER and MOCK_LOOM_AUTH_JWKS_URL")
	}
}

// IsDummyAuth returns true if OIDC provider is absent.
func (a AuthConfig) IsDummyAuth() bool {
	return strings.TrimSpace(a.Provider.DiscoveryURL) == "" && strings.TrimSpace(a.Provider.Issuer) == "" && strings.TrimSpace(a.Provider.JWKSURL) == ""
}

func splitCSV(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		p := strings.ToLower(strings.TrimSpace(part))
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func getenvDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func parseBool(value string) bool {
	return strings.EqualFold(strings.TrimSpace(value), "true") || strings.TrimSpace(value) == "1" || strings.EqualFold(strings.TrimSpace(value), "yes")
}

func parseInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}
