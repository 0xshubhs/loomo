-- name: RecordView :one
WITH inserted AS (
    INSERT INTO video_views (video_id, viewer_ip, viewer_user_id)
    VALUES ($1, $2, $3)
    RETURNING *
)
UPDATE videos SET view_count = COALESCE(view_count, 0) + 1
WHERE id = $1
RETURNING view_count;

-- name: GetViewCount :one
SELECT COALESCE(view_count, 0)::integer AS view_count
FROM videos
WHERE id = $1;

-- name: HasRecentView :one
SELECT EXISTS(
    SELECT 1 FROM video_views
    WHERE video_id = $1 AND viewer_ip = $2
    AND created_at > NOW() - INTERVAL '1 hour'
) AS has_recent;
