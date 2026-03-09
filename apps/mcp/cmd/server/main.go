package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rendis/mock-loom/apps/mcp/internal/client"
	"github.com/rendis/mock-loom/apps/mcp/internal/tools"
)

func main() {
	apiBaseURL := os.Getenv("MOCK_LOOM_API_BASE_URL")
	if apiBaseURL == "" {
		apiBaseURL = "http://127.0.0.1:18081"
	}
	authToken := os.Getenv("MOCK_LOOM_AUTH_TOKEN")
	if authToken == "" {
		authToken = "dummy-token"
	}

	httpClient := client.New(apiBaseURL, authToken)

	// Health check: warn if API is unreachable but don't block startup.
	if err := httpClient.Healthy(); err != nil {
		fmt.Fprintf(os.Stderr, "[mock-loom-mcp] WARNING: API at %s is unreachable: %v\n", apiBaseURL, err)
		fmt.Fprintf(os.Stderr, "[mock-loom-mcp] Tools will fail until the API is available. Start it with: make run-dummy\n")
	}

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "mock-loom",
		Version: "0.1.0",
	}, nil)

	tools.RegisterAll(server, httpClient)

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatalf("[mock-loom-mcp] server error: %v", err)
	}
}
