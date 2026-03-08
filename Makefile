.PHONY: dev dev-web dev-backend dev-infra build build-web build-backend test clean db-migrate db-reset sqlc

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
	rm -rf apps/web/.svelte-kit apps/web/build
