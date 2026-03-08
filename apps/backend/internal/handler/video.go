package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/dittoo/backend/internal/database"
	"github.com/dittoo/backend/internal/middleware"
	"github.com/dittoo/backend/internal/storage"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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
	DurationMs      *int32  `json:"duration_ms"`
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

	uid := parseUUID(userID)
	video, err := h.db.CreateVideo(r.Context(), database.CreateVideoParams{
		UserID:          uid,
		Title:           req.Title,
		RecordingSource: pgtype.Text{String: req.RecordingSource, Valid: req.RecordingSource != ""},
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to create video")
		h.error(w, http.StatusInternalServerError, "failed to create video")
		return
	}

	videoIDStr := uuidToString(video.ID)
	sourceKey := storage.VideoSourceKey(userID, videoIDStr)

	// Set the upload key on the video
	err = h.db.SetVideoUpload(r.Context(), database.SetVideoUploadParams{
		ID:        video.ID,
		SourceKey: pgtype.Text{String: sourceKey, Valid: true},
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to set video upload key")
		h.error(w, http.StatusInternalServerError, "failed to create video")
		return
	}

	// Generate presigned upload URL
	uploadURL, err := h.storage.GeneratePresignedPutURL(sourceKey, "video/webm", 1*time.Hour)
	if err != nil {
		h.logger.Error().Err(err).Msg("failed to generate presigned URL")
		h.error(w, http.StatusInternalServerError, "failed to generate upload URL")
		return
	}

	h.json(w, http.StatusCreated, map[string]interface{}{
		"video":            videoToResponse(video, h.config.CDNURL, h.config.FrontendURL),
		"upload_url":       uploadURL,
		"upload_expires_at": time.Now().Add(1 * time.Hour).Format(time.RFC3339),
	})
}

func (h *Handler) GetVideo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	videoID := chi.URLParam(r, "videoID")

	vid := parseUUID(videoID)
	video, err := h.db.GetVideoByID(r.Context(), vid)
	if errors.Is(err, pgx.ErrNoRows) {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to get video")
		return
	}

	// Ensure the video belongs to the user
	if uuidToString(video.UserID) != userID {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}

	h.json(w, http.StatusOK, videoToResponse(video, h.config.CDNURL, h.config.FrontendURL))
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

	uid := parseUUID(userID)

	videos, err := h.db.ListVideosByUser(r.Context(), database.ListVideosByUserParams{
		UserID: uid,
		Limit:  int32(perPage),
		Offset: int32(offset),
	})
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to list videos")
		return
	}

	total, err := h.db.CountVideosByUser(r.Context(), uid)
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to count videos")
		return
	}

	responseVideos := make([]videoResponse, 0, len(videos))
	for _, v := range videos {
		responseVideos = append(responseVideos, videoToResponse(v, h.config.CDNURL, h.config.FrontendURL))
	}

	h.json(w, http.StatusOK, map[string]interface{}{
		"videos": responseVideos,
		"pagination": map[string]interface{}{
			"page":     page,
			"per_page": perPage,
			"total":    total,
			"has_more": int64(offset+perPage) < total,
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

	vid := parseUUID(videoID)

	// Verify ownership first
	video, err := h.db.GetVideoByID(r.Context(), vid)
	if errors.Is(err, pgx.ErrNoRows) {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to get video")
		return
	}
	if uuidToString(video.UserID) != userID {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}

	params := database.UpdateVideoParams{
		ID: vid,
	}
	if req.Title != nil {
		params.Title = *req.Title
	} else {
		params.Title = video.Title
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	} else {
		params.Description = video.Description
	}
	if req.ShareMode != nil {
		params.ShareMode = database.ShareMode(*req.ShareMode)
	} else {
		params.ShareMode = video.ShareMode
	}

	err = h.db.UpdateVideo(r.Context(), params)
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to update video")
		return
	}

	h.json(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (h *Handler) DeleteVideo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	videoID := chi.URLParam(r, "videoID")

	vid := parseUUID(videoID)

	// Verify ownership
	video, err := h.db.GetVideoByID(r.Context(), vid)
	if errors.Is(err, pgx.ErrNoRows) {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to get video")
		return
	}
	if uuidToString(video.UserID) != userID {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}

	err = h.db.SoftDeleteVideo(r.Context(), vid)
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to delete video")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) CompleteVideo(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	videoID := chi.URLParam(r, "videoID")

	vid := parseUUID(videoID)

	// Verify ownership and status
	video, err := h.db.GetVideoByID(r.Context(), vid)
	if errors.Is(err, pgx.ErrNoRows) {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to get video")
		return
	}
	if uuidToString(video.UserID) != userID {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}
	if video.Status != database.VideoStatusUploading {
		h.error(w, http.StatusBadRequest, "video is not in uploading state")
		return
	}

	// Update status to processing
	err = h.db.UpdateVideoStatus(r.Context(), database.UpdateVideoStatusParams{
		ID:     vid,
		Status: database.VideoStatusProcessing,
	})
	if err != nil {
		h.error(w, http.StatusInternalServerError, "failed to complete video")
		return
	}

	// Create processing jobs
	jobTypes := []database.JobType{database.JobTypeTranscode, database.JobTypeThumbnail, database.JobTypeTranscribe}
	jobs := []map[string]interface{}{}

	for _, jt := range jobTypes {
		job, err := h.db.CreateProcessingJob(r.Context(), database.CreateProcessingJobParams{
			VideoID: vid,
			Type:    jt,
		})
		if err != nil {
			h.logger.Error().Err(err).Str("job_type", string(jt)).Msg("failed to create processing job")
			continue
		}
		jobs = append(jobs, map[string]interface{}{
			"id":     uuidToString(job.ID),
			"type":   string(job.Type),
			"status": string(job.Status),
		})
	}

	h.json(w, http.StatusOK, map[string]interface{}{
		"video":           map[string]string{"id": videoID, "status": "processing"},
		"processing_jobs": jobs,
	})
}

func (h *Handler) GetShareVideo(w http.ResponseWriter, r *http.Request) {
	videoID := chi.URLParam(r, "id")

	vid := parseUUID(videoID)
	sv, err := h.db.GetShareVideo(r.Context(), vid)
	if errors.Is(err, pgx.ErrNoRows) {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}
	if err != nil {
		h.error(w, http.StatusNotFound, "video not found")
		return
	}

	// Generate a presigned GET URL for the raw source video so the share page
	// can play it immediately while HLS transcoding is still in progress.
	var sourceURL string
	if sv.SourceKey.Valid && sv.SourceKey.String != "" {
		u, err := h.storage.GeneratePresignedGetURL(sv.SourceKey.String, 2*time.Hour)
		if err != nil {
			h.logger.Warn().Err(err).Msg("failed to generate presigned source URL")
		} else {
			sourceURL = u
		}
	}

	// Fetch reaction counts
	reactionCounts, err := h.db.GetReactionCounts(r.Context(), vid)
	if err != nil {
		h.logger.Warn().Err(err).Msg("failed to get reaction counts")
		reactionCounts = nil
	}
	reactions := make([]map[string]interface{}, 0, len(reactionCounts))
	for _, rc := range reactionCounts {
		reactions = append(reactions, map[string]interface{}{
			"emoji": rc.Emoji,
			"count": rc.Count,
		})
	}

	// Fetch comments
	dbComments, err := h.db.GetCommentsByVideo(r.Context(), vid)
	if err != nil {
		h.logger.Warn().Err(err).Msg("failed to get comments")
		dbComments = nil
	}
	comments := make([]map[string]interface{}, 0, len(dbComments))
	for _, c := range dbComments {
		comments = append(comments, commentToResponse(c))
	}

	h.json(w, http.StatusOK, map[string]interface{}{
		"id":            uuidToString(sv.ID),
		"title":         sv.Title,
		"description":   pgTextToPtr(sv.Description),
		"status":        string(sv.Status),
		"duration_ms":   pgInt4ToPtr(sv.DurationMs),
		"source_url":    sourceURL,
		"hls_url":       buildCDNURLValue(h.config.CDNURL, sv.HlsKey),
		"thumbnail_url": buildCDNURLValue(h.config.CDNURL, sv.ThumbnailKey),
		"gif_url":       buildCDNURLValue(h.config.CDNURL, sv.GifKey),
		"share_mode":    string(sv.ShareMode),
		"view_count":    sv.ViewCount,
		"reactions":     reactions,
		"comments":      comments,
		"created_at":    sv.CreatedAt.Time.Format(time.RFC3339),
		"creator": map[string]interface{}{
			"name":       sv.AuthorName,
			"avatar_url": pgTextToPtr(sv.AuthorAvatar),
		},
	})
}

func videoToResponse(v database.Video, cdnURL, frontendURL string) videoResponse {
	resp := videoResponse{
		ID:        uuidToString(v.ID),
		Title:     v.Title,
		Status:    string(v.Status),
		ShareMode: string(v.ShareMode),
	}

	resp.Description = pgTextToPtr(v.Description)
	resp.RecordingSource = pgTextToPtr(v.RecordingSource)
	resp.DurationMs = pgInt4ToPtr(v.DurationMs)
	resp.ThumbnailURL = buildCDNURLPtr(cdnURL, v.ThumbnailKey)
	resp.GifURL = buildCDNURLPtr(cdnURL, v.GifKey)
	resp.HlsURL = buildCDNURLPtr(cdnURL, v.HlsKey)
	resp.ShareURL = frontendURL + "/share/" + resp.ID

	if v.CreatedAt.Valid {
		resp.CreatedAt = v.CreatedAt.Time.Format(time.RFC3339)
	}
	if v.UpdatedAt.Valid {
		resp.UpdatedAt = v.UpdatedAt.Time.Format(time.RFC3339)
	}

	return resp
}

func pgTextToPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func pgInt4ToPtr(i pgtype.Int4) *int32 {
	if !i.Valid {
		return nil
	}
	return &i.Int32
}

func buildCDNURLPtr(cdnURL string, key pgtype.Text) *string {
	if !key.Valid || key.String == "" {
		return nil
	}
	url := cdnURL + "/" + key.String
	return &url
}

func buildCDNURLValue(cdnURL string, key pgtype.Text) string {
	if !key.Valid || key.String == "" {
		return ""
	}
	return cdnURL + "/" + key.String
}
