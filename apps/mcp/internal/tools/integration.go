package tools

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rendis/mock-loom/apps/mcp/internal/client"
)

// --- setup_integration ---

type SetupIntegrationInput struct {
	WorkspaceID string `json:"workspace_id" jsonschema:"required,workspace ID to create integration in"`
	Name        string `json:"name" jsonschema:"required,integration display name"`
	Slug        string `json:"slug" jsonschema:"required,unique integration slug (lowercase, hyphens)"`
	BaseURL     string `json:"base_url,omitempty" jsonschema:"optional base URL for the mocked API"`
	AuthMode    string `json:"auth_mode,omitempty" jsonschema:"optional auth mode: NONE, BEARER, or API_KEY (default NONE)"`
}

type SetupIntegrationOutput struct {
	Result any `json:"result" jsonschema:"created or existing integration"`
}

func setupIntegration(c *client.Client) func(context.Context, *mcp.CallToolRequest, SetupIntegrationInput) (*mcp.CallToolResult, SetupIntegrationOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input SetupIntegrationInput) (*mcp.CallToolResult, SetupIntegrationOutput, error) {
		// Check for existing by slug.
		list, err := c.Get(fmt.Sprintf("/workspaces/%s/integrations", input.WorkspaceID))
		if err != nil {
			return nil, SetupIntegrationOutput{}, fmt.Errorf("list integrations: %w", err)
		}
		if items, ok := extractItems(list); ok {
			for _, item := range items {
				if m, ok := item.(map[string]any); ok {
					if slug, _ := m["Slug"].(string); slug == input.Slug {
						return nil, SetupIntegrationOutput{Result: m}, nil
					}
				}
			}
		}

		result, err := c.Post(fmt.Sprintf("/workspaces/%s/integrations", input.WorkspaceID), map[string]string{
			"name":    input.Name,
			"slug":    input.Slug,
			"baseUrl": input.BaseURL,
		})
		if err != nil {
			return nil, SetupIntegrationOutput{}, fmt.Errorf("create integration: %w", err)
		}

		// Optionally update auth mode if specified and not NONE.
		if input.AuthMode != "" && input.AuthMode != "NONE" {
			if m, ok := result.(map[string]any); ok {
				if id, _ := m["ID"].(string); id != "" {
					_, err := c.Patch(fmt.Sprintf("/integrations/%s/auth", id), map[string]string{
						"authMode": input.AuthMode,
					})
					if err != nil {
						return nil, SetupIntegrationOutput{}, fmt.Errorf("update auth mode: %w", err)
					}
					m["AuthMode"] = input.AuthMode
				}
			}
		}

		return nil, SetupIntegrationOutput{Result: result}, nil
	}
}

// --- manage_pack ---

type ManagePackInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	Name          string `json:"name" jsonschema:"required,pack display name"`
	Slug          string `json:"slug" jsonschema:"required,unique pack slug"`
	BasePath      string `json:"base_path" jsonschema:"required,pack base path prefix (e.g. /api/v1)"`
	PackID        string `json:"pack_id,omitempty" jsonschema:"if provided updates existing pack instead of creating"`
}

type ManagePackOutput struct {
	Result any `json:"result" jsonschema:"created or updated pack"`
}

func managePack(c *client.Client) func(context.Context, *mcp.CallToolRequest, ManagePackInput) (*mcp.CallToolResult, ManagePackOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input ManagePackInput) (*mcp.CallToolResult, ManagePackOutput, error) {
		if input.PackID != "" {
			result, err := c.Patch(
				fmt.Sprintf("/integrations/%s/packs/%s", input.IntegrationID, input.PackID),
				map[string]any{
					"name":     input.Name,
					"slug":     input.Slug,
					"basePath": input.BasePath,
				},
			)
			if err != nil {
				return nil, ManagePackOutput{}, fmt.Errorf("update pack: %w", err)
			}
			return nil, ManagePackOutput{Result: result}, nil
		}

		result, err := c.Post(
			fmt.Sprintf("/integrations/%s/packs", input.IntegrationID),
			map[string]string{
				"name":     input.Name,
				"slug":     input.Slug,
				"basePath": input.BasePath,
			},
		)
		if err != nil {
			return nil, ManagePackOutput{}, fmt.Errorf("create pack: %w", err)
		}
		return nil, ManagePackOutput{Result: result}, nil
	}
}

// --- import_routes ---

type ImportRoutesInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	PackID        string `json:"pack_id" jsonschema:"required,pack ID to import routes into"`
	SourceType    string `json:"source_type" jsonschema:"required,import format: OPENAPI, POSTMAN, or CURL"`
	Payload       string `json:"payload" jsonschema:"required,raw spec content (OpenAPI YAML/JSON, Postman JSON, or cURL command)"`
}

type ImportRoutesOutput struct {
	Result any `json:"result" jsonschema:"import result with created endpoints"`
}

func importRoutes(c *client.Client) func(context.Context, *mcp.CallToolRequest, ImportRoutesInput) (*mcp.CallToolResult, ImportRoutesOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input ImportRoutesInput) (*mcp.CallToolResult, ImportRoutesOutput, error) {
		result, err := c.Post(
			fmt.Sprintf("/integrations/%s/packs/%s/imports", input.IntegrationID, input.PackID),
			map[string]string{
				"sourceType": input.SourceType,
				"payload":    input.Payload,
			},
		)
		if err != nil {
			return nil, ImportRoutesOutput{}, fmt.Errorf("import routes: %w", err)
		}
		return nil, ImportRoutesOutput{Result: result}, nil
	}
}

// --- list_routes ---

type ListRoutesInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	PackID        string `json:"pack_id,omitempty" jsonschema:"if provided lists routes in this pack; otherwise lists all packs"`
}

type ListRoutesOutput struct {
	Result any `json:"result" jsonschema:"list of packs or routes"`
}

func listRoutes(c *client.Client) func(context.Context, *mcp.CallToolRequest, ListRoutesInput) (*mcp.CallToolResult, ListRoutesOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input ListRoutesInput) (*mcp.CallToolResult, ListRoutesOutput, error) {
		if input.PackID != "" {
			result, err := c.Get(fmt.Sprintf("/integrations/%s/packs/%s/routes", input.IntegrationID, input.PackID))
			if err != nil {
				return nil, ListRoutesOutput{}, fmt.Errorf("list routes: %w", err)
			}
			return nil, ListRoutesOutput{Result: result}, nil
		}

		result, err := c.Get(fmt.Sprintf("/integrations/%s/packs", input.IntegrationID))
		if err != nil {
			return nil, ListRoutesOutput{}, fmt.Errorf("list packs: %w", err)
		}
		return nil, ListRoutesOutput{Result: result}, nil
	}
}

// --- get_overview ---

type GetOverviewInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
}

type GetOverviewOutput struct {
	Result any `json:"result" jsonschema:"integration overview with packs, routes, and data sources"`
}

func getOverview(c *client.Client) func(context.Context, *mcp.CallToolRequest, GetOverviewInput) (*mcp.CallToolResult, GetOverviewOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input GetOverviewInput) (*mcp.CallToolResult, GetOverviewOutput, error) {
		overview, err := c.Get(fmt.Sprintf("/integrations/%s/overview", input.IntegrationID))
		if err != nil {
			return nil, GetOverviewOutput{}, fmt.Errorf("get overview: %w", err)
		}

		packs, packsErr := c.Get(fmt.Sprintf("/integrations/%s/packs", input.IntegrationID))
		dataSources, dsErr := c.Get(fmt.Sprintf("/integrations/%s/data-sources", input.IntegrationID))

		result := map[string]any{
			"overview":    overview,
			"packs":       packs,
			"dataSources": dataSources,
		}
		if packsErr != nil {
			result["packsError"] = packsErr.Error()
		}
		if dsErr != nil {
			result["dataSourcesError"] = dsErr.Error()
		}
		return nil, GetOverviewOutput{Result: result}, nil
	}
}

func RegisterIntegrationTools(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "mock_loom_setup_integration",
		Description: "Create a new integration (mock project) inside a workspace, or return existing one by slug. Idempotent. Optionally sets auth mode (NONE, BEARER, API_KEY).",
	}, setupIntegration(c))

	mcp.AddTool(server, &mcp.Tool{
		Name:        "mock_loom_manage_pack",
		Description: "Create or update an endpoint pack (route group) inside an integration. Packs group endpoints under a shared base path.",
	}, managePack(c))

	mcp.AddTool(server, &mcp.Tool{
		Name:        "mock_loom_import_routes",
		Description: "Bulk import API routes from OpenAPI spec, Postman collection, or cURL command into a pack. Provide raw spec content as payload.",
	}, importRoutes(c))

	mcp.AddTool(server, &mcp.Tool{
		Name:        "mock_loom_list_routes",
		Description: "List all packs in an integration, or all routes in a specific pack. Use to discover endpoint IDs.",
	}, listRoutes(c))

	mcp.AddTool(server, &mcp.Tool{
		Name:        "mock_loom_get_overview",
		Description: "Get full integration overview including packs, routes, and data sources. Use this to understand the complete state of an integration.",
	}, getOverview(c))
}
