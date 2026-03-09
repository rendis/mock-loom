package usecase

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/rendis/mock-loom/apps/api/internal/config"
)

type fakeRunner struct {
	run func(ctx context.Context, name string, args []string, stdin []byte) (string, string, error)
}

func (r *fakeRunner) Run(ctx context.Context, name string, args []string, stdin []byte) (string, string, error) {
	return r.run(ctx, name, args, stdin)
}

func TestParseOpenAPIRoutes(t *testing.T) {
	svc := &IntegrationService{
		importCfg: config.ImportConfig{TimeoutSeconds: 1},
		runner:    &fakeRunner{},
	}

	openapiPayload := `openapi: 3.0.3
info:
  title: test
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        "200":
          description: ok
    post:
      responses:
        "201":
          description: created
`
	routes, warnings, err := svc.parseOpenAPIRoutes(context.Background(), []byte(openapiPayload))
	if err != nil {
		t.Fatalf("expected valid OpenAPI payload, got error: %v", err)
	}
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings, got: %v", warnings)
	}
	if len(routes) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(routes))
	}

	_, _, err = svc.parseOpenAPIRoutes(context.Background(), []byte(`{`))
	if err == nil {
		t.Fatal("expected invalid OpenAPI error")
	}
	if !errors.Is(err, ErrSemanticValidation) {
		t.Fatalf("expected semantic validation error, got: %v", err)
	}
}

func TestConvertPostmanToOpenAPI(t *testing.T) {
	svc := &IntegrationService{
		importCfg: config.ImportConfig{
			TimeoutSeconds: 1,
			PostmanCLIPath: "p2o",
		},
	}

	svc.runner = &fakeRunner{
		run: func(_ context.Context, _ string, args []string, _ []byte) (string, string, error) {
			if len(args) < 3 || args[1] != "-f" {
				t.Fatalf("unexpected args: %v", args)
			}
			outputPath := args[2]
			doc := `openapi: 3.0.3
info:
  title: from-postman
  version: 1.0.0
paths:
  /postman:
    get:
      responses:
        "200":
          description: ok
`
			if err := os.WriteFile(outputPath, []byte(doc), 0o600); err != nil {
				t.Fatalf("write fake converter output: %v", err)
			}
			return "", "", nil
		},
	}

	converted, err := svc.convertPostmanToOpenAPI(context.Background(), `{"info":{"name":"demo"}}`)
	if err != nil {
		t.Fatalf("expected successful conversion, got error: %v", err)
	}
	if !strings.Contains(string(converted), "openapi: 3.0.3") {
		t.Fatalf("unexpected conversion output: %s", string(converted))
	}

	svc.runner = &fakeRunner{
		run: func(_ context.Context, _ string, _ []string, _ []byte) (string, string, error) {
			return "", "invalid postman", errors.New("exit status 1")
		},
	}
	_, err = svc.convertPostmanToOpenAPI(context.Background(), `{}`)
	if err == nil {
		t.Fatal("expected postman conversion failure")
	}
	if !errors.Is(err, ErrSemanticValidation) {
		t.Fatalf("expected semantic validation error, got: %v", err)
	}
}

func TestConvertCurlToRoute(t *testing.T) {
	svc := &IntegrationService{
		importCfg: config.ImportConfig{
			TimeoutSeconds: 1,
			CurlCLIPath:    "curlconverter",
		},
	}

	svc.runner = &fakeRunner{
		run: func(_ context.Context, _ string, _ []string, _ []byte) (string, string, error) {
			return `{"url":"https://api.example.com/v1/orders","method":"post"}`, "", nil
		},
	}
	routes, warnings, err := svc.convertCurlToRoute(context.Background(), `curl -X POST https://api.example.com/v1/orders`)
	if err != nil {
		t.Fatalf("expected successful cURL conversion, got error: %v", err)
	}
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings, got %v", warnings)
	}
	if len(routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(routes))
	}
	if routes[0].Method != "POST" || routes[0].Path != "/v1/orders" {
		t.Fatalf("unexpected route result: %+v", routes[0])
	}

	svc.runner = &fakeRunner{
		run: func(_ context.Context, _ string, _ []string, _ []byte) (string, string, error) {
			return "{", "", nil
		},
	}
	_, _, err = svc.convertCurlToRoute(context.Background(), `curl https://api.example.com`)
	if err == nil {
		t.Fatal("expected cURL conversion failure")
	}
	if !errors.Is(err, ErrSemanticValidation) {
		t.Fatalf("expected semantic validation error, got: %v", err)
	}
}
