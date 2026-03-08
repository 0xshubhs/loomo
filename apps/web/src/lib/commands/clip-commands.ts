import type { Command } from './base-command.js';
import type { Clip } from '$lib/types/index.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';
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
