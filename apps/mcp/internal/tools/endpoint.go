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
}
