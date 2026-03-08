package worker

// TranscodeArgs holds arguments for the transcode job.
type TranscodeArgs struct {
	VideoID   string `json:"video_id"`
	UserID    string `json:"user_id"`
	SourceKey string `json:"source_key"`
}

func (TranscodeArgs) Kind() string { return "transcode" }

// ThumbnailArgs holds arguments for the thumbnail generation job.
type ThumbnailArgs struct {
	VideoID   string `json:"video_id"`
	UserID    string `json:"user_id"`
	SourceKey string `json:"source_key"`
}

func (ThumbnailArgs) Kind() string { return "thumbnail" }

// TranscribeArgs holds arguments for the transcription job.
type TranscribeArgs struct {
	VideoID   string `json:"video_id"`
	UserID    string `json:"user_id"`
	SourceKey string `json:"source_key"`
}

func (TranscribeArgs) Kind() string { return "transcribe" }
