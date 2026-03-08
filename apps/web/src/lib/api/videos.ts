import { apiFetch } from './client.js';

export interface CreateVideoResponse {
  video: {
    id: string;
    title: string;
    status: string;
    share_id: string;
    created_at: string;
  };
  upload_url: string;
  upload_expires_at: string;
}

export interface VideoResponse {
  id: string;
  title: string;
  status: string;
  share_id: string;
  hls_url?: string;
  thumbnail_url?: string;
  duration?: number;
  created_at: string;
}

export async function createVideo(title?: string, recordingSource = 'browser') {
  return apiFetch<CreateVideoResponse>('/api/videos', {
    method: 'POST',
    body: JSON.stringify({ title, recording_source: recordingSource }),
  });
}

export async function listVideos(page = 1, perPage = 20) {
  return apiFetch<{ videos: VideoResponse[]; pagination: any }>(`/api/videos?page=${page}&per_page=${perPage}`);
}

export async function getVideo(id: string) {
  return apiFetch<VideoResponse>(`/api/videos/${id}`);
}

export async function updateVideo(id: string, updates: { title?: string; description?: string; share_mode?: string }) {
  return apiFetch<VideoResponse>(`/api/videos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteVideo(id: string) {
  return apiFetch<void>(`/api/videos/${id}`, { method: 'DELETE' });
}

export async function completeVideo(id: string) {
  return apiFetch<VideoResponse>(`/api/videos/${id}/complete`, { method: 'POST' });
}
