package usecase

import "testing"

func TestNormalizeEndpointPathCanonicalizesTemplateSyntax(t *testing.T) {
	path, err := normalizeEndpointPath("/users/{User-Id}/orders/:Order ID")
	if err != nil {
		t.Fatalf("normalizeEndpointPath returned error: %v", err)
	}
	if path != "/users/:User_Id/orders/:Order_ID" {
		t.Fatalf("unexpected normalized path %q", path)
	}
}

func TestNormalizeEndpointPathRejectsQueryString(t *testing.T) {
	if _, err := normalizeEndpointPath("/users/:id?status=active"); err == nil {
		t.Fatal("expected query string path to be rejected")
	}
}

func TestComposePackEndpointPathWithTemplateSegments(t *testing.T) {
	path, err := composePackEndpointPath("/org/:orgId", "/users/{userId}")
	if err != nil {
		t.Fatalf("composePackEndpointPath returned error: %v", err)
	}
	if path != "/org/:orgId/users/:userId" {
		t.Fatalf("unexpected composed path %q", path)
	}
}

func TestIncludesPackBasePath(t *testing.T) {
	if !includesPackBasePath("/v1/users", "/v1") {
		t.Fatal("expected includesPackBasePath to detect base path prefix")
	}
	if includesPackBasePath("/users", "/v1") {
		t.Fatal("did not expect includesPackBasePath for unrelated relative path")
	}
}

func TestToRelativeEndpointPath(t *testing.T) {
	relative, err := toRelativeEndpointPath("/v1/orders/:id", "/v1")
	if err != nil {
		t.Fatalf("toRelativeEndpointPath returned error: %v", err)
	}
	if relative != "/orders/:id" {
		t.Fatalf("unexpected relative path %q", relative)
	}
}
