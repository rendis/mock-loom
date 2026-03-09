package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rendis/mock-loom/apps/mcp/internal/client"
)

type SendMockRequestInput struct {
	WorkspaceID   string `json:"workspace_id" jsonschema:"required,workspace ID"`
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	Method        string `json:"method" jsonschema:"required,HTTP method (GET, POST, PUT, PATCH, DELETE)"`
	Path          string `json:"path" jsonschema:"required,request path (e.g. /users/123)"`
	Headers       string `json:"headers,omitempty" jsonschema:"optional JSON object of request headers"`
	Query         string `json:"query,omitempty" jsonschema:"optional query string (e.g. page=1&limit=10)"`
	Body          string `json:"body,omitempty" jsonschema:"optional request body (JSON string)"`
}

type SendMockRequestOutput struct {
	StatusCode int               `json:"status_code" jsonschema:"HTTP status code of mock response"`
	Headers    map[string]string `json:"headers" jsonschema:"response headers"`
	Body       string            `json:"body" jsonschema:"response body"`
}

func sendMockRequest(c *client.Client) func(context.Context, *mcp.CallToolRequest, SendMockRequestInput) (*mcp.CallToolResult, SendMockRequestOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input SendMockRequestInput) (*mcp.CallToolResult, SendMockRequestOutput, error) {
		path := fmt.Sprintf("/mock/%s/%s%s", input.WorkspaceID, input.IntegrationID, input.Path)
		if input.Query != "" {
			path += "?" + input.Query
		}

		headers := make(map[string]string)
		if input.Headers != "" {
			if err := json.Unmarshal([]byte(input.Headers), &headers); err != nil {
				return nil, SendMockRequestOutput{}, fmt.Errorf("invalid headers JSON: %w", err)
			}
		}

		var body []byte
		if input.Body != "" {
			body = []byte(input.Body)
		}

		statusCode, respHeaders, respBody, err := c.MockRequest(input.Method, path, headers, body)
		if err != nil {
			return nil, SendMockRequestOutput{}, fmt.Errorf("mock request: %w", err)
		}

		return nil, SendMockRequestOutput{
			StatusCode: statusCode,
			Headers:    respHeaders,
			Body:       string(respBody),
		}, nil
	}
}

func RegisterRuntimeTools(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "mock_loom_send_mock_request",
		Description: `Send a request through the mock runtime gateway and return the simulated response.
This executes the full mock pipeline: endpoint resolution, auth evaluation, scenario matching, data mutations, and response generation.
Use to test mock endpoints after configuring contracts and scenarios.`,
	}, sendMockRequest(c))
}
