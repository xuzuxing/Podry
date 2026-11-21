package resource

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/xuzuxing/podry/internal/httpx"
)

func TestTerminalWriterPreservesSplitUTF8AndBoundsOutput(t *testing.T) {
	var mu sync.Mutex
	var count int64
	output := ""
	var fault error
	w := &terminalWriter{ctx: context.Background(), mu: &mu, bytes: &count, send: func(v any) error {
		output += v.(map[string]any)["data"].(string)
		return nil
	}, fail: func(err error) { fault = err }}
	data := []byte(strings.Repeat("中", 6000) + "文")
	for _, chunk := range [][]byte{data[:1], data[1:5], data[5:]} {
		if _, err := w.Write(chunk); err != nil {
			t.Fatal(err)
		}
	}
	if output != string(data) {
		t.Fatal("UTF-8 lost across stream/frame boundaries")
	}
	count = 20 << 20
	if _, err := w.Write([]byte("x")); err == nil || fault == nil {
		t.Fatal("output budget not enforced")
	}
}

func TestTerminalWriterStopsWhenConsumerFails(t *testing.T) {
	var mu sync.Mutex
	var count int64
	failure := httpx.Fail(503, "consumer_closed", "closed")
	var fault error
	w := &terminalWriter{ctx: context.Background(), mu: &mu, bytes: &count, send: func(any) error { return failure }, fail: func(err error) { fault = err }}
	if _, err := w.Write([]byte("output")); err != failure || fault != failure {
		t.Fatal("failed consumer did not stop upstream")
	}
}

func TestTerminalOriginUsesExplicitTrust(t *testing.T) {
	s := &Service{}
	r := httptest.NewRequest("GET", "http://local.test/api/exec-sessions/id/connect", nil)
	r.Header.Set("Origin", "https://public.test")
	r.Header.Set("X-Forwarded-Host", "public.test")
	r.Header.Set("X-Forwarded-Proto", "https")
	if _, err := s.requestOrigin(r, true); err == nil {
		t.Fatal("untrusted forwarded origin accepted")
	}
	s.PublicOrigin = "https://public.test"
	if origin, err := s.requestOrigin(r, true); err != nil || origin != "https://public.test" {
		t.Fatal("configured proxy origin rejected", origin, err)
	}
	r.Header.Set("Origin", "http://local.test")
	if _, err := s.requestOrigin(r, true); err == nil {
		t.Fatal("internal host bypassed configured origin")
	}
	r.Header.Del("Origin")
	if _, err := s.requestOrigin(r, true); err == nil {
		t.Fatal("WebSocket without origin accepted")
	}
	if _, err := s.requestOrigin(r, false); err != nil {
		t.Fatal("CLI creation without Origin rejected", err)
	}
}
