import type { Command } from './base-command.js';
import type { Clip, ClipFilters, ClipTransform, ClipCrop, ChromaKey, ClipPosition, VideoEffect } from '$lib/types/index.js';
import { DEFAULT_VIDEO_EFFECT } from '$lib/types/index.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';
import type { SilenceRegion } from '$lib/engine/silence-detector.js';
import { generateId } from '$lib/utils/id.js';

export class AddClipCommand implements Command {
	readonly type = 'add-clip';
	readonly description: string;

	constructor(
		private timeline: TimelineStore,
		private trackId: string,
		private clip: Clip,
		private insertIndex?: number
	) {
		this.description = `Add clip "${clip.name}"`;
	}

	execute(): void {
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) throw new Error(`Track ${this.trackId} not found`);

		if (this.insertIndex !== undefined) {
			track.clips.splice(this.insertIndex, 0, { ...this.clip });
		} else {
			track.clips.push({ ...this.clip });
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) return;
		track.clips = track.clips.filter((c) => c.id !== this.clip.id);
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class RemoveClipCommand implements Command {
	readonly type = 'remove-clip';
	readonly description: string;
	private removedClip: Clip | null = null;
	private trackId: string | null = null;
	private index: number = -1;

	constructor(
		private timeline: TimelineStore,
		private clipId: string
	) {
		this.description = 'Remove clip';
	}

	execute(): void {
		const track = this.timeline.getClipTrack(this.clipId);
		if (!track) throw new Error(`Clip ${this.clipId} not found`);

		this.trackId = track.id;
		this.index = track.clips.findIndex((c) => c.id === this.clipId);
		this.removedClip = { ...track.clips[this.index] };
		track.clips.splice(this.index, 1);
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		if (!this.trackId || !this.removedClip) return;
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) return;
		track.clips.splice(this.index, 0, { ...this.removedClip });
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class MoveClipCommand implements Command {
	readonly type = 'move-clip';
	readonly description = 'Move clip';
	private previousStart: number = 0;
	private previousTrackId: string = '';

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newTimelineStart: number,
		private newTrackId?: string
	) {}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);

		this.previousStart = clip.timelineStart;
		this.previousTrackId = clip.trackId;
		clip.timelineStart = this.newTimelineStart;

		if (this.newTrackId && this.newTrackId !== clip.trackId) {
			const oldTrack = this.timeline.getClipTrack(this.clipId);
			const newTrack = this.timeline.getTrackById(this.newTrackId);
			if (oldTrack && newTrack) {
				oldTrack.clips = oldTrack.clips.filter((c) => c.id !== this.clipId);
				clip.trackId = this.newTrackId;
				newTrack.clips.push(clip);
			}
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) return;

		clip.timelineStart = this.previousStart;

		if (this.newTrackId && this.newTrackId !== this.previousTrackId) {
			const currentTrack = this.timeline.getClipTrack(this.clipId);
			const originalTrack = this.timeline.getTrackById(this.previousTrackId);
			if (currentTrack && originalTrack) {
				currentTrack.clips = currentTrack.clips.filter((c) => c.id !== this.clipId);
				clip.trackId = this.previousTrackId;
				originalTrack.clips.push(clip);
			}
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SplitClipCommand implements Command {
	readonly type = 'split-clip';
	readonly description = 'Split clip';
	private originalClip: Clip | null = null;
	private leftClip: Clip | null = null;
	private rightClip: Clip | null = null;
	private trackId: string = '';
	private originalIndex: number = -1;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private splitTime: number
	) {}

	execute(): void {
		const track = this.timeline.getClipTrack(this.clipId);
		if (!track) throw new Error(`Clip ${this.clipId} not found`);

		this.trackId = track.id;
		const clipIndex = track.clips.findIndex((c) => c.id === this.clipId);
		this.originalIndex = clipIndex;
		const clip = track.clips[clipIndex];
		this.originalClip = { ...clip };

		const relSplit = this.splitTime - clip.timelineStart;

		this.leftClip = {
			...clip,
			id: generateId(),
			duration: relSplit,
			sourceEnd: clip.sourceStart + relSplit,
		};

		this.rightClip = {
			...clip,
			id: generateId(),
			timelineStart: clip.timelineStart + relSplit,
			sourceStart: clip.sourceStart + relSplit,
			duration: clip.duration - relSplit,
		};

		track.clips.splice(clipIndex, 1, this.leftClip, this.rightClip);
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		if (!this.originalClip || !this.leftClip) return;
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) return;

		const leftIdx = track.clips.findIndex((c) => c.id === this.leftClip!.id);
		if (leftIdx >= 0) {
			track.clips.splice(leftIdx, 2, { ...this.originalClip });
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class TrimClipCommand implements Command {
	readonly type = 'trim-clip';
	readonly description: string;
	private previousStart: number = 0;
	private previousDuration: number = 0;
	private previousSourceStart: number = 0;
	private previousSourceEnd: number = 0;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private edge: 'start' | 'end',
		private deltaSeconds: number
	) {
		this.description = `Trim clip ${edge}`;
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);

		this.previousStart = clip.timelineStart;
		this.previousDuration = clip.duration;
		this.previousSourceStart = clip.sourceStart;
		this.previousSourceEnd = clip.sourceEnd;

		if (this.edge === 'start') {
			clip.timelineStart += this.deltaSeconds;
			clip.sourceStart += this.deltaSeconds;
			clip.duration -= this.deltaSeconds;
		} else {
			clip.duration += this.deltaSeconds;
			clip.sourceEnd += this.deltaSeconds;
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) return;
		clip.timelineStart = this.previousStart;
		clip.duration = this.previousDuration;
		clip.sourceStart = this.previousSourceStart;
		clip.sourceEnd = this.previousSourceEnd;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetClipFiltersCommand implements Command {
	readonly type = 'set-clip-filters';
	readonly description: string;
	private previousFilters: ClipFilters | null = null;
	private previousPreset: string | null = null;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newFilters: ClipFilters,
		private newPreset: string | null
	) {
		this.description = newPreset ? `Apply "${newPreset}" filter preset` : 'Update clip filters';
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousFilters = { ...clip.filters };
		this.previousPreset = clip.filterPreset;
		clip.filters = { ...this.newFilters };
		clip.filterPreset = this.newPreset;
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip || !this.previousFilters) return;
		clip.filters = { ...this.previousFilters };
		clip.filterPreset = this.previousPreset;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetClipTransformCommand implements Command {
	readonly type = 'set-clip-transform';
	readonly description: string;
	private previousTransform: ClipTransform | null = null;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newTransform: ClipTransform
	) {
		this.description = 'Update clip transform';
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousTransform = { ...clip.transform };
		clip.transform = { ...this.newTransform };
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip || !this.previousTransform) return;
		clip.transform = { ...this.previousTransform };
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetClipCropCommand implements Command {
	readonly type = 'set-clip-crop';
	readonly description: string;
	private previousCrop: ClipCrop | null = null;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newCrop: ClipCrop
	) {
		this.description = 'Update clip crop';
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousCrop = { ...clip.crop };
		clip.crop = { ...this.newCrop };
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip || !this.previousCrop) return;
		clip.crop = { ...this.previousCrop };
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetClipReversedCommand implements Command {
	readonly type = 'set-clip-reversed';
	readonly description: string;
	private previousReversed: boolean = false;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newReversed: boolean
	) {
		this.description = newReversed ? 'Reverse clip' : 'Un-reverse clip';
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousReversed = clip.reversed;
		clip.reversed = this.newReversed;
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) return;
		clip.reversed = this.previousReversed;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetChromaKeyCommand implements Command {
	readonly type = 'set-chroma-key';
	readonly description: string;
	private previousChromaKey: ChromaKey | null = null;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newChromaKey: ChromaKey
	) {
		this.description = newChromaKey.enabled ? 'Enable chroma key' : 'Update chroma key';
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousChromaKey = { ...clip.chromaKey };
		clip.chromaKey = { ...this.newChromaKey };
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip || !this.previousChromaKey) return;
		clip.chromaKey = { ...this.previousChromaKey };
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class PasteClipsCommand implements Command {
	readonly type = 'paste-clips';
	readonly description = 'Paste clips';
	private pastedClipIds: string[] = [];

	constructor(
		private timeline: TimelineStore,
		private clipsToPaste: Clip[],
		private playheadTime: number
	) {}

	execute(): void {
		if (this.clipsToPaste.length === 0) return;

		// Find the earliest start time among the copied clips to compute offsets
		const minStart = Math.min(...this.clipsToPaste.map((c) => c.timelineStart));
		this.pastedClipIds = [];

		for (const clip of this.clipsToPaste) {
			const newId = generateId();
			const offset = clip.timelineStart - minStart;
			const newClip: Clip = {
				...structuredClone(clip),
				id: newId,
				timelineStart: this.playheadTime + offset,
			};

			// Find the target track (same track if it exists, otherwise first track of matching type)
			let track = this.timeline.getTrackById(clip.trackId);
			if (!track) {
				track = this.timeline.tracks.find((t) => t.type === (clip.type === 'audio' ? 'audio' : 'video'));
			}
			if (!track) {
				track = this.timeline.tracks[0];
			}
			if (!track) continue;

			newClip.trackId = track.id;
			track.clips.push(newClip);
			this.pastedClipIds.push(newId);
		}

		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		for (const track of this.timeline.tracks) {
			track.clips = track.clips.filter((c) => !this.pastedClipIds.includes(c.id));
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}

	getPastedIds(): string[] {
		return this.pastedClipIds;
	}
}

export class DuplicateClipsCommand implements Command {
	readonly type = 'duplicate-clips';
	readonly description = 'Duplicate clips';
	private duplicatedClipIds: string[] = [];

	constructor(
		private timeline: TimelineStore,
		private clipIds: string[]
	) {}

	execute(): void {
		this.duplicatedClipIds = [];

		for (const clipId of this.clipIds) {
			const clip = this.timeline.getClipById(clipId);
			if (!clip) continue;

			const track = this.timeline.getClipTrack(clipId);
			if (!track) continue;

			const newId = generateId();
			const newClip: Clip = {
				...structuredClone(clip),
				id: newId,
				timelineStart: clip.timelineStart + clip.duration,
			};

			track.clips.push(newClip);
			this.duplicatedClipIds.push(newId);
		}

		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		for (const track of this.timeline.tracks) {
			track.clips = track.clips.filter((c) => !this.duplicatedClipIds.includes(c.id));
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}

	getDuplicatedIds(): string[] {
		return this.duplicatedClipIds;
	}
}

export class SetClipPositionCommand implements Command {
	readonly type = 'set-clip-position';
	readonly description: string;
	private previousPosition: ClipPosition | null = null;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newPosition: ClipPosition
	) {
		this.description = 'Update clip position';
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousPosition = { ...clip.position };
		clip.position = { ...this.newPosition };
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip || !this.previousPosition) return;
		clip.position = { ...this.previousPosition };
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class SetVideoEffectCommand implements Command {
	readonly type = 'set-video-effect';
	readonly description: string;
	private previousEffect: VideoEffect | null = null;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private newEffect: VideoEffect
	) {
		this.description = `Set effect: ${newEffect.type}`;
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);
		this.previousEffect = clip.videoEffect ? { ...clip.videoEffect } : { ...DEFAULT_VIDEO_EFFECT };
		clip.videoEffect = { ...this.newEffect };
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip || !this.previousEffect) return;
		clip.videoEffect = { ...this.previousEffect };
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class RemoveGapsCommand implements Command {
	readonly type = 'remove-gaps';
	readonly description = 'Remove gaps';
	private previousStarts: Map<string, number> = new Map();

	constructor(
		private timeline: TimelineStore,
		private trackId?: string
	) {}

	execute(): void {
		this.previousStarts.clear();
		// Save all clip starts
		for (const track of this.timeline.tracks) {
			for (const clip of track.clips) {
				this.previousStarts.set(clip.id, clip.timelineStart);
			}
		}
		if (this.trackId) {
			this.timeline.removeGapsOnTrack(this.trackId);
		} else {
			this.timeline.removeAllGaps();
		}
	}

	undo(): void {
		for (const track of this.timeline.tracks) {
			for (const clip of track.clips) {
				const prev = this.previousStarts.get(clip.id);
				if (prev !== undefined) {
					clip.timelineStart = prev;
				}
			}
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

export class RemoveSilencesCommand implements Command {
	readonly type = 'remove-silences';
	readonly description = 'Remove silences';
	private originalClip: Clip | null = null;
	private trackId: string = '';
	private originalIndex: number = -1;
	private resultClipIds: string[] = [];

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private silences: SilenceRegion[],
	) {}

	execute(): void {
		const track = this.timeline.getClipTrack(this.clipId);
		if (!track) throw new Error(`Clip ${this.clipId} not found`);

		this.trackId = track.id;
		const clipIndex = track.clips.findIndex((c) => c.id === this.clipId);
		this.originalIndex = clipIndex;
		const clip = track.clips[clipIndex];
		this.originalClip = { ...clip };

		// Sort silences by start time
		const sorted = [...this.silences].sort((a, b) => a.startTime - b.startTime);

		// Build kept regions (inverse of silences, relative to clip source)
		const clipSourceStart = clip.sourceStart;
		const clipSourceEnd = clip.sourceEnd;
		const kept: { srcStart: number; srcEnd: number }[] = [];
		let cursor = clipSourceStart;

		for (const silence of sorted) {
			// Convert silence times from audio-absolute to source-relative
			const silStart = clip.sourceStart + silence.startTime;
			const silEnd = clip.sourceStart + silence.endTime;

			// Clamp to clip boundaries
			const effectiveStart = Math.max(silStart, cursor);
			const effectiveEnd = Math.min(silEnd, clipSourceEnd);

			if (effectiveStart > cursor) {
				kept.push({ srcStart: cursor, srcEnd: effectiveStart });
			}
			cursor = Math.max(cursor, effectiveEnd);
		}

		if (cursor < clipSourceEnd) {
			kept.push({ srcStart: cursor, srcEnd: clipSourceEnd });
		}

		if (kept.length === 0) {
			// Everything is silence - just remove the clip
			track.clips.splice(clipIndex, 1);
			this.timeline.tracks = [...this.timeline.tracks];
			return;
		}

		// Create new clips for kept regions, closing gaps
		const newClips: Clip[] = [];
		let timelinePos = clip.timelineStart;

		for (const region of kept) {
			const duration = region.srcEnd - region.srcStart;
			if (duration <= 0.01) continue; // Skip tiny fragments

			const newClip: Clip = {
				...clip,
				id: generateId(),
				timelineStart: timelinePos,
				duration,
				sourceStart: region.srcStart,
				sourceEnd: region.srcEnd,
			};
			newClips.push(newClip);
			this.resultClipIds.push(newClip.id);
			timelinePos += duration;
		}

		// Replace original clip with new clips
		track.clips.splice(clipIndex, 1, ...newClips);
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		if (!this.originalClip) return;
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) return;

		// Remove all result clips
		track.clips = track.clips.filter((c) => !this.resultClipIds.includes(c.id));

		// Re-insert the original clip at the original index
		const insertIdx = Math.min(this.originalIndex, track.clips.length);
		track.clips.splice(insertIdx, 0, { ...this.originalClip });
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

/**
 * Closes one gap by sliding everything after it left.
 *
 * `RemoveGapsCommand` collapses every gap on the timeline at once, which is
 * the wrong tool when a user right-clicks one specific piece of empty space:
 * it silently rearranges parts of the edit they never touched.
 */
export class CloseGapCommand implements Command {
	readonly type = 'close-gap';
	readonly description = 'Close gap';

	private previousStarts = new Map<string, number>();

	constructor(
		private timeline: TimelineStore,
		private trackId: string,
		private gapStart: number,
		private gapEnd: number
	) {}

	execute(): void {
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) throw new Error(`Track ${this.trackId} not found`);

		const shift = this.gapEnd - this.gapStart;
		if (shift <= 0) return;

		this.previousStarts.clear();
		for (const clip of track.clips) {
			// Everything starting at or after the gap moves back by its width.
			if (clip.timelineStart >= this.gapEnd - 0.0001) {
				this.previousStarts.set(clip.id, clip.timelineStart);
				clip.timelineStart = Math.max(0, clip.timelineStart - shift);
			}
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const track = this.timeline.getTrackById(this.trackId);
		if (!track) return;
		for (const clip of track.clips) {
			const previous = this.previousStarts.get(clip.id);
			if (previous !== undefined) clip.timelineStart = previous;
		}
		this.timeline.tracks = [...this.timeline.tracks];
	}
}

/**
 * Trims a clip up to the playhead, dropping the part on the chosen side.
 *
 * The timeline already supports dragging an edge, but that is invisible to
 * anyone who does not already know it exists, and it cannot be undone as one
 * step. This is the same operation as an explicit, discoverable action.
 */
export class TrimToPlayheadCommand implements Command {
	readonly type = 'trim-to-playhead';
	readonly description: string;

	private previous: { start: number; duration: number; sourceStart: number; sourceEnd: number } | null =
		null;

	constructor(
		private timeline: TimelineStore,
		private clipId: string,
		private side: 'start' | 'end',
		private playhead: number
	) {
		this.description = side === 'start' ? 'Trim clip start' : 'Trim clip end';
	}

	execute(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip) throw new Error(`Clip ${this.clipId} not found`);

		const offset = this.playhead - clip.timelineStart;
		// Refuse a trim that would leave nothing, or that misses the clip.
		if (offset <= 0.01 || offset >= clip.duration - 0.01) return;

		this.previous = {
			start: clip.timelineStart,
			duration: clip.duration,
			sourceStart: clip.sourceStart,
			sourceEnd: clip.sourceEnd,
		};

		if (this.side === 'start') {
			clip.timelineStart = this.playhead;
			clip.sourceStart += offset;
			clip.duration -= offset;
		} else {
			clip.sourceEnd = clip.sourceStart + offset;
			clip.duration = offset;
		}

		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		const clip = this.timeline.getClipById(this.clipId);
		if (!clip || !this.previous) return;
		clip.timelineStart = this.previous.start;
		clip.duration = this.previous.duration;
		clip.sourceStart = this.previous.sourceStart;
		clip.sourceEnd = this.previous.sourceEnd;
		this.timeline.tracks = [...this.timeline.tracks];
	}
}
