import type { Command } from './base-command.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';
import type { AnimatableProperty, EasingType, Keyframe, KeyframeTrack } from '$lib/types/keyframes.js';
import { ANIMATABLE_PROPERTIES } from '$lib/types/keyframes.js';
import { createKeyframe, upsertKeyframe, removeKeyframe } from '$lib/utils/keyframes.js';
import type { MosaicRegion, SpeedCurve } from '$lib/types/timeline.js';

/**
 * Undo/redo for animation edits.
 *
 * Each command snapshots the whole track array rather than the single field it
 * touched. Keyframe edits cascade — adding one can create a track, removing
 * the last one destroys it — so restoring a copy is both simpler and less
 * likely to leave the timeline in a half-reverted state.
 */
function snapshot(tracks: KeyframeTrack[] | undefined): KeyframeTrack[] {
	return (tracks ?? []).map((track) => ({
		property: track.property,
		keyframes: track.keyframes.map((k) => ({ ...k })),
	}));
}

abstract class KeyframeCommandBase implements Command {
	abstract readonly type: string;
	abstract readonly description: string;

	protected previous: KeyframeTrack[] | null = null;

	constructor(
		protected timeline: TimelineStore,
		protected clipId: string
	) {}

	protected abstract mutate(tracks: KeyframeTrack[]): KeyframeTrack[];

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previous = snapshot(clip.keyframes);
		clip.keyframes = this.mutate(snapshot(clip.keyframes));
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip || !this.previous) return;
		clip.keyframes = this.previous;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

/** Adds a keyframe, or replaces the one already at that time. */
export class SetKeyframeCommand extends KeyframeCommandBase {
	readonly type = 'set-keyframe';
	readonly description: string;

	constructor(
		timeline: TimelineStore,
		clipId: string,
		private property: AnimatableProperty,
		private time: number,
		private value: number,
		private easing: EasingType = 'linear'
	) {
		super(timeline, clipId);
		this.description = `Keyframe ${ANIMATABLE_PROPERTIES[property].label}`;
	}

	protected mutate(tracks: KeyframeTrack[]): KeyframeTrack[] {
		const incoming = createKeyframe(this.time, this.value, this.easing);
		const existing = tracks.find((t) => t.property === this.property);

		if (!existing) {
			return [...tracks, { property: this.property, keyframes: [incoming] }];
		}

		return tracks.map((track) =>
			track.property === this.property
				? { ...track, keyframes: upsertKeyframe(track.keyframes, incoming) }
				: track
		);
	}
}

export class RemoveKeyframeCommand extends KeyframeCommandBase {
	readonly type = 'remove-keyframe';
	readonly description = 'Remove keyframe';

	constructor(
		timeline: TimelineStore,
		clipId: string,
		private property: AnimatableProperty,
		private keyframeId: string
	) {
		super(timeline, clipId);
	}

	protected mutate(tracks: KeyframeTrack[]): KeyframeTrack[] {
		return tracks
			.map((track) =>
				track.property === this.property
					? { ...track, keyframes: removeKeyframe(track.keyframes, this.keyframeId) }
					: track
			)
			// A track with nothing left in it should disappear, so the property
			// reads as un-animated again rather than animated-to-nothing.
			.filter((track) => track.keyframes.length > 0);
	}
}

/** Moves a keyframe in time, or changes its value or easing. */
export class UpdateKeyframeCommand extends KeyframeCommandBase {
	readonly type = 'update-keyframe';
	readonly description = 'Adjust keyframe';

	constructor(
		timeline: TimelineStore,
		clipId: string,
		private property: AnimatableProperty,
		private keyframeId: string,
		private changes: Partial<Pick<Keyframe, 'time' | 'value' | 'easing'>>
	) {
		super(timeline, clipId);
	}

	protected mutate(tracks: KeyframeTrack[]): KeyframeTrack[] {
		return tracks.map((track) => {
			if (track.property !== this.property) return track;
			return {
				...track,
				keyframes: track.keyframes.map((k) =>
					k.id === this.keyframeId
						? { ...k, ...this.changes, time: Math.max(0, this.changes.time ?? k.time) }
						: k
				),
			};
		});
	}
}

/** Drops every keyframe for one property. */
export class ClearPropertyKeyframesCommand extends KeyframeCommandBase {
	readonly type = 'clear-property-keyframes';
	readonly description: string;

	constructor(timeline: TimelineStore, clipId: string, private property: AnimatableProperty) {
		super(timeline, clipId);
		this.description = `Clear ${ANIMATABLE_PROPERTIES[property].label} animation`;
	}

	protected mutate(tracks: KeyframeTrack[]): KeyframeTrack[] {
		return tracks.filter((track) => track.property !== this.property);
	}
}

export class ClearAllKeyframesCommand extends KeyframeCommandBase {
	readonly type = 'clear-all-keyframes';
	readonly description = 'Clear all animation';

	protected mutate(): KeyframeTrack[] {
		return [];
	}
}

// ── Mosaic ──────────────────────────────────────────────────────────

abstract class MosaicCommandBase implements Command {
	abstract readonly type: string;
	abstract readonly description: string;

	private previous: MosaicRegion[] | null = null;

	constructor(
		protected timeline: TimelineStore,
		protected clipId: string
	) {}

	protected abstract mutate(regions: MosaicRegion[]): MosaicRegion[];

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previous = (clip.mosaics ?? []).map((r) => ({ ...r }));
		clip.mosaics = this.mutate((clip.mosaics ?? []).map((r) => ({ ...r })));
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip || !this.previous) return;
		clip.mosaics = this.previous;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class AddMosaicCommand extends MosaicCommandBase {
	readonly type = 'add-mosaic';
	readonly description = 'Add mosaic';

	constructor(timeline: TimelineStore, clipId: string, private region: MosaicRegion) {
		super(timeline, clipId);
	}

	protected mutate(regions: MosaicRegion[]): MosaicRegion[] {
		return [...regions, this.region];
	}
}

export class UpdateMosaicCommand extends MosaicCommandBase {
	readonly type = 'update-mosaic';
	readonly description = 'Adjust mosaic';

	constructor(
		timeline: TimelineStore,
		clipId: string,
		private regionId: string,
		private changes: Partial<MosaicRegion>
	) {
		super(timeline, clipId);
	}

	protected mutate(regions: MosaicRegion[]): MosaicRegion[] {
		return regions.map((r) => (r.id === this.regionId ? { ...r, ...this.changes } : r));
	}
}

export class RemoveMosaicCommand extends MosaicCommandBase {
	readonly type = 'remove-mosaic';
	readonly description = 'Remove mosaic';

	constructor(timeline: TimelineStore, clipId: string, private regionId: string) {
		super(timeline, clipId);
	}

	protected mutate(regions: MosaicRegion[]): MosaicRegion[] {
		return regions.filter((r) => r.id !== this.regionId);
	}
}

// ── Speed curve ─────────────────────────────────────────────────────

export class SetSpeedCurveCommand implements Command {
	readonly type = 'set-speed-curve';
	readonly description = 'Adjust speed curve';

	private previous: SpeedCurve | null = null;
	private captured = false;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private curve: SpeedCurve | null
	) {}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previous = clip.speedCurve ? { ...clip.speedCurve, points: clip.speedCurve.points.map((p) => ({ ...p })) } : null;
		this.captured = true;
		clip.speedCurve = this.curve ? { ...this.curve, points: this.curve.points.map((p) => ({ ...p })) } : null;
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		// `previous` is legitimately null when the clip had no curve, so undo
		// keys off whether execute ran rather than off the value itself.
		if (!clip || !this.captured) return;
		clip.speedCurve = this.previous;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}
