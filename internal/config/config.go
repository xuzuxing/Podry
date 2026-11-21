package config

import (
	"errors"
	"github.com/xuzuxing/podry/internal/build"
	"github.com/xuzuxing/podry/internal/credential"
	"github.com/xuzuxing/podry/internal/release"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config 服务端运行配置。
type Config struct {
	// Env 是运行环境:"development"(默认)或 "production"。
	Env string
	// Addr 是 HTTP 监听地址,如 ":8080"。
	Addr string
	// ShutdownTimeout bounds HTTP, worker drain and database close together.
	ShutdownTimeout string
	// DataDir stores local controller identity and durable process journals.
	DataDir string
	// DatabaseURL 是服务角色连接，不在启动时执行 DDL。
	DatabaseURL string
	// MigrationDatabaseURL 是显式迁移命令使用的独立角色连接。
	MigrationDatabaseURL string
	// CredentialKey 是独立的 32 字节随机密钥的 Base64 表示；为空时凭据写入返回 503。
	CredentialKey string
	// Build enables the durable CI worker only when its execution inputs are configured.
	Build build.Settings
	// Release is opt-in; disabled workers perform no cluster I/O.
	Release release.Settings
	// URLPolicy scopes local HTTP Git/Registry access to explicit host:port pairs.
	URLPolicy credential.URLPolicy

	// JWTSecret 是 JWT 密钥。
	JWTSecret string
	// JWTRefreshSecret 是 JWT 刷新密钥。
	// Deprecated: V1 仅签发 Access Token，保留配置字段供旧环境文件兼容。
	JWTRefreshSecret string
	// JWTAccessTokenExpire 是 JWT 访问令牌过期时间。
	JWTAccessTokenExpire string
	// JWTRefreshTokenExpire 是 JWT 刷新令牌过期时间。
	// Deprecated: V1 不实现 Refresh Token 协议。
	JWTRefreshTokenExpire string
}

// Load 从环境变量读取配置，未设置时使用默认值。
func Load() Config {
	concurrency, _ := strconv.Atoi(getenv("PODRY_BUILD_CONCURRENCY", "1"))
	releaseConcurrency, _ := strconv.Atoi(getenv("PODRY_RELEASE_CONCURRENCY", "1"))
	httpHosts := []string{}
	for _, host := range strings.Split(getenv("PODRY_HTTP_ALLOWED_HOSTS", ""), ",") {
		if host = strings.TrimSpace(host); host != "" {
			httpHosts = append(httpHosts, host)
		}
	}
	return Config{
		Env:                  getenv("ENVIRONMENT", "development"),
		Addr:                 getenv("PODRY_SERVER_ADDR", ":5000"),
		ShutdownTimeout:      getenv("PODRY_SHUTDOWN_TIMEOUT", "30s"),
		DataDir:              getenv("PODRY_DATA_DIR", ".podry"),
		DatabaseURL:          getenv("DATABASE_URL", ""),
		MigrationDatabaseURL: getenv("DATABASE_MIGRATION_URL", ""),
		CredentialKey:        getenv("PODRY_CREDENTIAL_KEY", ""),
		URLPolicy:            credential.URLPolicy{AllowedHTTPHosts: httpHosts},
		Release:              release.Settings{Enabled: getenv("PODRY_RELEASE_ENABLED", "false") == "true", Concurrency: releaseConcurrency},
		Build:                build.Settings{Enabled: getenv("PODRY_BUILD_ENABLED", "false") == "true", ClusterID: getenv("PODRY_BUILD_CLUSTER_ID", ""), Namespace: getenv("PODRY_BUILD_NAMESPACE", ""), BuilderEndpoint: getenv("PODRY_BUILDKIT_ADDR", ""), RunnerImage: getenv("PODRY_BUILD_RUNNER_IMAGE", ""), Platform: getenv("PODRY_BUILD_PLATFORM", "linux/amd64"), Concurrency: concurrency, DataDir: getenv("PODRY_DATA_DIR", ".podry")},

		JWTSecret:             getenv("JWT_SECRET", "CHANGE_ME_IN_PRODUCTION"),
		JWTRefreshSecret:      getenv("JWT_REFRESH_SECRET", "CHANGE_ME_IN_PRODUCTION"),
		JWTAccessTokenExpire:  getenv("JWT_ACCESS_TOKEN_EXPIRE", "15m"),
		JWTRefreshTokenExpire: getenv("JWT_REFRESH_TOKEN_EXPIRE", "168h"),
	}
}

func (c Config) AccessTTL() (time.Duration, error) {
	ttl, err := time.ParseDuration(c.JWTAccessTokenExpire)
	if err != nil || ttl < time.Minute || ttl > 24*time.Hour {
		return 0, errors.New("JWT_ACCESS_TOKEN_EXPIRE must be between 1m and 24h")
	}
	return ttl, nil
}

func (c Config) ValidateServer() error {
	if _, err := c.ShutdownGrace(); err != nil {
		return err
	}
	for _, host := range c.URLPolicy.AllowedHTTPHosts {
		name, port, e := net.SplitHostPort(host)
		p, pe := strconv.Atoi(port)
		if e != nil || pe != nil || p < 1 || p > 65535 || name == "" || strings.ContainsAny(name, "*?/@") || credential.WebURL("http://"+host, true, true) != nil {
			return errors.New("PODRY_HTTP_ALLOWED_HOSTS must contain explicit host:port pairs")
		}
	}
	if err := c.Build.Validate(); err != nil {
		return err
	}
	if err := c.Release.Validate(); err != nil {
		return err
	}
	if c.Release.Enabled && c.CredentialKey == "" {
		return errors.New("PODRY_CREDENTIAL_KEY is required when releases are enabled")
	}
	if c.Build.Enabled && c.CredentialKey == "" {
		return errors.New("PODRY_CREDENTIAL_KEY is required when builds are enabled")
	}
	if c.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	if len(c.JWTSecret) < 32 || strings.Contains(c.JWTSecret, "CHANGE_ME") {
		return errors.New("JWT_SECRET must be an independent secret of at least 32 bytes")
	}
	_, err := c.AccessTTL()
	return err
}

func (c Config) ShutdownGrace() (time.Duration, error) {
	value := c.ShutdownTimeout
	if value == "" {
		value = "30s"
	}
	duration, err := time.ParseDuration(value)
	if err != nil || duration < time.Second || duration > 5*time.Minute {
		return 0, errors.New("PODRY_SHUTDOWN_TIMEOUT must be between 1s and 5m")
	}
	return duration, nil
}

func (c Config) MigrationURL() string {
	if c.MigrationDatabaseURL != "" {
		return c.MigrationDatabaseURL
	}
	return c.DatabaseURL
}

func getenv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
