package tools

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rendis/mock-loom/apps/mcp/internal/client"
)

// RegisterAll registers all mock-loom MCP tools on the server.
func RegisterAll(server *mcp.Server, c *client.Client) {
	RegisterWorkspaceTools(server, c)
	RegisterIntegrationTools(server, c)
	RegisterEndpointTools(server, c)
	RegisterDataTools(server, c)
	RegisterRuntimeTools(server, c)
}
