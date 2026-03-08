-- name: CreateProcessingJob :one
INSERT INTO processing_jobs (video_id, type)
VALUES ($1, $2)
RETURNING *;

-- name: GetProcessingJobsByVideo :many
SELECT * FROM processing_jobs
WHERE video_id = $1
ORDER BY created_at;

-- name: UpdateProcessingJobStatus :exec
UPDATE processing_jobs SET
    status = $2,
    progress = $3,
    error = $4,
    started_at = $5,
    completed_at = $6
WHERE id = $1;
