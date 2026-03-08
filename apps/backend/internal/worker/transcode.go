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

// TranscodeWorker handles video transcoding to HLS format.
type TranscodeWorker struct {
	river.WorkerDefaults[TranscodeArgs]
	Pool     *pgxpool.Pool
	S3Client *s3.Client
	S3Bucket string
	Logger   zerolog.Logger
}

func (w *TranscodeWorker) Timeout(job *river.Job[TranscodeArgs]) time.Duration {
	return 30 * time.Minute // transcoding can take a while
}

func (w *TranscodeWorker) Work(ctx context.Context, job *river.Job[TranscodeArgs]) error {
	args := job.Args
	logger := w.Logger.With().
		Str("video_id", args.VideoID).
		Str("job", "transcode").
		Logger()

	logger.Info().Msg("starting transcode job")

	// Mark processing job as running
	_, err := w.Pool.Exec(ctx,
		`UPDATE processing_jobs SET status = 'running', started_at = NOW()
		 WHERE video_id = $1 AND type = 'transcode' AND status = 'pending'`,
		args.VideoID,
	)
	if err != nil {
		logger.Error().Err(err).Msg("failed to update processing job status")
	}

	// Create temp working directory
	tmpDir, err := os.MkdirTemp("", "transcode-"+args.VideoID+"-*")
	if err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("create temp dir: %w", err))
	}
	defer os.RemoveAll(tmpDir)

	// Download source file from S3
	sourcePath := filepath.Join(tmpDir, "source.webm")
	logger.Info().Str("source_key", args.SourceKey).Msg("downloading source from S3")
	if err := DownloadFromS3(ctx, w.S3Client, w.S3Bucket, args.SourceKey, sourcePath); err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("download source: %w", err))
	}

	// Create HLS output directory
	hlsDir := filepath.Join(tmpDir, "hls")
	if err := os.MkdirAll(hlsDir, 0755); err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("create hls dir: %w", err))
	}

	// Run FFmpeg to generate single-quality HLS (MVP)
	segmentPattern := filepath.Join(hlsDir, "segment_%03d.ts")
	playlistPath := filepath.Join(hlsDir, "playlist.m3u8")

	err = RunFFmpeg(ctx, logger,
		"-i", sourcePath,
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-c:a", "aac",
		"-b:a", "128k",
		"-hls_time", "6",
		"-hls_list_size", "0",
		"-hls_segment_filename", segmentPattern,
		playlistPath,
	)
	if err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("ffmpeg transcode: %w", err))
	}

	// Upload HLS output to S3
	hlsKeyPrefix := "videos/" + args.UserID + "/" + args.VideoID + "/hls"
	logger.Info().Str("prefix", hlsKeyPrefix).Msg("uploading HLS output to S3")

	if err := UploadDirectory(ctx, w.S3Client, w.S3Bucket, hlsKeyPrefix, hlsDir, logger); err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("upload hls: %w", err))
	}

	// Update video record with HLS key and set status to ready
	hlsKey := hlsKeyPrefix + "/playlist.m3u8"
	_, err = w.Pool.Exec(ctx,
		`UPDATE videos SET hls_key = $2, status = 'ready', updated_at = NOW()
		 WHERE id = $1`,
		args.VideoID, hlsKey,
	)
	if err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("update video record: %w", err))
	}

	// Mark processing job as completed
	_, err = w.Pool.Exec(ctx,
		`UPDATE processing_jobs SET status = 'completed', progress = 100, completed_at = NOW()
		 WHERE video_id = $1 AND type = 'transcode'`,
		args.VideoID,
	)
	if err != nil {
		logger.Error().Err(err).Msg("failed to mark processing job as completed")
	}

	logger.Info().Msg("transcode job completed successfully")
	return nil
}

func (w *TranscodeWorker) failJob(ctx context.Context, videoID string, err error) error {
	w.Logger.Error().Err(err).Str("video_id", videoID).Msg("transcode job failed")

	errMsg := err.Error()
	_, dbErr := w.Pool.Exec(ctx,
		`UPDATE processing_jobs SET status = 'failed', error = $2, completed_at = NOW()
		 WHERE video_id = $1 AND type = 'transcode'`,
		videoID, errMsg,
	)
	if dbErr != nil {
		w.Logger.Error().Err(dbErr).Msg("failed to update processing job failure status")
	}

	// Also mark the video as failed
	_, dbErr = w.Pool.Exec(ctx,
		`UPDATE videos SET status = 'failed', updated_at = NOW() WHERE id = $1`,
		videoID,
	)
	if dbErr != nil {
		w.Logger.Error().Err(dbErr).Msg("failed to update video failure status")
	}

	return err
}
