CREATE TABLE video_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    reactor_name VARCHAR(255),
    reactor_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_video_reactions_video_id ON video_reactions(video_id);
