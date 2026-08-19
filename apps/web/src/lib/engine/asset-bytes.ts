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
export async function assetBlob(asset: MediaAsset, ffmpeg?: FFmpegEngine): Promise<Blob> {
	if (asset.file && asset.file.size > 0) return asset.file;

	if (asset.scratchName && ffmpeg) {
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
