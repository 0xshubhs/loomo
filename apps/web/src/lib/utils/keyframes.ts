import type { EasingType, Keyframe, KeyframeTrack, AnimatableProperty } from '$lib/types/keyframes.js';
import { ANIMATABLE_PROPERTIES } from '$lib/types/keyframes.js';
import { generateId } from './id.js';

/**
 * Keyframe evaluation, shared by the preview renderer and the exporter.
 *
 * The preview calls `evaluateTrack` once per frame; the exporter compiles the
 * same curve into an FFmpeg expression. Both must agree, so the easing shapes
 * here and the ones emitted in `ffmpeg-keyframes.ts` are deliberately the same
 * simple polynomials.
 */

/** Maps normalized progress 0..1 through an easing curve. */
export function applyEasing(progress: number, easing: EasingType): number {
	const p = Math.min(Math.max(progress, 0), 1);
	switch (easing) {
		case 'hold':
			return 0;
		case 'ease-in':
			return p * p;
		case 'ease-out':
			return 1 - (1 - p) * (1 - p);
		case 'ease-in-out':
			return p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) * (-2 * p + 2)) / 2;
		case 'linear':
		default:
			return p;
	}
}

/** Keyframes in ascending time order. Callers must not assume input is sorted. */
export function sortKeyframes(keyframes: Keyframe[]): Keyframe[] {
	return [...keyframes].sort((a, b) => a.time - b.time);
}

/**
 * Value of a track at `time` (seconds from clip start).
 *
 * Outside the keyframed range the curve holds flat at the first/last value,
 * which is what every NLE does and avoids surprising extrapolation.
 */
export function evaluateTrack(track: KeyframeTrack, time: number): number | null {
	const frames = sortKeyframes(track.keyframes);
	if (frames.length === 0) return null;
	if (frames.length === 1) return frames[0].value;

	if (time <= frames[0].time) return frames[0].value;
	const last = frames[frames.length - 1];
	if (time >= last.time) return last.value;

	for (let i = 0; i < frames.length - 1; i++) {
		const a = frames[i];
		const b = frames[i + 1];
		if (time < a.time || time > b.time) continue;

		const span = b.time - a.time;
		// Two keyframes stacked on the same instant: jump straight to the second.
		if (span <= 0) return b.value;

		const eased = applyEasing((time - a.time) / span, a.easing);
		return a.value + (b.value - a.value) * eased;
	}

	return last.value;
}

/** Value of a property on a clip, falling back to the property default. */
export function evaluateProperty(
	tracks: KeyframeTrack[] | undefined,
	property: AnimatableProperty,
	time: number
): number {
	const fallback = ANIMATABLE_PROPERTIES[property].fallback;
	if (!tracks) return fallback;
	const track = tracks.find((t) => t.property === property);
	if (!track) return fallback;
	return evaluateTrack(track, time) ?? fallback;
}

export function hasKeyframes(tracks: KeyframeTrack[] | undefined): boolean {
	return !!tracks?.some((t) => t.keyframes.length > 0);
}

export function trackFor(
	tracks: KeyframeTrack[] | undefined,
	property: AnimatableProperty
): KeyframeTrack | undefined {
	return tracks?.find((t) => t.property === property);
}

export function createKeyframe(time: number, value: number, easing: EasingType = 'linear'): Keyframe {
	return { id: generateId(), time: Math.max(0, time), value, easing };
}

/**
 * Inserts a keyframe, replacing any existing one at the same instant.
 *
 * Editors set a keyframe by scrubbing to a time and changing a value, so
 * re-setting at the same playhead position must overwrite rather than stack.
 */
export function upsertKeyframe(keyframes: Keyframe[], incoming: Keyframe, epsilon = 0.001): Keyframe[] {
	const without = keyframes.filter((k) => Math.abs(k.time - incoming.time) > epsilon);
	return sortKeyframes([...without, incoming]);
}

export function removeKeyframe(keyframes: Keyframe[], id: string): Keyframe[] {
	return keyframes.filter((k) => k.id !== id);
}

/** Nearest keyframe within `tolerance` seconds, for click-to-select on the timeline. */
export function keyframeAt(
	keyframes: Keyframe[],
	time: number,
	tolerance = 0.05
): Keyframe | undefined {
	let best: Keyframe | undefined;
	let bestDistance = tolerance;
	for (const k of keyframes) {
		const distance = Math.abs(k.time - time);
		if (distance <= bestDistance) {
			best = k;
			bestDistance = distance;
		}
	}
	return best;
}

/**
 * Rescales keyframe times when a clip's duration changes.
 *
 * Used when a clip is speed-ramped or retimed: the animation should stay
 * proportionally where the user put it rather than bunching at the head.
 */
export function rescaleKeyframes(
	keyframes: Keyframe[],
	oldDuration: number,
	newDuration: number
): Keyframe[] {
	if (oldDuration <= 0 || newDuration <= 0) return keyframes;
	const factor = newDuration / oldDuration;
	return keyframes.map((k) => ({ ...k, time: k.time * factor }));
}
