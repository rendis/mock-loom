package config

import (
	"fmt"
	"os/exec"
	"strings"
)

// ValidateImportTools verifies required import converter CLIs are available.
func (c *Config) ValidateImportTools() error {
	tools := []struct {
		name string
		path string
	}{
		{name: "postman converter", path: strings.TrimSpace(c.Import.PostmanCLIPath)},
		{name: "curl converter", path: strings.TrimSpace(c.Import.CurlCLIPath)},
	}

	for _, tool := range tools {
		if tool.path == "" {
			return fmt.Errorf("%s path is empty", tool.name)
		}
		if _, err := exec.LookPath(tool.path); err != nil {
			return fmt.Errorf("%s executable not found (%s): %w", tool.name, tool.path, err)
		}
	}
	return nil
}
