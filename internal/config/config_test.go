package config

import (
	"testing"
	"time"
)

func TestShutdownGrace(t *testing.T) {
	for _, value := range []string{"", "1s", "30s", "5m"} {
		duration, err := (Config{ShutdownTimeout: value}).ShutdownGrace()
		if err != nil || duration < time.Second || duration > 5*time.Minute {
			t.Fatalf("valid shutdown timeout %q rejected", value)
		}
	}
	for _, value := range []string{"0", "-1s", "500ms", "301s", "invalid"} {
		if _, err := (Config{ShutdownTimeout: value}).ShutdownGrace(); err == nil {
			t.Fatalf("invalid shutdown timeout %q accepted", value)
		}
	}
	t.Setenv("PODRY_SHUTDOWN_TIMEOUT", "47s")
	if got := Load().ShutdownTimeout; got != "47s" {
		t.Fatalf("shutdown timeout override not loaded: %q", got)
	}
}
