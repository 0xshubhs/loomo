export type ExportFormat = 'mp4' | 'webm' | 'mkv' | 'avi' | 'mov';
export type VideoCodec = 'libx264' | 'libx265' | 'libvpx-vp9' | 'libvpx';
export type AudioCodec = 'aac' | 'libopus' | 'libvorbis' | 'mp3';
export type Resolution = '4k' | '1080p' | '720p' | '480p' | 'custom';

export interface ExportConfig {
	format: ExportFormat;
	videoCodec: VideoCodec;
	audioCodec: AudioCodec;
	resolution: Resolution;
	customWidth?: number;
	customHeight?: number;
	fps: number;
	videoBitrate: number;
	audioBitrate: number;
	quality: number;
}

export interface ExportProgress {
	stage: 'preparing' | 'rendering' | 'encoding' | 'finalizing' | 'done' | 'error';
	progress: number;
	currentFrame: number;
	totalFrames: number;
	elapsed: number;
	eta: number;
	outputSize: number;
}

export const RESOLUTION_MAP: Record<Resolution, { width: number; height: number }> = {
	'4k': { width: 3840, height: 2160 },
	'1080p': { width: 1920, height: 1080 },
	'720p': { width: 1280, height: 720 },
	'480p': { width: 854, height: 480 },
	'custom': { width: 1920, height: 1080 },
};

export const FORMAT_DEFAULTS: Record<ExportFormat, { videoCodec: VideoCodec; audioCodec: AudioCodec }> = {
	mp4: { videoCodec: 'libx264', audioCodec: 'aac' },
	webm: { videoCodec: 'libvpx-vp9', audioCodec: 'libopus' },
	mkv: { videoCodec: 'libx264', audioCodec: 'aac' },
	avi: { videoCodec: 'libx264', audioCodec: 'mp3' },
	mov: { videoCodec: 'libx264', audioCodec: 'aac' },
};
