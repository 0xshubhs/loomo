import type { MediaAsset, MediaMetadata } from '$lib/types/index.js';
import type { FFmpegEngine } from './ffmpeg-engine.js';
import { generateId } from '$lib/utils/id.js';
import { getFileType } from '$lib/utils/file.js';

export async function importMediaFile(
	file: File,
	ffmpeg: FFmpegEngine
): Promise<MediaAsset> {
	const id = generateId();
	const type = getFileType(file);
	// Traced end to end: import has several places it can stall or bail, and
	// without this the only symptom is that nothing appears in the library.
	console.info(`[import] "${file.name}" type=${type} size=${file.size} mime=${file.type || 'none'}`);
	if (type === 'unknown') throw new Error(`Unsupported file type: ${file.name}`);

	let blobUrl = URL.createObjectURL(file);
	let metadata: MediaMetadata;
	let thumbnails: string[] = [];
	let waveform: Float32Array | null = null;
	let usedFile = file;

	if (type === 'video') {
		// First try native browser playback
		const nativeResult = await probeMedia(blobUrl, 'video');
		console.info(
			`[import] probe playable=${nativeResult.playable} dur=${nativeResult.metadata.duration.toFixed(2)} ` +
				`${nativeResult.metadata.width}x${nativeResult.metadata.height}`
		);

		if (nativeResult.playable) {
			metadata = nativeResult.metadata;
			thumbnails = await generateThumbnails(blobUrl, metadata.duration, 6);
			console.info(`[import] thumbnails=${thumbnails.length}`);
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

/**
 * Whether this platform can decode H.264 in a `<video>` element.
 *
 * Chrome and Safari always can. The desktop app's webview is WebKitGTK, which
 * decodes through GStreamer, so on a Linux box missing `gstreamer1.0-libav`
 * the answer is no and every H.264 file looks corrupt to the editor.
 */
function canDecodeH264(): boolean {
	if (typeof document === 'undefined') return true;
	const video = document.createElement('video');
	// avc1.42E01E is Baseline 3.0 — the most widely supported H.264 profile.
	const support = video.canPlayType('video/mp4; codecs="avc1.42E01E"');
	return support === 'probably' || support === 'maybe';
}

async function transcodeToH264(
	file: File,
	ffmpeg: FFmpegEngine
): Promise<{ blobUrl: string; file: File; metadata: MediaMetadata }> {
	if (!ffmpeg.ready) {
		throw new Error('FFmpeg is not ready yet. Please wait for it to load.');
	}

	// Transcoding produces H.264, so if the platform cannot decode H.264 the
	// output would be just as unplayable as the input. Bail out with something
	// the user can act on instead of spending minutes and gigabytes to arrive
	// at the same failure.
	if (!canDecodeH264()) {
		throw new Error(
			`Cannot play "${file.name}", and converting it would not help because this system has no H.264 decoder. ` +
				`On Linux install the GStreamer codecs: sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-good gstreamer1.0-plugins-bad`
		);
	}

	const inputName = 'transcode_input' + getExtFromName(file.name);
	const outputName = 'transcode_output.mp4';

	// Stream the source in when the engine allows it. Reading a large video
	// into a single ArrayBuffer costs a full copy in the page, another in the
	// IPC layer and another on the far side — enough to get the desktop app
	// OOM-killed on an ordinary clip.
	if (ffmpeg.writeFileStreaming) {
		await ffmpeg.writeFileStreaming(inputName, file);
	} else {
		const arrayBuffer = await file.arrayBuffer();
		await ffmpeg.writeFile(inputName, arrayBuffer);
	}

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
		// 'metadata' rather than 'auto': the whole point is to seek to a handful
		// of points, and asking the browser to buffer the entire file first
		// makes a long clip crawl for no benefit.
		video.preload = 'metadata';
		video.muted = true;

		const canvas = document.createElement('canvas');
		canvas.width = 160;
		canvas.height = 90;
		const ctx = canvas.getContext('2d')!;

		const thumbnails: string[] = [];
		const interval = duration / count;
		let currentIndex = 0;
		let settled = false;

		// Overall ceiling, plus a per-seek one below.
		const timeout = setTimeout(() => finish(), 8000);

		function finish() {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			clearTimeout(seekTimer);
			video.onseeked = null;
			video.onloadeddata = null;
			video.onerror = null;
			// Release the decoder; a lingering <video> on a large blob keeps
			// the whole buffer alive.
			video.removeAttribute('src');
			video.load();
			resolve(thumbnails);
		}

		let seekTimer: ReturnType<typeof setTimeout>;

		/**
		 * Some files simply refuse to seek to a given offset — one real 235s
		 * H.264 clip fires `seeked` once and then never again, which used to
		 * stall every import behind the 15s ceiling. Giving up on a single
		 * seek and moving on keeps a stubborn file from holding up the rest.
		 */
		function seekTo(index: number) {
			clearTimeout(seekTimer);
			if (index >= count) {
				finish();
				return;
			}
			seekTimer = setTimeout(() => {
				// This position is not coming; stop rather than wait it out.
				finish();
			}, 2500);
			// Never target exactly 0: currentTime is already 0, so assigning it
			// fires no `seeked` event and the first frame would never arrive.
			const target = Math.max(0.1, index * interval);
			video.currentTime = Math.min(target, Math.max(0.1, duration - 0.1));
		}

		video.onseeked = () => {
			clearTimeout(seekTimer);
			try {
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				canvas.toBlob(
					(blob) => {
						if (blob) thumbnails.push(URL.createObjectURL(blob));
						currentIndex++;
						seekTo(currentIndex);
					},
					'image/jpeg',
					0.6
				);
			} catch {
				currentIndex++;
				seekTo(currentIndex);
			}
		};

		video.onloadeddata = () => seekTo(0);

		video.onerror = () => finish();

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
