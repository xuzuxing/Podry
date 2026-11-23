package config

import (
	"testing"
	"time"

	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/cleanup"
)

func TestCleanupOptInAndRetention(t *testing.T) {
	t.Setenv("PODRY_RESOURCE_CLEANUP_ENABLED", "")
	t.Setenv("PODRY_BUILD_RESOURCE_RETENTION", "")
	t.Setenv("PODRY_RELEASE_RESOURCE_RETENTION", "")
	c := Load()
	if c.Cleanup.Enabled || c.Cleanup.BuildRetention != 24*time.Hour || c.Cleanup.ReleaseRetention != 168*time.Hour {
		t.Fatal("unsafe cleanup defaults")
	}
	t.Setenv("PODRY_RESOURCE_CLEANUP_ENABLED", "true")
	t.Setenv("PODRY_BUILD_RESOURCE_RETENTION", "48h")
	c = Load()
	if !c.Cleanup.Enabled || c.Cleanup.BuildRetention != 48*time.Hour {
		t.Fatal("cleanup settings not loaded")
	}
	c = Config{DatabaseURL: "postgres://fixture", JWTSecret: "12345678901234567890123456789012xx", JWTAccessTokenExpire: "15m", Build: build.Settings{DataDir: ".podry"}, Cleanup: c.Cleanup}
	if c.ValidateServer() == nil {
		t.Fatal("missing key accepted")
	}
	c.CredentialKey = "present"
	if err := c.ValidateServer(); err != nil {
		t.Fatal("cleanup requires submission workers", err)
	}
	for _, settings := range []cleanup.Settings{
		{Enabled: true, BuildRetention: 59 * time.Minute, ReleaseRetention: 168 * time.Hour},
		{Enabled: true, BuildRetention: time.Hour, ReleaseRetention: 167 * time.Hour},
		{Enabled: true, BuildRetention: 2161 * time.Hour, ReleaseRetention: 168 * time.Hour},
		{Enabled: true, BuildRetention: time.Hour, ReleaseRetention: 2161 * time.Hour},
	} {
		if settings.Validate() == nil {
			t.Fatal("unsafe retention accepted")
		}
	}
	t.Setenv("PODRY_RELEASE_RESOURCE_RETENTION", "invalid")
	if Load().Cleanup.Validate() == nil {
		t.Fatal("invalid duration silently defaulted")
	}
}
