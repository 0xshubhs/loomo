package worker

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/rs/zerolog"
)

// RunFFmpeg executes an FFmpeg command with the given arguments.
// The context is used for cancellation support.
func RunFFmpeg(ctx context.Context, logger zerolog.Logger, args ...string) error {
	logger.Info().Strs("args", args).Msg("running ffmpeg")

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg failed: %w", err)
	}
	return nil
}

// EnsureFFmpeg checks that ffmpeg is available in PATH.
func EnsureFFmpeg() error {
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		return fmt.Errorf("ffmpeg not found in PATH: %w", err)
	}
	_ = path
	return nil
}

// DownloadFromS3 downloads an object from S3 to a local file.
func DownloadFromS3(ctx context.Context, client *s3.Client, bucket, key, localPath string) error {
	out, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("s3 get object %s/%s: %w", bucket, key, err)
	}
	defer out.Body.Close()

	f, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("create local file %s: %w", localPath, err)
	}
	defer f.Close()

	if _, err := io.Copy(f, out.Body); err != nil {
		return fmt.Errorf("download to %s: %w", localPath, err)
	}

	return nil
}

// UploadToS3 uploads a local file to S3 with the given content type.
func UploadToS3(ctx context.Context, client *s3.Client, bucket, key, localPath, contentType string) error {
	f, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open local file %s: %w", localPath, err)
	}
	defer f.Close()

	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        f,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("s3 put object %s/%s: %w", bucket, key, err)
	}

	return nil
}

// UploadDirectory uploads all files in a local directory to S3 under the given key prefix.
// It walks the directory recursively and preserves the relative path structure.
func UploadDirectory(ctx context.Context, client *s3.Client, bucket, keyPrefix, localDir string, logger zerolog.Logger) error {
	return filepath.Walk(localDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(localDir, path)
		if err != nil {
			return fmt.Errorf("get relative path: %w", err)
		}

		key := keyPrefix + "/" + relPath
		contentType := guessContentType(relPath)

		logger.Info().Str("file", relPath).Str("key", key).Msg("uploading file to S3")

		return UploadToS3(ctx, client, bucket, key, path, contentType)
	})
}

// guessContentType returns a content type based on the file extension.
func guessContentType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".m3u8":
		return "application/vnd.apple.mpegurl"
	case ".ts":
		return "video/mp2t"
	case ".mp4":
		return "video/mp4"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webm":
		return "video/webm"
	case ".wav":
		return "audio/wav"
	case ".json":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}
