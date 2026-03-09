package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDataSourcesConfigDefaults(t *testing.T) {
	t.Setenv("MOCK_LOOM_CONFIG_YAML", "")
	t.Setenv("MOCK_LOOM_CONFIG_YAML_PATH", "")
	t.Setenv("MOCK_LOOM_DATA_SOURCES_MAX_BYTES", "")

	cfg := loadDataSourcesConfig(DataSourcesConfig{BaselineMaxBytes: DefaultDataSourceBaselineMaxBytes})
	if cfg.BaselineMaxBytes != DefaultDataSourceBaselineMaxBytes {
		t.Fatalf("expected default baseline max bytes %d, got %d", DefaultDataSourceBaselineMaxBytes, cfg.BaselineMaxBytes)
	}
}

func TestLoadDataSourcesConfigYAMLAndEnvPrecedence(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "runtime.yaml")
	if err := os.WriteFile(path, []byte("data_sources:\n  baseline_max_bytes: 2097152\n"), 0o600); err != nil {
		t.Fatalf("write yaml: %v", err)
	}

	t.Setenv("MOCK_LOOM_CONFIG_YAML", path)
	t.Setenv("MOCK_LOOM_DATA_SOURCES_MAX_BYTES", "")

	cfg := loadDataSourcesConfig(DataSourcesConfig{BaselineMaxBytes: DefaultDataSourceBaselineMaxBytes})
	if cfg.BaselineMaxBytes != 2097152 {
		t.Fatalf("expected yaml baseline max bytes 2097152, got %d", cfg.BaselineMaxBytes)
	}

	t.Setenv("MOCK_LOOM_DATA_SOURCES_MAX_BYTES", "3145728")
	cfg = loadDataSourcesConfig(DataSourcesConfig{BaselineMaxBytes: DefaultDataSourceBaselineMaxBytes})
	if cfg.BaselineMaxBytes != 3145728 {
		t.Fatalf("expected env override baseline max bytes 3145728, got %d", cfg.BaselineMaxBytes)
	}
}
