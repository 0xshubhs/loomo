import type { Command } from './base-command.js';
import type { Track } from '$lib/types/index.js';
import type { TimelineStore } from '$lib/state/timeline.svelte.js';

export class AddTrackCommand implements Command {
	readonly type = 'add-track';
	readonly description: string;
	private addedTrack: Track | null = null;

	constructor(
		private timeline: TimelineStore,
		private trackType: 'video' | 'audio',
		private name?: string
	) {
		this.description = `Add ${trackType} track`;
	}

	execute(): void {
		this.addedTrack = this.timeline.addTrack(this.trackType, this.name);
	}

	undo(): void {
		if (this.addedTrack) {
			this.timeline.removeTrack(this.addedTrack.id);
		}
	}
}

export class RemoveTrackCommand implements Command {
	readonly type = 'remove-track';
	readonly description = 'Remove track';
	private removedTrack: Track | null = null;
	private index: number = -1;

	constructor(
		private timeline: TimelineStore,
		private trackId: string
	) {}

	execute(): void {
		this.index = this.timeline.tracks.findIndex((t) => t.id === this.trackId);
		if (this.index === -1) throw new Error(`Track ${this.trackId} not found`);
		this.removedTrack = { ...this.timeline.tracks[this.index], clips: [...this.timeline.tracks[this.index].clips] };
		this.timeline.tracks.splice(this.index, 1);
		this.timeline.tracks = [...this.timeline.tracks];
	}

	undo(): void {
		if (!this.removedTrack) return;
		this.timeline.tracks.splice(this.index, 0, this.removedTrack);
		this.timeline.tracks = [...this.timeline.tracks];
	}
}
