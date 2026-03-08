CREATE TYPE job_type AS ENUM ('transcode', 'thumbnail', 'transcribe');
CREATE TYPE job_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE processing_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    type            job_type NOT NULL,
    status          job_status NOT NULL DEFAULT 'pending',
    progress        INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_processing_jobs_video ON processing_jobs(video_id);
CREATE INDEX idx_processing_jobs_status ON processing_jobs(status)
    WHERE status IN ('pending', 'running');
