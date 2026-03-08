// ============ Enums ============

export type VideoStatus = 'uploading' | 'processing' | 'ready' | 'failed';
export type ShareMode = 'public' | 'unlisted' | 'private';
export type RecordingSource = 'browser' | 'desktop' | 'upload';
export type JobType = 'transcode' | 'thumbnail' | 'transcribe';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

// ============ Auth ============

export interface SignupRequest {
	email: string;
	password: string;
	name: string;
}

export interface LoginRequest {
	email: string;
	password: string;
}

export interface AuthResponse {
	user: UserResponse;
	access_token: string;
	refresh_token: string;
}

export interface RefreshRequest {
	refresh_token: string;
}

export interface UserResponse {
	id: string;
	email: string;
	name: string;
	avatar_url: string | null;
	created_at: string;
}

// ============ Videos ============

export interface CreateVideoRequest {
	title?: string;
	recording_source: RecordingSource;
}

export interface CreateVideoResponse {
	video: VideoResponse;
	upload_url: string;
	upload_expires_at: string;
}

export interface VideoResponse {
	id: string;
	title: string;
	description: string | null;
	status: VideoStatus;
	duration_ms: number | null;
	recording_source: RecordingSource | null;
	thumbnail_url: string | null;
	gif_url: string | null;
	hls_url: string | null;
	share_mode: ShareMode;
	share_url: string;
	created_at: string;
	updated_at: string;
	processing_jobs?: ProcessingJobResponse[];
}

export interface UpdateVideoRequest {
	title?: string;
	description?: string;
	share_mode?: ShareMode;
}

export interface ListVideosResponse {
	videos: VideoResponse[];
	pagination: PaginationResponse;
}

// ============ Processing ============

export interface ProcessingJobResponse {
	id: string;
	type: JobType;
	status: JobStatus;
	progress: number;
	error: string | null;
}

// ============ Share ============

export interface ShareVideoResponse {
	id: string;
	title: string;
	description: string | null;
	duration_ms: number | null;
	hls_url: string | null;
	thumbnail_url: string | null;
	gif_url: string | null;
	share_mode: ShareMode;
	created_at: string;
	creator: {
		name: string;
		avatar_url: string | null;
	};
}

// ============ Pagination ============

export interface PaginationResponse {
	page: number;
	per_page: number;
	total: number;
	has_more: boolean;
}
