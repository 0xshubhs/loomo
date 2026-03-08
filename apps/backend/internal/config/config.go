package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	// Server
	Port        int
	Host        string
	Environment string

	// Database
	DatabaseURL string

	// JWT
	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration

	// S3/R2
	S3Endpoint       string
	S3AccessKey      string
	S3SecretKey      string
	S3Bucket         string
	S3Region         string
	S3ForcePathStyle bool
	CDNURL           string

	// OAuth
	GoogleClientID     string
	GoogleClientSecret string

	// OpenAI
	OpenAIAPIKey string

	// Frontend
	FrontendURL    string
	AllowedOrigins []string
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:            getEnvInt("BACKEND_PORT", 8080),
		Host:            getEnv("BACKEND_HOST", "0.0.0.0"),
		Environment:     getEnv("ENVIRONMENT", "development"),
		DatabaseURL:     getEnv("DATABASE_URL", "postgres://dittoo:dittoo_dev@localhost:5432/dittoo?sslmode=disable"),
		JWTSecret:       getEnv("JWT_SECRET", "dev-secret-change-in-production"),
		AccessTokenTTL:  getEnvDuration("JWT_ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL: getEnvDuration("JWT_REFRESH_TOKEN_TTL", 720*time.Hour),
		S3Endpoint:      getEnv("S3_ENDPOINT", "http://localhost:9000"),
		S3AccessKey:     getEnv("S3_ACCESS_KEY", "minioadmin"),
		S3SecretKey:     getEnv("S3_SECRET_KEY", "minioadmin"),
		S3Bucket:        getEnv("S3_BUCKET_NAME", "dittoo-videos"),
		S3Region:        getEnv("S3_REGION", "us-east-1"),
		S3ForcePathStyle: getEnvBool("S3_FORCE_PATH_STYLE", true),
		CDNURL:          getEnv("CDN_URL", "http://localhost:9000/dittoo-videos"),
		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		OpenAIAPIKey:       getEnv("OPENAI_API_KEY", ""),
		FrontendURL:        getEnv("PUBLIC_APP_URL", "http://localhost:5173"),
	}

	origins := getEnv("ALLOWED_ORIGINS", cfg.FrontendURL)
	cfg.AllowedOrigins = strings.Split(origins, ",")

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
