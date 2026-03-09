package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rendis/mock-loom/apps/mcp/internal/auth"
	"github.com/rendis/mock-loom/apps/mcp/internal/client"
	"github.com/rendis/mock-loom/apps/mcp/internal/tools"
)

func main() {
	apiBaseURL := os.Getenv("MOCK_LOOM_API_BASE_URL")
	if apiBaseURL == "" {
		apiBaseURL = "http://127.0.0.1:18081"
	}

	// Subcommand routing
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "login":
			if err := auth.RunLogin(apiBaseURL); err != nil {
				log.Fatalf("[mock-loom-mcp] login failed: %v", err)
			}
			return
		case "logout":
			if err := auth.RunLogout(); err != nil {
				log.Fatalf("[mock-loom-mcp] logout failed: %v", err)
			}
			return
		case "status":
			if err := auth.RunStatus(); err != nil {
				log.Fatalf("[mock-loom-mcp] status failed: %v", err)
			}
			return
		}
	}

	// MCP server mode
	tp := resolveTokenProvider()

	httpClient := client.New(apiBaseURL, tp)

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

func resolveTokenProvider() auth.TokenProvider {
	// Explicit token env var takes priority (dummy-auth or manually provided token).
	if token := os.Getenv("MOCK_LOOM_AUTH_TOKEN"); token != "" {
		return auth.NewStaticTokenProvider(token)
	}

	// Try OIDC tokens from local file.
	tp, err := auth.NewOIDCTokenProvider(auth.TokenFilePath())
	if err != nil {
		fmt.Fprintf(os.Stderr, "[mock-loom-mcp] WARNING: %v\n", err)
		fmt.Fprintf(os.Stderr, "[mock-loom-mcp] Falling back to unauthenticated mode. API calls will likely fail.\n")
		return auth.NewStaticTokenProvider("")
	}
	return tp
}
