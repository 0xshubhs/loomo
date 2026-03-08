CREATE TYPE video_status AS ENUM ('uploading', 'processing', 'ready', 'failed');
CREATE TYPE share_mode AS ENUM ('public', 'unlisted', 'private');

CREATE TABLE videos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(500) NOT NULL DEFAULT 'Untitled Recording',
    description     TEXT,
    status          video_status NOT NULL DEFAULT 'uploading',
    duration_ms     INTEGER,
    recording_source VARCHAR(50),

    -- R2 storage paths
    source_key      TEXT,
    hls_key         TEXT,
    thumbnail_key   TEXT,
    gif_key         TEXT,

    -- Sharing
    share_mode      share_mode NOT NULL DEFAULT 'unlisted',

    -- Multipart upload tracking
    upload_id       TEXT,
    upload_parts    JSONB,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_videos_user ON videos(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_status ON videos(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_created ON videos(created_at DESC) WHERE deleted_at IS NULL;
