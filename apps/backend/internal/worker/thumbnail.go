package worker

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/rs/zerolog"
)

// ThumbnailWorker handles thumbnail and GIF preview generation.
type ThumbnailWorker struct {
	river.WorkerDefaults[ThumbnailArgs]
	Pool     *pgxpool.Pool
	S3Client *s3.Client
	S3Bucket string
	Logger   zerolog.Logger
}

func (w *ThumbnailWorker) Timeout(job *river.Job[ThumbnailArgs]) time.Duration {
	return 5 * time.Minute
}

func (w *ThumbnailWorker) Work(ctx context.Context, job *river.Job[ThumbnailArgs]) error {
	args := job.Args
	logger := w.Logger.With().
		Str("video_id", args.VideoID).
		Str("job", "thumbnail").
		Logger()

	logger.Info().Msg("starting thumbnail job")

	// Mark processing job as running
	_, err := w.Pool.Exec(ctx,
		`UPDATE processing_jobs SET status = 'running', started_at = NOW()
		 WHERE video_id = $1 AND type = 'thumbnail' AND status = 'pending'`,
		args.VideoID,
	)
	if err != nil {
		logger.Error().Err(err).Msg("failed to update processing job status")
	}

	// Create temp working directory
	tmpDir, err := os.MkdirTemp("", "thumbnail-"+args.VideoID+"-*")
	if err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("create temp dir: %w", err))
	}
	defer os.RemoveAll(tmpDir)

	// Download source file
	sourcePath := filepath.Join(tmpDir, "source.webm")
	logger.Info().Str("source_key", args.SourceKey).Msg("downloading source from S3")
	if err := DownloadFromS3(ctx, w.S3Client, w.S3Bucket, args.SourceKey, sourcePath); err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("download source: %w", err))
	}

	keyPrefix := "videos/" + args.UserID + "/" + args.VideoID

	// Generate thumbnail at 2 seconds
	thumbnailPath := filepath.Join(tmpDir, "thumbnail.jpg")
	err = RunFFmpeg(ctx, logger,
		"-i", sourcePath,
		"-ss", "2",
		"-vframes", "1",
		"-vf", "scale=640:-1",
		thumbnailPath,
	)
	if err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("ffmpeg thumbnail: %w", err))
	}

	// Upload thumbnail
	thumbnailKey := keyPrefix + "/thumbnail.jpg"
	if err := UploadToS3(ctx, w.S3Client, w.S3Bucket, thumbnailKey, thumbnailPath, "image/jpeg"); err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("upload thumbnail: %w", err))
	}
	logger.Info().Str("key", thumbnailKey).Msg("uploaded thumbnail")

	// Generate 3-second GIF preview starting at 1 second
	gifPath := filepath.Join(tmpDir, "preview.gif")
	err = RunFFmpeg(ctx, logger,
		"-i", sourcePath,
		"-ss", "1",
		"-t", "3",
		"-vf", "fps=10,scale=480:-1:flags=lanczos",
		gifPath,
	)
	if err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("ffmpeg gif: %w", err))
	}

	// Upload GIF preview
	gifKey := keyPrefix + "/preview.gif"
	if err := UploadToS3(ctx, w.S3Client, w.S3Bucket, gifKey, gifPath, "image/gif"); err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("upload gif: %w", err))
	}
	logger.Info().Str("key", gifKey).Msg("uploaded preview GIF")

	// Update video record with thumbnail and GIF keys
	_, err = w.Pool.Exec(ctx,
		`UPDATE videos SET thumbnail_key = $2, gif_key = $3, updated_at = NOW()
		 WHERE id = $1`,
		args.VideoID, thumbnailKey, gifKey,
	)
	if err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("update video record: %w", err))
	}

	// Mark processing job as completed
	_, err = w.Pool.Exec(ctx,
		`UPDATE processing_jobs SET status = 'completed', progress = 100, completed_at = NOW()
		 WHERE video_id = $1 AND type = 'thumbnail'`,
		args.VideoID,
	)
	if err != nil {
		logger.Error().Err(err).Msg("failed to mark processing job as completed")
	}

	logger.Info().Msg("thumbnail job completed successfully")
	return nil
}

func (w *ThumbnailWorker) failJob(ctx context.Context, videoID string, err error) error {
	w.Logger.Error().Err(err).Str("video_id", videoID).Msg("thumbnail job failed")

	errMsg := err.Error()
	_, dbErr := w.Pool.Exec(ctx,
		`UPDATE processing_jobs SET status = 'failed', error = $2, completed_at = NOW()
		 WHERE video_id = $1 AND type = 'thumbnail'`,
		videoID, errMsg,
	)
	if dbErr != nil {
		w.Logger.Error().Err(dbErr).Msg("failed to update processing job failure status")
	}

	return err
}
