package config

import (
	"os"
	"strings"
)

// Config 服务端运行配置。
type Config struct {
	// Env 是运行环境:"development"(默认)或 "production"。
	Env string
	// Addr 是 HTTP 监听地址,如 ":8080"。
	Addr string
	// DataDir stores local controller identity and durable process journals.
	DataDir string

	// JWTSecret 是 JWT 密钥。
	JWTSecret string
	// JWTRefreshSecret 是 JWT 刷新密钥。
	JWTRefreshSecret string
	// JWTAccessTokenExpire 是 JWT 访问令牌过期时间。
	JWTAccessTokenExpire string
	// JWTRefreshTokenExpire 是 JWT 刷新令牌过期时间。
	JWTRefreshTokenExpire string
}

// Load 从环境变量读取配置，未设置时使用默认值。
func Load() Config {
	return Config{
		Env:     getenv("ENVIRONMENT", "development"),
		Addr:    getenv("PODRY_SERVER_ADDR", ":5000"),
		DataDir: getenv("PODRY_DATA_DIR", ".podry"),

		JWTSecret:             getenv("JWT_SECRET", "CHANGE_ME_IN_PRODUCTION"),
		JWTRefreshSecret:      getenv("JWT_REFRESH_SECRET", "CHANGE_ME_IN_PRODUCTION"),
		JWTAccessTokenExpire:  getenv("JWT_ACCESS_TOKEN_EXPIRE", "15m"),
		JWTRefreshTokenExpire: getenv("JWT_REFRESH_TOKEN_EXPIRE", "168h"),
	}
}

func getenv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
