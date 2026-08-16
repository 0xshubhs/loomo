import type { Clip } from '$lib/types/timeline.js';
import type { AnimatableProperty } from '$lib/types/keyframes.js';
import { evaluateTrack, trackFor } from '$lib/utils/keyframes.js';
import {
	compileOverlayExpr,
	compileRotationExpr,
	compileBrightnessExpr,
	compileRatioExpr,
	compileTrackExpr,
	compileAlphaCommands,
	quoteExpr,
} from './ffmpeg-keyframes.js';

/**
 * Turns a clip's keyframes into pieces of an FFmpeg filtergraph.
 *
 * Split by how each property has to reach the encoder:
 *
 * - colour and audio properties are plain filters with `eval=frame`, so they
 *   append to the existing chain;
 * - scale and position need the clip composited over a canvas, which means a
 *   `split`-free but multi-node subgraph and a `color` source;
 * - opacity has no expression-capable filter, so it rides a generated sendcmd
 *   script written next to the media.
 */

const GEOMETRY_PROPERTIES: AnimatableProperty[] = ['scale', 'positionX', 'positionY'];

export function animatedProperties(clip: Clip): AnimatableProperty[] {
	return (clip.keyframes ?? []).filter((t) => t.keyframes.length > 0).map((t) => t.property);
}

export function hasAnyKeyframes(clip: Clip): boolean {
	return animatedProperties(clip).length > 0;
}

export function hasGeometryKeyframes(clip: Clip): boolean {
	const animated = animatedProperties(clip);
	return GEOMETRY_PROPERTIES.some((p) => animated.includes(p));
}

/** `eq` terms animated per frame. Empty when no colour property is keyframed. */
export function buildKeyframeColorFilter(clip: Clip): string | null {
	const terms: string[] = [];

	const brightness = compileBrightnessExpr(trackFor(clip.keyframes, 'brightness'));
	if (brightness) terms.push(`brightness=${quoteExpr(brightness)}`);

	const contrast = compileRatioExpr(trackFor(clip.keyframes, 'contrast'));
	if (contrast) terms.push(`contrast=${quoteExpr(contrast)}`);

	const saturation = compileRatioExpr(trackFor(clip.keyframes, 'saturation'));
	if (saturation) terms.push(`saturation=${quoteExpr(saturation)}`);

	if (terms.length === 0) return null;
	return `eq=${terms.join(':')}:eval=frame`;
}

export function buildKeyframeRotationFilter(clip: Clip): string | null {
	const angle = compileRotationExpr(trackFor(clip.keyframes, 'rotation'));
	if (!angle) return null;
	// c=none keeps the corners transparent so the canvas shows through.
	return `rotate=${quoteExpr(angle)}:c=none`;
}

export function buildKeyframeVolumeFilter(clip: Clip): string | null {
	const volume = compileRatioExpr(trackFor(clip.keyframes, 'volume'));
	if (!volume) return null;
	return `volume=${quoteExpr(volume)}:eval=frame`;
}

/**
 * The animated scale filter, or null when scale is static.
 *
 * Applied *after* the clip has been fitted into the target frame but before it
 * is composited, so the multiplier acts on the fitted image rather than on a
 * letterboxed one — scaling a padded frame would blow up the black bars too.
 */
export function buildKeyframeScaleFilter(clip: Clip): string | null {
	const track = trackFor(clip.keyframes, 'scale');
	if (!track || track.keyframes.length === 0) return null;

	const factor = compileTrackExpr(track, (v) => v / 100)!;
	const w = quoteExpr(`trunc(iw*(${factor})/2)*2`);
	const h = quoteExpr(`trunc(ih*(${factor})/2)*2`);
	return `scale=w=${w}:h=${h}:eval=frame`;
}

export interface CompositeGraph {
	/** Filtergraph nodes, each joined with ';' by the caller. */
	parts: string[];
	/** Label carrying the composited result. */
	outputLabel: string;
}

/**
 * Composites an animated clip over a canvas at the target resolution.
 *
 * Position keyframes are percentages of the canvas measured from centred, so a
 * clip with no position animation sits exactly where it would have without
 * keyframes at all.
 */
export function buildCompositeGraph(
	clip: Clip,
	inputLabel: string,
	outputLabel: string,
	width: number,
	height: number,
	fps: number
): CompositeGraph {
	const backgroundLabel = `${outputLabel}bg`;
	const foregroundLabel = `${outputLabel}fg`;

	const x = compileOverlayExpr(trackFor(clip.keyframes, 'positionX'), 'x') ?? '(W-w)/2';
	const y = compileOverlayExpr(trackFor(clip.keyframes, 'positionY'), 'y') ?? '(H-h)/2';

	return {
		parts: [
			`[${inputLabel}]null[${foregroundLabel}]`,
			`color=c=black:s=${width}x${height}:r=${fps}:d=${clip.duration}[${backgroundLabel}]`,
			`[${backgroundLabel}][${foregroundLabel}]overlay=x=${quoteExpr(x)}:y=${quoteExpr(y)}:shortest=1[${outputLabel}]`,
		],
		outputLabel,
	};
}

export interface AlphaScript {
	filename: string;
	content: string;
	/** Filters to insert into the video chain, in order. */
	filters: string[];
}

/**
 * Sendcmd script and filters for animated opacity.
 *
 * `colorchannelmixer` takes runtime commands but not expressions, so the curve
 * is sampled once per output frame and replayed as commands. The filter is
 * tagged `@kf` because that is the name the generated script addresses.
 */
export function buildAlphaScript(clip: Clip, index: number, fps: number): AlphaScript | null {
	const track = trackFor(clip.keyframes, 'opacity');
	if (!track || track.keyframes.length === 0) return null;

	const content = compileAlphaCommands(track, clip.duration, fps, (time) =>
		evaluateTrack(track, time) ?? 100
	);
	if (!content) return null;

	const filename = `kf_alpha_${index}.cmd`;
	return {
		filename,
		content,
		filters: [
			'format=yuva420p',
			`sendcmd=filename=${filename}`,
			'colorchannelmixer@kf=aa=1',
		],
	};
}
