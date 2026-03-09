#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Track child PIDs for cleanup
PIDS=()

cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down...${NC}"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  echo -e "${GREEN}All services stopped.${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

log() { echo -e "${BOLD}${BLUE}[dittoo]${NC} $1"; }
ok()  { echo -e "${BOLD}${GREEN}  ✓${NC} $1"; }
warn(){ echo -e "${BOLD}${YELLOW}  ⚠${NC} $1"; }
err() { echo -e "${BOLD}${RED}  ✗${NC} $1"; }

# ─── Preflight checks ────────────────────────────────────────────────

log "Checking prerequisites..."

MISSING=()
command -v bun  >/dev/null 2>&1 || MISSING+=("bun")
command -v go   >/dev/null 2>&1 || MISSING+=("go")

if [ ${#MISSING[@]} -ne 0 ]; then
  err "Missing required tools: ${MISSING[*]}"
  exit 1
fi

HAS_DOCKER=true
if ! command -v docker >/dev/null 2>&1; then
  HAS_DOCKER=false
  warn "Docker not found — skipping infrastructure (PostgreSQL, Redis, MinIO)"
elif ! docker info >/dev/null 2>&1; then
  HAS_DOCKER=false
  warn "Docker daemon not running — skipping infrastructure"
fi

ok "bun $(bun --version)"
ok "go $(go version | awk '{print $3}')"
$HAS_DOCKER && ok "docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ─── Environment ──────────────────────────────────────────────────────

if [ ! -f "$ROOT/.env" ]; then
  if [ -f "$ROOT/.env.example" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    ok "Created .env from .env.example"
  else
    warn "No .env file found"
  fi
fi

set -a
source "$ROOT/.env"
set +a

# ─── Infrastructure (Docker) ─────────────────────────────────────────

if $HAS_DOCKER; then
  log "Starting infrastructure..."
  docker compose -f docker/docker-compose.yml up -d 2>&1 | while read -r line; do
    echo -e "  ${DIM}${line}${NC}"
  done

  # Wait for PostgreSQL to be healthy
  echo -ne "  ${DIM}Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    if docker compose -f docker/docker-compose.yml exec -T postgres pg_isready -U dittoo >/dev/null 2>&1; then
      echo -e "${NC}"
      ok "PostgreSQL ready"
      break
    fi
    echo -n "."
    sleep 1
    if [ "$i" -eq 30 ]; then
      echo -e "${NC}"
      warn "PostgreSQL health check timed out — backend may fail to connect"
    fi
  done

  # Create MinIO bucket if it doesn't exist
  if command -v mc >/dev/null 2>&1; then
    mc alias set dittoo-local http://localhost:9000 minioadmin minioadmin >/dev/null 2>&1 || true
    mc mb --ignore-existing dittoo-local/dittoo-videos >/dev/null 2>&1 || true
    ok "MinIO bucket ready"
  else
    # Try with curl as fallback
    curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1 && ok "MinIO running" || true
  fi
else
  warn "Skipping infrastructure — services that need DB/Redis will fail"
fi

# ─── Install dependencies ────────────────────────────────────────────

log "Installing dependencies..."
(cd "$ROOT" && bun install --frozen-lockfile 2>/dev/null || bun install) | tail -1
ok "Node dependencies installed"

# ─── Start services ──────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${CYAN}  DITTOO — Starting all services${NC}"
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# --- SvelteKit dev server ---
log "Starting web (SvelteKit)..."
(cd apps/web && bun run dev 2>&1 | sed "s/^/$(printf "${GREEN}[web]${NC} ")/") &
PIDS+=($!)

# --- Go backend ---
if $HAS_DOCKER; then
  log "Starting backend (Go API)..."
  (cd apps/backend && go run ./cmd/api 2>&1 | sed "s/^/$(printf "${BLUE}[api]${NC} ")/") &
  PIDS+=($!)
else
  warn "Skipping backend — no Docker infrastructure"
fi

echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}Web:${NC}       http://localhost:5173"
$HAS_DOCKER && echo -e "  ${BOLD}API:${NC}       http://localhost:8080"
$HAS_DOCKER && echo -e "  ${BOLD}MinIO:${NC}     http://localhost:9001  ${DIM}(minioadmin/minioadmin)${NC}"
$HAS_DOCKER && echo -e "  ${BOLD}Postgres:${NC}  localhost:5432         ${DIM}(dittoo/dittoo_dev)${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${DIM}Press Ctrl+C to stop all services${NC}"
echo ""

# Wait for any child to exit
wait

