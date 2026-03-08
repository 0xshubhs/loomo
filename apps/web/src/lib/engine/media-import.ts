import type { MediaAsset, MediaMetadata } from '$lib/types/index.js';
import type { FFmpegBridge } from './ffmpeg-bridge.svelte.js';
import { generateId } from '$lib/utils/id.js';
import { getFileType } from '$lib/utils/file.js';

export async function importMediaFile(
	file: File,
	ffmpeg: FFmpegBridge
): Promise<MediaAsset> {
	const id = generateId();
	const type = getFileType(file);
	if (type === 'unknown') throw new Error(`Unsupported file type: ${file.name}`);

	let blobUrl = URL.createObjectURL(file);
	let metadata: MediaMetadata;
	let thumbnails: string[] = [];
	let waveform: Float32Array | null = null;
	let usedFile = file;

	if (type === 'video') {
		// First try native browser playback
		const nativeResult = await probeMedia(blobUrl, 'video');

		if (nativeResult.playable) {
			metadata = nativeResult.metadata;
			thumbnails = await generateThumbnails(blobUrl, metadata.duration, 6);
		} else {
			// Browser can't play this format (HEVC/ProRes .mov etc)
			// Transcode to H.264 MP4 via FFmpeg.wasm
			console.log(`Transcoding ${file.name} to browser-compatible H.264...`);
			const transcoded = await transcodeToH264(file, ffmpeg);
			URL.revokeObjectURL(blobUrl);
			blobUrl = transcoded.blobUrl;
			usedFile = transcoded.file;
			metadata = transcoded.metadata;
			thumbnails = await generateThumbnails(blobUrl, metadata.duration, 6);
		}
	} else if (type === 'audio') {
		const nativeResult = await probeMedia(blobUrl, 'audio');
		metadata = nativeResult.metadata;
		if (!nativeResult.playable) {
			metadata.duration = 0;
		}
	} else {
		// Image
		const dims = await getImageDimensions(blobUrl);
		metadata = {
			duration: 5,
			width: dims.width,
			height: dims.height,
			fps: 0,
			codec: 'image',
			audioCodec: '',
			bitrate: 0,
			fileSize: file.size,
			format: file.type,
		};
		thumbnails = [blobUrl];
	}

	return {
		id,
		name: file.name,
		file: usedFile,
		blobUrl,
		type: type as 'video' | 'audio' | 'image',
		metadata,
		thumbnails,
		waveform,
		addedAt: Date.now(),
	};
}

interface ProbeResult {
	playable: boolean;
	metadata: MediaMetadata;
}

function probeMedia(blobUrl: string, type: 'video' | 'audio'): Promise<ProbeResult> {
	return new Promise((resolve) => {
		const el = type === 'video' ? document.createElement('video') : document.createElement('audio');
		el.preload = 'metadata';

		const timeout = setTimeout(() => {
			// Timeout after 5s = probably not playable
			cleanup();
			resolve({
				playable: false,
				metadata: emptyMetadata(),
			});
		}, 5000);

		function cleanup() {
			clearTimeout(timeout);
			el.onloadedmetadata = null;
			el.onerror = null;
			el.oncanplay = null;
		}

		el.onloadedmetadata = () => {
			const videoEl = el as HTMLVideoElement;
			const meta: MediaMetadata = {
				duration: el.duration && isFinite(el.duration) ? el.duration : 0,
				width: type === 'video' ? videoEl.videoWidth : 0,
				height: type === 'video' ? videoEl.videoHeight : 0,
				fps: 30,
				codec: '',
				audioCodec: '',
				bitrate: 0,
				fileSize: 0,
				format: '',
			};

			// Check if we can actually decode frames
			if (type === 'video' && (videoEl.videoWidth === 0 || videoEl.videoHeight === 0)) {
				cleanup();
				resolve({ playable: false, metadata: meta });
				return;
			}

			// Try to actually load a frame
			el.oncanplay = () => {
				cleanup();
				resolve({ playable: true, metadata: meta });
			};

			// If canplay doesn't fire in 2s after metadata, probably not playable
			setTimeout(() => {
				cleanup();
				resolve({ playable: meta.duration > 0, metadata: meta });
			}, 2000);
		};

		el.onerror = () => {
			cleanup();
			resolve({
				playable: false,
				metadata: emptyMetadata(),
			});
		};

		el.src = blobUrl;
	});
}

async function transcodeToH264(
	file: File,
	ffmpeg: FFmpegBridge
): Promise<{ blobUrl: string; file: File; metadata: MediaMetadata }> {
	if (!ffmpeg.ready) {
		throw new Error('FFmpeg is not ready yet. Please wait for it to load.');
	}

	const inputName = 'transcode_input' + getExtFromName(file.name);
	const outputName = 'transcode_output.mp4';

	// Write input file to FFmpeg virtual filesystem
	const arrayBuffer = await file.arrayBuffer();
	await ffmpeg.writeFile(inputName, arrayBuffer);

	// Transcode to H.264/AAC MP4 (fast preset for speed)
	const exitCode = await ffmpeg.exec([
		'-i', inputName,
		'-c:v', 'libx264',
		'-preset', 'ultrafast',
		'-crf', '23',
		'-c:a', 'aac',
		'-b:a', '128k',
		'-movflags', '+faststart',
		'-y', outputName,
	]);

	if (exitCode !== 0) {
		throw new Error(`Transcoding failed for ${file.name} (exit code ${exitCode})`);
	}

	// Read the output
	const outputData = await ffmpeg.readFile(outputName);
	const blob = new Blob([outputData], { type: 'video/mp4' });
	const blobUrl = URL.createObjectURL(blob);
	const transcodedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.mp4'), { type: 'video/mp4' });

	// Clean up FFmpeg virtual filesystem
	try {
		await ffmpeg.deleteFile(inputName);
		await ffmpeg.deleteFile(outputName);
	} catch { /* ignore cleanup errors */ }

	// Probe the transcoded file
	const probeResult = await probeMedia(blobUrl, 'video');

	return {
		blobUrl,
		file: transcodedFile,
		metadata: probeResult.metadata.duration > 0
			? probeResult.metadata
			: { ...emptyMetadata(), fileSize: blob.size },
	};
}

function getExtFromName(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot >= 0 ? name.slice(dot) : '';
}

function emptyMetadata(): MediaMetadata {
	return {
		duration: 0,
		width: 0,
		height: 0,
		fps: 30,
		codec: '',
		audioCodec: '',
		bitrate: 0,
		fileSize: 0,
		format: '',
	};
}

function generateThumbnails(
	blobUrl: string,
	duration: number,
	count: number
): Promise<string[]> {
	return new Promise((resolve) => {
		if (duration <= 0) {
			resolve([]);
			return;
		}

		const video = document.createElement('video');
		video.preload = 'auto';
		video.muted = true;

		const canvas = document.createElement('canvas');
		canvas.width = 160;
		canvas.height = 90;
		const ctx = canvas.getContext('2d')!;

		const thumbnails: string[] = [];
		const interval = duration / count;
		let currentIndex = 0;

		const timeout = setTimeout(() => {
			resolve(thumbnails);
		}, 15000);

		video.onseeked = () => {
			try {
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				canvas.toBlob(
					(blob) => {
						if (blob) {
							thumbnails.push(URL.createObjectURL(blob));
						}
						currentIndex++;
						if (currentIndex < count) {
							video.currentTime = Math.min(currentIndex * interval, duration - 0.1);
						} else {
							clearTimeout(timeout);
							resolve(thumbnails);
						}
					},
					'image/jpeg',
					0.6
				);
			} catch {
				currentIndex++;
				if (currentIndex >= count) {
					clearTimeout(timeout);
					resolve(thumbnails);
				}
			}
		};

		video.onloadeddata = () => {
			video.currentTime = 0.1;
		};

		video.onerror = () => {
			clearTimeout(timeout);
			resolve([]);
		};

		video.src = blobUrl;
	});
}

function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
		img.onerror = () => resolve({ width: 0, height: 0 });
		img.src = url;
	});
}
