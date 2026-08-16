.PHONY: dev dev-web dev-backend dev-infra build build-web build-backend test clean db-migrate db-reset sqlc \
	desktop-dev desktop-build desktop-deps desktop-icon desktop-setup

# ============ Development ============
dev: dev-infra
	@echo "Starting all services..."
	$(MAKE) -j2 dev-web dev-backend

dev-web:
	cd apps/web && bun run dev

dev-backend:
	cd apps/backend && go run ./cmd/api

dev-infra:
	docker compose -f docker/docker-compose.yml up -d

# ============ Build ============
build: build-web build-backend

build-web:
	cd apps/web && bun run build

build-backend:
	cd apps/backend && go build -o ../../dist/api ./cmd/api
	cd apps/backend && go build -o ../../dist/worker ./cmd/worker

# ============ Desktop app (Tauri) ============
# Installers land in apps/desktop/src-tauri/target/release/bundle/.
# Only the host platform's formats can be built locally — .dmg needs macOS and
# .exe needs Windows. Tag a release to build all three in CI:
#   .github/workflows/desktop-release.yml

# One-time setup: fetch the ffmpeg sidecars and generate icons.
desktop-setup: desktop-deps desktop-icon

desktop-deps:
	bun run --cwd apps/desktop ffmpeg

desktop-icon:
	bun run --cwd apps/desktop icon

desktop-dev: desktop-deps
	bun run --cwd apps/desktop dev

desktop-build: desktop-deps
	bun run --cwd apps/desktop build

# ============ Database ============
db-migrate:
	cd apps/backend && go run github.com/golang-migrate/migrate/v4/cmd/migrate@latest \
		-path migrations -database "$${DATABASE_URL}" up

db-reset:
	docker compose -f docker/docker-compose.yml down -v
	docker compose -f docker/docker-compose.yml up -d postgres
	sleep 2
	$(MAKE) db-migrate

# ============ Code Generation ============
sqlc:
	cd apps/backend && sqlc generate

# ============ Testing ============
test:
	cd apps/web && bun run check
	cd apps/backend && go test ./...

# ============ Cleanup ============
clean:
	docker compose -f docker/docker-compose.yml down -v
	rm -rf dist/
	rm -rf apps/web/.svelte-kit apps/web/build apps/web/build-desktop
	rm -rf apps/desktop/src-tauri/target apps/desktop/src-tauri/gen
