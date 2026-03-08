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

// TranscribeWorker handles audio transcription.
// Currently a placeholder that extracts audio and marks the job as complete.
type TranscribeWorker struct {
	river.WorkerDefaults[TranscribeArgs]
	Pool     *pgxpool.Pool
	S3Client *s3.Client
	S3Bucket string
	Logger   zerolog.Logger
}

func (w *TranscribeWorker) Timeout(job *river.Job[TranscribeArgs]) time.Duration {
	return 10 * time.Minute
}

func (w *TranscribeWorker) Work(ctx context.Context, job *river.Job[TranscribeArgs]) error {
	args := job.Args
	logger := w.Logger.With().
		Str("video_id", args.VideoID).
		Str("job", "transcribe").
		Logger()

	logger.Info().Msg("starting transcribe job")

	// Mark processing job as running
	_, err := w.Pool.Exec(ctx,
		`UPDATE processing_jobs SET status = 'running', started_at = NOW()
		 WHERE video_id = $1 AND type = 'transcribe' AND status = 'pending'`,
		args.VideoID,
	)
	if err != nil {
		logger.Error().Err(err).Msg("failed to update processing job status")
	}

	// Create temp working directory
	tmpDir, err := os.MkdirTemp("", "transcribe-"+args.VideoID+"-*")
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

	// Extract audio as WAV for transcription
	audioPath := filepath.Join(tmpDir, "audio.wav")
	err = RunFFmpeg(ctx, logger,
		"-i", sourcePath,
		"-vn",
		"-acodec", "pcm_s16le",
		"-ar", "16000",
		audioPath,
	)
	if err != nil {
		return w.failJob(ctx, args.VideoID, fmt.Errorf("ffmpeg audio extraction: %w", err))
	}

	// TODO: Integrate with Whisper API (OpenAI) for actual transcription.
	// For MVP, we extract the audio and mark the job as completed.
	// Future implementation:
	//   1. Send audioPath to OpenAI Whisper API
	//   2. Store the resulting transcript in the database
	//   3. Optionally generate VTT/SRT subtitle files
	//   4. Upload subtitle files to S3

	logger.Info().Msg("audio extracted successfully; transcription API not yet integrated")

	// Mark processing job as completed (placeholder)
	_, err = w.Pool.Exec(ctx,
		`UPDATE processing_jobs SET status = 'completed', progress = 100, completed_at = NOW()
		 WHERE video_id = $1 AND type = 'transcribe'`,
		args.VideoID,
	)
	if err != nil {
		logger.Error().Err(err).Msg("failed to mark processing job as completed")
	}

	logger.Info().Msg("transcribe job completed (placeholder)")
	return nil
}

func (w *TranscribeWorker) failJob(ctx context.Context, videoID string, err error) error {
	w.Logger.Error().Err(err).Str("video_id", videoID).Msg("transcribe job failed")

	errMsg := err.Error()
	_, dbErr := w.Pool.Exec(ctx,
		`UPDATE processing_jobs SET status = 'failed', error = $2, completed_at = NOW()
		 WHERE video_id = $1 AND type = 'transcribe'`,
		videoID, errMsg,
	)
	if dbErr != nil {
		w.Logger.Error().Err(dbErr).Msg("failed to update processing job failure status")
	}

	return err
}
