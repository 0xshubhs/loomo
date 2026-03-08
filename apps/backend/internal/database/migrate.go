package database

import (
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/rs/zerolog"
)

// RunMigrations runs all pending database migrations from the given path.
func RunMigrations(databaseURL string, migrationsPath string, logger zerolog.Logger) error {
	m, err := migrate.New(
		fmt.Sprintf("file://%s", migrationsPath),
		databaseURL,
	)
	if err != nil {
		return fmt.Errorf("failed to create migrate instance: %w", err)
	}
	defer m.Close()

	version, dirty, _ := m.Version()
	logger.Info().Uint("current_version", version).Bool("dirty", dirty).Msg("current migration state")

	if err := m.Up(); err != nil {
		if errors.Is(err, migrate.ErrNoChange) {
			logger.Info().Msg("database is up to date, no migrations to apply")
			return nil
		}
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	newVersion, _, _ := m.Version()
	logger.Info().Uint("from_version", version).Uint("to_version", newVersion).Msg("migrations applied successfully")

	return nil
}
