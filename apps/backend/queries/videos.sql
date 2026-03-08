-- name: CreateVideo :one
INSERT INTO videos (user_id, title, recording_source)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetVideoByID :one
SELECT * FROM videos WHERE id = $1 AND deleted_at IS NULL;

-- name: ListVideosByUser :many
SELECT * FROM videos
WHERE user_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountVideosByUser :one
SELECT COUNT(*) FROM videos
WHERE user_id = $1 AND deleted_at IS NULL;

-- name: UpdateVideo :exec
UPDATE videos SET
    title = COALESCE($2, title),
    description = COALESCE($3, description),
    share_mode = COALESCE($4, share_mode),
    updated_at = NOW()
WHERE id = $1;

-- name: UpdateVideoStatus :exec
UPDATE videos SET
    status = $2,
    hls_key = $3,
    thumbnail_key = $4,
    gif_key = $5,
    duration_ms = $6,
    updated_at = NOW()
WHERE id = $1;

-- name: SoftDeleteVideo :exec
UPDATE videos SET deleted_at = NOW() WHERE id = $1;

-- name: GetShareVideo :one
SELECT v.id, v.title, v.description, v.status, v.duration_ms,
       v.hls_key, v.thumbnail_key, v.gif_key, v.share_mode,
       u.name AS author_name, u.avatar_url AS author_avatar,
       v.created_at
FROM videos v
JOIN users u ON v.user_id = u.id
WHERE v.id = $1 AND v.deleted_at IS NULL AND v.share_mode != 'private';

-- name: SetVideoUpload :exec
UPDATE videos SET upload_id = $2, source_key = $3, updated_at = NOW()
WHERE id = $1;
