package usecase

import (
	"errors"
	"strings"
	"testing"

	"github.com/rendis/mock-loom/apps/api/internal/core/entity"
)

func TestParseCSVBaselineRequiresHeader(t *testing.T) {
	_, _, err := parseBaselinePayload(entity.DataSourceKindCSV, "baseline.csv", []byte(""), baselineParseOptions{})
	if err == nil {
		t.Fatal("expected error for empty csv payload")
	}
}

func TestParseCSVBaselineAcceptsCustomDelimiter(t *testing.T) {
	payload := []byte("id;name\n1;alice\n2;bob\n")
	rows, _, err := parseBaselinePayload(
		entity.DataSourceKindCSV,
		"baseline.csv",
		payload,
		baselineParseOptions{CSVDelimiter: "semicolon"},
	)
	if err != nil {
		t.Fatalf("expected semicolon delimiter payload to parse, got %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	if rows[1]["name"] != "bob" {
		t.Fatalf("expected row name bob, got %v", rows[1]["name"])
	}
}

func TestParseCSVBaselineRejectsInvalidDelimiter(t *testing.T) {
	_, _, err := parseBaselinePayload(
		entity.DataSourceKindCSV,
		"baseline.csv",
		[]byte("id,name\n1,alice\n"),
		baselineParseOptions{CSVDelimiter: "::"},
	)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input error for delimiter, got %v", err)
	}
}

func TestParseJSONBaselineRejectsHeterogeneousRows(t *testing.T) {
	payload := []byte(`[
		{"id": "1", "name": "alice"},
		{"id": "2", "name": 42}
	]`)
	_, _, err := parseBaselinePayload(entity.DataSourceKindJSON, "baseline.json", payload, baselineParseOptions{})
	if err == nil {
		t.Fatal("expected heterogeneous rows to fail validation")
	}
	if !strings.Contains(err.Error(), "shape") {
		t.Fatalf("expected schema shape error, got %v", err)
	}
}

func TestResolveEntityIDDeterministicForMissingID(t *testing.T) {
	row := map[string]any{"name": "alice", "amount": 12.5}
	left := resolveEntityID(row, "source-1", 0)
	right := resolveEntityID(row, "source-1", 0)
	if left == "" {
		t.Fatal("expected deterministic id")
	}
	if left != right {
		t.Fatalf("expected deterministic id, got %q and %q", left, right)
	}
}
