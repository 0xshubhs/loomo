export type RecordingMode = 'screen-cam' | 'screen-only' | 'camera-only';
export type RecordingState = 'idle' | 'requesting-permissions' | 'countdown' | 'recording' | 'paused' | 'processing' | 'done' | 'error';
export type RecordingQuality = '1080p' | '720p' | '480p';

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: 'videoinput' | 'audioinput';
}

export interface RecordingConfig {
  mode: RecordingMode;
  quality: RecordingQuality;
  cameraDeviceId: string | null;
  micDeviceId: string | null;
  systemAudio: boolean;
}

export interface RecordingResult {
  blob: Blob;
  duration: number;
  mimeType: string;
  thumbnailUrl: string;
}

export interface CameraBubblePosition {
  x: number;
  y: number;
}

export const QUALITY_MAP: Record<RecordingQuality, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
  '480p': { width: 854, height: 480 },
};
