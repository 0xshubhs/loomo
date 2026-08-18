import type { Clip, Track } from '$lib/types/index.js';

/**
 * Empty spans between clips on a track.
 *
 * Closing a gap needs to know exactly which one the user clicked, so gaps are
 * modelled explicitly rather than only handled by the bulk "remove all gaps"
 * action. Only interior gaps count: the run-up before the first clip is
 * leading space the user may well want, not a gap between two clips.
 */
export interface Gap {
	trackId: string;
	start: number;
	end: number;
	/** Id of the clip immediately after the gap — the first one to shift left. */
	nextClipId: string;
}

export function gapDuration(gap: Gap): number {
	return gap.end - gap.start;
}

/** Interior gaps on a track, in time order. */
export function findGaps(track: Track, minimum = 0.001): Gap[] {
	const clips = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
	const gaps: Gap[] = [];

	// `reach` is the furthest point covered so far; overlapping clips must not
	// register as a gap just because the next one starts earlier than the last
	// one ended.
	let reach = clips.length > 0 ? clips[0].timelineStart + clips[0].duration : 0;

	for (let i = 1; i < clips.length; i++) {
		const clip = clips[i];
		if (clip.timelineStart - reach > minimum) {
			gaps.push({
				trackId: track.id,
				start: reach,
				end: clip.timelineStart,
				nextClipId: clip.id,
			});
		}
		reach = Math.max(reach, clip.timelineStart + clip.duration);
	}

	return gaps;
}

/** The gap containing `time`, if the user clicked inside one. */
export function gapAt(track: Track, time: number): Gap | null {
	return findGaps(track).find((gap) => time >= gap.start && time < gap.end) ?? null;
}

/** The clip containing `time`, if any. */
export function clipAt(track: Track, time: number): Clip | null {
	return (
		track.clips.find(
			(clip) => time >= clip.timelineStart && time < clip.timelineStart + clip.duration
		) ?? null
	);
}
