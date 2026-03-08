package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/dittoo/backend/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type createVideoRequest struct {
	Title           string `json:"title"`
	RecordingSource string `json:"recording_source"`
}

type videoResponse struct {
	ID              string  `json:"id"`
	Title           string  `json:"title"`
	Description     *string `json:"description"`
	Status          string  `json:"status"`
	DurationMs      *int    `json:"duration_ms"`
	RecordingSource *string `json:"recording_source"`
	ThumbnailURL    *string `json:"thumbnail_url"`
	GifURL          *string `json:"gif_url"`
	HlsURL          *string `json:"hls_url"`
	ShareMode       string  `json:"share_mode"`
	ShareURL        string  `json:"share_url"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

func (h *Handler) CreateVideo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		h.error(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req createVideoRequest
	if err := h.decode(r, &req); err != nil {
		h.error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Title == "" {
		req.Title = "Untitled Recording"
	}

	videoID := uuid.New()
	sourceKey := "videos/" + userID + "/" + videoID.String() + "/source.webm"
	now := time.Now()

	_, err := h.pool.Exec(r.Context(),
		`INSERT INTO videos (id, user_id, title, recording_source, source_key, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $6)`,
		videoID, userID, req.Title, req.RecordingSource, sourceKey, now,
	)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to create video")
		h.error(w, http.StatusInternalServerError, "failed to create video")
		return
	}

	// TODO: Generate presigned upload URL from R2/S3
	uploadURL := h.config.S3Endpoint + "/" + h.config.S3Bucket + "/" + sourceKey

	h.json(w, http.StatusCreated, map[string]interface{}{
		"video": videoResponse{
			ID:              videoID.String(),
			Title:           req.Title,
			Status:          "uploading",
			RecordingSource: &req.RecordingSource,
			ShareMode:       "unlisted",
			ShareURL:        h.config.FrontendURL + "/share/" + videoID.String(),
			CreatedAt:       now.Format(time.RFC3339),
			UpdatedAt:       now.Format(time.RFC3339),
		},
		"upload_url":       uploadURL,
		"upload_expires_at": now.Add(1 * time.Hour).Format(time.RFC3339),
	})
}

func (h *Handler) GetVideo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	videoID := chi.URLParam(r, "videoID")

	var v videoResponse
	var description, recordingSource, thumbnailKey, gifKey, hlsKey *string
	var durationMs *int
	var createdAt, updatedAt time.Time

	err := h.pool.QueryRow(r.Context(),
		`SELECT id, title, description, status, duration_ms, recording_source,
		        thumbnail_key, gif_key, hls_key, share_mode, created_at, updated_at
		 FROM videos WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		videoID, userID,
	).Scan(&v.ID, &v.Title, &description, &v.Status, &durationMs, &recordingSource,
		&thumbnailKey, &gifKey, &hlsKey, &v.ShareMode, &createdAt, &updatedAt)
	if err != nil {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}

	v.Description = description
	v.DurationMs = durationMs
	v.RecordingSource = recordingSource
	v.ThumbnailURL = h.buildCDNURL(thumbnailKey)
	v.GifURL = h.buildCDNURL(gifKey)
	v.HlsURL = h.buildCDNURL(hlsKey)
	v.ShareURL = h.config.FrontendURL + "/share/" + v.ID
	v.CreatedAt = createdAt.Format(time.RFC3339)
	v.UpdatedAt = updatedAt.Format(time.RFC3339)

	h.json(w, http.StatusOK, v)
}

func (h *Handler) ListVideos(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	offset := (page - 1) * perPage

	rows, err := h.pool.Query(r.Context(),
		`SELECT id, title, description, status, duration_ms, recording_source,
		        thumbnail_key, gif_key, hls_key, share_mode, created_at, updated_at
		 FROM videos WHERE user_id = $1 AND deleted_at IS NULL
		 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		userID, perPage, offset,
	)
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to list videos")
		return
	}
	defer rows.Close()

	videos := []videoResponse{}
	for rows.Next() {
		var v videoResponse
		var description, recordingSource, thumbnailKey, gifKey, hlsKey *string
		var durationMs *int
		var createdAt, updatedAt time.Time

		if err := rows.Scan(&v.ID, &v.Title, &description, &v.Status, &durationMs, &recordingSource,
			&thumbnailKey, &gifKey, &hlsKey, &v.ShareMode, &createdAt, &updatedAt); err != nil {
			continue
		}

		v.Description = description
		v.DurationMs = durationMs
		v.RecordingSource = recordingSource
		v.ThumbnailURL = h.buildCDNURL(thumbnailKey)
		v.GifURL = h.buildCDNURL(gifKey)
		v.HlsURL = h.buildCDNURL(hlsKey)
		v.ShareURL = h.config.FrontendURL + "/share/" + v.ID
		v.CreatedAt = createdAt.Format(time.RFC3339)
		v.UpdatedAt = updatedAt.Format(time.RFC3339)
		videos = append(videos, v)
	}

	var total int
	h.pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM videos WHERE user_id = $1 AND deleted_at IS NULL`,
		userID,
	).Scan(&total)

	h.json(w, http.StatusOK, map[string]interface{}{
		"videos": videos,
		"pagination": map[string]interface{}{
			"page":     page,
			"per_page": perPage,
			"total":    total,
			"has_more": offset+perPage < total,
		},
	})
}

func (h *Handler) UpdateVideo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	videoID := chi.URLParam(r, "videoID")

	var req struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		ShareMode   *string `json:"share_mode"`
	}
	if err := h.decode(r, &req); err != nil {
		h.error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := h.pool.Exec(r.Context(),
		`UPDATE videos SET
			title = COALESCE($3, title),
			description = COALESCE($4, description),
			share_mode = COALESCE($5::share_mode, share_mode),
			updated_at = NOW()
		 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		videoID, userID, req.Title, req.Description, req.ShareMode,
	)
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to update video")
		return
	}

	if result.RowsAffected() == 0 {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}

	h.json(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *Handler) DeleteVideo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	videoID := chi.URLParam(r, "videoID")

	result, err := h.pool.Exec(r.Context(),
		`UPDATE videos SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		videoID, userID,
	)
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to delete video")
		return
	}

	if result.RowsAffected() == 0 {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) CompleteVideo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	videoID := chi.URLParam(r, "videoID")

	// Update status to processing
	result, err := h.pool.Exec(r.Context(),
		`UPDATE videos SET status = 'processing', updated_at = NOW()
		 WHERE id = $1 AND user_id = $2 AND status = 'uploading' AND deleted_at IS NULL`,
		videoID, userID,
	)
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to complete video")
		return
	}

	if result.RowsAffected() == 0 {
		h.error(w, http.StatusNotFound, "video not found or already processing")
		return
	}

	// Create processing jobs
	jobTypes := []string{"transcode", "thumbnail", "transcribe"}
	jobs := []map[string]interface{}{}

	for _, jt := range jobTypes {
		jobID := uuid.New()
		_, err := h.pool.Exec(r.Context(),
			`INSERT INTO processing_jobs (id, video_id, type) VALUES ($1, $2, $3::job_type)`,
			jobID, videoID, jt,
		)
		if err != nil {
			h.logger.Error().Err(err).Str("job_type", jt).Msg("failed to create processing job")
			continue
		}
		jobs = append(jobs, map[string]interface{}{
			"id":     jobID.String(),
			"type":   jt,
			"status": "pending",
		})
	}

	// TODO: Dispatch River jobs for actual processing

	h.json(w, http.StatusOK, map[string]interface{}{
		"video":           map[string]string{"id": videoID, "status": "processing"},
		"processing_jobs": jobs,
	})
}

func (h *Handler) GetShareVideo(w http.ResponseWriter, r *http.Request) {
	videoID := chi.URLParam(r, "id")

	var id, title, shareMode, creatorName string
	var description *string
	var durationMs *int
	var hlsKey, thumbnailKey, gifKey, creatorAvatar *string
	var createdAt time.Time

	err := h.pool.QueryRow(r.Context(),
		`SELECT v.id, v.title, v.description, v.status, v.duration_ms,
		        v.hls_key, v.thumbnail_key, v.gif_key, v.share_mode,
		        v.created_at, u.name, u.avatar_url
		 FROM videos v JOIN users u ON v.user_id = u.id
		 WHERE v.id = $1 AND v.deleted_at IS NULL AND v.status = 'ready'`,
		videoID,
	).Scan(&id, &title, &description, new(string), &durationMs,
		&hlsKey, &thumbnailKey, &gifKey, &shareMode,
		&createdAt, &creatorName, &creatorAvatar)
	if err != nil {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}

	if shareMode == "private" {
		h.error(w, http.StatusForbidden, "this video is private")
		return
	}

	h.json(w, http.StatusOK, map[string]interface{}{
		"id":            id,
		"title":         title,
		"description":   description,
		"duration_ms":   durationMs,
		"hls_url":       h.buildCDNURLValue(hlsKey),
		"thumbnail_url": h.buildCDNURLValue(thumbnailKey),
		"gif_url":       h.buildCDNURLValue(gifKey),
		"share_mode":    shareMode,
		"created_at":    createdAt.Format(time.RFC3339),
		"creator": map[string]interface{}{
			"name":       creatorName,
			"avatar_url": creatorAvatar,
		},
	})
}

func (h *Handler) buildCDNURL(key *string) *string {
	if key == nil || *key == "" {
		return nil
	}
	url := h.config.CDNURL + "/" + *key
	return &url
}

func (h *Handler) buildCDNURLValue(key *string) string {
	if key == nil || *key == "" {
		return ""
	}
	return h.config.CDNURL + "/" + *key
}
