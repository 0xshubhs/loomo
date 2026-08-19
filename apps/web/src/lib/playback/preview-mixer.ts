import type { Clip, Track } from '$lib/types/timeline.js';

/**
 * The audio tracks the preview has to play alongside the base clip.
 *
 * The export mixes every audio track into the render; the preview played only
 * the clip under the playhead on the first video track. So a music bed was in
 * the file and not in the editor — the same mismatch the video side had, in
 * the other direction.
 *
 * Selection is pure and lives here; the players themselves are managed by the
 * preview panel, which owns the decode.
 */

export interface BedClip {
	clip: Clip;
	/** Track fader folded into the clip's own volume, as the export does. */
	volume: number;
}

/**
 * Audio-track clips playing at `time`.
 *
 * The rules are `planComposite`'s: a muted track contributes nothing, a track
 * fader at zero is a mute by another name, and a muted clip is silent even on
 * an audible track. Video tracks are not included — the export takes video
 * from overlay tracks and audio only from audio tracks.
 */
export function audioBedClips(tracks: Track[], time: number): BedClip[] {
	const bed: BedClip[] = [];

	for (const track of tracks) {
		if (track.type !== 'audio') continue;
		if (track.muted || track.volume === 0) continue;

		for (const clip of track.clips) {
			if (time < clip.timelineStart || time >= clip.timelineStart + clip.duration) continue;
			if (clip.muted) continue;

			const volume = clip.volume * track.volume;
			if (volume <= 0) continue;
			bed.push({ clip, volume });
		}
	}

	return bed;
}

/**
 * What changed between what is playing and what should be.
 *
 * Returned rather than acted on so the diff can be tested without a real
 * AudioContext, and so a clip that is already playing is left alone: restarting
 * it every frame would stutter the music it exists to play.
 */
export function diffBed(
	playing: Iterable<string>,
	wanted: BedClip[]
): { start: BedClip[]; stop: string[] } {
	const current = new Set(playing);
	const target = new Set(wanted.map((b) => b.clip.id));

	return {
		start: wanted.filter((b) => !current.has(b.clip.id)),
		stop: [...current].filter((id) => !target.has(id)),
	};
}

/** Where in a bed clip's source the playhead currently sits. */
export function bedSourceTime(clip: Clip, time: number): number {
	return clip.sourceStart + (time - clip.timelineStart);
}
