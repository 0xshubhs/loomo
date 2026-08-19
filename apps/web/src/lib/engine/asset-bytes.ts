import type { MediaAsset } from '$lib/types/media.js';
import type { FFmpegEngine } from './ffmpeg-engine.js';

/**
 * Getting an asset's bytes, wherever they happen to live.
 *
 * There are three cases and code kept assuming the first. A freshly dropped
 * file has a real `File` and a blob URL. A file picked through the OS dialog
 * has neither — its bytes went straight to disk, because letting the webview
 * hold them is what broke on filenames containing `%20`. A reopened project
 * has neither either, for the same reason: materialising a gigabyte to satisfy
 * a type defeats the point of keeping it on disk.
 *
 * `fetch(asset.blobUrl)` on the last two returns nothing useful, which is how
 * captions and silence detection came to fail on exactly the files that
 * imported most cleanly.
 */
/**
 * The largest file worth pulling into the page whole.
 *
 * Not a hard technical limit — a judgement about where the copies stop being
 * survivable. Callers that need more must work in windows, the way preview
 * audio does.
 */
export const MAX_WHOLE_READ_BYTES = 400 * 1024 * 1024;

export async function assetBlob(asset: MediaAsset, ffmpeg?: FFmpegEngine): Promise<Blob> {
	if (asset.file && asset.file.size > 0) return asset.file;

	if (asset.scratchName && ffmpeg) {
		// Reading a file this way costs a copy in Rust, one in transit and one
		// in the page. A gigabyte source is three gigabytes before anything
		// has decoded it, which is how a 50-minute clip killed the app.
		const size = (await ffmpeg.fileSize?.(asset.scratchName)) ?? 0;
		if (size > MAX_WHOLE_READ_BYTES) {
			throw new Error(
				`"${asset.name}" is ${Math.round(size / (1024 * 1024))} MB, which is too large to load ` +
					`into memory at once. Split it on the timeline and run this on a shorter section.`
			);
		}

		const bytes = await ffmpeg.readFile(asset.scratchName);
		return new Blob([bytes], { type: mimeFor(asset.type) });
	}

	if (asset.blobUrl) {
		const response = await fetch(asset.blobUrl);
		return await response.blob();
	}

	throw new Error(`No bytes available for "${asset.name}".`);
}

function mimeFor(type: 'video' | 'audio' | 'image'): string {
	if (type === 'audio') return 'audio/mp4';
	if (type === 'image') return 'image/png';
	return 'video/mp4';
}
