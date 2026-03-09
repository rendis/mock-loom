package tools

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rendis/mock-loom/apps/mcp/internal/client"
)

// --- manage_data_source ---

type ManageDataSourceInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	Action        string `json:"action" jsonschema:"required,one of: list, create, upload_baseline, sync, get_schema, delete"`
	SourceID      string `json:"source_id,omitempty" jsonschema:"required for upload_baseline, sync, get_schema, delete"`
	Name          string `json:"name,omitempty" jsonschema:"required for create"`
	Slug          string `json:"slug,omitempty" jsonschema:"required for create"`
	Kind          string `json:"kind,omitempty" jsonschema:"required for create: JSON or CSV"`
	BaselineJSON  string `json:"baseline_json,omitempty" jsonschema:"JSON array string for upload_baseline action"`
}

type ManageDataSourceOutput struct {
	Result any `json:"result" jsonschema:"data source operation result"`
}

func manageDataSource(c *client.Client) func(context.Context, *mcp.CallToolRequest, ManageDataSourceInput) (*mcp.CallToolResult, ManageDataSourceOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input ManageDataSourceInput) (*mcp.CallToolResult, ManageDataSourceOutput, error) {
		basePath := fmt.Sprintf("/integrations/%s/data-sources", input.IntegrationID)

		switch input.Action {
		case "list":
			result, err := c.Get(basePath)
			if err != nil {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("list data sources: %w", err)
			}
			return nil, ManageDataSourceOutput{Result: result}, nil

		case "create":
			result, err := c.Post(basePath, map[string]string{
				"name": input.Name,
				"slug": input.Slug,
				"kind": input.Kind,
			})
			if err != nil {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("create data source: %w", err)
			}
			return nil, ManageDataSourceOutput{Result: result}, nil

		case "upload_baseline":
			if input.SourceID == "" {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("source_id is required for upload_baseline")
			}
			if input.BaselineJSON == "" {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("baseline_json is required for upload_baseline")
			}
			result, err := c.PostMultipartJSON(
				fmt.Sprintf("%s/%s/baseline", basePath, input.SourceID),
				"file",
				"baseline.json",
				input.BaselineJSON,
			)
			if err != nil {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("upload baseline: %w", err)
			}
			return nil, ManageDataSourceOutput{Result: result}, nil

		case "sync":
			if input.SourceID == "" {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("source_id is required for sync")
			}
			result, err := c.Post(fmt.Sprintf("%s/%s/sync", basePath, input.SourceID), nil)
			if err != nil {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("sync data source: %w", err)
			}
			return nil, ManageDataSourceOutput{Result: result}, nil

		case "get_schema":
			if input.SourceID == "" {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("source_id is required for get_schema")
			}
			result, err := c.Get(fmt.Sprintf("%s/%s/schema", basePath, input.SourceID))
			if err != nil {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("get schema: %w", err)
			}
			return nil, ManageDataSourceOutput{Result: result}, nil

		case "delete":
			if input.SourceID == "" {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("source_id is required for delete")
			}
			if err := c.Delete(fmt.Sprintf("%s/%s", basePath, input.SourceID)); err != nil {
				return nil, ManageDataSourceOutput{}, fmt.Errorf("delete data source: %w", err)
			}
			return nil, ManageDataSourceOutput{Result: map[string]string{"status": "deleted"}}, nil

		default:
			return nil, ManageDataSourceOutput{}, fmt.Errorf("unknown action %q; valid actions: list, create, upload_baseline, sync, get_schema, delete", input.Action)
		}
	}
}

// --- debug_entities ---

type DebugEntitiesInput struct {
	IntegrationID string `json:"integration_id" jsonschema:"required,integration ID"`
	SourceID      string `json:"source_id" jsonschema:"required,data source ID"`
	Action        string `json:"action" jsonschema:"required,one of: list, create, timeline, rollback, rollback_all"`
	EntityID      string `json:"entity_id,omitempty" jsonschema:"required for timeline and rollback"`
	TargetEventID string `json:"target_event_id,omitempty" jsonschema:"required for rollback: event ID to rollback to"`
	Payload       string `json:"payload,omitempty" jsonschema:"JSON object string for create action"`
	Limit         int    `json:"limit,omitempty" jsonschema:"max entities to return for list (default 50)"`
}

type DebugEntitiesOutput struct {
	Result any `json:"result" jsonschema:"debug operation result"`
}

func debugEntities(c *client.Client) func(context.Context, *mcp.CallToolRequest, DebugEntitiesInput) (*mcp.CallToolResult, DebugEntitiesOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input DebugEntitiesInput) (*mcp.CallToolResult, DebugEntitiesOutput, error) {
		basePath := fmt.Sprintf("/integrations/%s/data-sources/%s", input.IntegrationID, input.SourceID)

		switch input.Action {
		case "list":
			path := basePath + "/entities"
			if input.Limit > 0 {
				path += fmt.Sprintf("?limit=%d", input.Limit)
			} else {
				path += "?limit=50"
			}
			result, err := c.Get(path)
			if err != nil {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("list entities: %w", err)
			}
			return nil, DebugEntitiesOutput{Result: result}, nil

		case "create":
			if input.EntityID == "" {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("entity_id is required for create")
			}
			if input.Payload == "" {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("payload (JSON object) is required for create")
			}
			result, err := c.Post(basePath+"/entities", map[string]any{
				"entityId": input.EntityID,
				"payload":  rawJSON(input.Payload),
			})
			if err != nil {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("create entity: %w", err)
			}
			return nil, DebugEntitiesOutput{Result: result}, nil

		case "timeline":
			if input.EntityID == "" {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("entity_id is required for timeline")
			}
			result, err := c.Get(fmt.Sprintf("%s/entities/%s/timeline", basePath, input.EntityID))
			if err != nil {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("get timeline: %w", err)
			}
			return nil, DebugEntitiesOutput{Result: result}, nil

		case "rollback":
			if input.EntityID == "" {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("entity_id is required for rollback")
			}
			if input.TargetEventID == "" {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("target_event_id is required for rollback")
			}
			result, err := c.Post(
				fmt.Sprintf("%s/entities/%s/rollback", basePath, input.EntityID),
				map[string]string{"targetEventId": input.TargetEventID},
			)
			if err != nil {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("rollback entity: %w", err)
			}
			return nil, DebugEntitiesOutput{Result: result}, nil

		case "rollback_all":
			result, err := c.Post(basePath+"/rollback-complete", nil)
			if err != nil {
				return nil, DebugEntitiesOutput{}, fmt.Errorf("rollback all: %w", err)
			}
			return nil, DebugEntitiesOutput{Result: result}, nil

		default:
			return nil, DebugEntitiesOutput{}, fmt.Errorf("unknown action %q; valid actions: list, create, timeline, rollback, rollback_all", input.Action)
		}
	}
}

func RegisterDataTools(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "mock_loom_manage_data_source",
		Description: `Manage data sources (in-memory JSON collections) for an integration.
Actions: list, create, upload_baseline (JSON array string), sync (reload from baseline), get_schema, delete.
Data sources store entity data that scenarios can read/mutate at runtime.`,
	}, manageDataSource(c))

	mcp.AddTool(server, &mcp.Tool{
		Name: "mock_loom_debug_entities",
		Description: `Inspect and manage entities in a data source.
Actions: list (paginated), create (manual entity), timeline (entity mutation history), rollback (entity to prior state), rollback_all (reset entire source to baseline).
Entities are the individual records inside a data source. Each mutation is tracked via event sourcing.`,
	}, debugEntities(c))
}
