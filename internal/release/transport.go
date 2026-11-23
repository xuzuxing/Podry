package release

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

type boundTransport struct {
	context context.Context
	base    http.RoundTripper
}

func (t boundTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if err := t.context.Err(); err != nil {
		return nil, err
	}
	if err := r.Context().Err(); err != nil {
		return nil, err
	}
	// Helm's action goroutines may outlive RunWithContext. Bind every request to
	// the step context so they cannot start later writes after lease expiry.
	// Also retain the request's own deadline/cancellation (including client-go's
	// HTTP timeout). Keep the binding alive until the response body is consumed.
	ctx, cancel := context.WithCancel(r.Context())
	stop := context.AfterFunc(t.context, cancel)
	cleanup := func() { stop(); cancel() }
	// AfterFunc runs asynchronously when its context is already done.
	if err := t.context.Err(); err != nil {
		cleanup()
		return nil, err
	}
	response, err := t.base.RoundTrip(r.Clone(ctx))
	if err != nil || response == nil || response.Body == nil {
		cleanup()
		return response, err
	}
	response.Body = &boundBody{ReadCloser: response.Body, cleanup: cleanup}
	return response, nil
}

type boundBody struct {
	io.ReadCloser
	cleanup func()
}

func (b *boundBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if err != nil {
		b.cleanup()
	}
	return n, err
}

func (b *boundBody) Close() error {
	err := b.ReadCloser.Close()
	b.cleanup()
	return err
}

func safeErrorClass(err error) string {
	switch {
	case err == nil:
		return "none"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline"
	case errors.Is(err, context.Canceled):
		return "canceled"
	default:
		var network net.Error
		if errors.As(err, &network) && network.Timeout() {
			return "timeout"
		}
		return "error"
	}
}

// Only fixed vocabulary leaves this boundary. Never log a URL, object name,
// query, headers, error message, request body or response body from Helm.
func requestClass(r *http.Request) (method, resource string) {
	method = "other"
	switch r.Method {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE":
		method = r.Method
	}
	resource = "other"
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if (len(parts) <= 2 && parts[0] == "api") || (len(parts) <= 3 && parts[0] == "apis") {
		return method, "discovery"
	}
	index := 4
	if len(parts) > 1 && parts[0] == "apis" {
		index = 5
	}
	if len(parts) <= index || parts[index-2] != "namespaces" {
		return method, resource
	}
	switch parts[index] {
	case "secrets", "services", "deployments", "jobs", "ingresses", "pods":
		resource = parts[index]
	}
	if resource == "secrets" && len(parts) > index+1 && strings.HasPrefix(parts[index+1], "sh.helm.release.v1.") {
		resource = "helm_storage"
	}
	return method, resource
}

type tracedTransport struct {
	base         http.RoundTripper
	deploymentID string
}

func (t tracedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	start := time.Now()
	method, resource := requestClass(r)
	logger := slog.Default().With("deployment_id", t.deploymentID, "method", method, "resource", resource)
	logger.DebugContext(r.Context(), "release HTTP started")
	response, err := t.base.RoundTrip(r)
	status := 0
	if response != nil {
		status = response.StatusCode
	}
	level := slog.LevelDebug
	if err != nil || status >= 400 {
		level = slog.LevelWarn
		// Missing resources are expected during install and upgrade preflight.
		if err == nil && status == http.StatusNotFound {
			level = slog.LevelDebug
		}
	}
	logger.Log(r.Context(), level, "release HTTP headers", "status", status,
		"error_class", safeErrorClass(err), "duration_ms", time.Since(start).Milliseconds())
	return response, err
}
