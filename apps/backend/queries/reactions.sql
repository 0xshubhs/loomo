-- name: AddReaction :one
INSERT INTO video_reactions (video_id, emoji, reactor_name, reactor_user_id)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetReactionsByVideo :many
SELECT * FROM video_reactions
WHERE video_id = $1
ORDER BY created_at DESC;

-- name: GetReactionCounts :many
SELECT emoji, COUNT(*)::integer AS count
FROM video_reactions
WHERE video_id = $1
GROUP BY emoji
ORDER BY count DESC;
