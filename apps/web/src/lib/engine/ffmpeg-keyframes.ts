import type { EasingType, Keyframe, KeyframeTrack } from '$lib/types/keyframes.js';
import { sortKeyframes } from '$lib/utils/keyframes.js';

/**
 * Compiles keyframe curves into FFmpeg filter expressions.
 *
 * FFmpeg evaluates certain filter options once per frame, with `t` bound to the
 * frame's timestamp. That lets a whole animation ride along as a single
 * expression instead of being baked into frames ahead of time. The curve
 * becomes nested `if(lt(t, …), …)` branches — one per segment — matching the
 * easing shapes in `utils/keyframes.ts` exactly, so preview and export agree.
 *
 * Every emitted expression must be wrapped in single quotes inside a
 * filtergraph, because it contains commas that would otherwise be read as
 * filter separators. `quoteExpr` does that.
 */

/** Trims float noise; FFmpeg parses plain decimals fine. */
function num(value: number): string {
	if (!Number.isFinite(value)) return '0';
	return Number(value.toFixed(4)).toString();
}

/**
 * Normalized progress through a segment, as an FFmpeg sub-expression.
 * Clamped so rounding at segment edges can't overshoot.
 */
function progressExpr(startTime: number, endTime: number): string {
	const span = endTime - startTime;
	if (span <= 0) return '1';
	return `min(1,max(0,(t-${num(startTime)})/${num(span)}))`;
}

/**
 * Easing applied to a progress sub-expression.
 *
 * `p` is inlined at each use rather than bound to a variable, because FFmpeg
 * expressions have no way to declare one. Verbose, but correct.
 */
function easedExpr(p: string, easing: EasingType): string {
	switch (easing) {
		case 'hold':
			return '0';
		case 'ease-in':
			return `pow(${p},2)`;
		case 'ease-out':
			return `(1-pow(1-${p},2))`;
		case 'ease-in-out':
			return `if(lt(${p},0.5),2*pow(${p},2),1-pow(-2*${p}+2,2)/2)`;
		case 'linear':
		default:
			return p;
	}
}

/** One segment: value at `a` easing toward value at `b`. */
function segmentExpr(a: Keyframe, b: Keyframe): string {
	if (a.easing === 'hold' || b.value === a.value) return num(a.value);
	const delta = b.value - a.value;
	const eased = easedExpr(progressExpr(a.time, b.time), a.easing);
	return `(${num(a.value)}+${num(delta)}*${eased})`;
}

/**
 * The whole curve as one FFmpeg expression, or null when the track is empty.
 *
 * `transform` remaps each keyframe's value into the units the target filter
 * wants — percent to a 0..1 ratio, degrees to radians, and so on.
 */
export function compileTrackExpr(
	track: KeyframeTrack | undefined,
	transform: (value: number) => number = (v) => v
): string | null {
	if (!track || track.keyframes.length === 0) return null;

	const frames = sortKeyframes(track.keyframes).map((k) => ({ ...k, value: transform(k.value) }));
	if (frames.length === 1) return num(frames[0].value);

	// Build from the tail backwards so each branch nests inside the previous.
	let expr = num(frames[frames.length - 1].value);
	for (let i = frames.length - 2; i >= 0; i--) {
		const a = frames[i];
		const b = frames[i + 1];
		expr = `if(lt(t,${num(b.time)}),${segmentExpr(a, b)},${expr})`;
	}

	// Before the first keyframe the curve holds at its initial value.
	const first = frames[0];
	if (first.time > 0) {
		expr = `if(lt(t,${num(first.time)}),${num(first.value)},${expr})`;
	}

	return expr;
}

/** Wraps an expression for safe use as a filter option value. */
export function quoteExpr(expr: string): string {
	return `'${expr}'`;
}

/**
 * Sendcmd script driving a property FFmpeg can't express per frame.
 *
 * `colorchannelmixer` accepts runtime commands but not expressions, so animated
 * opacity is emitted as one command per frame at the export frame rate. At 30fps
 * that reads as smooth, and the script is tiny compared with the video itself.
 */
export function compileAlphaCommands(
	track: KeyframeTrack | undefined,
	duration: number,
	fps: number,
	evaluate: (time: number) => number
): string | null {
	if (!track || track.keyframes.length === 0) return null;
	if (duration <= 0 || fps <= 0) return null;

	const lines: string[] = [];
	const frameCount = Math.ceil(duration * fps);
	let previous: string | null = null;

	for (let frame = 0; frame <= frameCount; frame++) {
		const time = frame / fps;
		const alpha = Number((Math.min(Math.max(evaluate(time), 0), 100) / 100).toFixed(3)).toString();
		// Repeated identical values would just be redundant commands.
		if (alpha === previous) continue;
		previous = alpha;
		lines.push(`${num(time)} colorchannelmixer@kf aa ${alpha};`);
	}

	return lines.length > 0 ? lines.join('\n') : null;
}

// ── Per-property compilation into the units each filter expects ─────

/** scale w/h: percent → multiplier of the input dimension. */
export function compileScaleExpr(track: KeyframeTrack | undefined, dimension: 'iw' | 'ih'): string | null {
	const expr = compileTrackExpr(track, (v) => v / 100);
    if (!expr) return null;
    // Rounded to an even number of pixels: yuv420p cannot encode odd dimensions.
	return `trunc(${dimension}*(${expr})/2)*2`;
}

/** rotate angle: degrees → radians. */
export function compileRotationExpr(track: KeyframeTrack | undefined): string | null {
	return compileTrackExpr(track, (v) => (v * Math.PI) / 180);
}

/**
 * overlay x/y: percent of the canvas, centred by default.
 *
 * `0` means centred, so the offset is added to the centring term rather than
 * treated as an absolute coordinate.
 */
export function compileOverlayExpr(
	track: KeyframeTrack | undefined,
	axis: 'x' | 'y'
): string | null {
	const expr = compileTrackExpr(track, (v) => v / 100);
	if (!expr) return null;
	const canvas = axis === 'x' ? 'W' : 'H';
	const overlaySize = axis === 'x' ? 'w' : 'h';
	return `(${canvas}-${overlaySize})/2+${canvas}*(${expr})`;
}

/** eq brightness: 0..200 percent → -1..1 offset. */
export function compileBrightnessExpr(track: KeyframeTrack | undefined): string | null {
	return compileTrackExpr(track, (v) => v / 100 - 1);
}

/** eq contrast/saturation and volume: percent → multiplier. */
export function compileRatioExpr(track: KeyframeTrack | undefined): string | null {
	return compileTrackExpr(track, (v) => v / 100);
}
