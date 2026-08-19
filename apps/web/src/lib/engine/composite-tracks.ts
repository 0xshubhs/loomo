import type { Clip, Track } from '$lib/types/timeline.js';
import { hasNonDefaultPosition } from '$lib/utils/pip-presets.js';
import { DEFAULT_CLIP_POSITION } from '$lib/types/timeline.js';
import { gainFilter } from './loudness.js';

/**
 * Everything on the timeline that is not the base video track.
 *
 * The export only ever read one track:
 *
 *   const videoTrack = tracks.find((t) => t.type === 'video' && t.clips.length > 0);
 *
 * so a logo dropped on a second video track, a title card held over the first
 * ten seconds, or a music bed on an audio track appeared in the preview and
 * then silently vanished from the file. This module composites them back on
 * top of the rendered base in a second pass, which keeps every existing
 * strategy — stream copy, per-clip re-encode, filter_complex — untouched.
 */

export interface CompositeSource {
	/** Virtual filename ffmpeg will open. */
	path: string;
	clip: Clip;
	/** Images have no intrinsic duration and must be looped to get one. */
	isStill: boolean;
}

export interface CompositePlan {
	overlays: CompositeSource[];
	audio: CompositeSource[];
}

/** True when there is nothing to composite and the base render is already final. */
export function isEmptyPlan(plan: CompositePlan): boolean {
	return plan.overlays.length === 0 && plan.audio.length === 0;
}

/**
 * Which clips need compositing, in the order they should stack.
 *
 * Later tracks draw over earlier ones, matching how the timeline is displayed.
 * Hidden tracks and muted tracks are skipped, as are clips whose track the base
 * render already covered.
 */
export function planComposite(tracks: Track[], baseTrackId: string): {
	overlayClips: Clip[];
	audioClips: Clip[];
} {
	const overlayClips: Clip[] = [];
	const audioClips: Clip[] = [];

	for (const track of tracks) {
		if (track.type === 'video') {
			if (track.id === baseTrackId || track.visible === false) continue;
			overlayClips.push(...track.clips);
		} else if (track.type === 'audio') {
			if (track.muted) continue;
			// A track-level volume of zero is a mute by another name.
			if (track.volume === 0) continue;
			audioClips.push(...track.clips.map((clip) => withTrackVolume(clip, track.volume)));
		}
	}

	overlayClips.sort((a, b) => a.timelineStart - b.timelineStart);
	audioClips.sort((a, b) => a.timelineStart - b.timelineStart);
	return { overlayClips, audioClips };
}

/** Folds the track fader into the clip, so downstream code reads one number. */
function withTrackVolume(clip: Clip, trackVolume: number): Clip {
	return trackVolume === 1 ? clip : { ...clip, volume: clip.volume * trackVolume };
}

export interface CompositeOptions {
	width: number;
	height: number;
	fps: number;
	/** Whether the base render carries an audio stream to mix against. */
	baseHasAudio: boolean;
	/**
	 * Loudness correction per clip id, in dB. A music bed dropped in at its
	 * own level is exactly the mismatch the matching exists to remove, so it
	 * gets the same treatment as anything on the base track.
	 */
	gains?: Map<string, number>;
}

/**
 * Input flags for one composited source.
 *
 * A still has to be looped and given an explicit duration or ffmpeg emits a
 * single frame; a video or audio clip is trimmed to the part the timeline uses.
 */
export function inputArgsFor(source: CompositeSource, fps: number): string[] {
	if (source.isStill) {
		return ['-loop', '1', '-framerate', String(fps), '-t', String(source.clip.duration), '-i', source.path];
	}
	const args: string[] = [];
	if (source.clip.sourceStart > 0.01) args.push('-ss', String(source.clip.sourceStart));
	args.push('-t', String(source.clip.duration), '-i', source.path);
	return args;
}

/**
 * The filtergraph that lays every overlay and audio clip onto the base.
 *
 * Two details matter for correctness. Each overlay is shifted to its timeline
 * position with `setpts` and gated with `enable=between(...)`, so it appears
 * when the user placed it rather than at zero — that is the whole point of a
 * track. And `amix` is given `normalize=0`, because its default divides every
 * input by the number of inputs, which would quietly halve the original audio
 * the moment a single music track was added.
 */
export function buildCompositeFilter(
	plan: CompositePlan,
	options: CompositeOptions
): { filter: string; videoLabel: string; audioLabel: string | null } {
	const parts: string[] = [];
	const { width, height, fps } = options;

	let videoLabel = '0:v';
	plan.overlays.forEach((source, index) => {
		// Input 0 is the base render, so composited inputs start at 1.
		const input = index + 1;
		const clip = source.clip;
		const start = clip.timelineStart;
		const end = start + clip.duration;
		const box = geometryFor(clip, width, height);

		const chain = [
			// lanczos here too: an overlay scaled up with the default bicubic is
			// visibly softer than the frame it sits on.
			`scale=${box.width}:${box.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
			// Reset then shift, so the clip's own start offset does not leak in.
			`setpts=PTS-STARTPTS+${start.toFixed(3)}/TB`,
		];

		// Careful: `Clip.opacity` runs 0–1, while `ClipFilters.opacity` in the
		// same codebase runs 0–100. Treating this one as a percentage drew
		// every overlay at 1% alpha, which looked exactly like not compositing
		// at all.
		const opacity = Math.min(Math.max(clip.opacity ?? 1, 0), 1);
		if (opacity < 1) {
			// colorchannelmixer is the alpha route that survives overlay; a
			// plain `format=rgba` alone leaves the clip fully opaque.
			chain.push('format=rgba', `colorchannelmixer=aa=${opacity.toFixed(3)}`);
		}

		parts.push(`[${input}:v]${chain.join(',')}[ov${index}]`);

		const out = index === plan.overlays.length - 1 ? 'vout' : `bg${index}`;
		parts.push(
			`[${videoLabel}][ov${index}]overlay=${box.x}:${box.y}:` +
				`enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${out}]`
		);
		videoLabel = out;
	});

	const audioInputs: string[] = [];
	if (options.baseHasAudio) audioInputs.push('0:a');

	plan.audio.forEach((source, index) => {
		const input = plan.overlays.length + index + 1;
		const clip = source.clip;
		const delayMs = Math.round(clip.timelineStart * 1000);
		const volume = clip.muted ? 0 : clip.volume;

		const chain = [`volume=${volume}`];

		const gain = options.gains?.get(clip.id);
		if (gain !== undefined) {
			const filter = gainFilter(gain);
			if (filter) chain.push(filter);
		}

		// adelay pads the front so the clip lands where it was placed. Both
		// channels need a value or only the left one is delayed.
		if (delayMs > 0) chain.push(`adelay=${delayMs}|${delayMs}`);

		parts.push(`[${input}:a]${chain.join(',')}[au${index}]`);
		audioInputs.push(`au${index}`);
	});

	let audioLabel: string | null = null;
	if (audioInputs.length === 1) {
		audioLabel = audioInputs[0];
	} else if (audioInputs.length > 1) {
		const inputs = audioInputs.map((label) => `[${label}]`).join('');
		// normalize=0: mixing must not attenuate what was already there.
		parts.push(`${inputs}amix=inputs=${audioInputs.length}:normalize=0:dropout_transition=0[aout]`);
		audioLabel = 'aout';
	}

	// An overlay that covers the whole frame still needs the base to set the
	// canvas size, so the video label is only rewritten when something drew.
	void fps;
	return { filter: parts.join(';'), videoLabel, audioLabel };
}

/**
 * The box an overlay is scaled into, in pixels.
 *
 * Exported because the preview draws the same overlays on a canvas and the two
 * must agree: an overlay that previews centred and exports in the corner is
 * worse than one that does neither. Position is a percentage of the frame, so
 * this is the single place it is turned into pixels.
 */
export interface OverlayGeometry {
	width: number;
	height: number;
	x: number;
	y: number;
	/** True when no PiP position is set and the overlay fills the frame. */
	full: boolean;
}

export function overlayGeometry(clip: Clip, width: number, height: number): OverlayGeometry {
	const position = clip.position ?? DEFAULT_CLIP_POSITION;
	if (!hasNonDefaultPosition(position)) {
		return { width, height, x: 0, y: 0, full: true };
	}
	return {
		width: Math.round((width * position.width) / 100),
		height: Math.round((height * position.height) / 100),
		x: Math.round((width * position.x) / 100),
		y: Math.round((height * position.y) / 100),
		full: false,
	};
}

/** The same box as ffmpeg expressions, centring when no position is set. */
function geometryFor(clip: Clip, width: number, height: number) {
	const box = overlayGeometry(clip, width, height);
	// `(W-w)/2` rather than 0: a full-frame overlay is scaled with
	// force_original_aspect_ratio, so a differently shaped source ends up
	// smaller than the frame and has to be centred in it.
	if (box.full) return { width: box.width, height: box.height, x: '(W-w)/2', y: '(H-h)/2' };
	return { width: box.width, height: box.height, x: String(box.x), y: String(box.y) };
}
