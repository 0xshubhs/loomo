import type { Clip } from '$lib/types/timeline.js';

/**
 * The limits a clip has to stay inside.
 *
 * None of these were enforced. Dragging a clip left from the start of the
 * timeline gave it a negative `timelineStart` and it kept going, sliding off
 * the left edge and looking as though it were being cropped. Dragging the
 * start handle past the beginning did the same to `sourceStart`, asking ffmpeg
 * to seek before the beginning of the file; dragging the end handle right ran
 * `sourceEnd` past the end of the media, and dragging it far enough left made
 * the duration negative.
 *
 * The rules live here rather than in the commands so both the drag handler and
 * the commands enforce the same thing, and so each one is stated once.
 */

/** Shortest a clip may be trimmed to. One frame at 30fps. */
export const MIN_CLIP_DURATION = 1 / 30;

/** A clip never starts before the beginning of the timeline. */
export function clampStart(start: number): number {
	return Math.max(0, start);
}

/**
 * The largest part of a move that can actually be applied.
 *
 * Clamping each clip separately would tear a group apart: the leftmost clip
 * would stop at zero while the rest kept going. The whole group moves by
 * whatever the leftmost member allows, or not at all.
 */
export function clampMoveDelta(delta: number, starts: number[]): number {
	if (starts.length === 0) return delta;

	const leftmost = Math.min(...starts);
	// Moving right is never bounded; moving left stops when the leftmost clip
	// reaches the start of the timeline.
	//
	// `+ 0` normalises the negative zero that `-leftmost` produces for a clip
	// already at the start. It is numerically identical, but it would be
	// written into a saved project as `-0`.
	return Math.max(delta, -leftmost) + 0;
}

export interface TrimLimits {
	/**
	 * Full length of the source media, when it is known.
	 *
	 * Absent for an asset that never reported a duration, in which case the
	 * end handle is only bounded by the minimum clip length — better than
	 * refusing to trim at all.
	 */
	sourceDuration?: number;
}

/**
 * How much of a requested trim can be applied without breaking an invariant.
 *
 * Returns the adjusted delta rather than mutating, so the caller can tell
 * whether anything happened and skip the command entirely if not.
 */
export function clampTrimDelta(
	clip: Pick<Clip, 'timelineStart' | 'duration' | 'sourceStart' | 'sourceEnd'>,
	edge: 'start' | 'end',
	delta: number,
	limits: TrimLimits = {}
): number {
	if (edge === 'start') {
		// Dragging the start left moves the clip earlier on the timeline and
		// earlier into the source, so both floors apply.
		const earliest = Math.max(-clip.timelineStart, -clip.sourceStart);
		const latest = clip.duration - MIN_CLIP_DURATION;
		return Math.min(Math.max(delta, earliest), Math.max(latest, earliest));
	}

	const earliest = MIN_CLIP_DURATION - clip.duration;
	const latest =
		limits.sourceDuration === undefined
			? Number.POSITIVE_INFINITY
			: Math.max(limits.sourceDuration - clip.sourceEnd, 0);
	return Math.min(Math.max(delta, earliest), Math.max(latest, earliest));
}

/** Whether a clamped delta is worth turning into an undoable command. */
export function isMeaningfulDelta(delta: number): boolean {
	return Math.abs(delta) > 0.001;
}
