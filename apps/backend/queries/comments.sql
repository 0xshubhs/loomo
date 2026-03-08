-- name: CreateComment :one
INSERT INTO video_comments (video_id, user_id, author_name, author_avatar, body, timestamp_seconds)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetCommentsByVideo :many
SELECT * FROM video_comments
WHERE video_id = $1
ORDER BY created_at ASC;

-- name: DeleteComment :exec
DELETE FROM video_comments WHERE id = $1;
