package worker

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
	"github.com/rs/zerolog"
)

// RunRiverMigrations runs River's built-in database migrations.
// River manages its own schema (river_job, river_leader, etc.) and this
// function should be called at startup before the River client is started.
func RunRiverMigrations(ctx context.Context, pool *pgxpool.Pool, logger zerolog.Logger) error {
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), &rivermigrate.Config{
		Logger: slog.Default(),
	})
	if err != nil {
		return fmt.Errorf("create river migrator: %w", err)
	}

	result, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil)
	if err != nil {
		return fmt.Errorf("run river migrations: %w", err)
	}

	for _, v := range result.Versions {
		logger.Info().Int("version", v.Version).Msg("applied river migration")
	}

	if len(result.Versions) == 0 {
		logger.Info().Msg("river migrations already up to date")
	}

	return nil
}
