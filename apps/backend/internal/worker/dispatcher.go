package worker

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// DispatchVideoProcessing enqueues all three processing jobs (transcode,
// thumbnail, transcribe) for a video. All jobs are inserted in a single
// database transaction to ensure atomicity.
func DispatchVideoProcessing(
	ctx context.Context,
	pool *pgxpool.Pool,
	riverClient *river.Client[pgx.Tx],
	videoID string,
	userID string,
	sourceKey string,
) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	params := []river.InsertManyParams{
		{Args: TranscodeArgs{VideoID: videoID, UserID: userID, SourceKey: sourceKey}},
		{Args: ThumbnailArgs{VideoID: videoID, UserID: userID, SourceKey: sourceKey}},
		{Args: TranscribeArgs{VideoID: videoID, UserID: userID, SourceKey: sourceKey}},
	}

	_, err = riverClient.InsertManyTx(ctx, tx, params)
	if err != nil {
		return fmt.Errorf("insert river jobs: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

// NewInsertOnlyClient creates a River client configured for job insertion only
// (no workers). This is useful for the API server that needs to enqueue jobs
// without processing them.
func NewInsertOnlyClient(pool *pgxpool.Pool) (*river.Client[pgx.Tx], error) {
	return river.NewClient(riverpgxv5.New(pool), &river.Config{})
}
