import type { Clip, Track } from '$lib/types/timeline.js';
import { overlayGeometry } from '$lib/engine/composite-tracks.js';

/**
 * What the preview should be showing at a given moment.
 *
 * The preview used to find the first video track's active clip and paint only
 * that. Meanwhile the export composited every other video track on top. So an
 * image held over the opening ten seconds — the thing the timeline is most
 * often used for — previewed as nothing and exported correctly, which is the
 * worst way round: the editor cannot see what they are making.
 *
 * The layering rules here are deliberately the same ones `planComposite` uses,
 * and the geometry is literally the same function, so the two cannot drift.
 */

export interface PreviewLayer {
	clip: Clip;
	/** Index of the track it came from. Later tracks draw over earlier ones. */
	trackIndex: number;
	/** 0–1, as `Clip.opacity` is. Not the 0–100 that `ClipFilters.opacity` uses. */
	opacity: number;
}

/**
 * Every visible clip at `time`, bottom layer first.
 *
 * The first video track holding a clip is the base, exactly as the export
 * chooses it; everything above draws over it. Hidden tracks contribute
 * nothing, and audio tracks are not pictures.
 */
export function visibleLayers(tracks: Track[], time: number): PreviewLayer[] {
	const layers: PreviewLayer[] = [];

	tracks.forEach((track, trackIndex) => {
		if (track.type !== 'video' || track.visible === false) return;

		for (const clip of track.clips) {
			if (time < clip.timelineStart || time >= clip.timelineStart + clip.duration) continue;
			layers.push({
				clip,
				trackIndex,
				// `Clip.opacity` is 0–1. Reading it as a percentage is the bug
				// that made composited overlays invisible in the export.
				opacity: Math.min(Math.max(clip.opacity ?? 1, 0), 1),
			});
		}
	});

	return layers;
}

/** The base clip — the one the video element loads — or null on an empty frame. */
export function baseLayer(layers: PreviewLayer[]): PreviewLayer | null {
	return layers[0] ?? null;
}

/** Layers drawn on top of the base, in stacking order. */
export function overlayLayers(layers: PreviewLayer[]): PreviewLayer[] {
	return layers.slice(1);
}

export interface DrawRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Where a layer draws inside the preview frame.
 *
 * ffmpeg scales overlays with `force_original_aspect_ratio=decrease`, which
 * fits the source inside its box and leaves the remainder empty; the result is
 * then centred. Reproducing that here rather than stretching to the box is
 * what stops a 16:9 logo previewing square and exporting wide.
 */
export function layerRect(
	clip: Clip,
	frameWidth: number,
	frameHeight: number,
	sourceWidth: number,
	sourceHeight: number
): DrawRect {
	const box = overlayGeometry(clip, frameWidth, frameHeight);

	// Nothing sensible to fit: fill the box and let the caller draw.
	if (sourceWidth <= 0 || sourceHeight <= 0) {
		return { x: box.x, y: box.y, width: box.width, height: box.height };
	}

	const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
	const width = sourceWidth * scale;
	const height = sourceHeight * scale;

	return {
		x: box.x + (box.width - width) / 2,
		y: box.y + (box.height - height) / 2,
		width,
		height,
	};
}
