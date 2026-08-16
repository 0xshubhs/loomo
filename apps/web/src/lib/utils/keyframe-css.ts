import type { Clip } from '$lib/types/timeline.js';
import { evaluateTrack, trackFor } from './keyframes.js';

export interface KeyframeCss {
	/** Appended to the element's existing CSS `filter`. */
	filter: string;
	/** Appended to the element's existing CSS `transform`. */
	transform: string;
	/** Empty when opacity is not animated, so a static opacity survives. */
	opacity: string;
	/** Empty when volume is not animated. */
	volume: number | null;
}

const EMPTY: KeyframeCss = { filter: '', transform: '', opacity: '', volume: null };

/**
 * Evaluates a clip's keyframes into CSS for the preview.
 *
 * The exporter compiles the same curves into FFmpeg expressions. The two have
 * to stay in step or the preview stops predicting the output, so the unit
 * conversions here mirror `engine/ffmpeg-keyframes.ts` one for one:
 * percentages to multipliers, degrees to CSS `deg`, and position as a
 * percentage of the frame measured from centre.
 */
export function buildKeyframeCss(clip: Clip, timeInClip: number): KeyframeCss {
	const tracks = clip.keyframes;
	if (!tracks || tracks.length === 0) return EMPTY;

	const filters: string[] = [];
	const transforms: string[] = [];
	let opacity = '';
	let volume: number | null = null;

	const value = (property: Parameters<typeof trackFor>[1]): number | null => {
		const track = trackFor(tracks, property);
		if (!track || track.keyframes.length === 0) return null;
		return evaluateTrack(track, timeInClip);
	};

	// Geometry. Translate before scale so the offset is measured in frame
	// units rather than being multiplied by the scale, matching the
	// exporter's overlay-then-scale ordering.
	const positionX = value('positionX');
	const positionY = value('positionY');
	if (positionX !== null || positionY !== null) {
		transforms.push(`translate(${(positionX ?? 0).toFixed(3)}%, ${(positionY ?? 0).toFixed(3)}%)`);
	}

	const scale = value('scale');
	if (scale !== null) transforms.push(`scale(${(scale / 100).toFixed(4)})`);

	const rotation = value('rotation');
	if (rotation !== null) transforms.push(`rotate(${rotation.toFixed(3)}deg)`);

	// Colour.
	const brightness = value('brightness');
	if (brightness !== null) filters.push(`brightness(${(brightness / 100).toFixed(4)})`);

	const contrast = value('contrast');
	if (contrast !== null) filters.push(`contrast(${(contrast / 100).toFixed(4)})`);

	const saturation = value('saturation');
	if (saturation !== null) filters.push(`saturate(${(saturation / 100).toFixed(4)})`);

	const opacityValue = value('opacity');
	if (opacityValue !== null) opacity = (opacityValue / 100).toFixed(4);

	const volumeValue = value('volume');
	if (volumeValue !== null) volume = Math.min(Math.max(volumeValue / 100, 0), 2);

	return {
		filter: filters.join(' '),
		transform: transforms.join(' '),
		opacity,
		volume,
	};
}
