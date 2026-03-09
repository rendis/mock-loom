package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"
)

// Client is a thin HTTP client for the mock-loom API.
type Client struct {
	baseURL    string
	authToken  string
	httpClient *http.Client
}

// New creates a Client pointing at the given API base URL.
func New(baseURL, authToken string) *Client {
	return &Client{
		baseURL:   baseURL,
		authToken: authToken,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Healthy pings the /health endpoint. Returns nil on success.
func (c *Client) Healthy() error {
	resp, err := c.do("GET", "/health", nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check returned %d", resp.StatusCode)
	}
	return nil
}

// Get performs a GET request to the API v1 path and returns parsed JSON.
func (c *Client) Get(path string) (any, error) {
	return c.request("GET", "/api/v1"+path, nil)
}

// Post performs a POST request with JSON body.
func (c *Client) Post(path string, body any) (any, error) {
	return c.request("POST", "/api/v1"+path, body)
}

// Put performs a PUT request with JSON body.
func (c *Client) Put(path string, body any) (any, error) {
	return c.request("PUT", "/api/v1"+path, body)
}

// Patch performs a PATCH request with JSON body.
func (c *Client) Patch(path string, body any) (any, error) {
	return c.request("PATCH", "/api/v1"+path, body)
}

// Delete performs a DELETE request.
func (c *Client) Delete(path string) error {
	resp, err := c.do("DELETE", "/api/v1"+path, nil, "application/json")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return parseAPIError(resp)
	}
	return nil
}

// PostMultipartJSON sends a JSON string as a multipart file upload.
// fieldName is the form field name, fileName is the virtual file name,
// jsonContent is the raw JSON content to upload.
func (c *Client) PostMultipartJSON(path, fieldName, fileName, jsonContent string) (any, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	part, err := w.CreateFormFile(fieldName, fileName)
	if err != nil {
		return nil, fmt.Errorf("create form file: %w", err)
	}
	if _, err := part.Write([]byte(jsonContent)); err != nil {
		return nil, fmt.Errorf("write form file: %w", err)
	}
	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("close multipart writer: %w", err)
	}

	resp, err := c.do("POST", "/api/v1"+path, &buf, w.FormDataContentType())
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, parseAPIError(resp)
	}
	return decodeJSON(resp)
}

// MockRequest sends a request to the runtime gateway /mock/... endpoint.
func (c *Client) MockRequest(method, path string, headers map[string]string, body []byte) (int, map[string]string, []byte, error) {
	var bodyReader io.Reader
	if len(body) > 0 {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("create request: %w", err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("Content-Type") == "" && len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("mock request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("read response body: %w", err)
	}

	respHeaders := make(map[string]string)
	for k := range resp.Header {
		respHeaders[k] = resp.Header.Get(k)
	}

	return resp.StatusCode, respHeaders, respBody, nil
}

func (c *Client) request(method, path string, body any) (any, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	resp, err := c.do(method, path, bodyReader, "application/json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return map[string]any{"status": "ok"}, nil
	}
	if resp.StatusCode >= 400 {
		return nil, parseAPIError(resp)
	}
	return decodeJSON(resp)
}

func (c *Client) do(method, path string, body io.Reader, contentType string) (*http.Response, error) {
	req, err := http.NewRequest(method, c.baseURL+path, body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return c.httpClient.Do(req)
}

func decodeJSON(resp *http.Response) (any, error) {
	var result any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}
