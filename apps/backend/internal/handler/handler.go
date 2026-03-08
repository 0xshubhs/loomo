package handler

import (
	"encoding/json"
	"net/http"

	"github.com/dittoo/backend/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

type Handler struct {
	pool   *pgxpool.Pool
	config *config.Config
	logger zerolog.Logger
}

func New(pool *pgxpool.Pool, cfg *config.Config, logger zerolog.Logger) *Handler {
	return &Handler{
		pool:   pool,
		config: cfg,
		logger: logger,
	}
}

func (h *Handler) json(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *Handler) error(w http.ResponseWriter, status int, message string) {
	h.json(w, status, map[string]string{"error": message})
}

func (h *Handler) decode(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}
