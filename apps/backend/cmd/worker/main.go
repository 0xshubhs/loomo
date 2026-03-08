package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/dittoo/backend/internal/config"
	"github.com/dittoo/backend/internal/worker"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/rs/zerolog"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	logger := zerolog.New(os.Stdout).With().Timestamp().Logger()
	if cfg.Environment == "development" {
		logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stdout}).With().Timestamp().Logger()
	}

	// Check that ffmpeg is available
	if err := worker.EnsureFFmpeg(); err != nil {
		logger.Fatal().Err(err).Msg("ffmpeg is required but not found")
	}
	logger.Info().Msg("ffmpeg found in PATH")

	// Database connection
	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer pool.Close()

	if err := pool.Ping(context.Background()); err != nil {
		logger.Fatal().Err(err).Msg("failed to ping database")
	}
	logger.Info().Msg("connected to database")

	// Run River migrations
	if err := worker.RunRiverMigrations(context.Background(), pool, logger); err != nil {
		logger.Fatal().Err(err).Msg("failed to run river migrations")
	}

	// Create S3 client
	s3Client := s3.New(s3.Options{
		BaseEndpoint: aws.String(cfg.S3Endpoint),
		Region:       cfg.S3Region,
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		UsePathStyle: cfg.S3ForcePathStyle,
	})

	// Register workers
	workers := river.NewWorkers()
	river.AddWorker(workers, &worker.TranscodeWorker{
		Pool:     pool,
		S3Client: s3Client,
		S3Bucket: cfg.S3Bucket,
		Logger:   logger,
	})
	river.AddWorker(workers, &worker.ThumbnailWorker{
		Pool:     pool,
		S3Client: s3Client,
		S3Bucket: cfg.S3Bucket,
		Logger:   logger,
	})
	river.AddWorker(workers, &worker.TranscribeWorker{
		Pool:     pool,
		S3Client: s3Client,
		S3Bucket: cfg.S3Bucket,
		Logger:   logger,
	})

	// Create River client
	riverClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: 5},
		},
		Workers: workers,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create river client")
	}

	// Start the River client
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := riverClient.Start(ctx); err != nil {
		logger.Fatal().Err(err).Msg("failed to start river client")
	}
	logger.Info().Msg("worker started — processing video jobs")

	// Graceful shutdown on SIGINT/SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info().Msg("shutting down worker...")
	cancel()

	logger.Info().Msg("worker stopped")
}
