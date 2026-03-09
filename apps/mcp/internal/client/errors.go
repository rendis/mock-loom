package client

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// APIError represents a parsed error from the mock-loom API.
type APIError struct {
	StatusCode int
	Message    string
	Details    any
}

func (e *APIError) Error() string {
	if e.Details != nil {
		return fmt.Sprintf("API %d: %s (details: %v)", e.StatusCode, e.Message, e.Details)
	}
	return fmt.Sprintf("API %d: %s", e.StatusCode, e.Message)
}

func parseAPIError(resp *http.Response) *APIError {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return &APIError{
			StatusCode: resp.StatusCode,
			Message:    fmt.Sprintf("HTTP %d (failed to read body)", resp.StatusCode),
		}
	}

	var parsed struct {
		Error   string `json:"error"`
		Details any    `json:"details"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return &APIError{
			StatusCode: resp.StatusCode,
			Message:    fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(body)),
		}
	}

	msg := parsed.Error
	if msg == "" {
		msg = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}

	return &APIError{
		StatusCode: resp.StatusCode,
		Message:    msg,
		Details:    parsed.Details,
	}
}
