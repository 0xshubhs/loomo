export type ExportFormat = 'mp4' | 'webm' | 'mkv' | 'avi' | 'mov' | 'gif' | 'm4a';
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
	/**
	 * Bring every clip to a common loudness before mixing.
	 *
	 * Clips cut together routinely differ by 10dB or more, and reproducing that
	 * faithfully makes half a video sound like the volume was turned down.
	 */
	normalizeLoudness?: boolean;
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

/**
 * Sensible video bitrate for a resolution, in kbps.
 *
 * One default across every tier meant 4K was encoded at a 1080p bitrate — a
 * 3840x2160 file that looks worse than its own source, because 5 Mbps spread
 * over four times the pixels is roughly a quarter of the detail per pixel.
 * These follow the usual H.264 delivery guidance for 30fps.
 */
export const BITRATE_FOR_RESOLUTION: Record<Resolution, number> = {
	'4k': 35000,
	'1080p': 8000,
	'720p': 5000,
	'480p': 2500,
	'custom': 8000,
};

export const FORMAT_DEFAULTS: Record<ExportFormat, { videoCodec: VideoCodec; audioCodec: AudioCodec }> = {
	mp4: { videoCodec: 'libx264', audioCodec: 'aac' },
	webm: { videoCodec: 'libvpx-vp9', audioCodec: 'libopus' },
	mkv: { videoCodec: 'libx264', audioCodec: 'aac' },
	avi: { videoCodec: 'libx264', audioCodec: 'mp3' },
	mov: { videoCodec: 'libx264', audioCodec: 'aac' },
	gif: { videoCodec: 'libx264', audioCodec: 'aac' }, // special handling in pipeline
	m4a: { videoCodec: 'libx264', audioCodec: 'aac' }, // audio-only
};
