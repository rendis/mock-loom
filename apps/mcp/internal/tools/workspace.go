package tools

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rendis/mock-loom/apps/mcp/internal/client"
)

type ListWorkspacesInput struct{}

type ListWorkspacesOutput struct {
	Result any `json:"result" jsonschema:"list of workspaces"`
}

func listWorkspaces(c *client.Client) func(context.Context, *mcp.CallToolRequest, ListWorkspacesInput) (*mcp.CallToolResult, ListWorkspacesOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ ListWorkspacesInput) (*mcp.CallToolResult, ListWorkspacesOutput, error) {
		result, err := c.Get("/workspaces")
		if err != nil {
			return nil, ListWorkspacesOutput{}, fmt.Errorf("list workspaces: %w", err)
		}
		return nil, ListWorkspacesOutput{Result: result}, nil
	}
}

type SetupWorkspaceInput struct {
	Name        string `json:"name" jsonschema:"required,workspace display name"`
	Slug        string `json:"slug" jsonschema:"required,unique workspace slug (lowercase, hyphens)"`
	Description string `json:"description,omitempty" jsonschema:"optional workspace description"`
}

type SetupWorkspaceOutput struct {
	Result any `json:"result" jsonschema:"created or existing workspace"`
}

func setupWorkspace(c *client.Client) func(context.Context, *mcp.CallToolRequest, SetupWorkspaceInput) (*mcp.CallToolResult, SetupWorkspaceOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input SetupWorkspaceInput) (*mcp.CallToolResult, SetupWorkspaceOutput, error) {
		// Check for existing workspace by listing and matching slug.
		list, err := c.Get("/workspaces")
		if err != nil {
			return nil, SetupWorkspaceOutput{}, fmt.Errorf("list workspaces: %w", err)
		}
		if items, ok := extractItems(list); ok {
			for _, item := range items {
				if m, ok := item.(map[string]any); ok {
					if slug, _ := m["Slug"].(string); slug == input.Slug {
						return nil, SetupWorkspaceOutput{Result: m}, nil
					}
				}
			}
		}

		result, err := c.Post("/workspaces", map[string]string{
			"name":        input.Name,
			"slug":        input.Slug,
			"description": input.Description,
		})
		if err != nil {
			return nil, SetupWorkspaceOutput{}, fmt.Errorf("create workspace: %w", err)
		}
		return nil, SetupWorkspaceOutput{Result: result}, nil
	}
}

func RegisterWorkspaceTools(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "mock_loom_list_workspaces",
		Description: "List all accessible workspaces in mock-loom. Use this first to discover workspace IDs.",
	}, listWorkspaces(c))

	mcp.AddTool(server, &mcp.Tool{
		Name:        "mock_loom_setup_workspace",
		Description: "Create a new workspace or return existing one by slug. Idempotent — safe to call multiple times with the same slug.",
	}, setupWorkspace(c))
}
