package tools

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rendis/mock-loom/apps/mcp/internal/client"
)

// --- configure_endpoint ---

type ConfigureEndpointInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	PackID        string `json:"pack_id" jsonschema:"required,pack ID"`
	EndpointID    string `json:"endpoint_id" jsonschema:"required,endpoint ID"`
	Contract      string `json:"contract,omitempty" jsonschema:"if provided updates the request contract (JSON string defining headers, query params, body schema)"`
	Scenarios     string `json:"scenarios,omitempty" jsonschema:"if provided updates the scenarios (JSON string defining condition-response rules)"`
}

type ConfigureEndpointOutput struct {
	Result any `json:"result" jsonschema:"endpoint state after any updates"`
}

func configureEndpoint(c *client.Client) func(context.Context, *mcp.CallToolRequest, ConfigureEndpointInput) (*mcp.CallToolResult, ConfigureEndpointOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input ConfigureEndpointInput) (*mcp.CallToolResult, ConfigureEndpointOutput, error) {
		basePath := fmt.Sprintf("/integrations/%s/packs/%s/endpoints/%s", input.IntegrationID, input.PackID, input.EndpointID)

		// Update contract if provided.
		if input.Contract != "" {
			_, err := c.Put(basePath+"/contract", map[string]string{"contract": input.Contract})
			if err != nil {
				return nil, ConfigureEndpointOutput{}, fmt.Errorf("update contract: %w", err)
			}
		}

		// Update scenarios if provided.
		if input.Scenarios != "" {
			_, err := c.Put(basePath+"/scenarios", map[string]string{"scenarios": input.Scenarios})
			if err != nil {
				return nil, ConfigureEndpointOutput{}, fmt.Errorf("update scenarios: %w", err)
			}
		}

		// Always return current endpoint state.
		result, err := c.Get(basePath)
		if err != nil {
			return nil, ConfigureEndpointOutput{}, fmt.Errorf("get endpoint: %w", err)
		}
		return nil, ConfigureEndpointOutput{Result: result}, nil
	}
}

// --- get_traffic ---

type GetTrafficInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	PackID        string `json:"pack_id" jsonschema:"required,pack ID"`
	EndpointID    string `json:"endpoint_id" jsonschema:"required,endpoint ID"`
}

type GetTrafficOutput struct {
	Result any `json:"result" jsonschema:"list of traffic events with request summaries and matched scenarios"`
}

func getTraffic(c *client.Client) func(context.Context, *mcp.CallToolRequest, GetTrafficInput) (*mcp.CallToolResult, GetTrafficOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input GetTrafficInput) (*mcp.CallToolResult, GetTrafficOutput, error) {
		result, err := c.Get(fmt.Sprintf(
			"/integrations/%s/packs/%s/endpoints/%s/traffic",
			input.IntegrationID, input.PackID, input.EndpointID,
		))
		if err != nil {
			return nil, GetTrafficOutput{}, fmt.Errorf("get traffic: %w", err)
		}
		return nil, GetTrafficOutput{Result: result}, nil
	}
}

// --- update_endpoint_route ---

type UpdateEndpointRouteInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	PackID        string `json:"pack_id" jsonschema:"required,pack ID"`
	EndpointID    string `json:"endpoint_id" jsonschema:"required,endpoint ID"`
	Method        string `json:"method,omitempty" jsonschema:"HTTP method (GET, POST, PUT, PATCH, DELETE)"`
	Path          string `json:"path,omitempty" jsonschema:"route path (e.g. /users/:id)"`
}

type UpdateEndpointRouteOutput struct {
	Result any `json:"result" jsonschema:"update result"`
}

func updateEndpointRoute(c *client.Client) func(context.Context, *mcp.CallToolRequest, UpdateEndpointRouteInput) (*mcp.CallToolResult, UpdateEndpointRouteOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input UpdateEndpointRouteInput) (*mcp.CallToolResult, UpdateEndpointRouteOutput, error) {
		body := map[string]string{}
		if input.Method != "" {
			body["method"] = input.Method
		}
		if input.Path != "" {
			body["path"] = input.Path
		}
		result, err := c.Patch(
			fmt.Sprintf("/integrations/%s/packs/%s/endpoints/%s/route", input.IntegrationID, input.PackID, input.EndpointID),
			body,
		)
		if err != nil {
			return nil, UpdateEndpointRouteOutput{}, fmt.Errorf("update endpoint route: %w", err)
		}
		return nil, UpdateEndpointRouteOutput{Result: result}, nil
	}
}

// --- manage_endpoint_revisions ---

type ManageEndpointRevisionsInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	PackID        string `json:"pack_id" jsonschema:"required,pack ID"`
	EndpointID    string `json:"endpoint_id" jsonschema:"required,endpoint ID"`
	Action        string `json:"action" jsonschema:"required,list or restore"`
	RevisionID    string `json:"revision_id,omitempty" jsonschema:"required for restore"`
	Limit         int    `json:"limit,omitempty" jsonschema:"max revisions for list"`
	Cursor        string `json:"cursor,omitempty" jsonschema:"pagination cursor for list"`
}

type ManageEndpointRevisionsOutput struct {
	Result any `json:"result" jsonschema:"revisions list or restore result"`
}

func manageEndpointRevisions(c *client.Client) func(context.Context, *mcp.CallToolRequest, ManageEndpointRevisionsInput) (*mcp.CallToolResult, ManageEndpointRevisionsOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input ManageEndpointRevisionsInput) (*mcp.CallToolResult, ManageEndpointRevisionsOutput, error) {
		basePath := fmt.Sprintf("/integrations/%s/packs/%s/endpoints/%s/revisions", input.IntegrationID, input.PackID, input.EndpointID)

		switch input.Action {
		case "list":
			path := basePath
			sep := "?"
			if input.Limit > 0 {
				path += fmt.Sprintf("%slimit=%d", sep, input.Limit)
				sep = "&"
			}
			if input.Cursor != "" {
				path += fmt.Sprintf("%scursor=%s", sep, input.Cursor)
			}
			result, err := c.Get(path)
			if err != nil {
				return nil, ManageEndpointRevisionsOutput{}, fmt.Errorf("list revisions: %w", err)
			}
			return nil, ManageEndpointRevisionsOutput{Result: result}, nil

		case "restore":
			if input.RevisionID == "" {
				return nil, ManageEndpointRevisionsOutput{}, fmt.Errorf("revision_id is required for restore")
			}
			result, err := c.Post(fmt.Sprintf("%s/%s/restore", basePath, input.RevisionID), nil)
			if err != nil {
				return nil, ManageEndpointRevisionsOutput{}, fmt.Errorf("restore revision: %w", err)
			}
			return nil, ManageEndpointRevisionsOutput{Result: result}, nil

		default:
			return nil, ManageEndpointRevisionsOutput{}, fmt.Errorf("unknown action %q; valid actions: list, restore", input.Action)
		}
	}
}

// --- get_audit_events ---

type GetAuditEventsInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	ResourceType  string `json:"resource_type,omitempty" jsonschema:"filter by resource type"`
	Actor         string `json:"actor,omitempty" jsonschema:"filter by actor"`
	Limit         int    `json:"limit,omitempty" jsonschema:"max events to return"`
	Cursor        string `json:"cursor,omitempty" jsonschema:"pagination cursor"`
}

type GetAuditEventsOutput struct {
	Result any `json:"result" jsonschema:"audit events list"`
}

func getAuditEvents(c *client.Client) func(context.Context, *mcp.CallToolRequest, GetAuditEventsInput) (*mcp.CallToolResult, GetAuditEventsOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input GetAuditEventsInput) (*mcp.CallToolResult, GetAuditEventsOutput, error) {
		path := fmt.Sprintf("/integrations/%s/audit-events", input.IntegrationID)
		sep := "?"
		if input.Limit > 0 {
			path += fmt.Sprintf("%slimit=%d", sep, input.Limit)
			sep = "&"
		}
		if input.Cursor != "" {
			path += fmt.Sprintf("%scursor=%s", sep, input.Cursor)
			sep = "&"
		}
		if input.ResourceType != "" {
			path += fmt.Sprintf("%sresourceType=%s", sep, input.ResourceType)
			sep = "&"
		}
		if input.Actor != "" {
			path += fmt.Sprintf("%sactor=%s", sep, input.Actor)
		}
		result, err := c.Get(path)
		if err != nil {
			return nil, GetAuditEventsOutput{}, fmt.Errorf("get audit events: %w", err)
		}
		return nil, GetAuditEventsOutput{Result: result}, nil
	}
}

func RegisterEndpointTools(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "mock_loom_configure_endpoint",
		Description: `Get or update an endpoint's contract and scenarios.
Contract defines request expectations (headers, query params, body schema).
Scenarios define priority-ordered condition→response rules using expr-lang expressions.
If contract/scenarios args are omitted, returns current state without changes.`,
	}, configureEndpoint(c))

	mcp.AddTool(server, &mcp.Tool{
		Name:        "mock_loom_get_traffic",
		Description: "View recent mock traffic logs for an endpoint. Shows which scenarios were triggered and request summaries.",
	}, getTraffic(c))

	mcp.AddTool(server, &mcp.Tool{
		Name:        "mock_loom_update_endpoint_route",
		Description: "Update the HTTP method and/or path of an endpoint. Use to fix routes after import.",
	}, updateEndpointRoute(c))

	mcp.AddTool(server, &mcp.Tool{
		Name: "mock_loom_manage_endpoint_revisions",
		Description: `View or restore endpoint configuration revisions.
Actions: list (paginated revision history), restore (revert endpoint to a previous revision).
Each revision captures the full contract and scenarios at a point in time.`,
	}, manageEndpointRevisions(c))

	mcp.AddTool(server, &mcp.Tool{
		Name: "mock_loom_get_audit_events",
		Description: `List audit events for an integration. Shows who changed what and when.
Supports filtering by resource_type and actor. Cursor-paginated.`,
	}, getAuditEvents(c))
}
