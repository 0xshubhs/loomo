import { apiFetch } from './client.js';

export async function createVideo(title?: string, recordingSource = 'browser') {
  return apiFetch<{ video: any; upload_url: string; upload_expires_at: string }>('/api/videos', {
    method: 'POST',
    body: JSON.stringify({ title, recording_source: recordingSource }),
  });
}

export async function listVideos(page = 1, perPage = 20) {
  return apiFetch<{ videos: any[]; pagination: any }>(`/api/videos?page=${page}&per_page=${perPage}`);
}

export async function getVideo(id: string) {
  return apiFetch<any>(`/api/videos/${id}`);
}

export async function updateVideo(id: string, updates: { title?: string; description?: string; share_mode?: string }) {
  return apiFetch<any>(`/api/videos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteVideo(id: string) {
  return apiFetch<void>(`/api/videos/${id}`, { method: 'DELETE' });
}

export async function completeVideo(id: string) {
  return apiFetch<any>(`/api/videos/${id}/complete`, { method: 'POST' });
}

export async function uploadVideoBlob(uploadUrl: string, blob: Blob) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': blob.type },
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}
