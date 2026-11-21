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

func TestHealthPollingOptIn(t *testing.T) {
	t.Setenv("PODRY_HEALTH_POLLING_ENABLED", "")
	if Load().HealthPollingEnabled {
		t.Fatal("background cluster access enabled by default")
	}
	t.Setenv("PODRY_HEALTH_POLLING_ENABLED", "true")
	if !Load().HealthPollingEnabled {
		t.Fatal("health polling opt-in was not loaded")
	}
	c := Config{DatabaseURL: "postgres://fixture", JWTSecret: "12345678901234567890123456789012xx", JWTAccessTokenExpire: "15m", HealthPollingEnabled: true}
	if err := c.ValidateServer(); err == nil {
		t.Fatal("health polling accepted a missing credential key")
	}
	c.CredentialKey = "present"
	if err := c.ValidateServer(); err != nil {
		t.Fatal("independent read-only polling configuration rejected", err)
	}
}

func TestPublicOriginIsExact(t *testing.T) {
	c := Config{DatabaseURL: "postgres://fixture", JWTSecret: "12345678901234567890123456789012xx", JWTAccessTokenExpire: "15m"}
	for _, origin := range []string{"", "http://localhost:8080", "https://podry.example.test"} {
		c.PublicOrigin = origin
		if err := c.ValidateServer(); err != nil {
			t.Fatalf("valid origin %q: %v", origin, err)
		}
	}
	for _, origin := range []string{"*", "https://user:password@podry.test", "https://podry.test/", "https://podry.test/path", "https://podry.test?", "https://podry.test#", "javascript:alert(1)", "https://podry.test/?origin=foreign"} {
		c.PublicOrigin = origin
		if err := c.ValidateServer(); err == nil {
			t.Fatalf("unsafe origin %q accepted", origin)
		}
	}
	t.Setenv("PODRY_PUBLIC_ORIGIN", "https://podry.example.test")
	if Load().PublicOrigin != "https://podry.example.test" {
		t.Fatal("public origin was not loaded")
	}
}
