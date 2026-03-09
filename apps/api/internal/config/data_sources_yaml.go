package config

import (
	"log"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type runtimeConfigYAML struct {
	DataSources struct {
		BaselineMaxBytes int `yaml:"baseline_max_bytes"`
	} `yaml:"data_sources"`
}

func loadDataSourcesConfig(base DataSourcesConfig) DataSourcesConfig {
	cfg := base

	configPath := strings.TrimSpace(os.Getenv("MOCK_LOOM_CONFIG_YAML"))
	if configPath == "" {
		configPath = strings.TrimSpace(os.Getenv("MOCK_LOOM_CONFIG_YAML_PATH"))
	}
	if configPath == "" {
		if _, err := os.Stat("config.yaml"); err == nil {
			configPath = "config.yaml"
		}
	}

	if configPath != "" {
		content, err := os.ReadFile(configPath)
		if err != nil {
			log.Printf("warning: failed to read YAML config %q: %v", configPath, err)
		} else {
			var raw runtimeConfigYAML
			if unmarshalErr := yaml.Unmarshal(content, &raw); unmarshalErr != nil {
				log.Printf("warning: failed to parse YAML config %q: %v", configPath, unmarshalErr)
			} else if raw.DataSources.BaselineMaxBytes > 0 {
				cfg.BaselineMaxBytes = raw.DataSources.BaselineMaxBytes
			}
		}
	}

	envOverride := strings.TrimSpace(os.Getenv("MOCK_LOOM_DATA_SOURCES_MAX_BYTES"))
	if envOverride != "" {
		cfg.BaselineMaxBytes = parseInt(envOverride, cfg.BaselineMaxBytes)
	}

	return cfg
}
