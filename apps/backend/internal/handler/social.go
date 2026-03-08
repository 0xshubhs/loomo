package handler

import (
	"net/http"
	"time"

	"github.com/dittoo/backend/internal/database"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// RecordView handles POST /api/share/{id}/view
// Rate-limited: 1 per IP per video per hour
func (h *Handler) RecordView(w http.ResponseWriter, r *http.Request) {
	videoID := chi.URLParam(r, "id")
	vid := parseUUID(videoID)

	viewerIP := r.RemoteAddr
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		viewerIP = forwarded
	}
	if realIP := r.Header.Get("X-Real-Ip"); realIP != "" {
		viewerIP = realIP
	}

	// Rate limit: check if this IP already viewed in the last hour
	hasRecent, err := h.db.HasRecentView(r.Context(), database.HasRecentViewParams{
		VideoID:  vid,
		ViewerIp: pgtype.Text{String: viewerIP, Valid: true},
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to check recent view")
		h.error(w, http.StatusInternalServerError, "failed to record view")
		return
	}

	if hasRecent {
		// Already viewed recently, return current count
		count, err := h.db.GetViewCount(r.Context(), vid)
		if err != nil {
			h.error(w, http.StatusInternalServerError, "failed to get view count")
			return
		}
		h.json(w, http.StatusOK, map[string]interface{}{
			"view_count": count,
			"recorded":   false,
		})
		return
	}

	viewCount, err := h.db.RecordView(r.Context(), database.RecordViewParams{
		VideoID:  vid,
		ViewerIp: pgtype.Text{String: viewerIP, Valid: true},
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to record view")
		h.error(w, http.StatusInternalServerError, "failed to record view")
		return
	}

	count := int32(0)
	if viewCount.Valid {
		count = viewCount.Int32
	}

	h.json(w, http.StatusOK, map[string]interface{}{
		"view_count": count,
		"recorded":   true,
	})
}

// AddReaction handles POST /api/share/{id}/reactions
func (h *Handler) AddReaction(w http.ResponseWriter, r *http.Request) {
	videoID := chi.URLParam(r, "id")
	vid := parseUUID(videoID)

	var req struct {
		Emoji string  `json:"emoji"`
		Name  *string `json:"name"`
	}
	if err := h.decode(r, &req); err != nil {
		h.error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Emoji == "" {
		h.error(w, http.StatusBadRequest, "emoji is required")
		return
	}

	// Validate emoji is one of the allowed ones
	allowedEmoji := map[string]bool{
		"\U0001F44D": true, // thumbs up
		"\u2764\uFE0F": true, // red heart
		"\U0001F525": true, // fire
		"\U0001F602": true, // face with tears of joy
		"\U0001F44F": true, // clapping hands
		"\U0001F389": true, // party popper
	}
	if !allowedEmoji[req.Emoji] {
		h.error(w, http.StatusBadRequest, "invalid emoji")
		return
	}

	reactorName := pgtype.Text{}
	if req.Name != nil && *req.Name != "" {
		reactorName = pgtype.Text{String: *req.Name, Valid: true}
	}

	reaction, err := h.db.AddReaction(r.Context(), database.AddReactionParams{
		VideoID:     vid,
		Emoji:       req.Emoji,
		ReactorName: reactorName,
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to add reaction")
		h.error(w, http.StatusInternalServerError, "failed to add reaction")
		return
	}

	h.json(w, http.StatusCreated, map[string]interface{}{
		"id":         uuidToString(reaction.ID),
		"emoji":      reaction.Emoji,
		"created_at": reaction.CreatedAt.Time.Format(time.RFC3339),
	})
}

// GetReactions handles GET /api/share/{id}/reactions
func (h *Handler) GetReactions(w http.ResponseWriter, r *http.Request) {
	videoID := chi.URLParam(r, "id")
	vid := parseUUID(videoID)

	counts, err := h.db.GetReactionCounts(r.Context(), vid)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to get reaction counts")
		h.error(w, http.StatusInternalServerError, "failed to get reactions")
		return
	}

	result := make([]map[string]interface{}, 0, len(counts))
	for _, c := range counts {
		result = append(result, map[string]interface{}{
			"emoji": c.Emoji,
			"count": c.Count,
		})
	}

	h.json(w, http.StatusOK, map[string]interface{}{
		"reactions": result,
	})
}

// CreateComment handles POST /api/share/{id}/comments
func (h *Handler) CreateComment(w http.ResponseWriter, r *http.Request) {
	videoID := chi.URLParam(r, "id")
	vid := parseUUID(videoID)

	var req struct {
		Body             string `json:"body"`
		AuthorName       string `json:"author_name"`
		TimestampSeconds *int32 `json:"timestamp_seconds"`
	}
	if err := h.decode(r, &req); err != nil {
		h.error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Body == "" {
		h.error(w, http.StatusBadRequest, "body is required")
		return
	}
	if req.AuthorName == "" {
		req.AuthorName = "Anonymous"
	}

	ts := pgtype.Int4{}
	if req.TimestampSeconds != nil {
		ts = pgtype.Int4{Int32: *req.TimestampSeconds, Valid: true}
	}

	comment, err := h.db.CreateComment(r.Context(), database.CreateCommentParams{
		VideoID:          vid,
		AuthorName:       req.AuthorName,
		Body:             req.Body,
		TimestampSeconds: ts,
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to create comment")
		h.error(w, http.StatusInternalServerError, "failed to create comment")
		return
	}

	h.json(w, http.StatusCreated, commentToResponse(comment))
}

// GetComments handles GET /api/share/{id}/comments
func (h *Handler) GetComments(w http.ResponseWriter, r *http.Request) {
	videoID := chi.URLParam(r, "id")
	vid := parseUUID(videoID)

	comments, err := h.db.GetCommentsByVideo(r.Context(), vid)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to get comments")
		h.error(w, http.StatusInternalServerError, "failed to get comments")
		return
	}

	result := make([]map[string]interface{}, 0, len(comments))
	for _, c := range comments {
		result = append(result, commentToResponse(c))
	}

	h.json(w, http.StatusOK, map[string]interface{}{
		"comments": result,
	})
}

func commentToResponse(c database.VideoComment) map[string]interface{} {
	resp := map[string]interface{}{
		"id":          uuidToString(c.ID),
		"author_name": c.AuthorName,
		"body":        c.Body,
		"created_at":  c.CreatedAt.Time.Format(time.RFC3339),
	}
	if c.AuthorAvatar.Valid {
		resp["author_avatar"] = c.AuthorAvatar.String
	}
	if c.TimestampSeconds.Valid {
		resp["timestamp_seconds"] = c.TimestampSeconds.Int32
	}
	return resp
}
