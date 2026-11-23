package release

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestHelmTransportKeepsResponseReadableAndStopsCancelledRequests(t *testing.T) {
	var observed context.Context
	step, cancel := context.WithCancel(context.Background())
	defer cancel()
	transport := boundTransport{step, transportFunc(func(r *http.Request) (*http.Response, error) {
		observed = r.Context()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("response"))}, nil
	})}
	req, _ := http.NewRequest(http.MethodGet, "https://unused.example.test", nil)
	response, err := transport.RoundTrip(req)
	if err != nil || observed.Err() != nil {
		t.Fatal("request was cancelled before consuming its body", err)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "response" || observed.Err() == nil {
		t.Fatal("body read or completion cleanup failed", err)
	}
	_ = response.Body.Close()

	request, cancelRequest := context.WithCancel(context.Background())
	cancelRequest()
	transport.base = transportFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("already cancelled request reached the API transport")
		return nil, nil
	})
	if _, err := transport.RoundTrip(req.WithContext(request)); !errors.Is(err, context.Canceled) {
		t.Fatal("request cancellation was discarded", err)
	}
}

func TestHelmDiagnosticsDoNotExposeRequestOrErrorContents(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	const secret = "sensitive-fixture-value"
	req, _ := http.NewRequest(http.MethodPatch,
		"https://"+secret+".example.test/api/v1/namespaces/"+secret+"/secrets/"+secret+"?token="+secret,
		strings.NewReader(secret))
	req.Header.Set("Authorization", secret)
	transport := tracedTransport{deploymentID: "execution-id", base: transportFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("rendered Secret: " + secret)
	})}
	_, _ = transport.RoundTrip(req)
	if strings.Contains(output.String(), secret) {
		t.Fatal("HTTP diagnostics leaked request data or error text")
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("missing HTTP boundary diagnostics: %d", len(lines))
	}
	var record map[string]any
	if err := json.Unmarshal([]byte(lines[1]), &record); err != nil {
		t.Fatal(err)
	}
	if record["level"] != "WARN" || record["resource"] != "secrets" || record["method"] != "PATCH" || record["error_class"] != "error" {
		t.Fatalf("missing safe error classification: %v", record)
	}

	for _, fixture := range []struct{ path, resource string }{
		{"/api", "discovery"}, {"/apis/apps/v1", "discovery"},
		{"/api/v1/namespaces/test/secrets/sh.helm.release.v1.test.v2", "helm_storage"},
		{"/apis/apps/v1/namespaces/test/deployments/test", "deployments"},
		{"/apis/batch/v1/namespaces/test/jobs/test", "jobs"},
		{"/private/" + secret, "other"},
	} {
		req, _ := http.NewRequest(http.MethodGet, "https://unused.example.test"+fixture.path, nil)
		if _, resource := requestClass(req); resource != fixture.resource {
			t.Fatalf("request resource classification: got %q, want %q", resource, fixture.resource)
		}
	}
}

// Use a real HTTP client: its timeout includes reading the response body, after
// RoundTrip has returned. Both that timeout and the fenced step must still work.
func TestHelmTransportCancellationDuringResponseBody(t *testing.T) {
	for _, source := range []string{"request", "step", "client-timeout"} {
		t.Run(source, func(t *testing.T) {
			started := make(chan struct{})
			api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				w.(http.Flusher).Flush()
				close(started)
				<-r.Context().Done()
			}))
			defer api.Close()
			step, cancelStep := context.WithCancel(context.Background())
			defer cancelStep()
			request, cancelRequest := context.WithCancel(context.Background())
			defer cancelRequest()
			base := http.DefaultTransport.(*http.Transport).Clone()
			defer base.CloseIdleConnections()
			client := &http.Client{Transport: boundTransport{step, base}}
			if source == "client-timeout" {
				client.Timeout = 150 * time.Millisecond
			}
			req, _ := http.NewRequestWithContext(request, http.MethodGet, api.URL, nil)
			response, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			<-started
			done := make(chan error, 1)
			go func() { _, err := io.ReadAll(response.Body); done <- err }()
			if source == "request" {
				cancelRequest()
			} else if source == "step" {
				cancelStep()
			}
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("cancelled body read succeeded")
				}
				if source == "client-timeout" && !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("client deadline was lost: %v", err)
				}
			case <-time.After(2 * time.Second):
				cancelStep() // Unblock the server even against the old implementation.
				_ = response.Body.Close()
				t.Fatal("HTTP request cancellation was lost")
			}
		})
	}
}
